#!/usr/bin/env node
/**
 * The delta between two records databases, as SQL for `wrangler d1 execute --file` (stage E).
 *
 *   node scripts/records/diff-load.mjs --to <new.sqlite> [--from <last-loaded.sqlite>] --out tmp/records/delta.sql
 *
 * Per table of scripts/records/schema.mjs, on primary key plus row_hash:
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
import { openSqliteHandle } from '../lib/storage/sqlite.mjs';
import { HASHED_TABLES, TABLES } from './schema.mjs';
import { snapshotTable } from './db.mjs';

export const MAX_STATEMENT_BYTES = 60 * 1024;
const MAX_DELETE_KEYS = 100;
const PIECE_CHARS = 20_000;

export const q = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  return `'${String(value).replace(/'/g, "''")}'`;
};

/** Children before parents for deletes, parents before children for inserts. */
export function tableOrder() {
  const order = [];
  const seen = new Set();
  const visit = (t) => {
    if (seen.has(t.name)) return;
    seen.add(t.name);
    for (const p of t.parents || []) visit(TABLES.find((x) => x.name === p));
    order.push(t);
  };
  for (const t of HASHED_TABLES) visit(t);
  return order;
}

/**
 * @typedef {{ deleted: number, upserted: number }} TableDelta
 * @typedef {{ summary: Record<string, TableDelta>, statements: number, version: string, full: boolean }} DeltaResult
 */

/**
 * Write the delta. `from` may be null (full load). Returns per-table counts and the statement
 * count. `write(text)` receives statements, one per line.
 * @param {{ toFile: string, fromFile?: string|null, write: (text: string) => unknown,
 *   version?: string, gitCommit?: string, loadedAt?: string }} options
 * @returns {DeltaResult}
 */
export function buildDelta({ toFile, fromFile = null, write, version, gitCommit, loadedAt }) {
  const db = openSqliteHandle(toFile, { readOnly: true });
  const full = !fromFile;
  if (!full) db.exec(`ATTACH DATABASE '${fromFile.replace(/'/g, "''")}' AS f`);
  /** @type {Record<string, TableDelta>} */
  const summary = {};
  let statements = 0;
  const emit = (sql) => { write(`${sql}\n`); statements += 1; };

  const datasetRows = /** @type {{ key: string, value: string|null }[]} */ (db.prepare('SELECT key, value FROM dataset ORDER BY key').all());
  const newVersion = version || datasetRows.find((r) => r.key === 'version')?.value || '';
  emit(`INSERT OR REPLACE INTO dataset (key, value) VALUES ('loading', ${q(newVersion || 'loading')});`);

  const order = tableOrder();
  // Deletes, children first.
  for (const t of [...order].reverse()) {
    const s = (summary[t.name] = { deleted: 0, upserted: 0 });
    if (full) { emit(`DELETE FROM ${t.name};`); continue; }
    const pk = t.pk.join(', ');
    const ft = snapshotTable(db, 'f', t);
    const gone = db.prepare(`SELECT ${pk} FROM ${ft} EXCEPT SELECT ${pk} FROM main.${t.name} ORDER BY ${pk}`).all();
    s.deleted = gone.length;
    for (let i = 0; i < gone.length; i += MAX_DELETE_KEYS) {
      const chunk = gone.slice(i, i + MAX_DELETE_KEYS);
      if (t.pk.length === 1) {
        emit(`DELETE FROM ${t.name} WHERE ${t.pk[0]} IN (${chunk.map((r) => q(r[t.pk[0]])).join(', ')});`);
      } else {
        emit(`DELETE FROM ${t.name} WHERE (${pk}) IN (VALUES ${chunk.map((r) => `(${t.pk.map((c) => q(r[c])).join(', ')})`).join(', ')});`);
      }
    }
  }
  // Upserts, parents first.
  for (const t of order) {
    const s = summary[t.name];
    const cols = t.columns.map((c) => c.name);
    const ft = full ? null : snapshotTable(db, 'f', t);
    const join = full ? '' : t.pk.map((c) => `${ft}.${c} = m.${c}`).join(' AND ');
    // A full load reads each table in storage order: the order of the statements does not
    // matter (every row is an upsert), and ordering by key costs a random read per row.
    const sql = full
      ? `SELECT * FROM main.${t.name}`
      : `SELECT m.* FROM main.${t.name} m LEFT JOIN ${ft} ON ${join} WHERE ${ft}.row_hash IS NOT m.row_hash ORDER BY ${t.pk.map((c) => `m.${c}`).join(', ')}`;
    const prefix = `INSERT OR REPLACE INTO ${t.name} (${cols.join(', ')}) VALUES `;
    let batch = [];
    let bytes = 0;
    const flush = () => {
      if (batch.length) emit(`${prefix}${batch.join(', ')};`);
      batch = [];
      bytes = 0;
    };
    for (const row of /** @type {Iterable<Record<string, any>>} */ (db.prepare(sql).iterate())) {
      s.upserted += 1;
      let tuple = `(${cols.map((c) => q(row[c])).join(', ')})`;
      if (tuple.length + prefix.length > MAX_STATEMENT_BYTES) {
        // Insert the row with its wide text values empty, then append them in pieces.
        const wide = cols.filter((c) => typeof row[c] === 'string' && row[c].length > PIECE_CHARS);
        flush();
        emit(`${prefix}(${cols.map((c) => (wide.includes(c) ? "''" : q(row[c]))).join(', ')});`);
        const where = t.pk.map((c) => `${c} = ${q(row[c])}`).join(' AND ');
        for (const c of wide) {
          for (let at = 0; at < row[c].length; at += PIECE_CHARS) {
            emit(`UPDATE ${t.name} SET ${c} = ${c} || ${q(row[c].slice(at, at + PIECE_CHARS))} WHERE ${where};`);
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

  const finalRows = datasetRows.filter((r) => !['loading', 'version', 'git_commit', 'loaded_at'].includes(r.key));
  const values = [
    ['version', newVersion], ['loading', ''], ['git_commit', gitCommit || datasetRows.find((r) => r.key === 'git_commit')?.value || ''],
    ['loaded_at', loadedAt || new Date().toISOString()], ...finalRows.map((r) => [r.key, r.value]),
  ];
  emit(`INSERT OR REPLACE INTO dataset (key, value) VALUES ${values.map(([k, v]) => `(${q(k)}, ${q(v)})`).join(', ')};`);
  db.close();
  return { summary, statements, version: newVersion, full };
}

/**
 * Rows written by the delta including index writes: each changed row costs one write plus one per
 * index on its table (D1 bills rows written).
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
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
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

export function printSummary(result, out) {
  const { rows, writes } = estimateWrites(result.summary);
  console.log(`${result.full ? 'FULL load' : 'delta'} -> ${out}: ${result.statements} statements, ${rows} rows (about ${writes} row writes with indexes), version ${result.version}`);
  for (const [name, s] of Object.entries(result.summary)) {
    if (s.deleted || s.upserted) console.log(`  ${name.padEnd(26)} -${s.deleted} +${s.upserted}`);
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'diff-load.mjs') await main();
