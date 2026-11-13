/**
 * What the site says about /api/v1 (site/llms.txt "Records API", site/pages/api.html, the footer and
 * site/agent/guide.md) is what the v1 router serves: the routes listed are exactly v1's routes,
 * /api/v1/ and /api/v1/openapi.json answer JSON, and every v1 route is the same handler as the
 * /_api path it names. A route added to v1 without a mention in llms.txt fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as apiRoute from '../../packages/api/src/v1/route.js';
import { PREFIX, ROUTES } from '../../packages/api/src/v1/v1.js';
import { REPO_ROOT } from '../../packages/config/src/node.mjs';
import { footer } from '../../packages/ui/src/templates/shell.js';

const read = (/** @type {string} */ rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** A GET to the /api router for `url`, as Pages calls it. @param {string} url */
function get(url) {
  const full = new URL(url, 'https://civgraph.net');
  return apiRoute.onRequest(({
    request: new Request(full.toString()),
    env: {},
    params: { path: full.pathname.slice('/api/'.length).split('/').filter(Boolean) },
    waitUntil: () => {},
    next: async () => new Response('static'),
    data: {},
  }));
}

/** The "## Records API" section of llms.txt. */
function llmsSection() {
  const text = read('site/llms.txt');
  const start = text.indexOf('## Records API');
  assert.ok(start > text.indexOf('## Data'), 'the Records API section follows ## Data');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

test('llms.txt lists exactly the v1 routes', () => {
  const routesLine = llmsSection().split('\n').find((l) => l.startsWith('- Routes:'));
  assert.ok(routesLine, 'a "- Routes:" line');
  const top = [...routesLine.matchAll(/`\/(?:api\/v1\/)?([a-z-]+)`/g)].map((m) => /** @type {string} */ (m[1]));
  const proni = (/under `\/api\/v1\/proni\/` \(([^)]*)\)/.exec(routesLine)?.[1] ?? '').match(/`([a-z]+)`/g)?.map((s) => `proni/${s.slice(1, -1)}`) ?? [];
  assert.deepEqual([...top, ...proni].sort(), Object.keys(ROUTES).sort());
});

test('/api/v1/ and /api/v1/openapi.json answer JSON, as the page and llms.txt say', async () => {
  const index = await get(`${PREFIX}/`);
  assert.equal(index.status, 200);
  const doc = await index.json();
  assert.equal(doc.openapi, `${PREFIX}/openapi.json`);
  const openapi = await get(`${PREFIX}/openapi.json`);
  assert.equal(openapi.status, 200);
  assert.match((await openapi.json()).openapi, /^3\.1\./);
  for (const text of [llmsSection(), read('site/pages/api.html'), read('site/agent/guide.md')]) {
    assert.ok(text.includes('/api/v1/openapi.json') && /\/api\/v1\/["`)]/.test(text));
  }
});

test('every v1 route is an alias of the /_api path of the same name', () => {
  for (const [name, r] of Object.entries(ROUTES)) assert.equal(r.legacy, `/_api/${name}`);
});

test('the API page is linked from the footer, About and the agent guide', () => {
  assert.ok(String(footer()).includes('<a href="/pages/api">API</a>'));
  assert.ok(read('site/pages/about.html').includes('<a href="/pages/api">Civgraph API</a>'));
  assert.ok(read('site/agent/guide.md').includes('https://civgraph.net/pages/api'));
  assert.ok(read('site/sitemaps/pages.xml').includes('<loc>https://civgraph.net/pages/api</loc>'));
});
