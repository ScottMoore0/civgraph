#!/usr/bin/env node
/**
 * Mirror a downloaded open-data tree to the Internet Archive, resumably.
 *
 * WHY IA AND NOT R2
 *
 * R2 costs money per GB-month and dies with the Cloudflare account. IA is free, permanent and
 * citable. For bulk raw material nothing fetches at runtime, IA is the better home -- see
 * data/database/corpus-index.json, which records which corpus lives where.
 *
 * The immediate case is Open Data NI: 5,331 local files / 221.5 GB, of which nine existing
 * civgraph-opendatani-data-NNN items hold only 2,093 files / 38.9 GB. That is 39% of files but
 * 17.6% by volume, so the big files are disproportionately the missing ones.
 *
 * RESUMABILITY IS BY REMOTE STATE, NOT A LOCAL LEDGER. Before uploading, every existing item's
 * file list is read from the IA metadata API and used to skip what is already there. A local
 * progress file would drift the moment a run died mid-upload; asking IA cannot. This matters
 * more here than on R2 because the job is hours long and will be interrupted.
 *
 * NAMING. Local layout is <organisation>/<package>/<file>; the existing IA items use
 * <package>/<file>. This follows the existing convention -- the package slug is the stable
 * identifier, the organisation name is not (bodies get renamed and merged) -- so the dedup key
 * is `package/filename` and is derivable from both sides.
 *
 * SHARDING. IA items get unwieldy past a few tens of GB, so files are packed into items of at
 * most --max-item-gb, continuing the existing numbering rather than starting a new scheme.
 *
 * RIGHTS. Only run this on material that is lawfully redistributable. IA is MORE exposed than
 * R2, not less: items are indexed, searchable and attributed to the uploader. Open Data NI is
 * Crown copyright under OGL v3.0, which is why it qualifies; the unlicensed portion of the
 * data.gov.ie mirror does NOT and must not be sent here.
 *
 *   node scripts/upload-tree-ia.mjs --manifest <mirror>/_manifest.csv --root <mirror> \
 *        --item-prefix civgraph-opendatani-data- --plan-only
 *   node scripts/upload-tree-ia.mjs --manifest ... --root ... --item-prefix ... --limit 20
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const MANIFEST = opt('--manifest');
const ROOT = opt('--root');
const ITEM_PREFIX = opt('--item-prefix');
const MAX_ITEM_GB = Number(opt('--max-item-gb', '25'));
const MAX_ITEM_FILES = Number(opt('--max-item-files', '700'));
const LIMIT = opt('--limit') ? Number(opt('--limit')) : null;
const PLAN_ONLY = args.includes('--plan-only');
const IA = process.env.IA_CLI || 'ia';
const SIDECAR = opt('--sidecar', 'data/database/opendatani-ia-mirrors.json');

if (!MANIFEST || !ROOT || !ITEM_PREFIX) {
  console.error('Usage: node scripts/upload-tree-ia.mjs --manifest <csv> --root <dir> --item-prefix <prefix>');
  console.error('       [--max-item-gb 25] [--max-item-files 700] [--limit N] [--plan-only]');
  console.error('  Paths are passed in: the mirror lives outside the repo.');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const DONE = new Set(['ok', 'done', 'complete', 'completed', 'success']);
const rows = parseCsv(readFileSync(MANIFEST, 'utf8')).filter((r) => DONE.has((r.status || '').toLowerCase()));

// Local file + the remote name it should carry. Skipped rather than guessed when the manifest
// row lacks what is needed to build either.
const wanted = [];
const unusable = [];
for (const row of rows) {
  const target = (row.target_path || '').replace(/\\/g, '/');
  if (!target || !row.package_name) { unusable.push(row.resource_id || '(no id)'); continue; }
  const local = path.resolve(ROOT, target);
  if (!existsSync(local)) { unusable.push(target); continue; }
  const remote = `${row.package_name}/${path.basename(target)}`;
  wanted.push({ local, remote, bytes: statSync(local).size, package: row.package_name });
}

console.log(`manifest: ${rows.length} completed row(s); ${wanted.length} usable, ${unusable.length} skipped (missing locally or no package).`);

// ---- what IA already holds, read from the items themselves ----
async function itemFiles(identifier) {
  const response = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!response.ok) return null;
  const body = await response.json();
  if (!body || !body.files) return null;
  return body.files
    .filter((file) => !String(file.name || '').startsWith('__ia') && !String(file.name || '').startsWith(identifier))
    .map((file) => file.name);
}

const present = new Set();
const existingItems = [];
let index = 1;
let consecutiveMisses = 0;
// Probe upward rather than assuming a count: items may be sparse (002 and 003 exist but hold
// nothing), and a wrong assumption here re-uploads gigabytes.
while (consecutiveMisses < 4 && index < 400) {
  const identifier = `${ITEM_PREFIX}${String(index).padStart(3, '0')}`;
  const files = await itemFiles(identifier);
  if (files === null || files.length === 0) consecutiveMisses += 1;
  else {
    consecutiveMisses = 0;
    existingItems.push({ identifier, files: files.length });
    for (const name of files) present.add(name);
  }
  index += 1;
}
const highest = existingItems.length
  ? Math.max(...existingItems.map((item) => Number(item.identifier.slice(-3))))
  : 0;
console.log(`IA: ${existingItems.length} existing item(s) holding ${present.size} file(s); highest index ${highest}.`);

const todo = wanted.filter((file) => !present.has(file.remote));
const todoBytes = todo.reduce((sum, file) => sum + file.bytes, 0);
console.log(`to upload: ${todo.length} file(s), ${(todoBytes / 1e9).toFixed(2)} GB`);
if (!todo.length) { console.log('Nothing to do.'); process.exit(0); }

// ---- pack into items ----
const plan = [];
let current = null;
let next = highest + 1;
// Largest first, so one oversized file cannot strand a nearly-full item.
for (const file of [...todo].sort((a, b) => b.bytes - a.bytes)) {
  if (!current || current.bytes + file.bytes > MAX_ITEM_GB * 1e9 || current.files.length >= MAX_ITEM_FILES) {
    current = { identifier: `${ITEM_PREFIX}${String(next).padStart(3, '0')}`, files: [], bytes: 0 };
    next += 1;
    plan.push(current);
  }
  current.files.push(file);
  current.bytes += file.bytes;
}
console.log(`plan: ${plan.length} new item(s)`);
for (const item of plan) console.log(`  ${item.identifier}  ${String(item.files.length).padStart(4)} files  ${(item.bytes / 1e9).toFixed(2)} GB`);

if (PLAN_ONLY) { console.log('\n--plan-only: nothing uploaded.'); process.exit(0); }

// ---- upload ----
const META = [
  '--metadata=title:Open Data NI data files (mirror)',
  '--metadata=licenseurl:https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  '--metadata=subject:Open Data NI',
  '--metadata=subject:Northern Ireland',
  '--metadata=subject:open data',
  '--metadata=collection:opensource_data',
];

let uploaded = 0;
let failed = 0;
let bytesSent = 0;
outer:
for (const item of plan) {
  for (const file of item.files) {
    if (LIMIT !== null && uploaded >= LIMIT) { console.log(`\n--limit ${LIMIT} reached.`); break outer; }
    const result = spawnSync(IA, [
      'upload', item.identifier, file.local,
      `--remote-name=${file.remote}`,
      '--retries=5', '--no-derive', ...META,
    ], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (result.status === 0) {
      uploaded += 1;
      bytesSent += file.bytes;
      if (uploaded % 10 === 0) console.log(`  ${uploaded}/${todo.length}  ${(bytesSent / 1e9).toFixed(2)} GB  (${item.identifier})`);
    } else {
      failed += 1;
      console.error(`  FAIL ${file.remote}: ${(result.stderr || result.stdout || '').trim().slice(0, 200)}`);
    }
  }
}

console.log(`\nuploaded ${uploaded}, failed ${failed}, ${(bytesSent / 1e9).toFixed(2)} GB sent.`);

const sidecar = {
  schemaVersion: 1,
  note: 'Written by scripts/upload-tree-ia.mjs. Counts are from the last run and are not a '
    + 'completeness claim -- re-run with --plan-only to see what is still outstanding.',
  itemPrefix: ITEM_PREFIX,
  existingItems,
  lastRun: { uploaded, failed, gigabytesSent: Number((bytesSent / 1e9).toFixed(2)) },
};
writeFileSync(SIDECAR, `${JSON.stringify(sidecar, null, 2)}\n`);
console.log(`Wrote ${SIDECAR}.`);
if (failed) process.exit(1);
