// The jQuery shim's animation-queue flag (state-machine catalogue MA-L). packages/map/src/jquery-shim.js is a
// classic script (copied to app/js/ by the app build and loaded beside stages2.js), so it cannot
// import packages/map/src/state-helpers.mjs: its table, QUEUE_RUNNING_TRANSITIONS, is inline. This test
// checks the table against the helper's createFlag for every pair, that both copies agree, and
// drives the queue in a fake page: delay starts it, the last entry ends it, stop(true) clears it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createFlag } from '../../packages/map/src/state-helpers.mjs';

const SOURCE = readFileSync('packages/map/src/jquery-shim.js', 'utf8');
const COPY = readFileSync('site/app/js/jquery-shim.js', 'utf8');
const TABLE = /const QUEUE_RUNNING_TRANSITIONS = (\{[^\n]*\});/;

test('the inline table is the shared flag table, in both copies', () => {
  const literal = SOURCE.match(TABLE)?.[1];
  assert.ok(literal, 'QUEUE_RUNNING_TRANSITIONS not found in packages/map/src/jquery-shim.js');
  assert.equal(COPY.match(TABLE)?.[1], literal, 'site/app/js/jquery-shim.js has a different table');
  const table = vm.runInNewContext(`(${literal})`);
  const flag = createFlag('queue running');
  assert.deepEqual(Object.keys(table).sort(), [...flag.machine.states].sort());
  for (const from of flag.machine.states) {
    for (const to of flag.machine.states) {
      assert.equal(table[from].includes(to), flag.machine.can(from, to), `${from} -> ${to}`);
    }
  }
});

test('every write of the flag goes through the checked setter', () => {
  for (const [name, text] of [['src', SOURCE], ['app/js', COPY]]) {
    const writes = text.match(/_shimQueueRunning = /g) || [];
    assert.equal(writes.length, 1, `${name}/jquery-shim.js writes _shimQueueRunning outside _setQueueRunning`);
    assert.match(text, /function _setQueueRunning\(el, running\) \{\n\s+if \(typeof running !== 'boolean'\)/);
  }
});

/** Evaluate the shim in a fake page with hand-run timers; returns its $ and the timers. */
function loadShim() {
  const timers = [];
  class Node {}
  const context = vm.createContext({
    Node,
    document: { createElement: () => ({ content: { childNodes: [] } }) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    performance: { now: () => 0 },
    getComputedStyle: () => ({}),
  });
  vm.runInContext(SOURCE, context);
  const element = Object.assign(new Node(), { style: {}, offsetHeight: 0 });
  return { $: context.jQuery, timers, element };
}

test('the queue flag follows the queue', () => {
  const { $, timers, element } = loadShim();
  assert.equal(element._shimQueueRunning, undefined, 'unset before any queue (reads as off)');
  $(element).delay(10);
  assert.equal(element._shimQueueRunning, true, 'a delay starts the queue');
  $(element).delay(5);
  assert.equal(element._shimAnimQueue.length, 2, 'a second delay waits behind the first');
  timers.shift()();
  assert.equal(element._shimQueueRunning, true, 'still running with an entry left');
  timers.shift()();
  assert.equal(element._shimQueueRunning, false, 'the last entry ends it');
  $(element).delay(10);
  $(element).stop(true);
  assert.equal(element._shimQueueRunning, false, 'stop(true) clears it');
  assert.deepEqual(element._shimAnimQueue.length, 0);
});
