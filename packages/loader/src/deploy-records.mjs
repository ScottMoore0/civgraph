#!/usr/bin/env node
/**
 * npm run records:deploy -- load the local records build into D1 by delta, then verify.
 *
 *   node scripts/records/deploy-records.mjs --local  [--dry-run] [--full] [--resync] [--direct] [--bounded]
 *   node scripts/records/deploy-records.mjs --remote [--dry-run] [--full] [--start-part N]
 *                                                                          (approved publish only)
 *   node scripts/records/deploy-records.mjs --remote --resync --full-verify  (quiet hours only)
 *
 * The database is the one wrangler.toml binds as ELECTIONS_DB (verify-load.mjs D1_NAME).
 *
 *   1. migrations: wrangler d1 migrations apply (local: --persist-to .wrangler/state)
 *   2. remote only: a Time Travel bookmark appended to .claude/publish/work/bookmarks.log
 *   3. the delta against the last-loaded snapshot (remote: .claude/publish/work/last-loaded.sqlite,
 *      local: tmp/records/last-loaded-local.sqlite); --full diffs against nothing. It is written in
 *      parts of at most 50 MB (tmp/records/delta/NNNN.sql), each a run of whole statements.
 *   4. --dry-run: print "DRY RUN: civgraph-records would apply N statements (...)" and stop
 *      (publish.sh greps the ^DRY RUN prefix)
 *   5. each part through wrangler d1 execute --file, in order, retried up to 4 times 90 s apart
 *      (every statement is idempotent, so a part can be re-run). tmp/records/deploy-run-<target>.json
 *      records the build, the snapshot and how many parts D1 has taken, and --start-part N is
 *      refused unless they are the stopped load's and N is no further than it got. --local --direct applies the
 *      same statements straight to the local D1's SQLite file instead (a full local load of
 *      four million rows through wrangler takes hours; the statements are the same).
 *   6. verify-load through wrangler; on PASS the build becomes the last-loaded snapshot. Remote
 *      (and local with --bounded) it is the BOUNDED check: only the tables the delta touched, the
 *      rows it wrote looked up by primary key in batches, small tables counted under a LIMIT, one
 *      statement per wrangler call with a pause, 7429 retried with backoff (verify-load.mjs). It
 *      never scans a table of the live database. --full-verify scans every table instead: quiet
 *      hours only, never from the publish.
 *   --resync skips 3-5: verify, and on PASS reset the snapshot. Remote it requires --full-verify
 *      (with no delta there is nothing bounded to check), so it is a quiet-hours step; it cannot
 *      be a dry run.
 *
 * The steps are the state machine of deploy-plan.mjs: each step moves the run, and a move out of
 * turn throws, so the snapshot cannot be replaced before a PASS or anything applied in a dry run.
 *
 * The R2 variables are removed from wrangler's environment, and its output goes to a file.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { openSqliteHandle } from '../../storage/src/sqlite.mjs';
import { deployModeErrors, deployRun, parseDeployArgs, resumeCheck } from './deploy-plan.mjs';
import { buildDelta, estimateWrites, printSummary } from './diff-load.mjs';
import { RECORDS_DB, REPO_ROOT } from './paths.mjs';
import { D1_NAME, PERSIST_DIR, WRANGLER, boundedPlan, d1Env, verify } from './verify-load.mjs';

// The options, their checks and the order of the steps are deploy-plan.mjs's state machine.
// --start-part N resumes a load that stopped part-way: the parts of the same build are the same
// files each time (the delta is deterministic), and every statement is idempotent, so resuming at
// the part that failed is the same as rerunning the whole delta.
const mode = parseDeployArgs(process.argv.slice(2));
const { remote, local, dryRun, full, resync, direct, startPart } = mode;
const verifyMode = mode.verify;

const BUILD = RECORDS_DB;
const LAST = remote
  ? path.join(REPO_ROOT, '.claude', 'publish', 'work', 'last-loaded.sqlite')
  : path.join(REPO_ROOT, 'tmp', 'records', 'last-loaded-local.sqlite');
const PARTS = path.join(REPO_ROOT, 'tmp', 'records', 'delta');
// The cursor of a load through wrangler (deploy-plan.mjs LoadRecord), outside PARTS so a dry run,
// which rewrites the parts, leaves the record of a stopped load in place.
const RUN_FILE = path.join(REPO_ROOT, 'tmp', 'records', `deploy-run-${remote ? 'remote' : 'local'}.json`);
const PART_BYTES = 50 * 1024 * 1024;
const target = remote ? ['--remote'] : ['--local', '--persist-to', PERSIST_DIR];
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

function wrangler(cmdArgs, outName) {
  const outFile = path.join(REPO_ROOT, 'tmp', 'records', outName);
  const fd = openSync(outFile, 'w');
  const res = spawnSync(process.execPath, [WRANGLER, ...cmdArgs], { cwd: REPO_ROOT, env: d1Env(), stdio: ['ignore', fd, fd] });
  closeSync(fd);
  return { status: res.status, text: readFileSync(outFile, 'utf8') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The delta as numbered part files of whole statements. */
function writeParts(fromFile) {
  rmSync(PARTS, { recursive: true, force: true });
  mkdirSync(PARTS, { recursive: true });
  const files = [];
  let fd = null;
  let bytes = 0;
  const open = () => {
    if (fd !== null) closeSync(fd);
    const file = path.join(PARTS, `${String(files.length).padStart(4, '0')}.sql`);
    files.push(file);
    fd = openSync(file, 'w');
    bytes = 0;
  };
  open();
  const result = buildDelta({
    toFile: BUILD,
    fromFile,
    write: (statement) => {
      const len = Buffer.byteLength(statement);
      if (bytes && bytes + len > PART_BYTES) open();
      writeSync(fd, statement);
      bytes += len;
    },
  });
  if (fd !== null) closeSync(fd);
  return { result, files };
}

/** A records database's dataset version ('' when it has none). */
function datasetVersion(file) {
  const db = openSqliteHandle(file, { readOnly: true });
  try {
    return String(db.prepare("SELECT value FROM dataset WHERE key = 'version'").get()?.value ?? '');
  } catch {
    return '';
  } finally {
    db.close();
  }
}

/** @returns {import('./deploy-plan.mjs').LoadRecord|null} */
function readRunRecord() {
  try { return JSON.parse(readFileSync(RUN_FILE, 'utf8')); } catch { return null; }
}

/** The local D1's SQLite file: the one whose migrations list 0001_records.sql. */
export function localD1File(persistDir = path.join(REPO_ROOT, PERSIST_DIR)) {
  const dir = path.join(persistDir, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const candidates = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : [];
  for (const f of candidates) {
    const db = openSqliteHandle(path.join(dir, f), { readOnly: true });
    try {
      const row = db.prepare("SELECT 1 AS ok FROM d1_migrations WHERE name = '0001_records.sql'").get();
      if (row) return path.join(dir, f);
    } catch { /* not this one */ } finally { db.close(); }
  }
  return null;
}

async function main() {
  const run = deployRun(mode);
  try {
    await steps(run);
  } catch (error) {
    run.to('failed');
    throw error;
  }
}

/** @param {import('./deploy-plan.mjs').DeployRun} run */
async function steps(run) {
  if (!existsSync(BUILD)) throw new Error('no build: run npm run records:build first');
  mkdirSync(path.dirname(LAST), { recursive: true });

  if (dryRun) {
    // A dry run changes nothing, migrations included: it only lists what a real run would apply.
    // Listing them reads D1. When that fails (wrangler not signed in, no network) the dry run still
    // reports the delta, which comes from the build and the snapshot alone, and says it could not list.
    const list = wrangler(['d1', 'migrations', 'list', D1_NAME, ...target], 'migrations.log');
    if (list.status !== 0) {
      const plain = list.text.replace(/\x1b\[[0-9;]*m/g, '');
      const reason = (plain.match(/\[ERROR\][^\n]*(?:\n\s*\n?[^\n]*)?/) || [plain.trim().split('\n').slice(-1)[0] || ''])[0]
        .replace(/\s+/g, ' ').trim();
      log(`WARNING: could not list the migrations a real run would apply (${reason.slice(0, 220)}); see tmp/records/migrations.log`);
    } else {
      const pending = list.text.match(/\d{4}_[\w-]+\.sql/g) || [];
      log(pending.length ? `migrations a real run would apply: ${[...new Set(pending)].join(', ')}` : 'no migrations to apply');
    }
    run.to('migrations-listed');
  } else {
    const mig = wrangler(['d1', 'migrations', 'apply', D1_NAME, ...target], 'migrations.log');
    if (mig.status !== 0) throw new Error(`migrations apply failed:\n${mig.text.slice(-1500)}`);
    log('migrations applied');
    run.to('migrated');
  }

  if (remote && !dryRun) {
    const tt = wrangler(['d1', 'time-travel', 'info', D1_NAME, '--json'], 'tt.json');
    if (tt.status === 0) appendFileSync(path.join(REPO_ROOT, '.claude', 'publish', 'work', 'bookmarks.log'), `${new Date().toISOString()} ${tt.text.replace(/\s+/g, ' ').trim()}\n`);
    log('time-travel bookmark recorded');
    run.to('bookmarked');
  }

  // The snapshot D1 held before this load: the bounded verify checks the rows between it and
  // the build. Null for a full load (every table is then sampled).
  const fromFile = full || !existsSync(LAST) ? null : LAST;
  if (!resync) {
    const { result, files } = writeParts(fromFile);
    run.to(dryRun ? 'delta-previewed' : 'delta-written');
    printSummary(result, `${path.relative(REPO_ROOT, PARTS)} (${files.length} part${files.length === 1 ? '' : 's'})`);
    const { rows, writes } = estimateWrites(result.summary);
    if (dryRun) {
      if (verifyMode === 'bounded') {
        const plan = boundedPlan({ file: BUILD, since: fromFile });
        log(`a real run would verify with ${plan.steps.length} bounded statement(s), one per wrangler call`);
      }
      run.to('dry-run-reported');
      console.log(`DRY RUN: civgraph-records would apply ${result.statements} statements (${rows} rows, about ${writes} row writes, ${files.length} part(s), ${result.full ? 'full load' : 'delta'}) to ${remote ? 'remote' : 'local'} D1`);
      return;
    }
    if (local && direct) {
      const file = localD1File();
      if (!file) throw new Error('no local D1 with the records migrations: run migrations apply first');
      const db = openSqliteHandle(file);
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;');
      for (const part of files) db.exec(readFileSync(part, 'utf8'));
      db.close();
      log(`delta applied directly to ${path.relative(REPO_ROOT, file)} (${result.statements} statements)`);
    } else {
      /** @type {Omit<import('./deploy-plan.mjs').LoadRecord, 'applied'>} */
      const current = { target: remote ? 'remote' : 'local', build: datasetVersion(BUILD), from: fromFile ? datasetVersion(fromFile) : null, parts: files.length };
      const resume = resumeCheck({ startPart, previous: readRunRecord(), current });
      for (const w of resume.warnings) log(`WARNING: ${w}`);
      if (resume.errors.length) throw new Error(resume.errors.join('; '));
      if (startPart) log(`resuming at part ${String(startPart).padStart(4, '0')} (parts below it were applied by an earlier run)`);
      const record = (/** @type {number} */ applied) => writeFileSync(RUN_FILE, `${JSON.stringify({ ...current, applied }, null, 2)}\n`);
      record(startPart);
      for (const part of files.slice(startPart)) {
        let ok = false;
        for (let attempt = 1; attempt <= 4 && !ok; attempt += 1) {
          const exec = wrangler(['d1', 'execute', D1_NAME, ...target, `--file=${path.relative(REPO_ROOT, part)}`, '--yes'], 'execute.log');
          ok = exec.status === 0;
          if (!ok) {
            console.error(`${path.basename(part)} attempt ${attempt} failed: ${exec.text.slice(-600)}`);
            if (attempt < 4) await sleep(remote ? 90_000 : 2_000);
          }
        }
        if (!ok) throw new Error(`${path.basename(part)} could not be applied; the statements are idempotent, so rerun the deploy (add --start-part ${Number(path.basename(part, '.sql'))} to resume there)`);
        record(Number(path.basename(part, '.sql')) + 1);
        log(`${path.basename(part)} applied`);
      }
    }
    log(`delta applied (${result.statements} statements)`);
    run.to('applied');
  }

  const mismatches = verify({ file: BUILD, remote, mode: verifyMode, since: resync ? null : fromFile });
  if (mismatches.length) {
    for (const m of mismatches) console.error(`  ${m}`);
    throw new Error('verify failed: the last-loaded snapshot is left as it was');
  }
  run.to('verified');
  copyFileSync(BUILD, LAST);
  run.to('snapshotted');
  log(`PASS: ${remote ? 'remote' : 'local'} D1 verified; ${path.relative(REPO_ROOT, LAST)} updated`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'deploy-records.mjs') {
  const errors = deployModeErrors(mode);
  if (errors.length) {
    console.error(errors[0]);
    process.exit(1);
  }
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  });
}
