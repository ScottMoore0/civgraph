#!/usr/bin/env node
/**
 * Does D1 hold the local build? Two modes.
 *
 * BOUNDED (the default against the remote database, and the only mode the publish uses)
 *
 * A remote check runs against the database that is serving production. On 2026-11-06 at 21:07 the
 * old check (one COUNT(*) + SUM(row_hash_n) full scan per table, 47 tables, in one wrangler call)
 * made D1 answer "D1 DB is overloaded" (7429) and production /_api answered 500/503 for about two
 * minutes. So a bounded check reads only what it can name:
 *
 *   - the dataset rows (version, table checksums as recorded, loading cleared), LIMIT 100;
 *   - the schema (sqlite_master), LIMIT 1000;
 *   - per table the delta touched (rows upserted or deleted between the snapshot loaded before,
 *     `since`, and the build), the rows the delta wrote, looked up by primary key in batches of
 *     at most 200 keys (and about 4 MB of row data): every upserted key present with the build's
 *     row_hash, every deleted key absent. A table whose delta is over 1,000 keys is checked on an
 *     even sample of 1,000 of them, and says so;
 *   - per touched table small enough (at most 1,000 rows and 16 MB in the build), its count and
 *     SUM(row_hash_n) over `SELECT row_hash_n FROM t LIMIT 1001`: bounded by the LIMIT, and it
 *     still sees a row too many;
 *   - with no `since` (a --check, a full load), every table is sampled: 50 keys spread evenly
 *     over its rowids (verify --sample N).
 *
 * One statement per wrangler call, 1.5 s apart (--pause-ms). A 7429 is retried after 15, 30, 60,
 * 120 and 240 s; any other error fails at once. Nothing is retried in a tight loop.
 *
 * The bounded check proves the delta landed, not that rows nobody touched are still right: that
 * rests on the previous verified load (the snapshot is replaced only after a PASS) and on the
 * delta being the only writer.
 *
 * FULL (--full-verify; the default against the local D1, which is a file on this machine)
 *
 * Per table, COUNT(*) and SUM(row_hash_n) of the whole table, locally (the SQLite build) and in D1,
 * one table per wrangler call, plus the schema. Against the remote database this reads every row
 * of every table (about 4 million rows, 4 GB): NEVER run it against the live database at a busy
 * time, and never from the publish. It is for a quiet hour after a recovery (records:deploy
 * --remote --resync requires it).
 *
 *   node packages/loader/src/verify-load.mjs --local  [--db FILE] [--since FILE] [--bounded] [--sample N]
 *   node packages/loader/src/verify-load.mjs --remote [--db FILE] [--since FILE] [--sample N] [--pause-ms N]
 *                                                  (bounded; only inside an approved publish or --check)
 *   node packages/loader/src/verify-load.mjs --remote --full-verify      (full scan: quiet hours only)
 *
 * Exits non-zero on any difference, naming the tables. Wrangler's output is redirected to a file
 * and read back (piping wrangler through a shell on Windows loses output), and the R2 variables
 * are removed from its environment (they make D1 calls fail with "Authentication error 10000").
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openSqliteHandle } from '../../storage/src/sqlite.mjs';
import { datasetLoadState, LOADING_KEY } from './dataset-state.mjs';
import { snapshotTable } from './db.mjs';
import { verifyModeFor } from './deploy-plan.mjs';
import { q } from './diff-load.mjs';
import { buildVar } from '../../config/src/node.mjs';
import { RECORDS_DB, REPO_ROOT } from './paths.mjs';
import { HASHED_TABLES } from '../../schema/src/schema.mjs';

/** @typedef {import('../../storage/src/sqlite.mjs').SqliteHandle} SqliteHandle */
/** @typedef {import('../../schema/src/schema.mjs').TableSpec} TableSpec */
/** A value as D1 answers it in wrangler's JSON (TEXT, INTEGER/REAL, NULL). @typedef {string | number | null} D1Value */
/** A sqlite_master row (name, sql): read locally or from D1. @typedef {{ name?: unknown, sql?: unknown }} SchemaRow */
/** Per table: COUNT(*) and SUM(row_hash_n). @typedef {Record<string, { n: number, s: number }>} TableSums */
/** @typedef {{ tables: TableSums, schema: SchemaRow[] }} Checksums */
/**
 * A row's primary key as verify compares it: `key` is the JSON of its values as text, `hash` its
 * row_hash (null: deleted), `bytes` the size of its values.
 * @typedef {{ key: string, values: unknown[], hash: string | null, bytes: number }} KeyRef
 */
/** @typedef {{ deleted: KeyRef[], upserted: KeyRef[], sampled?: boolean }} TouchedKeys */

/**
 * The D1 database behind the ELECTIONS_DB binding, read from wrangler.toml's production
 * [[d1_databases]] block, so the binding the Functions use and the database every records
 * command loads or verifies are one setting (go-live switches both by editing wrangler.toml).
 */
/** @param {string} tomlText */
export function recordsDbName(tomlText) {
  const top = String(tomlText).split(/^\[env\./m)[0];
  for (const block of top.split(/^\[\[d1_databases\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\[/m)[0];
    if (/^\s*binding\s*=\s*"ELECTIONS_DB"/m.test(body)) {
      const m = body.match(/^\s*database_name\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    }
  }
  throw new Error('wrangler.toml has no production [[d1_databases]] block for ELECTIONS_DB');
}
export const D1_NAME = recordsDbName(readFileSync(path.join(REPO_ROOT, 'wrangler.toml'), 'utf8'));
export const PERSIST_DIR = '.wrangler/state';

/** wrangler's entry script: CIVGRAPH_WRANGLER_JS, the project's, the global install, or `npm root -g`. */
export const WRANGLER = (() => {
  const candidates = /** @type {string[]} */ ([
    buildVar('CIVGRAPH_WRANGLER_JS'),
    path.join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  ].filter(Boolean));
  const found = candidates.find((c) => existsSync(c));
  if (found) return found;
  const root = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout?.trim();
  return root ? path.join(root, 'wrangler', 'bin', 'wrangler.js') : candidates[1];
})();

export function d1Env() {
  const env = { ...process.env };
  for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_S3_ENDPOINT']) delete env[k];
  return env;
}

/** The limits of the bounded mode (exported for the tests). */
export const BOUNDS = {
  batchKeys: 200,
  batchBytes: 4 * 1024 * 1024,
  // wrangler takes the SQL on its command line, and Windows caps a command line at 32,767 characters.
  statementBytes: 24 * 1024,
  // D1 refuses a compound SELECT of more than 5 terms: "too many terms in compound SELECT:
  // SQLITE_ERROR [code: 7500]" (found 11 Nov 2026; a plain SQLite allows 500).
  compoundTerms: 5,
  maxKeysPerTable: 1000,
  sampleKeys: 50,
  smallTableRows: 1000,
  smallTableBytes: 16 * 1024 * 1024,
  pauseMs: 1500,
  backoffMs: [15_000, 30_000, 60_000, 120_000, 240_000],
};

const tableChecksumSql = (/** @type {Pick<TableSpec, 'name'>} */ t) => `SELECT '${t.name}' AS t, COUNT(*) AS n, COALESCE(SUM(row_hash_n), 0) AS s FROM ${t.name}`;
const SCHEMA_SQL = "SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name";
const DATASET_SQL = 'SELECT key, value FROM dataset ORDER BY key LIMIT 100';
/** Dataset keys a load writes that are not the build's own. */
const LOAD_KEYS = new Set([LOADING_KEY, 'loaded_at']);

/**
 * Run SQL through wrangler d1 execute and return the result rows.
 * @param {string} sql
 * @param {{ remote?: boolean, cwd?: string }} [options]
 * @returns {QueryRows}
 */
export function wranglerQuery(sql, { remote = false, cwd = REPO_ROOT } = {}) {
  const dir = path.join(REPO_ROOT, 'tmp', 'records');
  mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `wrangler-${process.pid}-${Date.now()}.json`);
  const fd = openSync(outFile, 'w');
  const target = remote ? ['--remote'] : ['--local', '--persist-to', PERSIST_DIR];
  // wrangler's own entry script under node, with no shell: a shell on Windows splits the SQL.
  const res = spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', D1_NAME, ...target, '--json', '--command', sql], {
    cwd, env: d1Env(), stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  closeSync(fd);
  const text = readFileSync(outFile, 'utf8');
  rmSync(outFile, { force: true });
  return parseWranglerOutput(res.status, text, res.stderr || '');
}

/** The exit status of a process that aborted on Windows (0xC0000409, STATUS_STACK_BUFFER_OVERRUN). */
export const WINDOWS_ABORT_STATUS = 0xC0000409;

/**
 * A failed `wrangler d1 execute`. `d1Code` is D1's error code when wrangler printed D1's answer
 * (7429 overloaded, 7403, 7500 an SQL error...); `crashed` says the wrangler process itself
 * aborted. On Windows (Node 24, wrangler 4.85) wrangler aborts on the way out of every error,
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76", exit
 * 0xC0000409, and stderr then holds only that line: D1's own error is the JSON on stdout.
 */
export class WranglerError extends Error {
  /** @param {string} message @param {{ status: number | null, d1Code?: number, crashed?: boolean }} info */
  constructor(message, { status, d1Code, crashed = false }) {
    super(message);
    this.status = status;
    this.d1Code = d1Code;
    this.crashed = crashed;
  }
}

/** True for wrangler's own abort with no answer from D1 on stdout (the statement may or may not have run). */
export const isWranglerCrash = (/** @type {unknown} */ error) => error instanceof WranglerError && error.crashed && error.d1Code === undefined;

/** Cloudflare API paths name the account and database: kept out of messages and state files. */
const redactApiPath = (/** @type {string} */ s) => s.replace(/\/accounts\/[^/\s)]+/g, '/accounts/<account>').replace(/\/database\/[^/\s)]+/g, '/database/<id>');

/**
 * wrangler d1 execute --json's exit status, stdout and stderr, as result rows or a WranglerError.
 * Rows when it exited 0, or when it aborted on the way out after printing a whole successful answer.
 * An error carries D1's message and code from stdout's {"error": ...} (stderr may hold only the abort).
 * @param {number | null} status
 * @param {string} text stdout
 * @param {string} stderr
 * @returns {QueryRows}
 */
export function parseWranglerOutput(status, text, stderr) {
  const crashed = status === WINDOWS_ABORT_STATUS || /Assertion failed: .*UV_HANDLE_CLOSING/.test(stderr);
  const starts = [text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0);
  /** @type {unknown} */
  let parsed;
  if (starts.length) {
    try { parsed = JSON.parse(text.slice(Math.min(...starts))); } catch { /* not whole JSON */ }
  }
  if (parsed === undefined && status === 0 && text.includes('[')) {
    try { parsed = JSON.parse(text.slice(text.indexOf('['))); } catch { /* reported below */ }
  }
  const answer = /** @type {{ success?: boolean }[]} */ (Array.isArray(parsed) ? parsed : []);
  if (Array.isArray(parsed) && (status === 0 || (crashed && answer.every((r) => r && typeof r === 'object' && r.success !== false)))) {
    return resultRows(/** @type {{ results?: Record<string, D1Value>[], meta?: { rows_read?: number, duration?: number } }[]} */ (parsed));
  }
  const abort = crashed ? `; wrangler then aborted (${String(stderr).trim().split(/\r?\n/).pop()?.slice(0, 160) || `exit ${status}`})` : '';
  const err = /** @type {{ error?: { text?: string, code?: number, notes?: { text?: string }[] } } | undefined} */ (parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : undefined)?.error;
  if (err && typeof err === 'object') {
    const notes = (err.notes || []).map((n) => n?.text).filter(Boolean);
    const said = redactApiPath(notes.length ? notes.join('; ') : String(err.text || 'an error'));
    const code = Number.isInteger(err.code) ? Number(err.code) : Number((said.match(/\[code: (\d+)\]/) || [])[1]) || undefined;
    throw new WranglerError(`wrangler d1 execute failed (${status}): ${said}${code && !said.includes(`[code: ${code}]`) ? ` [code: ${code}]` : ''}${abort}`, { status, d1Code: code, crashed });
  }
  if (status === 0) throw new WranglerError(`wrangler d1 execute printed no JSON answer: ${redactApiPath(text.slice(0, 300))}`, { status });
  throw new WranglerError(`wrangler d1 execute failed (${status}): ${redactApiPath((stderr || text).slice(-800))}`, { status, crashed });
}

/**
 * D1's answers as one list of rows, with D1's rows_read and SQL time attached.
 * @param {{ results?: Record<string, D1Value>[], meta?: { rows_read?: number, duration?: number } }[]} parsed
 * @returns {QueryRows}
 */
function resultRows(parsed) {
  /** @type {QueryRows} */
  const rows = parsed.flatMap((r) => r.results || []);
  // D1's own count of the rows the statement read, for the cost line runPlan prints.
  // (The local D1 does not report it.)
  if (parsed.some((r) => r.meta && 'rows_read' in r.meta)) {
    Object.defineProperty(rows, 'rowsRead', { value: parsed.reduce((n, r) => n + Number(r.meta?.rows_read || 0), 0), enumerable: false });
  }
  // D1's time in SQL (ms): safe-verify.mjs slows down when the database is slow to answer.
  if (parsed.some((r) => r.meta && 'duration' in r.meta)) {
    Object.defineProperty(rows, 'durationMs', { value: parsed.reduce((n, r) => n + Number(r.meta?.duration || 0), 0), enumerable: false });
  }
  return rows;
}

export const sleepSync = (/** @type {number} */ ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export const isOverloaded = (/** @type {unknown} */ error) => /7429|overloaded/i.test(String(/** @type {{ message?: string } | null | undefined} */ (error)?.message || error));

/**
 * Cloudflare's "The given account is not valid or is not authorized to access this service
 * [code: 7403]". On 8 Nov 2026 two publishes failed with it on the bounded verify's reads straight
 * after a successful load; the same reads passed alone minutes later and a third publish went
 * through, so it is treated as transient and retried like a 7429 (a real permission fault still
 * fails, after the last backoff).
 */
export const isTransientAuth = (/** @type {unknown} */ error) => /\b7403\b/.test(String(/** @type {{ message?: string } | null | undefined} */ (error)?.message || error));

/**
 * `query(sql)` with a 7429 (overloaded) or a 7403 (the transient authorisation refusal above)
 * retried after each wait in `backoffMs` (never at once, never more often than that list says);
 * any other error is thrown as it is.
 * @param {Query} query
 * @param {string} sql
 * @param {{ remote?: boolean }} opts
 * @param {{ backoffMs?: number[], sleep?: (ms: number) => void, log?: (line: string) => void }} [retry]
 * @returns {QueryRows}
 */
export function queryWithRetry(query, sql, opts, { backoffMs = BOUNDS.backoffMs, sleep = sleepSync, log = console.warn } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return query(sql, opts);
    } catch (error) {
      const auth = isTransientAuth(error);
      if (!(isOverloaded(error) || auth) || attempt >= backoffMs.length) throw error;
      log(`  D1 ${auth ? 'refused the request (7403)' : 'overloaded (7429)'}; waiting ${backoffMs[attempt] / 1000}s before retry ${attempt + 1} of ${backoffMs.length}`);
      sleep(backoffMs[attempt]);
    }
  }
}

// ------------------------------------------------------------------ the full mode

/**
 * @param {string} file
 * @returns {Checksums}
 */
export function localChecksums(file) {
  const db = openSqliteHandle(file, { readOnly: true });
  const rows = HASHED_TABLES.map((t) => /** @type {{ t: string, n: number, s: number }} */ (db.prepare(tableChecksumSql(t)).get()));
  const schema = db.prepare(SCHEMA_SQL).all();
  db.close();
  return { tables: Object.fromEntries(rows.map((r) => [r.t, { n: Number(r.n), s: Number(r.s) }])), schema };
}

const norm = (/** @type {unknown} */ sql) => String(sql || '').replace(/\s+/g, ' ').trim();

/**
 * @param {SchemaRow[]} localSchema
 * @param {SchemaRow[]} remoteSchema
 */
function compareSchema(localSchema, remoteSchema) {
  const remote = new Map(remoteSchema.map((r) => [r.name, norm(r.sql)]));
  return localSchema.filter((r) => remote.get(r.name) !== norm(r.sql)).map((r) => `schema ${r.name} differs or is missing`);
}

/**
 * Compare a local database's full checksums with D1's (or with any query function, for tests).
 * @param {Checksums} local
 * @param {Checksums} remote
 */
export function compareLoad(local, remote) {
  /** @type {string[]} */
  const mismatches = [];
  for (const t of HASHED_TABLES) {
    const a = local.tables[t.name];
    const b = remote.tables[t.name];
    if (!b || a.n !== b.n || a.s !== b.s) mismatches.push(`${t.name}: local ${a?.n}/${a?.s}, D1 ${b?.n}/${b?.s}`);
  }
  mismatches.push(...compareSchema(local.schema, remote.schema));
  return mismatches;
}

/**
 * The full mode as steps: one whole-table checksum per statement, then the schema.
 * @param {string} file
 * @returns {Plan}
 */
export function fullPlan(file) {
  const local = localChecksums(file);
  /** @type {PlanStep[]} */
  const steps = HASHED_TABLES.map((t) => ({
    label: `${t.name} (full scan)`,
    sql: tableChecksumSql(t),
    check: (rows) => compareLoad({ tables: { [t.name]: local.tables[t.name] }, schema: [] }, {
      tables: Object.fromEntries(rows.map((r) => [r.t, { n: Number(r.n), s: Number(r.s) }])), schema: [],
    }).filter((m) => m.startsWith(`${t.name}:`)),
  }));
  steps.push({ label: 'schema', sql: SCHEMA_SQL, check: (rows) => compareSchema(local.schema, rows) });
  return { steps, notes: [], mode: 'full' };
}

// ------------------------------------------------------------------ the bounded mode

const keyOf = (/** @type {string[]} */ pk, /** @type {Record<string, unknown>} */ row) => JSON.stringify(pk.map((c) => (row[c] === null || row[c] === undefined ? null : String(row[c]))));
const bytesExpr = (/** @type {TableSpec} */ t, alias = '') => t.columns.map((c) => `COALESCE(length(${alias}${c.name}), 0)`).join(' + ');

/**
 * The keys the delta from `since` to the build touched, per table: the same comparison
 * diff-load.mjs makes (primary key plus row_hash), reading keys, hashes and sizes only.
 * @param {SqliteHandle} db
 * @param {TableSpec[]} [tables]
 * @returns {Record<string, TouchedKeys>}
 */
export function deltaKeys(db, tables = HASHED_TABLES) {
  /** @type {Record<string, TouchedKeys>} */
  const out = {};
  for (const t of tables) {
    const pk = t.pk.join(', ');
    const ft = snapshotTable(db, 'f', t);
    const deleted = db.prepare(`SELECT ${pk} FROM ${ft} EXCEPT SELECT ${pk} FROM main.${t.name} ORDER BY ${pk}`).all()
      .map((r) => ({ key: keyOf(t.pk, r), values: t.pk.map((c) => r[c]), hash: null, bytes: 0 }));
    const join = t.pk.map((c) => `${ft}.${c} = m.${c}`).join(' AND ');
    const upserted = db.prepare(
      `SELECT ${t.pk.map((c) => `m.${c}`).join(', ')}, m.row_hash AS row_hash, ${bytesExpr(t, 'm.')} AS bytes FROM main.${t.name} m `
      + `LEFT JOIN ${ft} ON ${join} WHERE ${ft}.row_hash IS NOT m.row_hash ORDER BY ${t.pk.map((c) => `m.${c}`).join(', ')}`,
    ).all().map((r) => ({ key: keyOf(t.pk, r), values: t.pk.map((c) => r[c]), hash: /** @type {string} */ (r.row_hash), bytes: Number(r.bytes) }));
    if (deleted.length || upserted.length) out[t.name] = { deleted, upserted };
  }
  return out;
}

/**
 * About `n` rows of a table spread evenly over its rowids (rowid lookups, no scan).
 * @param {SqliteHandle} db
 * @param {TableSpec} t
 * @param {number} n
 * @returns {KeyRef[]}
 */
export function sampleKeys(db, t, n) {
  const range = /** @type {{ lo: number | null, hi: number | null }} */ (db.prepare(`SELECT MIN(rowid) AS lo, MAX(rowid) AS hi FROM ${t.name}`).get());
  if (range.lo === null || range.lo === undefined) return [];
  const lo = Number(range.lo);
  const hi = Number(range.hi);
  const ids = [...new Set(Array.from({ length: n }, (_, i) => Math.round(lo + ((hi - lo) * i) / Math.max(1, n - 1))))];
  return db.prepare(`SELECT ${t.pk.join(', ')}, row_hash, ${bytesExpr(t)} AS bytes FROM ${t.name} WHERE rowid IN (${ids.join(', ')})`).all()
    .map((r) => ({ key: keyOf(t.pk, r), values: t.pk.map((c) => r[c]), hash: /** @type {string} */ (r.row_hash), bytes: Number(r.bytes) }));
}

/**
 * Every k-th of a list, at most `n` of them, first and last kept.
 * @template T
 * @param {T[]} list
 * @param {number} n
 * @returns {T[]}
 */
export function evenSample(list, n) {
  if (list.length <= n) return list;
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out;
}

/**
 * A keyed lookup: the rows of `keys` by primary key, with their row_hash. Uses the key's index.
 * @param {TableSpec} t
 * @param {KeyRef[]} keys
 */
export function keyedSql(t, keys) {
  const where = t.pk.length === 1
    ? `${t.pk[0]} IN (${keys.map((k) => q(k.values[0])).join(', ')})`
    : `(${t.pk.join(', ')}) IN (VALUES ${keys.map((k) => `(${k.values.map(q).join(', ')})`).join(', ')})`;
  return `SELECT ${t.pk.join(', ')}, row_hash FROM ${t.name} WHERE ${where}`;
}

/**
 * Batches of at most batchKeys keys, batchBytes of row data and statementBytes of SQL.
 * @param {TableSpec} t
 * @param {KeyRef[]} keys
 * @param {typeof BOUNDS} [bounds]
 * @returns {KeyRef[][]}
 */
export function batches(t, keys, bounds = BOUNDS) {
  /** @type {KeyRef[][]} */
  const out = [];
  /** @type {KeyRef[]} */
  let cur = [];
  let bytes = 0;
  let sqlBytes = 0;
  for (const k of keys) {
    const lit = k.values.map(q).join(', ').length + 6;
    if (cur.length && (cur.length >= bounds.batchKeys || bytes + k.bytes > bounds.batchBytes || sqlBytes + lit > bounds.statementBytes - 512)) {
      out.push(cur);
      cur = [];
      bytes = 0;
      sqlBytes = 0;
    }
    cur.push(k);
    bytes += k.bytes;
    sqlBytes += lit;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A small table's count and checksum, bounded by LIMIT: it still sees one row too many. */
export const boundedChecksumSql = (/** @type {Pick<TableSpec, 'name'>} */ t, /** @type {number} */ limit) => `SELECT COUNT(*) AS n, COALESCE(SUM(row_hash_n), 0) AS s FROM (SELECT row_hash_n FROM ${t.name} LIMIT ${limit})`;

/**
 * The bounded verification as a list of steps ({label, sql, check(rows) -> mismatches}), built
 * from local files only. `since` is the snapshot D1 held before this load (null: sample every
 * table).
 */
/**
 * @typedef {Record<string, D1Value>[] & { rowsRead?: number, durationMs?: number }} QueryRows
 * @typedef {(sql: string, opts: { remote?: boolean }) => QueryRows} Query
 * @typedef {{ label: string, sql: string, check: (rows: QueryRows) => string[] }} PlanStep
 * @typedef {{ steps: PlanStep[], notes: string[], mode: 'bounded'|'full' }} Plan
 */

/**
 * @param {{ file: string, since?: string|null, sample?: number, bounds?: typeof BOUNDS }} options
 * @returns {Plan}
 */
export function boundedPlan({ file, since = null, sample = BOUNDS.sampleKeys, bounds = BOUNDS }) {
  const db = openSqliteHandle(file, { readOnly: true });
  /** @type {string[]} */
  const notes = [];
  /** @type {PlanStep[]} */
  const steps = [];
  try {
    const dataset = /** @type {{ key: string, value: string|null }[]} */ (db.prepare('SELECT key, value FROM dataset ORDER BY key').all());
    /** @type {TableSums} */
    const recorded = JSON.parse(dataset.find((r) => r.key === 'table_checksums')?.value || '{}');
    steps.push({
      label: 'dataset',
      sql: DATASET_SQL,
      check: (rows) => {
        const remote = new Map(rows.map((r) => [r.key, r.value]));
        /** @type {string[]} */
        const out = [];
        for (const r of dataset) {
          if (LOAD_KEYS.has(r.key)) continue;
          if (remote.get(r.key) !== r.value) out.push(`dataset ${r.key}: local ${String(r.value).slice(0, 40)}, D1 ${String(remote.get(r.key) ?? '(absent)').slice(0, 40)}`);
        }
        if (datasetLoadState(remote.get(LOADING_KEY)) === 'loading') out.push(`dataset loading is '${remote.get(LOADING_KEY)}': the load did not finish`);
        return out;
      },
    });
    const schema = db.prepare(SCHEMA_SQL).all();
    steps.push({ label: 'schema', sql: `${SCHEMA_SQL} LIMIT 1000`, check: (rows) => compareSchema(schema, rows) });

    /** @type {Record<string, TouchedKeys>} */
    let touched;
    if (since) {
      db.exec(`ATTACH DATABASE '${since.replace(/'/g, "''")}' AS f`);
      touched = deltaKeys(db);
      db.exec('DETACH DATABASE f');
    } else {
      touched = Object.fromEntries(HASHED_TABLES.map((t) => [t.name, { deleted: [], upserted: sampleKeys(db, t, sample), sampled: true }]));
      notes.push(`no snapshot to diff against: every table sampled (${sample} keys spread over its rows)`);
    }

    for (const t of HASHED_TABLES) {
      const d = touched[t.name];
      if (!d) continue;
      let keys = [...d.upserted, ...d.deleted];
      if (keys.length > bounds.maxKeysPerTable) {
        notes.push(`${t.name}: ${keys.length} keys touched, an even sample of ${bounds.maxKeysPerTable} checked`);
        keys = evenSample(keys, bounds.maxKeysPerTable);
      }
      for (const [i, batch] of batches(t, keys, bounds).entries()) {
        const expect = new Map(batch.map((k) => [k.key, k.hash]));
        steps.push({
          label: `${t.name} keys ${i + 1} (${batch.length})`,
          sql: keyedSql(t, batch),
          check: (rows) => {
            /** @type {string[]} */
            const out = [];
            const got = new Map(rows.map((r) => [keyOf(t.pk, r), r.row_hash]));
            for (const [k, hash] of expect) {
              if (hash === null && got.has(k)) out.push(`${t.name} ${k}: deleted locally, still in D1`);
              if (hash !== null && !got.has(k)) out.push(`${t.name} ${k}: missing in D1`);
              if (hash !== null && got.has(k) && got.get(k) !== hash) out.push(`${t.name} ${k}: row_hash local ${hash.slice(0, 10)}, D1 ${String(got.get(k)).slice(0, 10)}`);
            }
            return out;
          },
        });
      }
      const n = recorded[t.name]?.n ?? Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get()?.n);
      if (n <= bounds.smallTableRows) {
        const size = Number(db.prepare(`SELECT COALESCE(SUM(${bytesExpr(t)}), 0) AS b FROM (SELECT * FROM ${t.name} LIMIT ${bounds.smallTableRows + 1})`).get()?.b);
        if (size <= bounds.smallTableBytes) {
          const s = recorded[t.name]?.s ?? Number(db.prepare(`SELECT COALESCE(SUM(row_hash_n), 0) AS s FROM ${t.name}`).get()?.s);
          steps.push({
            label: `${t.name} count+checksum (LIMIT ${n + 1})`,
            sql: boundedChecksumSql(t, n + 1),
            check: (rows) => {
              const r = rows[0] || {};
              return Number(r.n) === n && Number(r.s) === s ? [] : [`${t.name}: local ${n}/${s}, D1 ${r.n}/${r.s}`];
            },
          });
        }
      }
    }
  } finally {
    db.close();
  }
  return { steps, notes, mode: 'bounded' };
}

/**
 * Run a plan: one statement per call, a pause between calls, a 7429 retried with backoff.
 * @param {Plan} plan
 * @param {{ remote?: boolean, query?: Query, pauseMs?: number, sleep?: (ms: number) => void,
 *   log?: (line: string) => void, backoffMs?: number[] }} [options]
 * @returns {string[]} the mismatches
 */
export function runPlan(plan, { remote = false, query = wranglerQuery, pauseMs = BOUNDS.pauseMs, sleep = sleepSync, log = () => {}, backoffMs } = {}) {
  /** @type {string[]} */
  const mismatches = [];
  let rowsRead = 0;
  plan.steps.forEach((step, i) => {
    if (i > 0) sleep(pauseMs);
    const rows = queryWithRetry(query, step.sql, { remote }, { sleep, backoffMs, log });
    const found = step.check(rows);
    rowsRead += Number(rows.rowsRead || 0);
    log(`  ${found.length ? 'FAIL' : 'ok  '} ${step.label}${rows.rowsRead !== undefined ? ` (${rows.rowsRead} rows read)` : ''}`);
    mismatches.push(...found);
  });
  log(`  verify ran ${plan.steps.length} statement(s)${rowsRead ? `, D1 read ${rowsRead} rows` : ''}`);
  return mismatches;
}

/**
 * Verify a load. mode: 'bounded' (the default for the remote database) or 'full' (the default
 * for the local D1; against the remote only with --full-verify, at a quiet time).
 * @param {{ file: string, remote?: boolean, mode?: 'bounded'|'full', since?: string|null, sample?: number,
 *   query?: Query, pauseMs?: number, sleep?: (ms: number) => void, log?: (line: string) => void,
 *   bounds?: typeof BOUNDS }} options
 * @returns {string[]} the mismatches
 */
export function verify({ file, remote = false, mode = remote ? 'bounded' : 'full', since = null, sample, query = wranglerQuery, pauseMs, sleep, log, bounds } = /** @type {{ file: string }} */ ({})) {
  const plan = mode === 'full' ? fullPlan(file) : boundedPlan({ file, since, sample, bounds });
  for (const note of plan.notes) (log || console.log)(`  note: ${note}`);
  (log || console.log)(`  verify (${plan.mode}, ${remote ? 'remote' : 'local'}): ${plan.steps.length} statement(s), one per call`);
  return runPlan(plan, { remote, query, pauseMs: pauseMs ?? (remote ? BOUNDS.pauseMs : 0), sleep, log: log || console.log });
}

if (process.argv[1] && path.basename(process.argv[1]) === 'verify-load.mjs') {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const remote = args.includes('--remote');
  if (remote === args.includes('--local')) {
    console.error('say --local or --remote');
    process.exit(1);
  }
  const file = path.resolve(opt('--db') || RECORDS_DB);
  const sinceOption = opt('--since');
  const since = sinceOption ? path.resolve(sinceOption) : null;
  const mode = verifyModeFor({ remote, fullVerify: args.includes('--full-verify'), bounded: args.includes('--bounded') });
  if (remote && mode === 'full') console.warn('WARNING: --full-verify scans every row of every table of the live database (about 4 GB): quiet hours only');
  const mismatches = verify({
    file, remote, mode, since,
    sample: opt('--sample') ? Number(opt('--sample')) : undefined,
    pauseMs: opt('--pause-ms') ? Number(opt('--pause-ms')) : undefined,
  });
  if (mismatches.length) {
    console.error(`FAIL: ${remote ? 'remote' : 'local'} D1 differs from ${path.relative(REPO_ROOT, file)}`);
    for (const m of mismatches.slice(0, 50)) console.error(`  ${m}`);
    if (mismatches.length > 50) console.error(`  ... and ${mismatches.length - 50} more`);
    process.exit(1);
  }
  console.log(`PASS: ${remote ? 'remote' : 'local'} D1 equals ${path.relative(REPO_ROOT, file)} (${mode})`);
}
