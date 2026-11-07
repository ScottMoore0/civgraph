// The map app's sweep of the retired apps' service workers (src/map/app/retire-legacy-workers.mjs).
//
//   node --test tests/unit/retire-legacy-workers.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RETIRED_WORKER_SCOPES, retireLegacyServiceWorkers } from '../../src/map/app/retire-legacy-workers.mjs';

function registration(scope, { updateFails = false } = {}) {
  const calls = [];
  return {
    scope: `https://civgraph.net${scope}`,
    calls,
    async update() { calls.push('update'); if (updateFails) throw new TypeError('offline'); return this; },
    async unregister() { calls.push('unregister'); return true; }
  };
}

test('it updates each legacy registration, so the kill switch installs, and leaves the root worker alone', async () => {
  const root = registration('/');
  const render = registration('/render/');
  const test2 = registration('/test2/');
  const old = registration('/test/');
  const retired = await retireLegacyServiceWorkers({ async getRegistrations() { return [root, render, test2, old]; } });
  assert.deepEqual(retired, ['/render/', '/test/', '/test2/']);
  assert.deepEqual(root.calls, []);
  for (const reg of [render, test2, old]) assert.deepEqual(reg.calls, ['update']);
});

test('a registration whose update fails is unregistered directly', async () => {
  const render = registration('/render/', { updateFails: true });
  await retireLegacyServiceWorkers({ async getRegistrations() { return [render]; } });
  assert.deepEqual(render.calls, ['update', 'unregister']);
});

test('it never throws: no service worker API, or one that rejects', async () => {
  assert.deepEqual(await retireLegacyServiceWorkers(undefined), []);
  assert.deepEqual(await retireLegacyServiceWorkers({ async getRegistrations() { throw new Error('denied'); } }), []);
});

test('the scopes are the ones the kill switch is served for', () => {
  const redirects = readFileSync('_redirects', 'utf8');
  assert.match(redirects, /^\/test\/sw\.js\s+\/render\/sw\.js\s+200$/m);
  for (const scope of RETIRED_WORKER_SCOPES.filter((s) => s !== '/test/')) {
    assert.equal(readFileSync(`${scope.slice(1)}sw.js`, 'utf8'), readFileSync('render/sw.js', 'utf8'), scope);
  }
});
