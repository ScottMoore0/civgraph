// The map app's explicit state machines (src/map/state-machine.mjs and the machines built on it;
// refactor plan section 11). Each machine's whole transition table is pinned here, every move it
// does not list is shown to throw, and the map-app sources are held to moving the machines only
// through send().
//
//   node --test tests/unit/map-state-machines.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  InvalidTransitionError, createFlag, createMachine, defineChoice, defineMachine
} from '../../src/map/state-machine.mjs';
import { TIMELINE_PLAYBACK, createTimelineAnimationState } from '../../src/map/app/timeline/playback.mjs';
import { URL_RESTORE, createUrlRestore, createUrlSuspend } from '../../src/map/app/url-sync.mjs';
import { mapAppSourceFiles } from '../../scripts/lib/map-app-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

/** Every (state, event) pair of a definition, as 'state --event--> target' or 'state --event--> x'. */
function tableOf(definition) {
  const rows = [];
  for (const state of definition.states) {
    for (const event of definition.events) {
      rows.push(`${state} --${event}--> ${definition.next(state, event) ?? 'x'}`);
    }
  }
  return rows;
}

/** Each listed move works from a fresh machine put in its state; each unlisted one throws. */
function assertTableEnforced(definition) {
  for (const state of definition.states) {
    for (const event of definition.events) {
      const machine = createMachine(definition, { initial: state });
      const target = definition.next(state, event);
      if (target === undefined) {
        assert.equal(machine.can(event), false, `${state} --${event}--> should be refused`);
        assert.throws(() => machine.send(event), InvalidTransitionError, `${state} --${event}--> should throw`);
        assert.equal(machine.state, state, 'a refused move leaves the state as it was');
      } else {
        assert.equal(machine.can(event), true);
        assert.equal(machine.send(event), target);
        assert.equal(machine.state, target);
      }
    }
  }
}

test('defineMachine refuses a table with unknown states or events, or unreachable states', () => {
  const base = { name: 't', initial: 'a', states: ['a', 'b'], events: ['go'] };
  assert.throws(() => defineMachine({ ...base, transitions: { a: { go: 'c' } } }), /unknown state "c"/);
  assert.throws(() => defineMachine({ ...base, transitions: { a: { jump: 'b' } } }), /unknown event "jump"/);
  assert.throws(() => defineMachine({ ...base, transitions: { a: {}, z: {} } }), /unknown state "z"/);
  assert.throws(() => defineMachine({ ...base, transitions: { a: {} } }), /unreachable state\(s\) b/);
  assert.throws(() => defineMachine({ ...base, initial: 'q', transitions: { a: { go: 'b' } } }), /initial state/);
  const ok = defineMachine({ ...base, transitions: { a: { go: 'b' }, b: { go: 'a' } } });
  assert.ok(Object.isFrozen(ok.transitions) && Object.isFrozen(ok.transitions.a));
});

test('createMachine moves along the table, reports transitions and refuses the rest', () => {
  const definition = defineMachine({
    name: 'door', initial: 'shut', states: ['shut', 'open'], events: ['open', 'shut'],
    transitions: { shut: { open: 'open' }, open: { shut: 'shut' } }
  });
  const seen = [];
  const door = createMachine(definition, { onTransition: (from, to, event) => seen.push(`${from}>${event}>${to}`) });
  assert.equal(door.state, 'shut');
  assert.ok(door.is('shut', 'open'));
  door.send('open');
  assert.deepEqual(seen, ['shut>open>open']);
  const error = assert.throws(() => door.send('open'), InvalidTransitionError);
  assert.equal(seen.length, 1, 'a refused move is not reported');
  assert.throws(() => createMachine(definition, { initial: 'ajar' }), /not a state/);
  void error;
});

test('defineChoice checks values without changing them', () => {
  const overlay = defineChoice('overlay', ['circles', 'bars']);
  assert.equal(overlay.initial, 'circles');
  assert.equal(overlay.check('bars'), 'bars');
  assert.equal(overlay.has('bars'), true);
  assert.equal(overlay.has('pies'), false);
  assert.throws(() => overlay.check('pies'), TypeError);
  assert.throws(() => overlay.check(undefined), TypeError);
  assert.throws(() => defineChoice('empty', []), /at least one/);
});

test('createFlag holds and releases, nesting as the code that saved and restored it did', () => {
  const flag = createFlag('suspend');
  assert.equal(flag.on, false);
  const outer = flag.hold();
  const inner = flag.hold();
  assert.equal(flag.on, true);
  flag.release(inner);
  assert.equal(flag.on, true, 'the inner release puts back the outer hold');
  flag.release(outer);
  assert.equal(flag.on, false);
  assert.equal(flag.set(true), false);
  assert.throws(() => flag.set('yes'), TypeError);
  assert.throws(() => flag.release(undefined), TypeError);
});

test('timeline playback: the whole table', () => {
  assert.deepEqual(tableOf(TIMELINE_PLAYBACK), [
    'idle --play--> playing', 'idle --pause--> x', 'idle --finish--> x', 'idle --stop--> idle',
    'playing --play--> playing', 'playing --pause--> paused', 'playing --finish--> ended', 'playing --stop--> idle',
    'paused --play--> playing', 'paused --pause--> paused', 'paused --finish--> x', 'paused --stop--> idle',
    'ended --play--> playing', 'ended --pause--> x', 'ended --finish--> x', 'ended --stop--> idle'
  ]);
  assertTableEnforced(TIMELINE_PLAYBACK);
});

test('timeline playback: the flags the app reads are views of the one state', () => {
  const animation = createTimelineAnimationState({ sequenceItems: [] });
  const flags = () => [animation.phase, animation.playing, animation.paused, animation.atEnd];
  assert.deepEqual(flags(), ['idle', false, false, false]);
  animation.send('play');
  assert.deepEqual(flags(), ['playing', true, false, false]);
  animation.send('pause');
  assert.deepEqual(flags(), ['paused', false, true, false]);
  animation.send('play');
  animation.send('finish');
  assert.deepEqual(flags(), ['ended', false, false, true]);
  assert.throws(() => animation.send('pause'), InvalidTransitionError, 'an ended run cannot be paused');
  animation.send('stop');
  assert.deepEqual(flags(), ['idle', false, false, false]);
  // The old fields keep their defaults and stay writable; the three flags do not.
  assert.equal(animation.runId, 0);
  assert.equal(animation.originalLayerId, null);
  animation.runId += 1;
  assert.equal(animation.runId, 1);
  assert.throws(() => { 'use strict'; animation.playing = true; }, TypeError);
});

test('the map-app sources move timeline playback only through send()', () => {
  const files = mapAppSourceFiles();
  assert.ok(files.length > 10);
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /timelineAnimation\??\.(playing|paused|atEnd)\s*=[^=]/, `${file} assigns a playback flag`);
  }
  assert.match(read('app/src/app.js'), /this\.timelineAnimation = createTimelineAnimationState\(/);
});

test('URL restore: the whole table', () => {
  assert.deepEqual(tableOf(URL_RESTORE), [
    'idle --begin--> restoring', 'idle --queue--> x', 'idle --end--> idle',
    'restoring --begin--> restoring', 'restoring --queue--> queued', 'restoring --end--> idle',
    'queued --begin--> queued', 'queued --queue--> queued', 'queued --end--> idle'
  ]);
  assertTableEnforced(URL_RESTORE);
});

test('URL restore: a hashchange during a restore is replayed once, after it', () => {
  // The two old booleans, (restoring, pending), map onto the states one to one.
  const restore = createUrlRestore();
  restore.send('begin');
  restore.send('queue');
  restore.send('queue');
  assert.equal(restore.state, 'queued');
  const replay = restore.is('queued');
  restore.send('end');
  assert.equal(replay, true);
  assert.equal(restore.state, 'idle');
  const suspend = createUrlSuspend();
  const was = suspend.hold();
  assert.equal(suspend.on, true);
  suspend.release(was);
  assert.equal(suspend.on, false);
});

test('the map-app sources use the URL machines, not the old flags', () => {
  // url-sync.mjs names the old flags in its history note.
  const files = [...mapAppSourceFiles(), 'app/src/election-manager.js'].filter((file) => !file.endsWith('/url-sync.mjs'));
  for (const file of files) {
    assert.doesNotMatch(read(file), /_restoringURLState|_hashRestorePending|_suspendURLState/, file);
  }
  const urlState = read('src/map/app/url-state.js');
  assert.match(urlState, /this\.urlRestore\.send\('begin'\)/);
  assert.match(urlState, /this\.urlRestore\.send\('end'\)/);
  assert.match(urlState, /this\.urlRestore\.send\('queue'\)/);
});

test('election pane toggles: overlay and local level assignments go through their choice', async () => {
  const { LOCAL_MODE, OVERLAY_MODE, freshPanelState } = await import('../../src/map/election/panel-model.mjs');
  assert.deepEqual(OVERLAY_MODE.values, ['circles', 'bars']);
  assert.deepEqual(LOCAL_MODE.values, ['dea', 'district', 'constituency']);
  assert.equal(freshPanelState({ bodyGroup: 'local-government' }).activeLocalMode, 'dea');
  assert.equal(freshPanelState({ bodyGroup: 'westminster' }).activeLocalMode, 'constituency');
  const manager = read('app/src/election-manager.js');
  const assignments = manager.match(/this\.(overlayMode|activeLocalMode) = [^;]+;/g) || [];
  assert.ok(assignments.length >= 8, `found ${assignments.length}`);
  for (const line of assignments) assert.match(line, /= (OVERLAY_MODE|LOCAL_MODE)\.check\(/, line);
});
