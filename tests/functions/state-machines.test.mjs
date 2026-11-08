/**
 * The Functions' state machines (REFACTOR-PLAN.md section 11; the catalogue's stream 2):
 *
 *   FN-04 the contribution queue's statuses (functions/_lib/contribution-status.js)
 *   FN-02 where a records answer comes from (ANSWER_LADDER in functions/_api/_records.js)
 *   FN-01 a request's slot at the rebuild gate (GATE_SLOT, the same file)
 *   FN-03 the dataset state as the Functions read it (functions/_lib/dataset-state.js)
 *   FN-L  the modes: record-page SSR, a layer's feature-id mode, the layer views, a version's status
 *
 * The tables are plain data so a Function can use them; here each is built into a machine with
 * the shared helper (scripts/lib/state-machine.mjs), which refuses a table naming an unknown
 * state, and every move the table does not list is shown to be refused where it is guarded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../packages/config/src/node.mjs';
import { defineMachine } from '../../scripts/lib/state-machine.mjs';
import { canMarkApplied } from '../../scripts/intake/contributions.mjs';
import {
  CONTRIBUTION_TRANSITIONS, DECISIONS, INITIAL_STATUS, canDecide, isContributionStatus,
} from '../../packages/api/src/contribution-status.js';
import { onRequestPost as decidePost } from '../../packages/api/src/handlers/contributions/decide.js';
import {
  ANSWER_LADDER, GATE_SLOT, answerLadder, cachedJson, gateState, resetDatasetMemo, slotTo,
} from '../../packages/api/src/handlers/_records.js';
import { DATASET_PHASES, STORE, phaseOf, readDataset } from '../../packages/api/src/dataset-state.js';
import { datasetVersion } from '../../packages/api/src/respond.js';
import { SSR_MODES, ssrMode, ssrModeName } from '../../packages/ui/src/templates/records/index.js';
import { FEATURE_ID_MODES } from '../../packages/core/src/layer-index.js';
import { LAYER_VIEWS } from '../../packages/api/src/handlers/layers/[[path]].js';
import { VERSION_STATUSES, versionStatus } from '../../packages/api/src/v1/delegate.js';
import { V1 } from '../../packages/api/src/v1/v1.js';
import { installCaches } from '../records/d1-shim.mjs';

/** Every (from, to) pair the table does NOT list. */
function forbidden(table) {
  const states = Object.keys(table);
  return states.flatMap((from) => states.filter((to) => !table[from].includes(to)).map((to) => [from, to]));
}

/** Every state reachable from `initial`. */
function reachable(table, initial) {
  const seen = new Set([initial]);
  const queue = [initial];
  while (queue.length) for (const next of table[queue.shift()]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
}

// ------------------------------------------------------------------ FN-04 contribution queue

test('FN-04: the contribution table is a machine; applied is terminal and reached from approved only', () => {
  const m = defineMachine({ name: 'contribution status', initial: INITIAL_STATUS, transitions: CONTRIBUTION_TRANSITIONS });
  assert.deepEqual([...m.states].sort(), ['applied', 'approved', 'pending-review', 'rejected']);
  assert.deepEqual([...reachable(CONTRIBUTION_TRANSITIONS, INITIAL_STATUS)].sort(), [...m.states].sort());
  m.assertPath(['approved', 'applied']);
  m.assertPath(['rejected']);
  assert.ok(m.start('applied').done(), 'applied is terminal');
  for (const s of m.states) {
    // the local --mark-applied guard (scripts/intake/contributions.mjs) agrees with the table
    assert.equal(m.can(s, 'applied'), canMarkApplied(s).ok, `${s} -> applied`);
    assert.equal(m.can(s, 'pending-review'), false, `nothing returns to pending-review (${s})`);
  }
  for (const [from, to] of forbidden(CONTRIBUTION_TRANSITIONS)) assert.throws(() => m.assertTransition(from, to), /is not a transition/);
});

test('FN-04: canDecide() allows only the table\'s moves for each decision', () => {
  assert.deepEqual([...DECISIONS], ['approved', 'rejected']);
  for (const status of Object.keys(CONTRIBUTION_TRANSITIONS)) {
    for (const decision of DECISIONS) {
      assert.equal(canDecide(status, decision).ok, CONTRIBUTION_TRANSITIONS[status].includes(decision), `${status} + ${decision}`);
    }
  }
  assert.equal(canDecide(undefined, 'approved').ok, true, 'a record with no status is pending-review');
  assert.equal(canDecide('applied', 'rejected').ok, false);
  assert.match(canDecide('applied', 'approved').reason, /already applied/);
  assert.equal(canDecide('archived', 'approved').ok, false, 'an unknown status is refused');
  assert.equal(isContributionStatus('applied'), true);
  assert.equal(isContributionStatus('toString'), false);
});

test('FN-04: the decide endpoint decides a pending submission once, and refuses any later decision (409)', async () => {
  const store = new Map();
  const queue = {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { store.set(key, value); },
  };
  const key = 'submissions/2026-11-07/sub_abc.json';
  const env = { CIVGRAPH_CONTRIBUTION_QUEUE: queue, CIVGRAPH_ADMINS: 'owner@example.test', CIVGRAPH_CONTRIBUTORS: 'owner@example.test', CIVGRAPH_TEST_TRUST_EMAIL_HEADER: 'true' };
  const decide = async (decision) => {
    const headers = new Map([['cf-access-authenticated-user-email', 'owner@example.test'], ['content-type', 'application/json']]);
    const res = await decidePost({
      request: { method: 'POST', url: 'https://civgraph.net/_api/contributions/decide', headers: { get: (n) => headers.get(String(n).toLowerCase()) ?? null }, json: async () => ({ key, decision }) },
      env,
    });
    return { status: res.status, body: await res.json(), stored: JSON.parse(store.get(key)) };
  };
  for (const [first, settled] of [['approved', 'approved'], ['rejected', 'rejected'], ['approved', 'applied']]) {
    store.set(key, JSON.stringify({ id: 'sub_abc', kind: 'metadata-edit', status: 'pending-review' }));
    const decided = await decide(first);
    assert.equal(decided.status, 200);
    assert.equal(decided.stored.status, first);
    assert.equal(decided.stored.decisions.length, 1, 'the decision is logged');
    store.set(key, JSON.stringify({ ...decided.stored, status: settled }));
    for (const decision of DECISIONS) {
      const res = await decide(decision);
      assert.equal(res.status, 409, `${settled} + ${decision}`);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.status, settled);
      assert.equal(res.stored.status, settled, 'the stored submission is untouched');
      assert.equal(res.stored.decisions.length, 1);
    }
  }
});

// functions/_lib/contribution-status.js mirrors the registry rather than importing it: a Function
// importing data/registries/statuses.json and registries/status-machines.mjs would put a JSON
// import and scripts/lib/ into the Pages Functions bundle, which no Function does yet and only a
// Pages preview deploy can prove. These tests hold the mirror equal to the registry instead.
const REGISTRY = path.join(REPO_ROOT, 'data', 'registries', 'statuses.json');
test("FN-04: the table is the registry's contribution machine", () => {
  assert.ok(existsSync(REGISTRY), 'data/registries/statuses.json is on main since rf-registries');
  const machine = JSON.parse(readFileSync(REGISTRY, 'utf8')).machines.contribution;
  assert.equal(machine.initial, INITIAL_STATUS);
  assert.deepEqual(JSON.parse(JSON.stringify(CONTRIBUTION_TRANSITIONS)), machine.transitions);
  assert.deepEqual([...DECISIONS], machine.decisions);
});

test("FN-04: the registry's runnable machine answers every move as the mirror does", async () => {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const { statusMachines, canMarkContributionApplied } = await import('../../packages/registries/src/status-machines.mjs');
  const machine = statusMachines(registry).contribution;
  const states = Object.keys(CONTRIBUTION_TRANSITIONS);
  assert.deepEqual([...machine.states].sort(), [...states].sort());
  for (const from of states) {
    for (const to of states) {
      assert.equal(machine.can(from, to), CONTRIBUTION_TRANSITIONS[from].includes(to), `${from} -> ${to}`);
    }
    assert.equal(canMarkContributionApplied(registry, from).ok, CONTRIBUTION_TRANSITIONS[from].includes('applied'), `${from} -> applied`);
    for (const decision of DECISIONS) assert.equal(canDecide(from, decision).ok, machine.can(from, decision), `decide ${decision} from ${from}`);
  }
});

// ------------------------------------------------------------------ FN-02 the answer ladder

test('FN-02: the answer ladder is a machine; every step is reachable and every forbidden step throws', () => {
  const m = defineMachine({ name: 'records answer', initial: 'start', transitions: ANSWER_LADDER });
  assert.deepEqual([...reachable(ANSWER_LADDER, 'start')].sort(), [...m.states].sort());
  const terminal = m.states.filter((s) => !ANSWER_LADDER[s].length);
  assert.deepEqual(terminal.sort(), ['client-error', 'edge-hit', 'from-r2', 'last-good', 'not-modified', 'passed-through', 'stored', 'unavailable', 'unstored']);
  for (const [from, to] of forbidden(ANSWER_LADDER)) {
    const walk = answerLadder();
    const path = m.states.includes(from) && from !== 'start' ? findPath(from) : [];
    for (const step of path) walk.to(step);
    assert.equal(walk.at, from);
    assert.throws(() => walk.to(to), /is not a transition/, `${from} -> ${to}`);
  }
});

/** A path from start to `target` (breadth first). */
function findPath(target) {
  const prev = new Map([['start', null]]);
  const queue = ['start'];
  while (queue.length) {
    const at = queue.shift();
    if (at === target) break;
    for (const next of ANSWER_LADDER[at]) if (!prev.has(next)) { prev.set(next, at); queue.push(next); }
  }
  const path = [];
  for (let at = target; at !== 'start'; at = prev.get(at)) path.unshift(at);
  return path;
}

/** A D1 stub whose dataset table says `state`, and a handler answering `status`. */
function records(state) {
  return {
    prepare: () => ({
      bind() { return this; },
      all: async () => ({ results: Object.entries(state).map(([key, value]) => ({ key, value })) }),
      first: async () => null,
    }),
  };
}

async function walk(url, { state = { version: 'v1', loading: '' }, status = 200, throws = false, options = {}, headers = {}, env = {} } = {}) {
  resetDatasetMemo();
  let path = null;
  const context = {
    request: new Request(`https://civgraph.net${url}`, { headers }),
    env: { ELECTIONS_DB: records(state), ...env },
    waitUntil() {},
  };
  const handler = async () => {
    if (throws) throw new Error('D1 down');
    return new Response(JSON.stringify({ status }), { status, headers: status === 301 ? { Location: '/elsewhere' } : {} });
  };
  const res = await cachedJson(context, 'code-1', handler, { ...options, onPath: (p) => { path = p; } });
  return { res, path };
}

test('FN-02: cachedJson takes the ladder\'s paths, and stores nothing while loading', async () => {
  installCaches();
  const first = await walk('/_api/x?a=1');
  assert.deepEqual(first.path, ['start', 'rebuild', 'stored']);
  assert.equal(first.res.headers.get('Cache-Control'), 'public, max-age=300, stale-while-revalidate=86400');
  assert.deepEqual((await walk('/_api/x?a=1')).path, ['start', 'edge-hit']);
  assert.deepEqual((await walk('/_api/x?a=1', { headers: { 'If-None-Match': first.res.headers.get('ETag') } })).path, ['start', 'not-modified']);

  const loading = await walk('/_api/y', { state: { version: 'v1', loading: 'v2' } });
  assert.deepEqual(loading.path, ['start', 'rebuild', 'unstored']);
  assert.equal(loading.res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await walk('/_api/y', { state: { version: 'v1', loading: 'v2' } })).path, ['start', 'rebuild', 'unstored'], 'nothing was stored');

  assert.deepEqual((await walk('/_api/z', { status: 404 })).path, ['start', 'rebuild', 'client-error']);
  assert.deepEqual((await walk('/_api/z', { status: 301 })).path, ['start', 'rebuild', 'passed-through']);
  const down = await walk('/_api/z', { throws: true });
  assert.deepEqual(down.path, ['start', 'rebuild', 'failed', 'unavailable']);
  assert.equal(down.res.status, 503);
  // a stored answer is the last-good copy when D1 then fails under a new dataset version
  const lastGood = await walk('/_api/x?a=1', { state: { version: 'v9', loading: '' }, throws: true });
  assert.deepEqual(lastGood.path, ['start', 'rebuild', 'failed', 'last-good']);
  assert.match(lastGood.res.headers.get('Warning'), /stale/);

  const bucket = { MAPS_BUCKET: { get: async () => ({ body: '{"copy":1}' }) } };
  assert.deepEqual((await walk('/_api/r', { options: { r2Key: 'k', r2First: true }, env: bucket })).path, ['start', 'r2-first', 'from-r2']);
  assert.deepEqual((await walk('/_api/s', { throws: true, options: { r2Key: 'k' }, env: bucket })).path, ['start', 'rebuild', 'failed', 'from-r2']);

  gateState.reset();
  assert.deepEqual((await walk('/_api/g', { options: { gate: true } })).path, ['start', 'gate', 'rebuild', 'stored']);
  gateState.reset();
});

// ------------------------------------------------------------------ FN-01 the gate's slots

test('FN-01: a gate slot moves only as GATE_SLOT allows', () => {
  const m = defineMachine({ name: 'records gate', initial: 'asking', transitions: GATE_SLOT });
  m.assertPath(['queued', 'active', 'released']);
  m.assertPath(['queued', 'timed-out']);
  m.assertPath(['refused']);
  for (const [from, to] of forbidden(GATE_SLOT)) {
    const slot = { state: from };
    assert.throws(() => slotTo(slot, to), /is not a transition/, `${from} -> ${to}`);
    assert.equal(slot.state, from);
  }
});

// ------------------------------------------------------------------ FN-03 the dataset state

test('FN-03: the dataset phases use the loader\'s names; only loading stops storing; one memo for JSON and HTML', async () => {
  assert.deepEqual([...DATASET_PHASES], ['unknown', 'loaded', 'loading']);
  assert.equal(phaseOf({ version: '', loading: '' }), 'unknown');
  assert.equal(phaseOf({ version: 'v1', loading: '' }), 'loaded');
  assert.equal(phaseOf({ version: 'v1', loading: 'v2' }), 'loading');
  assert.deepEqual(DATASET_PHASES.filter((p) => !STORE[p]), ['loading']);

  resetDatasetMemo();
  let reads = 0;
  const db = (version) => ({ prepare: () => ({ all: async () => { reads += 1; return { results: [{ key: 'version', value: version }] }; } }) });
  assert.equal((await readDataset(db('a'), 1000)).version, 'a');
  assert.equal(await datasetVersion(db('b'), 2000), 'a', 'the page reader shares the JSON reader\'s memo');
  assert.equal(reads, 1);
  assert.equal(await datasetVersion(db('b'), 1000 + 60_000), 'b', 'and it expires after a minute');
  resetDatasetMemo();
  assert.equal(await datasetVersion({ prepare() { throw new Error('no table'); } }, 0), null);
  assert.equal(await datasetVersion(null), null);
  resetDatasetMemo();
});

// ------------------------------------------------------------------ FN-L the modes

test('FN-L: the modes are closed sets', () => {
  const url = (q = '') => new URL(`https://civgraph.net/browse/persons/x${q}`);
  const seen = new Set([
    ssrModeName({}, 'persons', url()),
    ssrModeName({ CIVGRAPH_SSR_RECORDS: 'persons' }, 'persons', url()),
    ssrModeName({ CIVGRAPH_SSR_PREVIEW: '1' }, 'persons', url('?ssr=1')),
    ssrModeName({ CIVGRAPH_SSR_RECORDS: 'all' }, 'maps', url()),
  ]);
  assert.deepEqual([...seen].sort(), [...SSR_MODES].sort());
  for (const mode of SSR_MODES) assert.ok(['legacy', 'ssr', 'ssr-preview'].includes(mode));
  assert.deepEqual(ssrMode({ CIVGRAPH_SSR_PREVIEW: '1' }, 'persons', url()), { ssr: false, preview: false }, 'no preview without ?ssr=1');
  assert.deepEqual([...FEATURE_ID_MODES], ['duplicate-aware', 'unique']);
  assert.deepEqual([...LAYER_VIEWS], ['full', 'index']);
  assert.deepEqual([...VERSION_STATUSES], ['stable', 'superseded', 'sunset']);
  assert.equal(versionStatus(V1), 'stable', 'v1 is current');
  assert.equal(versionStatus({ successor: {} }), 'superseded');
  assert.equal(versionStatus({ successor: {}, sunset: 'Wed, 01 Jan 2031 00:00:00 GMT' }), 'sunset');
});
