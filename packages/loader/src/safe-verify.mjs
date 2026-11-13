#!/usr/bin/env node
/**
 * npm run records:verify:safe -- --remote
 *
 * Does the live D1 (civgraph-records, the ELECTIONS_DB binding) hold the local records build, checked
 * without hurting live traffic? On 2026-11-06 at 21:07 a remote verify ran 47 whole-table checksums
 * (COUNT(*) + SUM(row_hash_n)) against the live database: D1 answered 7429 ("overloaded") and
 * production /_api answered 500/503 for about two minutes. This check reads the live database only
 * in small, named, throttled pieces, and stops at the first sign of trouble.
 *
 * 1. Cheap checks first: the dataset rows (version, the table counts and checksums the build
 *    recorded, the loading flag; LIMIT 100), the schema (sqlite_master, LIMIT 1000; compared as a
 *    hash and by name) and the bounds: per table, whether D1 has a row below the build's first key
 *    or above its last (two index seeks of one row each, five tables per statement: D1 refuses a
 *    compound SELECT of more terms). A difference
 *    here fails at once and nothing else is read: the ranges could not match. About 400 rows read.
 * 2. Bounded range checksums. Every table of the local build is cut into ranges of its primary key
 *    (at most --range-rows rows, default 10,000, and about --range-bytes of row data, default
 *    8 MB, so the wide tables get more, smaller ranges). The first range is open below and the last
 *    open above, so with the bounds check the ranges account for every row. A range is checked with
 *        SELECT COUNT(*), SUM(row_hash_n) FROM (SELECT row_hash_n FROM t WHERE pk >= lo AND pk < hi LIMIT rows+1)
 *    (row values for a composite key), the same statement on the local build and on D1: a primary-key
 *    index range read, never more than rows+1 rows whatever D1 holds. Before any statement is sent
 *    its plan is read locally (EXPLAIN QUERY PLAN on the build, whose schema step 1 proved equal):
 *    a statement that would SCAN a table is refused, except a whole small table under its LIMIT.
 * 3. Which ranges: by default every small table whole (one range: an exact count and checksum), up
 *    to --delta-ranges of the ranges the last delta touched (below; default 30, drawn at random;
 *    `all` for every one) and --sample random ranges (default 20; --seed repeats a draw). --full
 *    walks every range, slowly. A mismatching range is drilled (--drill, default 3 ranges): its keys
 *    and row hashes are listed on both sides and the differing keys named.
 * 4. Delta-aware: the keys the last delta wrote, from (first match wins) --since FILE (diffed like
 *    diff-load.mjs), the last-loaded snapshot when it is not yet this build (a load that has not
 *    passed verify), or the delta's SQL parts in tmp/records/delta when they were written for this
 *    build (they stay after a publish). Each touched key marks its range.
 * 5. Throttled: one statement at a time (concurrency 1, one wrangler call each), --pause-ms between
 *    them (default 2,000 remote), doubled whenever D1 reports a statement took over a second. A
 *    rows_read budget per run (--budget, default 1,000,000; D1's own meta.rows_read, or the
 *    estimate where D1 does not report it: twice a range's rows, as D1 counts an index read): the
 *    next range is not sent if it could pass the budget. A statement that reads over 4x its
 *    estimate (+1,000) stops the run. Any 7429 stops the run at
 *    once (--overload-retries N to wait and retry instead: 60 s, then doubling); a 7403 (Cloudflare's
 *    transient authorisation refusal of 8 Nov) is retried after 15..240 s as verify-load does.
 *    wrangler aborting with no answer from D1 (on Windows it aborts after every error, libuv's
 *    UV_HANDLE_CLOSING assertion) is retried twice, after 5 and 20 s, each lost try counted as its
 *    estimate; D1's own error, read from wrangler's JSON, is reported as D1 said it.
 * 6. Resumable: the plan is cached per build (tmp/records/safe-verify/plan-*.json) and the run's
 *    state (selection, each range's result, rows read) is written after every statement to
 *    tmp/records/safe-verify/state-<target>.json; --resume carries on where a stopped run left off
 *    (budget, overload, error), rechecking only what is not yet verified.
 * 7. Report: PASS / FAIL / INCOMPLETE with the cheap checks, ranges verified, rows covered, rows_read
 *    and the duration; also written as report-<target>.json next to the state.
 *
 *   node packages/loader/src/safe-verify.mjs --remote [--db FILE] [--since FILE | --delta DIR | --no-delta]
 *        [--full] [--sample N] [--delta-ranges N|all] [--seed N] [--budget ROWS] [--pause-ms N] [--range-rows N] [--range-bytes N]
 *        [--resume] [--state FILE] [--cache-dir DIR] [--drill N] [--overload-retries N] [--plan] [--ignore-publish-state]
 *   node packages/loader/src/safe-verify.mjs --local ...          the local D1 (wrangler --local)
 *   node packages/loader/src/safe-verify.mjs --against FILE ...   a SQLite file stands in for D1 (tests, drills)
 *
 * --plan prints what a run would read and its estimated rows_read without touching any database
 * but the local build. --remote refuses to start while .claude/publish/work/publish-run.json says a
 * publish is building or loading (--ignore-publish-state to override), and stops if D1's dataset
 * says a load is in progress.
 *
 * Exit codes: 0 PASS, 1 FAIL (a difference), 2 refused (usage, a publish or load in progress),
 * 3 INCOMPLETE (budget spent, D1 overloaded, the read guard, an error: resume with --resume).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openSqliteHandle } from '../../storage/src/sqlite.mjs';
import { HASHED_TABLES } from '../../schema/src/schema.mjs';
import { datasetLoadState, LOADING_KEY, loadingValue } from './dataset-state.mjs';
import { q } from './diff-load.mjs';
import { RECORDS_DB, REPO_ROOT } from './paths.mjs';
import {
  BOUNDS, D1_NAME, deltaKeys, isOverloaded, isTransientAuth, isWranglerCrash, sampleKeys, sleepSync, wranglerQuery,
} from './verify-load.mjs';

/** @typedef {import('../../storage/src/sqlite.mjs').SqliteHandle} SqliteHandle */
/** @typedef {import('../../schema/src/schema.mjs').TableSpec} TableSpec */
/** @typedef {import('./verify-load.mjs').QueryRows} QueryRows */
/** A statement sent to the database being verified. @typedef {(sql: string) => QueryRows} Query */
/** A primary-key column value as the build holds it. @typedef {string | number | null} KeyValue */
/**
 * A key range [lo, hi) of one table; lo null: open below, hi null: open above.
 * @typedef {{ id: string, table: string, index: number, lo: KeyValue[] | null, hi: KeyValue[] | null, rows: number, bytes: number }} Range
 * @typedef {{ name: string, pk: string[], rows: number, first: KeyValue[] | null, last: KeyValue[] | null, bytesCounted: boolean, ranges: Range[] }} TablePlan
 * @typedef {{ id: string, version: string, size: number, mtimeMs: number, rangeRows: number, rangeBytes: number, tables: TablePlan[] }} RangePlan
 * @typedef {'small' | 'delta' | 'sample' | 'full'} Reason
 * @typedef {{ id: string, reason: Reason }} Selected
 * @typedef {{ ok: boolean, n: number | null, s: number | null, ln: number, ls: number, rowsRead: number, at: string, detail?: string[] }} RangeResult
 * @typedef {{ planId: string, target: string, version: string, seed: number, full: boolean, sample: number,
 *   delta: string, selection: Selected[], results: Record<string, RangeResult>,
 *   runs: { startedAt: string, finishedAt?: string, rowsRead: number, statements: number, outcome?: string, stop?: string }[] }} RunState
 * @typedef {'PASS' | 'FAIL' | 'INCOMPLETE' | 'REFUSED' | 'PLAN'} Outcome
 * @typedef {{ outcome: Outcome, target: string, build: string, version: string, mismatches: string[], notes: string[],
 *   cheap: string[], stop: string | null, rowsRead: number, rowsReadAllRuns: number, statements: number, durationMs: number,
 *   selected: number, verified: number, failed: number, pending: number, rowsCovered: number, rowsSelected: number,
 *   totalRows: number, totalRanges: number, estimatedRowsRead: number, budget: number, stateFile: string }} Report
 */

/** The defaults (exported for the tests and LANDING.md). */
export const SAFE = {
  rangeRows: 10_000,
  rangeBytes: 8 * 1024 * 1024,
  sampleRanges: 20,
  // A big delta (a graph rebuild touched 370 of 675 ranges on 11 Nov 2026) is checked a slice per run.
  deltaRanges: 30,
  budget: 1_000_000,
  pauseMs: 2000,
  maxPauseMs: 30_000,
  slowQueryMs: 1000,
  overloadWaitMs: 60_000,
  overloadRetries: 0,
  authBackoffMs: BOUNDS.backoffMs,
  // wrangler aborting with no answer from D1 (verify-load.mjs's WranglerError): retried after these
  // waits, each lost attempt counted as its estimate against the budget (D1 may have run it).
  crashBackoffMs: [5_000, 20_000],
  scanFactor: 4,
  scanSlack: 1000,
  drill: 3,
  drillExtraRows: 50,
  drillMaxRows: 20_000,
  drillShow: 20,
  // rangeRows * 2^32 (row_hash_n is below 2^32) must stay an exact double: below 2^53.
  maxRangeRows: 2_000_000,
  publishStaleMs: 6 * 3600 * 1000,
};

export const STATE_DIR = path.join(REPO_ROOT, 'tmp', 'records', 'safe-verify');
export const DELTA_DIR = path.join(REPO_ROOT, 'tmp', 'records', 'delta');
export const REMOTE_SNAPSHOT = path.join(REPO_ROOT, '.claude', 'publish', 'work', 'last-loaded.sqlite');
export const LOCAL_SNAPSHOT = path.join(REPO_ROOT, 'tmp', 'records', 'last-loaded-local.sqlite');
export const PUBLISH_RUN_FILE = path.join(REPO_ROOT, '.claude', 'publish', 'work', 'publish-run.json');

const SCHEMA_SQL = "SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name LIMIT 1000";
const DATASET_SQL = 'SELECT key, value FROM dataset ORDER BY key LIMIT 100';
/** Dataset keys a load writes that are not the build's own. */
const LOAD_KEYS = new Set([LOADING_KEY, 'loaded_at']);
const DATA_TABLES = new Set(HASHED_TABLES.map((t) => t.name));
/** Bump when the plan's shape changes, so a cached plan of the old shape is recomputed. */
const PLAN_FORMAT = 2;

/** A run that stopped safely before it finished (budget, overload, read guard, error). */
export class StopRun extends Error {
  /** @param {string} reason @param {string} message */
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// ------------------------------------------------------------------ SQL

/**
 * The WHERE of a key range: pk >= lo AND pk < hi, as row values for a composite key.
 * @param {string[]} pk
 * @param {KeyValue[] | null} lo
 * @param {KeyValue[] | null} hi
 * @param {(value: KeyValue) => string} [lit] a literal (q) or a placeholder
 */
export function rangeWhere(pk, lo, hi, lit = q) {
  const side = (/** @type {KeyValue[]} */ vals, /** @type {string} */ op) => (pk.length === 1
    ? `${pk[0]} ${op} ${lit(vals[0])}`
    : `(${pk.join(', ')}) ${op} (${vals.map(lit).join(', ')})`);
  /** @type {string[]} */
  const parts = [];
  if (lo) parts.push(side(lo, '>='));
  if (hi) parts.push(side(hi, '<'));
  return parts.join(' AND ');
}

/**
 * A range's count and checksum, read through the primary key and never more than rows+1 rows.
 * @param {{ name: string, pk: string[] }} t
 * @param {Pick<Range, 'lo' | 'hi' | 'rows'>} r
 */
export function rangeChecksumSql(t, r) {
  const where = rangeWhere(t.pk, r.lo, r.hi);
  return `SELECT COUNT(*) AS n, COALESCE(SUM(row_hash_n), 0) AS s FROM (SELECT row_hash_n FROM ${t.name}${where ? ` WHERE ${where}` : ''} LIMIT ${r.rows + 1})`;
}

/**
 * A range's keys and row hashes in key order (the drill-down of a mismatching range).
 * @param {{ name: string, pk: string[] }} t
 * @param {Pick<Range, 'lo' | 'hi' | 'rows'>} r
 * @param {number} [extra] rows beyond the build's count, to see rows D1 has too many
 */
export function rangeKeysSql(t, r, extra = SAFE.drillExtraRows) {
  const where = rangeWhere(t.pk, r.lo, r.hi);
  return `SELECT ${t.pk.join(', ')}, row_hash FROM ${t.name}${where ? ` WHERE ${where}` : ''} ORDER BY ${t.pk.join(', ')} LIMIT ${r.rows + extra}`;
}

/**
 * The bounds check: per table, whether D1 holds a row below the build's first key or above its
 * last (two index seeks of at most one row each), at most `maxTerms` tables per statement (D1's
 * compound SELECT limit) and as many as fit wrangler's command line. With the ranges, which only
 * cover the build's first to last key in their counts, this accounts for every row: none outside,
 * the right ones inside.
 * @param {TablePlan[]} tables
 * @param {number} [maxBytes]
 * @param {number} [maxTerms]
 * @returns {{ sql: string, tables: string[] }[]}
 */
export function boundsSql(tables, maxBytes = BOUNDS.statementBytes - 512, maxTerms = BOUNDS.compoundTerms) {
  /** @type {{ sql: string, tables: string[] }[]} */
  const out = [];
  /** @type {string[]} */
  let parts = [];
  /** @type {string[]} */
  let names = [];
  const flush = () => { if (parts.length) out.push({ sql: parts.join(' UNION ALL '), tables: names }); parts = []; names = []; };
  for (const t of tables) {
    if (!t.first || !t.last) continue;
    const one = (/** @type {string} */ where) => `(SELECT COUNT(*) FROM (SELECT 1 FROM ${t.name} WHERE ${where} LIMIT 1))`;
    const below = t.pk.length === 1 ? `${t.pk[0]} < ${q(t.first[0])}` : `(${t.pk.join(', ')}) < (${t.first.map(q).join(', ')})`;
    const above = t.pk.length === 1 ? `${t.pk[0]} > ${q(t.last[0])}` : `(${t.pk.join(', ')}) > (${t.last.map(q).join(', ')})`;
    const part = `SELECT '${t.name}' AS t, ${one(below)} AS below, ${one(above)} AS above`;
    if (parts.length >= maxTerms || (parts.length && Buffer.byteLength([...parts, part].join(' UNION ALL ')) > maxBytes)) flush();
    parts.push(part);
    names.push(t.name);
  }
  flush();
  return out;
}

/**
 * The tables a statement's plan would SCAN (read whole), from EXPLAIN QUERY PLAN on `db`.
 * @param {SqliteHandle} db
 * @param {string} sql
 */
export function scannedTables(db, sql) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
    .map((r) => /^SCAN (\w+)/.exec(String(r.detail))?.[1])
    .filter((name) => typeof name === 'string' && DATA_TABLES.has(name));
}

/**
 * The terms of a statement's compound SELECTs (UNION [ALL], INTERSECT, EXCEPT), string literals aside.
 * @param {string} sql
 */
export const compoundTerms = (sql) => 1 + (sql.replace(/'(?:[^']|'')*'/g, "''").match(/\b(?:UNION|INTERSECT|EXCEPT)\b/gi) || []).length;

/**
 * Refuse a statement that would scan a records table (other than `wholeTable`, a small table read
 * whole under its LIMIT) or that has no LIMIT. Thrown before anything is sent.
 * @param {SqliteHandle} db the local build, whose schema equals D1's (the cheap checks)
 * @param {string} sql
 * @param {string | null} [wholeTable]
 */
export function assertBounded(db, sql, wholeTable = null) {
  if (!/ LIMIT \d+\b/.test(sql)) throw new StopRun('guard', `refused: no LIMIT on ${sql.slice(0, 160)}`);
  if (Buffer.byteLength(sql) > BOUNDS.statementBytes) throw new StopRun('guard', `refused: a statement of ${Buffer.byteLength(sql)} bytes (wrangler's command line)`);
  const terms = compoundTerms(sql);
  if (terms > BOUNDS.compoundTerms) throw new StopRun('guard', `refused: a compound SELECT of ${terms} terms (D1 allows ${BOUNDS.compoundTerms})`);
  const scans = scannedTables(db, sql).filter((name) => name !== wholeTable);
  if (scans.length) throw new StopRun('guard', `refused: the statement would scan ${scans.join(', ')}: ${sql.slice(0, 160)}`);
}

// ------------------------------------------------------------------ the plan

const bytesExpr = (/** @type {TableSpec} */ t) => t.columns.map((c) => `COALESCE(length(${c.name}), 0)`).join(' + ');

/**
 * @param {SqliteHandle} db
 * @param {string} key
 */
function datasetValue(db, key) {
  const row = db.prepare('SELECT value FROM dataset WHERE key = ?').get(key);
  return row ? String(row.value) : '';
}

/**
 * A build's identity for the plan cache: its dataset version, size and mtime and the range limits.
 * @param {string} file
 * @param {{ rangeRows?: number, rangeBytes?: number }} [limits]
 */
export function planIdentity(file, { rangeRows = SAFE.rangeRows, rangeBytes = SAFE.rangeBytes } = {}) {
  const db = openSqliteHandle(file, { readOnly: true });
  let version;
  try { version = datasetValue(db, 'version'); } finally { db.close(); }
  const st = statSync(file);
  const id = createHash('sha1').update(JSON.stringify([PLAN_FORMAT, version, st.size, Math.round(st.mtimeMs), rangeRows, rangeBytes])).digest('hex').slice(0, 16);
  return { id, version, size: st.size, mtimeMs: Math.round(st.mtimeMs), rangeRows, rangeBytes };
}

/**
 * Cut every table of the build into primary-key ranges: at most rangeRows rows, and about
 * rangeBytes of row data in a table whose rows can be wide (judged on a sample of 64 rows).
 * Local reads only: one walk of each table's primary key in key order.
 * @param {string} file
 * @param {{ rangeRows?: number, rangeBytes?: number, tables?: TableSpec[] }} [options]
 * @returns {RangePlan}
 */
export function computePlan(file, { rangeRows = SAFE.rangeRows, rangeBytes = SAFE.rangeBytes, tables = HASHED_TABLES } = {}) {
  if (!(rangeRows >= 1 && rangeRows <= SAFE.maxRangeRows)) throw new Error(`--range-rows must be 1..${SAFE.maxRangeRows}`);
  const ident = planIdentity(file, { rangeRows, rangeBytes });
  const db = openSqliteHandle(file, { readOnly: true });
  /** @type {TablePlan[]} */
  const out = [];
  try {
    for (const t of tables) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t.name)) throw new Error(`${t.name} is not in ${file}`);
      const sampled = sampleKeys(db, t, 64);
      const maxBytes = Math.max(0, ...sampled.map((k) => k.bytes));
      const avgBytes = sampled.length ? sampled.reduce((n, k) => n + k.bytes, 0) / sampled.length : 0;
      const bytesCounted = maxBytes * rangeRows > rangeBytes;
      const pk = t.pk.join(', ');
      const sql = `SELECT ${pk}${bytesCounted ? `, ${bytesExpr(t)} AS bytes__` : ''} FROM ${t.name} ORDER BY ${pk}`;
      /** @type {Range[]} */
      const ranges = [];
      /** @type {{ lo: KeyValue[] | null, rows: number, bytes: number }} */
      let cur = { lo: null, rows: 0, bytes: 0 };
      const close = (/** @type {KeyValue[] | null} */ hi) => {
        ranges.push({
          id: `${t.name}#${ranges.length}`, table: t.name, index: ranges.length, lo: cur.lo, hi, rows: cur.rows,
          bytes: bytesCounted ? cur.bytes : Math.round(cur.rows * avgBytes),
        });
      };
      let total = 0;
      /** @type {Record<string, unknown> | null} */
      let firstRow = null;
      /** @type {Record<string, unknown> | null} */
      let lastRow = null;
      for (const row of db.prepare(sql).iterate()) {
        firstRow ??= row;
        lastRow = row;
        const b = bytesCounted ? Number(row.bytes__) : 0;
        if (cur.rows > 0 && (cur.rows >= rangeRows || (bytesCounted && cur.bytes + b > rangeBytes))) {
          const key = t.pk.map((c) => keyValue(t.name, c, row[c]));
          close(key);
          cur = { lo: key, rows: 0, bytes: 0 };
        }
        cur.rows += 1;
        cur.bytes += b;
        total += 1;
      }
      close(null);
      const keyOf = (/** @type {Record<string, unknown> | null} */ row) => (row ? t.pk.map((c) => keyValue(t.name, c, row[c])) : null);
      out.push({ name: t.name, pk: [...t.pk], rows: total, first: keyOf(firstRow), last: keyOf(lastRow), bytesCounted, ranges });
    }
  } finally {
    db.close();
  }
  return { ...ident, tables: out };
}

/**
 * @param {string} table
 * @param {string} column
 * @param {unknown} value
 * @returns {KeyValue}
 */
function keyValue(table, column, value) {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${table}.${column}: ${value} is beyond an exact double`);
    return value;
  }
  if (typeof value === 'bigint') throw new Error(`${table}.${column}: bigint keys are not supported`);
  throw new Error(`${table}.${column}: a ${typeof value} key is not supported`);
}

/**
 * The plan for a build, from the cache when it was made for this very file and these limits.
 * @param {string} file
 * @param {{ rangeRows?: number, rangeBytes?: number, cacheDir?: string, log?: (line: string) => void }} [options]
 * @returns {RangePlan}
 */
export function loadPlan(file, { rangeRows = SAFE.rangeRows, rangeBytes = SAFE.rangeBytes, cacheDir = STATE_DIR, log = () => {} } = {}) {
  const ident = planIdentity(file, { rangeRows, rangeBytes });
  const cache = path.join(cacheDir, `plan-${ident.version || 'unversioned'}-${rangeRows}-${rangeBytes}.json`);
  if (existsSync(cache)) {
    try {
      /** @type {RangePlan} */
      const cached = JSON.parse(readFileSync(cache, 'utf8'));
      if (cached.id === ident.id) return cached;
    } catch { /* recompute */ }
  }
  const started = Date.now();
  const plan = computePlan(file, { rangeRows, rangeBytes });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cache, JSON.stringify(plan));
  log(`  plan: ${plan.tables.reduce((n, t) => n + t.ranges.length, 0)} ranges over ${plan.tables.length} tables computed in ${((Date.now() - started) / 1000).toFixed(1)} s (${path.relative(REPO_ROOT, cache)})`);
  return plan;
}

// ------------------------------------------------------------------ the keys the delta touched

/** The primary keys a delta wrote, per table, kept in an in-memory SQLite (they can be millions). */
export class TouchedKeys {
  constructor() {
    this.db = openSqliteHandle(':memory:');
    this.db.exec('BEGIN');
    /** @type {Map<string, import('../../storage/src/sqlite.mjs').SqliteStatement>} */
    this.inserts = new Map();
    /** @type {Set<string>} */
    this.wholeTables = new Set();
    this.open = true;
  }

  /** @param {string} table @param {KeyValue[]} values */
  add(table, values) {
    let ins = this.inserts.get(table);
    if (!ins) {
      const cols = values.map((_, i) => `c${i}`);
      // No declared types: each value keeps its storage class, so it compares as the build's does.
      this.db.exec(`CREATE TABLE "k_${table}" (${cols.join(', ')}, PRIMARY KEY (${cols.join(', ')})) WITHOUT ROWID`);
      ins = this.db.prepare(`INSERT OR IGNORE INTO "k_${table}" VALUES (${cols.map(() => '?').join(', ')})`);
      this.inserts.set(table, ins);
    }
    ins.run(...values);
  }

  /** A table the delta rewrote whole (a full load). @param {string} table */
  addTable(table) { this.wholeTables.add(table); }

  /** @returns {Record<string, number>} distinct keys per table (-1: the whole table) */
  counts() {
    /** @type {Record<string, number>} */
    const out = {};
    for (const t of this.inserts.keys()) out[t] = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM "k_${t}"`).get()?.n);
    for (const t of this.wholeTables) out[t] = -1;
    return out;
  }

  /**
   * The ids of the plan's ranges that hold a touched key.
   * @param {RangePlan} plan
   */
  rangesIn(plan) {
    if (this.open) { this.db.exec('COMMIT'); this.open = false; }
    /** @type {Set<string>} */
    const ids = new Set();
    for (const tp of plan.tables) {
      if (this.wholeTables.has(tp.name)) { for (const r of tp.ranges) ids.add(r.id); continue; }
      if (!this.inserts.has(tp.name)) continue;
      const cols = tp.pk.map((_, i) => `c${i}`);
      for (const r of tp.ranges) {
        /** @type {KeyValue[]} */
        const params = [];
        const where = rangeWhere(cols, r.lo, r.hi, (v) => { params.push(v); return '?'; });
        if (this.db.prepare(`SELECT 1 FROM "k_${tp.name}"${where ? ` WHERE ${where}` : ''} LIMIT 1`).get(...params)) ids.add(r.id);
      }
    }
    return ids;
  }

  close() { if (this.open) this.db.exec('COMMIT'); this.db.close(); }
}

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const INSERT = /INSERT OR REPLACE INTO (\w+) \(([^)]*)\) VALUES /y;
const DELETE_ALL = /DELETE FROM (\w+);/y;
const DELETE_TUPLES = /DELETE FROM (\w+) WHERE \(([^)]*)\) IN \(VALUES /y;
const DELETE_LIST = /DELETE FROM (\w+) WHERE (\w+) IN \(/y;

/**
 * Read the keys out of delta SQL as diff-load.mjs writes it (INSERT OR REPLACE ... VALUES (...), ...;
 * DELETE ... WHERE pk IN (...); DELETE ... WHERE (pk) IN (VALUES (...)); DELETE FROM t; UPDATE pieces
 * of a wide value, whose key its INSERT already gave). Literals are q()'s: NULL, numbers and
 * '...' strings with '' for a quote (they may hold newlines). `pkOf(table)` gives a table's
 * primary key (null: not a records table).
 * @param {string} text
 * @param {{ key: (table: string, values: KeyValue[]) => void, table?: (table: string) => void,
 *   pkOf: (table: string) => string[] | null }} sink
 * @returns {{ loading: string | null, statements: number, unknown: number }}
 */
export function parseDeltaSql(text, sink) {
  let i = 0;
  const n = text.length;
  /** @type {string | null} */
  let loading = null;
  let statements = 0;
  let unknown = 0;
  const fail = (/** @type {string} */ what) => { throw new Error(`delta SQL: ${what} at offset ${i}: ${JSON.stringify(text.slice(i, i + 60))}`); };
  const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i += 1; };
  const expect = (/** @type {string} */ s) => { if (!text.startsWith(s, i)) fail(`expected ${JSON.stringify(s)}`); i += s.length; };
  /** @returns {KeyValue} */
  const value = (keep = true) => {
    if (text[i] === "'") {
      let out = '';
      let j = i + 1;
      for (;;) {
        const k = text.indexOf("'", j);
        if (k < 0) fail('an unterminated string');
        if (keep) out += text.slice(j, k);
        if (text[k + 1] === "'") { if (keep) out += "'"; j = k + 2; continue; }
        i = k + 1;
        return keep ? out : null;
      }
    }
    if (text.startsWith('NULL', i)) { i += 4; return null; }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) fail('expected a literal');
    i += /** @type {RegExpExecArray} */ (m)[0].length;
    return Number(/** @type {RegExpExecArray} */ (m)[0]);
  };
  /** A tuple, keeping the values at `keepAt` (all when null). @param {number[] | null} keepAt */
  const tuple = (keepAt) => {
    expect('(');
    /** @type {KeyValue[]} */
    const vals = [];
    /** @type {Map<number, KeyValue>} */
    const kept = new Map();
    for (let col = 0; ; col += 1) {
      const keep = !keepAt || keepAt.includes(col);
      const v = value(keep);
      if (!keepAt) vals.push(v);
      else if (keep) kept.set(col, v);
      if (text.startsWith(', ', i)) { i += 2; continue; }
      break;
    }
    expect(')');
    return keepAt ? keepAt.map((at) => /** @type {KeyValue} */ (kept.get(at))) : vals;
  };
  const skipStatement = () => {
    for (;;) {
      const quote = text.indexOf("'", i);
      const semi = text.indexOf(';', i);
      if (semi < 0) { i = n; return; }
      if (quote < 0 || semi < quote) { i = semi + 1; return; }
      // Skip the string.
      let j = quote + 1;
      for (;;) {
        const k = text.indexOf("'", j);
        if (k < 0) { i = n; return; }
        if (text[k + 1] === "'") { j = k + 2; continue; }
        i = k + 1;
        break;
      }
    }
  };
  /** @param {RegExp} re */
  const match = (re) => { re.lastIndex = i; const m = re.exec(text); if (m) i += m[0].length; return m; };

  for (ws(); i < n; ws()) {
    statements += 1;
    let m;
    if ((m = match(INSERT))) {
      const table = m[1];
      const cols = m[2].split(',').map((s) => s.trim());
      if (table === 'dataset') {
        const ki = cols.indexOf('key');
        const vi = cols.indexOf('value');
        for (;;) {
          const t = tuple(null);
          if (loading === null && t[ki] === LOADING_KEY) loading = t[vi] === null ? '' : String(t[vi]);
          if (text.startsWith(', ', i)) { i += 2; continue; }
          break;
        }
        expect(';');
        continue;
      }
      const pk = sink.pkOf(table);
      if (!pk) { skipStatement(); unknown += 1; continue; }
      const keepAt = pk.map((c) => cols.indexOf(c));
      if (keepAt.some((at) => at < 0)) fail(`${table}: a primary-key column is missing from the INSERT`);
      for (;;) {
        sink.key(table, tuple(keepAt));
        if (text.startsWith(', ', i)) { i += 2; continue; }
        break;
      }
      expect(';');
    } else if ((m = match(DELETE_ALL))) {
      if (sink.pkOf(m[1])) sink.table?.(m[1]);
    } else if ((m = match(DELETE_TUPLES))) {
      const table = m[1];
      for (;;) {
        sink.key(table, tuple(null));
        if (text.startsWith(', ', i)) { i += 2; continue; }
        break;
      }
      expect(');');
    } else if ((m = match(DELETE_LIST))) {
      const table = m[1];
      for (;;) {
        sink.key(table, [value()]);
        if (text.startsWith(', ', i)) { i += 2; continue; }
        break;
      }
      expect(');');
    } else {
      if (!text.startsWith('UPDATE ', i)) unknown += 1;
      skipStatement();
    }
  }
  return { loading, statements, unknown };
}

const PK_OF = new Map(HASHED_TABLES.map((t) => [t.name, t.pk]));
const pkOf = (/** @type {string} */ table) => PK_OF.get(table) || null;

/**
 * The keys of the delta parts in `dir`, if they were written for `version` (their first statement
 * sets dataset.loading to it). Null when they were not (or there are none).
 * @param {string} dir
 * @param {string} version
 * @param {TouchedKeys} touched
 */
export function touchedFromDeltaDir(dir, version, touched) {
  if (!existsSync(dir)) return null;
  const parts = readdirSync(dir).filter((f) => /^\d+\.sql$/.test(f)).sort();
  if (!parts.length) return null;
  let statements = 0;
  let unknown = 0;
  for (const [i, part] of parts.entries()) {
    const res = parseDeltaSql(readFileSync(path.join(dir, part), 'utf8'), {
      key: (t, v) => touched.add(t, v), table: (t) => touched.addTable(t), pkOf,
    });
    if (i === 0 && res.loading !== loadingValue('loading', version)) return null;
    statements += res.statements;
    unknown += res.unknown;
  }
  return { parts: parts.length, statements, unknown };
}

/**
 * The keys between a snapshot and the build (diff-load.mjs's comparison: primary key + row_hash).
 * @param {string} buildFile
 * @param {string} sinceFile
 * @param {TouchedKeys} touched
 */
export function touchedFromSnapshot(buildFile, sinceFile, touched) {
  const db = openSqliteHandle(buildFile, { readOnly: true });
  try {
    db.exec(`ATTACH DATABASE '${sinceFile.replace(/'/g, "''")}' AS f`);
    const keys = deltaKeys(db);
    for (const [table, d] of Object.entries(keys)) {
      for (const k of [...d.upserted, ...d.deleted]) touched.add(table, /** @type {KeyValue[]} */ (k.values));
    }
    db.exec('DETACH DATABASE f');
  } finally {
    db.close();
  }
}

/** @param {string} file */
const fileVersion = (file) => {
  const db = openSqliteHandle(file, { readOnly: true });
  try { return datasetValue(db, 'version'); } finally { db.close(); }
};

/**
 * Where the delta's keys come from: an explicit --since or --delta, else (remote and local D1) the
 * snapshot when it is not this build yet, else the delta parts if they are this build's.
 * @param {{ file: string, version: string, since?: string | null, deltaDir?: string | null, noDelta?: boolean,
 *   snapshot?: string | null, defaultDeltaDir?: string | null }} o
 * @returns {{ touched: TouchedKeys | null, source: string }}
 */
export function resolveDelta({ file, version, since = null, deltaDir = null, noDelta = false, snapshot = null, defaultDeltaDir = null }) {
  if (noDelta) return { touched: null, source: 'none (--no-delta)' };
  const touched = new TouchedKeys();
  if (since) {
    touchedFromSnapshot(file, since, touched);
    return { touched, source: `--since ${path.relative(REPO_ROOT, since)}` };
  }
  if (deltaDir) {
    const res = touchedFromDeltaDir(deltaDir, version, touched);
    if (!res) { touched.close(); throw new Error(`${deltaDir} holds no delta parts for build ${version}`); }
    return { touched, source: `${path.relative(REPO_ROOT, deltaDir)} (${res.parts} parts, ${res.statements} statements${res.unknown ? `, ${res.unknown} not understood` : ''})` };
  }
  if (snapshot && existsSync(snapshot) && fileVersion(snapshot) !== version) {
    touchedFromSnapshot(file, snapshot, touched);
    return { touched, source: `the snapshot not yet replaced, ${path.relative(REPO_ROOT, snapshot)}` };
  }
  if (defaultDeltaDir) {
    const res = touchedFromDeltaDir(defaultDeltaDir, version, touched);
    if (res) return { touched, source: `${path.relative(REPO_ROOT, defaultDeltaDir)} (${res.parts} parts, ${res.statements} statements${res.unknown ? `, ${res.unknown} not understood` : ''})` };
  }
  touched.close();
  return { touched: null, source: 'none found (sample only)' };
}

// ------------------------------------------------------------------ selection

/** A seeded PRNG (mulberry32): the same --seed draws the same sample. @param {number} seed */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {T[]} list
 * @param {() => number} rand
 * @returns {T[]}
 */
function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The ranges a run checks, in the order it checks them: small tables whole, up to `deltaRanges`
 * of the ranges the delta touched (drawn at random), then `sample` random others; --full: every
 * range, in plan order. (Rows outside a table's first and last key are the cheap bounds check's.)
 * @param {RangePlan} plan
 * @param {{ full?: boolean, sample?: number, deltaRanges?: number, seed?: number, touched?: Set<string> }} [options]
 * @returns {Selected[]}
 */
export function selectRanges(plan, { full = false, sample = SAFE.sampleRanges, deltaRanges = SAFE.deltaRanges, seed = 1, touched = new Set() } = {}) {
  const all = plan.tables.flatMap((t) => t.ranges);
  if (full) return all.map((r) => ({ id: r.id, reason: /** @type {Reason} */ ('full') }));
  const rand = prng(seed);
  /** @type {Selected[]} */
  const picks = [];
  const chosen = new Set();
  const pick = (/** @type {string} */ id, /** @type {Reason} */ reason) => { if (!chosen.has(id)) { chosen.add(id); picks.push({ id, reason }); } };
  for (const t of plan.tables) if (t.ranges.length === 1) pick(t.ranges[0].id, 'small');
  for (const id of shuffle(all.filter((r) => touched.has(r.id) && !chosen.has(r.id)).map((r) => r.id), rand).slice(0, Math.max(0, deltaRanges))) pick(id, 'delta');
  for (const r of shuffle(all.filter((x) => !chosen.has(x.id)), rand).slice(0, Math.max(0, sample))) pick(r.id, 'sample');
  return picks;
}

/**
 * The rows_read a range is expected to cost. D1 counts a primary-key index read twice per row (the
 * index entry and the row: the 11 Nov 2026 publish's keyed lookups read 400 rows for 200 keys) and a
 * whole-table read once; plus the LIMIT's one extra row.
 * @param {Range} r
 */
export const rangeCost = (r) => (r.lo || r.hi ? 2 * r.rows + 2 : r.rows + 1);

// ------------------------------------------------------------------ the run

/**
 * Refuse to start while a publish is building or loading (its stage record), unless it is stale.
 * @param {string} file publish-run.json
 * @param {number} [now]
 * @returns {string | null} why not, or null
 */
export function publishInProgress(file, now = Date.now()) {
  if (!existsSync(file)) return null;
  try {
    /** @type {{ run?: { stage?: string, dry?: boolean, updatedAt?: string } }} */
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    const run = rec.run;
    if (!run || run.dry) return null;
    if (!['start', 'built'].includes(String(run.stage))) return null;
    const age = now - Date.parse(String(run.updatedAt));
    if (!(age >= 0 && age < SAFE.publishStaleMs)) return null;
    return `a publish is at stage '${run.stage}' (updated ${Math.round(age / 60000)} min ago): wait for it to finish (or --ignore-publish-state)`;
  } catch {
    return null;
  }
}

const norm = (/** @type {unknown} */ sql) => String(sql || '').replace(/\s+/g, ' ').trim();

/**
 * @param {{ name?: unknown, sql?: unknown }[]} rows
 * @param {Set<unknown>} [only]
 */
export function schemaHash(rows, only) {
  const lines = rows.filter((r) => !only || only.has(r.name)).map((r) => `${r.name}\t${norm(r.sql)}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Verify. Everything it reads from the target goes through `query`, one statement at a time.
 * @param {{ file: string, query: Query, target: string, stateFile?: string, cacheDir?: string,
 *   full?: boolean, sample?: number, deltaRanges?: number, seed?: number, budget?: number, pauseMs?: number,
 *   rangeRows?: number, rangeBytes?: number, resume?: boolean, planOnly?: boolean, drill?: number,
 *   overloadRetries?: number, overloadWaitMs?: number, authBackoffMs?: number[], crashBackoffMs?: number[],
 *   since?: string | null, deltaDir?: string | null, noDelta?: boolean, snapshot?: string | null,
 *   defaultDeltaDir?: string | null, sleep?: (ms: number) => void, log?: (line: string) => void }} o
 * @returns {Report}
 */
export function safeVerify(o) {
  const started = Date.now();
  const log = o.log || console.log;
  const sleep = o.sleep || sleepSync;
  const cacheDir = o.cacheDir || STATE_DIR;
  const stateFile = o.stateFile || path.join(cacheDir, `state-${o.target.replace(/[^\w.-]+/g, '_')}.json`);
  const budget = o.budget ?? SAFE.budget;
  let pauseMs = o.pauseMs ?? 0;
  const plan = loadPlan(o.file, { rangeRows: o.rangeRows, rangeBytes: o.rangeBytes, cacheDir, log });
  const ranges = new Map(plan.tables.flatMap((t) => t.ranges.map((r) => [r.id, { r, t }])));
  const totalRows = plan.tables.reduce((n, t) => n + t.rows, 0);
  /** @type {string[]} */
  const notes = [];

  /** @type {RunState | null} */
  let state = null;
  if (o.resume && existsSync(stateFile)) {
    /** @type {RunState} */
    const prev = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (prev.planId === plan.id && prev.target === o.target) {
      state = prev;
      notes.push(`resumed ${path.relative(REPO_ROOT, stateFile)}: ${Object.values(prev.results).filter((x) => x.ok).length} of ${prev.selection.length} ranges already verified`);
    } else {
      notes.push(`--resume: ${path.relative(REPO_ROOT, stateFile)} is for another build or target; starting afresh`);
    }
  }
  if (!state) {
    const seed = o.seed ?? (Date.now() % 2147483647);
    const { touched, source } = resolveDelta({
      file: o.file, version: plan.version, since: o.since, deltaDir: o.deltaDir, noDelta: o.noDelta,
      snapshot: o.snapshot, defaultDeltaDir: o.defaultDeltaDir,
    });
    /** @type {Set<string>} */
    let touchedIds = new Set();
    if (touched) {
      touchedIds = touched.rangesIn(plan);
      const counts = touched.counts();
      const keys = Object.values(counts).filter((x) => x > 0).reduce((a, b) => a + b, 0);
      const whole = Object.values(counts).filter((x) => x < 0).length;
      notes.push(`delta: ${keys} keys in ${Object.keys(counts).length} tables${whole ? ` (${whole} rewritten whole)` : ''} from ${source}: ${touchedIds.size} ranges touched`);
      touched.close();
    } else {
      notes.push(`delta: ${source}`);
    }
    const deltaRanges = o.deltaRanges ?? SAFE.deltaRanges;
    const selection = selectRanges(plan, { full: o.full, sample: o.sample ?? SAFE.sampleRanges, deltaRanges, seed, touched: touchedIds });
    const deltaPicked = selection.filter((p) => p.reason === 'delta').length;
    const touchedSmall = selection.filter((p) => p.reason !== 'delta' && touchedIds.has(p.id)).length;
    if (!o.full && touchedIds.size > deltaPicked + touchedSmall) notes.push(`delta: ${deltaPicked} of the ${touchedIds.size - touchedSmall} touched ranges of larger tables drawn (--delta-ranges ${deltaRanges}); a new run (or --seed) draws others, --full walks them all`);
    state = {
      planId: plan.id, target: o.target, version: plan.version, seed, full: Boolean(o.full), sample: o.sample ?? SAFE.sampleRanges,
      delta: notes[notes.length - 1], selection, results: {}, runs: [],
    };
  }
  const st = /** @type {RunState} */ (state);
  const save = () => { mkdirSync(path.dirname(stateFile), { recursive: true }); writeFileSync(stateFile, `${JSON.stringify(st, null, 1)}\n`); };
  const todo = st.selection.filter((p) => !st.results[p.id]?.ok);
  const estimated = todo.reduce((n, p) => n + rangeCost(/** @type {{ r: Range }} */ (ranges.get(p.id)).r), 0) + 2;
  const byReason = st.selection.reduce((acc, p) => ({ ...acc, [p.reason]: (acc[p.reason] || 0) + 1 }), /** @type {Record<string, number>} */ ({}));
  notes.push(`plan ${plan.id}: ${ranges.size} ranges over ${plan.tables.length} tables (${totalRows} rows; --range-rows ${plan.rangeRows}, --range-bytes ${plan.rangeBytes}); selected ${st.selection.length} (${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(', ')}), ${todo.length} to check, about ${estimated} rows_read (budget ${budget})`);
  for (const n of notes) log(`  ${n}`);

  /** @type {Report} */
  const report = {
    outcome: 'PASS', target: o.target, build: path.relative(REPO_ROOT, o.file) || o.file, version: plan.version, mismatches: [], notes, cheap: [],
    stop: null, rowsRead: 0, rowsReadAllRuns: 0, statements: 0, durationMs: 0, selected: st.selection.length, verified: 0, failed: 0, pending: 0,
    rowsCovered: 0, rowsSelected: 0, totalRows, totalRanges: ranges.size, estimatedRowsRead: estimated, budget, stateFile,
  };
  const finish = () => {
    report.durationMs = Date.now() - started;
    for (const p of st.selection) {
      const res = st.results[p.id];
      const r = /** @type {{ r: Range }} */ (ranges.get(p.id)).r;
      report.rowsSelected += r.rows;
      if (!res) report.pending += 1;
      else if (res.ok) { report.verified += 1; report.rowsCovered += r.rows; } else report.failed += 1;
    }
    report.rowsReadAllRuns = st.runs.reduce((n, x) => n + x.rowsRead, 0);
    if (report.outcome !== 'REFUSED' && report.outcome !== 'PLAN') {
      if (report.mismatches.length || report.failed) report.outcome = 'FAIL';
      else if (report.stop || report.pending) report.outcome = 'INCOMPLETE';
    }
    if (o.planOnly) return report;
    const run = st.runs[st.runs.length - 1];
    if (run) Object.assign(run, { finishedAt: new Date().toISOString(), outcome: report.outcome, stop: report.stop || undefined });
    save();
    writeFileSync(reportFileFor(stateFile), `${JSON.stringify(report, null, 1)}\n`);
    return report;
  };

  if (o.planOnly) {
    report.outcome = 'PLAN';
    for (const p of todo) {
      const { r, t } = /** @type {{ r: Range, t: TablePlan }} */ (ranges.get(p.id));
      log(`  ${p.reason.padEnd(6)} ${r.id} (${r.rows} rows${r.lo || r.hi ? '' : ', whole table'}): ${rangeChecksumSql(t, r).slice(0, 140)}`);
    }
    return finish();
  }

  st.runs.push({ startedAt: new Date().toISOString(), rowsRead: 0, statements: 0 });
  const run = st.runs[st.runs.length - 1];
  const local = openSqliteHandle(o.file, { readOnly: true });
  let overloads = 0;

  /**
   * One statement to the target: refused unless bounded, a pause before it, its rows_read counted,
   * a 7429 stops the run (or waits, with --overload-retries), a 7403 is retried with backoff.
   * @param {string} sql
   * @param {number} estimate
   * @param {string | null} wholeTable
   * @param {boolean} [cheap] a cheap check: outside the budget, and counted as the rows it returned where D1 does not say
   */
  const send = (sql, estimate, wholeTable, cheap = false) => {
    assertBounded(local, sql, wholeTable);
    if (!cheap && report.rowsRead + estimate > budget) throw new StopRun('budget', `rows_read budget: ${report.rowsRead} read, the next statement could read ${estimate} more (budget ${budget}); --resume to carry on`);
    if (report.statements > 0) sleep(pauseMs);
    /** @type {QueryRows} */
    let rows;
    let crashes = 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        report.statements += 1;
        run.statements += 1;
        rows = o.query(sql);
        break;
      } catch (error) {
        if (isOverloaded(error)) {
          overloads += 1;
          const retries = o.overloadRetries ?? SAFE.overloadRetries;
          if (overloads > retries) throw new StopRun('overloaded', `D1 answered 7429 (overloaded): stopped at once. Wait at least 10 minutes, then --resume`);
          const wait = (o.overloadWaitMs ?? SAFE.overloadWaitMs) * 2 ** (overloads - 1);
          pauseMs = Math.min(Math.max(pauseMs * 2, 1000), SAFE.maxPauseMs);
          log(`  D1 overloaded (7429): waiting ${wait / 1000} s, then one statement every ${pauseMs / 1000} s`);
          sleep(wait);
          continue;
        }
        const backoff = o.authBackoffMs ?? SAFE.authBackoffMs;
        if (isTransientAuth(error) && attempt < backoff.length) {
          log(`  D1 refused the request (7403): waiting ${backoff[attempt] / 1000} s before retry ${attempt + 1} of ${backoff.length}`);
          sleep(backoff[attempt]);
          continue;
        }
        const crashWaits = o.crashBackoffMs ?? SAFE.crashBackoffMs;
        if (isWranglerCrash(error) && crashes < crashWaits.length) {
          // No answer, so no meta.rows_read: D1 may have run the statement, so its estimate is
          // counted as read, and the retry must still fit the budget.
          report.rowsRead += estimate;
          run.rowsRead += estimate;
          if (!cheap && report.rowsRead + estimate > budget) throw new StopRun('budget', `rows_read budget: wrangler aborted with no answer (counted as ${estimate} read) and a retry could pass the budget ${budget}; --resume to carry on`);
          log(`  wrangler aborted with no answer from D1: waiting ${crashWaits[crashes] / 1000} s before retry ${crashes + 1} of ${crashWaits.length} (counted ${estimate} rows_read)`);
          sleep(crashWaits[crashes]);
          crashes += 1;
          continue;
        }
        throw new StopRun('error', `the statement failed: ${String(/** @type {Error} */ (error)?.message || error).slice(0, 400)}`);
      }
    }
    const read = rows.rowsRead ?? (cheap ? rows.length : estimate);
    report.rowsRead += read;
    run.rowsRead += read;
    if (rows.rowsRead !== undefined && rows.rowsRead > SAFE.scanFactor * estimate + SAFE.scanSlack) {
      throw new StopRun('read-guard', `D1 read ${rows.rowsRead} rows for a statement expected to read about ${estimate}: stopped (${sql.slice(0, 120)})`);
    }
    if (rows.durationMs !== undefined && rows.durationMs > SAFE.slowQueryMs && pauseMs < SAFE.maxPauseMs) {
      pauseMs = Math.min(Math.max(pauseMs * 2, 1000), SAFE.maxPauseMs);
      log(`  D1 took ${rows.durationMs} ms: one statement every ${pauseMs / 1000} s from now`);
    }
    return rows;
  };

  try {
    // 1. Cheap checks.
    const dataset = /** @type {{ key: string, value: string | null }[]} */ (local.prepare('SELECT key, value FROM dataset ORDER BY key').all());
    const dRows = send(DATASET_SQL, 101, null, true);
    const remote = new Map(dRows.map((r) => [String(r.key), r.value]));
    if (datasetLoadState(remote.get(LOADING_KEY)) === 'loading') {
      report.outcome = 'REFUSED';
      report.stop = `D1's dataset says a load is in progress (loading = '${remote.get(LOADING_KEY)}'): verify after it finishes`;
      return finish();
    }
    for (const r of dataset) {
      if (LOAD_KEYS.has(r.key)) continue;
      if (remote.get(r.key) !== r.value) report.mismatches.push(`dataset ${r.key}: local ${String(r.value).slice(0, 40)}, D1 ${String(remote.get(r.key) ?? '(absent)').slice(0, 40)}`);
    }
    report.cheap.push(`dataset: ${report.mismatches.length ? 'DIFFERS' : 'ok'} (D1 version ${remote.get('version') ?? '(none)'}, loaded_at ${remote.get('loaded_at') ?? '?'}; the recorded counts and checksums of every table ${report.mismatches.some((m) => m.startsWith('dataset table_checksums')) ? 'differ' : 'agree'})`);
    const localSchema = /** @type {{ name: string, sql: string }[]} */ (local.prepare(SCHEMA_SQL).all());
    const sRows = send(SCHEMA_SQL, 1001, null, true);
    const names = new Set(localSchema.map((r) => r.name));
    const lh = schemaHash(localSchema);
    const rh = schemaHash(sRows, /** @type {Set<unknown>} */ (names));
    const remoteSchema = new Map(sRows.map((r) => [r.name, norm(r.sql)]));
    const schemaDiffs = localSchema.filter((r) => remoteSchema.get(r.name) !== norm(r.sql)).map((r) => `schema ${r.name} differs or is missing in D1`);
    const extra = sRows.filter((r) => !names.has(String(r.name))).map((r) => String(r.name));
    report.mismatches.push(...schemaDiffs);
    report.cheap.push(`schema: ${schemaDiffs.length ? 'DIFFERS' : 'ok'} (hash local ${lh}, D1 ${rh}; ${localSchema.length} tables and indexes${extra.length ? `; D1 also has ${extra.length} more: ${extra.slice(0, 5).join(', ')}` : ''})`);
    if (!report.mismatches.length) {
      /** @type {string[]} */
      const outside = [];
      let checked = 0;
      for (const b of boundsSql(plan.tables)) {
        for (const row of send(b.sql, 2 * b.tables.length + 1, null, true)) {
          checked += 1;
          if (Number(row.below)) outside.push(`${row.t}: D1 has rows below the build's first key`);
          if (Number(row.above)) outside.push(`${row.t}: D1 has rows above the build's last key`);
        }
      }
      if (checked !== plan.tables.filter((t) => t.first).length) outside.push(`bounds: ${checked} tables answered, ${plan.tables.filter((t) => t.first).length} asked`);
      report.mismatches.push(...outside);
      report.cheap.push(`bounds: ${outside.length ? 'DIFFER' : 'ok'} (no row outside the build's first and last key in ${checked} non-empty tables)`);
    }
    for (const c of report.cheap) log(`  ${c}`);
    if (report.mismatches.length) {
      report.stop = 'the cheap checks differ: no range was read';
      return finish();
    }

    // 2. The ranges.
    let drills = 0;
    for (const p of st.selection) {
      if (st.results[p.id]?.ok) continue;
      const { r, t } = /** @type {{ r: Range, t: TablePlan }} */ (ranges.get(p.id));
      const whole = !r.lo && !r.hi ? t.name : null;
      const sql = rangeChecksumSql(t, r);
      const exp = /** @type {{ n: number, s: number }} */ (local.prepare(sql).get());
      const before = report.rowsRead;
      const got = send(sql, rangeCost(r), whole)[0] || {};
      const ok = Number(got.n) === Number(exp.n) && Number(got.s) === Number(exp.s);
      /** @type {RangeResult} */
      const res = {
        ok, n: got.n === undefined ? null : Number(got.n), s: got.s === undefined ? null : Number(got.s),
        ln: Number(exp.n), ls: Number(exp.s), rowsRead: report.rowsRead - before, at: new Date().toISOString(),
      };
      st.results[p.id] = res;
      log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.id} [${p.reason}] ${r.rows} rows, ${res.rowsRead} read`);
      if (!ok) {
        report.mismatches.push(`${r.id}: local ${exp.n} rows / ${exp.s}, D1 ${got.n} / ${got.s}`);
        const keysSql = rangeKeysSql(t, r);
        const cost = r.rows + SAFE.drillExtraRows;
        if (drills < (o.drill ?? SAFE.drill) && cost <= SAFE.drillMaxRows && report.rowsRead + cost <= budget) {
          drills += 1;
          const keyOf = (/** @type {Record<string, unknown>} */ row) => JSON.stringify(t.pk.map((c) => row[c] ?? null));
          const want = new Map(local.prepare(keysSql).all().map((x) => [keyOf(x), String(x.row_hash)]));
          const have = new Map(send(keysSql, cost, whole).map((x) => [keyOf(x), String(x.row_hash)]));
          /** @type {string[]} */
          const detail = [];
          for (const [k, h] of want) {
            if (!have.has(k)) detail.push(`${t.name} ${k}: missing in D1`);
            else if (have.get(k) !== h) detail.push(`${t.name} ${k}: row_hash local ${h.slice(0, 10)}, D1 ${String(have.get(k)).slice(0, 10)}`);
          }
          for (const k of have.keys()) if (!want.has(k)) detail.push(`${t.name} ${k}: in D1, not in the build`);
          res.detail = detail.slice(0, SAFE.drillShow);
          report.mismatches.push(...res.detail.map((d) => `  ${d}`));
          if (detail.length > SAFE.drillShow) report.mismatches.push(`  ... and ${detail.length - SAFE.drillShow} more in ${r.id}`);
        }
      }
      save();
    }
  } catch (error) {
    if (!(error instanceof StopRun)) throw error;
    report.stop = `${error.reason}: ${error.message}`;
  } finally {
    local.close();
  }
  return finish();
}

/**
 * The text report.
 * @param {Report} r
 */
export function formatReport(r) {
  const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '0%');
  const mins = Math.floor(r.durationMs / 60000);
  const secs = ((r.durationMs % 60000) / 1000).toFixed(0);
  const lines = [
    `${r.outcome}: ${r.target} ${r.outcome === 'PASS' ? 'equals' : 'vs'} ${r.build} (version ${r.version})`,
    ...r.cheap.map((c) => `  ${c}`),
    `  ranges: ${r.verified} of ${r.selected} selected verified, ${r.failed} failed, ${r.pending} pending (of ${r.totalRanges} in the plan)`,
    `  rows covered: ${r.rowsCovered} of ${r.totalRows} (${pct(r.rowsCovered, r.totalRows)}); selected ${r.rowsSelected} (${pct(r.rowsSelected, r.totalRows)})`,
    `  rows_read: ${r.rowsRead} this run (budget ${r.budget}${r.rowsReadAllRuns !== r.rowsRead ? `; ${r.rowsReadAllRuns} over all runs of this state` : ''}), ${r.statements} statement(s), ${mins}m ${secs}s`,
  ];
  if (r.stop) lines.push(`  stopped: ${r.stop}`);
  for (const m of r.mismatches.slice(0, 60)) lines.push(`  ${m}`);
  if (r.mismatches.length > 60) lines.push(`  ... and ${r.mismatches.length - 60} more`);
  if (r.outcome === 'INCOMPLETE') lines.push(`  resume: the same command with --resume (state ${path.relative(REPO_ROOT, r.stateFile)})`);
  return lines.join('\n');
}

/** The report beside a state file: state-X.json -> report-X.json, other.json -> other.report.json. @param {string} stateFile */
export function reportFileFor(stateFile) {
  const base = path.basename(stateFile);
  return path.join(path.dirname(stateFile), base.startsWith('state-') ? base.replace(/^state-/, 'report-') : base.replace(/(\.json)?$/, '.report.json'));
}

/** Exit code per outcome. */
export const EXIT = { PASS: 0, PLAN: 0, FAIL: 1, REFUSED: 2, INCOMPLETE: 3 };

if (process.argv[1] && path.basename(process.argv[1]) === 'safe-verify.mjs') {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const num = (/** @type {string} */ name) => { const v = opt(name); return v === null ? undefined : Number(v); };
  const against = opt('--against');
  const modes = [args.includes('--remote'), args.includes('--local'), Boolean(against)].filter(Boolean).length;
  if (modes !== 1) {
    console.error('say one of --remote, --local or --against FILE');
    process.exit(2);
  }
  const remote = args.includes('--remote');
  const file = path.resolve(opt('--db') || RECORDS_DB);
  if (!existsSync(file)) { console.error(`no build at ${file}`); process.exit(2); }
  const planOnly = args.includes('--plan');
  if (remote && !planOnly && !args.includes('--ignore-publish-state')) {
    const why = publishInProgress(PUBLISH_RUN_FILE);
    if (why) { console.error(`REFUSED: ${why}`); process.exit(2); }
  }
  /** @type {Query} */
  let query;
  /** @type {string} */
  let target;
  /** @type {(() => void) | null} */
  let closeTarget = null;
  if (against) {
    const db = openSqliteHandle(path.resolve(against), { readOnly: true });
    query = (sql) => /** @type {QueryRows} */ (db.prepare(sql).all().map((r) => ({ ...r })));
    target = `file ${path.basename(against)}`;
    closeTarget = () => db.close();
  } else {
    query = (sql) => wranglerQuery(sql, { remote });
    target = `${remote ? 'remote' : 'local'} D1 ${D1_NAME}`;
  }
  const since = opt('--since');
  const deltaDir = opt('--delta');
  const report = safeVerify({
    file, query, target, planOnly,
    stateFile: opt('--state') ? path.resolve(/** @type {string} */ (opt('--state'))) : undefined,
    cacheDir: opt('--cache-dir') ? path.resolve(/** @type {string} */ (opt('--cache-dir'))) : undefined,
    full: args.includes('--full'), sample: num('--sample'), deltaRanges: opt('--delta-ranges') === 'all' ? Infinity : num('--delta-ranges'), seed: num('--seed'), budget: num('--budget') ?? (args.includes('--full') ? Infinity : undefined),
    pauseMs: num('--pause-ms') ?? (against ? 0 : SAFE.pauseMs), rangeRows: num('--range-rows'), rangeBytes: num('--range-bytes'),
    resume: args.includes('--resume'), drill: num('--drill'), overloadRetries: num('--overload-retries'),
    since: since ? path.resolve(since) : null, deltaDir: deltaDir ? path.resolve(deltaDir) : null, noDelta: args.includes('--no-delta'),
    snapshot: against ? null : remote ? REMOTE_SNAPSHOT : LOCAL_SNAPSHOT, defaultDeltaDir: against ? null : DELTA_DIR,
  });
  closeTarget?.();
  console.log(formatReport(report));
  process.exit(EXIT[report.outcome]);
}
