// The delta round trip (stage E): mutate a copy of a database, diff, apply the delta statement
// by statement to the original, and the per-table checksums equal the mutated copy's; applying
// it twice changes nothing (idempotent). Runs on a small database built from the migrations, and
// on the real build when present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, TableWriter, tableChecksums, transaction, rowHash, bindable } from '../../scripts/records/db.mjs';
import { buildDelta, MAX_STATEMENT_BYTES } from '../../scripts/records/diff-load.mjs';
import { REPO_ROOT } from '../../scripts/records/paths.mjs';
import { HASHED_TABLES, TABLE } from '../../scripts/records/schema.mjs';

const TMP = path.join(REPO_ROOT, 'tmp', 'records', 'test-delta');

function smallDb(file) {
  const db = createDatabase(file);
  transaction(db, () => {
    const e = new TableWriter(db, 'r_elections');
    e.add({ key: 'a__2020-01-01', slug: 'a-2020-01-01', body_slug: 'a', date: '2020-01-01', ord: 0, meta: '{"key":"a__2020-01-01","results":"$contests"}' });
    const k = new TableWriter(db, 'contests');
    k.add({ election_key: 'a__2020-01-01', seq: 0, name: 'North', slug: 'north', meta: '{}' });
    const c = new TableWriter(db, 'candidacies');
    for (let ord = 0; ord < 5; ord += 1) c.add({ election_key: 'a__2020-01-01', contest_seq: 0, ord, name: `Cand ${ord}`, first_prefs: 100 + ord, meta: '{}' });
    const cit = new TableWriter(db, 'citations');
    for (let ord = 0; ord < 3; ord += 1) cit.add({ subject_type: 'contest', subject_key: 'a/2020/north.json', ord, title: `Source ${ord}`, citation: '{}' });
    // A value too large for one statement, to exercise the append path.
    new TableWriter(db, 'documents').add({ name: 'big', body: 'x'.repeat(MAX_STATEMENT_BYTES * 3) });
    new TableWriter(db, 'person_aliases').add({ alias: 'old-1', slug: 'new-1' });
  });
  db.exec("INSERT INTO dataset (key, value) VALUES ('version', 'v1')");
  return db;
}

/** The same row update a loader would make: new values, new hash. */
function update(db, table, where, values) {
  const spec = TABLE[table];
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get();
  Object.assign(row, values);
  const vals = spec.columns.map((c) => c.name).filter((n) => n !== 'row_hash' && n !== 'row_hash_n').map((n) => bindable(row[n]));
  const [h, hn] = rowHash(vals);
  const sets = [...Object.keys(values), 'row_hash', 'row_hash_n'];
  db.prepare(`UPDATE ${table} SET ${sets.map((s) => `${s} = ?`).join(', ')} WHERE ${where}`).run(...Object.values(values).map(bindable), h, hn);
}

function applyDelta(file, sqlLines) {
  const db = new DatabaseSync(file);
  for (const line of sqlLines) db.exec(line);
  return db;
}

test('delta round trip: change, delete, add; applied once or twice it reproduces the target', () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const A = path.join(TMP, 'a.sqlite');
  const B = path.join(TMP, 'b.sqlite');
  smallDb(A).close();
  copyFileSync(A, B);
  const b = new DatabaseSync(B);
  update(b, 'candidacies', "election_key = 'a__2020-01-01' AND contest_seq = 0 AND ord = 2", { first_prefs: 999 });
  b.exec("DELETE FROM citations WHERE ord = 1");
  transaction(b, () => new TableWriter(b, 'person_aliases').add({ alias: 'old-2', slug: 'new-2' }));
  update(b, 'documents', "name = 'big'", { body: `y${'x'.repeat(MAX_STATEMENT_BYTES * 3)}` });
  b.exec("UPDATE dataset SET value = 'v2' WHERE key = 'version'");
  const want = tableChecksums(b, HASHED_TABLES);
  b.close();

  const lines = [];
  const result = buildDelta({ toFile: B, fromFile: A, write: (s) => lines.push(s), gitCommit: 'test', loadedAt: 'now' });
  assert.equal(result.summary.candidacies.upserted, 1);
  assert.equal(result.summary.citations.deleted, 1);
  assert.equal(result.summary.person_aliases.upserted, 1);
  assert.ok(lines.every((l) => Buffer.byteLength(l) < 100_000), 'every statement under D1\'s 100 KB limit');
  assert.ok(!lines.some((l) => /^\s*(BEGIN|COMMIT)/i.test(l)));
  assert.match(lines[0], /'loading'/);
  assert.match(lines.at(-1), /'version', 'v2'/);

  const C = path.join(TMP, 'c.sqlite');
  copyFileSync(A, C);
  let c = applyDelta(C, lines);
  assert.deepEqual(tableChecksums(c, HASHED_TABLES), want);
  assert.equal(c.prepare("SELECT value FROM dataset WHERE key = 'loading'").get().value, '');
  c.close();
  c = applyDelta(C, lines);
  assert.deepEqual(tableChecksums(c, HASHED_TABLES), want, 'idempotent');
  c.close();
});

test('a full load (no --from) reproduces the target from an empty database', () => {
  mkdirSync(TMP, { recursive: true });
  const A = path.join(TMP, 'full-src.sqlite');
  smallDb(A).close();
  const lines = [];
  buildDelta({ toFile: A, fromFile: null, write: (s) => lines.push(s) });
  const E = path.join(TMP, 'empty.sqlite');
  createDatabase(E).close();
  const e = applyDelta(E, lines);
  const a = new DatabaseSync(A, { readOnly: true });
  assert.deepEqual(tableChecksums(e, HASHED_TABLES), tableChecksums(a, HASHED_TABLES));
  e.close();
  a.close();
  rmSync(TMP, { recursive: true, force: true });
});

test('on the real build: a delta from itself is empty', { skip: !existsSync(path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite')) && 'no build' }, () => {
  const file = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
  const lines = [];
  const result = buildDelta({ toFile: file, fromFile: file, write: (s) => lines.push(s) });
  assert.equal(result.statements, 2);
});

test('a build stamp alone does not change a document\'s hash, so it gives no delta', () => {
  mkdirSync(TMP, { recursive: true });
  const docs = (stamp, extra = {}) => [
    { name: 'elections-test2.json', body: JSON.stringify({ schemaVersion: 1, generatedAt: stamp, count: 3, ...extra }) },
    { name: 'graph/manifest.json', body: JSON.stringify({ generatedAt: stamp, inputs: { 'persons.json': stamp }, entities: 10 }) },
    { name: 'graph/properties.json', body: JSON.stringify({ generatedAt: stamp, inputs: { kept: stamp } }) },
    { name: 'plain', body: 'not json "generatedAt"' },
  ];
  const make = (file, list) => {
    const db = createDatabase(file);
    transaction(db, () => { const w = new TableWriter(db, 'documents'); for (const d of list) w.add(d); });
    db.close();
  };
  const A = path.join(TMP, 'stamp-a.sqlite');
  const B = path.join(TMP, 'stamp-b.sqlite');
  const C = path.join(TMP, 'stamp-c.sqlite');
  make(A, docs('2026-11-06T19:13:22.596Z'));
  make(B, docs('2026-11-06T21:01:06.626Z'));
  make(C, docs('2026-11-06T21:01:06.626Z', { count: 4 }));
  const delta = (to, from) => buildDelta({ toFile: to, fromFile: from, write: () => {}, loadedAt: 'x' }).summary.documents;
  // graph/properties.json's `inputs` is data (only the graph manifest's is a stamp map).
  assert.deepEqual(delta(B, A), { deleted: 0, upserted: 1 });
  const a = new DatabaseSync(A, { readOnly: true });
  const b = new DatabaseSync(B, { readOnly: true });
  const hash = (db, name) => db.prepare('SELECT row_hash FROM documents WHERE name = ?').get(name).row_hash;
  const changed = b.prepare('SELECT name FROM documents ORDER BY name').all().map((r) => r.name).filter((name) => hash(a, name) !== hash(b, name));
  a.close();
  b.close();
  assert.deepEqual(changed, ['graph/properties.json']);
  assert.deepEqual(delta(C, B), { deleted: 0, upserted: 1 }, 'a real change still loads');
  // The stored body keeps its stamp.
  const c = new DatabaseSync(C, { readOnly: true });
  assert.match(c.prepare("SELECT body FROM documents WHERE name = 'elections-test2.json'").get().body, /"generatedAt":"2026-11-06T21:01:06.626Z"/);
  c.close();
  rmSync(TMP, { recursive: true, force: true });
});
