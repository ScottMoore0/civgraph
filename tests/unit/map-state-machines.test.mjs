// The map app's explicit state machines (refactor plan section 11), on the shared helper
// (src/map/state-machine.mjs, a copy of scripts/lib/state-machine.mjs until that lands) and the
// map app's light helpers (src/map/state-helpers.mjs). Each machine's whole table is pinned here,
// every move it does not list is shown to throw, and the map-app sources are held to moving the
// machines only through them.
//
//   node --test tests/unit/map-state-machines.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFlag, defineChoice } from '../../src/map/state-helpers.mjs';
import { TIMELINE_PLAYBACK, createTimelineAnimationState } from '../../src/map/app/timeline/playback.mjs';
import { URL_RESTORE, createUrlRestore, createUrlSuspend } from '../../src/map/app/url-sync.mjs';
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

test('the map app\'s copy of the shared helper is the one in scripts/lib, once that is on this branch', () => {
  const shared = path.join(ROOT, 'scripts/lib/state-machine.mjs');
  if (!existsSync(shared)) return;
  assert.equal(read('src/map/state-machine.mjs'), readFileSync(shared, 'utf8'), 'src/map/state-machine.mjs differs from scripts/lib/state-machine.mjs');
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
  assert.match(read('app/src/app.js'), /this\.timelineAnimation = createTimelineAnimationState\(/);
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
  const files = [...mapAppSourceFiles(), 'app/src/election-manager.js'].filter((file) => !file.endsWith('/url-sync.mjs'));
  for (const file of files) {
    assert.doesNotMatch(read(file), /_restoringURLState|_hashRestorePending|_suspendURLState/, file);
  }
  const urlState = read('src/map/app/url-state.js');
  assert.match(urlState, /this\.urlRestore\.begin\(\)/);
  assert.match(urlState, /this\.urlRestore\.end\(\)/);
  assert.match(urlState, /this\.urlRestore\.queue\(\)/);
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

test('the search worker readiness is a flag, set only through set()', () => {
  assert.match(read('app/src/app.js'), /this\.searchWorkerReady = createFlag\('search worker ready'\);/);
  assert.doesNotMatch(read('src/map/app/search.js'), /searchWorkerReady\s*=[^=]/);
});
