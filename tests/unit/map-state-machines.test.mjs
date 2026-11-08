// The map app's explicit state machines (refactor plan section 11), on the shared helper
// (scripts/lib/state-machine.mjs, which the app bundle inlines) and the
// map app's light helpers (packages/map/src/state-helpers.mjs). Each machine's whole table is pinned here,
// every move it does not list is shown to throw, and the map-app sources are held to moving the
// machines only through them.
//
//   node --test tests/unit/map-state-machines.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFlag, defineChoice } from '../../packages/map/src/state-helpers.mjs';
import { TIMELINE_PLAYBACK, createTimelineAnimationState } from '../../packages/map/src/app/timeline/playback.mjs';
import { URL_RESTORE, createUrlRestore, createUrlSuspend } from '../../packages/map/src/app/url-sync.mjs';
import { mapAppSourceFiles } from '../../scripts/lib/map-app-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

/** Every (from, to) pair: the listed ones work from a run started there, the rest throw. */
function assertTableEnforced(machine) {
  for (const from of machine.states) {
    for (const to of machine.states) {
      const run = machine.start(from);
      if (machine.transitions[from].includes(to)) {
        assert.equal(run.to(to), to);
      } else {
        assert.throws(() => run.to(to), /is not a transition/, `${machine.name}: ${from} -> ${to} should throw`);
        assert.equal(run.state(), from, 'a refused move leaves the state as it was');
      }
    }
  }
}

test('the map app uses the shared helper itself, with no copy of its own', () => {
  assert.equal(existsSync(path.join(ROOT, 'packages/map/src/state-machine.mjs')), false);
  for (const file of ['packages/map/src/state-helpers.mjs', 'packages/map/src/app/url-sync.mjs', 'packages/map/src/app/timeline/playback.mjs']) {
    assert.match(read(file), /from '(\.\.\/)+(packages\/)?core\/src\/state-machine\.mjs'/, file);
  }
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

test('createFlag sets, holds and releases, nesting as the code that saved and restored it did', () => {
  const flag = createFlag('suspend');
  assert.equal(flag.on, false);
  const outer = flag.hold();
  const inner = flag.hold();
  assert.equal(flag.on, true);
  flag.release(inner);
  assert.equal(flag.on, true, 'the inner release puts back the outer hold');
  flag.release(outer);
  assert.equal(flag.on, false);
  assert.equal(flag.set(false), false, 'setting the value it has is allowed');
  assert.throws(() => flag.set('yes'), TypeError);
  assert.throws(() => flag.release(undefined), TypeError);
});

test('timeline playback: the whole table', () => {
  assert.deepEqual(TIMELINE_PLAYBACK.transitions, {
    idle: ['playing', 'idle'],
    playing: ['playing', 'paused', 'ended', 'idle'],
    paused: ['playing', 'paused', 'idle'],
    ended: ['playing', 'idle']
  });
  assertTableEnforced(TIMELINE_PLAYBACK);
  // Forbidden: pausing or ending a run that is not playing.
  assert.equal(TIMELINE_PLAYBACK.can('idle', 'paused'), false);
  assert.equal(TIMELINE_PLAYBACK.can('ended', 'paused'), false);
  assert.equal(TIMELINE_PLAYBACK.can('paused', 'ended'), false);
});

test('timeline playback: the flags the app reads are views of the one state', () => {
  const animation = createTimelineAnimationState({ sequenceItems: [] });
  const flags = () => [animation.phase, animation.playing, animation.paused, animation.atEnd];
  assert.deepEqual(flags(), ['idle', false, false, false]);
  animation.to('playing');
  assert.deepEqual(flags(), ['playing', true, false, false]);
  animation.to('paused');
  assert.deepEqual(flags(), ['paused', false, true, false]);
  animation.to('playing');
  animation.to('ended');
  assert.deepEqual(flags(), ['ended', false, false, true]);
  assert.throws(() => animation.to('paused'), /is not a transition/, 'an ended run cannot be paused');
  animation.to('idle');
  assert.deepEqual(flags(), ['idle', false, false, false]);
  // The old fields keep their defaults and stay writable; the three flags do not.
  assert.equal(animation.runId, 0);
  assert.equal(animation.originalLayerId, null);
  animation.runId += 1;
  assert.equal(animation.runId, 1);
  assert.throws(() => { animation.playing = true; }, TypeError);
});

test('the map-app sources move timeline playback only through to()', () => {
  const files = mapAppSourceFiles();
  assert.ok(files.length > 10);
  for (const file of files) {
    assert.doesNotMatch(read(file), /timelineAnimation\??\.(playing|paused|atEnd)\s*=[^=]/, `${file} assigns a playback flag`);
  }
  assert.match(read('packages/map/app/app.js'), /this\.timelineAnimation = createTimelineAnimationState\(/);
});

test('URL restore: the whole table', () => {
  assert.deepEqual(URL_RESTORE.transitions, {
    idle: ['restoring', 'idle'],
    restoring: ['restoring', 'queued', 'idle'],
    queued: ['queued', 'idle']
  });
  assertTableEnforced(URL_RESTORE);
  assert.equal(URL_RESTORE.can('idle', 'queued'), false, 'a hashchange is queued only during a restore');
});

test('URL restore: a hashchange during a restore is replayed once, after it', () => {
  // The two old booleans, (restoring, pending), map onto the states one to one.
  const restore = createUrlRestore();
  assert.equal(restore.active, false);
  restore.begin();
  assert.equal(restore.active, true);
  restore.queue();
  restore.queue();
  restore.begin();
  assert.equal(restore.state(), 'queued', 'a restore begun while one is queued keeps the replay');
  assert.equal(restore.end(), true);
  assert.equal(restore.state(), 'idle');
  assert.equal(restore.end(), false, 'the later of two overlapping restores ends on idle');
  assert.throws(() => restore.queue(), /is not a transition/);
  const suspend = createUrlSuspend();
  const was = suspend.hold();
  assert.equal(suspend.on, true);
  suspend.release(was);
  assert.equal(suspend.on, false);
});

test('the map-app sources use the URL machines, not the old flags', () => {
  // url-sync.mjs names the old flags in its history note.
  const files = [...mapAppSourceFiles(), 'packages/map/app/election-manager.js'].filter((file) => !file.endsWith('/url-sync.mjs'));
  for (const file of files) {
    assert.doesNotMatch(read(file), /_restoringURLState|_hashRestorePending|_suspendURLState/, file);
  }
  const urlState = read('packages/map/src/app/url-state.js');
  assert.match(urlState, /this\.urlRestore\.begin\(\)/);
  assert.match(urlState, /this\.urlRestore\.end\(\)/);
  assert.match(urlState, /this\.urlRestore\.queue\(\)/);
});

test('election pane toggles: overlay and local level assignments go through their choice', async () => {
  const { LOCAL_MODE, OVERLAY_MODE, freshPanelState } = await import('../../packages/map/src/election/panel-model.mjs');
  assert.deepEqual(OVERLAY_MODE.values, ['circles', 'bars']);
  assert.deepEqual(LOCAL_MODE.values, ['dea', 'district', 'constituency']);
  assert.equal(freshPanelState({ bodyGroup: 'local-government' }).activeLocalMode, 'dea');
  assert.equal(freshPanelState({ bodyGroup: 'westminster' }).activeLocalMode, 'constituency');
  const manager = read('packages/map/app/election-manager.js');
  const assignments = manager.match(/this\.(overlayMode|activeLocalMode) = [^;]+;/g) || [];
  assert.ok(assignments.length >= 8, `found ${assignments.length}`);
  for (const line of assignments) assert.match(line, /= (OVERLAY_MODE|LOCAL_MODE)\.check\(/, line);
});

test('the search worker readiness is a flag, set only through set()', () => {
  assert.match(read('packages/map/app/app.js'), /this\.searchWorkerReady = createFlag\('search worker ready'\);/);
  assert.doesNotMatch(read('packages/map/src/app/search.js'), /searchWorkerReady\s*=[^=]/);
});

test('election load (MA-03) and layer load (MA-06): the whole tables', async () => {
  const { ELECTION_LOAD } = await import('../../packages/map/src/election/load-state.mjs');
  const { LAYER_LOAD } = await import('../../packages/map/src/renderer/layer-load.mjs');
  assert.deepEqual(ELECTION_LOAD.transitions, {
    closed: ['loading', 'closed'],
    loading: ['loading', 'open', 'closed'],
    open: ['loading', 'closed']
  });
  assertTableEnforced(ELECTION_LOAD);
  assert.equal(ELECTION_LOAD.can('closed', 'open'), false, 'an election opens only through a load');
  assert.deepEqual(LAYER_LOAD.transitions, { absent: ['loading'], loading: ['loaded', 'absent'], loaded: ['absent'] });
  assertTableEnforced(LAYER_LOAD);
  assert.equal(LAYER_LOAD.can('absent', 'loaded'), false, 'a layer is on the map only through a load');
  assert.equal(LAYER_LOAD.can('loading', 'loading'), false, 'a layer is never loaded twice at once');
});

test('the election and layer loads move only through their machines', () => {
  const manager = read('packages/map/app/election-manager.js');
  assert.match(manager, /if \(!options\?\.keepLoad\) this\.cancelPendingLoad\(/);
  assert.match(manager, /this\.loadRun\.to\('open'\)/);
  const renderer = read('packages/map/src/renderer/map-controller.js');
  assert.match(renderer, /if \(load\.run\.state\(\) !== 'loading'\) return;/);
  assert.match(renderer, /load\.run\.to\('absent'\)/);
});
