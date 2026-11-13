// The map app's C6 residuals (rf9-mapapp, 12 Nov 2026): the SVG export's memoised context-outline
// fetches became a machine (export-context-state.mjs), and the derived kinds and display labels C6
// found are documented as JSDoc unions. The machine walks its table; the loaders keep their
// behaviour (fetched once, kept, retried after a failure); the unions name what the code produces.
//
//   node --test tests/unit/map-c6-residuals.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CONTEXT_OUTLINE_LOAD } from '../../packages/map/src/app/export-context-state.mjs';
import { CATALOGUE_TAB } from '../../packages/map/src/catalogue/route-state.mjs';
import { selectedPaneStatusKind } from '../../packages/map/src/election/results-model.mjs';

const STATES = ['idle', 'loading', 'ready', 'failed'];
const ALLOWED = new Set(['idle>loading', 'loading>ready', 'loading>failed', 'failed>loading']);

test('CONTEXT_OUTLINE_LOAD: the table, and every move it forbids', () => {
  assert.deepEqual([...CONTEXT_OUTLINE_LOAD.states], STATES);
  assert.equal(CONTEXT_OUTLINE_LOAD.initial, 'idle');
  for (const from of STATES) {
    for (const to of STATES) {
      const ok = ALLOWED.has(`${from}>${to}`);
      assert.equal(CONTEXT_OUTLINE_LOAD.can(from, to), ok, `${from} -> ${to}`);
      if (!ok) assert.throws(() => CONTEXT_OUTLINE_LOAD.assertTransition(from, to), /is not a transition/);
    }
  }
  // ready is kept for the page's life: nothing leaves it.
  const run = CONTEXT_OUTLINE_LOAD.start();
  run.to('loading');
  run.to('failed');
  run.to('loading');
  run.to('ready');
  assert.equal(run.done(), true);
});

test('loadContextLand: one fetch while loading, a retry after a failure, kept once loaded', async () => {
  const { loadContextLand, loadContextLoughs } = await import('../../packages/map/app/map-image-export.js');
  const realFetch = globalThis.fetch;
  let calls = 0;
  let fail = true;
  globalThis.fetch = async () => {
    calls += 1;
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ credits: ['c'], features: [{ kind: 'land', name: 'Ireland', rings: [[[0, 0, 10000, 0, 0, 10000]]] }] }) };
  };
  try {
    await assert.rejects(Promise.all([loadContextLand('/land.json'), loadContextLand('/land.json')]), /neighbouring-land outline \(503\)/);
    assert.equal(calls, 1, 'two exports while loading share one fetch');
    fail = false;
    const [a, b] = await Promise.all([loadContextLand('/land.json'), loadContextLand('/land.json')]);
    assert.equal(calls, 2, 'the failed fetch was forgotten: the next export asked again, once');
    assert.equal(a, b);
    assert.deepEqual(a.credits, ['c']);
    assert.equal(a.land[0].name, 'Ireland');
    await loadContextLand('/land.json');
    assert.equal(calls, 2, 'kept once loaded');
    // The loughs have their own load, untouched by the land's.
    fail = true;
    await assert.rejects(loadContextLoughs('/loughs.json'), /lough outlines \(503\)/);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the unions name the values the code gives', () => {
  const index = readFileSync('packages/map/src/catalogue/index.js', 'utf8');
  assert.match(index, new RegExp(`@returns \\{${CATALOGUE_TAB.values.map((v) => `'${v}'`).join(' \\| ')}\\}`), 'the tab getter names CATALOGUE_TAB\'s values');
  const kinds = new Set(['Elected', 'Not elected', 'Excluded', 'Deemed elected', '', 'Withdrew'].map(selectedPaneStatusKind));
  const model = readFileSync('packages/map/src/election/results-model.mjs', 'utf8');
  const union = /@typedef \{([^}]+)\} SelectedPaneStatusKind/.exec(model)?.[1] || '';
  for (const kind of kinds) assert.ok(union.includes(`'${kind}'`), `SelectedPaneStatusKind lacks ${kind}`);
});
