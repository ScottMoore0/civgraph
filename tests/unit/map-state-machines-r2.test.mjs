// The map app's explicit state machines, round 2 (refactor plan section 11; state-machine
// catalogue MA-02 to MA-14 and the MA-L latches). Each machine's whole table is pinned, every
// move it does not list is shown to throw, and the sources are held to moving it only through
// its module. Round 1's machines are in map-state-machines.test.mjs.
//
//   node --test tests/unit/map-state-machines-r2.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFlag, createState } from '../../src/map/state-helpers.mjs';
import { HASH_LISTEN, NAVIGATION_PUSH, createHashListen, createNavigationPush } from '../../src/map/app/url-sync.mjs';
import { mapAppSourceFiles } from '../../scripts/lib/map-app-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

/** Every (from, to) pair: the listed ones work from a holder started there, the rest throw. */
function assertTableEnforced(machine) {
  for (const from of machine.states) {
    for (const to of machine.states) {
      const holder = createState(machine, from);
      if (machine.transitions[from].includes(to)) {
        assert.equal(holder.to(to), to);
      } else {
        assert.throws(() => holder.to(to), /is not a transition/, `${machine.name}: ${from} -> ${to} should throw`);
        assert.equal(holder.state(), from, 'a refused move leaves the state as it was');
      }
    }
  }
}

test('createState keeps the state without a history, and flags no longer grow one', () => {
  const holder = createState(HASH_LISTEN);
  assert.equal(holder.state(), 'listening');
  assert.equal(holder.can('ignoring'), true);
  for (let i = 0; i < 1000; i += 1) holder.to(i % 2 ? 'listening' : 'ignoring');
  assert.equal('history' in holder, false);
  assert.throws(() => createState(HASH_LISTEN, /** @type {any} */ ('nowhere')), /is not a state/);
  const flag = createFlag('test flag');
  for (let i = 0; i < 1000; i += 1) flag.set(Boolean(i % 2));
  assert.equal(flag.on, true);
});

test('MA-02 navigation push: the table, and the label taken once by the write', () => {
  assert.deepEqual(NAVIGATION_PUSH.transitions, { none: ['pending', 'none'], pending: ['pending', 'none'] });
  assertTableEnforced(NAVIGATION_PUSH);
  const push = createNavigationPush();
  assert.equal(push.pending, false);
  push.clear();
  push.begin('Added Dáil 2020');
  push.begin('Opened Dáil 2024');
  assert.equal(push.label, 'Opened Dáil 2024');
  assert.equal(push.take(), 'Opened Dáil 2024');
  assert.equal(push.pending, false);
  assert.equal(push.label, null);
});

test('MA-02 hash listen: holds nest, and a stray release stays listening', () => {
  assert.deepEqual(HASH_LISTEN.transitions, { listening: ['ignoring', 'listening'], ignoring: ['ignoring', 'listening'] });
  assertTableEnforced(HASH_LISTEN);
  const listen = createHashListen();
  listen.release();
  assert.equal(listen.ignoring, false);
  listen.hold();
  listen.hold();
  listen.release();
  assert.equal(listen.ignoring, true, 'one hold still out');
  listen.release();
  assert.equal(listen.ignoring, false);
  assert.equal(listen.holds, 0);
});

test('MA-02: the sources use the push and listen machines, not the old fields', () => {
  for (const file of [...mapAppSourceFiles(), 'app/src/election-manager.js'].filter((f) => !f.endsWith('/url-sync.mjs'))) {
    assert.doesNotMatch(read(file), /_pushNextURL|_ignoreHashChanges/, file);
  }
  const urlState = read('src/map/app/url-state.js');
  assert.match(urlState, /this\.navigationPush\.begin\(/);
  assert.match(urlState, /this\.navigationPush\.take\(\)/);
  assert.match(urlState, /this\.hashListen\.hold\(\)/);
  assert.match(urlState, /this\.hashListen\.release\(\)/);
});

test('MA-04 entity page: the table, the fields it writes, and the manager writing only through it', async () => {
  const { ENTITY_PAGE, PANEL_VIEWS, entityPageFields } = await import('../../src/map/election/panel-model.mjs');
  assert.deepEqual(ENTITY_PAGE.transitions, { closed: ['closed', 'open'], open: ['open', 'closed'] });
  assertTableEnforced(ENTITY_PAGE);
  assert.ok(PANEL_VIEWS.includes('results') && PANEL_VIEWS.includes('counts'));
  const page = createState(ENTITY_PAGE);
  assert.deepEqual(entityPageFields(page, { kind: 'party', key: 'sf' }, 'party'), { activeEntityKind: 'party', activeEntityKey: 'sf', activeEntityReturnView: 'party' });
  assert.equal(page.state(), 'open');
  assert.deepEqual(entityPageFields(page, null), { activeEntityKind: null, activeEntityKey: null }, 'the return view is kept when not given');
  assert.equal(page.state(), 'closed');
  const manager = read('app/src/election-manager.js');
  assert.doesNotMatch(manager, /this\.activeEntity(Kind|Key) = /, 'kind and key are written only through setEntityPage');
  assert.match(manager, /set countDetailedView\(value\) \{ this\.countDetail\.set\(value\); \}/);
});

test('MA-05 NI grouped view: the table, active as a view of it, and the view moving only through it', async () => {
  const { NI_LOCAL_VIEW, niLocalViewActive } = await import('../../src/map/election/ni-local-state.mjs');
  assert.deepEqual(NI_LOCAL_VIEW.transitions, {
    inactive: ['opening', 'inactive', 'active'],
    opening: ['opening', 'active', 'inactive'],
    active: ['switching', 'inactive', 'active'],
    switching: ['switching', 'active', 'inactive']
  });
  assertTableEnforced(NI_LOCAL_VIEW);
  assert.equal(NI_LOCAL_VIEW.can('inactive', 'switching'), false, 'a level is switched only on an open view');
  assert.equal(NI_LOCAL_VIEW.can('opening', 'switching'), false);
  assert.equal(NI_LOCAL_VIEW.can('active', 'opening'), false, 'open() always follows a teardown');
  assert.deepEqual(NI_LOCAL_VIEW.states.filter(niLocalViewActive), ['active', 'switching']);
  const view = read('app/src/ni-local-view.js');
  assert.doesNotMatch(view, /this\.active = /);
  assert.match(view, /get active\(\) \{ return niLocalViewActive\(this\.viewState\.state\(\)\); \}/);
  for (const move of ['opening', 'active', 'inactive', 'switching']) assert.ok(view.includes(`this.viewState.to('${move}')`), move);
});

test('MA-07 to MA-10: the catalogue pane machines and choices', async () => {
  const m = await import('../../src/ui-state-machines.mjs');
  assert.deepEqual([...m.SPLIT_LAYOUT.values].sort(), ['balanced', 'info-75', 'info-full', 'map-75', 'map-full']);
  assert.equal(m.SPLIT_LAYOUT.initial, 'balanced');
  assert.deepEqual(m.SPLIT_ALLOWED.mobile, ['map-full', 'info-full']);
  for (const id of [...m.SPLIT_ALLOWED.desktop, ...m.SPLIT_ALLOWED.mobile]) assert.ok(m.SPLIT_LAYOUT.has(id), id);
  assert.throws(() => m.SPLIT_LAYOUT.check('map-50'), /is not one of/);
  assert.throws(() => m.CATALOGUE_VIEW.check('book'), /is not one of/);
  assert.deepEqual(m.MOBILE_CATALOGUE.transitions, { eager: ['deferred', 'released'], deferred: ['deferred', 'released'], released: ['released', 'deferred'] });
  assertTableEnforced(m.MOBILE_CATALOGUE);
  assert.deepEqual(m.ENTITY_PAGE_LOAD.transitions, { loading: ['loaded', 'choice', 'error', 'missing'], loaded: [], choice: [], error: [], missing: [] });
  assertTableEnforced(m.ENTITY_PAGE_LOAD);
  assert.deepEqual([...m.ENTITY_PLACEHOLDER.values], m.ENTITY_PAGE_LOAD.states.filter((s) => s !== 'loaded'));
});

test('MA-07 to MA-10: the sources write the pane state only through them', async () => {
  const { CATALOGUE_HISTORY_ENTRY, SPLIT_ALLOWED } = await import('../../src/ui-state-machines.mjs');
  const ui = read('src/ui-controller.js');
  // The desktop order is the order splitStates lists the layouts in.
  const listed = [...ui.matchAll(/\{ id: '([a-z0-9-]+)', label: '[^']+'(?:, mobileLabel: '[^']+')? \}/g)].map((x) => x[1]);
  assert.deepEqual(listed, SPLIT_ALLOWED.desktop);
  assert.match(ui, /set currentStateId\(value\) \{ this\._splitLayout = SPLIT_LAYOUT\.check\(value\); \}/);
  assert.match(ui, /set catalogueView\(value\) \{ this\._catalogueViewValue = CATALOGUE_VIEW\.check\(value\); \}/);
  assert.doesNotMatch(ui, /_mobileCatalogueDeferred/);
  assert.match(ui, /this\.mobileCatalogue\.to\('deferred'\)/);
  assert.match(ui, /this\.mobileCatalogue\.to\('released'\)/);
  for (const [, type] of ui.matchAll(/_pushCatalogueHistoryEntry\(\{ type: '([a-z-]+)'/g)) assert.ok(CATALOGUE_HISTORY_ENTRY.has(type), type);
  assert.match(ui, /CATALOGUE_HISTORY_ENTRY\.check\(entry\.type\);/);
  assert.match(ui, /const state = ENTITY_PLACEHOLDER\.check\(/);
  const bridge = read('src/map/app/entity-bridge.js');
  assert.match(bridge, /state: load\.to\(detail \? 'choice' : \(failure \? 'error' : 'missing'\)\)/);
  assert.match(bridge, /load\.to\('loaded'\);/);
});

test('MA-11 direct gesture: the table, and directGestureActive a view of it', async () => {
  const { DIRECT_GESTURE } = await import('../../src/map/renderer/gesture-state.mjs');
  const all = ['idle', 'pan', 'pinch', 'wheel'];
  assert.deepEqual(DIRECT_GESTURE.transitions, { idle: all, pan: all, pinch: all, wheel: all });
  assertTableEnforced(DIRECT_GESTURE);
  const renderer = read('src/map/renderer/map-controller.js');
  assert.doesNotMatch(renderer, /this\.directGestureActive = /);
  assert.match(renderer, /return this\.directGesture\.state\(\) !== 'idle';/);
  const moves = [...renderer.matchAll(/this\.directGesture\.to\('([a-z]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(moves, ['pan', 'pan', 'idle', 'idle', 'wheel', 'wheel', 'pinch', 'pinch', 'idle']);
});

test('MA-12 point-cloud tile: the table, and every write through moveNode', async () => {
  const { POINT_CLOUD_NODE, moveNode } = await import('../../src/map/renderer/point-cloud-node-state.mjs');
  assert.deepEqual(POINT_CLOUD_NODE.transitions, { unloaded: ['queued'], queued: ['loading', 'unloaded'], loading: ['loaded', 'unloaded'], loaded: ['unloaded'] });
  assertTableEnforced(POINT_CLOUD_NODE);
  const node = { state: 'unloaded' };
  moveNode(node, 'queued');
  moveNode(node, 'loading');
  assert.throws(() => moveNode(node, 'queued'), /is not a transition/, 'a tile in flight is not queued again');
  moveNode(node, 'loaded');
  assert.equal(node.state, 'loaded');
  const layer = read('src/map/renderer/point-cloud-stream-layer.js');
  assert.doesNotMatch(layer, /node\.state = /);
  assert.equal([...layer.matchAll(/moveNode\(node, '/g)].length, 6);
});

test('MA-13 /maps tab and route kinds', async () => {
  const { CATALOGUE_TAB, ROUTE_KINDS, routeKind } = await import('../../src/catalogue/route-state.mjs');
  assert.deepEqual([...CATALOGUE_TAB.values], ['maps', 'elections', 'books']);
  for (const tab of Object.values(ROUTE_KINDS)) assert.ok(CATALOGUE_TAB.has(tab));
  assert.equal(routeKind('series/os-6inch/os-1'), 'series');
  assert.equal(routeKind('elections/person/p123'), 'elections-person');
  assert.equal(routeKind('elections/dail'), 'elections');
  assert.equal(routeKind('here/-6.1/54.6'), 'here');
  assert.equal(routeKind('boundaries'), 'section');
  const index = read('src/catalogue/index.js');
  assert.match(index, /set tab\(value\) \{ this\._tab = CATALOGUE_TAB\.check\(value\); \}/);
  for (const [, tab] of index.matchAll(/this\.tab = '([a-z]+)'/g)) assert.ok(CATALOGUE_TAB.has(tab), tab);
});

test('MA-14 service worker registration and legacy retirement', async () => {
  const { LEGACY_RETIREMENT, SW_REGISTRATION } = await import('../../src/map/app/service-worker-state.mjs');
  assert.deepEqual(SW_REGISTRATION.transitions, { idle: ['unavailable', 'registering'], registering: ['ready', 'failed'], ready: [], failed: [], unavailable: [] });
  assertTableEnforced(SW_REGISTRATION);
  assert.deepEqual(LEGACY_RETIREMENT.transitions, { pending: ['updated', 'unregistered'], updated: [], unregistered: [] });
  assertTableEnforced(LEGACY_RETIREMENT);
  const perf = read('src/map/app/performance.js');
  for (const move of ['unavailable', 'registering', 'ready', 'failed']) assert.ok(perf.includes(`registrationState.to('${move}')`), move);
});

test('MA-L: latches, flags and hold counts', async () => {
  const { createHoldCount, createLatch, defineFlagFields } = await import('../../src/map/state-helpers.mjs');
  const latch = createLatch('installed');
  latch.set(false);
  latch.set(true);
  latch.set(true);
  assert.throws(() => latch.set(false), /is not a transition/, 'an installed guard is never cleared');
  const target = { other: 1 };
  defineFlagFields(target, ['pending']);
  defineFlagFields(target, ['bound'], { latch: true });
  assert.equal(target.pending, false);
  target.pending = true;
  target.pending = false;
  assert.throws(() => { target.pending = 'yes'; }, /expected a boolean/);
  target.bound = true;
  assert.throws(() => { target.bound = false; }, /is not a transition/);
  assert.deepEqual(Object.keys(target), ['other', 'pending', 'bound']);
  const apply = createHoldCount('apply');
  apply.hold();
  apply.hold();
  assert.equal(apply.release(), false);
  assert.equal(apply.active, true);
  assert.equal(apply.release(), true);
  assert.equal(apply.release(), true, 'a stray release stays idle');
  assert.equal(apply.depth, 0);
  // Each converted field is declared through the helper.
  const expect = {
    'src/map/renderer/map-controller.js': ['directPanGestureInstalled', 'directWheelFallbackActive', 'autoTilted', 'documentHoverClearInstalled'],
    'app/src/election-manager.js': ['overlayRefreshPending', 'seatCirclePositionUpdatePending', 'voteBarClickBound', 'recallLabelClickBound'],
    'app/src/app.js': ['electionCatalogueWarmScheduled', 'featuresHereKeepOpen'],
    'src/catalogue/index.js': ['drawn', 'picking', 'electionsFirst', 'langNotice', 'placesReady'],
    'src/feature-loader.js': ['initialized'],
    'src/election-trend-chart.mjs': ['pinned']
  };
  for (const [file, names] of Object.entries(expect)) {
    const source = read(file);
    for (const name of names) {
      assert.match(source, new RegExp(String.raw`defineFlagFields\([a-z]+, \[[^\]]*'${name}'`), `${file}: ${name}`);
    }
  }
  assert.doesNotMatch(read('src/map/app/timeline/controls.js'), /timelineApplyDepth/);
});
