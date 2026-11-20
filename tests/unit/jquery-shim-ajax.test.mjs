// The jQuery shim's $.ajax (packages/map/src/jquery-shim.js; stages2.js makes one synchronous call
// and chains .fail onto it). The call has settled before .fail is chained, so .fail runs its handler
// at once when the call failed and never when it succeeded. Until 20 Nov 2026 (stream w20-refactor2)
// .fail never stored its handler and ran it whenever no data was preloaded: a fallback that loaded
// the election still showed "No election found", and a fallback that failed never passed its XHR.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync('packages/map/src/jquery-shim.js', 'utf8');

/**
 * The shim in a fake page whose synchronous XHR answers as `answer` says.
 * @param {{ status?: number, body?: string, throws?: Error }} answer
 */
function loadShim(answer) {
  /** @type {string[]} */
  const requested = [];
  class FakeXhr {
    status = 0;
    statusText = '';
    responseText = '';
    /** @param {string} _method @param {string} url @param {boolean} async */
    open(_method, url, async) { assert.equal(async, false, 'the fallback is synchronous'); requested.push(url); }
    send() {
      if (answer.throws) throw answer.throws;
      this.status = answer.status ?? 200;
      this.statusText = this.status === 200 ? 'OK' : 'Not Found';
      this.responseText = answer.body ?? '';
    }
  }
  class Node {}
  const context = vm.createContext({
    Node,
    XMLHttpRequest: FakeXhr,
    console: { warn() {}, error() {}, log() {} },
    document: { createElement: () => ({ content: { childNodes: [] } }) },
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance: { now: () => 0 }, getComputedStyle: () => ({}),
  });
  vm.runInContext(SOURCE, context);
  return { $: context.jQuery, requested };
}

/** Run stages2.js's call shape; returns what reached success and fail. @param {any} $ */
function call($, url = '/data/election.json') {
  /** @type {unknown[]} */
  const succeeded = [];
  /** @type {Array<{ status: number, statusText: string }>} */
  const failed = [];
  $.ajax({ async: false, url, success: (/** @type {unknown} */ data) => succeeded.push(data) })
    .fail((/** @type {{ status: number, statusText: string }} */ e) => failed.push({ status: e.status, statusText: e.statusText }));
  return { succeeded, failed };
}

test('preloaded data: success, no request, no failure', () => {
  const { $, requested } = loadShim({ status: 500 });
  $.preloadElectionData({ id: 'pre' });
  assert.deepEqual(JSON.parse(JSON.stringify(call($))), { succeeded: [{ id: 'pre' }], failed: [] });
  assert.deepEqual(requested, []);
});

test('the fallback loads the election: success, and .fail does not run', () => {
  const { $, requested } = loadShim({ status: 200, body: '{"id":"fetched"}' });
  const { succeeded, failed } = call($);
  assert.deepEqual(JSON.parse(JSON.stringify(succeeded)), [{ id: 'fetched' }]);
  assert.deepEqual(failed, [], 'a loaded election must not reach the failure handler');
  assert.deepEqual(requested, ['/data/election.json']);
});

test('the fallback answers with an error status: .fail gets the XHR', () => {
  const { $ } = loadShim({ status: 404 });
  assert.deepEqual(JSON.parse(JSON.stringify(call($))), { succeeded: [], failed: [{ status: 404, statusText: 'Not Found' }] });
});

test('the fallback throws, or answers with bad JSON: .fail runs with the reason', () => {
  const thrown = call(loadShim({ throws: new Error('network down') }).$);
  assert.deepEqual(thrown.failed, [{ status: 0, statusText: 'network down' }]);
  const badJson = call(loadShim({ status: 200, body: '{not json' }).$);
  assert.equal(badJson.succeeded.length, 0);
  assert.equal(badJson.failed.length, 1);
  assert.equal(badJson.failed[0]?.status, 200);
});

test('no preloaded data and no URL: .fail runs, as before', () => {
  const { $ } = loadShim({});
  /** @type {unknown[]} */
  const failed = [];
  $.ajax({}).fail((/** @type {{ status: number, statusText: string }} */ e) => failed.push({ status: e.status, statusText: e.statusText }));
  assert.deepEqual(failed, [{ status: 0, statusText: 'No pre-loaded data' }]);
});

test('.fail chains, and tolerates no handler', () => {
  const { $ } = loadShim({ status: 404 });
  const result = $.ajax({ url: '/x' });
  assert.equal(result.fail(undefined), result);
});

test('the site copy is the source, as the app build writes it (trailing whitespace trimmed)', () => {
  assert.equal(readFileSync('site/app/js/jquery-shim.js', 'utf8'), SOURCE.replace(/[ \t]+$/gm, ''));
});
