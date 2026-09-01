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
 * SHARDING. Items are capped by BOTH size and file count; file count usually binds first on
 * catalogues of many small resources. The caps are deliberately GENEROUS (40 GB / 3,000
 * files), because item COUNT is the liability, not item size -- see below.
 *
 * SPAM AVOIDANCE, LEARNED THE HARD WAY (2026-08-31). IA's anti-spam heuristics watch ITEM
 * CREATION, not transfer volume: eight near-identically named items created within a minute
 * got the account flagged ("appears to be spam"), while file PUTs into items that already
 * existed sailed through at full rate. Hence:
 *   - new items are created ONE at a time, --create-interval-min apart (a curator's cadence);
 *   - parallel workers upload only into items that already exist -- ordinary S3 traffic that
 *     at worst draws a retryable 503;
 *   - an ACCOUNT spam flag ("appears to be spam") aborts the whole run (exit 2): every further
 *     request against a flagged account deepens the flag and burns uplink on certain failures.
 *     IA-WIDE congestion ("exceeds global_limit") is a different animal that merely looks the
 *     same -- it pauses and retries, because the account is fine and only waiting helps;
 *   - --avoid skips identifiers a flagged run may have poisoned (e.g. ccby-009,ccby-010).
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
const MAX_ITEM_GB = Number(opt('--max-item-gb', '40'));
const MAX_ITEM_FILES = Number(opt('--max-item-files', '3000'));
const LIMIT = opt('--limit') ? Number(opt('--limit')) : null;
const ONLY_CLASS = opt('--only-class');
const CONCURRENCY = Math.max(1, Number(opt('--concurrency', '4')));
const CREATE_INTERVAL_MS = Number(opt('--create-interval-min', '5')) * 60_000;
const MAX_CONGESTION_WAIT_MS = Number(opt('--max-congestion-wait-min', '180')) * 60_000;
const STALL_MS = Number(opt('--stall-timeout-min', '10')) * 60_000;
const AVOID = new Set(opt('--avoid', '').split(',').map((s) => s.trim()).filter(Boolean));
const PLAN_ONLY = args.includes('--plan-only');
const IA = process.env.IA_CLI || 'ia';
const SIDECAR = opt('--sidecar', 'data/database/ia-tree-mirrors.json');

if (!ROOT || !ITEM_PREFIX || (!MANIFEST && !LICENCES)) {
  console.error('Usage: node scripts/upload-tree-ia.mjs --root <dir> --item-prefix <prefix>');
  console.error('       (--manifest <csv> | --licences <json>)');
  console.error('       [--max-item-gb 40] [--max-item-files 3000] [--limit N] [--only-class slug]');
  console.error('       [--concurrency 4] [--create-interval-min 5] [--avoid id,id] [--plan-only]');
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
  const nextIdentifier = () => {
    let id = `${prefix}${String(next).padStart(3, '0')}`;
    // Skip identifiers a flagged run may have poisoned: their metadata reads as absent, so the
    // probe cannot distinguish them from never-created, but IA may still refuse them.
    // Accepts the full identifier or the short form after the item prefix (e.g. ccby-009).
    while (AVOID.has(id) || AVOID.has(id.slice(ITEM_PREFIX.length))) { next += 1; id = `${prefix}${String(next).padStart(3, '0')}`; }
    next += 1;
    return id;
  };
  for (const file of [...todo].sort((a, b) => b.bytes - a.bytes)) {
    if (!current || current.bytes + file.bytes > MAX_ITEM_GB * 1e9 || current.files.length >= MAX_ITEM_FILES) {
      current = { identifier: nextIdentifier(), files: [], bytes: 0 };
      packed.push(current);
    }
    current.files.push(file);
    current.bytes += file.bytes;
  }
  console.log(`  plan: ${packed.length} new item(s): ${packed.map((i) => i.identifier.slice(ITEM_PREFIX.length)).join(', ')}`);
  plans.push({ info: group.info, items: packed });
}

const plannedFiles = plans.reduce((n, p) => n + p.items.reduce((m, i) => m + i.files.length, 0), 0);
const plannedBytes = plans.reduce((n, p) => n + p.items.reduce((m, i) => m + i.bytes, 0), 0);
console.log(`\nTOTAL: ${plans.reduce((n, p) => n + p.items.length, 0)} new item(s), ${plannedFiles} file(s), ${(plannedBytes / 1e9).toFixed(2)} GB`);

if (PLAN_ONLY) { console.log('\n--plan-only: nothing uploaded.'); process.exit(0); }

// ---- upload ----
// Creation and transfer are DIFFERENT operations to IA's anti-spam heuristics (see docstring):
// one new item is created at a time, spaced CREATE_INTERVAL_MS apart, while the worker pool
// runs file-level parallelism only across items that already exist. Every planned item is new
// (resume packs outstanding files into fresh identifiers), so the pool ramps up as creations
// land: one connection at first, full width once a few items are open.
const itemStates = [];
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
  for (const item of plan.items) itemStates.push({ item, meta, exists: false, creating: false, nextFile: 0 });
}

let uploaded = 0;
let failed = 0;
let bytesSent = 0;
let limitReached = false;
let aborted = false;
let lastCreationAt = 0;
let creationInFlight = false;

// Two very different refusals wear the same "Please reduce your request rate" prefix, and they
// need OPPOSITE responses. Matching both as one condition (as this script first did) misreads
// an IA-wide outage as an account ban:
//   - "appears to be spam" is ACCOUNT-level and stateful. Pushing on deepens it, so abort.
//   - "exceeds global_limit" / "s3 is overloaded" is IA-WIDE congestion affecting every user;
//     our own accesskey_tasks_queued reads 0 while total_tasks_queued sits at the global cap.
//     Nothing is wrong with this account and waiting is the entire remedy, so pause and retry.
const ACCOUNT_FLAG_RE = /appears to be spam/i;
const GLOBAL_BUSY_RE = /exceeds global_limit|s3 is overloaded/i;
// A congested IA also just drops connections. That is transient and must NOT be recorded as a
// content failure: the file is fine and deserves another attempt shortly.
const TRANSIENT_RE = /ConnectionError|ConnectionResetError|forcibly closed|RemoteDisconnected|Read timed out|Max retries exceeded|BrokenPipe/i;
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryQueue = [];
let abortReason = null;
let pausing = false;

// No shell: metadata values contain spaces and parentheses, and cmd.exe would re-split them
// into separate arguments (the win32 shell:true path fails every upload this way).
// CreateProcess resolves the bare name to ia.exe on PATH without a shell's help.
const uploadOne = (identifier, file, meta) => new Promise((resolve) => {
  const child = spawn(IA, [
    'upload', identifier, file.local, `--remote-name=${file.remote}`,
    '--retries=5', '--no-derive', ...meta,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let settled = false;
  let timer = null;
  const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
  // INACTIVITY watchdog, not a total-duration cap: the client streams a progress bar while it
  // works, so silence means wedged, and a big file on a slow link is not punished for being
  // slow. Without this a stalled socket holds a worker forever -- four of them sat blocked for
  // 72 minutes with zero CPU and zero bytes read, and the run looked merely "slow".
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ code: -1, out: `${out}\nlocal watchdog: ConnectionError - no output for ${STALL_MS / 60_000} min, killed` });
    }, STALL_MS);
  };
  child.stdout.on('data', (d) => { out += d; arm(); });
  child.stderr.on('data', (d) => { out += d; arm(); });
  child.on('error', (e) => finish({ code: -1, out: String(e) }));
  child.on('close', (code) => finish({ code, out }));
  arm();
});

// Returns 'ok' | 'busy' | 'retry' | 'fail'. Only 'fail' is counted: it means IA judged this
// FILE unacceptable (corrupt PDF, truncated zip), which no amount of retrying changes.
// 'busy' and 'retry' are conditions of the service, so the caller re-queues the file.
function classify({ code, out }, file, identifier) {
  if (code === 0) {
    uploaded += 1;
    bytesSent += file.bytes;
    if (uploaded % 10 === 0) console.log(`  ${uploaded}/${plannedFiles}  ${(bytesSent / 1e9).toFixed(2)} GB  (${identifier})`);
    return 'ok';
  }
  if (!ACCOUNT_FLAG_RE.test(out)) {
    if (GLOBAL_BUSY_RE.test(out)) return 'busy';
    if (TRANSIENT_RE.test(out)) return 'retry';
  }
  failed += 1;
  // The actual error prints AFTER the tqdm progress bar, so strip bar lines and keep the
  // tail -- slicing the head gives 200 chars of progress bar and hides the reason.
  const reason = out.split(/\r|\n/).filter((l) => l.trim() && !l.includes('%|')).slice(-3).join(' | ');
  console.error(`  FAIL ${file.remote}: ${reason.slice(0, 400)}`);
  if (ACCOUNT_FLAG_RE.test(out)) {
    aborted = true;
    abortReason = 'account flagged as spam';
    console.error('\nABORT: IA flagged this ACCOUNT as spam. Stopping the whole run: every '
      + 'further request deepens the flag. Let it cool before resuming.');
  }
  return 'fail';
}

// IA-wide congestion: poll the documented limit endpoint until the global queue has room.
// Only one waiter polls; the rest idle until it clears.
async function waitForGlobalQueue() {
  if (pausing) {
    while (pausing && !aborted) await sleep(5000);
    return;
  }
  pausing = true;
  const started = Date.now();
  console.log('  PAUSED: IA\'s global ingest queue is full. This is IA-wide, not this account '
    + '-- waiting for it to drain rather than retrying into it.');
  try {
    while (!aborted) {
      await sleep(120_000);
      let queued = null;
      let limit = null;
      try {
        const body = await (await fetch('https://s3.us.archive.org/?check_limit=1')).json();
        queued = Number(body?.detail?.total_tasks_queued);
        limit = Number(body?.detail?.total_global_limit);
      } catch { /* transient; treat as still congested */ }
      if (Number.isFinite(queued) && Number.isFinite(limit) && queued < limit * 0.9) {
        console.log(`  resuming: global queue down to ${queued}/${limit}.`);
        return;
      }
      if (queued !== null) console.log(`  still congested: ${queued}/${limit} queued globally.`);
      if (Date.now() - started > MAX_CONGESTION_WAIT_MS) {
        aborted = true;
        abortReason = 'IA global queue stayed full';
        console.error('  IA\'s global queue stayed full past --max-congestion-wait-min. '
          + 'Stopping; nothing is wrong with this account, so just re-run later.');
        return;
      }
    }
  } finally {
    pausing = false;
  }
}

// Claim one not-yet-taken file: congestion retries first, then any item already on IA.
function claimFile() {
  if (retryQueue.length) return retryQueue.shift();
  for (const st of itemStates) {
    if (st.exists && st.nextFile < st.item.files.length) return { st, file: st.item.files[st.nextFile++] };
  }
  return null;
}

async function createNextItem() {
  if (creationInFlight) return false;
  const st = itemStates.find((s) => !s.exists && !s.creating && s.nextFile < s.item.files.length);
  if (!st) return false;
  st.creating = true;
  creationInFlight = true;
  try {
    // Space creations out; sleep in short slices so an abort elsewhere ends the wait promptly.
    while (Date.now() < lastCreationAt + CREATE_INTERVAL_MS) {
      if (aborted || limitReached) return true;
      await sleep(Math.min(5000, lastCreationAt + CREATE_INTERVAL_MS - Date.now()));
    }
    lastCreationAt = Date.now();
    const idx = st.nextFile++;
    const file = st.item.files[idx];
    console.log(`  creating ${st.item.identifier} (${st.item.files.length} files queued)`);
    const verdict = classify(await uploadOne(st.item.identifier, file, st.meta), file, st.item.identifier);
    if (verdict === 'ok') st.exists = true;
    // Service conditions are not this file's fault: put it back, so creation retries from it
    // rather than silently consuming a file per failed attempt.
    else if (verdict === 'busy') { st.nextFile = idx; await waitForGlobalQueue(); }
    else if (verdict === 'retry') {
      console.log(`  retry creating ${st.item.identifier} (transient)`);
      st.nextFile = idx;
      await sleep(30_000);
    }
    // A genuine content rejection DOES consume the file -- otherwise one corrupt file would
    // block its item's creation forever. The item stays closed and a later attempt uses the
    // next file along.
  } finally {
    st.creating = false;
    creationInFlight = false;
  }
  return true;
}

async function worker() {
  while (!aborted && !limitReached) {
    if (LIMIT !== null && uploaded >= LIMIT) { limitReached = true; break; }
    const claim = claimFile();
    if (claim) {
      const { st, file } = claim;
      const verdict = classify(await uploadOne(st.item.identifier, file, st.meta), file, st.item.identifier);
      if (verdict === 'busy' || verdict === 'retry') {
        file.attempts = (file.attempts || 0) + 1;
        // Say so. Silent retrying is indistinguishable from working, which is exactly how a
        // wedged run passed for a slow one.
        console.log(`  retry ${file.remote} (${verdict}, attempt ${file.attempts}/${MAX_ATTEMPTS})`);
        if (file.attempts < MAX_ATTEMPTS) retryQueue.push({ st, file });
        else {
          failed += 1;
          console.error(`  FAIL ${file.remote}: IA still unavailable after ${MAX_ATTEMPTS} attempts`);
        }
        if (verdict === 'busy') await waitForGlobalQueue();
        else await sleep(30_000);
      }
      continue;
    }
    if (await createNextItem()) continue;
    // Nothing claimable: done, or waiting on the creation in flight to open an item.
    if (!itemStates.some((s) => s.nextFile < s.item.files.length)) break;
    await sleep(5000);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plannedFiles) }, worker));
if (limitReached) console.log(`\n--limit ${LIMIT} reached.`);

console.log(`\nuploaded ${uploaded}, failed ${failed}, ${(bytesSent / 1e9).toFixed(2)} GB sent.`);
writeFileSync(SIDECAR, `${JSON.stringify({
  schemaVersion: 1,
  note: 'Written by scripts/upload-tree-ia.mjs. Counts are from the last run and are not a '
    + 'completeness claim -- re-run with --plan-only to see what is still outstanding.',
  itemPrefix: ITEM_PREFIX,
  classes: plans.map((p) => ({ licence: p.info.name, items: p.items.map((i) => i.identifier) })),
  skipped: { packages: skipped.packages, files: skipped.files, gigabytes: Number((skipped.bytes / 1e9).toFixed(2)) },
  lastRun: { uploaded, failed, gigabytesSent: Number((bytesSent / 1e9).toFixed(2)), aborted, abortReason },
}, null, 2)}\n`);
console.log(`Wrote ${SIDECAR}.`);
if (aborted) process.exit(2);
if (failed) process.exit(1);
