#!/usr/bin/env node
/**
 * The delta between two records databases, as SQL for `wrangler d1 execute --file` (stage E).
 *
 *   node packages/loader/src/diff-load.mjs --to <new.sqlite> [--from <last-loaded.sqlite>] --out tmp/records/delta.sql
 *
 * Per table of packages/schema/src/schema.mjs, on primary key plus row_hash:
 *   - rows gone from the new database:  DELETE ... WHERE (pk) IN (VALUES ...), at most 100 per statement
 *   - rows new or changed:              INSERT OR REPLACE ..., statements capped at 60 KB
 * Without --from it is a full load: DELETE FROM every table, then every row.
 *
 * A value too large for one statement (D1 refuses statements over 100 KB) is inserted empty and
 * appended in pieces with UPDATE ... SET col = col || '<piece>'. The first line marks the dataset
 * as loading (the Functions then cache nothing); the last writes the new version and clears it.
 * Every statement is idempotent (DELETE by key, INSERT OR REPLACE, and appends that start from an
 * insert of the same row), so a half-applied file can be run again from the top.
 * No BEGIN/COMMIT: D1 rejects them in files.
 */
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { openSqliteHandle } from '@civgraph/storage/node';
import { HASHED_TABLES, TABLES } from '@civgraph/schema';
import { DATASET_LOAD, LOADING_KEY, loadingValue } from './dataset-state.mjs';
import { snapshotTable } from './db.mjs';

export const MAX_STATEMENT_BYTES = 60 * 1024;
const MAX_DELETE_KEYS = 100;
const PIECE_CHARS = 20_000;

/** @typedef {import('@civgraph/schema').TableSpec} TableSpec */
/** @typedef {import('@civgraph/storage/node').SqliteHandle} SqliteHandle */

/** A value as an SQL literal. */
export const q = (/** @type {unknown} */ value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  return `'${String(value).replace(/'/g, "''")}'`;
};

/** Children before parents for deletes, parents before children for inserts. */
export function tableOrder() {
  /** @type {TableSpec[]} */
  const order = [];
  const seen = new Set();
  const visit = (/** @type {TableSpec} */ t) => {
    if (seen.has(t.name)) return;
    seen.add(t.name);
    for (const p of t.parents || []) visit(/** @type {TableSpec} */ (TABLES.find((x) => x.name === p)));
    order.push(t);
  };
  for (const t of HASHED_TABLES) visit(t);
  return order;
}

/**
 * @typedef {{ deleted: number, upserted: number }} TableDelta
 * @typedef {{ summary: Record<string, TableDelta>, statements: number, version: string, full: boolean,
 *   touched?: Record<string, TouchedKeys> }} DeltaResult
 */

// ------------------------------------------------------------------ the keys a delta touches
// The bounded verify (verify-load.mjs) checks in D1 the rows the delta wrote. It used to find
// them by diffing the two databases a second time (deltaKeys below); buildDelta now collects
// them as it writes the delta (collectKeys), from the same queries, so the publish diffs once.

/**
 * A row's primary key as verify compares it: `key` is the JSON of its values as text, `hash` its
 * row_hash (null: deleted), `bytes` the size of its values.
 * @typedef {{ key: string, values: unknown[], hash: string | null, bytes: number }} KeyRef
 * @typedef {{ deleted: KeyRef[], upserted: KeyRef[], sampled?: boolean }} TouchedKeys
 */

/** @param {string[]} pk @param {Record<string, unknown>} row */
export const keyOf = (pk, row) => JSON.stringify(pk.map((c) => (row[c] === null || row[c] === undefined ? null : String(row[c]))));
/** The size of a row's values, as SQLite counts it (length() of each value). */
export const bytesExpr = (/** @type {TableSpec} */ t, alias = '') => t.columns.map((c) => `COALESCE(length(${alias}${c.name}), 0)`).join(' + ');
/** The column buildDelta adds to its upsert query when it collects keys (never written to D1). */
const BYTES_COLUMN = 'verify_bytes__';

/** @param {TableSpec} t @param {Record<string, unknown>} r @returns {KeyRef} */
const deletedRef = (t, r) => ({ key: keyOf(t.pk, r), values: t.pk.map((c) => r[c]), hash: null, bytes: 0 });
/** @param {TableSpec} t @param {Record<string, unknown>} r @param {string} bytesColumn @returns {KeyRef} */
const upsertedRef = (t, r, bytesColumn) => ({ key: keyOf(t.pk, r), values: t.pk.map((c) => r[c]), hash: /** @type {string} */ (r['row_hash']), bytes: Number(r[bytesColumn]) });

/** The deleted keys of a table: in the snapshot (`ft`), not in the build. */
const goneSql = (/** @type {TableSpec} */ t, /** @type {string} */ ft) => {
  const pk = t.pk.join(', ');
  return `SELECT ${pk} FROM ${ft} EXCEPT SELECT ${pk} FROM main.${t.name} ORDER BY ${pk}`;
};
/** The build's rows that are new or changed against the snapshot (`ft`), by key. */
const changedWhere = (/** @type {TableSpec} */ t, /** @type {string} */ ft) => `LEFT JOIN ${ft} ON ${t.pk.map((c) => `${ft}.${c} = m.${c}`).join(' AND ')} WHERE ${ft}.row_hash IS NOT m.row_hash ORDER BY ${t.pk.map((c) => `m.${c}`).join(', ')}`;

/**
 * The keys the delta from the attached snapshot `f` to the build touched, per table: the same
 * comparison buildDelta makes (primary key plus row_hash), reading keys, hashes and sizes only.
 * @param {SqliteHandle} db the build, with the snapshot attached as `f`
 * @param {TableSpec[]} [tables]
 * @returns {Record<string, TouchedKeys>}
 */
export function deltaKeys(db, tables = HASHED_TABLES) {
  /** @type {Record<string, TouchedKeys>} */
  const out = {};
  for (const t of tables) {
    const ft = snapshotTable(db, 'f', t);
    const deleted = db.prepare(goneSql(t, ft)).all().map((r) => deletedRef(t, r));
    const upserted = db.prepare(
      `SELECT ${t.pk.map((c) => `m.${c}`).join(', ')}, m.row_hash AS row_hash, ${bytesExpr(t, 'm.')} AS bytes FROM main.${t.name} m ${changedWhere(t, ft)}`,
    ).all().map((r) => upsertedRef(t, r, 'bytes'));
    if (deleted.length || upserted.length) out[t.name] = { deleted, upserted };
  }
  return out;
}

/**
 * Write the delta. `from` may be null (full load). Returns per-table counts and the statement
 * count. `write(text)` receives statements, one per line. With `collectKeys` (and a snapshot) the
 * result also holds `touched`: per table, the keys deleted and upserted, exactly what deltaKeys
 * returns for the same two databases. Collecting changes nothing that is written.
 * @param {{ toFile: string, fromFile?: string|null, write: (text: string) => unknown,
 *   version?: string, gitCommit?: string, loadedAt?: string, collectKeys?: boolean }} options
 * @returns {DeltaResult}
 */
export function buildDelta({ toFile, fromFile = null, write, version, gitCommit, loadedAt, collectKeys = false }) {
  const db = openSqliteHandle(toFile, { readOnly: true });
  const full = !fromFile;
  if (!full) db.exec(`ATTACH DATABASE '${fromFile.replace(/'/g, "''")}' AS f`);
  const collect = collectKeys && !full;
  const hashed = new Set(HASHED_TABLES.map((t) => t.name));
  /** @type {Record<string, TouchedKeys>} */
  const touched = {};
  /** @type {Record<string, TableDelta>} */
  const summary = {};
  let statements = 0;
  const emit = (/** @type {string} */ sql) => { write(`${sql}\n`); statements += 1; };

  const datasetRows = /** @type {{ key: string, value: string|null }[]} */ (db.prepare('SELECT key, value FROM dataset ORDER BY key').all());
  const newVersion = version || datasetRows.find((r) => r.key === 'version')?.value || '';
  // The dataset flag: loaded -> loading here, back to loaded in the last statement.
  DATASET_LOAD.assertPath(['loading', 'loaded']);
  emit(`INSERT OR REPLACE INTO dataset (key, value) VALUES (${q(LOADING_KEY)}, ${q(loadingValue('loading', newVersion))});`);

  const order = tableOrder();
  // Deletes, children first.
  for (const t of [...order].reverse()) {
    const s = (summary[t.name] = { deleted: 0, upserted: 0 });
    if (full) { emit(`DELETE FROM ${t.name};`); continue; }
    const pk = t.pk.join(', ');
    const ft = snapshotTable(db, 'f', t);
    const gone = db.prepare(goneSql(t, ft)).all();
    s.deleted = gone.length;
    if (collect && hashed.has(t.name)) touched[t.name] = { deleted: gone.map((r) => deletedRef(t, r)), upserted: [] };
    for (let i = 0; i < gone.length; i += MAX_DELETE_KEYS) {
      const chunk = gone.slice(i, i + MAX_DELETE_KEYS);
      if (t.pk.length === 1) {
        emit(`DELETE FROM ${t.name} WHERE ${t.pk[0]} IN (${chunk.map((r) => q(r[/** @type {string} */ (t.pk[0])])).join(', ')});`);
      } else {
        emit(`DELETE FROM ${t.name} WHERE (${pk}) IN (VALUES ${chunk.map((r) => `(${t.pk.map((c) => q(r[c])).join(', ')})`).join(', ')});`);
      }
    }
  }
  // Upserts, parents first.
  for (const t of order) {
    const s = /** @type {TableDelta} */ (summary[t.name]);
    const cols = t.columns.map((c) => c.name);
    const ft = full ? null : snapshotTable(db, 'f', t);
    const keys = collect && hashed.has(t.name) ? touched[t.name] : null;
    // A full load reads each table in storage order: the order of the statements does not
    // matter (every row is an upsert), and ordering by key costs a random read per row.
    // Collecting keys adds each row's size as one more column, which no statement writes.
    const sql = full
      ? `SELECT * FROM main.${t.name}`
      : `SELECT m.*${keys ? `, ${bytesExpr(t, 'm.')} AS ${BYTES_COLUMN}` : ''} FROM main.${t.name} m ${changedWhere(t, /** @type {string} */ (ft))}`;
    const prefix = `INSERT OR REPLACE INTO ${t.name} (${cols.join(', ')}) VALUES `;
    /** @type {string[]} */
    let batch = [];
    let bytes = 0;
    const flush = () => {
      if (batch.length) emit(`${prefix}${batch.join(', ')};`);
      batch = [];
      bytes = 0;
    };
    for (const row of /** @type {Iterable<Record<string, import('@civgraph/storage/node').SqliteValue>>} */ (db.prepare(sql).iterate())) {
      s.upserted += 1;
      if (keys) keys.upserted.push(upsertedRef(t, row, BYTES_COLUMN));
      let tuple = `(${cols.map((c) => q(row[c])).join(', ')})`;
      if (tuple.length + prefix.length > MAX_STATEMENT_BYTES) {
        // Insert the row with its wide text values empty, then append them in pieces.
        const wide = cols.filter((c) => typeof row[c] === 'string' && row[c].length > PIECE_CHARS);
        flush();
        emit(`${prefix}(${cols.map((c) => (wide.includes(c) ? "''" : q(row[c]))).join(', ')});`);
        const where = t.pk.map((c) => `${c} = ${q(row[c])}`).join(' AND ');
        for (const c of wide) {
          // A wide column holds text (the filter above).
          for (let at = 0; at < /** @type {string} */ (row[c]).length; at += PIECE_CHARS) {
            emit(`UPDATE ${t.name} SET ${c} = ${c} || ${q(/** @type {string} */ (row[c]).slice(at, at + PIECE_CHARS))} WHERE ${where};`);
          }
        }
        continue;
      }
      if (batch.length && bytes + tuple.length + prefix.length > MAX_STATEMENT_BYTES) flush();
      batch.push(tuple);
      bytes += tuple.length + 2;
    }
    flush();
  }

  const finalRows = datasetRows.filter((r) => ![LOADING_KEY, 'version', 'git_commit', 'loaded_at'].includes(r.key));
  const values = [
    ['version', newVersion], [LOADING_KEY, loadingValue('loaded')], ['git_commit', gitCommit || datasetRows.find((r) => r.key === 'git_commit')?.value || ''],
    ['loaded_at', loadedAt || new Date().toISOString()], ...finalRows.map((r) => [r.key, r.value]),
  ];
  emit(`INSERT OR REPLACE INTO dataset (key, value) VALUES ${values.map(([k, v]) => `(${q(k)}, ${q(v)})`).join(', ')};`);
  db.close();
  if (!collect) return { summary, statements, version: newVersion, full };
  // deltaKeys names a table only when the delta touched it.
  for (const [name, d] of Object.entries(touched)) if (!d.deleted.length && !d.upserted.length) delete touched[name];
  return { summary, statements, version: newVersion, full, touched };
}

/**
 * Rows written by the delta including index writes: each changed row costs one write plus one per
 * index on its table (D1 bills rows written).
 * @param {Record<string, TableDelta>} summary
 */
export function estimateWrites(summary) {
  let rows = 0;
  let writes = 0;
  for (const t of TABLES) {
    const s = summary[t.name];
    if (!s) continue;
    const n = s.deleted + s.upserted;
    rows += n;
    writes += n * (1 + (t.indexes || []).length);
  }
  return { rows, writes };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const to = opt('--to');
  const from = opt('--from');
  const out = opt('--out') || 'tmp/records/delta.sql';
  if (!to) { console.error('usage: diff-load.mjs --to <new.sqlite> [--from <last.sqlite>] [--out file]'); process.exit(1); }
  const fromFile = from && existsSync(from) ? path.resolve(from) : null;
  const stream = createWriteStream(out);
  const result = buildDelta({ toFile: path.resolve(to), fromFile, write: (s) => stream.write(s) });
  await new Promise((resolve) => stream.end(resolve));
  printSummary(result, out);
}

/**
 * @param {DeltaResult} result
 * @param {string} out
 */
export function printSummary(result, out) {
  const { rows, writes } = estimateWrites(result.summary);
  console.log(`${result.full ? 'FULL load' : 'delta'} -> ${out}: ${result.statements} statements, ${rows} rows (about ${writes} row writes with indexes), version ${result.version}`);
  for (const [name, s] of Object.entries(result.summary)) {
    if (s.deleted || s.upserted) console.log(`  ${name.padEnd(26)} -${s.deleted} +${s.upserted}`);
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'diff-load.mjs') await main();
