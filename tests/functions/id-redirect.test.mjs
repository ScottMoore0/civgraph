/**
 * The graph's linked-data identifiers resolve (owner decision PG14, 13 Nov 2026): every kind of
 * id the graph build mints, at https://civgraph.net/id/<kind>:<slug>, answers with a 303 to a
 * page that shows it (packages/api/src/pages/id.js, packages/core/src/graph-iri.js,
 * functions/id/[[path]].js).
 *
 * The kinds are read from the graph build itself (every makeEntityId('<kind>', ...) in
 * scripts/build/graph/build-semantic-graph.mjs), so a new kind fails here until it resolves.
 * Over a small in-memory records database built from the migrations; and, when a records build
 * exists (CIVGRAPH_RECORDS_DB, tmp/records/ by default), over one real entity of each kind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet } from '../../functions/id/[[path]].js';
import { entityIdFromIdPath, entityPagePath, idBase, ID_PATH, NON_RECORD_ID_KINDS } from '../../packages/core/src/graph-iri.js';
import { SITE, loadConfig } from '../../packages/config/src/node.mjs';
import { PAGE_TYPE_IDS } from '../../packages/ui/src/page-types.mjs';
import { migrationFiles } from '../../packages/loader/src/db.mjs';
import { d1 } from '../records/d1-shim.mjs';

const BUILD_FILE = 'scripts/build/graph/build-semantic-graph.mjs';
const BUILD = readFileSync(BUILD_FILE, 'utf8');
/** Every kind of entity id the graph build mints. */
const KINDS = [...new Set([...BUILD.matchAll(/makeEntityId\('([a-z-]+)'/g)].map((m) => /** @type {string} */ (m[1])))].sort();

/** @param {string} path @param {object} env */
async function get(path, env) {
  return onRequestGet({ request: new Request(`${SITE.origin}${path}`), env, params: {}, waitUntil() {}, passThroughOnException() {}, next: async () => new Response('static'), data: {} });
}

/** A records database with the schema and no rows, as a D1 binding. */
function emptyRecords() {
  const binding = d1(':memory:', { readOnly: false });
  for (const file of migrationFiles()) binding._db.exec(readFileSync(file, 'utf8'));
  return binding;
}

/**
 * One fixture entity per kind. The path-style kinds carry the browseUrl the graph build gives
 * them; one person also has a retired id (an alias), and one feature group a browseUrl the site
 * does not route (/browse/features?map=), which must go to Browse's entity page instead.
 */
function fixture() {
  const binding = emptyRecords();
  const db = binding._db;
  const add = db.prepare('INSERT INTO graph_entities (entity_id, shard, ord, slug, label, entity, summary, row_hash, row_hash_n) VALUES (?, 0, ?, ?, ?, ?, ?, ?, 0)');
  const browseUrls = {
    person: '/browse/persons/a-a-gillespie-148709',
    party: '/browse/parties/sinn-fein',
    election: '/browse/elections/dail-eireann__2024-11-29',
    contest: '/browse/elections/dail-eireann-2024-11-29-carlow-kilkenny',
    'map-layer': '/browse/maps/pc-2023',
    source: '/browse/sources/election-source-dail-eireann-2024-11-29',
    'feature-group': '/browse/features?map=admin-areas-1966-07-04',
  };
  KINDS.forEach((kind, ord) => {
    const id = `cg:${kind}:example-${kind}`;
    const summary = { entityId: id, label: `Example ${kind}`, ...(browseUrls[kind] ? { browseUrl: browseUrls[kind] } : {}) };
    add.run(id, ord, `example-${kind}`, `Example ${kind}`, JSON.stringify({ id }), JSON.stringify(summary), `h${ord}`);
  });
  db.prepare("INSERT INTO graph_browse_keys (browse_key, entity_id, row_hash, row_hash_n) VALUES ('alias:cg:person:retired-person-1', 'cg:person:example-person', 'h', 0)").run();
  return { env: { ELECTIONS_DB: binding }, browseUrls };
}

test('the graph build mints the kinds this test resolves, and names them under civgraph.net/id/', () => {
  assert.ok(KINDS.length >= 18, `only ${KINDS.length} kinds found in ${BUILD_FILE}`);
  for (const kind of ['person', 'party', 'election', 'contest', 'candidature', 'body', 'office', 'source']) assert.ok(KINDS.includes(kind), kind);
  assert.equal(idBase(SITE.origin), 'https://civgraph.net/id/');
  assert.match(BUILD, /cg: idBase\(SITE\.origin\)/, 'the JSON-LD context expands cg: with idBase(SITE.origin)');
  assert.doesNotMatch(BUILD, /civgraph\.org\/id\//, 'no identifier left under civgraph.org/id/');
  for (const kind of NON_RECORD_ID_KINDS) assert.ok(!KINDS.includes(kind), `${kind} is minted as an entity`);
});

test('an /id/ path names an entity id', () => {
  assert.deepEqual(entityIdFromIdPath('/id/person:a-a-gillespie-148709'), { id: 'cg:person:a-a-gillespie-148709', kind: 'person' });
  assert.deepEqual(entityIdFromIdPath('/id/person%3Aa-a-gillespie-148709'), { id: 'cg:person:a-a-gillespie-148709', kind: 'person' });
  assert.deepEqual(entityIdFromIdPath('/id/date-month:1801-01'), { id: 'cg:date-month:1801-01', kind: 'date-month' });
  for (const bad of ['/id/', '/id/person', '/id/person:', '/id/Person:x', '/id/person:x/y', '/id/person:%E0%A4%A', '/id/:x', '/browse/person:x', `${ID_PATH}person:${'x'.repeat(201)}`]) {
    assert.equal(entityIdFromIdPath(bad), null, bad);
  }
});

test('the page of an entity: its record page where the site routes one, else Browse', () => {
  assert.equal(entityPagePath('cg:person:x', { browseUrl: '/browse/persons/x' }, PAGE_TYPE_IDS), '/browse/persons/x');
  assert.equal(entityPagePath('cg:feature-group:g', { browseUrl: '/browse/features?map=g' }, PAGE_TYPE_IDS), '/browse/#/entities/cg%3Afeature-group%3Ag');
  assert.equal(entityPagePath('cg:body:b', null, PAGE_TYPE_IDS), '/browse/#/entities/cg%3Abody%3Ab');
  for (const odd of ['//evil.example/x', 'https://evil.example/browse/persons/x', '/browse/persons/x/../../y', '/browse/nope/x']) {
    assert.match(entityPagePath('cg:person:x', { browseUrl: odd }, PAGE_TYPE_IDS), /^\/browse\/#\/entities\//, odd);
  }
});

test('every kind of id resolves with a 303 to its page', async () => {
  const { env, browseUrls } = fixture();
  try {
    for (const kind of KINDS) {
      const res = await get(`/id/${kind}:example-${kind}`, env);
      assert.equal(res.status, 303, `${kind}: status ${res.status}`);
      const location = new URL(/** @type {string} */ (res.headers.get('Location')));
      assert.equal(location.origin, SITE.origin, kind);
      const routed = browseUrls[kind] && !browseUrls[kind].includes('?');
      const expected = routed ? browseUrls[kind] : `/browse/#/entities/${encodeURIComponent(`cg:${kind}:example-${kind}`)}`;
      assert.equal(`${location.pathname}${location.search}${location.hash}`, expected, kind);
    }
  } finally {
    env.ELECTIONS_DB._db.close();
  }
});

test('a retired id goes to the entity it became; unknown ids, terms and statements are 404', async () => {
  const { env } = fixture();
  try {
    const retired = await get('/id/person:retired-person-1', env);
    assert.equal(retired.status, 303);
    assert.equal(new URL(/** @type {string} */ (retired.headers.get('Location'))).pathname, '/browse/persons/a-a-gillespie-148709');
    for (const path of ['/id/person:nobody-1', '/id/property:name', '/id/statement:00003e83c263ea2c3aad', '/id/not-an-id', '/id/']) {
      const res = await get(path, env);
      assert.equal(res.status, 404, path);
      assert.equal(res.headers.get('Location'), null, path);
    }
  } finally {
    env.ELECTIONS_DB._db.close();
  }
});

test('without the database, a well-formed id still reaches Browse, which looks it up itself', async () => {
  const failing = { first: async () => { throw new Error('D1 unavailable'); }, all: async () => { throw new Error('D1 unavailable'); }, prepare() { return { bind: () => failing }; } };
  const errors = console.error;
  console.error = () => {};
  try {
    for (const env of [{}, { ELECTIONS_DB: failing }]) {
      const res = await get('/id/person:a-a-gillespie-148709', env);
      assert.equal(res.status, 303);
      assert.equal(new URL(/** @type {string} */ (res.headers.get('Location'))).hash, '#/entities/cg%3Aperson%3Aa-a-gillespie-148709');
    }
  } finally {
    console.error = errors;
  }
  assert.equal((await get('/id/property:name', {})).status, 404);
});

const RECORDS_DB = loadConfig().recordsDb;
test('over the records build, one real entity of every kind resolves', { skip: !existsSync(RECORDS_DB) && `no records build at ${RECORDS_DB}` }, async () => {
  const sqlite = new DatabaseSync(RECORDS_DB, { readOnly: true });
  /** @type {Map<string, string>} */
  const samples = new Map();
  try {
    const pick = sqlite.prepare('SELECT entity_id FROM graph_entities WHERE entity_id >= ? AND entity_id < ? ORDER BY entity_id LIMIT 1');
    for (const kind of KINDS) {
      const row = /** @type {{ entity_id: string } | undefined} */ (pick.get(`cg:${kind}:`, `cg:${kind};`));
      if (row) samples.set(kind, row.entity_id);
    }
  } finally {
    sqlite.close();
  }
  assert.ok(samples.size > 0, `the build at ${RECORDS_DB} holds no graph entities`);
  const env = { ELECTIONS_DB: d1(RECORDS_DB) };
  try {
    for (const [kind, id] of samples) {
      const res = await get(`${ID_PATH}${id.slice('cg:'.length)}`, env);
      assert.equal(res.status, 303, `${id}: status ${res.status}`);
      const location = new URL(/** @type {string} */ (res.headers.get('Location')));
      assert.ok(/^\/browse\/(?:[a-z-]+\/[^/]+|)$/.test(location.pathname), `${kind}: ${location}`);
    }
  } finally {
    env.ELECTIONS_DB._db.close();
  }
});
