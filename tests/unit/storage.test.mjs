/**
 * The storage adapter (functions/_lib/storage/): one conformance suite run over every RecordStore,
 * so D1 and a local SQLite file answer alike. D1 is exercised through a D1-shaped binding over
 * node:sqlite whose batch() is one transaction, as D1's is.
 *
 * Then the bridge: a real handler run over toD1(openSqlite(records build)) answers byte for byte
 * what it answers over the records tests' D1 shim. Skipped without a records build
 * (CIVGRAPH_RECORDS_DB, default tmp/records/civgraph-records.sqlite).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { assertRecordStore, bindValue, datasetState, toD1 } from '../../functions/_lib/storage/store.js';
import { fromD1 } from '../../functions/_lib/storage/d1.js';
import { openSqlite } from '../../scripts/lib/storage/sqlite.mjs';
import { loadConfig } from '../../scripts/lib/config.mjs';

/** A D1 binding over node:sqlite: the calling convention of D1, batch() as one transaction. */
function fakeD1(db = new DatabaseSync(':memory:')) {
  const plain = (r) => (r ? { ...r } : null);
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    first: async () => plain(db.prepare(sql).get(...args)),
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain), success: true, meta: {} }),
    run: async () => {
      const info = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => ({ results: db.prepare(s.sql).all(...s.args).map(plain), success: true, meta: {} }));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(text) { db.exec(text); return { count: 1 }; },
  };
}

const STORES = {
  sqlite: () => openSqlite(':memory:'),
  d1: () => fromD1(fakeD1()),
};

const SCHEMA = `
CREATE TABLE parties (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT, active INTEGER, note TEXT);
CREATE TABLE dataset (key TEXT PRIMARY KEY, value TEXT);
`;

for (const [kind, make] of Object.entries(STORES)) {
  test(`${kind}: the RecordStore contract`, async (t) => {
    const store = assertRecordStore(make());
    assert.equal(store.kind, kind);
    await store.exec(SCHEMA);

    await t.test('run() reports changes and the new row id', async () => {
      const r = await store.run('INSERT INTO parties (slug, name, active) VALUES (?, ?, ?)', ['sf', 'Sinn Féin', true]);
      assert.deepEqual(r, { changes: 1, lastRowId: 1 });
      await store.run('INSERT INTO parties (slug, name, active, note) VALUES (?, ?, ?, ?)', ['uup', 'Ulster Unionist Party', false, undefined]);
    });

    await t.test('first() is a plain object or null; booleans bound as 1/0, undefined as NULL', async () => {
      const row = await store.first('SELECT slug, name, active, note FROM parties WHERE slug = ?', ['uup']);
      assert.deepEqual(row, { slug: 'uup', name: 'Ulster Unionist Party', active: 0, note: null });
      assert.equal(Object.getPrototypeOf(row), Object.prototype);
      assert.equal(await store.first('SELECT * FROM parties WHERE slug = ?', ['none']), null);
      assert.equal((await store.first('SELECT active FROM parties WHERE slug = ?', ['sf'])).active, 1);
    });

    await t.test('all() keeps the query order; value() is the first column or null', async () => {
      assert.deepEqual(await store.all('SELECT slug FROM parties ORDER BY slug DESC'), [{ slug: 'uup' }, { slug: 'sf' }]);
      assert.deepEqual(await store.all('SELECT slug FROM parties WHERE 0'), []);
      assert.equal(await store.value('SELECT COUNT(*) AS n FROM parties'), 2);
      assert.equal(await store.value('SELECT slug FROM parties WHERE 0'), null);
      assert.deepEqual(await store.all('SELECT slug FROM parties WHERE id = ?1 OR slug = ?2 ORDER BY id', [1, 'uup']), [{ slug: 'sf' }, { slug: 'uup' }]);
    });

    await t.test('a value that is not SQL is refused in the same words on every store', async () => {
      await assert.rejects(() => store.first('SELECT ?', [{ a: 1 }]), /cannot bind a Object/);
      await assert.rejects(() => store.run('SELECT ?', [Number.NaN]), /cannot bind NaN/);
    });

    await t.test('batch() answers per statement and is all or nothing', async () => {
      const out = await store.batch([
        { sql: 'INSERT INTO parties (slug, name) VALUES (?, ?)', params: ['alliance', 'Alliance'] },
        { sql: 'SELECT COUNT(*) AS n FROM parties' },
      ]);
      assert.deepEqual(out, [[], [{ n: 3 }]]);
      await assert.rejects(() => store.batch([
        { sql: 'INSERT INTO parties (slug, name) VALUES (?, ?)', params: ['sdlp', 'SDLP'] },
        { sql: 'INSERT INTO parties (slug, name) VALUES (?, ?)', params: ['sf', 'duplicate slug'] },
      ]));
      assert.equal(await store.value('SELECT COUNT(*) FROM parties WHERE slug = ?', ['sdlp']), 0, 'the failed batch must leave nothing behind');
      assert.deepEqual(await store.batch([]), []);
    });

    await t.test('datasetState() reads the version and loading flag', async () => {
      assert.deepEqual(await datasetState(store), { version: '', loading: '' });
      await store.run("INSERT INTO dataset (key, value) VALUES ('version', 'abc'), ('loading', '')");
      assert.deepEqual(await datasetState(store), { version: 'abc', loading: '' });
    });

    await t.test('toD1() gives the binding shape the handlers call today', async () => {
      const db = toD1(store);
      assert.deepEqual(await db.prepare('SELECT slug FROM parties WHERE id = ?').bind(1).first(), { slug: 'sf' });
      assert.equal(await db.prepare('SELECT slug FROM parties WHERE id = ?').bind(2).first('slug'), 'uup');
      assert.equal(await db.prepare('SELECT slug FROM parties WHERE id = ?').bind(99).first('slug'), null);
      assert.deepEqual((await db.prepare('SELECT slug FROM parties ORDER BY id').all()).results.map((r) => r.slug), ['sf', 'uup', 'alliance']);
      assert.deepEqual(await db.prepare('SELECT id, slug FROM parties WHERE id = 1').raw(), [[1, 'sf']]);
      const run = await db.prepare('UPDATE parties SET note = ? WHERE id = ?').bind('x', 1).run();
      assert.equal(run.meta.changes, 1);
      const [a, b] = await db.batch([db.prepare('SELECT 1 AS one'), db.prepare('SELECT ? AS two').bind(2)]);
      assert.deepEqual([a.results, b.results], [[{ one: 1 }], [{ two: 2 }]]);
      assert.equal(db.withSession('first-unconstrained'), db);
    });

    await store.close();
  });
}

test('bindValue() normalises exactly as documented', () => {
  assert.equal(bindValue(true), 1);
  assert.equal(bindValue(false), 0);
  assert.equal(bindValue(undefined), null);
  assert.equal(bindValue(10n), 10n);
  assert.ok(bindValue(new Uint8Array([1])) instanceof Uint8Array);
  assert.throws(() => bindValue(new Date(0)), /cannot bind a Date/);
  assert.throws(() => bindValue(Infinity), /cannot bind Infinity/);
});

test('assertRecordStore() names what is missing; fromD1() refuses a non-binding', () => {
  assert.throws(() => assertRecordStore({ kind: 'x', first() {} }), /missing all, value, run, batch, exec, close/);
  assert.throws(() => fromD1({}), /not a D1 binding/);
});

const RECORDS_DB = loadConfig().recordsDb;
const haveRecords = existsSync(RECORDS_DB);

test('a real handler answers alike over the records tests\' D1 shim and over toD1(openSqlite())', { skip: !haveRecords && `no records build at ${RECORDS_DB}` }, async () => {
  const { context, d1, installCaches } = await import('../records/d1-shim.mjs');
  const { resetDatasetMemo } = await import('../../functions/_api/_records.js');
  const stats = await import('../../functions/_api/stats/index.js');
  const parties = await import('../../functions/_api/parties/index.js');
  const store = openSqlite(RECORDS_DB, { readOnly: true });
  const viaShim = { ELECTIONS_DB: d1(RECORDS_DB) };
  const viaStore = { ELECTIONS_DB: toD1(store) };
  const answer = async (mod, url, env) => {
    installCaches();
    resetDatasetMemo();
    const res = await mod.onRequestGet(context(url, env));
    return { status: res.status, etag: res.headers.get('ETag'), body: await res.text() };
  };
  try {
    const slug = await store.value('SELECT slug FROM party_cards ORDER BY ord LIMIT 1');
    const urls = [[stats, '/_api/stats'], [parties, '/_api/parties'], [parties, `/_api/parties?slug=${slug}`], [parties, '/_api/parties?view=names']];
    for (const [mod, url] of urls) {
      const a = await answer(mod, url, viaShim);
      const b = await answer(mod, url, viaStore);
      assert.equal(a.status, 200, `${url} -> ${a.status}`);
      assert.deepEqual(b, a, url);
    }
  } finally {
    await store.close();
    viaShim.ELECTIONS_DB._db.close();
  }
});
