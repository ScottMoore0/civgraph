// Developer logging in the map app (src/debug-log.js): off for visitors, on with ?debug or
// localStorage civgraph.debug = '1' (QA 2026-11-11, M10: ~200 console lines per layer selection).
//
//   node --test tests/unit/debug-log.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

async function withPage({ search = '', stored = null }, fn) {
  const saved = { location: globalThis.location, localStorage: globalThis.localStorage, log: console.log };
  const lines = [];
  globalThis.location = { search };
  globalThis.localStorage = { getItem: (key) => (key === 'civgraph.debug' ? stored : null) };
  console.log = (...args) => lines.push(args.join(' '));
  try {
    // A fresh copy each time: the module reads the switch once per page.
    const mod = await import(`../../src/debug-log.js?case=${encodeURIComponent(search)}-${stored}`);
    mod.debugLog('[DataService] hello');
    return { enabled: mod.debugEnabled(), lines };
  } finally {
    console.log = saved.log;
    globalThis.location = saved.location;
    globalThis.localStorage = saved.localStorage;
  }
}

test('silent for a visitor', async () => {
  assert.deepEqual(await withPage({}, () => {}), { enabled: false, lines: [] });
  assert.equal((await withPage({ search: '?debugger=1' })).enabled, false);
});

test('on with ?debug or the stored switch', async () => {
  assert.deepEqual((await withPage({ search: '?debug' })).lines, ['[DataService] hello']);
  assert.equal((await withPage({ search: '?x=1&debug=1' })).enabled, true);
  assert.equal((await withPage({ stored: '1' })).enabled, true);
});

test('the map app\'s data and feature loaders log through it, not console.log', () => {
  for (const file of ['src/data-service.js', 'src/feature-loader.js']) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.ok(!/console\.log\(/.test(source), `${file} calls console.log`);
    assert.ok(source.includes("from './debug-log.js'"), file);
  }
});
