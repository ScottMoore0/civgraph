#!/usr/bin/env node
/**
 * Build a per-FILE provenance index for the data.gov.ie mirror: archived key -> the publisher
 * URL it was fetched from, plus resource id, format, licence and the dataset page.
 *
 * WHY. Neither store answers "where did this file come from". corpus-index.json resolves a
 * CORPUS to a store; an IA item carries a title and a licence; an R2 key carries a path. The
 * only file-level record of origin is the mirror's _manifest.csv, which lives on an external
 * disk in neither store and covers 4,947 of 30,252 files -- the first run only, before a
 * reconcile pass grew the mirror. So provenance today is about a sixth recorded and the rest
 * inferable only by convention. For a civic archive that is the difference between "you can see
 * what I hold" and "you can verify it is what the publisher issued", and the licence
 * determination itself rests on records not distributed with the files.
 *
 * The data was already in hand and thrown away: harvest-datagovie-licences.mjs calls
 * package_show for every mirrored package and keeps only the licence fields, while the same
 * response carries resources[] with url, id, format and hash. This re-runs that pass and keeps
 * them.
 *
 * JOINING A RESOURCE TO A FILE. The mirror names each file after the LAST PATH SEGMENT of the
 * resource URL, undecoded -- which is why percent-encoded names like `marine%20litter.csv` and
 * bare names like `en` (from CSO PxStat .../CSV/1.0/en) appear on disk. That segment is
 * therefore the join key, and the archived key is <package>/<segment>, matching the IA
 * convention exactly.
 *
 * WHAT IT REPORTS RATHER THAN HIDES. Resources CKAN advertises that are absent from disk, and
 * files on disk no resource accounts for, are both counted and sampled. A provenance index that
 * quietly covered only what it could match would repeat the manifest's failure of looking
 * complete while describing a fraction.
 *
 *   node scripts/harvest-datagovie-provenance.mjs --root D:/datagovie
 *   node scripts/harvest-datagovie-provenance.mjs --root D:/datagovie --emit-only
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = opt('--root');
const CACHE = opt('--cache', 'data/external/datagovie-packages.json');
const OUT = opt('--out', 'data/external/datagovie-provenance.json');
const SUMMARY = opt('--summary', 'data/database/datagovie-provenance-summary.json');
const CONCURRENCY = Math.max(1, Number(opt('--concurrency', '6')));
const EMIT_ONLY = args.includes('--emit-only');
const API = 'https://data.gov.ie/api/3/action/package_show?id=';

if (!ROOT) {
  console.error('Usage: node scripts/harvest-datagovie-provenance.mjs --root <mirror dir> [--emit-only]');
  process.exit(1);
}

// ---- what is actually on disk, as <package>/<filename> ----
const filesByPackage = new Map();  // package -> Map(filename -> {org, bytes})
for (const org of readdirSync(ROOT, { withFileTypes: true })) {
  if (!org.isDirectory()) continue;
  for (const pkg of readdirSync(`${ROOT}/${org.name}`, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    if (!filesByPackage.has(pkg.name)) filesByPackage.set(pkg.name, new Map());
    const bucket = filesByPackage.get(pkg.name);
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) { walk(`${dir}/${entry.name}`); continue; }
        bucket.set(entry.name, { org: org.name, bytes: statSync(`${dir}/${entry.name}`).size });
      }
    };
    walk(`${ROOT}/${org.name}/${pkg.name}`);
  }
}
console.log(`on disk: ${filesByPackage.size} package(s), ${[...filesByPackage.values()].reduce((n, m) => n + m.size, 0)} file(s)`);

// ---- CKAN pass, resumable: cache keyed by package, skip what is already held ----
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : { packages: {} };
// Re-fetch entries a previous run cached as errors, as well as ones never fetched.
const todo = [...filesByPackage.keys()].filter((name) => !cache.packages[name] || cache.packages[name].error);
console.log(`CKAN: ${Object.keys(cache.packages).length} cached, ${todo.length} to fetch.`);

async function lookup(name) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(API + encodeURIComponent(name), { headers: { accept: 'application/json' } });
      if (response.status === 404) return { missing: true, resources: [] };
      // 403 is CKAN's settled answer, not a hiccup: 212 packages -- mostly Tailte Eireann
      // "high value" boundary and cadastral sets -- refuse package_show outright. Recording it
      // as terminal stops an endless retry and keeps the reason visible; retrying it forever
      // would look like an unfinished harvest rather than a restricted catalogue entry.
      if (response.status === 403) return { forbidden: true, resources: [] };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()).result || {};
      return {
        title: result.title || null,
        licenceId: result.license_id || null,
        licenceUrl: result.license_url || null,
        resources: (result.resources || []).map((r) => ({
          id: r.id || null,
          url: r.url || null,
          name: r.name || null,
          format: r.format || null,
          // CKAN's own checksum when the publisher supplied one. Rare, but it is the only
          // integrity claim available without rehashing 144 GB.
          hash: r.hash || null,
          lastModified: r.last_modified || r.created || null,
        })),
      };
    } catch (error) {
      if (attempt === 2) return { error: error.message, resources: [] };
      await new Promise((r) => { setTimeout(r, 800 * (attempt + 1)); });
    }
  }
  return { error: 'unreachable', resources: [] };
}

if (!EMIT_ONLY && todo.length) {
  const queue = [...todo];
  let done = 0;
  const save = () => { mkdirSync('data/external', { recursive: true }); writeFileSync(CACHE, JSON.stringify(cache)); };
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const name = queue.shift();
      if (!name) return;
      const result = await lookup(name);
      // Do NOT cache a failed lookup: caching it makes the failure permanent, because the
      // resume skips anything already present. 212 packages errored on the first pass and
      // would have stayed unresolved forever.
      if (!result.error) cache.packages[name] = result;
      done += 1;
      if (done % 250 === 0) { console.log(`  ${done}/${todo.length}`); save(); }
    }
  }));
  save();
}

// ---- join resources to files ----
/**
 * What a file actually IS, from its first bytes. Used only to break ties: when several
 * resources share a filename they usually differ by format -- PxStat serves CSV and JSON-stat
 * at URLs both ending `en` -- and the bytes on disk say which one was fetched. Evidence from
 * the artefact beats a guess from the catalogue.
 */
function sniffFormat(local) {
  const buffer = Buffer.alloc(512);
  let read = 0;
  const fd = openSync(local, 'r');
  try { read = readSync(fd, buffer, 0, 512, 0); } catch { return null; } finally { closeSync(fd); }
  if (!read) return null;
  const head = buffer.subarray(0, read);
  const text = head.toString('utf8').trimStart();
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
  if (text.startsWith('%PDF')) return 'pdf';
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  if (text.startsWith('<?xml') || text.startsWith('<')) return 'xml';
  if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 64))) return 'binary';
  // CSV and PX are both plain text, and PxStat offers BOTH for every cube -- so lumping them
  // together leaves every CSO file ambiguous, which is 38% of this corpus. They are trivially
  // distinguishable: a PX file opens with keyword assignments, a CSV with a delimited header.
  const withoutBom = text.replace(/^﻿/, '');
  if (/^(CHARSET|AXIS-VERSION|MATRIX|SUBJECT-CODE|TITLE)\s*=/i.test(withoutBom)) return 'px';
  const firstLine = withoutBom.split(/\r?\n/, 1)[0] || '';
  if (firstLine.includes(',') || firstLine.includes('\t') || firstLine.includes(';')) return 'csv';
  return 'text';
}

/** Which sniffed kind a CKAN format string implies, or null when it does not discriminate. */
function kindOfFormat(format) {
  const f = String(format || '').toLowerCase();
  if (!f) return null;
  if (/(^|\b)(json|geojson|json-stat|jsonstat)\b/.test(f)) return 'json';
  if (/(^|\b)(xml|rdf|kml|gml|atom|wfs)\b/.test(f)) return 'xml';
  if (/(^|\b)(zip|shp|shapefile|xlsx|docx|ods|kmz|gdb)\b/.test(f)) return 'zip';
  if (/(^|\b)pdf\b/.test(f)) return 'pdf';
  if (/(^|\b)px\b/.test(f)) return 'px';
  if (/(^|\b)(csv|tsv)\b/.test(f)) return 'csv';
  if (/(^|\b)(txt|text)\b/.test(f)) return 'text';
  return null;
}

/** The mirror names a file after the last path segment of its URL, undecoded. */
function segmentOf(url) {
  try {
    const withoutQuery = String(url).split('#')[0].split('?')[0];
    const parts = withoutQuery.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch { return null; }
}

/**
 * The URL segment is NOT a unique key. CSO PxStat publishes every format at a URL ending in
 * `en` (.../CSV/1.0/en, .../JSON-stat/2.0/en), so several resources land on one filename. A
 * first cut asserted whichever matched last and reported 224% coverage -- more "provenance"
 * than there are files. Ambiguity is therefore resolved where it can be and RECORDED where it
 * cannot: a wrong source URL is worse than an admitted unknown.
 */
const MANIFEST_PATH = `${ROOT}/_manifest.csv`;

/** Ground truth, for the sixth of the mirror the first run recorded: url -> target_path. */
const definitive = new Map();  // "<package>/<filename>" -> {url, resourceId}
if (existsSync(MANIFEST_PATH)) {
  const text = readFileSync(MANIFEST_PATH, 'utf8');
  const rows = text.split('\n').slice(1);
  for (const line of rows) {
    // target_path is <org>\<package>\<file>; the manifest's own url column is authoritative.
    const cols = line.split(',');
    if (cols.length < 6) continue;
    const [resourceId, packageName, , , url, targetPath] = cols;
    if (!targetPath || !url || !packageName) continue;
    const file = targetPath.replace(/\\/g, '/').split('/').pop();
    if (file) definitive.set(`${packageName}/${file}`, { url, resourceId });
  }
  console.log(`manifest ground truth: ${definitive.size} file(s) with a recorded source URL`);
}

const candidates = new Map();  // "<package>/<file>" -> [resource]
const files = {};
const stats = {
  resourcesAdvertised: 0, resourcesAbsentLocally: 0, filesWithoutResource: 0,
  packagesMissingFromCkan: 0, packagesErrored: 0, packagesForbidden: 0,
  fromManifest: 0, unambiguous: 0, sniffed: 0, ambiguous: 0,
};
const absentSample = [];
const orphanSample = [];

for (const [pkg, onDisk] of filesByPackage) {
  const record = cache.packages[pkg] || {};
  if (record.missing) stats.packagesMissingFromCkan += 1;
  if (record.forbidden) stats.packagesForbidden += 1;
  if (!cache.packages[pkg] || cache.packages[pkg].error) stats.packagesErrored += 1;
  for (const resource of record.resources || []) {
    stats.resourcesAdvertised += 1;
    const segment = segmentOf(resource.url);
    if (!segment) continue;
    if (!onDisk.has(segment)) {
      stats.resourcesAbsentLocally += 1;
      if (absentSample.length < 10) absentSample.push({ package: pkg, url: resource.url });
      continue;
    }
    const key = `${pkg}/${segment}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(resource);
  }
  for (const name of onDisk.keys()) {
    if (!candidates.has(`${pkg}/${name}`) && !definitive.has(`${pkg}/${name}`)) {
      stats.filesWithoutResource += 1;
      if (orphanSample.length < 10) orphanSample.push(`${pkg}/${name}`);
    }
  }
}

for (const [pkg, onDisk] of filesByPackage) {
  for (const [name, local] of onDisk) {
    const key = `${pkg}/${name}`;
    const record = cache.packages[pkg] || {};
    const list = candidates.get(key) || [];
    const truth = definitive.get(key);
    const base = {
      bytes: local.bytes,
      package: pkg,
      organisation: local.org,
      licenceId: record.licenceId || null,
      datasetPage: `https://data.gov.ie/dataset/${pkg}`,
    };
    if (truth) {
      // The download run recorded exactly which URL produced this file.
      const match = list.find((r) => r.url === truth.url) || {};
      files[key] = { ...base, url: truth.url, resourceId: truth.resourceId || match.id || null,
        format: match.format || null, lastModified: match.lastModified || null,
        publisherHash: match.hash || null, source: 'manifest' };
      stats.fromManifest += 1;
    } else if (list.length === 1) {
      files[key] = { ...base, url: list[0].url, resourceId: list[0].id, format: list[0].format,
        lastModified: list[0].lastModified, publisherHash: list[0].hash, source: 'unique-url-match' };
      stats.unambiguous += 1;
    } else if (list.length > 1) {
      // Several resources share this filename. Ask the bytes which format was actually saved;
      // if exactly one candidate is of that kind, that is the answer.
      const kind = sniffFormat(`${ROOT}/${local.org}/${pkg}/${name}`);
      const fits = kind ? list.filter((r) => kindOfFormat(r.format) === kind) : [];
      if (fits.length === 1) {
        files[key] = { ...base, url: fits[0].url, resourceId: fits[0].id, format: fits[0].format,
          lastModified: fits[0].lastModified, publisherHash: fits[0].hash,
          source: 'content-sniff', sniffedKind: kind };
        stats.sniffed += 1;
      } else {
        // Still undecided. Record every candidate rather than guessing: the file certainly came
        // from one of them, and the archive can answer that honestly as "one of these" instead
        // of answering it wrongly.
        files[key] = { ...base, url: null, source: 'ambiguous', sniffedKind: kind,
          candidates: list.map((r) => ({ url: r.url, resourceId: r.id, format: r.format })) };
        stats.ambiguous += 1;
      }
    }
  }
}
const resolved = stats.fromManifest + stats.unambiguous + stats.sniffed;

mkdirSync('data/external', { recursive: true });
writeFileSync(OUT, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedFrom: 'data.gov.ie CKAN package_show, for every package present in the mirror tree',
  keyConvention: '<package>/<filename>, matching the Internet Archive items; the R2 key is '
    + '<organisation>/<package>/<filename> and organisation is recorded on each entry',
  note: 'A file is joined to its resource by the last path segment of the resource URL, which '
    + 'is how the mirror named it. Entries are only written for files actually held.',
  files,
}, null, 0)}\n`);

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpus: 'datagovie',
  fullIndex: OUT,
  coverage: {
    filesOnDisk: [...filesByPackage.values()].reduce((n, m) => n + m.size, 0),
    filesWithSingleSourceUrl: resolved,
    ofWhichFromDownloadManifest: stats.fromManifest,
    ofWhichUniqueUrlMatch: stats.unambiguous,
    ofWhichResolvedByContentSniff: stats.sniffed,
    filesWithAmbiguousCandidates: stats.ambiguous,
    filesWithNoResourceAtAll: stats.filesWithoutResource,
    resourcesAdvertised: stats.resourcesAdvertised,
    resourcesAbsentLocally: stats.resourcesAbsentLocally,
    packagesMissingFromCkan: stats.packagesMissingFromCkan,
    packagesForbiddenByCkan: stats.packagesForbidden,
    packagesUnresolved: stats.packagesErrored,
  },
  note: 'A file is ambiguous when several CKAN resources share the last URL segment the mirror '
    + 'named it after -- PxStat publishes every format at a URL ending in "en". Those entries '
    + 'list every candidate instead of asserting one.',
  samples: { resourcesAbsentLocally: absentSample, filesWithoutResource: orphanSample },
};
writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);

const onDiskTotal = Math.max(1, summary.coverage.filesOnDisk);
console.log(`\nprovenance for ${summary.coverage.filesOnDisk} file(s) on disk:`);
console.log(`  single source URL   : ${resolved} (${(resolved / onDiskTotal * 100).toFixed(1)}%)`
  + ` -- ${stats.fromManifest} from the download manifest, ${stats.unambiguous} by unique URL match,`
  + ` ${stats.sniffed} by content sniff`);
console.log(`  ambiguous candidates: ${stats.ambiguous} (${(stats.ambiguous / onDiskTotal * 100).toFixed(1)}%)`);
console.log(`  no resource at all  : ${stats.filesWithoutResource}`);
console.log(`  advertised but absent from disk: ${stats.resourcesAbsentLocally} resource(s)`);
console.log(`  packages 403 from CKAN: ${stats.packagesForbidden} (restricted; no resource list available)`);
console.log(`  packages unresolved : ${stats.packagesErrored} (re-run to retry; transient errors are not cached)`);
console.log(`Wrote ${OUT} and ${SUMMARY}.`);
