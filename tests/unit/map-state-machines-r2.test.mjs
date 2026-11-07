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
