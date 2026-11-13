/**
 * Stable `ord`: the sort keys of the records tables keep their values from one build to the next,
 * so adding N rows to a list changes about N rows, not every row after the insertion point.
 *
 * The ingests write `ord` as the row's position in its source list (0, 1, 2, ...). A position
 * shifts for every later row when one row is inserted: six new graph entities moved the `ord` (and
 * the `shard`) of 294,000 graph_entities rows, and two persons whose candidacy counts changed
 * moved 20,000 person_cards rows. This pass, run on a finished build, rewrites the sort key of the
 * tables whose schema entry has `stableOrder` against a seed: the database D1 was last loaded from
 * (the publish's last-loaded snapshot), or the previous build.
 *
 *   - Rows are matched to the seed by identity: the primary key (`identity: 'key'`), or, where
 *     `ord` is part of the primary key, the row's other values (`identity: 'content'`), the k-th
 *     equal row matching the k-th.
 *   - Within each group (`group` columns: one subject's statements, one division's votes; the
 *     whole table when there is none), the matched rows that are still in seed order (a longest
 *     increasing subsequence of their seed keys, taken in the new source order) keep their seed
 *     key: these are the anchors.
 *   - Every other row (new, moved, or changed in content) is placed between its neighbouring
 *     anchors: before the first anchor at first-1, first-2, ...; after the last at last+1,
 *     last+2, ...; between two anchors at evenly spaced multiples of 1/GRID. When two anchors
 *     leave too little room the next anchor is placed again with them, until the room suffices.
 *   - A group with no matched row keeps the positions the ingest wrote.
 *   - A table whose primary key is `ord` alone (an INTEGER column, so SQLite's rowid) keeps the
 *     positions the ingest wrote: a rowid cannot hold a fraction, and parking it would move the
 *     row the rewrite reads back (party_events, source_merges, feature_groups; all small).
 *
 * So the order of the rows is exactly the source order (by construction), and `ord` is a sort
 * key, not a position: it may be negative or a fraction (a multiple of 1/512, at most 15
 * significant digits, so it is written and read back exactly as SQL text), and it has gaps. No
 * read takes it as a position: the sharded Browse indexes are sliced with LIMIT/OFFSET in `ord`
 * order (functions/data/browse/[[path]].js). Where the sort key has a prefix (graph_entities'
 * `shard`), rows between two anchors of different prefixes take the first anchor's prefix.
 *
 * Changed rows get their row_hash recomputed (db.mjs rowHash over hashValues), as the loader would
 * have written them. Without a seed nothing changes and the build is as the ingests wrote it.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { openSqliteHandle } from '../../storage/src/sqlite.mjs';
import { bindable, hashValues, rowHash, transaction } from './db.mjs';
import { TABLES } from '../../schema/src/schema.mjs';

export const GRID = 512;
/** Placeholder sort keys while rows whose primary key includes `ord` are renumbered. */
const PARKED = -1e13;

export const STABLE_ORDER_TABLES = TABLES.filter((t) => t.stableOrder);

/** @typedef {import('../../storage/src/sqlite.mjs').SqliteHandle} SqliteHandle */
/** @typedef {import('../../schema/src/schema.mjs').TableSpec} TableSpec */
/** A row's sort key: the values of its table's stableOrder.sort columns (ord, shard: numbers). @typedef {number[]} SortKey */
/** A sort key or a group's values (group columns may be text), compared element by element. @typedef {(string | number)[]} Key */
/** A table whose stableOrder is set. @typedef {TableSpec & { stableOrder: NonNullable<TableSpec['stableOrder']> }} StableTable */

const cmp = (/** @type {Key} */ a, /** @type {Key} */ b) => {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

/**
 * @param {SqliteHandle} db
 * @param {string} schema
 * @param {string} table
 * @returns {Set<unknown>}
 */
function columnsOf(db, schema, table) {
  try {
    return new Set(db.prepare(`SELECT name FROM ${schema}.pragma_table_info('${table}')`).all().map((r) => r.name));
  } catch {
    return new Set();
  }
}

/**
 * Indexes of a longest strictly increasing subsequence of keys[i] (nulls skipped).
 * @param {(Key | null)[]} keys
 * @returns {number[]}
 */
export function longestIncreasing(keys) {
  /** @type {number[]} */
  const tails = []; // index into keys of the smallest tail of each length
  const prev = new Array(keys.length).fill(-1);
  for (let i = 0; i < keys.length; i += 1) {
    if (!keys[i]) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(/** @type {Key} */ (keys[tails[mid]]), /** @type {Key} */ (keys[i])) < 0) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  /** @type {number[]} */
  const out = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

/**
 * New sort keys for one group: `seedKeys[i]` is row i's matched seed key (or null), rows in new
 * source order. Returns an array of keys, or null when no row matched (keep the positions).
 * @param {(SortKey | null)[]} seedKeys
 * @returns {SortKey[] | null}
 */
export function placeGroup(seedKeys) {
  const anchors = longestIncreasing(seedKeys);
  if (!anchors.length) return null;
  /** @type {SortKey[]} */
  const out = new Array(seedKeys.length);
  for (const i of anchors) out[i] = /** @type {SortKey} */ (seedKeys[i]);
  const last = (/** @type {SortKey} */ k) => k[k.length - 1];
  const withLast = (/** @type {SortKey} */ k, /** @type {number} */ v) => [...k.slice(0, -1), v];
  // Before the first anchor: first-m, ..., first-1 (an anchor's key is never null).
  const first = /** @type {SortKey} */ (seedKeys[anchors[0]]);
  for (let i = 0; i < anchors[0]; i += 1) out[i] = withLast(first, last(first) - (anchors[0] - i));
  let a = 0; // index into anchors of the left anchor of the current window
  while (a < anchors.length) {
    const left = anchors[a];
    const lk = /** @type {SortKey} */ (seedKeys[left]);
    let b = a + 1;
    while (b < anchors.length) {
      const rk = /** @type {SortKey} */ (seedKeys[anchors[b]]);
      const m = anchors[b] - left - 1;
      if (m === 0) break;
      const samePrefix = cmp(lk.slice(0, -1), rk.slice(0, -1)) === 0;
      if (!samePrefix) break;
      const lo = Math.floor(last(lk) * GRID);
      const hi = Math.ceil(last(rk) * GRID);
      if (hi - lo - 1 >= m) break;
      b += 1; // too little room: place the next anchor again, with the rows around it
    }
    const end = b < anchors.length ? anchors[b] : seedKeys.length;
    const m = end - left - 1;
    if (m > 0) {
      const rk = b < anchors.length ? seedKeys[anchors[b]] : null;
      if (!rk || cmp(lk.slice(0, -1), rk.slice(0, -1)) !== 0) {
        for (let j = 0; j < m; j += 1) out[left + 1 + j] = withLast(lk, last(lk) + j + 1);
      } else {
        const lo = Math.floor(last(lk) * GRID);
        const hi = Math.ceil(last(rk) * GRID);
        for (let j = 0; j < m; j += 1) out[left + 1 + j] = withLast(lk, (lo + Math.floor(((hi - lo) * (j + 1)) / (m + 1))) / GRID);
      }
    }
    a = b;
  }
  return out;
}

/** @param {StableTable} t */
function identityColumns(t) {
  const sort = new Set(t.stableOrder.sort);
  if (t.stableOrder.identity === 'key') return t.pk.filter((c) => !sort.has(c));
  return t.columns.map((c) => c.name).filter((n) => !sort.has(n) && n !== 'row_hash' && n !== 'row_hash_n');
}

const idOf = (/** @type {unknown[]} */ values) => createHash('sha1').update(JSON.stringify(values)).digest('base64');

/**
 * Rewrite the sort keys of `db` (an open, writable build) against `seedFile`. Returns per table
 * the number of rows whose key changed, and the groups that had a seed.
 * @param {import('../../storage/src/sqlite.mjs').SqliteHandle} db
 * @param {string|null} seedFile
 * @param {{ tables?: import('../../schema/src/schema.mjs').TableSpec[], log?: (line: string) => void }} [options]
 */
export function stabiliseOrder(db, seedFile, { tables = STABLE_ORDER_TABLES, log = () => {} } = {}) {
  if (!seedFile || !existsSync(seedFile)) return null;
  const seed = openSqliteHandle(seedFile, { readOnly: true });
  /** @type {Record<string, { changed: number, seeded: boolean }>} */
  const result = {};
  try {
    for (const t of tables) {
      if (!t.stableOrder) throw new Error(`table ${t.name} has no stableOrder`);
      const { sort, group = [] } = t.stableOrder;
      if (t.pk.length === 1 && sort.includes(t.pk[0]) && t.columns.find((c) => c.name === t.pk[0])?.type === 'INTEGER') {
        log(`  ${t.name}: ord is the rowid, positions kept`); result[t.name] = { changed: 0, seeded: false }; continue;
      }
      const idCols = identityColumns(/** @type {StableTable} */ (t));
      const need = [...new Set([...group, ...sort, ...idCols])];
      const have = columnsOf(seed, 'main', t.name);
      if (!need.every((c) => have.has(c))) { log(`  ${t.name}: not in the seed, positions kept`); result[t.name] = { changed: 0, seeded: false }; continue; }
      const orderBy = [...group, ...sort].join(', ');
      const seedStmt = group.length
        ? seed.prepare(`SELECT ${[...sort, ...idCols].join(', ')} FROM ${t.name} WHERE ${group.map((c, i) => `${c} = ?${i + 1}`).join(' AND ')} ORDER BY ${sort.join(', ')}`)
        : seed.prepare(`SELECT ${[...sort, ...idCols].join(', ')} FROM ${t.name} ORDER BY ${sort.join(', ')}`);
      /** @type {[number, SortKey][]} */
      const changes = [];
      /** @type {{ rid: number, key: SortKey, id: string }[]} */
      let rows = [];
      /** @type {Key | null} */
      let groupValues = null;
      const flush = () => {
        if (!rows.length) return;
        /** @type {Map<string, SortKey[]>} */
        const byId = new Map();
        for (const r of seedStmt.iterate(...(groupValues || []))) {
          const id = idOf(idCols.map((c) => r[c]));
          const list = byId.get(id);
          const key = /** @type {SortKey} */ (sort.map((c) => r[c]));
          if (list) list.push(key); else byId.set(id, [key]);
        }
        const seedKeys = rows.map((r) => byId.get(r.id)?.shift() || null);
        const placed = placeGroup(seedKeys);
        if (placed) {
          rows.forEach((r, i) => { if (cmp(r.key, placed[i]) !== 0) changes.push([r.rid, placed[i]]); });
        }
        rows = [];
      };
      const iter = db.prepare(`SELECT rowid AS _rid, ${need.join(', ')} FROM ${t.name} ORDER BY ${orderBy}`).iterate();
      for (const r of iter) {
        const gv = /** @type {Key} */ (group.map((c) => r[c]));
        if (groupValues && cmp(gv, groupValues) !== 0) flush();
        groupValues = gv;
        rows.push({ rid: /** @type {number} */ (r._rid), key: /** @type {SortKey} */ (sort.map((c) => r[c])), id: idOf(idCols.map((c) => r[c])) });
      }
      flush();
      applyKeys(db, /** @type {StableTable} */ (t), changes);
      result[t.name] = { changed: changes.length, seeded: true };
      log(`  ${t.name}: ${changes.length} sort key(s) rewritten`);
    }
  } finally {
    seed.close();
  }
  return result;
}

/**
 * Write the new sort keys and the rows' new hashes, in one transaction.
 * @param {SqliteHandle} db
 * @param {StableTable} t
 * @param {[number, SortKey][]} changes   [rowid, new key]
 */
function applyKeys(db, t, changes) {
  if (!changes.length) return;
  const { sort } = t.stableOrder;
  const valueColumns = t.columns.map((c) => c.name).filter((n) => n !== 'row_hash' && n !== 'row_hash_n');
  const keyInPk = sort.some((c) => t.pk.includes(c));
  const read = db.prepare(`SELECT ${valueColumns.join(', ')} FROM ${t.name} WHERE rowid = ?`);
  const park = db.prepare(`UPDATE ${t.name} SET ${sort.at(-1)} = ? WHERE rowid = ?`);
  const write = db.prepare(`UPDATE ${t.name} SET ${sort.map((c) => `${c} = ?`).join(', ')}, row_hash = ?, row_hash_n = ? WHERE rowid = ?`);
  transaction(db, () => {
    // A key in the primary key could collide with a row not yet moved: park them all first.
    if (keyInPk) changes.forEach(([rid], i) => park.run(PARKED - i, rid));
    for (const [rid, key] of changes) {
      const row = /** @type {Record<string, unknown>} */ (read.get(rid));
      sort.forEach((c, i) => { row[c] = key[i]; });
      const values = valueColumns.map((c) => bindable(row[c]));
      const [h, hn] = rowHash(hashValues(t, row, values, valueColumns));
      write.run(...key, h, hn, rid);
    }
  });
}
