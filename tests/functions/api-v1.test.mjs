/**
 * The versioned API (/api/v1/*, functions/api/[[path]].js over functions/_lib/api/): its contract.
 *
 * - Every v1 route is the very handler module of its /_api route, and every /_api route file is
 *   either in v1 or excluded with a reason, so a new endpoint cannot be forgotten.
 * - The router: query strings and request headers pass through, catch-all routes get their
 *   segments, unknown paths and versions are 404, writes are 405, HEAD is GET without a body,
 *   a redirect to a legacy API path comes back as the v1 path.
 * - Real handlers: /api/v1/<route> answers what /_api/<route> answers (status, body, ETag,
 *   Content-Type), with no bindings and, when a records build exists, over it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as apiRoute from '../../functions/api/[[path]].js';
import { EXCLUDED, PREFIX, ROUTES, indexDocument } from '../../functions/_lib/api/v1.js';
import { delegate, lifecycleHeaders, matchRoute, rewriteLocation } from '../../functions/_lib/api/delegate.js';
import { REPO_ROOT, loadConfig } from '../../packages/config/src/node.mjs';

const FUNCTIONS = path.join(REPO_ROOT, 'functions');
const ORIGIN = 'https://civgraph.net';

/** A Pages context for `url` with params from the path after `mount`. */
function ctx(url, { method = 'GET', env = {}, headers = {}, mount = '/api/' } = {}) {
  const full = new URL(url, ORIGIN);
  const after = full.pathname.startsWith(mount) ? full.pathname.slice(mount.length) : '';
  const pending = [];
  return {
    request: new Request(full.toString(), { method, headers }),
    env,
    params: { path: after.split('/').filter(Boolean) },
    waitUntil: (p) => pending.push(p),
    next: async () => new Response('static', { status: 200 }),
    data: {},
  };
}

// ------------------------------------------------------------------ the table against the tree

/** Every /_api route path with the file that serves it (helpers and handler-less modules skipped). */
function legacyRouteFiles(dir = path.join(FUNCTIONS, '_api'), prefix = '/_api') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...legacyRouteFiles(full, `${prefix}/${entry}`)); continue; }
    if (!entry.endsWith('.js') || entry.startsWith('_')) continue;
    if (!/export\s+(?:async\s+)?(?:const|function)\s+onRequest\w*\b/.test(readFileSync(full, 'utf8'))) continue;
    const base = entry.replace(/\.js$/, '');
    const route = base === 'index' ? prefix : base.startsWith('[[') ? `${prefix}/*` : `${prefix}/${base}`;
    out.push({ route, file: full });
  }
  return out;
}

test('every v1 route is the handler module of its /_api route file', async () => {
  const files = new Map(legacyRouteFiles().map((r) => [r.route, r.file]));
  for (const [key, route] of Object.entries(ROUTES)) {
    const file = files.get(route.catchAll ? `${route.legacy}/*` : route.legacy);
    assert.ok(file, `${key}: no route file serves ${route.legacy}`);
    const mod = await import(pathToFileURL(file).href);
    assert.equal(mod, route.module, `${key}: v1 must delegate to ${path.relative(REPO_ROOT, file)} itself`);
    assert.equal(typeof (mod.onRequestGet || mod.onRequest), 'function', `${key}: no GET handler`);
  }
});

test('every /_api route is in v1 or excluded with a reason', () => {
  const inV1 = new Set(Object.values(ROUTES).map((r) => (r.catchAll ? `${r.legacy}/*` : r.legacy)));
  const excluded = (route) => Object.keys(EXCLUDED).some((p) => (p.endsWith('/*') ? route.startsWith(p.slice(0, -1)) : p === route));
  const undecided = legacyRouteFiles().map((r) => r.route).filter((r) => !inV1.has(r) && !excluded(r));
  assert.deepEqual(undecided, [], 'add each to ROUTES or EXCLUDED in functions/_lib/api/v1.js');
  for (const reason of Object.values(EXCLUDED)) assert.ok(reason.length > 10);
});

test('the v1 index lists every route with its legacy path; _routes.json routes /api/*', async () => {
  const doc = indexDocument();
  assert.equal(doc.version, 'v1');
  assert.deepEqual(doc.endpoints.map((e) => e.path), Object.keys(ROUTES).map((k) => `${PREFIX}/${k}`));
  for (const e of doc.endpoints) assert.ok(e.legacy.startsWith('/_api/') && e.summary);
  const routes = JSON.parse(readFileSync(path.join(REPO_ROOT, '_routes.json'), 'utf8'));
  assert.ok(routes.include.includes('/api/*'));
  for (const url of ['/api/v1', '/api/v1/']) {
    const res = await apiRoute.onRequest(ctx(url));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), doc);
  }
  const versions = await (await apiRoute.onRequest(ctx('/api/'))).json();
  assert.deepEqual(versions.versions.map((v) => v.index), ['/api/v1/']);
});

// ------------------------------------------------------------------ the router, with stub handlers

const seen = [];
const echo = {
  async onRequestGet(c) {
    seen.push(c);
    const url = new URL(c.request.url);
    if (url.searchParams.get('move')) {
      return new Response(null, { status: 301, headers: { Location: url.searchParams.get('move') } });
    }
    return new Response(JSON.stringify({ url: c.request.url, params: c.params, inm: c.request.headers.get('If-None-Match') }), {
      status: 200, headers: { 'Content-Type': 'application/json', ETag: '"e1"' },
    });
  },
};
const STUB = {
  version: 'v1',
  prefix: '/api/v1',
  legacyPrefix: '/_api',
  routes: {
    thing: { module: echo, legacy: '/_api/thing' },
    'deep/leaf': { module: echo, legacy: '/_api/deep/leaf' },
    tree: { module: echo, legacy: '/_api/tree', catchAll: true },
  },
  index: () => new Response('index'),
};
const run = (url, opts) => {
  const c = ctx(url, { ...opts, mount: '/api/v1/' });
  return delegate(c, STUB, c.params.path);
};

test('a v1 request reaches the handler as its legacy URL, query and headers intact', async () => {
  const res = await run('/api/v1/thing?a=1&b=two%20words', { headers: { 'If-None-Match': '"x"' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('API-Version'), 'v1');
  assert.equal(res.headers.get('ETag'), '"e1"');
  const body = await res.json();
  assert.equal(body.url, `${ORIGIN}/_api/thing?a=1&b=two%20words`);
  assert.deepEqual(body.params, {});
  assert.equal(body.inm, '"x"');
  assert.equal((await (await run('/api/v1/deep/leaf')).json()).url, `${ORIGIN}/_api/deep/leaf`);
});

test('a catch-all route gets the segments after it', async () => {
  const body = await (await run('/api/v1/tree/lgd-2012-vector/duplicates?x=1')).json();
  assert.equal(body.url, `${ORIGIN}/_api/tree/lgd-2012-vector/duplicates?x=1`);
  assert.deepEqual(body.params, { path: ['lgd-2012-vector', 'duplicates'] });
});

test('unknown paths and versions are 404 JSON; an exact route takes no subpath', async () => {
  for (const url of ['/api/v1/nothing', '/api/v1/thing/extra', '/api/v1/deep']) {
    const res = await run(url);
    assert.equal(res.status, 404, url);
    assert.equal((await res.json()).ok, false);
  }
  const res = await apiRoute.onRequest(ctx('/api/v9/elections'));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(matchRoute(STUB.routes, ['deep', 'leaf']).key, 'deep/leaf');
});

test('writes are refused with 405 before any handler runs; HEAD is GET without a body', async () => {
  seen.length = 0;
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await run('/api/v1/thing', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('Allow'), 'GET, HEAD');
  }
  assert.equal(seen.length, 0, 'a refused method must not reach the handler');
  const head = await run('/api/v1/thing', { method: 'HEAD' });
  const get = await run('/api/v1/thing');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('ETag'), get.headers.get('ETag'));
  assert.equal(seen.at(-1).request.method, 'GET', 'the handler sees a GET');
  assert.equal((await apiRoute.onRequest(ctx('/api/', { method: 'POST' }))).status, 405);
});

test('a redirect to a legacy API path comes back as the v1 path', async () => {
  const loc = async (target) => (await run(`/api/v1/thing?move=${encodeURIComponent(target)}`)).headers.get('Location');
  assert.equal(await loc(`${ORIGIN}/_api/thing?slug=new`), `${ORIGIN}/api/v1/thing?slug=new`);
  assert.equal(await loc('/_api/tree/a-vector'), '/api/v1/tree/a-vector');
  assert.equal(await loc('/_api/deep/leaf?x=1'), '/api/v1/deep/leaf?x=1');
  assert.equal(await loc('/_api/other'), '/_api/other', 'a path v1 does not serve stays legacy');
  assert.equal(await loc('/_api/thing/sub'), '/_api/thing/sub', 'an exact route takes no subpath');
  assert.equal(await loc('https://example.org/_api/thing'), 'https://example.org/_api/thing');
  assert.equal(rewriteLocation('/browse/', `${ORIGIN}/api/v1/thing`, STUB.routes, '/api/v1'), '/browse/');
});

test("a version's documents answer before its routes; a successor version adds Link, a sunset date Sunset", async () => {
  const withDocs = { ...STUB, documents: { 'about.json': () => new Response('{"about":1}', { headers: { 'Content-Type': 'application/json' } }) } };
  const runWith = (api, url, opts) => {
    const c = ctx(url, { ...opts, mount: '/api/v1/' });
    return delegate(c, api, c.params.path);
  };
  assert.deepEqual(await (await runWith(withDocs, '/api/v1/about.json')).json(), { about: 1 });
  assert.equal(await (await runWith(withDocs, '/api/v1/about.json', { method: 'HEAD' })).text(), '');
  assert.equal((await runWith(withDocs, '/api/v1/about.json/x')).status, 404, 'a document has no subpaths');
  assert.equal((await runWith(withDocs, '/api/v1/about.json', { method: 'POST' })).status, 405);

  // v1 today: no successor, no sunset, so no lifecycle headers
  const plain = await run('/api/v1/thing?a=1');
  assert.equal(plain.headers.get('Link'), null);
  assert.equal(plain.headers.get('Sunset'), null);

  const v2 = { version: 'v2', prefix: '/api/v2', routes: { thing: {}, tree: {} } };
  const later = { ...STUB, successor: v2, sunset: 'Wed, 01 Jan 2031 00:00:00 GMT' };
  const res = await runWith(later, '/api/v1/tree/a%20b/c?x=1');
  assert.equal(res.headers.get('Link'), '</api/v2/tree/a%20b/c?x=1>; rel="successor-version"');
  assert.equal(res.headers.get('Sunset'), 'Wed, 01 Jan 2031 00:00:00 GMT');
  assert.equal(res.headers.get('API-Version'), 'v1');
  const gone = await runWith({ ...STUB, successor: v2 }, '/api/v1/deep/leaf');
  assert.equal(gone.headers.get('Link'), null, 'a route the successor dropped points nowhere');
  assert.deepEqual(lifecycleHeaders({}, 'thing', [], ''), {});
});

// ------------------------------------------------------------------ the real handlers

/** The answer of a module's handler at a URL, after a fresh cache and dataset memo. */
async function legacyAnswer(module, url, env, resetState) {
  await resetState();
  const c = ctx(url, { env, mount: '/_api/' });
  c.params = {};
  const res = await (module.onRequestGet || module.onRequest)(c);
  return { status: res.status, type: res.headers.get('Content-Type'), etag: res.headers.get('ETag'), location: res.headers.get('Location'), body: await res.text() };
}
/** The same for a catch-all module, whose segments arrive as params.path. */
async function catchAllAnswer(route, url, env) {
  await freshState();
  const c = ctx(url, { env, mount: `${route.legacy}/` });
  if (new URL(url, ORIGIN).pathname === route.legacy) c.params = { path: [] };
  const res = await route.module.onRequestGet(c);
  return { status: res.status, type: res.headers.get('Content-Type'), etag: res.headers.get('ETag'), location: res.headers.get('Location'), body: await res.text() };
}
async function v1Answer(url, env, resetState) {
  await resetState();
  const res = await apiRoute.onRequest(ctx(url, { env }));
  return { status: res.status, type: res.headers.get('Content-Type'), etag: res.headers.get('ETag'), location: res.headers.get('Location'), body: await res.text() };
}

async function freshState() {
  const { installCaches } = await import('../records/d1-shim.mjs');
  const { resetDatasetMemo } = await import('../../functions/_api/_records.js');
  installCaches();
  resetDatasetMemo();
}

test('with no bindings, /api/v1 answers what /_api answers', async () => {
  for (const [key, query] of [['stats', ''], ['persons', '?q=moore'], ['parties', ''], ['elections', '?key=x'], ['data-index', '']]) {
    const a = await legacyAnswer(ROUTES[key].module, `${ROUTES[key].legacy}${query}`, {}, freshState);
    const b = await v1Answer(`/api/v1/${key}${query}`, {}, freshState);
    assert.deepEqual(b, a, key);
    assert.ok(a.status >= 400, `${key} without bindings should be an error, got ${a.status}`);
  }
});

test('the elections API\'s retired-slug 301 points at the v1 path', async () => {
  const query = '?view=record&slug=bangor-urban-district-council-1920-01-15';
  const a = await legacyAnswer(ROUTES.elections.module, `/_api/elections${query}`, {}, freshState);
  const b = await v1Answer(`/api/v1/elections${query}`, {}, freshState);
  assert.equal(a.status, 301);
  assert.equal(a.location, `${ORIGIN}/_api/elections?view=record&slug=bangor-borough-council-1920-01-15`);
  assert.equal(b.status, 301);
  assert.equal(b.location, `${ORIGIN}/api/v1/elections?view=record&slug=bangor-borough-council-1920-01-15`);
});

const RECORDS_DB = loadConfig().recordsDb;
test('over the records build, /api/v1 answers what /_api answers, byte for byte', { skip: !existsSync(RECORDS_DB) && `no records build at ${RECORDS_DB}` }, async () => {
  const { d1 } = await import('../records/d1-shim.mjs');
  const env = { ELECTIONS_DB: d1(RECORDS_DB) };
  const db = env.ELECTIONS_DB;
  const person = await db.prepare('SELECT slug FROM person_cards ORDER BY ord LIMIT 1').first();
  const party = await db.prepare('SELECT slug FROM party_cards ORDER BY ord LIMIT 1').first();
  const urls = [
    ['stats', ''],
    ['parties', ''], ['parties', `?slug=${party.slug}`], ['parties', '?view=names'],
    ['persons', '?limit=5'], ['persons', '?q=moore&limit=3'], ['persons', `?slug=${person.slug}`], ['persons', `?slug=${person.slug}&view=candidacies`],
    ['sources', '?limit=3'], ['register-interests', '?limit=3'],
    ['elections', '?body=northern-ireland-assembly'], ['elections', '?view=list&limit=5'],
    ['graph', '?view=manifest'], ['votes', '?view=index'],
  ];
  // The phase-3 map tables, when this build has them: the layer routes are a catch-all.
  const hasLayers = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'layer_aliases'").first();
  const alias = hasLayers ? await db.prepare('SELECT alias, layer_id FROM layer_aliases ORDER BY alias LIMIT 1').first() : null;
  if (alias) {
    urls.push(['layers', '?view=index'], ['layers', `/${alias.layer_id}`], ['layers', `/${alias.layer_id}/duplicates`], ['catalogue', '?visible=1']);
  }
  try {
    for (const [key, query] of urls) {
      const legacyUrl = `${ROUTES[key].legacy}${query}`;
      const a = ROUTES[key].catchAll
        ? await catchAllAnswer(ROUTES[key], legacyUrl, env)
        : await legacyAnswer(ROUTES[key].module, legacyUrl, env, freshState);
      const b = await v1Answer(`/api/v1/${key}${query}`, env, freshState);
      assert.deepEqual(b, a, `${key}${query}`);
      // votes answer 404 by design in a build without the votes dataset (tests/records/d1-shim.mjs)
      if (key !== 'votes') assert.equal(a.status, 200, `${key}${query} -> ${a.status}`);
    }
    if (alias) {
      // another spelling of a layer id answers 301 to the live id, at the v1 address
      const moved = await v1Answer(`/api/v1/layers/${alias.alias}`, env, freshState);
      assert.equal(moved.status, 301);
      assert.equal(new URL(moved.location, ORIGIN).pathname, `/api/v1/layers/${alias.layer_id}`);
    }
  } finally {
    db._db.close();
  }
});
