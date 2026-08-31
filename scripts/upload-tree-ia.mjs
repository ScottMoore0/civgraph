#!/usr/bin/env node
/**
 * Mirror a downloaded open-data tree to the Internet Archive, resumably, in licence-correct
 * chunks.
 *
 * WHY IA AND NOT R2
 *
 * R2 costs money per GB-month and dies with the Cloudflare account. IA is free, permanent and
 * citable. For bulk raw material nothing fetches at runtime, IA is the better home -- see
 * data/database/corpus-index.json, which records which corpus lives where.
 *
 * TWO MODES, AND THE DIFFERENCE MATTERS
 *
 * --item-prefix   ONE licence for the whole tree. Correct for Open Data NI, where everything
 *                 is Crown copyright under OGL v3.0, so a single licenceurl on every item is
 *                 accurate.
 *
 * --licences      LICENCE PER PACKAGE. Required for data.gov.ie, which federates other bodies'
 *                 data: the licence belongs to each publishing organisation and varies. Files
 *                 are grouped by licence class FIRST and packed into items within each class,
 *                 so every item carries the right licenceurl and is self-describing -- someone
 *                 downloading civgraph-datagovie-ccby-017 knows the terms without asking
 *                 anything else. Stamping one licence across the whole corpus would
 *                 misattribute ~20,000 packages, which is why this mode exists.
 *
 *                 Packages whose licence is not recognised as open are SKIPPED and counted,
 *                 never guessed. For the data.gov.ie mirror that is 791 resources / 31.9 GB:
 *                 645 recording no licence at all and 69 carrying cc-by-nc-nd. IA is MORE
 *                 exposed than R2, not less -- items are indexed, searchable and attributed to
 *                 the uploader -- so material without an established basis must not go here.
 *
 * RESUMABILITY IS BY REMOTE STATE, NOT A LOCAL LEDGER. Before uploading, every existing item's
 * file list is read from the IA metadata API and used to skip what is already there. A local
 * progress file would drift the moment a run died mid-upload, and these jobs run for hours so
 * they will be interrupted. Item indexes are probed upward rather than assumed, because an
 * existing set can be sparse.
 *
 * NAMING. Local layout is <organisation>/<package>/<file>; items use <package>/<file>. The
 * package slug is the stable identifier -- organisations get renamed and merged -- and it is
 * derivable from both sides, so it is also the dedup key.
 *
 * SHARDING. Items are capped by BOTH size and file count. File count usually binds first: the
 * data.gov.ie CC-BY class is 121 GB but 28,737 files, so at 700 files per item it needs 42
 * items rather than the 5 its size implies. Raise --max-item-files to trade item count for
 * item size.
 *
 *   # one licence for the tree (Open Data NI)
 *   node scripts/upload-tree-ia.mjs --manifest <mirror>/_manifest.csv --root <mirror> \
 *        --item-prefix civgraph-opendatani-data- --plan-only
 *
 *   # licence per package (data.gov.ie)
 *   node scripts/upload-tree-ia.mjs --root <mirror> --licences data/external/datagovie-licences.json \
 *        --item-prefix civgraph-datagovie- --plan-only
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const MANIFEST = opt('--manifest');
const ROOT = opt('--root');
const ITEM_PREFIX = opt('--item-prefix');
const LICENCES = opt('--licences');
const MAX_ITEM_GB = Number(opt('--max-item-gb', '25'));
const MAX_ITEM_FILES = Number(opt('--max-item-files', '700'));
const LIMIT = opt('--limit') ? Number(opt('--limit')) : null;
const ONLY_CLASS = opt('--only-class');
const CONCURRENCY = Math.max(1, Number(opt('--concurrency', '8')));
const PLAN_ONLY = args.includes('--plan-only');
const IA = process.env.IA_CLI || 'ia';
const SIDECAR = opt('--sidecar', 'data/database/ia-tree-mirrors.json');

if (!ROOT || !ITEM_PREFIX || (!MANIFEST && !LICENCES)) {
  console.error('Usage: node scripts/upload-tree-ia.mjs --root <dir> --item-prefix <prefix>');
  console.error('       (--manifest <csv> | --licences <json>)');
  console.error('       [--max-item-gb 25] [--max-item-files 700] [--limit N] [--only-class slug]');
  console.error('       [--concurrency 8] [--plan-only]');
  console.error('  Paths are passed in: the mirror lives outside the repo.');
  process.exit(1);
}

/**
 * Licence classes recognised as open, with the item-slug and licenceurl each gets. A CKAN
 * license_id absent from here is NOT published: an unrecognised licence is the whole reason
 * this table exists, and guessing one would put somebody else's terms on a public item.
 */
const CLASSES = new Map([
  ['cc-by', { slug: 'ccby', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }],
  ['cc-by-4.0', { slug: 'ccby', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }],
  ['cc-by-sa', { slug: 'ccbysa', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
  ['cc-by-sa-4.0', { slug: 'ccbysa', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
  ['cc-zero', { slug: 'cc0', name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }],
  ['cc0-1.0', { slug: 'cc0', name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }],
  ['odc-by', { slug: 'odcby', name: 'ODC-By 1.0', url: 'https://opendatacommons.org/licenses/by/1-0/' }],
  ['odc-pddl', { slug: 'odcpddl', name: 'ODC-PDDL 1.0', url: 'https://opendatacommons.org/licenses/pddl/1-0/' }],
  ['odc-odbl', { slug: 'odbl', name: 'ODbL 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' }],
  ['uk-ogl', { slug: 'ogl', name: 'OGL v3.0', url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/' }],
  ['ogl', { slug: 'ogl', name: 'OGL v3.0', url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/' }],
]);

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

// ---- collect the local files, and the licence class each belongs to ----
const groups = new Map(); // classSlug -> { info, files[] }
const skipped = { packages: 0, files: 0, bytes: 0, reasons: new Map() };

function addFile(classInfo, local, pkg, name) {
  const key = classInfo ? classInfo.slug : null;
  const bytes = statSync(local).size;
  if (!key) {
    skipped.files += 1;
    skipped.bytes += bytes;
    return;
  }
  if (!groups.has(key)) groups.set(key, { info: classInfo, files: [] });
  groups.get(key).files.push({ local, remote: `${pkg}/${name}`, bytes, package: pkg });
}

if (LICENCES) {
  const licences = JSON.parse(readFileSync(LICENCES, 'utf8')).packages || {};
  for (const org of readdirSync(ROOT, { withFileTypes: true })) {
    if (!org.isDirectory()) continue;
    for (const pkg of readdirSync(`${ROOT}/${org.name}`, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const record = licences[pkg.name];
      const id = (record?.licenceId || '').toLowerCase();
      const classInfo = CLASSES.get(id) || null;
      if (!classInfo) {
        skipped.packages += 1;
        const reason = record?.licenceId || (record ? '(none recorded)' : '(not harvested)');
        skipped.reasons.set(reason, (skipped.reasons.get(reason) || 0) + 1);
      }
      const walk = (dir) => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          if (item.isDirectory()) walk(`${dir}/${item.name}`);
          else addFile(classInfo, `${dir}/${item.name}`, pkg.name, item.name);
        }
      };
      walk(`${ROOT}/${org.name}/${pkg.name}`);
    }
  }
} else {
  const DONE = new Set(['ok', 'done', 'complete', 'completed', 'success']);
  const rows = parseCsv(readFileSync(MANIFEST, 'utf8')).filter((r) => DONE.has((r.status || '').toLowerCase()));
  // Single-licence mode: the caller asserts the whole tree shares one licence, so the class is
  // unnamed and the item prefix is used verbatim.
  const single = { slug: '', name: opt('--licence-name', 'OGL v3.0'), url: opt('--licence-url', CLASSES.get('ogl').url) };
  for (const row of rows) {
    const target = (row.target_path || '').replace(/\\/g, '/');
    if (!target || !row.package_name) { skipped.files += 1; continue; }
    const local = path.resolve(ROOT, target);
    if (!existsSync(local)) { skipped.files += 1; continue; }
    addFile(single, local, row.package_name, path.basename(target));
  }
}

const totalFiles = [...groups.values()].reduce((n, g) => n + g.files.length, 0);
console.log(`local: ${totalFiles} file(s) across ${groups.size} licence class(es).`);
if (skipped.files) {
  console.log(`skipped: ${skipped.files} file(s), ${(skipped.bytes / 1e9).toFixed(2)} GB from ${skipped.packages} package(s) with no recognised open licence`);
  for (const [reason, n] of [...skipped.reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }
}

// ---- what IA already holds ----
async function itemFiles(identifier) {
  const response = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!response.ok) return null;
  const body = await response.json();
  if (!body || !body.files) return null;
  return body.files
    .filter((f) => !String(f.name || '').startsWith('__ia') && !String(f.name || '').startsWith(identifier))
    .map((f) => f.name);
}

async function existingFor(prefix) {
  const present = new Set();
  const items = [];
  let index = 1;
  let misses = 0;
  while (misses < 4 && index < 400) {
    const identifier = `${prefix}${String(index).padStart(3, '0')}`;
    const files = await itemFiles(identifier);
    if (files === null || files.length === 0) misses += 1;
    else { misses = 0; items.push({ identifier, files: files.length }); for (const n of files) present.add(n); }
    index += 1;
  }
  const highest = items.length ? Math.max(...items.map((i) => Number(i.identifier.slice(-3)))) : 0;
  return { present, items, highest };
}

const plans = [];
for (const [slug, group] of groups) {
  // Class scoping serves smoke tests: packing is largest-file-first, so a bare --limit N
  // would send the N biggest files of the first class rather than a small representative slice.
  if (ONLY_CLASS && slug !== ONLY_CLASS) continue;
  const prefix = slug ? `${ITEM_PREFIX}${slug}-` : ITEM_PREFIX;
  const { present, items, highest } = await existingFor(prefix);
  const todo = group.files.filter((f) => !present.has(f.remote));
  console.log(`\n[${group.info.name}] prefix ${prefix}`);
  console.log(`  existing: ${items.length} item(s), ${present.size} file(s); highest ${highest}`);
  console.log(`  to upload: ${todo.length} file(s), ${(todo.reduce((s, f) => s + f.bytes, 0) / 1e9).toFixed(2)} GB`);
  if (!todo.length) continue;

  const packed = [];
  let current = null;
  let next = highest + 1;
  for (const file of [...todo].sort((a, b) => b.bytes - a.bytes)) {
    if (!current || current.bytes + file.bytes > MAX_ITEM_GB * 1e9 || current.files.length >= MAX_ITEM_FILES) {
      current = { identifier: `${prefix}${String(next).padStart(3, '0')}`, files: [], bytes: 0 };
      next += 1;
      packed.push(current);
    }
    current.files.push(file);
    current.bytes += file.bytes;
  }
  console.log(`  plan: ${packed.length} new item(s)`);
  plans.push({ info: group.info, items: packed });
}

const plannedFiles = plans.reduce((n, p) => n + p.items.reduce((m, i) => m + i.files.length, 0), 0);
const plannedBytes = plans.reduce((n, p) => n + p.items.reduce((m, i) => m + i.bytes, 0), 0);
console.log(`\nTOTAL: ${plans.reduce((n, p) => n + p.items.length, 0)} new item(s), ${plannedFiles} file(s), ${(plannedBytes / 1e9).toFixed(2)} GB`);

if (PLAN_ONLY) { console.log('\n--plan-only: nothing uploaded.'); process.exit(0); }

// ---- upload ----
// IA throttles per CONNECTION (~360 KB/s measured), not per account or per line, so the pool
// is what makes a 123 GB corpus take hours instead of days. Workers claim whole ITEMS, never
// individual files, so no two processes ever write to the same item concurrently.
const itemQueue = [];
for (const plan of plans) {
  const meta = [
    `--metadata=title:${opt('--title', 'Open data mirror')} (${plan.info.name})`,
    `--metadata=licenseurl:${plan.info.url}`,
    // opensource, not opensource_data: this account lacks write access to opensource_data
    // (every PUT transfers fully, then dies with Access Denied), and the existing
    // civgraph-opendatani-data items live in opensource with mediatype data.
    '--metadata=collection:opensource',
    '--metadata=mediatype:data',
  ];
  for (const item of plan.items) itemQueue.push({ item, meta });
}

let uploaded = 0;
let failed = 0;
let bytesSent = 0;
let limitReached = false;

// No shell: metadata values contain spaces and parentheses, and cmd.exe would re-split them
// into separate arguments (the win32 shell:true path fails every upload this way).
// CreateProcess resolves the bare name to ia.exe on PATH without a shell's help.
const uploadOne = (identifier, file, meta) => new Promise((resolve) => {
  const child = spawn(IA, [
    'upload', identifier, file.local, `--remote-name=${file.remote}`,
    '--retries=5', '--no-derive', ...meta,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('error', (e) => resolve({ code: -1, out: String(e) }));
  child.on('close', (code) => resolve({ code, out }));
});

async function worker() {
  while (itemQueue.length && !limitReached) {
    const { item, meta } = itemQueue.shift();
    for (const file of item.files) {
      if (LIMIT !== null && uploaded >= LIMIT) { limitReached = true; return; }
      const { code, out } = await uploadOne(item.identifier, file, meta);
      if (code === 0) {
        uploaded += 1;
        bytesSent += file.bytes;
        if (uploaded % 10 === 0) console.log(`  ${uploaded}/${plannedFiles}  ${(bytesSent / 1e9).toFixed(2)} GB  (${item.identifier})`);
      } else {
        failed += 1;
        console.error(`  FAIL ${file.remote}: ${out.trim().slice(0, 200)}`);
      }
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, itemQueue.length) }, worker));
if (limitReached) console.log(`\n--limit ${LIMIT} reached.`);

console.log(`\nuploaded ${uploaded}, failed ${failed}, ${(bytesSent / 1e9).toFixed(2)} GB sent.`);
writeFileSync(SIDECAR, `${JSON.stringify({
  schemaVersion: 1,
  note: 'Written by scripts/upload-tree-ia.mjs. Counts are from the last run and are not a '
    + 'completeness claim -- re-run with --plan-only to see what is still outstanding.',
  itemPrefix: ITEM_PREFIX,
  classes: plans.map((p) => ({ licence: p.info.name, items: p.items.map((i) => i.identifier) })),
  skipped: { packages: skipped.packages, files: skipped.files, gigabytes: Number((skipped.bytes / 1e9).toFixed(2)) },
  lastRun: { uploaded, failed, gigabytesSent: Number((bytesSent / 1e9).toFixed(2)) },
}, null, 2)}\n`);
console.log(`Wrote ${SIDECAR}.`);
if (failed) process.exit(1);
