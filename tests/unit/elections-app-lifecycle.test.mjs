/**
 * The Elections app's view lifecycle (11 Nov 2026 arch audit P1; site/apps/elections/lib/lifecycle.js):
 * a view's listeners and cleanups end with it, superseded runs draw nothing, the DuckDB lock never
 * interleaves two tasks, a pivot run keeps the settings it started with, and the swingometer's URL
 * and sliders share one limit. The pages are driven by tests/browser/elections-app.spec.cjs.
 *
 *   node --test tests/unit/elections-app-lifecycle.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createViewScope, latestRun, serial } from '../../site/apps/elections/lib/lifecycle.js';
import { pivotTable, settingsOf, stateFromQuery } from '../../site/apps/elections/lib/pivot.js';
import { SWING_LIMIT, clampSwing } from '../../site/apps/elections/state-machines.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'site', 'apps', 'elections');
const read = (rel) => readFileSync(path.join(APP, rel), 'utf8');

test('a view scope: leaving the view removes its listeners and runs its cleanups once, newest first', () => {
  const root = new EventTarget();
  const scope = createViewScope();
  let heard = 0;
  root.addEventListener('input', () => { heard += 1; }, { signal: scope.signal });
  const order = [];
  scope.onDispose(() => order.push('map removed'));
  scope.onDispose(() => order.push('holder removed'));
  root.dispatchEvent(new Event('input'));
  assert.equal(heard, 1);
  assert.equal(scope.stale(), false);

  scope.dispose();
  scope.dispose();
  assert.equal(scope.stale(), true);
  assert.deepEqual(order, ['holder removed', 'map removed']);
  root.dispatchEvent(new Event('input'));
  assert.equal(heard, 1, 'the listener went with the view');

  // A cleanup registered after the view was left (an await that resumed late) runs at once.
  scope.onDispose(() => order.push('late'));
  assert.deepEqual(order, ['holder removed', 'map removed', 'late']);
});

test('a view scope: three visits leave one live listener, not three', () => {
  const root = new EventTarget();
  let scope = createViewScope();
  let heard = 0;
  for (let visit = 0; visit < 3; visit += 1) {
    scope.dispose();
    scope = createViewScope();
    root.addEventListener('input', () => { heard += 1; }, { signal: scope.signal });
  }
  root.dispatchEvent(new Event('input'));
  assert.equal(heard, 1);
});

test('a view scope: a cleanup that throws is reported and the others still run', () => {
  const reported = [];
  const scope = createViewScope((error) => reported.push(String(error)));
  const ran = [];
  scope.onDispose(() => ran.push('first'));
  scope.onDispose(() => { throw new Error('boom'); });
  scope.dispose();
  assert.deepEqual(ran, ['first']);
  assert.deepEqual(reported, ['Error: boom']);
});

test('latestRun: an answer that arrives after a newer run started is dropped', async () => {
  const runs = latestRun();
  const drawn = [];
  const slow = async (label, ms) => {
    const token = runs.start();
    await new Promise((resolve) => { setTimeout(resolve, ms); });
    if (runs.isLatest(token)) drawn.push(label);
  };
  await Promise.all([slow('first (slow)', 30), slow('second (fast)', 1)]);
  assert.deepEqual(drawn, ['second (fast)']);
});

test('serial: tasks never interleave, and a failed task does not block the next', async () => {
  const lock = serial();
  const log = [];
  const task = (label, ms, fail = false) => lock(async () => {
    log.push(`${label} bind`);
    await new Promise((resolve) => { setTimeout(resolve, ms); });
    log.push(`${label} query`);
    if (fail) throw new Error(label);
    return label;
  });
  const results = await Promise.allSettled([task('pivot', 20), task('map', 1, true), task('swing', 1)]);
  assert.deepEqual(log, ['pivot bind', 'pivot query', 'map bind', 'map query', 'swing bind', 'swing query']);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('a pivot run keeps the settings it started with', () => {
  const state = stateFromQuery(new URLSearchParams('body=northern-ireland-assembly&rows=party&cols=year&measure=votes&f.party=SF'));
  const settings = settingsOf(state);
  // The form changes while the run is out: measure, bodies and filters.
  state.measure = 'share';
  state.bodies.push('dail-eireann');
  state.filters.party.push('DUP');
  assert.equal(settings.measure, 'votes');
  assert.deepEqual(settings.bodies, ['northern-ireland-assembly']);
  assert.deepEqual(settings.filters.party, ['SF']);
  const table = pivotTable([{ r: 'SF', c: '2022', v: 250388 }, { r: 'DUP', c: '2022', v: 184002 }], settings);
  assert.equal(table.digits, 0, 'shaped with the run\'s measure (votes), not the newer one (share)');
  assert.equal(table.totals[0], 434390);
});

test('the swingometer: the URL and the sliders share one limit', () => {
  assert.equal(SWING_LIMIT, 15);
  assert.equal(clampSwing('30'), SWING_LIMIT, 'a URL cannot ask for more than a slider can show');
  assert.equal(clampSwing('-40'), -SWING_LIMIT);
  assert.equal(clampSwing('2.5'), 2.5);
  assert.equal(clampSwing(''), null);
  assert.equal(clampSwing(null), null);
  assert.equal(clampSwing('x'), null);
  const swing = read('views/swing.js');
  assert.match(swing, /min="\$\{-SWING_LIMIT\}" max="\$\{SWING_LIMIT\}"/, 'the slider range is SWING_LIMIT');
  assert.doesNotMatch(swing, /Math\.(max|min)\(-?30/, 'no second limit');
});

test('no view navigates by a page load, and every listener a view adds ends with it', () => {
  const views = readdirSync(path.join(APP, 'views')).filter((f) => f.endsWith('.js'));
  assert.ok(views.length >= 8);
  for (const file of views) {
    const src = read(`views/${file}`);
    assert.doesNotMatch(src, /location\.(assign|replace)\(/, `${file} reloads the page`);
    // Every addEventListener call closes with an options argument that carries the signal.
    const calls = [...src.matchAll(/\.addEventListener\(/g)].length;
    const withSignal = [...src.matchAll(/\}, (listen|\{ signal: ctx\.signal \})\);/g)].length;
    assert.equal(withSignal, calls, `${file}: ${calls - withSignal} listener(s) without ctx.signal`);
  }
  for (const file of ['views/map.js', 'views/notional.js']) {
    assert.match(read(file), /areaMap\([^;]*signal: ctx\.signal/, `${file}: its map is removed with the view`);
  }
});
