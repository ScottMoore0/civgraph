// The remote verify must be safe against the live database (2026-11-06: the old whole-table
// checksums of all 47 tables made D1 answer 7429 and production 500/503 for two minutes). These
// tests hold the bounded mode to that: one statement per call, no unbounded per-table aggregate,
// every row lookup through a key's index, only the tables the delta touched, a pause between
// calls and a backoff on 7429. And it still finds a wrong row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, TableWriter, transaction, rowHash, bindable } from '@civgraph/loader/db.mjs';
import { buildDelta } from '@civgraph/loader/diff-load.mjs';
import { REPO_ROOT } from '@civgraph/loader/paths.mjs';
import { HASHED_TABLES, TABLE } from '@civgraph/schema';
import {
  BOUNDS, batches, boundedPlan, evenSample, fullPlan, queryWithRetry, runPlan, verify,
} from '@civgraph/loader/verify-load.mjs';

const TMP = path.join(REPO_ROOT, 'tmp', 'records', 'test-verify');
const TABLE_NAMES = new Set(HASHED_TABLES.map((t) => t.name));

function smallDb(file) {
  const db = createDatabase(file);
  transaction(db, () => {
    new TableWriter(db, 'r_elections').add({ key: 'a__2020-01-01', slug: 'a-2020-01-01', body_slug: 'a', date: '2020-01-01', ord: 0, meta: '{}' });
    new TableWriter(db, 'contests').add({ election_key: 'a__2020-01-01', seq: 0, name: 'North', slug: 'north', meta: '{}' });
    const c = new TableWriter(db, 'candidacies');
    for (let ord = 0; ord < 700; ord += 1) c.add({ election_key: 'a__2020-01-01', contest_seq: 0, ord, name: `Cand ${ord}`, first_prefs: ord, meta: '{}' });
    const d = new TableWriter(db, 'documents');
    for (let i = 0; i < 5; i += 1) d.add({ name: `doc-${i}`, body: `{"n":${i}}` });
    new TableWriter(db, 'person_aliases').add({ alias: 'old-1', slug: 'new-1' });
  });
  db.exec("INSERT INTO dataset (key, value) VALUES ('version', 'v1')");
  return db;
}

function update(db, table, where, values) {
  const spec = TABLE[table];
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get();
  Object.assign(row, values);
  const vals = spec.columns.map((c) => c.name).filter((n) => n !== 'row_hash' && n !== 'row_hash_n').map((n) => bindable(row[n]));
  const [h, hn] = rowHash(vals);
  const sets = [...Object.keys(values), 'row_hash', 'row_hash_n'];
  db.prepare(`UPDATE ${table} SET ${sets.map((s) => `${s} = ?`).join(', ')} WHERE ${where}`).run(...Object.values(values).map(bindable), h, hn);
}

/** old.sqlite (what D1 held), new.sqlite (the build: 600 candidacies and a document changed, an alias gone), d1.sqlite (old + delta). */
function fixture() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const OLD = path.join(TMP, 'old.sqlite');
  const NEW = path.join(TMP, 'new.sqlite');
  const D1 = path.join(TMP, 'd1.sqlite');
  smallDb(OLD).close();
  copyFileSync(OLD, NEW);
  const b = new DatabaseSync(NEW);
  transaction(b, () => {
    for (let ord = 0; ord < 600; ord += 1) update(b, 'candidacies', `election_key = 'a__2020-01-01' AND contest_seq = 0 AND ord = ${ord}`, { first_prefs: ord + 1 });
    update(b, 'documents', "name = 'doc-2'", { body: '{"n":"two"}' });
  });
  b.exec("DELETE FROM person_aliases WHERE alias = 'old-1'");
  b.exec("UPDATE dataset SET value = 'v2' WHERE key = 'version'");
  b.close();
  const lines = [];
  buildDelta({ toFile: NEW, fromFile: OLD, write: (s) => lines.push(s), loadedAt: 'now' });
  copyFileSync(OLD, D1);
  const d = new DatabaseSync(D1);
  for (const l of lines) d.exec(l);
  d.close();
  return { OLD, NEW, D1 };
}

/** A query function over a local file standing in for D1, recording every statement. */
function fakeD1(file, seen = []) {
  const db = new DatabaseSync(file, { readOnly: true });
  const query = (sql) => {
    seen.push(sql);
    return db.prepare(sql).all().map((r) => ({ ...r }));
  };
  return { query, seen, close: () => db.close() };
}

const AGGREGATE = /\b(COUNT|SUM|TOTAL|AVG|MIN|MAX|GROUP_CONCAT)\s*\(/i;
const BOUNDED_AGGREGATE = /^SELECT COUNT\(\*\) AS n, COALESCE\(SUM\(row_hash_n\), 0\) AS s FROM \(SELECT row_hash_n FROM (\w+) LIMIT (\d+)\)$/;

/** Fail unless the statement is one of the bounded shapes, and its plan never scans a records table unbounded. */
function assertBounded(db, sql) {
  assert.ok(!/;/.test(sql.replace(/'(?:[^']|'')*'/g, "''")), `one statement per call: ${sql.slice(0, 120)}`);
  const agg = BOUNDED_AGGREGATE.exec(sql);
  if (agg) {
    assert.ok(Number(agg[2]) <= BOUNDS.smallTableRows + 1, `aggregate bounded by a small LIMIT: ${sql}`);
    return { kind: 'aggregate', table: agg[1] };
  }
  assert.ok(!AGGREGATE.test(sql), `no unbounded aggregate: ${sql.slice(0, 160)}`);
  if (/FROM sqlite_master/.test(sql) || /FROM dataset/.test(sql)) {
    assert.match(sql, /LIMIT \d+$/, `system rows read under a LIMIT: ${sql.slice(0, 120)}`);
    return { kind: 'meta', table: /FROM (\w+)/.exec(sql)[1] };
  }
  const table = /FROM (\w+) WHERE/.exec(sql)?.[1];
  assert.ok(TABLE_NAMES.has(table), `a keyed read of a records table: ${sql.slice(0, 120)}`);
  assert.match(sql, / IN \(/, 'by a list of keys');
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail);
  assert.ok(plan.some((d) => d.startsWith(`SEARCH ${table} USING`)), `uses the key's index: ${plan.join(' | ')}`);
  assert.ok(!plan.some((d) => d.startsWith(`SCAN ${table}`)), `never scans ${table}: ${plan.join(' | ')}`);
  return { kind: 'keyed', table };
}

test('bounded plan: only the touched tables, keyed batches, bounded aggregates, one statement each', () => {
  const { OLD, NEW } = fixture();
  const plan = boundedPlan({ file: NEW, since: OLD });
  const db = new DatabaseSync(NEW, { readOnly: true });
  const read = plan.steps.map((s) => assertBounded(db, s.sql));
  db.close();
  const kinds = read.map((r) => r.kind);
  for (const { table } of read) assert.ok(['dataset', 'sqlite_master', 'candidacies', 'documents', 'person_aliases'].includes(table), `untouched table read: ${table}`);
  // 600 candidacies changed: 3 batches of at most 200 keys, and candidacies (700 rows) counted under LIMIT 701.
  const cand = plan.steps.filter((s) => s.label.startsWith('candidacies keys'));
  assert.equal(cand.length, 3);
  assert.ok(plan.steps.some((s) => s.sql.endsWith('FROM (SELECT row_hash_n FROM candidacies LIMIT 701)')));
  assert.ok(kinds.includes('keyed') && kinds.includes('aggregate') && kinds.includes('meta'));
  for (const s of plan.steps) assert.ok(Buffer.byteLength(s.sql) <= BOUNDS.statementBytes, 'fits a Windows command line');
});

test('bounded verify passes on the loaded copy and finds a wrong, a missing and a leftover row', () => {
  const { OLD, NEW, D1 } = fixture();
  const ok = fakeD1(D1);
  assert.deepEqual(verify({ file: NEW, remote: true, since: OLD, query: ok.query, sleep: () => {}, log: () => {} }), []);
  ok.close();
  const d = new DatabaseSync(D1);
  d.exec("UPDATE candidacies SET row_hash = 'x' WHERE ord = 5");
  d.exec("DELETE FROM documents WHERE name = 'doc-2'");
  d.exec("INSERT INTO person_aliases (alias, slug, row_hash, row_hash_n) VALUES ('old-1', 'new-1', 'h', 1)");
  d.close();
  const bad = fakeD1(D1);
  const found = verify({ file: NEW, remote: true, since: OLD, query: bad.query, sleep: () => {}, log: () => {} });
  bad.close();
  assert.ok(found.some((m) => m.startsWith('candidacies ["a__2020-01-01","0","5"]: row_hash')), found.join('\n'));
  assert.ok(found.some((m) => m.startsWith('documents ["doc-2"]: missing')), found.join('\n'));
  assert.ok(found.some((m) => m.startsWith('person_aliases ["old-1"]: deleted locally, still in D1')), found.join('\n'));
});

test('remote verify defaults to bounded: no statement is an unbounded per-table aggregate, with or without a snapshot', () => {
  const { OLD, NEW, D1 } = fixture();
  for (const since of [OLD, null]) {
    const f = fakeD1(D1);
    verify({ file: NEW, remote: true, since, query: f.query, sleep: () => {}, log: () => {} });
    f.close();
    const db = new DatabaseSync(NEW, { readOnly: true });
    for (const sql of f.seen) assertBounded(db, sql);
    db.close();
    assert.ok(!f.seen.some((sql) => /^SELECT '\w+' AS t, COUNT\(\*\)/.test(sql)), 'the full-scan statement never runs');
  }
});

test('the full scan runs only when asked for, still one table per statement', () => {
  const { NEW, D1 } = fixture();
  const f = fakeD1(D1);
  assert.deepEqual(verify({ file: NEW, remote: true, mode: 'full', query: f.query, sleep: () => {}, log: () => {} }), []);
  f.close();
  assert.equal(f.seen.length, HASHED_TABLES.length + 1);
  assert.ok(f.seen.every((sql) => !sql.includes(';')));
  assert.equal(fullPlan(NEW).steps.length, HASHED_TABLES.length + 1);
});

test('calls are paced and a 7429 is retried with backoff, never at once; other errors are not retried', () => {
  const { OLD, NEW, D1 } = fixture();
  const f = fakeD1(D1);
  const sleeps = [];
  let failures = 2;
  const flaky = (sql) => {
    if (failures > 0) { failures -= 1; throw new Error('wrangler d1 execute failed (1): D1 DB is overloaded. [code: 7429]'); }
    return f.query(sql);
  };
  const plan = boundedPlan({ file: NEW, since: OLD });
  assert.deepEqual(runPlan(plan, { remote: true, query: flaky, pauseMs: 1500, sleep: (ms) => sleeps.push(ms) }), []);
  f.close();
  assert.deepEqual(sleeps.slice(0, 2), [BOUNDS.backoffMs[0], BOUNDS.backoffMs[1]]);
  assert.deepEqual(sleeps.slice(2), Array(plan.steps.length - 1).fill(1500));
  assert.ok(sleeps.every((ms) => ms > 0));

  const slept = [];
  assert.throws(() => queryWithRetry(() => { throw new Error('D1 DB is overloaded [code: 7429]'); }, 'SELECT 1', {}, { sleep: (ms) => slept.push(ms), log: () => {} }), /7429/);
  assert.deepEqual(slept, BOUNDS.backoffMs, 'gives up after the last backoff');
  let calls = 0;
  assert.throws(() => queryWithRetry(() => { calls += 1; throw new Error('syntax error'); }, 'SELECT 1', {}, { sleep: () => assert.fail('no wait for a non-7429 error') }), /syntax/);
  assert.equal(calls, 1);
});

test('large deltas are sampled evenly and batched within the limits', () => {
  const keys = Array.from({ length: 5000 }, (_, i) => ({ key: String(i), values: [`k-${i}`], hash: 'h', bytes: 10 }));
  const s = evenSample(keys, 1000);
  assert.equal(s.length, 1000);
  assert.equal(s[0].key, '0');
  assert.equal(s.at(-1).key, '4999');
  const t = HASHED_TABLES.find((x) => x.name === 'documents');
  const big = keys.slice(0, 50).map((k) => ({ ...k, bytes: 1024 * 1024 }));
  assert.ok(batches(t, big).every((b) => b.reduce((n, k) => n + k.bytes, 0) <= BOUNDS.batchBytes));
  assert.ok(batches(t, s).every((b) => b.length <= BOUNDS.batchKeys));
  rmSync(TMP, { recursive: true, force: true });
});
