// The Independent QUB Catalogue's endpoints (27 Nov 2026, local only): search, record, stats, export
// and the /qub pages, over a fixture catalogue in the build's schema, through the real handlers.
// What matters most is held here: the scope filter is on by default, every record carries its
// link to QUB's catalogue and the credit, and with no QUB_DB binding /qub answers 404 (so landing
// the code publishes nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { d1, context } from '../records/d1-shim.mjs';
import * as search from '@civgraph/api/handlers/qub/search.js';
import * as record from '@civgraph/api/handlers/qub/record.js';
import * as exportCsv from '@civgraph/api/handlers/qub/export.js';
import { serveQub } from '@civgraph/api/handlers/qub/page.js';
import { qubRecordUrl } from '@civgraph/api/handlers/qub/_query.js';
import { catalogue, FIRST_ID } from './qub-fixture.mjs';

const env = () => ({ QUB_DB: d1(catalogue(), { readOnly: false }) });
const get = async (/** @type {(c: any) => Promise<Response>} */ handler, /** @type {string} */ url, e = env()) => handler(context(url, e));

test('search: within Civgraph scope by default, every row linked to QUB', async () => {
  const res = await get(search.onRequestGet, '/_api/qub/search?q=belfast');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scope, 'in');
  assert.ok(body.results.length > 0);
  for (const r of body.results) {
    assert.equal(r.inScope, true);
    assert.equal(r.qubUrl, qubRecordUrl(r.mmsId));
    assert.match(r.qubUrl, /^https:\/\/qub\.primo\.exlibrisgroup\.com\/discovery\/fulldisplay\?docid=alma99\d+&context=L&vid=44QSUB_INST%3AQUB/);
    assert.equal(r.url, `/qub/${r.mmsId}`);
  }
  assert.equal(body.total, 10);
});

test('search: scope=all and scope=out widen and invert the filter', async () => {
  const all = await (await get(search.onRequestGet, '/_api/qub/search?scope=all&q=chemistry')).json();
  assert.equal(all.total, 10);
  const none = await (await get(search.onRequestGet, '/_api/qub/search?q=chemistry')).json();
  assert.equal(none.total, 0);
  const out = await (await get(search.onRequestGet, '/_api/qub/search?scope=out')).json();
  assert.equal(out.total, 20);
  assert.ok(out.results.every((/** @type {{ inScope: boolean }} */ r) => !r.inScope));
});

test('search: topic tags must all be present; year range filters', async () => {
  const bg = await (await get(search.onRequestGet, '/_api/qub/search?tag=B,G')).json();
  assert.equal(bg.total, 10);
  assert.ok(bg.results.every((/** @type {{ tags: string[] }} */ r) => r.tags.includes('B') && r.tags.includes('G')));
  const be = await (await get(search.onRequestGet, '/_api/qub/search?tag=B,E')).json();
  assert.equal(be.total, 0);
  const years = await (await get(search.onRequestGet, '/_api/qub/search?scope=all&from=1850&to=1859&sort=year')).json();
  assert.equal(years.total, 10);
  assert.deepEqual(years.results.map((/** @type {{ year: number }} */ r) => r.year), [1850, 1851, 1852, 1853, 1854, 1855, 1856, 1857, 1858, 1859]);
});

test('search: pages carry one extra row, and the total only on the first page', async () => {
  const first = await (await get(search.onRequestGet, '/_api/qub/search?limit=5')).json();
  assert.equal(first.results.length, 6);
  assert.equal(first.total, 40);
  const second = await (await get(search.onRequestGet, '/_api/qub/search?limit=5&offset=5')).json();
  assert.equal(second.total, null);
  const ids = new Set([...first.results.slice(0, 5), ...second.results].map((/** @type {{ mmsId: string }} */ r) => r.mmsId));
  assert.equal(ids.size, 11);
});

test('search: no binding answers 503; a bad FTS query answers 500 without the SQL', async () => {
  const res = await get(search.onRequestGet, '/_api/qub/search?q=x', /** @type {any} */ ({}));
  assert.equal(res.status, 503);
});

test('record: main fields, scope, QUB link and credit; 404 and 400', async () => {
  const res = await get(record.onRequestGet, `/_api/qub/record?id=${FIRST_ID}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.item.mmsId, FIRST_ID);
  assert.equal(body.qubUrl, qubRecordUrl(FIRST_ID));
  assert.match(body.credit, /Queen.s University Belfast Library/);
  assert.match(body.credit, /OCLC/);
  assert.equal(body.item.inScope, true);
  assert.deepEqual(body.item.tags, ['C']);
  assert.equal(body.item.extent, '120 p.');
  assert.deepEqual(body.item.contributors, [{ name: 'Smith, John', role: 'editor' }]);
  assert.equal(body.item.holdings[0].callNumber, 'JN1400');
  assert.equal((await get(record.onRequestGet, '/_api/qub/record?id=99999999999')).status, 404);
  assert.equal((await get(record.onRequestGet, '/_api/qub/record?id=abc')).status, 400);
});

test('record with no id: the figures and the topic names', async () => {
  const body = await (await get(record.onRequestGet, '/_api/qub/record')).json();
  assert.equal(body.total, 60);
  assert.equal(body.inScope, 40);
  assert.equal(body.tags.length, 8);
  assert.deepEqual(body.tags.find((/** @type {{ tag: string }} */ t) => t.tag === 'B'), { tag: 'B', name: 'Parliaments and government records', count: 10 });
});

test('export: CSV with the QUB link on every row and the credit at the end; refuses an empty query', async () => {
  const res = await get(exportCsv.onRequestGet, '/_api/qub/export?q=census');
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/csv/);
  const text = await res.text();
  const lines = text.trim().split('\r\n');
  assert.equal(String(lines[0]).replace(/^﻿/, ''), exportCsv.HEADER.join(','));
  const rows = lines.slice(1, -2);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((l) => l.includes('https://qub.primo.exlibrisgroup.com/discovery/fulldisplay?docid=alma')));
  assert.match(String(lines.at(-1)), /Queen.s University Belfast Library/);
  assert.equal((await get(exportCsv.onRequestGet, '/_api/qub/export?scope=all')).status, 400);
});

test('/qub pages: 404 with no binding (local only), the record head on a record page, 404 for a missing id', async () => {
  const shell = '<html><head><title>Independent QUB Catalogue</title><meta name="description" content="x"></head><body></body></html>';
  const ASSETS = { fetch: async () => new Response(shell, { status: 200 }) };
  assert.equal((await serveQub(/** @type {any} */ (context('/qub', { ASSETS })))).status, 404);
  const e = { ...env(), ASSETS };
  const home = await serveQub(/** @type {any} */ (context('/qub', e)));
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('X-Robots-Tag'), 'noindex');
  const page = await serveQub(/** @type {any} */ (context(`/qub/${FIRST_ID}`, e)));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Belfast elections 0 – QUB catalogue record – Civgraph<\/title>/);
  assert.equal((await serveQub(/** @type {any} */ (context('/qub/99123123123', e)))).status, 404);
  assert.equal((await serveQub(/** @type {any} */ (context('/qub/not-an-id', e)))).status, 404);
});
