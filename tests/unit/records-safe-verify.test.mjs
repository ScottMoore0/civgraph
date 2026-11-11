// The safe live verify (packages/loader/src/safe-verify.mjs), tested against two local SQLite
// copies standing in for the build and for D1. On 2026-11-06 a remote verify's 47 whole-table
// checksums overloaded the live database (7429; /_api 500/503 for two minutes). These tests hold
// the safe verify to its promises: every statement it sends is a primary-key range read under a
// LIMIT (checked on the statement's own query plan), one at a time with a pause, inside a
// rows_read budget, stopped at once by a 7429 and resumable; and it still finds a wrong, missing
// or extra row, in the ranges the delta touched as well as in a full walk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bindable, createDatabase, rowHash, TableWriter, transaction } from '../../packages/loader/src/db.mjs';
import { buildDelta } from '../../packages/loader/src/diff-load.mjs';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { TABLE } from '../../packages/schema/src/schema.mjs';
import { openSqliteHandle } from '../../packages/storage/src/sqlite.mjs';
import {
  BOUNDS, isOverloaded, isTransientAuth, isWranglerCrash, parseWranglerOutput, WINDOWS_ABORT_STATUS, WranglerError,
} from '../../packages/loader/src/verify-load.mjs';
import {
  assertBounded, boundsSql, compoundTerms, computePlan, formatReport, loadPlan, parseDeltaSql, publishInProgress, rangeChecksumSql, rangeKeysSql,
  reportFileFor, resolveDelta, safeVerify, scannedTables, selectRanges, TouchedKeys, touchedFromDeltaDir, touchedFromSnapshot,
} from '../../packages/loader/src/safe-verify.mjs';

const SCRIPT = path.join(REPO_ROOT, 'packages', 'loader', 'src', 'safe-verify.mjs');
const LIMITS = { rangeRows: 100, rangeBytes: 64 * 1024 };
const EK = 'a__2020-01-01';

function tmp(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'safe-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A small build: composite, text and integer primary keys, wide rows, quotes in keys. */
function build(file, version = 'v1') {
  const db = createDatabase(file);
  transaction(db, () => {
    new TableWriter(db, 'r_elections').add({ key: EK, slug: 'a-2020-01-01', body_slug: 'a', date: '2020-01-01', ord: 0, meta: '{}' });
    const contests = new TableWriter(db, 'contests');
    const cands = new TableWriter(db, 'candidacies');
    for (let seq = 0; seq < 3; seq += 1) {
      contests.add({ election_key: EK, seq, name: `C${seq}`, slug: `c${seq}`, meta: '{}' });
      for (let ord = 0; ord < 400; ord += 1) cands.add({ election_key: EK, contest_seq: seq, ord, name: `Cand ${seq}-${ord}`, first_prefs: ord, meta: '{}' });
    }
    const docs = new TableWriter(db, 'documents');
    for (let i = 0; i < 40; i += 1) docs.add({ name: `doc-${String(i).padStart(2, '0')}`, body: JSON.stringify({ n: i, pad: 'x'.repeat(i % 4 === 0 ? 20_000 : 50) }) });
    const aliases = new TableWriter(db, 'person_aliases');
    for (let i = 0; i < 300; i += 1) aliases.add({ alias: `o'neill-${String(i).padStart(3, '0')}`, slug: `p-${i}` });
    const events = new TableWriter(db, 'party_events');
    for (let ord = 0; ord < 500; ord += 1) events.add({ ord, party_id: `party-${ord % 7}`, date: '2020-01-01', kind: 'k', meta: '{}' });
  });
  db.exec(`INSERT INTO dataset (key, value) VALUES ('version', '${version}'), ('git_commit', 'abc')`);
  db.close();
}

/** Change a row's values and recompute its hash, as a build would. */
function update(db, table, where, values) {
  const spec = TABLE[table];
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get();
  Object.assign(row, values);
  const vals = spec.columns.map((c) => c.name).filter((n) => n !== 'row_hash' && n !== 'row_hash_n').map((n) => bindable(row[n]));
  const [h, hn] = rowHash(vals);
  const sets = [...Object.keys(values), 'row_hash', 'row_hash_n'];
  db.prepare(`UPDATE ${table} SET ${sets.map((s) => `${s} = ?`).join(', ')} WHERE ${where}`).run(...Object.values(values).map(bindable), h, hn);
}

function edit(file, fn) {
  const db = openSqliteHandle(file);
  try { fn(db); } finally { db.close(); }
}

/** D1's answer to a compound SELECT of more than 5 terms, as wrangler prints it on stdout. */
const D1_TOO_MANY_TERMS = JSON.stringify({ error: {
  text: 'A request to the Cloudflare API (/accounts/0123abcd/d1/database/aaaa-bbbb/query) failed.',
  notes: [{ text: 'too many terms in compound SELECT: SQLITE_ERROR [code: 7500]' }], kind: 'error', name: 'APIError', code: 7500, accountTag: '0123abcd',
} }, null, 2);
const ABORT = 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76\r\n';

/**
 * A query function over a SQLite file standing in for D1, recording every statement. Like D1 it
 * refuses a compound SELECT of more than 5 terms (with wrangler's abort after it, as on Windows).
 */
function fakeD1(file, { rowsRead, durationMs, fail } = {}) {
  const db = openSqliteHandle(file, { readOnly: true });
  const seen = [];
  const query = (sql) => {
    seen.push(sql);
    const err = fail?.(sql, seen.length);
    if (err) throw err;
    if (compoundTerms(sql) > 5) parseWranglerOutput(WINDOWS_ABORT_STATUS, D1_TOO_MANY_TERMS, ABORT);
    const rows = db.prepare(sql).all().map((r) => ({ ...r }));
    if (rowsRead) Object.defineProperty(rows, 'rowsRead', { value: rowsRead(sql, rows) });
    if (durationMs) Object.defineProperty(rows, 'durationMs', { value: durationMs(sql) });
    return rows;
  };
  return { query, seen, close: () => db.close() };
}

function fixture(t) {
  const dir = tmp(t);
  const BUILD = path.join(dir, 'build.sqlite');
  const D1 = path.join(dir, 'd1.sqlite');
  build(BUILD);
  copyFileSync(BUILD, D1);
  return { dir, BUILD, D1 };
}

const run = (dir, file, d1, extra = {}) => safeVerify({
  file, query: d1.query, target: 'test', cacheDir: dir, sleep: () => {}, log: () => {}, noDelta: true, ...LIMITS, ...extra,
});

test('plan: the ranges partition every table, open at both ends, at most rangeRows rows, wide tables cut by bytes', (t) => {
  const { BUILD } = fixture(t);
  const plan = computePlan(BUILD, LIMITS);
  const db = openSqliteHandle(BUILD, { readOnly: true });
  try {
    for (const tp of plan.tables) {
      assert.equal(tp.rows, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${tp.name}`).get().n), tp.name);
      assert.equal(tp.ranges.reduce((n, r) => n + r.rows, 0), tp.rows, tp.name);
      assert.equal(tp.ranges[0].lo, null, `${tp.name} first range open below`);
      assert.equal(tp.ranges.at(-1).hi, null, `${tp.name} last range open above`);
      for (let i = 1; i < tp.ranges.length; i += 1) assert.deepEqual(tp.ranges[i].lo, tp.ranges[i - 1].hi, `${tp.name} ranges meet`);
      for (const r of tp.ranges) {
        assert.ok(r.rows <= LIMITS.rangeRows, r.id);
        assert.equal(Number(db.prepare(rangeChecksumSql(tp, r)).get().n), r.rows, `${r.id} holds the rows the plan says`);
      }
    }
    const byName = Object.fromEntries(plan.tables.map((x) => [x.name, x]));
    assert.equal(byName.candidacies.ranges.length, 12);
    assert.equal(byName.party_events.ranges.length, 5);
    assert.equal(byName.person_aliases.ranges.length, 3);
    // 10 documents of 20 KB: cut by bytes (64 KB), not rows.
    assert.ok(byName.documents.bytesCounted);
    assert.ok(byName.documents.ranges.length >= 3, `documents in ${byName.documents.ranges.length} ranges`);
    assert.ok(byName.documents.ranges.every((r) => r.bytes <= LIMITS.rangeBytes + 20_100));
    assert.equal(byName.persons.ranges.length, 1, 'an empty table is one range');
    assert.equal(byName.persons.rows, 0);
  } finally {
    db.close();
  }
});

test('plan: cached per build, recomputed when the build changes', (t) => {
  const { dir, BUILD } = fixture(t);
  const a = loadPlan(BUILD, { ...LIMITS, cacheDir: dir });
  const b = loadPlan(BUILD, { ...LIMITS, cacheDir: dir });
  assert.deepEqual(b, a);
  edit(BUILD, (db) => db.exec("INSERT INTO party_events (ord, party_id, meta, row_hash, row_hash_n) VALUES (900, 'p', '{}', 'h', 1)"));
  const c = loadPlan(BUILD, { ...LIMITS, cacheDir: dir });
  assert.notEqual(c.id, a.id);
  assert.equal(c.tables.find((x) => x.name === 'party_events').rows, 501);
});

test('every statement is a primary-key range read under a LIMIT; the guard refuses a scan or a missing LIMIT', (t) => {
  const { BUILD } = fixture(t);
  const plan = computePlan(BUILD, LIMITS);
  const db = openSqliteHandle(BUILD, { readOnly: true });
  try {
    for (const tp of plan.tables) {
      for (const r of tp.ranges) {
        const whole = !r.lo && !r.hi;
        for (const sql of [rangeChecksumSql(tp, r), rangeKeysSql(tp, r)]) {
          assert.match(sql, / LIMIT \d+\)?$/);
          assert.deepEqual(scannedTables(db, sql), whole ? [tp.name] : [], `${r.id}: ${sql}`);
          assert.doesNotThrow(() => assertBounded(db, sql, whole ? tp.name : null));
        }
      }
    }
    // The old check's statement, and a LIMITed scan of a big table, are refused.
    assert.throws(() => assertBounded(db, 'SELECT COUNT(*) AS n, COALESCE(SUM(row_hash_n), 0) AS s FROM candidacies'), /no LIMIT/);
    assert.throws(() => assertBounded(db, 'SELECT COUNT(*) AS n FROM (SELECT row_hash_n FROM candidacies LIMIT 5)'), /would scan candidacies/);
    assert.throws(() => assertBounded(db, "SELECT COUNT(*) AS n FROM (SELECT row_hash_n FROM candidacies WHERE name = 'x' LIMIT 5)"), /would scan candidacies/);
    const mid = plan.tables.find((x) => x.name === 'candidacies').ranges[5];
    assert.match(rangeChecksumSql({ name: 'candidacies', pk: TABLE.candidacies.pk }, mid), /\(election_key, contest_seq, ord\) >= \('a__2020-01-01', 1, 100\) AND \(election_key, contest_seq, ord\) < \('a__2020-01-01', 1, 200\) LIMIT 101\)$/);
  } finally {
    db.close();
  }
});

test('identical copies: --full passes, every range read once, one statement at a time with a pause between', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const d1 = fakeD1(D1);
  const sleeps = [];
  const report = run(dir, BUILD, d1, { full: true, pauseMs: 7, sleep: (ms) => sleeps.push(ms) });
  d1.close();
  assert.equal(report.outcome, 'PASS', formatReport(report));
  assert.equal(report.verified, report.totalRanges);
  assert.equal(report.rowsCovered, report.totalRows);
  assert.equal(report.pending, 0);
  assert.equal(report.statements, 4 + report.totalRanges, 'the dataset, the schema, the bounds (6 tables: 2 statements), then one statement per range');
  assert.equal(d1.seen.length, report.statements);
  assert.equal(new Set(d1.seen).size, d1.seen.length, 'no statement sent twice');
  assert.deepEqual(sleeps, Array(report.statements - 1).fill(7));
  assert.ok(d1.seen.every((sql) => / LIMIT \d+\b/.test(sql)));
  assert.ok(existsSync(reportFileFor(report.stateFile)));
  assert.match(formatReport(report), /^PASS: test equals .* \(version v1\)/);
  assert.match(formatReport(report), /rows covered: 2044 of 2044 \(100\.0%\)/);
});

test('corrupted ranges fail, each drilled to the key: a changed row, a missing row, a row swapped for another', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  edit(D1, (db) => {
    update(db, 'candidacies', `election_key = '${EK}' AND contest_seq = 1 AND ord = 150`, { first_prefs: 9999 });
    // One row gone and another in its place: the range's count is right, its checksum is not.
    db.exec("DELETE FROM person_aliases WHERE alias = 'o''neill-150'");
    db.exec("INSERT INTO person_aliases (alias, slug, row_hash, row_hash_n) VALUES ('o''neill-150a', 's', 'h', 1)");
    db.exec("DELETE FROM party_events WHERE ord = 250");
  });
  const d1 = fakeD1(D1);
  const report = run(dir, BUILD, d1, { full: true, drill: 10 });
  d1.close();
  assert.equal(report.outcome, 'FAIL');
  assert.equal(report.failed, 3, formatReport(report));
  assert.match(report.cheap.join('\n'), /bounds: ok/);
  const text = report.mismatches.join('\n');
  assert.match(text, /candidacies#5: local 100 rows/);
  assert.match(text, /candidacies \["a__2020-01-01",1,150\]: row_hash local/);
  assert.match(text, /person_aliases#1: local 100 rows \/ \d+, D1 100 \/ \d+/);
  assert.match(text, /person_aliases \["o'neill-150"\]: missing in D1/);
  assert.match(text, /person_aliases \["o'neill-150a"\]: in D1, not in the build/);
  assert.match(text, /party_events#2: local 100 rows .* D1 99 /);
  assert.match(text, /party_events \[250\]: missing in D1/);
  // A range is never read past its LIMIT.
  assert.ok(d1.seen.filter((s) => s.includes('FROM party_events WHERE ord >=')).every((s) => /LIMIT (101|150)\)?$/.test(s)));
});

test('bounds: rows past either end of a table fail the cheap checks, before any range is read', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const plan = computePlan(BUILD, LIMITS);
  const db = openSqliteHandle(BUILD, { readOnly: true });
  try {
    // At most 5 tables a statement: D1 refuses a compound SELECT of more terms (code 7500).
    const stmts = boundsSql(plan.tables);
    assert.deepEqual(stmts.map((x) => x.tables.length), [5, 1]);
    const all = stmts.flatMap((x) => x.tables).sort();
    assert.deepEqual(all, ['candidacies', 'contests', 'documents', 'party_events', 'person_aliases', 'r_elections']);
    for (const x of stmts) {
      assert.equal(compoundTerms(x.sql), x.tables.length);
      assert.deepEqual(scannedTables(db, x.sql), [], 'index seeks only');
      assert.doesNotThrow(() => assertBounded(db, x.sql));
    }
    // The single statement the first live run sent (54 terms) is refused before it is sent.
    const [one] = boundsSql(plan.tables, BOUNDS.statementBytes, 100);
    assert.equal(compoundTerms(one.sql), 6);
    assert.throws(() => assertBounded(db, one.sql), /refused: a compound SELECT of 6 terms \(D1 allows 5\)/);
    // Split to fit wrangler's command line.
    const small = boundsSql(plan.tables, 600);
    assert.ok(small.length > 2);
    assert.deepEqual(small.flatMap((x) => x.tables).sort(), all);
  } finally {
    db.close();
  }
  edit(D1, (db) => {
    db.exec("INSERT INTO party_events (ord, party_id, meta, row_hash, row_hash_n) VALUES (100000, 'p', '{}', 'h', 1)");
    db.exec("INSERT INTO person_aliases (alias, slug, row_hash, row_hash_n) VALUES ('AAA-before-every-key', 's', 'h', 1)");
  });
  const d1 = fakeD1(D1);
  const report = run(dir, BUILD, d1, { full: true });
  d1.close();
  assert.equal(report.outcome, 'FAIL');
  assert.equal(report.statements, 4, 'the dataset, the schema, the bounds (2 statements): nothing more');
  assert.deepEqual(report.mismatches.sort(), ["party_events: D1 has rows above the build's last key", "person_aliases: D1 has rows below the build's first key"]);
  assert.match(report.cheap.join('\n'), /bounds: DIFFER/);
});

test('sample mode: small tables whole, a capped draw of the delta\'s ranges, a seeded sample', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const plan = computePlan(BUILD, LIMITS);
  const a = selectRanges(plan, { sample: 3, seed: 42 });
  assert.deepEqual(selectRanges(plan, { sample: 3, seed: 42 }), a, 'the same seed draws the same sample');
  assert.notDeepEqual(selectRanges(plan, { sample: 3, seed: 43 }), a);
  const reasons = a.reduce((acc, p) => ({ ...acc, [p.reason]: (acc[p.reason] || 0) + 1 }), {});
  const multi = plan.tables.filter((x) => x.ranges.length > 1);
  assert.deepEqual(reasons, { small: plan.tables.length - multi.length, sample: 3 });
  assert.equal(new Set(a.map((p) => p.id)).size, a.length, 'no range twice');
  // A big delta is checked a slice per run: --delta-ranges of its ranges.
  const touched = new Set(plan.tables.flatMap((x) => x.ranges.map((r) => r.id)));
  const capped = selectRanges(plan, { sample: 0, deltaRanges: 4, seed: 7, touched });
  assert.equal(capped.filter((p) => p.reason === 'delta').length, 4);
  assert.equal(selectRanges(plan, { sample: 0, deltaRanges: Infinity, seed: 7, touched }).length, plan.tables.reduce((n, x) => n + x.ranges.length, 0));

  const d1 = fakeD1(D1);
  const report = run(dir, BUILD, d1, { sample: 4, seed: 1 });
  d1.close();
  assert.equal(report.outcome, 'PASS', formatReport(report));
  assert.equal(report.verified, plan.tables.length - multi.length + 4);
  assert.ok(report.verified < report.totalRanges, 'a sample, not the whole walk');
  assert.match(formatReport(report), /selected \d+ \(\d+\.\d%\)/);
});

/** old -> new (changed, added and deleted rows, a wide value, quotes), the delta in two parts, D1 = old + delta. */
function deltaFixture(t) {
  const dir = tmp(t);
  const OLD = path.join(dir, 'old.sqlite');
  const NEW = path.join(dir, 'new.sqlite');
  const D1 = path.join(dir, 'd1.sqlite');
  const PARTS = path.join(dir, 'delta');
  build(OLD);
  copyFileSync(OLD, NEW);
  edit(NEW, (db) => transaction(db, () => {
    // A middle range of candidacies (#5): checked only because the delta touched it.
    for (let ord = 150; ord < 160; ord += 1) update(db, 'candidacies', `election_key = '${EK}' AND contest_seq = 1 AND ord = ${ord}`, { first_prefs: ord * 10 });
    update(db, 'documents', "name = 'doc-07'", { body: JSON.stringify({ wide: "it's\nwide; (really)".repeat(5000) }) });
    db.exec("DELETE FROM person_aliases WHERE alias = 'o''neill-042'");
    new TableWriter(db, 'party_events').add({ ord: 777, party_id: 'new', date: null, kind: 'k', meta: '{}' });
    db.exec("UPDATE dataset SET value = 'v2' WHERE key = 'version'");
  }));
  const lines = [];
  buildDelta({ toFile: NEW, fromFile: OLD, write: (s) => lines.push(s), loadedAt: 'now' });
  mkdirSync(PARTS);
  const half = Math.ceil(lines.length / 2);
  writeFileSync(path.join(PARTS, '0000.sql'), lines.slice(0, half).join(''));
  writeFileSync(path.join(PARTS, '0001.sql'), lines.slice(half).join(''));
  copyFileSync(OLD, D1);
  edit(D1, (db) => { for (const l of lines) db.exec(l); });
  return { dir, OLD, NEW, D1, PARTS };
}

test('delta: the keys read from the delta SQL parts equal the snapshot diff, and mark the same ranges', (t) => {
  const { NEW, OLD, PARTS } = deltaFixture(t);
  const plan = computePlan(NEW, LIMITS);
  const fromParts = new TouchedKeys();
  const res = touchedFromDeltaDir(PARTS, 'v2', fromParts);
  assert.ok(res);
  assert.equal(res.parts, 2);
  assert.equal(res.unknown, 0);
  const fromSnap = new TouchedKeys();
  touchedFromSnapshot(NEW, OLD, fromSnap);
  assert.deepEqual(fromParts.counts(), fromSnap.counts());
  assert.deepEqual(fromParts.counts(), { candidacies: 10, documents: 1, person_aliases: 1, party_events: 1 });
  const ids = fromParts.rangesIn(plan);
  assert.deepEqual([...ids].sort(), [...fromSnap.rangesIn(plan)].sort());
  assert.ok(ids.has('candidacies#5'), [...ids].join(' '));
  assert.ok(ids.has('party_events#5'), 'the new last key lands in the open-ended last range');
  assert.equal(ids.size, 4 + 0, [...ids].join(' '));
  fromParts.close();
  fromSnap.close();
  // Parts written for another build are not used.
  const other = new TouchedKeys();
  assert.equal(touchedFromDeltaDir(PARTS, 'v3', other), null);
  other.close();
});

test('delta: resolveDelta prefers --since, then a snapshot not yet replaced, then this build\'s parts', (t) => {
  const { dir, NEW, OLD, PARTS } = deltaFixture(t);
  const snap = (snapshot, defaultDeltaDir) => {
    const r = resolveDelta({ file: NEW, version: 'v2', snapshot, defaultDeltaDir });
    r.touched?.close();
    return r.source;
  };
  assert.match(snap(OLD, PARTS), /snapshot not yet replaced/);
  const passed = path.join(dir, 'passed.sqlite');
  copyFileSync(NEW, passed);
  assert.match(snap(passed, PARTS), /\(2 parts, \d+ statements\)/, 'after a PASS the snapshot is the build: the parts are read');
  assert.match(snap(passed, path.join(dir, 'nowhere')), /none found/);
  const r = resolveDelta({ file: NEW, version: 'v2', since: OLD, snapshot: passed, defaultDeltaDir: PARTS });
  assert.match(r.source, /^--since /);
  r.touched.close();
  assert.throws(() => resolveDelta({ file: NEW, version: 'v9', deltaDir: PARTS }), /no delta parts for build v9/);
});

test('delta-aware run: the touched ranges are checked; a write the load lost fails even with no random sample', (t) => {
  const { dir, NEW, D1, PARTS, OLD } = deltaFixture(t);
  let d1 = fakeD1(D1);
  let report = run(dir, NEW, d1, { noDelta: false, defaultDeltaDir: PARTS, sample: 0, seed: 3 });
  d1.close();
  assert.equal(report.outcome, 'PASS', formatReport(report));
  assert.match(report.notes.join('\n'), /delta: 13 keys in 4 tables .*: 4 ranges touched/);
  assert.match(report.notes.join('\n'), /selected \d+ \(small \d+, delta 4\)/);
  // Undo one of the delta's writes in D1, as a lost part would.
  const where = `election_key = '${EK}' AND contest_seq = 1 AND ord = 155`;
  const old = openSqliteHandle(OLD, { readOnly: true });
  const row = old.prepare(`SELECT first_prefs, row_hash, row_hash_n FROM candidacies WHERE ${where}`).get();
  old.close();
  edit(D1, (db) => db.prepare(`UPDATE candidacies SET first_prefs = ?, row_hash = ?, row_hash_n = ? WHERE ${where}`).run(row.first_prefs, row.row_hash, row.row_hash_n));
  d1 = fakeD1(D1);
  report = run(dir, NEW, d1, { noDelta: false, defaultDeltaDir: PARTS, sample: 0, seed: 3 });
  d1.close();
  assert.equal(report.outcome, 'FAIL');
  assert.match(report.mismatches.join('\n'), /candidacies#5: .*\n {2}candidacies \["a__2020-01-01",1,155\]: row_hash local/);
  // Without the delta (and no random sample) the same run misses it: the delta is what finds it.
  d1 = fakeD1(D1);
  report = run(dir, NEW, d1, { sample: 0, seed: 3 });
  d1.close();
  assert.equal(report.outcome, 'PASS');
});

test('parseDeltaSql: literals, quotes, newlines, a key in any column order, wide-value UPDATE pieces, a full-load DELETE', () => {
  const text = [
    "INSERT OR REPLACE INTO dataset (key, value) VALUES ('loading', 'v9');",
    "DELETE FROM person_aliases WHERE alias IN ('a''b', 'c');",
    "DELETE FROM candidacies WHERE (election_key, contest_seq, ord) IN (VALUES ('e', 1, 2), ('e', 1, -3));",
    "INSERT OR REPLACE INTO candidacies (name, ord, election_key, contest_seq, meta) VALUES ('x, y', 5, 'e;(1)', 2, '{\"a\":\"it''s\nmulti), (line);\"}'), ('z', 6, 'e', 2, NULL);",
    "UPDATE documents SET body = body || 'semi; colon '' quote\nnewline' WHERE name = 'd1';",
    "INSERT OR REPLACE INTO documents (name, body, row_hash, row_hash_n) VALUES ('d1', '', 'h', 12), ('d2', 'x', 'h', 1.5e-7);",
    'DELETE FROM party_events;',
    "INSERT OR REPLACE INTO dataset (key, value) VALUES ('version', 'v9'), ('loading', '');",
    '',
  ].join('\n');
  const keys = [];
  const tables = [];
  const res = parseDeltaSql(text, { key: (tb, v) => keys.push([tb, v]), table: (tb) => tables.push(tb), pkOf: (tb) => TABLE[tb]?.hashed ? TABLE[tb].pk : null });
  assert.equal(res.loading, 'v9');
  assert.equal(res.statements, 8);
  assert.equal(res.unknown, 0);
  assert.deepEqual(tables, ['party_events']);
  assert.deepEqual(keys, [
    ['person_aliases', ["a'b"]], ['person_aliases', ['c']],
    ['candidacies', ['e', 1, 2]], ['candidacies', ['e', 1, -3]],
    ['candidacies', ['e;(1)', 2, 5]], ['candidacies', ['e', 2, 6]],
    ['documents', ['d1']], ['documents', ['d2']],
  ]);
  assert.throws(() => parseDeltaSql("INSERT OR REPLACE INTO candidacies (name) VALUES ('x');", { key: () => {}, pkOf: (tb) => TABLE[tb].pk }), /primary-key column is missing/);
});

test('cheap checks: a different dataset or schema fails before any range is read; a load in progress is refused', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  edit(D1, (db) => db.exec("UPDATE dataset SET value = 'v0' WHERE key = 'version'"));
  let d1 = fakeD1(D1);
  let report = run(dir, BUILD, d1);
  d1.close();
  assert.equal(report.outcome, 'FAIL');
  assert.equal(report.statements, 2);
  assert.match(report.mismatches[0], /dataset version: local v1, D1 v0/);
  assert.match(report.stop, /no range was read/);

  edit(D1, (db) => { db.exec("UPDATE dataset SET value = 'v1' WHERE key = 'version'"); db.exec('DROP INDEX party_events_party'); });
  d1 = fakeD1(D1);
  report = run(dir, BUILD, d1);
  d1.close();
  assert.equal(report.outcome, 'FAIL');
  assert.equal(report.statements, 2);
  assert.match(report.mismatches.join('\n'), /schema party_events_party differs or is missing in D1/);

  edit(D1, (db) => db.exec("INSERT INTO dataset (key, value) VALUES ('loading', 'v2')"));
  d1 = fakeD1(D1);
  report = run(dir, BUILD, d1);
  d1.close();
  assert.equal(report.outcome, 'REFUSED');
  assert.equal(report.statements, 1);
  assert.match(report.stop, /load is in progress/);
});

test('the rows_read budget stops a run, and --resume finishes it without reading a verified range again', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const d1 = fakeD1(D1);
  const reports = [];
  for (let i = 0; i < 60; i += 1) {
    const report = run(dir, BUILD, d1, { full: true, budget: 900, resume: i > 0 });
    reports.push(report);
    if (report.outcome !== 'INCOMPLETE') break;
    assert.match(report.stop, /^budget: /);
    assert.ok(report.rowsRead <= 900, `run ${i} read ${report.rowsRead}`);
  }
  d1.close();
  const last = reports.at(-1);
  assert.ok(reports.length > 3, `${reports.length} runs`);
  assert.equal(last.outcome, 'PASS', formatReport(last));
  assert.equal(last.verified, last.totalRanges);
  const rangeStatements = d1.seen.filter((s) => s.startsWith('SELECT COUNT(*) AS n'));
  assert.equal(rangeStatements.length, last.totalRanges, 'each range read once over all the runs');
  assert.equal(new Set(rangeStatements).size, rangeStatements.length);
  assert.ok(last.rowsReadAllRuns >= last.totalRows);
});

test('a 7429 stops the run at once and --resume carries on; --overload-retries waits and goes slower; a 7403 is retried', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const overloaded = new Error('wrangler d1 execute failed (1): D1 DB is overloaded. Too many requests queued. [code: 7429]');
  let d1 = fakeD1(D1, { fail: (sql, n) => (n === 6 ? overloaded : null) });
  let report = run(dir, BUILD, d1, { full: true });
  assert.equal(report.outcome, 'INCOMPLETE');
  assert.match(report.stop, /^overloaded: D1 answered 7429/);
  assert.equal(d1.seen.length, 6, 'nothing sent after the 7429');
  assert.equal(report.verified, 1);
  report = run(dir, BUILD, d1, { full: true, resume: true });
  assert.equal(report.outcome, 'PASS', formatReport(report));
  d1.close();

  const sleeps = [];
  d1 = fakeD1(D1, { fail: (sql, n) => (n === 5 ? overloaded : null) });
  report = run(dir, BUILD, d1, { full: true, overloadRetries: 1, overloadWaitMs: 60_000, pauseMs: 500, sleep: (ms) => sleeps.push(ms) });
  d1.close();
  assert.equal(report.outcome, 'PASS');
  assert.ok(sleeps.includes(60_000), 'waited after the 7429');
  assert.equal(sleeps.at(-1), 1000, 'and paused twice as long after it');

  const refused = new Error('The given account is not valid or is not authorized to access this service [code: 7403]');
  sleeps.length = 0;
  d1 = fakeD1(D1, { fail: (sql, n) => (n === 3 ? refused : null) });
  report = run(dir, BUILD, d1, { full: true, authBackoffMs: [15_000], sleep: (ms) => sleeps.push(ms) });
  d1.close();
  assert.equal(report.outcome, 'PASS');
  assert.ok(sleeps.includes(15_000));

  d1 = fakeD1(D1, { fail: (sql, n) => (n === 3 ? new Error('SQLITE_ERROR: no such column') : null) });
  report = run(dir, BUILD, d1, { full: true });
  d1.close();
  assert.equal(report.outcome, 'INCOMPLETE');
  assert.match(report.stop, /^error: the statement failed: SQLITE_ERROR/);
});

// 11 Nov 2026: the first live runs stopped on the bounds statement with only wrangler's abort,
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ... async.c, line 76", exit 0xC0000409.
// wrangler (4.85, Node 24, Windows) aborts on the way out of every error; D1's own answer, on
// stdout, was "too many terms in compound SELECT [code: 7500]" (D1 allows 5 terms).
const answer = (rows, meta = {}) => JSON.stringify([{ results: rows, success: true, meta: { rows_read: 7, duration: 0.5, ...meta } }], null, 2);
const d1Error = (note, code) => JSON.stringify({ error: { text: 'A request to the Cloudflare API (/accounts/abc7429def/d1/database/1234-7403/query) failed.', notes: [{ text: note }], kind: 'error', name: 'APIError', code, accountTag: 'abc7429def' } }, null, 2);
const caught = (fn) => { try { fn(); } catch (error) { return error; } assert.fail('expected a throw'); };

test('parseWranglerOutput: rows, D1\'s error and code from stdout behind wrangler\'s abort, and a bare abort', () => {
  const rows = parseWranglerOutput(0, answer([{ a: 1 }]), '');
  assert.deepEqual([...rows], [{ a: 1 }]);
  assert.equal(rows.rowsRead, 7);
  assert.equal(rows.durationMs, 0.5);
  // A whole successful answer printed before the abort is D1's answer.
  assert.equal(parseWranglerOutput(WINDOWS_ABORT_STATUS, answer([{ a: 2 }]), ABORT).rowsRead, 7);

  const e7500 = caught(() => parseWranglerOutput(WINDOWS_ABORT_STATUS, D1_TOO_MANY_TERMS, ABORT));
  assert.ok(e7500 instanceof WranglerError);
  assert.equal(e7500.d1Code, 7500);
  assert.equal(e7500.crashed, true);
  assert.match(e7500.message, /^wrangler d1 execute failed \(3221226505\): too many terms in compound SELECT: SQLITE_ERROR \[code: 7500\]; wrangler then aborted \(Assertion failed/);
  assert.doesNotMatch(e7500.message, /0123abcd|aaaa-bbbb/, 'no account or database id');
  assert.equal(isWranglerCrash(e7500), false, 'D1 answered: not retried as a crash');

  // The overload and the transient 7403 are recognised from stdout, as before from stderr.
  const e7429 = caught(() => parseWranglerOutput(WINDOWS_ABORT_STATUS, d1Error('D1 DB is overloaded. Too many requests queued. [code: 7429]', 7429), ABORT));
  assert.ok(isOverloaded(e7429));
  const e7403 = caught(() => parseWranglerOutput(WINDOWS_ABORT_STATUS, d1Error('The given account is not valid or is not authorized to access this service', 7403), ABORT));
  assert.ok(isTransientAuth(e7403));
  assert.match(e7403.message, /\[code: 7403\]/);
  // Digits in the account or database id never read as a code.
  const eOther = caught(() => parseWranglerOutput(1, d1Error('no such table: x: SQLITE_ERROR [code: 7500]', 7500), ''));
  assert.ok(!isOverloaded(eOther) && !isTransientAuth(eOther) && !isWranglerCrash(eOther), eOther.message);
  assert.ok(!isOverloaded(caught(() => parseWranglerOutput(1, '', 'request to /accounts/abc7429def/d1/database/x7403y/query failed'))));

  // No answer at all (nothing, or half an answer) behind the abort: a crash, retryable.
  for (const out of ['', answer([{ a: 1 }]).slice(0, 30)]) {
    const e = caught(() => parseWranglerOutput(WINDOWS_ABORT_STATUS, out, ABORT));
    assert.ok(isWranglerCrash(e), e.message);
    assert.match(e.message, /UV_HANDLE_CLOSING/);
  }
  assert.ok(isWranglerCrash(caught(() => parseWranglerOutput(3, '', ABORT))), 'the abort line alone marks it (other platforms\' exit codes)');
  // A plain failure is not a crash, and a non-crash exit with an answer still fails as before.
  assert.equal(isWranglerCrash(caught(() => parseWranglerOutput(1, '', 'some other failure'))), false);
  assert.throws(() => parseWranglerOutput(1, answer([]), 'x'), /wrangler d1 execute failed \(1\)/);
});

test('wranglerQuery reads D1\'s error from a wrangler that aborts after it (a fake wrangler process)', (t) => {
  const dir = tmp(t);
  const fake = path.join(dir, 'wrangler.js');
  writeFileSync(fake, `const mode = process.env.FAKE_WRANGLER_MODE;
const err = (note, code) => JSON.stringify({ error: { text: 'A request to the Cloudflare API (/accounts/abc/d1/database/def/query) failed.', notes: [{ text: note }], code } });
if (mode === 'ok') { process.stdout.write(${JSON.stringify(answer([{ x: 1 }], { rows_read: 3 }))}); process.exit(0); }
if (mode === 'ok-abort') process.stdout.write(${JSON.stringify(answer([{ x: 1 }], { rows_read: 3 }))});
if (mode === '7500') process.stdout.write(err('too many terms in compound SELECT: SQLITE_ERROR [code: 7500]', 7500));
if (mode === '7429') process.stdout.write(err('D1 DB is overloaded. Too many requests queued. [code: 7429]', 7429));
process.stderr.write(${JSON.stringify(ABORT)});
process.exit(process.platform === 'win32' ? 0xC0000409 : 134);
`);
  const runner = `import { wranglerQuery, isOverloaded, isWranglerCrash } from ${JSON.stringify(new URL('../../packages/loader/src/verify-load.mjs', import.meta.url).href)};
try { const r = wranglerQuery('SELECT 1 AS x LIMIT 1', { remote: true }); console.log(JSON.stringify({ rows: [...r], rowsRead: r.rowsRead })); }
catch (e) { console.log(JSON.stringify({ message: e.message, d1Code: e.d1Code, crashed: e.crashed, overloaded: isOverloaded(e), crash: isWranglerCrash(e) })); }`;
  const call = (mode) => {
    const res = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', runner], {
      cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CIVGRAPH_WRANGLER_JS: fake, FAKE_WRANGLER_MODE: mode },
    });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout.trim().split('\n').pop());
  };
  assert.deepEqual(call('ok'), { rows: [{ x: 1 }], rowsRead: 3 });
  assert.deepEqual(call('ok-abort'), { rows: [{ x: 1 }], rowsRead: 3 });
  const e7500 = call('7500');
  assert.equal(e7500.d1Code, 7500);
  assert.match(e7500.message, /too many terms in compound SELECT/);
  assert.equal(e7500.crash, false);
  assert.equal(call('7429').overloaded, true);
  const bare = call('bare');
  assert.equal(bare.crash, true);
  assert.equal(bare.d1Code, undefined);
});

test('wrangler aborting with no answer is retried twice, each lost try counted against the budget; D1\'s own error is not retried', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const abort = () => caught(() => parseWranglerOutput(WINDOWS_ABORT_STATUS, '', ABORT));
  // One abort on the first range: retried after 5 s, and the run passes.
  const sleeps = [];
  let d1 = fakeD1(D1, { fail: (sql, n) => (n === 5 ? abort() : null) });
  let report = run(dir, BUILD, d1, { full: true, sleep: (ms) => sleeps.push(ms) });
  d1.close();
  assert.equal(report.outcome, 'PASS', formatReport(report));
  assert.ok(sleeps.includes(5_000));
  assert.equal(d1.seen[4], d1.seen[5], 'the same statement sent again');
  const clean = run(dir, BUILD, (d1 = fakeD1(D1)), { full: true, stateFile: path.join(dir, 'clean.json') });
  d1.close();
  const cleanState = JSON.parse(readFileSync(path.join(dir, 'clean.json'), 'utf8'));
  const first = cleanState.results[cleanState.selection[0].id].rowsRead; // the first range's estimate
  const cheapRead = clean.rowsRead - Object.values(cleanState.results).reduce((n, r) => n + r.rowsRead, 0);
  assert.equal(report.rowsRead - clean.rowsRead, first, 'the lost try is counted as its estimate');

  // It keeps aborting: after the two retries the run stops, resumable, and --resume finishes it.
  d1 = fakeD1(D1, { fail: (sql, n) => (n >= 5 && n <= 7 ? abort() : null) });
  report = run(dir, BUILD, d1, { full: true, stateFile: path.join(dir, 'abort.json') });
  assert.equal(report.outcome, 'INCOMPLETE');
  assert.match(report.stop, /^error: the statement failed: .*UV_HANDLE_CLOSING/);
  assert.equal(d1.seen.length, 7, 'one try and two retries, then nothing');
  report = run(dir, BUILD, d1, { full: true, resume: true, stateFile: path.join(dir, 'abort.json') });
  d1.close();
  assert.equal(report.outcome, 'PASS', formatReport(report));

  // A retry that could pass the budget is not sent.
  d1 = fakeD1(D1, { fail: (sql, n) => (n === 5 ? abort() : null) });
  report = run(dir, BUILD, d1, { full: true, budget: cheapRead + 2 * first - 1, stateFile: path.join(dir, 'budget.json') });
  d1.close();
  assert.equal(report.outcome, 'INCOMPLETE');
  assert.match(report.stop, /^budget: rows_read budget: wrangler aborted with no answer/);
  assert.equal(d1.seen.length, 5);

  // D1 answered with an error (here the 54-term bounds statement of the live run): no retry.
  d1 = fakeD1(D1, { fail: (sql, n) => (n === 3 ? caught(() => parseWranglerOutput(WINDOWS_ABORT_STATUS, D1_TOO_MANY_TERMS, ABORT)) : null) });
  report = run(dir, BUILD, d1, { full: true, stateFile: path.join(dir, 'd1err.json') });
  d1.close();
  assert.equal(report.outcome, 'INCOMPLETE');
  assert.match(report.stop, /^error: the statement failed: wrangler d1 execute failed \(3221226505\): too many terms in compound SELECT: SQLITE_ERROR \[code: 7500\]/);
  assert.equal(d1.seen.length, 3);
});

test('D1\'s own rows_read is the budget\'s measure; a statement that reads far more than its range stops the run', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  let d1 = fakeD1(D1, { rowsRead: () => 10 });
  let report = run(dir, BUILD, d1, { full: true });
  d1.close();
  assert.equal(report.outcome, 'PASS');
  assert.equal(report.rowsRead, 10 * report.statements);

  const isRange = (sql) => sql.startsWith('SELECT COUNT(*) AS n') && sql.includes('FROM candidacies');
  d1 = fakeD1(D1, { rowsRead: (sql) => (isRange(sql) ? 1_000_000 : 1) });
  report = run(dir, BUILD, d1, { full: true });
  d1.close();
  assert.equal(report.outcome, 'INCOMPLETE');
  assert.match(report.stop, /^read-guard: D1 read 1000000 rows for a statement expected to read about 202/);
  assert.equal(d1.seen.filter(isRange).length, 1, 'stopped after the first such statement');
});

test('slow answers slow the run down, up to a pause of 30 s', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const sleeps = [];
  const d1 = fakeD1(D1, { durationMs: () => 1500 });
  const report = run(dir, BUILD, d1, { full: true, pauseMs: 2000, sleep: (ms) => sleeps.push(ms) });
  d1.close();
  assert.equal(report.outcome, 'PASS');
  assert.deepEqual(sleeps.slice(0, 5), [4000, 8000, 16000, 30000, 30000]);
});

test('--remote waits for a publish that is building or loading', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'publish-run.json');
  const now = Date.parse('2026-11-11T18:00:00Z');
  const write = (run) => writeFileSync(file, JSON.stringify({ run }));
  assert.equal(publishInProgress(path.join(dir, 'none.json'), now), null);
  write({ stage: 'built', dry: false, updatedAt: '2026-11-11T17:30:00Z' });
  assert.match(publishInProgress(file, now), /stage 'built' \(updated 30 min ago\)/);
  write({ stage: 'start', dry: false, updatedAt: '2026-11-11T17:59:00Z' });
  assert.match(publishInProgress(file, now), /stage 'start'/);
  write({ stage: 'built', dry: true, updatedAt: '2026-11-11T17:30:00Z' });
  assert.equal(publishInProgress(file, now), null, 'a dry run loads nothing');
  write({ stage: 'loaded', dry: false, updatedAt: '2026-11-11T17:30:00Z' });
  assert.equal(publishInProgress(file, now), null, 'the load is done');
  write({ stage: 'built', dry: false, updatedAt: '2026-11-10T17:30:00Z' });
  assert.equal(publishInProgress(file, now), null, 'a run that died a day ago does not block for ever');
});

test('CLI: --against a SQLite copy passes, fails on a corrupt copy, --plan reads nothing, and a mode is required', (t) => {
  const { dir, BUILD, D1 } = fixture(t);
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, '--db', BUILD, '--range-rows', '100', '--range-bytes', '65536', '--cache-dir', dir, ...args], { encoding: 'utf8' });
  let r = cli('--against', D1, '--full');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^PASS: file d1\.sqlite equals/m);
  assert.match(r.stdout, /rows_read: \d+ this run/);
  const state = path.join(dir, 'state-file_d1.sqlite.json');
  assert.ok(existsSync(state));
  assert.equal(JSON.parse(readFileSync(state, 'utf8')).runs.length, 1);

  r = cli('--against', D1, '--plan', '--state', path.join(dir, 'plan-only.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^PLAN: /m);
  assert.match(r.stdout, /about \d+ rows_read \(budget 1000000\)/);
  assert.ok(!existsSync(path.join(dir, 'plan-only.json')), '--plan writes no state');

  edit(D1, (db) => update(db, 'party_events', 'ord = 250', { kind: 'changed' }));
  r = cli('--against', D1, '--full');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL: /m);
  assert.match(r.stdout, /party_events \[250\]: row_hash local/);

  r = cli();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /say one of --remote, --local or --against FILE/);
});
