// The PRONI speed pass (proni-app stream, 11 Nov 2026) changed how search, count and node read
// PRONI_DB, not what they answer. These tests hold that: over a generated catalogue full of score
// ties, every page of every query is compared with the one-pass SQL the endpoints ran before, and
// every count with the joined count; node's one batch answers as its four round trips did; and a
// replica that fails is retried on the primary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1, installCaches, context } from '../records/d1-shim.mjs';
import * as search from '../../packages/api/src/handlers/proni/search.js';
import * as count from '../../packages/api/src/handlers/proni/count.js';
import * as node from '../../packages/api/src/handlers/proni/node.js';
import { buildFilters, buildMatch } from '../../packages/api/src/handlers/proni/_query.js';
import { withPrimaryRetry } from '../../packages/api/src/handlers/proni/_read.js';

const WORDS = ['belfast', 'church', 'lease', 'map', 'letter', 'minutes', 'school', 'derry', 'ballymena', 'banbridge'];
const LEVELS = ['Fond', 'Series', 'File', 'Item', 'Item', 'Item'];
const ACCESS = ['Open', 'Closed', '', 'Open - On-Site Only'];

/** A catalogue of 900 records in the live schema (build-proni-d1.py, build-proni-ext-d1.py). */
function catalogue() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE proni (ref TEXT NOT NULL, title TEXT, dates TEXT, slug TEXT, level TEXT, parent TEXT, parent_slug TEXT,
             has_children INTEGER, fond TEXT, description TEXT, access TEXT, digital_record TEXT, start_year INTEGER, end_year INTEGER);
           CREATE UNIQUE INDEX proni_ref ON proni(ref);
           CREATE INDEX proni_parent ON proni(parent, ref);
           CREATE VIRTUAL TABLE proni_fts USING fts5(ref, title, dates, description, content='proni', content_rowid='rowid', prefix='2 3', tokenize='unicode61 remove_diacritics 2');
           CREATE TABLE ext (ref TEXT PRIMARY KEY, ext_start_date TEXT, ext_end_date TEXT, ext_start_year INTEGER, ext_end_year INTEGER,
             ext_circa INTEGER, ext_estimated INTEGER, ext_bound TEXT, ext_undated INTEGER, ext_display TEXT);
           CREATE INDEX ext_years ON ext(ext_start_year, ext_end_year);
           CREATE INDEX ext_years_ref ON ext(ext_start_year, ext_end_year, ref);`);
  const add = db.prepare('INSERT INTO proni VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)');
  const addExt = db.prepare("INSERT INTO ext VALUES (?, '', '', ?, ?, 0, 0, '', ?, ?)");
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let f = 0; f < 30; f += 1) {
    const fond = `${'DTLB'[f % 4]}${100 + f}`;
    add.run(fond, `Papers of ${WORDS[f % WORDS.length]} estate`, '1700-1900', fond, 'Fond', '', '', 1, fond, `The ${WORDS[f % 10]} papers`, '', '');
    for (let i = 1; i <= 29; i += 1) {
      const ref = `${fond}/${i}${i % 9 === 0 ? 'A' : ''}`;
      // Few distinct texts, so many records share a score and the reference breaks the tie.
      const title = `${WORDS[rand(10)]} ${i % 3 ? WORDS[rand(10)] : 'deeds'} ${i % 5 ? '' : 'title deeds'}`.trim();
      const desc = i % 4 ? `${'A long description of the record. '.repeat(rand(12))}${WORDS[rand(10)]}` : '';
      add.run(ref, title, `${1700 + rand(250)}`, ref.replace(/\//g, '~'), LEVELS[rand(6)], fond, fond, 0, fond, desc, ACCESS[rand(4)], i % 7 ? '' : 'View');
      if (i % 6) {
        const start = 1700 + rand(250);
        addExt.run(ref, start, start + rand(40), 0, `${start}`);
      } else addExt.run(ref, null, null, 1, 'Undated');
    }
  }
  db.exec("INSERT INTO proni_fts(proni_fts) VALUES('rebuild')");
  return db;
}

// The endpoints' SQL before the speed pass, as the reference answer.
const COLS = (preview) => `p.ref, p.slug, p.title, p.level, p.dates, p.parent,
  p.parent_slug AS parentSlug, p.has_children AS hasChildren, p.fond,
  p.access, p.digital_record AS digitalRecord, ext.ext_start_year AS startYear, ext.ext_end_year AS endYear,
  substr(p.description,1,${preview + 1}) AS descPreview, length(p.description) AS descLen`;
const ORDER = { relevance: 'bm25(proni_fts)', ref: 'p.ref', title: 'p.title', date: 'ext.ext_start_year', level: 'p.level' };
const and = (where) => (where.length ? ' AND ' + where.join(' AND ') : '');

function referenceSearch(db, url) {
  const g = (k) => (url.searchParams.get(k) || '').trim();
  const q = g('q');
  const from = parseInt(g('from'), 10); const to = parseInt(g('to'), 10);
  const sort = g('sort') || 'relevance';
  const dir = g('dir').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(g('limit'), 10) || 25, 60);
  const offset = Math.max(parseInt(g('offset'), 10) || 0, 0);
  const top = g('top') === '1';
  const match = buildMatch(q, {});
  const { where, binds } = buildFilters({ letter: g('letter'), from, to, top, level: g('level'), access: g('access') });
  if (!match && !where.length) return [];
  const out = [];
  if (!offset && q && !/\s/.test(q) && !q.includes(':') && sort === 'relevance') {
    out.push(...db.prepare(`SELECT ${COLS(160)} FROM proni p LEFT JOIN ext ON ext.ref = p.ref WHERE p.ref = ?1 LIMIT 1`).all(q.toUpperCase()));
  }
  let rows;
  if (match) {
    const order = top ? 'p.ref ASC' : (sort === 'relevance' ? 'bm25(proni_fts), p.ref' : `${ORDER[sort] || 'p.ref'} ${dir}, p.ref`);
    rows = db.prepare(`SELECT ${COLS(160)} FROM proni_fts f JOIN proni p ON p.rowid = f.rowid LEFT JOIN ext ON ext.ref = p.ref
      WHERE proni_fts MATCH ?${and(where)} ORDER BY ${order} LIMIT ? OFFSET ?`).all(match, ...binds, limit, offset);
  } else {
    const order = top ? 'p.ref ASC' : `${ORDER[sort] && sort !== 'relevance' ? ORDER[sort] : 'p.ref'} ${dir}, p.ref`;
    rows = db.prepare(`SELECT ${COLS(160)} FROM proni p LEFT JOIN ext ON ext.ref = p.ref WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...binds, limit, offset);
  }
  const seen = new Set(out.map((r) => r.ref));
  return [...out, ...rows.filter((r) => !seen.has(r.ref))].map((r) => r.ref);
}

function referenceCount(db, url) {
  const g = (k) => (url.searchParams.get(k) || '').trim();
  const from = parseInt(g('from'), 10); const to = parseInt(g('to'), 10);
  const match = buildMatch(g('q'), {});
  const { where, binds } = buildFilters({ letter: g('letter'), from, to, top: g('top') === '1', level: g('level'), access: g('access') });
  if (!match && !where.length) return 0;
  const jx = Number.isFinite(from) || Number.isFinite(to) ? ' LEFT JOIN ext ON ext.ref = p.ref' : '';
  const sql = match
    ? `SELECT COUNT(*) AS n FROM proni_fts f JOIN proni p ON p.rowid = f.rowid${jx} WHERE proni_fts MATCH ?${and(where)}`
    : `SELECT COUNT(*) AS n FROM proni p${jx} WHERE ${where.join(' AND ')}`;
  return db.prepare(sql).get(...(match ? [match, ...binds] : binds)).n;
}

const QUERIES = [
  'q=belfast', 'q=ba', 'q=church', 'q=title%20deeds', 'q=%22title%20deeds%22', 'q=belfast%20-church', 'q=D101', 'q=D101%2F9A',
  'q=lease&from=1750&to=1850', 'from=1800&to=1820', 'from=1900', 'letter=D&top=1', 'q=map&letter=T', 'q=church&sort=date&dir=asc',
  'q=church&sort=date', 'q=school&sort=title&dir=asc', 'q=letter&sort=level', 'q=derry&sort=ref&dir=desc', 'q=lease&level=Item',
  'q=minutes&access=Closed', 'q=belfast&sort=constructor', 'q=title%3Adeeds', 'q=description%3Along', 'level=Item&access=Open',
];

test('every page of every search answers as the one-pass query did', async () => {
  installCaches();
  const db = catalogue();
  const env = { PRONI_DB: d1(db) };
  for (const qs of QUERIES) {
    for (const offset of [0, 25, 50, 75, 100, 125]) {
      for (const limit of [25, 10]) {
        globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
        const url = new URL(`https://civgraph.net/_api/proni/search?${qs}&offset=${offset}&limit=${limit}`);
        const res = await search.onRequestGet(context(url.pathname + url.search, env));
        const body = await res.json();
        if (qs.includes('constructor')) { assert.equal(res.status, 200, qs); continue; } // used to fail in SQL
        assert.equal(res.status, 200, `${qs} ${offset}`);
        assert.deepEqual(body.results.map((r) => r.ref), referenceSearch(db, url), `${qs} offset ${offset} limit ${limit}`);
      }
    }
  }
});

test('every count answers as the joined count did', async () => {
  const db = catalogue();
  const env = { PRONI_DB: d1(db) };
  for (const qs of QUERIES) {
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
    const url = new URL(`https://civgraph.net/_api/proni/count?${qs}`);
    const body = await (await count.onRequestGet(context(url.pathname + url.search, env))).json();
    assert.equal(body.count, referenceCount(db, url), qs);
  }
});

test('the fast count paths are used only where the catalogue being closed makes them exact', () => {
  const filters = (o) => buildFilters(o);
  assert.match(count.countStatement('"belfast"*', filters({}), false).sql, /^SELECT COUNT\(\*\) AS n FROM proni_fts WHERE/);
  assert.match(count.countStatement(null, filters({ from: 1800, to: 1900 }), true).sql, /FROM ext WHERE/);
  assert.match(count.countStatement('"belfast"*', filters({ from: 1800 }), true).sql, /JOIN proni p/);
  assert.match(count.countStatement(null, filters({ letter: 'D', from: 1800 }), true).sql, /FROM proni p/);
  assert.match(count.countStatement('"belfast"*', filters({}), false, false).sql, /JOIN proni p/);
  assert.match(count.countStatement(null, filters({ from: 1800 }), true, false).sql, /FROM proni p/);
});

test('a failed count is not cached', async () => {
  const store = installCaches();
  const broken = { prepare() { throw new Error('D1_ERROR: overloaded'); }, batch() { throw new Error('x'); } };
  const res = await count.onRequestGet(context('/_api/proni/count?q=belfast', { PRONI_DB: broken }));
  assert.equal(res.status, 200);
  assert.deepEqual([(await res.json()).count, res.headers.get('Cache-Control')], [null, 'no-store']);
  assert.equal(store.size, 0);
});

test('node answers in one batch exactly as before, and childLimit keeps the first children', async () => {
  installCaches();
  const db = catalogue();
  const binding = d1(db);
  let batches = 0; let alls = 0;
  const counting = { ...binding, prepare: (sql) => binding.prepare(sql), batch: (s) => { batches += 1; return binding.batch(s); } };
  const store = (await import('../../packages/storage/src/d1.js')).fromD1(counting);
  const wrapped = { ...store, all: (sql, p) => { alls += 1; return store.all(sql, p); } };
  const full = await node.loadNode(wrapped, 'D100');
  assert.deepEqual([batches, alls], [1, 0]);
  assert.equal(full.children.length, 29);
  assert.deepEqual(Object.keys(full), ['item', 'ancestors', 'nav', 'children']);
  // the natural order: …/2 before …/10, letter suffixes after their number
  assert.deepEqual(full.children.slice(0, 3).map((c) => c.ref), ['D100/1', 'D100/2', 'D100/3']);
  const some = await node.loadNode(wrapped, 'D100', { childLimit: 5 });
  assert.deepEqual(some.children, full.children.slice(0, 5));
  assert.equal(some.childCount, 29);
  const leaf = await node.loadNode(wrapped, 'D100/9A');
  assert.deepEqual(leaf.ancestors.map((a) => a.ref), ['D100']);
  assert.deepEqual([leaf.nav.parent, leaf.nav.prev, leaf.nav.next, leaf.nav.position, leaf.nav.total], ['D100', 'D100/8', 'D100/10', 9, 29]);
  assert.equal(await node.loadNode(wrapped, 'NOPE/1'), null);
  const res = await node.onRequestGet(context('/_api/proni/node?ref=D100%2F9A', { PRONI_DB: binding }));
  assert.deepEqual(await res.json(), JSON.parse(JSON.stringify(leaf)));
});

test('a replica that fails is retried once on the primary', async () => {
  let calls = 0;
  assert.equal(await withPrimaryRetry(async () => { calls += 1; throw new Error('cold replica'); }, async () => 'primary'), 'primary');
  assert.equal(calls, 1);
  installCaches();
  const db = catalogue();
  const binding = d1(db);
  const flaky = {
    prepare: (sql) => binding.prepare(sql),
    batch: (s) => binding.batch(s),
    withSession: () => ({ prepare() { throw new Error('D1_ERROR: replica unavailable'); }, batch() { throw new Error('D1_ERROR: replica unavailable'); } }),
  };
  const res = await search.onRequestGet(context('/_api/proni/search?q=belfast', { PRONI_DB: flaky }));
  assert.equal(res.status, 200);
  assert.ok((await res.json()).results.length > 0);
});
