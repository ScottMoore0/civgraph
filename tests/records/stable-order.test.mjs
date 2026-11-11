// Stable sort keys (packages/loader/src/stable-order.mjs): a build keeps the seed's `ord` for every row
// still in seed order, so adding N rows to a list gives a delta of about N rows, and the rows still
// come back in source order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, TableWriter, transaction } from '../../packages/loader/src/db.mjs';
import { buildDelta } from '../../packages/loader/src/diff-load.mjs';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { GRID, longestIncreasing, placeGroup, STABLE_ORDER_TABLES, stabiliseOrder } from '../../packages/loader/src/stable-order.mjs';

const TMP = path.join(REPO_ROOT, 'tmp', 'records', 'test-stable-order');

/** A build as the ingests write it: positions in source order (graph shards of `size`). */
function build(file, { entities = [], persons = [], statements = {}, size = 4 }) {
  const db = createDatabase(file);
  transaction(db, () => {
    const g = new TableWriter(db, 'graph_entities');
    entities.forEach((id, i) => g.add({ entity_id: id, shard: Math.floor(i / size), ord: i % size, label: id, entity: `{"id":"${id}"}` }));
    const p = new TableWriter(db, 'person_cards');
    persons.forEach((slug, ord) => p.add({ slug, ord, card: `{"slug":"${slug}"}` }));
    const s = new TableWriter(db, 'graph_statements');
    for (const [subject, list] of Object.entries(statements)) {
      list.forEach((id, ord) => s.add({ subject_id: subject, ord, statement_id: id, statement: `{"id":"${id}"}` }));
    }
  });
  return db;
}

const delta = (to, from) => {
  const r = buildDelta({ toFile: to, fromFile: from, write: () => {}, loadedAt: 'x' });
  return Object.fromEntries(Object.entries(r.summary).filter(([, s]) => s.deleted || s.upserted));
};

const ids = (n, prefix = 'e') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`);

test('placeGroup keeps anchors and places the rest between them, in order', () => {
  const k = (...v) => v;
  // Seed keys 0..4 dense; two new rows inserted between 1 and 2, one before 0, one after 4.
  const out = placeGroup([null, k(0), k(1), null, null, k(2), k(3), k(4), null]);
  assert.deepEqual(out.map((x) => x[0]), [-1, 0, 1, 1 + 170 / GRID, 1 + 341 / GRID, 2, 3, 4, 5]);
  // A moved row (seed 4 now first) is placed again; the others keep their keys.
  assert.deepEqual(placeGroup([k(4), k(0), k(1), k(2), k(3)]).map((x) => x[0]), [-1, 0, 1, 2, 3]);
  // No match: keep the positions.
  assert.equal(placeGroup([null, null]), null);
  // More rows than the room between two dense anchors: the next anchors are placed again.
  const many = [k(0), ...Array(GRID * 2).fill(null), k(1), k(2), k(3), k(4)];
  const placed = placeGroup(many).map((x) => x[0]);
  for (let i = 1; i < placed.length; i += 1) assert.ok(placed[i] > placed[i - 1], `strictly increasing at ${i}`);
  assert.equal(placed[0], 0);
  assert.ok(placed.every((v) => Number.isInteger(v * GRID)), 'on the 1/512 grid');
  // Different prefixes (graph shard boundaries): rows after the left anchor in its shard.
  assert.deepEqual(placeGroup([k(0, 4), null, null, k(1, 0)]), [k(0, 4), k(0, 5), k(0, 6), k(1, 0)]);
  assert.deepEqual(longestIncreasing([k(3), null, k(1), k(2), k(5), k(4)]), [2, 3, 5]);
});

test('inserting rows into a seeded build changes about as many rows as were added', () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const A = path.join(TMP, 'a.sqlite');
  const B = path.join(TMP, 'b.sqlite');
  const entities = ids(40);
  const persons = ids(30, 'p');
  const statements = { s1: ids(20, 'st'), s2: ids(5, 'su') };
  build(A, { entities, persons, statements }).close();

  // Six entities in the middle, two at the front; one person moved from last to first; one
  // statement inserted at the head of s1.
  const e2 = ['a0', 'a1', ...entities.slice(0, 7), 'e0006a', 'e0006b', 'e0006c', ...entities.slice(7, 30), 'e0029a', 'e0029b', 'e0029c', ...entities.slice(30)];
  const p2 = [persons.at(-1), ...persons.slice(0, -1)];
  const s2 = { s1: ['st-new', ...statements.s1], s2: statements.s2 };

  // Unseeded, positions shift: almost every row changes.
  const dense = build(B, { entities: e2, persons: p2, statements: s2 });
  dense.close();
  const unseeded = delta(B, A);
  assert.ok(unseeded.graph_entities.upserted > 30 && unseeded.person_cards.upserted === 30 && unseeded.graph_statements.upserted === 21);

  // Seeded from A: only the new and moved rows.
  const db = build(B, { entities: e2, persons: p2, statements: s2 });
  const r = stabiliseOrder(db, A);
  db.close();
  assert.deepEqual(delta(B, A), {
    graph_entities: { deleted: 0, upserted: 8 },
    person_cards: { deleted: 0, upserted: 1 },
    graph_statements: { deleted: 0, upserted: 1 },
  });
  assert.equal(r.graph_entities.seeded, true);

  // Source order is kept exactly.
  const b = new DatabaseSync(B, { readOnly: true });
  const col = (sql) => b.prepare(sql).all().map((x) => Object.values(x)[0]);
  assert.deepEqual(col('SELECT entity_id FROM graph_entities ORDER BY shard, ord'), e2);
  assert.deepEqual(col('SELECT slug FROM person_cards ORDER BY ord'), p2);
  assert.deepEqual(col("SELECT statement_id FROM graph_statements WHERE subject_id = 's1' ORDER BY ord"), s2.s1);
  // Positional slices still read as before: LIMIT/OFFSET in ord order.
  assert.deepEqual(col('SELECT slug FROM person_cards ORDER BY ord LIMIT 5 OFFSET 10'), p2.slice(10, 15));
  b.close();

  // A second build of the same input, seeded from the first, is identical; and the next change
  // (one more entity) is again one row.
  const C = path.join(TMP, 'c.sqlite');
  const c = build(C, { entities: e2, persons: p2, statements: s2 });
  stabiliseOrder(c, B);
  c.close();
  assert.deepEqual(delta(C, B), {});
  const D = path.join(TMP, 'd.sqlite');
  const e3 = [...e2.slice(0, 20), 'zz-new', ...e2.slice(20)];
  const d = build(D, { entities: e3, persons: p2, statements: s2 });
  stabiliseOrder(d, C);
  d.close();
  assert.deepEqual(delta(D, C), { graph_entities: { deleted: 0, upserted: 1 } });
  rmSync(TMP, { recursive: true, force: true });
});

test('a table whose ord is its rowid keeps the positions the ingest wrote when its rows move', () => {
  mkdirSync(TMP, { recursive: true });
  /** @param {string} file @param {string[]} order */
  const groups = (file, order) => {
    const db = createDatabase(file);
    transaction(db, () => {
      const fg = new TableWriter(db, 'feature_groups');
      order.forEach((id, ord) => fg.add({ ord, id, card: `{"id":"${id}"}` }));
    });
    return db;
  };
  const A = path.join(TMP, 'fg-a.sqlite');
  groups(A, ['a', 'b', 'c', 'd']).close();
  const B = path.join(TMP, 'fg-b.sqlite');
  // 'd' moves to the front: a fraction or a parked rowid threw before (11 Nov stage-proni landing).
  const b = groups(B, ['d', 'a', 'b', 'c']);
  const r = stabiliseOrder(b, A, { tables: STABLE_ORDER_TABLES.filter((t) => t.name === 'feature_groups') });
  assert.deepEqual(r, { feature_groups: { changed: 0, seeded: false } });
  assert.deepEqual(b.prepare('SELECT id FROM feature_groups ORDER BY ord').all().map((x) => x.id), ['d', 'a', 'b', 'c']);
  b.close();
  rmSync(TMP, { recursive: true, force: true });
});

test('without a seed the build keeps the positions the ingests wrote', () => {
  mkdirSync(TMP, { recursive: true });
  const A = path.join(TMP, 'plain.sqlite');
  const db = build(A, { entities: ids(10) });
  assert.equal(stabiliseOrder(db, null), null);
  assert.equal(stabiliseOrder(db, path.join(TMP, 'missing.sqlite')), null);
  db.close();
  rmSync(TMP, { recursive: true, force: true });
});
