/**
 * A CKAN portal's catalogue, harvested through its `package_search` API, written as the
 * `{ datasets: [...] }` file the catalogue-record emitters read
 * (scripts/ingest/census/emit-opendatani-catalogue-records.mjs and
 * scripts/ingest/datagovie/emit-datagovie-catalogue-records.mjs).
 *
 * Politeness: one GET at a time, 1,000 rows a page, sorted by name so the pages do not shift,
 * with no User-Agent of ours (crawlHeaders(): the fetch default applies, owner rule 13 Nov 2026)
 * and at least MIN_DELAY_MS before every request after the first, retries included. A 403, a 429
 * or a bot challenge stops the whole run at once and nothing is written: those are never retried
 * or worked around. So does any page that still fails after its retries, an answer that is not
 * CKAN's JSON, or a run that would pass its request cap; a missing page would otherwise read as
 * datasets removed from the portal.
 *
 * The network is injected (`deps.fetch`, `deps.sleep`), so the paging and the stops are tested
 * without one (tests/intake/ckan-harvest.test.mjs).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { crawlHeaders } from '../../config/src/node.mjs';
import { CrawlRefused, isRefusal, looksLikeChallenge } from './crawl-guard.mjs';

export const ROWS = 1000;
export const MIN_DELAY_MS = 2000;
export const DEFAULT_MAX_REQUESTS = 40;
const ATTEMPTS = 3;
const TIMEOUT_MS = 120_000;

/** @typedef {{ name?: string | null, url?: string | null, format?: string | null }} CkanResource */
/**
 * The fields of a CKAN package dict the harvest reads.
 * @typedef {object} CkanPackage
 * @property {string} name
 * @property {string | null} [title]
 * @property {string | null} [notes]
 * @property {string | null} [license_title]
 * @property {string | null} [license_url]
 * @property {string | null} [metadata_modified]
 * @property {{ title?: string | null, name?: string | null } | null} [organization]
 * @property {CkanResource[] | null} [resources]
 */
/** @typedef {{ name?: string, url: string, format?: string }} HarvestResource */
/**
 * One dataset of the harvest file, in the shape the emitters read.
 * @typedef {object} HarvestDataset
 * @property {string} slug
 * @property {string} [title]
 * @property {string} [org]
 * @property {string} [license]
 * @property {string} [licenseUrl]
 * @property {string} [modified]
 * @property {string} [notes]
 * @property {HarvestResource[]} [resources]
 */
/**
 * What a portal keeps of each package: Open Data NI's records carry the description (its
 * whitespace collapsed, cut at `notesMax` characters; 0 keeps none) and the download links, and
 * their licence URL comes from the emitter's OGL rule; data.gov.ie's carry CKAN's licence URL and
 * neither of the others. The title and a resource's name and format are trimmed; every other
 * value is CKAN's string as it stands (a trailing space in an organisation's title included), as
 * the committed records have them.
 * @typedef {{ notesMax: number, resources: boolean, licenseUrl: boolean }} DatasetFields
 */
/**
 * @typedef {object} HarvestDeps
 * @property {(url: string, init: { headers: Record<string, string>, redirect: 'follow', signal: AbortSignal }) => Promise<{ status: number, ok: boolean, text: () => Promise<string> }>} fetch
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(line: string) => void} [log]
 */
/**
 * @typedef {object} HarvestOptions
 * @property {string} origin       the portal, e.g. https://data.gov.ie (no trailing slash)
 * @property {number} [rows]
 * @property {number} [delayMs]
 * @property {number} [maxRequests]
 */
/** @typedef {{ count: number, results: CkanPackage[] }} CkanPage */

/** An answer a retry will not change (a 4xx other than 403 and 429, or not CKAN's JSON): the run stops. */
class NotRetried extends Error {}

/** The package_search URL of one page. @param {string} origin @param {number} start @param {number} [rows] */
export function searchUrl(origin, start, rows = ROWS) {
  const q = new URLSearchParams({ q: '*:*', sort: 'name asc', rows: String(rows), start: String(start) });
  return `${origin}/api/3/action/package_search?${q}`;
}

/** A non-empty string as it stands, or undefined. @param {unknown} v */
const text = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * One CKAN package as a harvest dataset. Keys are written only when they hold a value.
 * @param {CkanPackage} pkg @param {DatasetFields} fields
 * @returns {HarvestDataset}
 */
export function toDataset(pkg, fields) {
  /** @type {HarvestDataset} */
  const d = { slug: pkg.name };
  const title = text(pkg.title?.trim());
  if (title) d.title = title;
  const org = text(pkg.organization?.title) ?? text(pkg.organization?.name);
  if (org) d.org = org;
  const license = text(pkg.license_title);
  if (license) d.license = license;
  const licenseUrl = fields.licenseUrl ? text(pkg.license_url) : undefined;
  if (licenseUrl) d.licenseUrl = licenseUrl;
  const modified = text(pkg.metadata_modified);
  if (modified) d.modified = modified;
  const notes = fields.notesMax > 0 ? text(pkg.notes)?.replace(/\s+/g, ' ').trim().slice(0, fields.notesMax) : undefined;
  if (notes) d.notes = notes;
  if (fields.resources) {
    /** @type {HarvestResource[]} */
    const resources = [];
    for (const r of pkg.resources || []) {
      const url = text(r.url);
      if (!url) continue;
      /** @type {HarvestResource} */
      const out = { url };
      const name = text(r.name?.trim());
      if (name) out.name = name;
      const format = text(r.format?.trim());
      if (format) out.format = format;
      resources.push(out);
    }
    d.resources = resources;
  }
  return d;
}

/**
 * Read one package_search answer: CKAN's JSON with success true, or an error that stops the run.
 * @param {string} body @param {string} url
 * @returns {CkanPage}
 */
export function parsePage(body, url) {
  /** @type {unknown} */
  let doc;
  try { doc = JSON.parse(body); } catch { throw new Error(`not JSON from ${url}`); }
  const d = /** @type {{ success?: unknown, result?: { count?: unknown, results?: unknown } }} */ (doc);
  if (!d || d.success !== true || !d.result || typeof d.result.count !== 'number' || !Array.isArray(d.result.results)) {
    throw new Error(`not a CKAN package_search answer from ${url}`);
  }
  return { count: d.result.count, results: /** @type {CkanPackage[]} */ (d.result.results) };
}

/**
 * Page through the catalogue, one request at a time. Returns the raw answers too, so a run can
 * keep them and be replayed (`fromPages`).
 * @param {HarvestOptions} opts @param {HarvestDeps} deps
 * @returns {Promise<{ pages: CkanPage[], count: number, requests: number }>}
 */
export async function harvestPages(opts, deps) {
  const rows = opts.rows ?? ROWS;
  const wait = Math.max(MIN_DELAY_MS, opts.delayMs ?? MIN_DELAY_MS);
  const maxRequests = opts.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const log = deps.log ?? (() => {});
  let requests = 0;

  /** @param {string} url @returns {Promise<CkanPage>} */
  async function get(url) {
    let last = '';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      if (requests >= maxRequests) throw new Error(`request cap of ${maxRequests} reached before ${url}`);
      if (requests > 0) await deps.sleep(wait);
      requests += 1;
      try {
        const res = await deps.fetch(url, {
          headers: crawlHeaders({ Accept: 'application/json' }, { url }),
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (isRefusal(res.status)) throw new CrawlRefused(`HTTP ${res.status}`, res.status, url);
        const body = await res.text();
        if (looksLikeChallenge(body)) throw new CrawlRefused('bot challenge or CAPTCHA in the answer', res.status, url);
        if (res.ok) {
          /** @type {CkanPage} */
          let page;
          try { page = parsePage(body, url); } catch (e) { throw new NotRetried(e instanceof Error ? e.message : String(e)); }
          log(`GET ${url}: HTTP ${res.status}, ${page.results.length} of ${page.count} (request ${requests})`);
          return page;
        }
        last = `HTTP ${res.status}`;
        // Another 4xx (a wrong address, a removed API) will not change on a retry.
        if (res.status >= 400 && res.status < 500) throw new NotRetried(`${url} answered ${last}`);
      } catch (e) {
        if (e instanceof CrawlRefused || e instanceof NotRetried) throw e;
        last = e instanceof Error ? e.message : String(e);
      }
      log(`GET ${url}: ${last} (attempt ${attempt}, request ${requests})`);
    }
    throw new Error(`${url} failed after ${ATTEMPTS} attempts: ${last}`);
  }

  /** @type {CkanPage[]} */
  const pages = [];
  let start = 0;
  let count = 0;
  for (;;) {
    const page = await get(searchUrl(opts.origin, start, rows));
    pages.push(page);
    count = page.count;
    start += page.results.length;
    if (page.results.length === 0 || start >= count) break;
  }
  return { pages, count, requests };
}

/**
 * The harvest datasets from the raw pages, in page order, each package once (a package that
 * moved between pages during the run is kept where it was first seen).
 * @param {CkanPage[]} pages @param {DatasetFields} fields
 * @returns {HarvestDataset[]}
 */
export function fromPages(pages, fields) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {HarvestDataset[]} */
  const out = [];
  for (const page of pages) {
    for (const pkg of page.results) {
      if (!pkg || typeof pkg.name !== 'string' || seen.has(pkg.name)) continue;
      seen.add(pkg.name);
      out.push(toDataset(pkg, fields));
    }
  }
  return out;
}

/**
 * The harvest file the emitters read.
 * @param {{ generatedFrom: string, harvestedAt: string, count: number, datasets: HarvestDataset[] }} h
 */
export function harvestJson({ generatedFrom, harvestedAt, count, datasets }) {
  return `${JSON.stringify({ generatedFrom, harvestedAt, portalCount: count, count: datasets.length, datasets })}\n`;
}

/**
 * @typedef {object} Portal
 * @property {string} origin
 * @property {string} generatedFrom
 * @property {DatasetFields} fields
 */

/**
 * The command line of a portal's harvest script:
 *   <out.json> [--raw <pages.json>] [--delay <ms>] [--max-requests <n>]
 *   <out.json> --replay <pages.json>     (offline: rebuild the harvest from kept raw pages)
 * Exits 2, writing nothing, when the portal refuses or challenges; 1 on any other failure.
 * @param {Portal} portal @param {string[]} argv
 */
export async function runCli(portal, argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { raw: { type: 'string' }, replay: { type: 'string' }, delay: { type: 'string' }, 'max-requests': { type: 'string' } },
  });
  const out = positionals[0];
  if (!out) {
    console.error('usage: <out.json> [--raw <pages.json>] [--delay <ms>] [--max-requests <n>] | <out.json> --replay <pages.json>');
    process.exit(1);
  }
  /** @param {string} file @param {string} body */
  const write = (file, body) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); };

  if (values.replay) {
    const kept = /** @type {{ harvestedAt: string, count: number, pages: CkanPage[] }} */ (JSON.parse(readFileSync(values.replay, 'utf8')));
    const datasets = fromPages(kept.pages, portal.fields);
    write(out, harvestJson({ generatedFrom: portal.generatedFrom, harvestedAt: kept.harvestedAt, count: kept.count, datasets }));
    console.log(`Wrote ${out}: ${datasets.length} datasets, replayed from ${kept.pages.length} kept pages (no requests)`);
    return;
  }

  const harvestedAt = new Date().toISOString();
  try {
    /** @type {HarvestOptions} */
    const opts = { origin: portal.origin };
    if (values.delay) opts.delayMs = Number(values.delay);
    if (values['max-requests']) opts.maxRequests = Number(values['max-requests']);
    const { pages, count, requests } = await harvestPages(opts, {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`),
    });
    const datasets = fromPages(pages, portal.fields);
    if (values.raw) write(values.raw, `${JSON.stringify({ origin: portal.origin, harvestedAt, count, requests, pages })}\n`);
    write(out, harvestJson({ generatedFrom: portal.generatedFrom, harvestedAt, count, datasets }));
    console.log(`Wrote ${out}: ${datasets.length} datasets (portal count ${count}; ${pages.length} pages, ${requests} requests)`);
  } catch (e) {
    if (e instanceof CrawlRefused) {
      console.error(`STOPPED: ${e.message} at ${e.url}. Nothing written; do not retry or work around it.`);
      process.exit(2);
    }
    console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}. Nothing written.`);
    process.exit(1);
  }
}

export { CrawlRefused };
