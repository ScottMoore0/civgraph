// The root service worker's own lifecycle (sw.js; state-machine catalogue MA-14, worker half).
// sw.js is a classic worker script and cannot import assets/ui/state/machine.js, so its table
// (LIFECYCLE_TRANSITIONS) is inline. This test builds that table with the shared helper, checks
// that the worker's lifecycleMove() agrees with the helper's `can` for every pair of states, and
// drives install and activate in a fake ServiceWorkerGlobalScope: the states it passes through,
// the activation policy (skipWaiting, clients.claim) and which caches activate deletes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { defineMachine } from '../../packages/ui/assets/state/machine.js';

const SOURCE = readFileSync('site/sw.js', 'utf8');
const VERSION = SOURCE.match(/const VERSION = '([^']+)';/)?.[1];
const literal = SOURCE.match(/const LIFECYCLE_TRANSITIONS = (\{[^\n]*\});/)?.[1];

/** The worker's table, as the shared helper reads it. */
function lifecycleMachine() {
  assert.ok(literal, 'LIFECYCLE_TRANSITIONS not found in sw.js');
  const transitions = vm.runInNewContext(`(${literal})`);
  return defineMachine({ name: 'service worker lifecycle', initial: 'parsed', transitions });
}

/** Evaluate sw.js in a fake worker scope; returns its context, handlers, log and warnings. */
function loadWorker(cacheNames = []) {
  const handlers = {};
  const log = [];
  const warnings = [];
  const caches = {
    names: [...cacheNames],
    async keys() { return [...this.names]; },
    async delete(name) { log.push(`delete ${name}`); this.names = this.names.filter((n) => n !== name); return true; },
    async open(name) {
      if (!this.names.includes(name)) this.names.push(name);
      return { async put(url) { log.push(`put ${name} ${url}`); }, async keys() { return []; } };
    },
  };
  const self = {
    location: { origin: 'https://civgraph.net' },
    registration: { scope: 'https://civgraph.net/' },
    clients: { async claim() { log.push('claim'); } },
    async skipWaiting() { log.push('skipWaiting'); },
    addEventListener(type, handler) { handlers[type] = handler; },
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: async () => ({ ok: true }),
    navigator: {},
    URL,
    console: { warn: (message) => warnings.push(message), log() {}, error() {} },
  });
  vm.runInContext(SOURCE, context);
  return { context, handlers, log, warnings, caches };
}

/** Fire a lifecycle event and wait for everything it handed to waitUntil. */
async function fire(handlers, type) {
  const waits = [];
  handlers[type]({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
}

test('the inline lifecycle table is a machine the shared helper accepts, with the states sw.js documents', () => {
  const machine = lifecycleMachine();
  assert.deepEqual([...machine.states], ['parsed', 'installing', 'installed', 'activating', 'active']);
  machine.assertPath(['installing', 'installed', 'activating', 'active']);
  // A stopped, installed worker is woken in a fresh global to activate.
  machine.assertPath(['activating', 'active']);
  assert.equal(machine.start('active').done(), true, 'active is the end');
  for (const [from, to] of [['parsed', 'active'], ['installing', 'activating'], ['active', 'installing'], ['installed', 'installing'], ['activating', 'installed']]) {
    assert.equal(machine.can(from, to), false, `${from} -> ${to} must not be a transition`);
  }
});

test('lifecycleMove agrees with the helper for every pair of states: it warns exactly on refused moves, and follows the platform', () => {
  const machine = lifecycleMachine();
  const { context, warnings } = loadWorker();
  assert.equal(vm.runInContext('lifecycleState', context), 'parsed');
  for (const from of machine.states) {
    for (const to of machine.states) {
      vm.runInContext(`lifecycleState = ${JSON.stringify(from)}`, context);
      warnings.length = 0;
      const result = vm.runInContext(`lifecycleMove(${JSON.stringify(to)})`, context);
      assert.equal(result, to, `${from} -> ${to}: the worker takes the platform's move`);
      assert.equal(warnings.length, machine.can(from, to) ? 0 : 1, `${from} -> ${to}: warned iff the table refuses it`);
    }
  }
});

test('install then activate walks the table, applies the activation policy and deletes only retired caches', async () => {
  const current = [`civgraph-root-maplibre-${VERSION}-static`, `civgraph-root-maplibre-${VERSION}-runtime`];
  const retired = ['civgraph-root-maplibre-root-maplibre-sw-000000000000-static', 'civgraph-test2-x', 'civgraph-static-v1',
    'civgraph-runtime-v1', 'civgraph-fgb-v1', 'civgraph-thumb-v1', 'civgraph-tile-v1'];
  const foreign = ['someone-else', 'civgraph-render-retired'];
  const { context, handlers, log, warnings, caches } = loadWorker([current[1], ...retired, ...foreign]);
  const states = () => vm.runInContext('lifecycleState', context);

  await fire(handlers, 'install');
  assert.equal(states(), 'installed');
  assert.ok(log.includes('skipWaiting'), 'skipWaiting at install (ACTIVATION_POLICY)');
  assert.ok(!log.includes('claim'));

  await fire(handlers, 'activate');
  assert.equal(states(), 'active');
  assert.ok(log.includes('claim'), 'clients.claim at activate (ACTIVATION_POLICY)');
  assert.deepEqual(log.filter((line) => line.startsWith('delete ')).sort(), retired.map((name) => `delete ${name}`).sort());
  assert.deepEqual([...caches.names].sort(), [...current, ...foreign].sort());
  assert.deepEqual(warnings, []);
});

test('a fresh global woken only to activate takes parsed -> activating without a warning', async () => {
  const { context, handlers, warnings } = loadWorker();
  await fire(handlers, 'activate');
  assert.equal(vm.runInContext('lifecycleState', context), 'active');
  assert.deepEqual(warnings, []);
});

test('cacheVersionOf is the filter activate used before: a root or legacy prefix, not this version', () => {
  const { context } = loadWorker();
  const prefixes = vm.runInContext('LEGACY_ROOT_CACHE_PREFIXES', context);
  const all = vm.runInContext('ALL_CACHES', context);
  const names = [...all, 'civgraph-root-maplibre-old-static', 'civgraph-tile-1', 'other', 'civgraph-proni', ''];
  for (const name of names) {
    const before = prefixes.some((prefix) => name.startsWith(prefix)) && !all.includes(name);
    assert.equal(vm.runInContext(`cacheVersionOf(${JSON.stringify(name)})`, context) === 'retired', before, name);
  }
  for (const name of all) assert.equal(vm.runInContext(`cacheVersionOf(${JSON.stringify(name)})`, context), 'current');
});

test('the build can still stamp VERSION, and the cache names derive from it', () => {
  assert.match(SOURCE, /const VERSION = 'root-maplibre-sw-[^']+';/, 'scripts/build/app-bundle.mjs rewrites this line');
  const { context } = loadWorker();
  assert.deepEqual([...vm.runInContext('ALL_CACHES', context)], [`civgraph-root-maplibre-${VERSION}-static`, `civgraph-root-maplibre-${VERSION}-runtime`]);
});
