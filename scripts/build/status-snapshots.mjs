#!/usr/bin/env node
/**
 * Snapshot the source counts the Status page needs from material held OUTSIDE the
 * repository, into data/status/source-snapshots.json (committed).
 *
 * WHY A SNAPSHOT
 *
 * Several of the Status page's figures come from things a clean checkout does not have:
 * the Belfast Gazette crawl database, the PRONI eCatalogue copy, the Open Data NI mirror,
 * the gitignored census working files, and two public APIs (Open Data NI's CKAN, and
 * legislation.gov.uk's search). The site build runs on a clean checkout (Cloudflare Pages),
 * so it must never read any of those. This script is run by hand, on the machine that
 * holds them, and writes plain counts into a small committed ledger; scripts/build/build-status.mjs
 * reads only the ledger.
 *
 * WHAT IT MUST NEVER WRITE
 *
 * The ledger is published (data/database/status.json is built from it). It holds counts,
 * dates and the public identifiers of public items (Open Data NI dataset names,
 * legislation.gov.uk item ids) -- never a local path, a file name from a private folder,
 * or anything from material that is not public. Paths are passed in as arguments or
 * environment variables precisely so that none is written down in this file either.
 *
 * Each part is optional: a part whose input is not given (or not reachable) keeps its
 * previous snapshot, with its old date, and says so. A failed API call never zeroes a count.
 *
 * USAGE
 *   node scripts/build/status-snapshots.mjs \
 *     --gazette <Belfast Gazette crawl folder (holds gazette.sqlite and extracted/)> \
 *     --proni <folder holding proni.sqlite and extracted-dates.sqlite> \
 *     --odni-mirror <Open Data NI mirror folder (publisher/dataset sub-folders)> \
 *     [--no-network] [--only gazette,census,opendatani,legislation,proni]
 *
 *   Each folder may instead come from the environment (STATUS_GAZETTE_DIR, STATUS_PRONI_DIR,
 *   STATUS_ODNI_MIRROR_DIR), for instance from .env.local, which is loaded if present.
 *   Census counts are read from data/census/ in this checkout (gitignored working files).
 *
 * Requests take their headers from crawlHeaders() (no User-Agent: the fetch default applies)
 * and carry no personal details.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crawlHeaders } from '../../packages/config/src/node.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'data/status/source-snapshots.json');

try { process.loadEnvFile?.(path.join(ROOT, '.env.local')); } catch { /* optional */ }

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const NO_NETWORK = args.includes('--no-network');
const ONLY = (argVal('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const wanted = (part) => !ONLY.length || ONLY.includes(part);

const dirs = {
  gazette: argVal('--gazette') || process.env.STATUS_GAZETTE_DIR,
  proni: argVal('--proni') || process.env.STATUS_PRONI_DIR,
  odniMirror: argVal('--odni-mirror') || process.env.STATUS_ODNI_MIRROR_DIR,
};

const today = new Date().toISOString().slice(0, 10);
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { sources: {} };
const sources = { ...(previous.sources || {}) };
const log = (msg) => console.log(msg);

// The crawl databases open through the storage adapter, loaded only when one is read (the engine
// prints an ExperimentalWarning on some Node versions; it is harmless here).
let openHandle = null;
async function sqlite() {
  if (!openHandle) ({ openSqliteHandle: openHandle } = await import('../../packages/storage/src/sqlite.mjs'));
  return openHandle;
}

async function getJson(url) {
  const res = await fetch(url, { headers: crawlHeaders({ Accept: 'application/json' }) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: crawlHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Belfast Gazette ----------------------------------------------------------

async function gazette() {
  const dir = dirs.gazette;
  const db = dir && path.join(dir, 'gazette.sqlite');
  if (!db || !existsSync(db)) return log('gazette: no --gazette folder given (or no gazette.sqlite); kept the previous snapshot');
  const open = await sqlite();
  // Read-only: the crawler may be writing at the same time.
  const conn = open(db, { readOnly: true });
  const rows = conn.prepare('SELECT status, COUNT(*) AS n, MAX(issue) AS last, MAX(date) AS lastDate FROM issues GROUP BY status').all();
  const pagesIndexed = conn.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  conn.close();
  const by = Object.fromEntries(rows.map((r) => [r.status, r]));
  const fetched = by.ok?.n || 0;
  const tried = rows.reduce((s, r) => s + r.n, 0);
  let parsed = null;
  let lastParsed = null;
  let notices = null;
  const summary = path.join(dir, 'extracted', 'election-notices-summary.json');
  if (existsSync(summary)) {
    const s = JSON.parse(readFileSync(summary, 'utf8'));
    parsed = s.issues_parsed ?? null;
    lastParsed = s.run?.last_issue ?? null;
    notices = { election: s.notices ?? null };
  }
  const boundary = path.join(dir, 'extracted', 'boundary-notices.jsonl');
  if (existsSync(boundary)) {
    notices = { ...(notices || {}), boundary: readFileSync(boundary, 'utf8').split('\n').filter((l) => l.trim()).length };
  }
  sources['belfast-gazette'] = {
    takenAt: today,
    issuesTried: tried,
    issuesFetched: fetched,
    issuesNotOnline: by.empty?.n || 0,
    lastIssueFetched: by.ok?.last ?? null,
    lastIssueDate: by.ok?.lastDate ?? null,
    pagesIndexed,
    issuesParsed: parsed,
    lastIssueParsed: lastParsed,
    noticesExtracted: notices,
  };
  log(`gazette: ${fetched} issues downloaded of ${tried} tried, ${parsed ?? '?'} read for notices`);
}

// --- census ---------------------------------------------------------------------

function census() {
  const base = path.join(ROOT, 'data/census');
  if (!existsSync(base)) return log('census: data/census/ is not in this checkout; kept the previous snapshot');
  const files = readdirSync(base);
  const tableMeta = path.join(base, 'cleaned/table-metadata.json');
  const tablesByYear = {};
  if (existsSync(tableMeta)) {
    const t = JSON.parse(readFileSync(tableMeta, 'utf8'));
    for (const row of Array.isArray(t) ? t : (t.tables || Object.values(t))) {
      if (row?.censusYear) tablesByYear[row.censusYear] = (tablesByYear[row.censusYear] || 0) + 1;
    }
  }
  const explorerYears = new Set();
  const bundle = path.join(base, 'explorer-bundle.json');
  if (existsSync(bundle)) {
    // A year counts as "in the Census Explorer" only when the explorer links that year's own
    // report AND shows at least one figure from it. A bare year count linking somewhere else
    // (the 2026-11-01 review found exactly that) does not count.
    for (const c of JSON.parse(readFileSync(bundle, 'utf8')).concepts || []) {
      for (const cell of c.historicalYearCells || []) {
        if (cell.available && cell.reports?.length && cell.figures?.length) explorerYears.add(cell.year);
      }
      for (const cell of c.digitalYearCells || []) if (cell.available) explorerYears.add(cell.year);
    }
  }
  // Northern Ireland reports: converted to Markdown as census-<year>[-part-N].md.
  const ni = {};
  for (const year of [1926, 1937, 1951, 1961, 1966, 1971, 1981]) {
    const converted = files.filter((f) => new RegExp(`^census-${year}(-part-\\d+)?\\.md$`).test(f)).length;
    ni[year] = {
      held: converted > 0,
      convertedParts: converted,
      tables: tablesByYear[year] || 0,
      explorer: explorerYears.has(year),
    };
  }
  // Pre-1921: the CSO historical-reports files, by the census year in their file name.
  const pre = {};
  for (const year of [1821, 1831, 1841, 1851, 1861, 1871, 1881, 1891, 1901, 1911]) pre[year] = { files: 0, read: 0 };
  const yearOf = (s) => {
    const m = String(s || '').match(/(?<!\d)(18[2-8]1|1891|1901|1911)(?!\d)/);
    return m ? Number(m[1]) : null;
  };
  const inv = path.join(base, 'source-inventory/cso-historical-reports.json');
  const wayback = path.join(base, 'source-inventory/cso-wayback-recovery.json');
  const heldUrls = new Set();
  if (existsSync(inv)) {
    for (const a of JSON.parse(readFileSync(inv, 'utf8')).assets || []) {
      if (['downloaded', 'cached'].includes(a.download?.status)) heldUrls.add(a.url);
    }
  }
  if (existsSync(wayback)) {
    for (const a of JSON.parse(readFileSync(wayback, 'utf8')).assets || []) {
      if (['downloaded', 'cached'].includes(a.download?.status)) heldUrls.add(a.url);
    }
  }
  for (const url of heldUrls) {
    const y = yearOf(decodeURIComponent(String(url).split('/').pop()));
    if (y && pre[y]) pre[y].files += 1;
  }
  const manifest = path.join(base, 'statistical-staging/extraction-manifest.jsonl');
  if (existsSync(manifest)) {
    for (const line of readFileSync(manifest, 'utf8').split('\n')) {
      if (!line.includes('cso-historical-reports') || !line.includes('"extracted"')) continue;
      const r = JSON.parse(line);
      if (r.corpus !== 'cso-historical-reports' || r.extractionStatus !== 'extracted') continue;
      // The file name only: the folder it sits in is local and is not recorded.
      const y = yearOf(String(r.localPath || '').split(/[\\/]/).pop());
      if (y && pre[y]) pre[y].read += 1;
    }
  }
  for (const [year, row] of Object.entries(pre)) {
    // A file that was read was held, whichever inventory recorded it.
    row.files = Math.max(row.files, row.read);
    row.tables = tablesByYear[year] || 0;
    row.explorer = explorerYears.has(Number(year));
  }
  sources.census = { takenAt: today, ni, pre1921: pre };
  log(`census: NI ${Object.values(ni).filter((r) => r.held).length}/7 years held; pre-1921 ${Object.values(pre).filter((r) => r.files).length}/10 years with files`);
}

// --- Open Data NI ------------------------------------------------------------------

async function opendatani() {
  if (NO_NETWORK) return log('opendatani: --no-network; kept the previous snapshot');
  const api = 'https://admin.opendatani.gov.uk/api/3/action/package_search';
  const first = await getJson(`${api}?rows=0`);
  const listed = first.result.count;
  const byId = new Map();
  for (let start = 0; start < listed; start += 500) {
    const page = await getJson(`${api}?rows=500&start=${start}`);
    for (const p of page.result.results) {
      byId.set(p.id, p.name);
      byId.set(p.name, p.name);
    }
    await pause(500);
  }
  // Datasets a map on the site draws on: any Open Data NI dataset link in the catalogue.
  const maps = readFileSync(path.join(ROOT, 'data/database/maps.json'), 'utf8');
  const refs = new Set([...maps.matchAll(/opendatani\.gov\.uk\/dataset\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const used = new Set();
  let unlisted = 0;
  for (const ref of refs) {
    if (byId.has(ref)) used.add(byId.get(ref));
    else unlisted += 1;
  }
  let mirrored = null;
  if (dirs.odniMirror && existsSync(dirs.odniMirror)) {
    mirrored = 0;
    for (const publisher of readdirSync(dirs.odniMirror)) {
      const p = path.join(dirs.odniMirror, publisher);
      if (!statSync(p).isDirectory()) continue;
      for (const d of readdirSync(p)) if (statSync(path.join(p, d)).isDirectory()) mirrored += 1;
    }
  } else {
    mirrored = previous.sources?.opendatani?.datasetsMirrored ?? null;
    log('opendatani: no --odni-mirror folder given; kept the previous mirrored count');
  }
  sources.opendatani = {
    takenAt: today,
    datasetsListed: listed,
    datasetsMirrored: mirrored,
    datasetsUsed: used.size,
    linksToUnlistedDatasets: unlisted,
    usedDatasets: [...used].sort(),
  };
  log(`opendatani: ${listed} listed, ${mirrored ?? '?'} mirrored, ${used.size} used by maps (${unlisted} links to datasets no longer listed)`);
}

// --- legislation.gov.uk ------------------------------------------------------------

const LEG_QUERIES = [
  // [type, title term]. NI-only types, plus UK instruments whose title names Northern Ireland.
  ...['nia', 'apni', 'nisi', 'nisr', 'nisro'].flatMap((type) => [
    'boundaries', 'boundary', 'electoral', 'election', 'elections', 'constituencies', 'wards', 'extension',
  ].map((term) => [type, term])),
  ...['district electoral areas', 'parliamentary constituencies', 'electoral law', 'local government boundaries', 'assembly elections']
    .map((term) => ['uksi', term]),
];
const LEG_KEEP = /boundar|electoral|election|constituenc|\bwards?\b|franchise|redistribution of seats|(borough|city|town|urban district|rural district|county)[^)]*\(extension\)|extension of (the )?(borough|city|town|urban)/i;
const LEG_DROP = /trade union|benefit|superannuation|pension|human rights|abandonment|scrutineer|election against|\bstreet\b|\btax|fisher|harbour|milk|\beggs?\b|\bpig\b|marketing|livestock|agricultur|water commissioners|nurses|midwives|advisory council|\bboards?\b|tribunal|licens|church|charit/i;

async function legislation() {
  if (NO_NETWORK) return log('legislation: --no-network; kept the previous snapshot');
  const found = new Map();
  for (const [type, term] of LEG_QUERIES) {
    for (let page = 1; page <= 10; page += 1) {
      const url = `https://www.legislation.gov.uk/${type}/data.feed?title=${encodeURIComponent(term)}&page=${page}`;
      let xml;
      try { xml = await getText(url); } catch (error) { log(`legislation: ${error.message}`); break; }
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
      for (const e of entries) {
        const id = (e.match(/<id>https?:\/\/www\.legislation\.gov\.uk\/id\/([^<]+)<\/id>/) || [])[1];
        const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1]?.replace(/&amp;/g, '&').trim();
        if (!id || !title) continue;
        if (type === 'uksi' && !/Northern Ireland/i.test(title)) continue;
        if (!LEG_KEEP.test(title) || LEG_DROP.test(title)) continue;
        found.set(id, title);
      }
      await pause(350);
      const more = Number((xml.match(/<leg:morePages>(\d+)/) || [])[1] || 0);
      if (!entries.length || !more) break;
    }
  }
  if (!found.size) return log('legislation: the search returned nothing; kept the previous snapshot');
  sources.legislation = {
    takenAt: today,
    method: 'legislation.gov.uk title search (nia, apni, nisi, nisr, nisro; uksi naming Northern Ireland), filtered to titles naming boundaries, electoral areas, constituencies, wards, elections or town extensions',
    items: [...found].map(([id, title]) => ({ id, title })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  log(`legislation: ${found.size} items in scope`);
}

// --- PRONI ---------------------------------------------------------------------------

async function proni() {
  const dir = dirs.proni;
  const db = dir && path.join(dir, 'proni.sqlite');
  if (!db || !existsSync(db)) return log('proni: no --proni folder given (or no proni.sqlite); kept the previous snapshot');
  const open = await sqlite();
  const conn = open(db, { readOnly: true });
  const collected = conn.prepare('SELECT COUNT(*) AS n FROM proni').get().n;
  conn.close();
  let dated = null;
  const dates = path.join(dir, 'extracted-dates.sqlite');
  if (existsSync(dates)) {
    const d = open(dates, { readOnly: true });
    dated = d.prepare('SELECT COUNT(*) AS n FROM ext WHERE ext_start_year IS NOT NULL').get().n;
    d.close();
  }
  sources.proni = { takenAt: today, recordsCollected: collected, recordsWithDate: dated };
  log(`proni: ${collected} records collected, ${dated ?? '?'} with a date read`);
}

// --- run ------------------------------------------------------------------------------

const parts = { gazette, census, opendatani, legislation, proni };
for (const [name, fn] of Object.entries(parts)) {
  if (!wanted(name)) continue;
  try {
    await fn();
  } catch (error) {
    log(`${name}: FAILED (${error?.message || error}); kept the previous snapshot`);
  }
}

const out = {
  schemaVersion: 1,
  about: 'Counts for the Status page taken from material held outside the repository and from public APIs, by scripts/build/status-snapshots.mjs. Each source carries the date its snapshot was taken. Read by scripts/build/build-status.mjs; never edited by hand.',
  sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))),
};
// A guard against the one thing this file must never contain.
const text = `${JSON.stringify(out, null, 2)}\n`;
if (/(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\/.test(text)) {
  console.error('FAIL: the snapshot would contain a local path; not written.');
  process.exit(1);
}
writeFileSync(OUT, text);
log(`wrote ${path.relative(ROOT, OUT)}`);
