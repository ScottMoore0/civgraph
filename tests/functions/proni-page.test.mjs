// /proni/<reference> is rendered on the server (QA 2026-11-11, M7): the record's body in the
// shell's #viewRecord, written by the app's own record-view.js, and a real 404 for a reference
// the catalogue does not hold. The <head> stays the shell's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../packages/config/src/node.mjs';
import { d1, installCaches, context } from '../records/d1-shim.mjs';
import { fillRecordView, refFromPath, serveRecordPage } from '../../packages/api/src/handlers/proni/page.js';
import { loadNode } from '../../packages/api/src/handlers/proni/node.js';
import { fromD1 } from '../../packages/storage/src/d1.js';
import { recordHtml } from '../../site/apps/proni-search/record-view.js';
import { onRequestGet as proniPath } from '../../functions/proni/[[path]].js';
import { catalogue } from './proni-fixture.mjs';

const SHELL = readFileSync(path.join(REPO_ROOT, 'site/apps/proni-search/index.html'), 'utf8');
const shell = async () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=3600' } });

test('a reference is read from the address as the app reads it', () => {
  assert.equal(refFromPath('/proni/LA/7/1/CA/1/3'), 'LA/7/1/CA/1/3');
  assert.equal(refFromPath('/proni/D%20100/2/'), 'D 100/2');
  assert.equal(refFromPath('/proni'), null);
  assert.equal(refFromPath('/proni/'), null);
  assert.equal(refFromPath('/proni/%E0%A4%A'), null);
});

test('the shell still has the markup the body goes into', () => {
  const out = fillRecordView(SHELL, '<p>body</p>', 'D1/"2"');
  assert.ok(out.includes('<div id="viewRecord" data-ssr-ref="D1/&quot;2&quot;"><p>body</p></div>'));
  assert.ok(out.includes('<div id="viewSearch" hidden>'));
  assert.equal(fillRecordView('<html></html>', '<p>x</p>', 'D1'), '<html></html>');
  // a body with $& or $1 in it goes in as written
  assert.ok(fillRecordView(SHELL, 'cost $& and $1', 'D1').includes('cost $& and $1'));
});

test('a record page carries the record, its levels, siblings and children, without JavaScript', async () => {
  installCaches();
  const db = catalogue();
  const env = { PRONI_DB: d1(db) };
  const res = await serveRecordPage(context('/proni/D100/9A', env), shell);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  const html = await res.text();
  const view = html.slice(html.indexOf('<div id="viewRecord"'), html.indexOf('<div id="viewEcat"'));
  const row = db.prepare('SELECT title, level FROM proni WHERE ref = ?').get('D100/9A');
  assert.ok(view.includes('data-ssr-ref="D100/9A"'));
  assert.ok(view.includes(`<h2 class="ps-rec__title">${row.title}</h2>`), 'title');
  assert.ok(view.includes(`<th scope="row">Level</th><td>${row.level}</td>`), 'level');
  assert.ok(view.includes('href="/proni/D100" data-go="/proni/D100"'), 'breadcrumb');
  assert.ok(view.includes('href="/proni/D100/8"'), 'previous sibling');
  assert.ok(view.includes('[9 – 29]'), 'position');
  // it is the markup the app draws for the same record
  const node = await loadNode(fromD1(env.PRONI_DB), 'D100/9A');
  assert.ok(view.includes(recordHtml(/** @type {any} */ (node))));
  // the head is the shell's
  assert.equal(html.slice(0, html.indexOf('</head>')), SHELL.slice(0, SHELL.indexOf('</head>')));
});

test('a fond lists its first 200 children and counts the rest', async () => {
  installCaches();
  const db = catalogue();
  const add = db.prepare("INSERT INTO proni VALUES (?, ?, '', ?, 'Item', 'B103', 'B103', 0, 'B103', '', 'Open', '', NULL, NULL)");
  for (let i = 30; i < 1235; i += 1) add.run(`B103/${i}`, `Item ${i}`, `B103~${i}`);
  const html = await (await serveRecordPage(context('/proni/B103', { PRONI_DB: d1(db) }), shell)).text();
  assert.ok(html.includes('Records within B103 <span class="ps-rec__count">(1,234)</span>'));
  assert.ok(html.includes('…and 1,034 more.'));
  assert.equal((html.match(/<li><a href="\/proni\/B103\//g) || []).length, 200);
});

test('a reference not in the catalogue is a 404 with the app\'s not-found body', async () => {
  installCaches();
  const env = { PRONI_DB: d1(catalogue()) };
  const res = await serveRecordPage(context('/proni/ZZZ/999/NOTREAL', env), shell);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  const html = await res.text();
  assert.ok(html.includes('No record found for reference <b>ZZZ/999/NOTREAL</b>.'));
  assert.ok(html.includes('<script type="module" src="/apps/proni-search/app.js'), 'the app still loads');
});

test('the search page, the eCatalogue guide and an outage get the shell as it is', async () => {
  installCaches();
  const env = { PRONI_DB: d1(catalogue()) };
  for (const url of ['/proni', '/proni/D100?ecat=D100']) {
    const res = await serveRecordPage(context(url, env), shell);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), SHELL);
  }
  const broken = { prepare() { throw new Error('D1_ERROR'); }, batch() { throw new Error('D1_ERROR'); } };
  const down = await serveRecordPage(context('/proni/D100', { PRONI_DB: broken }), shell);
  assert.deepEqual([down.status, await down.text() === SHELL], [200, true]);
  const unbound = await serveRecordPage(context('/proni/D100', {}), shell);
  assert.deepEqual([unbound.status, await unbound.text() === SHELL], [200, true]);
});

test('functions/proni/[[path]].js serves the rendered page', async () => {
  installCaches();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(SHELL, { status: 200 });
  try {
    const env = { PRONI_DB: d1(catalogue()), ASSETS: { fetch: async () => new Response(SHELL, { status: 200 }) } };
    const ok = await proniPath(context('/proni/D100', env));
    assert.equal(ok.status, 200);
    assert.ok((await ok.text()).includes('data-ssr-ref="D100"'));
    const missing = await proniPath(context('/proni/NOPE', env));
    assert.equal(missing.status, 404);
  } finally { globalThis.fetch = realFetch; }
});
