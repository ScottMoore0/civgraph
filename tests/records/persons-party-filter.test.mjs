// The People list's ?party= filter (/_api/persons, packages/api/src/handlers/persons/index.js) reads
// person_card_parties (migration 0006) since 11 Nov 2026, instead of a json_each over every person
// card. Against the local records build:
// - it returns the same people, in the same order, with the same totals as the json_each filter it
//   replaced, alone and with the search, the column filters and the sorts;
// - every statement it runs reads person_cards and person_card_parties by index (EXPLAIN QUERY PLAN
//   shows no SCAN of either);
// - a database without person_card_parties (a deployment ahead of its records load) still answers,
//   through the old filter, with the same people.
// Skipped without a build that has the table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { RECORDS_DB } from '../../packages/loader/src/paths.mjs';
import { context, d1, installCaches } from './d1-shim.mjs';
import { resetDatasetMemo } from '../../packages/api/src/handlers/_records.js';
import * as persons from '../../packages/api/src/handlers/persons/index.js';
import { PERSONS } from '../../packages/api/src/queries/cards.js';

const DB = RECORDS_DB;
const built = existsSync(DB) && (() => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'person_card_parties'").get()); } finally { db.close(); }
})();
const skip = !built && 'no records build with person_card_parties (npm run records:build)';

/**
 * A D1 binding over the build. `mode`: 'indexed' runs the handler as it is; 'cards' rewrites the
 * person_card_parties filter into the json_each filter it replaced (the old behaviour, every other
 * clause unchanged); 'no-table' answers "no such table" for any statement naming person_card_parties.
 * Every statement run is recorded with its binds.
 */
function binding(mode, real, log) {
  const indexedClause = (/** @type {string} */ sql) => sql.match(/slug IN \(SELECT slug FROM person_card_parties WHERE party IN \(([^)]*)\)\)/);
  return {
    ...real,
    prepare(/** @type {string} */ sql) {
      let text = sql;
      if (mode === 'cards') {
        const m = indexedClause(text);
        if (m) text = text.replace(m[0], PERSONS.partyFilterFromCards(m[1].split(', ')));
      }
      if (mode === 'no-table' && /person_card_parties/.test(text)) throw new Error('D1_ERROR: no such table: person_card_parties: SQLITE_ERROR');
      const stmt = real.prepare(text);
      const wrap = (/** @type {any} */ bound, /** @type {unknown[]} */ binds) => ({
        ...bound,
        bind: (/** @type {unknown[]} */ ...args) => wrap(bound.bind(...args), args),
        all: (...a) => { log.push({ sql: text, binds }); return bound.all(...a); },
        first: (...a) => { log.push({ sql: text, binds }); return bound.first(...a); },
        raw: (...a) => { log.push({ sql: text, binds }); return bound.raw(...a); },
        run: (...a) => { log.push({ sql: text, binds }); return bound.run(...a); },
      });
      return wrap(stmt, []);
    },
  };
}

let real;
async function list(mode, query) {
  real ??= d1(DB);
  installCaches();
  resetDatasetMemo();
  const log = [];
  const env = { ELECTIONS_DB: binding(mode, real, log) };
  const slugs = [];
  let total = null;
  let applied = null;
  // Pages of the handler's largest size (it clamps ?limit=), until a short one.
  for (let offset = 0; ;) {
    const res = await persons.onRequestGet(context(`/_api/persons?${query}&limit=1000&offset=${offset}`, env));
    assert.equal(res.status, 200, `${mode} ${query} offset ${offset}`);
    const body = await res.json();
    total = body.total;
    applied = body.applied;
    slugs.push(...body.persons.map((p) => p.slug));
    if (body.persons.length < body.limit) break;
    offset += body.limit;
  }
  return { slugs, total, applied, log };
}

const CASES = [
  'party=UUP',
  'party=Fianna%20F%C3%A1il',
  'party=Sinn%20F%C3%A9in',
  'party=Alliance&party=Alliance%20Party',
  'party=UUP&party=Ulster%20Unionist&q=john',
  'party=UUP&elected=yes',
  'party=Fine%20Gael&sort=firstYear',
  'party=DUP&sort=contests',
  'party=Independent&decade=1920',
  'party=SDLP&body=house-of-commons-of-the-united-kingdom',
  'party=No%20such%20party%20at%20all',
];

test('?party= through person_card_parties: the same people, order and totals as the json_each filter', { skip }, async () => {
  for (const query of CASES) {
    const now = await list('indexed', query);
    const before = await list('cards', query);
    assert.deepEqual(now.slugs, before.slugs, query);
    assert.equal(now.total, before.total, query);
    assert.equal(now.total, now.slugs.length, query);
    assert.deepEqual(now.applied, before.applied, query);
    assert.ok(now.applied.filters.includes('party'), query);
  }
  // The larger parties are really there (a filter matching nothing would also be "the same").
  assert.ok((await list('indexed', 'party=UUP')).total > 1000);
});

test('?party= reads person_cards and person_card_parties by index only', { skip }, async () => {
  const raw = new DatabaseSync(DB, { readOnly: true });
  try {
    for (const query of CASES) {
      const { log } = await list('indexed', query);
      const statements = log.filter((s) => /person_card_parties/.test(s.sql));
      assert.ok(statements.length >= 2, `${query}: the page and the count`);
      for (const { sql, binds } of statements) {
        const plan = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...binds.map((b) => (typeof b === 'boolean' ? Number(b) : b)));
        const scans = plan.map((r) => r.detail).filter((d) => /^SCAN (person_cards|person_card_parties)\b/.test(d));
        assert.deepEqual(scans, [], `${query}: ${plan.map((r) => r.detail).join(' | ')}`);
        assert.ok(plan.some((r) => /SEARCH person_card_parties USING (COVERING )?INDEX/.test(r.detail)), `${query}: ${plan.map((r) => r.detail).join(' | ')}`);
      }
    }
  } finally {
    raw.close();
  }
});

test('?party= without person_card_parties falls back to the cards and finds the same people', { skip }, async () => {
  for (const query of ['party=UUP', 'party=Alliance&party=Alliance%20Party', 'party=UUP&q=john']) {
    const now = await list('indexed', query);
    const fallback = await list('no-table', query);
    assert.deepEqual(fallback.slugs, now.slugs, query);
    assert.equal(fallback.total, now.total, query);
    assert.ok(fallback.log.some((s) => /json_each\(person_cards\.card, '\$\.parties'\)/.test(s.sql)), query);
  }
});
