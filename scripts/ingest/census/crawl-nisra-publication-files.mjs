#!/usr/bin/env node
/**
 * For each non-census NISRA publication in a publications harvest (crawl-nisra-publications.mjs's
 * { publications: [{ slug, title }] }), fetch its page on www.nisra.gov.uk and list the NISRA-hosted
 * data files it links (.xlsx/.xls/.csv/.ods/.zip/.pdf). The manifest it writes,
 * { generatedFrom, publicationsWithFiles, fileTotal, publications: [{ slug, title, files: [{ url, ext }] }] },
 * is what enrich-nisra-records-with-files.mjs reads to give the catalogue records their downloads.
 *
 * One GET per publication page and no other request (no HEAD of the files). One request at a
 * time, with crawlHeaders({ Accept: 'text/html' }) and at least MIN_DELAY_MS before every request
 * after the first, retries included. A page that answers 5xx or fails to arrive is tried up to
 * ATTEMPTS times; one that answers 404 or another 4xx is not retried and lists no files. A 403, a
 * 429 or a bot challenge (packages/intake/src/crawl-guard.mjs) stops the run at once and nothing
 * is written.
 *
 * --raw <file> also keeps every answer ({ slug, url, status, html }), so --replay <file> can
 * rebuild the manifest from it with no network.
 *
 * Usage: node scripts/ingest/census/crawl-nisra-publication-files.mjs <publications.json> <out.json> [--delay <ms>] [--raw <pages.json>]
 *        node scripts/ingest/census/crawl-nisra-publication-files.mjs <publications.json> <out.json> --replay <pages.json>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { crawlHeaders } from '../../../packages/config/src/node.mjs';
import { CrawlRefused, isRefusal, looksLikeChallenge } from '../../../packages/intake/src/crawl-guard.mjs';

export { CrawlRefused };

/** Where the publication pages are, and the host a relative file link is on. */
export const HOST = 'https://www.nisra.gov.uk';
export const MIN_DELAY_MS = 2000;
export const DEFAULT_DELAY_MS = 2500;
export const ATTEMPTS = 3;
const TIMEOUT_MS = 40_000;

/** @typedef {{ slug: string, title: string }} Publication */
/** @typedef {{ url: string, ext: string }} FileLink */
/** @typedef {{ slug: string, title: string, files: FileLink[] }} PublicationFiles */
/** @typedef {{ slug: string, url: string, status: number, html: string }} RawPage */
/**
 * @typedef {object} CrawlDeps
 * @property {(url: string, init: { headers: Record<string, string>, redirect: 'follow', signal: AbortSignal }) => Promise<{ status: number, ok: boolean, text: () => Promise<string> }>} fetch
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(line: string) => void} [log]
 */

/** A census publication (the census records come from elsewhere). @param {string} slug */
export const isCensus = (slug) => /^census[-0-9]|-census-|census-20\d\d/.test(slug);

/**
 * The NISRA-hosted data files a publication page links, in page order, each once.
 * @param {string} html
 * @returns {FileLink[]}
 */
export function parseFileLinks(html) {
  /** @type {FileLink[]} */
  const files = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="([^"]+\.(?:xlsx|xls|csv|ods|zip|pdf))"/gi)) {
    let u = /** @type {string} */ (m[1]);
    if (u.startsWith('/')) u = HOST + u;
    if (!/^https?:\/\//i.test(u)) continue;
    if (!/nisra\.gov\.uk/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    files.push({ url: u, ext: (/\.([a-z0-9]+)$/i.exec(u)?.[1] ?? '').toLowerCase() });
  }
  return files;
}

/**
 * The manifest from the answers, in the publications' order; a publication with no files is left out.
 * @param {Publication[]} publications
 * @param {RawPage[]} pages
 */
export function manifestFrom(publications, pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  /** @type {PublicationFiles[]} */
  const out = [];
  let fileTotal = 0;
  for (const p of publications) {
    const page = bySlug.get(p.slug);
    const files = page && page.status >= 200 && page.status < 300 ? parseFileLinks(page.html) : [];
    if (!files.length) continue;
    out.push({ slug: p.slug, title: p.title, files });
    fileTotal += files.length;
  }
  return { generatedFrom: 'nisra.gov.uk publication pages', publicationsWithFiles: out.length, fileTotal, publications: out };
}

/** The manifest file's text. @param {ReturnType<typeof manifestFrom>} manifest */
export const manifestJson = (manifest) => `${JSON.stringify(manifest, null, 0)}\n`;

/**
 * The publications a harvest file lists that are not census publications.
 * @param {{ publications?: Publication[] }} harvest
 */
export const publicationsOf = (harvest) => (harvest.publications || []).filter((p) => !isCensus(p.slug));

/**
 * Fetch each publication's page, one at a time.
 * @param {{ publications: Publication[], delayMs?: number, base?: string }} options
 * @param {CrawlDeps} deps
 * @returns {Promise<{ pages: RawPage[], requests: number, failed: string[] }>}
 */
export async function crawlPages({ publications, delayMs = DEFAULT_DELAY_MS, base = HOST }, deps) {
  const wait = Math.max(MIN_DELAY_MS, delayMs);
  const log = deps.log ?? (() => {});
  let requests = 0;
  /** @type {RawPage[]} */
  const pages = [];
  /** @type {string[]} */
  const failed = [];
  for (const [i, p] of publications.entries()) {
    const url = `${base}/publications/${p.slug}`;
    /** @type {RawPage | null} */
    let got = null;
    for (let attempt = 1; attempt <= ATTEMPTS && !got; attempt += 1) {
      if (requests > 0) await deps.sleep(wait);
      requests += 1;
      try {
        const res = await deps.fetch(url, { headers: crawlHeaders({ Accept: 'text/html' }), redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (isRefusal(res.status)) throw new CrawlRefused(`HTTP ${res.status}`, res.status, url);
        const html = await res.text();
        if (looksLikeChallenge(html)) throw new CrawlRefused('bot challenge or CAPTCHA in the answer', res.status, url);
        // A 4xx will not change on a retry; a 5xx may.
        if (res.ok || (res.status >= 400 && res.status < 500)) got = { slug: p.slug, url, status: res.status, html };
        else log(`${url}: HTTP ${res.status} (attempt ${attempt})`);
      } catch (e) {
        if (e instanceof CrawlRefused) throw e;
        log(`${url}: ${e instanceof Error ? e.message : String(e)} (attempt ${attempt})`);
      }
    }
    if (!got || got.status >= 300) failed.push(p.slug);
    if (got) pages.push(got);
    log(`[${i + 1}/${publications.length}] ${p.slug}: ${got ? `HTTP ${got.status}, ${got.status < 300 ? parseFileLinks(got.html).length : 0} files` : 'no answer'} (requests ${requests})`);
  }
  return { pages, requests, failed };
}

/**
 * The command line. Exit 0 when the manifest is written, 1 on a usage error, 2 when the crawl was
 * refused (nothing written).
 * @param {string[]} argv
 * @param {CrawlDeps} deps
 * @param {{ base?: string }} [options]
 */
export async function runCli(argv, deps, { base = HOST } = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { delay: { type: 'string' }, raw: { type: 'string' }, replay: { type: 'string' } } });
  const [inPath, outPath] = positionals;
  if (!inPath || !outPath || (values.raw && values.replay)) {
    console.error('usage: crawl-nisra-publication-files.mjs <publications.json> <out.json> [--delay <ms>] [--raw <pages.json> | --replay <pages.json>]');
    return 1;
  }
  const publications = publicationsOf(JSON.parse(readFileSync(inPath, 'utf8')));
  /** @type {RawPage[]} */
  let pages;
  if (values.replay) {
    pages = JSON.parse(readFileSync(values.replay, 'utf8')).pages;
  } else {
    try {
      const run = await crawlPages({ publications, delayMs: Number(values.delay ?? DEFAULT_DELAY_MS), base }, deps);
      pages = run.pages;
      console.log(`${run.requests} requests for ${publications.length} publication pages; ${run.failed.length} without a page${run.failed.length ? `: ${run.failed.join(', ')}` : ''}`);
    } catch (e) {
      if (e instanceof CrawlRefused) {
        console.error(`STOPPED: ${e.message} at ${e.url}. Nothing written; do not retry or work around it.`);
        return 2;
      }
      throw e;
    }
    if (values.raw) {
      mkdirSync(dirname(values.raw), { recursive: true });
      writeFileSync(values.raw, `${JSON.stringify({ base, pages }, null, 1)}\n`);
    }
  }
  const manifest = manifestFrom(publications, pages);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, manifestJson(manifest));
  console.log(`Wrote ${outPath}: ${manifest.publicationsWithFiles} publications with files, ${manifest.fileTotal} files total`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (line) => process.stderr.write(`${line}\n`),
  });
}
