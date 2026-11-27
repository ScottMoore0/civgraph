#!/usr/bin/env node
/**
 * Build data/database/dead-links.json, the compact list of outside links found dead, each with
 * the copy to show instead: Civgraph's own mirror where it holds one, else an Internet Archive
 * capture, else null. The election provenance build reads it (packages/core/src/link-health.mjs):
 * a citation of a dead link keeps its address, marked dead, and its archived copy shows first.
 *
 * Input is a link review's broken-link table (CSV: severity, outcome, url, wayback_snapshot, ...).
 * Kept: severity high or medium whose outcome is not a move (a moved link still answers). Left out:
 * links fixed where they are made (derived Wikipedia titles, NI Assembly member pages,
 * the ElectionsIreland pages removed or repointed), and Civgraph's own addresses (fixed or uploaded, never archived).
 *
 * A triage table (CSV: url, decision, target) settles links one by one and overrides the rules
 * above: `rewrite` (the address was fixed where it is made) and `keep` (it works) leave a link
 * out; `archive` lists it with its target copy, and `gone` lists it with none, whatever its
 * severity or outcome in the review (a move to an unrelated page is dead too).
 *
 * A mirror is matched through its manifest (an array of { key, sourceUrl, alsoAt? }) and used only
 * when its key is in the list of published keys, so the list never points at an object that is not
 * on the data origin.
 *
 *   node scripts/build/build-dead-links.mjs --review <broken.csv>
 *     [--mirror <prefix> <manifest.json> <published-keys.txt>]...   e.g. data/sources/eoni-result-sheets/
 *     [--triage <triage.csv>] [--checked YYYY-MM-DD] [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '@civgraph/config/node.mjs';
import { SITE } from '@civgraph/config/config.js';
import { parseCsv } from '@civgraph/loader/ingest-registries.mjs';

const OUT = path.join(REPO_ROOT, 'data', 'database', 'dead-links.json');

/** Links fixed where they are made, so never listed as dead. */
const FIXED_AT_SOURCE = [
  /^https:\/\/en\.wikipedia\.org\/wiki\//,                 // derived titles: only verified articles are linked
  /^https:\/\/aims\.niassembly\.gov\.uk\/mlas\/details\.aspx/i, // member pages: the template carries the working query
  // the 1974, 1979 and 1985 local pages (removed from the contest files) and Galway cons 120 (repointed to 734)
  /^https?:\/\/(www\.)?electionsireland\.org\/result\.cfm\?election=(?:(?:1974|1979|1985)L&|[^&]*&cons=120$)/i,
];

/**
 * Mirror copies never linked: nomination statements, notices of poll and agents' notices can
 * carry home addresses, so a citation of one falls back to the Internet Archive capture.
 */
const MAY_HOLD_ADDRESSES = /nominat|notice[-_ ]of[-_ ]poll|agent/i;

/**
 * A comparable form of an address: no scheme, no www., no trailing slash or file extension,
 * percent-decoded and lower case.
 * @param {string} url
 */
export function linkKey(url) {
  let text = url.trim();
  try { text = decodeURIComponent(text); } catch { /* a stray % stays as it is */ }
  return text.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').replace(/\.(pdf|xlsx?|docx?|csv)$/, '');
}

/**
 * The published mirror copy for each original address a manifest names.
 * @param {string} prefix  the mirror's folder on the data origin, ending in /
 * @param {{ key: string, sourceUrl?: string, alsoAt?: string | string[] }[]} manifest
 * @param {Set<string>} published  the full keys on the data origin
 * @returns {{ byKey: Map<string, string>, byGuid: Map<string, string> }}
 */
export function mirrorIndex(prefix, manifest, published) {
  /** @type {Map<string, string>} */
  const byKey = new Map();
  /** @type {Map<string, string>} */
  const byGuid = new Map();
  for (const entry of manifest) {
    const full = `${prefix}${entry.key}`;
    if (!published.has(full) || MAY_HOLD_ADDRESSES.test(entry.key)) continue;
    const copy = `${SITE.dataOrigin}/${full.split('/').map(encodeURIComponent).join('/')}`;
    const originals = [entry.sourceUrl, ...(Array.isArray(entry.alsoAt) ? entry.alsoAt : [entry.alsoAt])].filter((u) => typeof u === 'string');
    for (const original of /** @type {string[]} */ (originals)) {
      if (!byKey.has(linkKey(original))) byKey.set(linkKey(original), copy);
      // The old site served one document under several addresses that share its media id.
      const guid = /\/get(?:media|attachment)\/([0-9a-f-]{36})/i.exec(original)?.[1]?.toLowerCase();
      if (guid && !byGuid.has(guid)) byGuid.set(guid, copy);
    }
  }
  return { byKey, byGuid };
}

/** An Internet Archive capture address, or null. @param {unknown} url */
const capture = (url) => (/^https:\/\/web\.archive\.org\/web\/\d+/.test(String(url || '')) ? String(url) : null);

/**
 * One link's decision from a triage table.
 * @typedef {{ decision: 'rewrite' | 'keep' | 'archive' | 'gone', target: string | null }} TriageDecision
 */

/**
 * A triage table's rows by url (rows with any other decision are ignored).
 * @param {Record<string, string>[]} rows
 * @returns {Map<string, TriageDecision>}
 */
export function triageIndex(rows) {
  /** @type {Map<string, TriageDecision>} */
  const out = new Map();
  for (const row of rows) {
    const url = String(row['url'] || '').trim();
    const decision = String(row['decision'] || '').trim();
    if (!url || !['rewrite', 'keep', 'archive', 'gone'].includes(decision)) continue;
    out.set(url, { decision: /** @type {TriageDecision['decision']} */ (decision), target: String(row['target'] || '').trim() || null });
  }
  return out;
}

/**
 * The dead-link list from the review's rows, settled by the triage table where it names a link.
 * @param {Record<string, string>[]} rows
 * @param {{ byKey: Map<string, string>, byGuid: Map<string, string> }[]} mirrors
 * @param {Map<string, TriageDecision>} [triage]
 * @returns {Record<string, string | null>}
 */
export function deadLinks(rows, mirrors, triage = new Map()) {
  /** @type {Record<string, string | null>} */
  const out = {};
  for (const row of rows) {
    const url = String(row['url'] || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const settled = triage.get(url);
    if (settled && (settled.decision === 'rewrite' || settled.decision === 'keep')) continue;
    if (!settled) {
      if (!['high', 'medium'].includes(String(row['severity']))) continue;
      if (/moved/i.test(String(row['outcome']))) continue;
    }
    if (FIXED_AT_SOURCE.some((re) => re.test(url))) continue;
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
    if (host === new URL(SITE.dataOrigin).host || host === 'civgraph.net' || host.endsWith('.civgraph.net')) continue;
    const guid = /\/get(?:media|attachment)\/([0-9a-f-]{36})/i.exec(url)?.[1]?.toLowerCase();
    const mirror = mirrors.map((m) => m.byKey.get(linkKey(url)) || (guid ? m.byGuid.get(guid) : undefined)).find(Boolean);
    const archived = settled ? (settled.decision === 'archive' ? capture(settled.target) : null) : capture(row['wayback_snapshot']);
    out[url] = mirror || archived;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function main() {
  const args = process.argv.slice(2);
  const at = (/** @type {string} */ flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const review = at('--review');
  if (!review) {
    console.error('usage: node scripts/build/build-dead-links.mjs --review <broken.csv> [--mirror <prefix> <manifest.json> <keys.txt>]... [--triage <triage.csv>] [--checked YYYY-MM-DD] [--check]');
    process.exit(2);
  }
  /** @type {ReturnType<typeof mirrorIndex>[]} */
  const mirrors = [];
  args.forEach((a, i) => {
    if (a !== '--mirror') return;
    const [prefix, manifest, keys] = /** @type {[string, string, string]} */ (args.slice(i + 1, i + 4));
    const published = new Set(readFileSync(keys, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    mirrors.push(mirrorIndex(prefix, JSON.parse(readFileSync(manifest, 'utf8')), published));
  });
  const triageFile = at('--triage');
  const triage = triageFile ? triageIndex(parseCsv(readFileSync(triageFile, 'utf8'))) : new Map();
  const links = deadLinks(parseCsv(readFileSync(review, 'utf8')), mirrors, triage);
  const values = Object.values(links);
  const doc = {
    schemaVersion: 1,
    about: 'Outside links found dead in the site\'s link review, each with the copy to show instead: Civgraph\'s own mirror (data origin) where it holds one, else an Internet Archive capture, else null. Read by scripts/build/build-election-provenance.mjs (packages/core/src/link-health.mjs): a citation of a dead link keeps its address, marked urlDead, and shows its archived copy first. Built by scripts/build/build-dead-links.mjs from the review\'s broken-link table (high and medium severity, not moved) and its triage table (each link settled as fixed where it is made, working, archived or gone); links fixed where they are made (derived Wikipedia titles, NI Assembly member pages, the ElectionsIreland pages removed or repointed) and Civgraph\'s own addresses are left out.',
    checked: at('--checked') || new Date().toISOString().slice(0, 10),
    counts: {
      links: values.length,
      ownMirror: values.filter((v) => v && v.startsWith(`${SITE.dataOrigin}/`)).length,
      internetArchive: values.filter((v) => v && v.startsWith('https://web.archive.org/')).length,
      none: values.filter((v) => !v).length,
    },
    links,
  };
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  if (args.includes('--check')) {
    const now = readFileSync(OUT, 'utf8');
    const strip = (/** @type {string} */ t) => t.replace(/"checked": "[^"]*"/, '');
    if (strip(now) !== strip(text)) { console.error(`${path.relative(REPO_ROOT, OUT)} is stale`); process.exit(1); }
    console.log('dead links up to date');
    return;
  }
  writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(REPO_ROOT, OUT)}: ${JSON.stringify(doc.counts)}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
