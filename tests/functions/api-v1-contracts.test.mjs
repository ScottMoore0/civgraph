/**
 * The response contracts of /api/v1 (functions/_lib/api/contracts/v1.js; REFACTOR-PLAN.md API-2,
 * API-3): the frozen surface of v1, held three ways.
 *
 * - Shape: every route has a contract; every variant's `when` names only parameters the route
 *   reads; every schema uses only keywords the checker knows.
 * - Compatibility: the contracts against tests/functions/api-v1-contracts.baseline.json. A
 *   dropped required field, a widened type or a removed variant fails; additions pass. To take
 *   additions into the baseline: API_CONTRACT_BASELINE=write node --test <this file>.
 * - Real answers: every route's error answers with no bindings; search and spatial over a KV
 *   stub, data-index over an R2 stub, the PRONI routes over an in-memory FTS5 fixture; and,
 *   when a records build exists (CIVGRAPH_RECORDS_DB), every records variant over it.
 *
 * And /api/v1/openapi.json is built from the same table and contracts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as apiRoute from '../../packages/api/src/v1/route.js';
import { PREFIX, ROUTES, indexDocument, openApi } from '../../packages/api/src/v1/v1.js';
import { CONTRACTS, variantFor } from '../../packages/api/src/v1/contracts/v1.js';
import { incompatibilities, validate } from '../../packages/api/src/v1/json-schema.js';
import { REPO_ROOT, loadConfig } from '../../packages/config/src/node.mjs';

const ORIGIN = 'https://civgraph.net';
const BASELINE = path.join(REPO_ROOT, 'tests', 'functions', 'api-v1-contracts.baseline.json');

/** Call /api/v1 as the Pages router would. */
async function call(url, env = {}, method = 'GET') {
  const full = new URL(url, ORIGIN);
  const segs = full.pathname.slice('/api/'.length).split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const res = await apiRoute.onRequest({
    request: new Request(full.toString(), { method }), env, params: { path: segs },
    waitUntil() {}, passThroughOnException() {}, next: async () => new Response('static'), data: {},
  });
  return res;
}

/** The route key and subpath of a /api/v1 URL. */
function routeOf(url) {
  const segs = new URL(url, ORIGIN).pathname.slice(`${PREFIX}/`.length).split('/').filter(Boolean);
  for (let n = segs.length; n > 0; n -= 1) {
    const key = segs.slice(0, n).join('/');
    if (ROUTES[key]) return { key, rest: segs.slice(n).map((s) => decodeURIComponent(s)) };
  }
  throw new Error(`no route for ${url}`);
}

/**
 * Check one answer against its contract: a 2xx against the variant `expect` names (and that
 * variantFor picks that variant), anything else against the route's errors.
 */
async function conforms(url, env, expect) {
  const { key, rest } = routeOf(url);
  const res = await call(url, env);
  const variant = variantFor(key, new URL(url, ORIGIN), rest);
  const text = await res.text();
  if (res.status === 200) {
    if (expect) assert.equal(variant?.name, expect, `${url}: picked ${variant?.name}`);
    assert.ok(variant, `${url}: no variant`);
    if (variant.contentType) {
      assert.match(res.headers.get('Content-Type') || '', new RegExp(`^${variant.contentType}`), url);
      return { status: 200, variant: variant.name };
    }
    const errors = validate(variant.schema, JSON.parse(text));
    assert.deepEqual(errors, [], `${url} (${variant.name})`);
    return { status: 200, variant: variant.name };
  }
  if (res.status >= 400) {
    const errorsSchema = CONTRACTS[key].errors;
    if (errorsSchema) assert.deepEqual(validate(errorsSchema, JSON.parse(text)), [], `${url} -> ${res.status}`);
  }
  return { status: res.status, variant: null };
}

// ------------------------------------------------------------------ the table

const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'minimum', 'pattern', 'minItems', 'title', 'description', 'examples']);
function keywordsKnown(schema, at = '$') {
  if (!schema || typeof schema !== 'object') return;
  for (const [k, v] of Object.entries(schema)) {
    assert.ok(KEYWORDS.has(k), `${at}: ${k} is not a keyword the checker knows`);
    if (k === 'properties') for (const [p, s] of Object.entries(v)) keywordsKnown(s, `${at}.${p}`);
    else if (k === 'items' || k === 'additionalProperties') keywordsKnown(v, `${at}[]`);
    else if (k === 'anyOf') v.forEach((s, i) => keywordsKnown(s, `${at}|${i}`));
  }
  for (const r of schema.required || []) assert.ok(schema.properties && r in schema.properties, `${at}: required ${r} has no schema`);
}

test('every v1 route has a contract, and every variant is selected by parameters the route reads', () => {
  assert.deepEqual(Object.keys(CONTRACTS).sort(), Object.keys(ROUTES).sort());
  for (const [key, contract] of Object.entries(CONTRACTS)) {
    const route = ROUTES[key];
    const names = contract.variants.map((v) => v.name);
    assert.equal(new Set(names).size, names.length, `${key}: duplicate variant names`);
    assert.ok(contract.variants.length > 0, key);
    for (const variant of contract.variants) {
      assert.ok(variant.summary, `${key}.${variant.name}: no summary`);
      assert.ok(Boolean(variant.schema) !== Boolean(variant.contentType), `${key}.${variant.name}: a schema or a content type, not both`);
      for (const param of Object.keys(variant.when)) {
        if (param === 'path') assert.ok(route.catchAll, `${key}.${variant.name}: path on a route without subpaths`);
        else assert.ok(route.parameters.includes(param), `${key}.${variant.name}: ${param} is not among the route's parameters`);
      }
      keywordsKnown(variant.schema, `${key}.${variant.name}`);
    }
    if (contract.errors) keywordsKnown(contract.errors, `${key}.errors`);
  }
});

test('variantFor() picks the first matching variant in table order', () => {
  const pick = (url, rest) => variantFor(routeOf(url).key, new URL(url, ORIGIN), rest ?? routeOf(url).rest)?.name;
  assert.equal(pick('/api/v1/elections'), 'index');
  assert.equal(pick('/api/v1/elections?view=list&body=x'), 'list');
  assert.equal(pick('/api/v1/elections?key=k'), 'election');
  assert.equal(pick('/api/v1/elections?key=k&format=bundle'), 'bundle');
  assert.equal(pick('/api/v1/elections?key=k&constituency=2&format=bundle'), 'contest', 'the handler answers a contest before a bundle');
  assert.equal(pick('/api/v1/elections?key=k&contest=s&constituency=2'), 'contest-by-slug');
  assert.equal(pick('/api/v1/persons?slug=a&view=candidacies'), 'candidacies');
  assert.equal(pick('/api/v1/persons?slug=%20'), 'list', 'a blank parameter is an absent one');
  assert.equal(pick('/api/v1/layers'), 'document');
  assert.equal(pick('/api/v1/layers?view=index'), 'index');
  assert.equal(pick('/api/v1/layers/x-vector'), 'layer');
  assert.equal(pick('/api/v1/layers/x-vector/duplicates'), 'duplicates');
  assert.equal(pick('/api/v1/layers/x-vector/other'), undefined);
  assert.equal(pick('/api/v1/proni/node?ref=D/1'), 'node');
  assert.equal(variantFor('nothing', ORIGIN), null);
});

// ------------------------------------------------------------------ the checker

test('validate() reports what is wrong and where; unnamed fields are allowed', () => {
  const schema = { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'array', items: { type: 'object', properties: { c: { type: ['string', 'null'] } }, required: ['c'] } }, k: { const: true }, e: { enum: ['x', 'y'] } }, required: ['a', 'b'] };
  assert.deepEqual(validate(schema, { a: 1, b: [{ c: null }, { c: 's', extra: 1 }], more: 'ok' }), []);
  assert.deepEqual(validate(schema, { a: 1.5, b: [{}, { c: 2 }], k: false, e: 'z' }), [
    '$.a: expected integer, got number',
    '$.b[0]: missing c',
    '$.b[1].c: expected string or null, got number',
    '$.k: expected true',
    '$.e: "z" is not one of "x", "y"',
  ]);
  assert.deepEqual(validate(schema, []), ['$: expected object, got array']);
  assert.deepEqual(validate({ anyOf: [{ type: 'string' }, { type: 'null' }] }, 3), ['$: matches none of 2 alternatives']);
  assert.deepEqual(validate({ type: 'object', additionalProperties: { type: 'string' } }, { a: 'x', b: 1 }), ['$.b: expected string, got number']);
  assert.deepEqual(validate({ type: 'number' }, Number.NaN), ['$: expected number, got number']);
  assert.throws(() => validate({ oneOf: [] }, 1), /unsupported keyword oneOf/);
});

test('incompatibilities() passes additions and fails removals, widenings and new enum values', () => {
  const old = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'object', properties: { c: { type: 'number' } }, required: ['c'] } }, s: { enum: ['x'] } }, required: ['a', 'b', 's'] };
  const added = structuredClone(old);
  added.properties.d = { type: 'string' };
  added.required.push('d');
  added.properties.b.items.properties.e = { type: 'boolean' };
  assert.deepEqual(incompatibilities(old, added), []);
  const dropped = structuredClone(old);
  dropped.required = ['b', 's'];
  assert.deepEqual(incompatibilities(old, dropped), ['$.a: no longer required']);
  const widened = structuredClone(old);
  widened.properties.b.items.properties.c = { type: ['number', 'null'] };
  widened.properties.s = { enum: ['x', 'y'] };
  assert.deepEqual(incompatibilities(old, widened), ['$.b[].c: may now be null', '$.s: new enum value "y"']);
  assert.deepEqual(incompatibilities({ type: 'number' }, { type: 'integer' }), [], 'narrowing is compatible');
});

// ------------------------------------------------------------------ the baseline

/** The contracts as the baseline stores them. */
function snapshot() {
  return Object.fromEntries(Object.entries(CONTRACTS).map(([key, c]) => [key, {
    errors: c.errors,
    variants: Object.fromEntries(c.variants.map((v) => [v.name, v.schema ? { when: v.when, schema: v.schema } : { when: v.when, contentType: v.contentType }])),
  }]));
}

test('the v1 contracts are compatible with the committed baseline', () => {
  const now = JSON.parse(JSON.stringify(snapshot()));
  if (process.env.API_CONTRACT_BASELINE === 'write') {
    writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
  }
  assert.ok(existsSync(BASELINE), `${BASELINE} is missing: run with API_CONTRACT_BASELINE=write`);
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const problems = [];
  for (const [key, was] of Object.entries(base)) {
    const is = now[key];
    if (!is) { problems.push(`${key}: the route is gone`); continue; }
    if (was.errors) problems.push(...incompatibilities(was.errors, is.errors).map((p) => `${key} errors ${p}`));
    for (const [name, v] of Object.entries(was.variants)) {
      const w = is.variants[name];
      if (!w) { problems.push(`${key}.${name}: the variant is gone`); continue; }
      if (JSON.stringify(w.when) !== JSON.stringify(v.when)) problems.push(`${key}.${name}: selected differently (${JSON.stringify(v.when)} -> ${JSON.stringify(w.when)})`);
      if (v.contentType !== w.contentType) problems.push(`${key}.${name}: content type changed`);
      if (v.schema) problems.push(...incompatibilities(v.schema, w.schema).map((p) => `${key}.${name} ${p}`));
    }
  }
  assert.deepEqual(problems, [], 'an incompatible change to v1 belongs in a v2 (functions/README.md)');
});

// ------------------------------------------------------------------ answers without the records build

/** fetch() answering 404 for everything: the static-file fallbacks of search and spatial. */
async function withNoFetch(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('missing', { status: 404 });
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('with no bindings, every route\'s answer fits its contract', async () => {
  const { installCaches } = await import('../records/d1-shim.mjs');
  installCaches();
  await withNoFetch(async () => {
    for (const key of Object.keys(ROUTES)) {
      const { status } = await conforms(`${PREFIX}/${key}`, {});
      assert.ok(status === 200 || status >= 400, `${key}: ${status}`);
    }
    // the errors of parameters, not of bindings
    assert.equal((await conforms(`${PREFIX}/spatial`, {})).status, 400);
  });
});

test('search and spatial over a KV index fit their contracts', async () => {
  const names = [{ name: 'Belfast', mapId: 'lgd-2012', bbox: [-6, 54.5, -5.8, 54.7] }, { name: 'Bellaghy', mapId: 'lgd-2012' }];
  const kv = { async get(key) { return key === 'names' ? names : key === 'map:lgd-2012' ? names : null; } };
  await withNoFetch(async () => {
    assert.deepEqual(await conforms(`${PREFIX}/search?q=bel`, { SPATIAL_INDEX: kv }, 'results'), { status: 200, variant: 'results' });
    const res = await call(`${PREFIX}/search?q=bel`, { SPATIAL_INDEX: kv });
    assert.equal((await res.json()).results.length, 2);
    await conforms(`${PREFIX}/spatial?mapId=lgd-2012&bbox=-6.1,54.4,-5.7,54.8`, { SPATIAL_INDEX: kv }, 'features');
    await conforms(`${PREFIX}/spatial?mapId=nothing`, { SPATIAL_INDEX: kv }, 'features');
  });
});

test('data-index over an R2 listing fits its contract', async () => {
  const bucket = {
    async list({ prefix }) {
      return {
        objects: [{ key: `${prefix}a.json`, size: 10, uploaded: new Date(0), httpEtag: '"e"' }],
        delimitedPrefixes: [`${prefix}sub/`],
        truncated: false,
      };
    },
  };
  await conforms(`${PREFIX}/data-index`, { MAPS_BUCKET: bucket }, 'listing');
  await conforms(`${PREFIX}/data-index?prefix=data/books/`, { MAPS_BUCKET: bucket }, 'listing');
  assert.equal((await conforms(`${PREFIX}/data-index?prefix=private/`, { MAPS_BUCKET: bucket })).status, 404);
});

/** A PRONI catalogue in memory, in the shape scripts/records/proni/build-proni-d1.py loads. */
async function proniFixture() {
  const { d1 } = await import('../records/d1-shim.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE proni (ref TEXT NOT NULL, title TEXT, dates TEXT, slug TEXT, level TEXT, parent TEXT, parent_slug TEXT,
             has_children INTEGER, fond TEXT, description TEXT, access TEXT, digital_record TEXT);
           CREATE VIRTUAL TABLE proni_fts USING fts5(ref, title, dates, content='proni', content_rowid='rowid', prefix='2 3', tokenize='unicode61 remove_diacritics 2');
           CREATE TABLE ext (ref TEXT PRIMARY KEY, ext_start_date TEXT, ext_end_date TEXT, ext_start_year INTEGER, ext_end_year INTEGER,
             ext_circa INTEGER, ext_estimated INTEGER, ext_bound TEXT, ext_undated INTEGER, ext_display TEXT);`);
  const add = db.prepare('INSERT INTO proni VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  add.run('D1', 'Downshire papers', '1600-1900', 'D1', 'Fonds', '', '', 1, 'D1', 'Estate papers of the Downshire family', 'Open', '');
  add.run('D1/1', 'Rentals of Hillsborough', '1700-1750', 'D1~1', 'Series', 'D1', 'D1', 0, 'D1', 'Rent rolls', 'Open', '');
  db.exec("INSERT INTO ext VALUES ('D1/1', '1700', '1750', 1700, 1750, 0, 0, '', 0, '1700-1750')");
  db.exec("INSERT INTO proni_fts(proni_fts) VALUES('rebuild')");
  return { PRONI_DB: d1(db) };
}

test('the PRONI routes over a catalogue fixture fit their contracts', async () => {
  const { installCaches } = await import('../records/d1-shim.mjs');
  installCaches();
  const env = await proniFixture();
  await conforms(`${PREFIX}/proni/node`, env, 'roots');
  await conforms(`${PREFIX}/proni/node?ref=D1/1`, env, 'node');
  assert.equal((await conforms(`${PREFIX}/proni/node?ref=Z9`, env)).status, 404);
  await conforms(`${PREFIX}/proni/search?q=rentals`, env, 'results');
  await conforms(`${PREFIX}/proni/search?q=`, env, 'results');
  await conforms(`${PREFIX}/proni/count?q=papers`, env, 'count');
  await conforms(`${PREFIX}/proni/export?q=rentals`, env, 'csv');
});

// ------------------------------------------------------------------ the OpenAPI document

test('/api/v1/openapi.json describes every route with its variants and errors', async () => {
  const res = await call(`${PREFIX}/openapi.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('API-Version'), null, 'a document, not a delegated answer');
  const doc = await res.json();
  assert.deepEqual(doc, JSON.parse(JSON.stringify(openApi())));
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.info.version, 'v1');
  assert.equal(Object.keys(doc.paths).length, Object.keys(ROUTES).length);
  for (const [key, route] of Object.entries(ROUTES)) {
    const op = doc.paths[`${PREFIX}/${key}${route.catchAll ? '/{path}' : ''}`]?.get;
    assert.ok(op, key);
    const ok = op.responses['200'].content;
    const jsonVariants = CONTRACTS[key].variants.filter((v) => v.schema);
    if (jsonVariants.length) assert.equal(ok['application/json'].schema.anyOf.length, jsonVariants.length, key);
    for (const name of route.parameters) assert.ok(op.parameters.some((p) => p.name === name), `${key}: ${name}`);
  }
  assert.equal(indexDocument().openapi, `${PREFIX}/openapi.json`);
  const head = await call(`${PREFIX}/openapi.json`, {}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await call(`${PREFIX}/openapi.json`, {}, 'POST')).status, 405);
});

// ------------------------------------------------------------------ over the records build

const RECORDS_DB = loadConfig().recordsDb;
test('over the records build, every records variant and its errors fit the contracts', { skip: !existsSync(RECORDS_DB) && `no records build at ${RECORDS_DB}` }, async () => {
  const { d1, installCaches } = await import('../records/d1-shim.mjs');
  const { resetDatasetMemo } = await import('../../packages/api/src/handlers/_records.js');
  const env = { ELECTIONS_DB: d1(RECORDS_DB) };
  const db = env.ELECTIONS_DB;
  const one = (sql) => db.prepare(sql).first();
  try {
    const contest = await one('SELECT election_key AS k, seq, slug, name FROM contests ORDER BY election_key, seq LIMIT 1');
    const summary = await one('SELECT election_key AS k FROM election_summaries ORDER BY election_key LIMIT 1');
    const election = await one("SELECT slug FROM election_cards ORDER BY slug LIMIT 1");
    const person = await one('SELECT slug FROM person_cards ORDER BY ord LIMIT 1');
    const party = await one('SELECT slug FROM party_cards ORDER BY ord LIMIT 1');
    const profiled = await one("SELECT slug FROM party_cards WHERE slug IN ('dup', 'sinn-fein', 'fianna-fail') ORDER BY slug LIMIT 1");
    const source = await one('SELECT slug FROM sources ORDER BY slug LIMIT 1');
    const entry = await one('SELECT slug FROM register_entries ORDER BY slug LIMIT 1');
    const map = await one('SELECT map_id AS id, slug, category FROM maps ORDER BY ord LIMIT 1');
    const entity = await one('SELECT entity_id AS id, slug FROM graph_entities ORDER BY shard, ord LIMIT 1');
    const division = await one('SELECT division_id AS id, shard FROM divisions ORDER BY shard, ord LIMIT 1');
    const voter = await one('SELECT person_id AS id FROM vote_persons ORDER BY person_id LIMIT 1');
    const voteParty = await one('SELECT slug FROM vote_parties ORDER BY slug LIMIT 1');
    const layer = await one('SELECT layer_id AS id FROM layers ORDER BY layer_id LIMIT 1');
    const k = encodeURIComponent(contest.k);
    const cases = [
      ['elections', '', 'index'], ['elections', '?body=northern-ireland-assembly', 'index'],
      ['elections', `?key=${k}`, 'election'], ['elections', `?key=${k}&format=bundle`, 'bundle'], ['elections', `?key=${k}&format=bundle&lite=1`, 'bundle'],
      ['elections', `?key=${k}&constituency=${contest.seq}`, 'contest'], ['elections', `?key=${k}&contest=${encodeURIComponent(contest.slug)}`, 'contest-by-slug'],
      ['elections', `?key=${k}&constituencyName=${encodeURIComponent(contest.name)}`, 'contest-by-name'],
      ['elections', '?view=manifest', 'manifest'], ['elections', `?view=summary&key=${encodeURIComponent(summary.k)}`, 'summary'],
      ['elections', `?view=provenance&key=${k}`, 'provenance'], ['elections', '?view=list&limit=5', 'list'],
      ['elections', `?view=detail&key=${k}`, 'detail'], ['elections', `?view=contests&key=${k}`, 'contests'],
      ['elections', `?view=record&slug=${election.slug}`, 'record'],
      ['persons', '?limit=5', 'list'], ['persons', '?q=moore&limit=3', 'list'], ['persons', '?facets=1', 'facets'],
      ['persons', `?slug=${person.slug}`, 'record'], ['persons', `?slug=${person.slug}&view=candidacies`, 'candidacies'],
      ['parties', '', 'list'], ['parties', `?slug=${party.slug}`, 'record'], ['parties', '?view=names', 'names'], ['parties', '?view=folds', 'folds'],
      ['sources', '?limit=3', 'list'], ['sources', `?slug=${source.slug}`, 'record'], ['sources', `?slug=${source.slug}&view=detail`, 'detail'],
      ['register-interests', '?limit=3', 'list'], ['register-interests', `?slug=${entry.slug}`, 'record'],
      ['graph', '?view=manifest', 'manifest'], ['graph', '?q=belfast&limit=3', 'search'],
      ['graph', `?entity=${encodeURIComponent(entity.id)}&related=1`, 'entity'], ['graph', `?slug=${entity.slug}`, 'slug'],
      ['graph', `?browse=person:${person.slug}`, 'browse'],
      ['stats', '', 'counts'],
      ['catalogue', '', 'document'], ['catalogue', '?visible=1', 'document'], ['catalogue', `?id=${map.id}`, 'record-by-id'],
      ['catalogue', `?slug=${map.slug}`, 'record-by-slug'], ['catalogue', `?category=${map.category}`, 'category'],
      ['catalogue', '?view=pane', 'pane'], ['catalogue', '?view=places', 'places'], ['catalogue', '?view=people', 'people'], ['catalogue', '?view=agent', 'agent'],
      ['layers', '', 'document'], ['layers', '?view=index', 'index'], ['layers', `/${layer.id}`, 'layer'],
    ];
    if (profiled) cases.push(['parties', `?slug=${profiled.slug}&view=profile`, 'profile']);
    if (division) {
      cases.push(['votes', '?view=index', 'index'], ['votes', `?division=${encodeURIComponent(division.id)}`, 'division'],
        ['votes', `?shard=${String(division.shard).padStart(3, '0')}`, 'shard'], ['votes', `?person=${voter.id}`, 'person'],
        ['votes', `?party=${voteParty.slug}`, 'party'], ['persons', `?slug=${person.slug}&view=votes`, null]);
    }
    const dup = await one("SELECT layer_id AS id FROM layers WHERE duplicates IS NOT NULL AND duplicates <> '' ORDER BY layer_id LIMIT 1");
    if (dup) cases.push(['layers', `/${dup.id}/duplicates`, 'duplicates']);
    for (const [key, query, expect] of cases) {
      installCaches();
      resetDatasetMemo();
      const { status } = await conforms(`${PREFIX}/${key}${query}`, env, expect);
      if (expect) assert.equal(status, 200, `${key}${query} -> ${status}`);
    }
    // error answers of each envelope
    for (const url of ['/elections?key=no-such-election', '/elections?view=nonsense', '/persons?slug=no-such-person', '/catalogue?id=no-such-map',
      '/catalogue?view=nonsense', '/layers/no-such-layer-vector', '/graph', '/votes', '/sources?slug=no-such-source']) {
      installCaches();
      resetDatasetMemo();
      const { status } = await conforms(`${PREFIX}${url}`, env);
      assert.ok(status >= 400, `${url}: ${status}`);
    }
  } finally {
    db._db.close();
  }
});
