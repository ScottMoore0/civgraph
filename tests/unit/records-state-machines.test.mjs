/**
 * The explicit state machines of the records loader (REFACTOR-PLAN.md section 11):
 *
 * - scripts/lib/state-machine.mjs: the table refuses undeclared moves and malformed tables;
 * - the records deploy (scripts/records/deploy-plan.mjs, full weight): every mode's path is a
 *   walk of the table; the forbidden moves throw (snapshot before PASS, anything applied or
 *   verified in a dry run, a local bookmark, a delta in --resync); the option checks give the
 *   messages deploy-records.mjs printed before, plus the refused --dry-run --resync;
 * - --start-part resumes only the load that stopped (the persisted cursor, resumeCheck);
 * - the dataset loading flag (scripts/records/dataset-state.mjs, light weight): the values the
 *   delta writes are the ones it wrote before, byte for byte;
 * - the light enumerations: graph_files origin, the votes pin, the layer-id rename side.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defineMachine, defineToggle } from '../../scripts/lib/state-machine.mjs';
import { DATASET_LOAD, datasetLoadState, loadingValue } from '../../packages/loader/src/dataset-state.mjs';
import { createDatabase } from '../../packages/loader/src/db.mjs';
import { layerIdForm } from '../../scripts/lib/layer-renames.mjs';
import { DEPLOY, deployModeErrors, deployPath, deployRun, parseDeployArgs, resumeCheck, verifyModeFor } from '../../packages/loader/src/deploy-plan.mjs';
import { graphFilesOrigin } from '../../packages/loader/src/graph-files-freeze.mjs';
import { votesPinState } from '../../packages/loader/src/votes-pin.mjs';
import { buildDelta } from '../../packages/loader/src/diff-load.mjs';

test('defineMachine: moves only along the table', () => {
  const m = defineMachine({ name: 'm', initial: 'a', transitions: { a: ['b'], b: ['c', 'a'], c: [] } });
  const run = m.start();
  assert.equal(run.to('b'), 'b');
  assert.throws(() => run.to('b'), /m: b -> b is not a transition/);
  run.to('c');
  assert.ok(run.done());
  assert.deepEqual(run.history(), ['a', 'b', 'c']);
  assert.throws(() => m.assertPath(['c']), /a -> c/);
  assert.throws(() => defineMachine({ name: 'x', initial: 'z', transitions: { a: [] } }), /initial state z/);
  assert.throws(() => defineMachine({ name: 'x', initial: 'a', transitions: { a: ['q'] } }), /a -> q names a state/);
  const t = defineToggle('t', ['off', 'on']);
  assert.ok(t.can('off', 'on') && t.can('on', 'off') && !t.can('on', 'on'));
});

const MODES = {
  'publish dry run': ['--remote', '--dry-run'],
  'publish load': ['--remote'],
  'remote full load': ['--remote', '--full'],
  'remote resync': ['--remote', '--resync', '--full-verify'],
  'local load': ['--local'],
  'local direct bounded': ['--local', '--direct', '--bounded'],
  'local resync': ['--local', '--resync'],
  'local dry run': ['--local', '--dry-run'],
  'remote resume': ['--remote', '--start-part', '3'],
};

test('deploy: every mode walks the table and ends in a final state', () => {
  for (const [label, args] of Object.entries(MODES)) {
    const mode = parseDeployArgs(args);
    assert.deepEqual(deployModeErrors(mode), [], label);
    const p = deployPath(mode);
    DEPLOY.assertPath(p);
    assert.deepEqual(DEPLOY.transitions[p.at(-1)], [], label);
    const run = deployRun(mode);
    for (const s of p) run.to(s);
    assert.deepEqual(run.history(), ['start', ...p], label);
  }
  assert.deepEqual(deployPath(parseDeployArgs(MODES['publish load'])), ['migrated', 'bookmarked', 'delta-written', 'applied', 'verified', 'snapshotted']);
  assert.deepEqual(deployPath(parseDeployArgs(MODES['publish dry run'])), ['migrations-listed', 'delta-previewed', 'dry-run-reported']);
  assert.deepEqual(deployPath(parseDeployArgs(MODES['local resync'])), ['migrated', 'verified', 'snapshotted']);
  assert.equal(parseDeployArgs(MODES['remote resume']).startPart, 3);
});

test('deploy: the snapshot is replaced only after a PASS', () => {
  for (const s of DEPLOY.states) assert.equal(DEPLOY.can(s, 'snapshotted'), s === 'verified', s);
  for (const s of DEPLOY.states) if (s !== 'failed') assert.ok(DEPLOY.can(s, 'failed') || DEPLOY.transitions[s].length === 0, s);
});

test('deploy: a dry run applies, verifies and snapshots nothing', () => {
  const reach = new Set();
  const walk = (s) => { if (reach.has(s)) return; reach.add(s); for (const n of DEPLOY.transitions[s]) walk(n); };
  walk('migrations-listed');
  for (const s of ['migrated', 'bookmarked', 'applied', 'verified', 'snapshotted']) assert.ok(!reach.has(s), s);
  const run = deployRun(parseDeployArgs(MODES['publish dry run']));
  run.to('migrations-listed');
  assert.throws(() => run.to('delta-written'), /not a transition/);
  run.to('delta-previewed');
  assert.throws(() => run.to('applied'), /not a transition/);
  run.to('dry-run-reported');
  assert.throws(() => run.to('failed'), /is not a transition/);
});

test('deploy: steps out of turn throw', () => {
  const local = deployRun(parseDeployArgs(MODES['local load']));
  local.to('migrated');
  assert.throws(() => local.to('bookmarked'), /out of turn/);
  local.to('delta-written');
  assert.throws(() => local.to('verified'), /not a transition/);
  local.to('applied');
  assert.throws(() => local.to('snapshotted'), /not a transition/);
  local.to('verified');
  local.to('snapshotted');

  const remote = deployRun(parseDeployArgs(MODES['publish load']));
  remote.to('migrated');
  assert.throws(() => remote.to('delta-written'), /out of turn/);
  remote.to('bookmarked');

  const resync = deployRun(parseDeployArgs(MODES['local resync']));
  resync.to('migrated');
  assert.throws(() => resync.to('delta-written'), /out of turn/);
  resync.to('verified');
  assert.equal(resync.to('failed'), 'failed');
});

test('deploy: the option checks', () => {
  const first = (args) => deployModeErrors(parseDeployArgs(args))[0];
  assert.equal(first([]), 'say --local or --remote');
  assert.equal(first(['--local', '--remote']), 'say --local or --remote');
  assert.equal(first(['--remote', '--direct']), '--direct is local only');
  assert.match(first(['--remote', '--resync']), /^--remote --resync needs --full-verify/);
  assert.match(first(['--local', '--resync', '--dry-run']), /^--dry-run --resync has nothing to list/);
  assert.throws(() => deployRun(parseDeployArgs(['--remote', '--direct'])), /--direct is local only/);
});

test('verify mode: remote and --bounded are bounded, --full-verify and local are full', () => {
  assert.equal(verifyModeFor({ remote: true }), 'bounded');
  assert.equal(verifyModeFor({ remote: true, fullVerify: true }), 'full');
  assert.equal(verifyModeFor({}), 'full');
  assert.equal(verifyModeFor({ bounded: true }), 'bounded');
  assert.equal(parseDeployArgs(['--local', '--bounded']).verify, 'bounded');
});

test('dataset flag: the toggle and the values the delta writes', () => {
  assert.ok(DATASET_LOAD.can('loaded', 'loading') && DATASET_LOAD.can('loading', 'loaded'));
  assert.equal(loadingValue('loading', 'abc'), 'abc');
  assert.equal(loadingValue('loading', ''), 'loading');
  assert.equal(loadingValue('loaded', 'abc'), '');
  assert.equal(datasetLoadState(''), 'loaded');
  assert.equal(datasetLoadState(null), 'loaded');
  assert.equal(datasetLoadState('abc'), 'loading');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'civgraph-dataset-flag-'));
  try {
    const file = path.join(dir, 'r.sqlite');
    const db = createDatabase(file);
    db.exec("INSERT INTO dataset (key, value) VALUES ('version', 'v1'), ('git_commit', 'c1')");
    db.close();
    const lines = [];
    buildDelta({ toFile: file, write: (s) => lines.push(s), loadedAt: 'T' });
    assert.equal(lines[0], "INSERT OR REPLACE INTO dataset (key, value) VALUES ('loading', 'v1');\n");
    assert.equal(lines.at(-1), "INSERT OR REPLACE INTO dataset (key, value) VALUES ('version', 'v1'), ('loading', ''), ('git_commit', 'c1'), ('loaded_at', 'T');\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deploy: --start-part resumes only the load that stopped', () => {
  const current = { target: 'remote', build: 'b2', from: 'b1', parts: 5 };
  const previous = { ...current, applied: 3 };
  assert.deepEqual(resumeCheck({ startPart: 0, previous: null, current }), { errors: [], warnings: [] });
  assert.deepEqual(resumeCheck({ startPart: 3, previous, current }).errors, []);
  assert.deepEqual(resumeCheck({ startPart: 1, previous, current }).errors, []);
  assert.match(resumeCheck({ startPart: 4, previous, current }).errors[0], /resume with --start-part 3/);
  assert.match(resumeCheck({ startPart: 3, previous: { ...previous, build: 'b3' }, current }).errors[0], /the build changed/);
  assert.match(resumeCheck({ startPart: 3, previous: { ...previous, from: 'b0' }, current }).errors[0], /the from changed/);
  assert.match(resumeCheck({ startPart: 3, previous: { ...previous, target: 'local' }, current }).errors[0], /the target changed/);
  assert.match(resumeCheck({ startPart: 5, previous, current }).errors[0], /parts 0 to 4/);
  const blind = resumeCheck({ startPart: 2, previous: null, current });
  assert.deepEqual(blind.errors, []);
  assert.equal(blind.warnings.length, 1);
});

test('light: graph_files origin, the votes pin, the layer-id rename side', () => {
  assert.equal(graphFilesOrigin('x.sqlite'), 'frozen');
  assert.equal(graphFilesOrigin(null), 'built');
  assert.equal(layerIdForm('eds-ulster-1911-vector-test'), 'legacy');
  assert.equal(layerIdForm('eds-ulster-1911-vector'), 'current');
  assert.equal(layerIdForm('eds-ulster-1911'), 'other');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'civgraph-votes-pin-'));
  try {
    mkdirSync(path.join(dir, 'tidy'));
    writeFileSync(path.join(dir, 'tidy', 'divisions.csv'), 'a');
    writeFileSync(path.join(dir, 'tidy', 'votes.csv'), 'b');
    const pinFile = path.join(dir, 'pin.json');
    assert.equal(votesPinState(dir, pinFile).state, 'unpinned');
    const sha = (text) => createHash('sha256').update(text).digest('hex');
    writeFileSync(pinFile, JSON.stringify({ files: [{ file: 'tidy/divisions.csv', sha256: sha('a') }, { file: 'tidy/votes.csv', sha256: sha('b') }] }));
    assert.equal(votesPinState(dir, pinFile).state, 'pinned');
    writeFileSync(path.join(dir, 'tidy', 'votes.csv'), 'c');
    assert.deepEqual(votesPinState(dir, pinFile), { ...votesPinState(dir, pinFile), state: 'mismatch', diffs: ['tidy/votes.csv'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
