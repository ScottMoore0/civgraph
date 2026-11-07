/**
 * Shared helpers of the records loader: a fresh database from the migrations, row hashes, and a
 * table writer that fills one table in one transaction.
 *
 * A row's hash is SHA-1 over JSON.stringify of its values in the schema's column order (row_hash
 * and row_hash_n left out). The column order is fixed by scripts/records/schema.mjs, so this is
 * canonical: the same row always hashes the same, on any machine. Numbers are bound as numbers,
 * absent values as null. The one exception is a build stamp inside a JSON column the schema names
 * (`volatileJson`, documents only), which is left out (hashValues).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openSqliteHandle } from '../lib/storage/sqlite.mjs';
import { REPO_ROOT } from './paths.mjs';
import { TABLE } from './schema.mjs';

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().map((f) => path.join(dir, f));
}

/** A new SQLite file with every migration applied, WAL off. Replaces any file at `file`. */
export function createDatabase(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(file + suffix, { force: true });
  const db = openSqliteHandle(file);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;');
  for (const migration of migrationFiles()) db.exec(readFileSync(migration, 'utf8'));
  return db;
}

export function openDatabase(file, { readOnly = false } = {}) {
  if (!existsSync(file)) throw new Error(`no database at ${file}`);
  return openSqliteHandle(file, { readOnly });
}

export function rowHash(values) {
  const hex = createHash('sha1').update(JSON.stringify(values)).digest('hex');
  return [hex, parseInt(hex.slice(0, 8), 16)];
}

/**
 * The values a row's hash is taken over: its values, except that a table with `volatileJson`
 * (schema.mjs: documents) has the named top-level keys left out of that JSON column, so a build
 * stamp alone never changes the hash. A value that is not a JSON object hashes as it is.
 */
export function hashValues(spec, row, values, valueColumns = spec.columns.map((c) => c.name).filter((n) => n !== 'row_hash' && n !== 'row_hash_n')) {
  const v = spec.volatileJson;
  if (!v) return values;
  const i = valueColumns.indexOf(v.column);
  const text = values[i];
  const keys = v.keys(row);
  if (typeof text !== 'string' || !keys.some((k) => text.includes(`"${k}"`))) return values;
  let doc;
  try { doc = JSON.parse(text); } catch { return values; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return values;
  for (const k of keys) delete doc[k];
  const out = [...values];
  out[i] = JSON.stringify(doc);
  return out;
}

/** node:sqlite binds null, numbers, strings, bigints and bytes; everything else is normalised. */
export function bindable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'bigint') return value;
  return JSON.stringify(value);
}

export const txt = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const int = (v) => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
export const bool = (v) => (v === null || v === undefined ? null : v ? 1 : 0);

/**
 * Writes rows into one table. `add(row)` takes an object keyed by column name
 * (row_hash/row_hash_n are computed); unknown keys throw, so a typo cannot drop a value
 * silently. Transactions are the caller's: wrap an ingest in transaction().
 */
export class TableWriter {
  constructor(db, tableName) {
    const spec = TABLE[tableName];
    if (!spec) throw new Error(`unknown table ${tableName}`);
    this.db = db;
    this.spec = spec;
    this.valueColumns = spec.columns.map((c) => c.name).filter((n) => n !== 'row_hash' && n !== 'row_hash_n');
    this.known = new Set(this.valueColumns);
    const cols = spec.columns.map((c) => c.name);
    this.stmt = db.prepare(`INSERT INTO ${spec.name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    this.count = 0;
  }

  add(row) {
    for (const key of Object.keys(row)) if (!this.known.has(key)) throw new Error(`${this.spec.name}: unknown column ${key}`);
    const values = this.valueColumns.map((name) => bindable(row[name]));
    for (const col of this.spec.columns) {
      if (col.notNull && col.name !== 'row_hash' && col.name !== 'row_hash_n' && values[this.valueColumns.indexOf(col.name)] === null) {
        throw new Error(`${this.spec.name}: ${col.name} is null in ${JSON.stringify(row).slice(0, 300)}`);
      }
    }
    if (this.spec.hashed) values.push(...rowHash(hashValues(this.spec, row, values, this.valueColumns)));
    this.stmt.run(...values);
    this.count += 1;
  }

  finish() {
    return this.count;
  }
}

/** Run fn inside one transaction (rolled back if it throws). */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Fill a table from an iterable of row objects, in one transaction; returns the row count. */
export function fillTable(db, tableName, rows) {
  return transaction(db, () => {
    const writer = new TableWriter(db, tableName);
    for (const row of rows) writer.add(row);
    return writer.finish();
  });
}

/** Per table: count and SUM(row_hash_n), the figures verify compares. */
export function tableChecksums(db, tables) {
  const out = {};
  for (const t of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(row_hash_n), 0) AS s FROM ${t.name}`).get();
    out[t.name] = { n: Number(row.n), s: Number(row.s) };
  }
  return out;
}

export function readJson(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Replace the keys named in `sentinels` ({key: '$where-it-lives'}) with that marker string,
 * keeping their place, so the stored JSON keeps the document's key order and the
 * compatibility routes can put each value back where it was. A marker is a string beginning
 * with '$' that no source value takes (functions/_api/_records.js isMarker).
 */
export function withPlaceholders(object, sentinels) {
  const out = {};
  for (const [k, v] of Object.entries(object)) {
    if (v === undefined) continue;
    out[k] = Object.prototype.hasOwnProperty.call(sentinels, k) ? sentinels[k] : v;
  }
  return out;
}

/** The record without the wrapper fields a generator adds (schemaVersion, generatedAt). */
export function unwrapItem(doc) {
  return doc && typeof doc === 'object' ? doc.item ?? doc : doc;
}

/**
 * The name to read table `t` of an attached snapshot by: `<schema>.<table>`, or, when the snapshot
 * predates the table (a migration added it since: the phase-3 maps tables against a phase-2
 * last-loaded snapshot), an empty TEMP view of the same columns, so every row of the build reads
 * as new and nothing as deleted.
 */
export function snapshotTable(db, schema, t) {
  const has = db.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`).get(t.name);
  if (has) return `${schema}.${t.name}`;
  const view = `${schema}_absent_${t.name}`;
  db.exec(`CREATE TEMP VIEW IF NOT EXISTS ${view} AS SELECT * FROM main.${t.name} WHERE 0`);
  return view;
}
