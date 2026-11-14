// The faster records load (stream speed-d1, 14 Nov 2026) changes how the publish reaches D1, never
// what lands there or what the verify checks:
//   - buildDelta collects the keys it writes (collectKeys), exactly the keys the verify's second
//     diff (deltaKeys) finds, and writes the same statements whether it collects them or not;
//   - the bounded verify's statements share wrangler calls (packSteps) within a statement count,
//     the command line's bytes and a rows-read bound, and give the same verdicts as one per call;
//   - a part that failed is retried sooner, except when D1 said it was overloaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, TableWriter, transaction, rowHash, bindable } from '../../packages/loader/src/db.mjs';
import { buildDelta, deltaKeys, MAX_STATEMENT_BYTES } from '../../packages/loader/src/diff-load.mjs';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { TABLE } from '../../packages/schema/src/schema.mjs';
import {
  BOUNDS, boundedPlan, callSql, fullPlan, packSteps, parseWranglerResults, runPlan, wranglerQueryMany,
} from '../../packages/loader/src/verify-load.mjs';
import { PART_RETRY_MS, partRetryMs } from '../../packages/loader/src/deploy-records.mjs';
import { openSqliteHandle } from '../../packages/storage/src/sqlite.mjs';

/** @typedef {import('../../packages/loader/src/verify-load.mjs').QueryRows} QueryRows */

const TMP = path.join(REPO_ROOT, 'tmp', 'records', 'test-load-speed');

/** @param {DatabaseSync} db @param {string} table @param {string} where @param {Record<string, unknown>} values */
function update(db, table, where, values) {
  const spec = TABLE[table];
  const row = /** @type {Record<string, unknown>} */ (db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get());
  Object.assign(row, values);
  const vals = spec.columns.map((c) => c.name).filter((n) => n !== 'row_hash' && n !== 'row_hash_n').map((n) => bindable(row[n]));
  const [h, hn] = rowHash(vals);
  const sets = [...Object.keys(values), 'row_hash', 'row_hash_n'];
  db.prepare(`UPDATE ${table} SET ${sets.map((s) => `${s} = ?`).join(', ')} WHERE ${where}`).run(...Object.values(values).map(bindable), h, hn);
}

/**
 * old.sqlite (what D1 held) and new.sqlite (the build): 650 candidacies changed (composite keys),
 * one document grown past a statement (appended in pieces), one added, one alias gone, one new;
 * d1.sqlite is old with the delta applied.
 */
function fixture() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const OLD = path.join(TMP, 'old.sqlite');
  const NEW = path.join(TMP, 'new.sqlite');
  const D1 = path.join(TMP, 'd1.sqlite');
  const db = createDatabase(OLD);
  transaction(db, () => {
    new TableWriter(db, 'r_elections').add({ key: 'a__2020-01-01', slug: 'a-2020-01-01', body_slug: 'a', date: '2020-01-01', ord: 0, meta: '{}' });
    new TableWriter(db, 'contests').add({ election_key: 'a__2020-01-01', seq: 0, name: 'North', slug: 'north', meta: '{}' });
    const c = new TableWriter(db, 'candidacies');
    for (let ord = 0; ord < 900; ord += 1) c.add({ election_key: 'a__2020-01-01', contest_seq: 0, ord, name: `Cand ${ord}`, first_prefs: ord, meta: '{}' });
    const d = new TableWriter(db, 'documents');
    for (let i = 0; i < 5; i += 1) d.add({ name: `doc-${i}`, body: `{"n":${i}}` });
    const a = new TableWriter(db, 'person_aliases');
    for (let i = 0; i < 3; i += 1) a.add({ alias: `old-${i}`, slug: `new-${i}` });
  });
  db.exec("INSERT INTO dataset (key, value) VALUES ('version', 'v1')");
  db.close();
  copyFileSync(OLD, NEW);
  const b = new DatabaseSync(NEW);
  transaction(b, () => {
    for (let ord = 100; ord < 750; ord += 1) update(b, 'candidacies', `election_key = 'a__2020-01-01' AND contest_seq = 0 AND ord = ${ord}`, { first_prefs: ord + 1, name: `Cand ${ord}'s` });
    update(b, 'documents', "name = 'doc-2'", { body: JSON.stringify({ text: 'é'.repeat(70_000) }) });
    new TableWriter(b, 'documents').add({ name: 'doc-9', body: '{"n":9}' });
    new TableWriter(b, 'person_aliases').add({ alias: 'old-9', slug: 'new-9' });
  });
  b.exec("DELETE FROM person_aliases WHERE alias = 'old-1'");
  b.exec("UPDATE dataset SET value = 'v2' WHERE key = 'version'");
  b.close();
  /** @type {string[]} */
  const lines = [];
  buildDelta({ toFile: NEW, fromFile: OLD, write: (s) => lines.push(s), loadedAt: 'now' });
  copyFileSync(OLD, D1);
  const w = new DatabaseSync(D1);
  for (const l of lines) w.exec(l);
  w.close();
  return { OLD, NEW, D1, lines };
}

test('buildDelta collects the keys deltaKeys finds, and writes the same statements', () => {
  const { OLD, NEW, lines } = fixture();
  /** @type {string[]} */
  const collecting = [];
  const result = buildDelta({ toFile: NEW, fromFile: OLD, write: (s) => collecting.push(s), loadedAt: 'now', collectKeys: true });
  assert.deepEqual(collecting, lines, 'the same statements, in the same order');
  assert.ok(lines.some((l) => l.startsWith('UPDATE documents SET body = body || ')), 'the wide document is appended in pieces');
  assert.ok(lines.every((l) => l.length <= MAX_STATEMENT_BYTES + 1));
  const db = openSqliteHandle(NEW, { readOnly: true });
  db.exec(`ATTACH DATABASE '${OLD}' AS f`);
  const second = deltaKeys(db);
  db.close();
  assert.deepEqual(result.touched, second);
  assert.deepEqual(Object.keys(second).sort(), ['candidacies', 'documents', 'person_aliases']);
  assert.equal(second.candidacies.upserted.length, 650);
  assert.deepEqual(second.person_aliases.deleted.map((k) => k.key), ['["old-1"]']);
  assert.ok(second.documents.upserted.find((k) => k.key === '["doc-2"]')?.bytes > 70_000);
  // Nothing to collect on a full load (the verify samples every table instead), or when not asked.
  assert.equal(buildDelta({ toFile: NEW, fromFile: null, write: () => {}, collectKeys: true }).touched, undefined);
  assert.equal(buildDelta({ toFile: NEW, fromFile: OLD, write: () => {} }).touched, undefined);
});

test('the plan made from the handed-over keys is the plan made by diffing again', () => {
  const { OLD, NEW } = fixture();
  const { touched } = buildDelta({ toFile: NEW, fromFile: OLD, write: () => {}, collectKeys: true });
  const shape = (/** @type {import('../../packages/loader/src/verify-load.mjs').Plan} */ p) => p.steps.map((s) => [s.label, s.sql, s.rows]);
  const given = boundedPlan({ file: NEW, since: OLD, touched });
  assert.deepEqual(shape(given), shape(boundedPlan({ file: NEW, since: OLD })));
  // Without a snapshot the keys are not used: every table is sampled, as before.
  assert.deepEqual(shape(boundedPlan({ file: NEW, since: null, touched })), shape(boundedPlan({ file: NEW, since: null })));
});

test('packSteps keeps the order and the bounds; a step with no row bound, and the full scan, go alone', () => {
  /** @param {string} label @param {number} bytes @param {number | undefined} rows */
  const step = (label, bytes, rows) => ({ label, sql: `SELECT '${'x'.repeat(bytes - 9)}'`, rows, check: () => [] });
  const steps = [
    step('a', 100, 100), step('b', 100, 1000), step('c', 20_000, 400), step('d', 5_000, 400), step('e', 100, 2200),
    step('f', 100, undefined), step('g', 100, 10), ...Array.from({ length: 10 }, (_, i) => step(`h${i}`, 100, 10)),
  ];
  const calls = packSteps({ steps, notes: [], mode: 'bounded' });
  assert.deepEqual(calls.flat().map((s) => s.label), steps.map((s) => s.label), 'every step once, in order');
  for (const call of calls) {
    assert.ok(call.length <= BOUNDS.callStatements);
    if (call.length > 1) {
      assert.ok(Buffer.byteLength(callSql(call.map((s) => s.sql))) <= BOUNDS.callBytes, 'within the command line');
      assert.ok(call.reduce((n, s) => n + /** @type {number} */ (s.rows), 0) <= BOUNDS.callRows, 'within the rows-read bound');
    }
  }
  assert.deepEqual(calls.map((c) => c.map((s) => s.label).join(',')), [
    'a,b,c', 'd', 'e', 'f', 'g,h0,h1,h2,h3,h4,h5,h6', 'h7,h8,h9', // bytes, rows, unbounded, count
  ]);
  const full = fullPlan(fixture().NEW);
  assert.ok(packSteps(full).every((c) => c.length === 1), 'the full scan is never packed');
});

test('the packed verify gives the verdicts of one statement per call, on a sound and a damaged D1', () => {
  const { OLD, NEW, D1 } = fixture();
  const plan = boundedPlan({ file: NEW, since: OLD });
  const run = () => {
    const d1 = new DatabaseSync(D1, { readOnly: true });
    const one = (/** @type {string} */ sql) => /** @type {QueryRows} */ (d1.prepare(sql).all().map((r) => ({ ...r })));
    /** @type {string[][]} */
    const calls = [];
    const packed = runPlan(plan, { remote: true, query: (sql) => { calls.push([sql]); return one(sql); }, queryMany: (sqls) => { calls.push(sqls); return sqls.map(one); }, sleep: () => {} });
    const single = runPlan(plan, { remote: true, query: one, sleep: () => {}, bounds: { ...BOUNDS, callStatements: 1 } });
    d1.close();
    return { packed, single, calls };
  };
  const sound = run();
  assert.deepEqual(sound.packed, []);
  assert.deepEqual(sound.single, []);
  assert.ok(sound.calls.length < plan.steps.length, `${sound.calls.length} calls for ${plan.steps.length} statements`);
  assert.deepEqual(sound.calls.flat(), plan.steps.map((s) => s.sql), 'every statement sent once, in order');
  for (const call of sound.calls) assert.ok(Buffer.byteLength(callSql(call)) <= BOUNDS.callBytes);

  const w = new DatabaseSync(D1);
  w.exec("UPDATE candidacies SET row_hash = 'x' WHERE ord = 400");
  w.exec("DELETE FROM documents WHERE name = 'doc-9'");
  w.exec("INSERT INTO person_aliases (alias, slug, row_hash, row_hash_n) VALUES ('old-1', 'new-1', 'h', 1)");
  w.exec("UPDATE dataset SET value = 'loading:v2' WHERE key = 'loading'");
  w.close();
  const damaged = run();
  assert.deepEqual(damaged.packed, damaged.single);
  assert.ok(damaged.packed.length >= 4, damaged.packed.join('\n'));
  rmSync(TMP, { recursive: true, force: true });
});

test('wrangler answers a call per statement; a short answer, an error or an oversized call is refused', () => {
  const answer = JSON.stringify([
    { results: [{ a: 1 }], success: true, meta: { rows_read: 0, duration: 0.2 } },
    { results: [{ b: 2 }, { b: 3 }], success: true, meta: { rows_read: 4, duration: 0.1 } },
  ]);
  const rows = parseWranglerResults(0, answer, '', 2);
  assert.deepEqual(rows.map((r) => [...r]), [[{ a: 1 }], [{ b: 2 }, { b: 3 }]]);
  assert.deepEqual(rows.map((r) => r.rowsRead), [0, 4]);
  assert.throws(() => parseWranglerResults(0, answer, '', 3), /answered 2 statement\(s\) of 3/);
  assert.throws(() => parseWranglerResults(1, JSON.stringify({ error: { text: 'D1 DB is overloaded', code: 7429 } }), '', 2), /7429/);
  assert.throws(() => wranglerQueryMany(Array.from({ length: 4 }, () => `SELECT '${'x'.repeat(8_000)}'`)), /refused: a call of \d+ bytes/);
});

test('a failed part is retried after 20, 60 and 90 s, and after 90 s each time D1 was overloaded', () => {
  assert.deepEqual([1, 2, 3].map((attempt) => partRetryMs({ remote: true, attempt, failure: 'X [ERROR] fetch failed' })), PART_RETRY_MS.remote);
  assert.deepEqual([1, 2, 3].map((attempt) => partRetryMs({ remote: true, attempt, failure: 'D1 DB is overloaded [code: 7429]' })), [90_000, 90_000, 90_000]);
  assert.ok(PART_RETRY_MS.remote.every((ms) => ms >= 20_000), 'never a quick loop against the live database');
  assert.deepEqual([1, 2, 3].map((attempt) => partRetryMs({ remote: false, attempt, failure: '' })), [2_000, 2_000, 2_000]);
});
