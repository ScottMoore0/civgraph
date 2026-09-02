#!/usr/bin/env node
/**
 * List the data.gov.ie mirror files that are NOT yet on the Internet Archive, as a manifest for
 * scripts/upload-tree-r2.mjs.
 *
 * WHY THIS EXISTS. IA's ingest queue sat at or over its global cap for a day
 * (total_tasks_queued 12,001 of 11,999), refusing every upload from every user. 95 GB of the
 * corpus was already up; the remainder is 19,791 small files totalling 1.23 GB, which is a
 * trivial amount of R2 and no reason to leave single-copy on an external disk while IA
 * recovers. R2 is the holding pen, IA remains the destination.
 *
 * The selection MUST match what the IA uploader would send, or the fallback would publish
 * material the IA path deliberately refuses. So the same three filters apply, in the same
 * order, for the same reasons:
 *   1. Only packages whose CKAN licence is a recognised open one (the CLASSES table in
 *      upload-tree-ia.mjs). data.gov.ie federates other bodies' data and the licence varies.
 *   2. No truncated zips -- 25 files, 27 GB, cut short by the original download run. IA refuses
 *      them after transfer; sending them to R2 would just publish corrupt archives.
 *   3. Nothing IA already holds, read from the item metadata rather than a local ledger.
 *
 * Keys keep the IA convention, <package>/<file>, so the two stores are directly comparable and
 * the R2 copies can be matched off against IA items when the backlog clears.
 *
 *   node scripts/plan-datagovie-r2-fallback.mjs --root D:/datagovie \
 *        --licences data/external/datagovie-licences.json --out <manifest.json>
 */
import { readFileSync, writeFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = opt('--root');
const LICENCES = opt('--licences');
const OUT = opt('--out');
const ITEM_PREFIX = opt('--item-prefix', 'civgraph-datagovie-');

if (!ROOT || !LICENCES || !OUT) {
  console.error('Usage: node scripts/plan-datagovie-r2-fallback.mjs --root <dir> --licences <json> --out <json>');
  process.exit(2);
}

// Kept in step with the CLASSES table in upload-tree-ia.mjs. An id absent here is not published.
const OPEN = new Set(['cc-by', 'cc-by-4.0', 'cc-by-sa', 'cc-by-sa-4.0', 'cc-zero', 'cc0-1.0',
  'odc-by', 'odc-pddl', 'odc-odbl', 'uk-ogl', 'ogl']);

function truncatedZip(local, bytes) {
  const name = path.basename(local).toLowerCase();
  if (bytes < 4_000_000 || !(name.endsWith('.zip') || name === 'zip')) return false;
  const length = Math.min(66_000, bytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(local, 'r');
  try { readSync(fd, buffer, 0, length, bytes - length); } finally { closeSync(fd); }
  return !buffer.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
}

async function itemFiles(identifier) {
  const r = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!r.ok) return null;
  const body = await r.json();
  if (!body || !body.files) return null;
  return body.files
    .filter((f) => !String(f.name || '').startsWith('__ia') && !String(f.name || '').startsWith(identifier))
    .map((f) => f.name);
}

const present = new Set();
for (const slug of ['ccby', 'ccbysa', 'cc0']) {
  let misses = 0;
  let index = 1;
  while (misses < 4 && index < 60) {
    const names = await itemFiles(`${ITEM_PREFIX}${slug}-${String(index).padStart(3, '0')}`);
    if (!names || !names.length) misses += 1;
    else { misses = 0; for (const n of names) present.add(n); }
    index += 1;
  }
}
console.log(`on IA already: ${present.size} file(s)`);

const licences = JSON.parse(readFileSync(LICENCES, 'utf8')).packages || {};
const manifest = [];
const stats = { unlicensed: 0, corrupt: 0, onIa: 0, bytes: 0 };

for (const org of readdirSync(ROOT, { withFileTypes: true })) {
  if (!org.isDirectory()) continue;
  for (const pkg of readdirSync(`${ROOT}/${org.name}`, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const open = OPEN.has((licences[pkg.name]?.licenceId || '').toLowerCase());
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const local = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(local); continue; }
        if (!open) { stats.unlicensed += 1; continue; }
        const bytes = statSync(local).size;
        if (truncatedZip(local, bytes)) { stats.corrupt += 1; continue; }
        const rel = `${pkg.name}/${entry.name}`;
        if (present.has(rel)) { stats.onIa += 1; continue; }
        manifest.push({ local, rel });
        stats.bytes += bytes;
      }
    };
    walk(`${ROOT}/${org.name}/${pkg.name}`);
  }
}

writeFileSync(OUT, `${JSON.stringify(manifest, null, 0)}\n`);
console.log(`excluded: ${stats.unlicensed} unlicensed, ${stats.corrupt} corrupt, ${stats.onIa} already on IA`);
console.log(`manifest: ${manifest.length} file(s), ${(stats.bytes / 1e9).toFixed(2)} GB -> ${OUT}`);
