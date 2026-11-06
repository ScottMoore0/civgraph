#!/usr/bin/env node
/**
 * npm run records:deploy -- load the local records build into D1 by delta, then verify.
 *
 *   node scripts/records/deploy-records.mjs --local  [--dry-run] [--full] [--resync] [--direct]
 *   node scripts/records/deploy-records.mjs --remote [--dry-run] [--full] [--resync] [--start-part N]
 *                                                                          (approved publish only)
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
 *      (every statement is idempotent, so a part can be re-run). --local --direct applies the
 *      same statements straight to the local D1's SQLite file instead (a full local load of
 *      four million rows through wrangler takes hours; the statements are the same).
 *   6. verify-load through wrangler; on PASS the build becomes the last-loaded snapshot
 *   --resync skips 3-5: verify, and on PASS reset the snapshot.
 *
 * The R2 variables are removed from wrangler's environment, and its output goes to a file.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildDelta, estimateWrites, printSummary } from './diff-load.mjs';
import { REPO_ROOT } from './paths.mjs';
import { D1_NAME, PERSIST_DIR, WRANGLER, d1Env, verify } from './verify-load.mjs';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const local = args.includes('--local');
const dryRun = args.includes('--dry-run');
const full = args.includes('--full');
const resync = args.includes('--resync');
const direct = args.includes('--direct');
// Resume a load that stopped part-way: skip the parts numbered below N. The parts of the same
// build are the same files each time (the delta is deterministic), and every statement is
// idempotent, so resuming at the part that failed is the same as rerunning the whole delta.
const startPart = args.includes('--start-part') ? Number(args[args.indexOf('--start-part') + 1]) : 0;

const BUILD = path.join(REPO_ROOT, 'tmp', 'records', 'civgraph-records.sqlite');
const LAST = remote
  ? path.join(REPO_ROOT, '.claude', 'publish', 'work', 'last-loaded.sqlite')
  : path.join(REPO_ROOT, 'tmp', 'records', 'last-loaded-local.sqlite');
const PARTS = path.join(REPO_ROOT, 'tmp', 'records', 'delta');
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
  closeSync(fd);
  return { result, files };
}

/** The local D1's SQLite file: the one whose migrations list 0001_records.sql. */
export function localD1File(persistDir = path.join(REPO_ROOT, PERSIST_DIR)) {
  const dir = path.join(persistDir, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const candidates = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : [];
  for (const f of candidates) {
    const db = new DatabaseSync(path.join(dir, f), { readOnly: true });
    try {
      const row = db.prepare("SELECT 1 AS ok FROM d1_migrations WHERE name = '0001_records.sql'").get();
      if (row) return path.join(dir, f);
    } catch { /* not this one */ } finally { db.close(); }
  }
  return null;
}

async function main() {
  if (!existsSync(BUILD)) throw new Error('no build: run npm run records:build first');
  mkdirSync(path.dirname(LAST), { recursive: true });

  if (dryRun) {
    // A dry run changes nothing, migrations included: it only lists what a real run would apply.
    const list = wrangler(['d1', 'migrations', 'list', D1_NAME, ...target], 'migrations.log');
    if (list.status !== 0) throw new Error(`migrations list failed:\n${list.text.slice(-1500)}`);
    const pending = list.text.match(/\d{4}_[\w-]+\.sql/g) || [];
    log(pending.length ? `migrations a real run would apply: ${[...new Set(pending)].join(', ')}` : 'no migrations to apply');
  } else {
    const mig = wrangler(['d1', 'migrations', 'apply', D1_NAME, ...target], 'migrations.log');
    if (mig.status !== 0) throw new Error(`migrations apply failed:\n${mig.text.slice(-1500)}`);
    log('migrations applied');
  }

  if (remote && !dryRun) {
    const tt = wrangler(['d1', 'time-travel', 'info', D1_NAME, '--json'], 'tt.json');
    if (tt.status === 0) appendFileSync(path.join(REPO_ROOT, '.claude', 'publish', 'work', 'bookmarks.log'), `${new Date().toISOString()} ${tt.text.replace(/\s+/g, ' ').trim()}\n`);
    log('time-travel bookmark recorded');
  }

  if (!resync) {
    const fromFile = full || !existsSync(LAST) ? null : LAST;
    const { result, files } = writeParts(fromFile);
    printSummary(result, `${path.relative(REPO_ROOT, PARTS)} (${files.length} part${files.length === 1 ? '' : 's'})`);
    const { rows, writes } = estimateWrites(result.summary);
    if (dryRun) {
      console.log(`DRY RUN: civgraph-records would apply ${result.statements} statements (${rows} rows, about ${writes} row writes, ${files.length} part(s), ${result.full ? 'full load' : 'delta'}) to ${remote ? 'remote' : 'local'} D1`);
      return;
    }
    if (local && direct) {
      const file = localD1File();
      if (!file) throw new Error('no local D1 with the records migrations: run migrations apply first');
      const db = new DatabaseSync(file);
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;');
      for (const part of files) db.exec(readFileSync(part, 'utf8'));
      db.close();
      log(`delta applied directly to ${path.relative(REPO_ROOT, file)} (${result.statements} statements)`);
    } else {
      if (startPart) log(`resuming at part ${String(startPart).padStart(4, '0')} (parts below it were applied by an earlier run)`);
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
        log(`${path.basename(part)} applied`);
      }
    }
    log(`delta applied (${result.statements} statements)`);
  }

  const mismatches = verify({ file: BUILD, remote });
  if (mismatches.length) {
    for (const m of mismatches) console.error(`  ${m}`);
    throw new Error('verify failed: the last-loaded snapshot is left as it was');
  }
  copyFileSync(BUILD, LAST);
  log(`PASS: ${remote ? 'remote' : 'local'} D1 verified; ${path.relative(REPO_ROOT, LAST)} updated`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'deploy-records.mjs') {
  if (remote === local) {
    console.error('say --local or --remote');
    process.exit(1);
  }
  if (remote && direct) {
    console.error('--direct is local only');
    process.exit(1);
  }
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  });
}
