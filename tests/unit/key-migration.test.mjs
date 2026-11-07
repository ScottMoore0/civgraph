// The R2 key migration of the layer-id rename (scripts/publish/key-migration.mjs, catalogue PL-03).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkKeyTransition, keyMigration, pairShapeProblem, stateAfterCopy, stateFromVerify,
} from '../../scripts/publish/key-migration.mjs';

const OLD = 'data/maps/test/pmtiles/generated/x-vector-test.pmtiles';
const NEW = 'data/maps/pmtiles/x-vector.pmtiles';

test('the walk from old key to retired old key is the only way through', () => {
  keyMigration.assertPath(['copy-planned', 'copied', 'serving-new', 'old-retired']);
  for (const [from, to] of [
    ['old-key', 'serving-new'], ['copy-planned', 'serving-new'], ['error', 'serving-new'],
    ['old-key', 'old-retired'], ['copied', 'old-retired'], ['old-retired', 'old-key'], ['serving-new', 'old-key'],
  ]) assert.equal(checkKeyTransition(from, to).ok, false, `${from} -> ${to}`);
});

test('serving the new key needs a verify that both keys hold the same object', () => {
  assert.equal(checkKeyTransition('copied', 'serving-new', { verifyStatus: 'ok' }).ok, true);
  for (const verifyStatus of ['new-missing', 'differ', undefined]) {
    assert.equal(checkKeyTransition('copied', 'serving-new', { verifyStatus }).ok, false, String(verifyStatus));
  }
});

test("retiring the old key needs the owner's recorded approval", () => {
  assert.equal(checkKeyTransition('serving-new', 'old-retired', {}).ok, false);
  assert.equal(checkKeyTransition('serving-new', 'old-retired', { approval: { date: '2026-12-01', note: 'owner in chat' } }).ok, true);
});

test("r2-copy-keys's statuses map onto the states", () => {
  assert.deepEqual(['planned', 'copied', 'already-copied', 'error'].map(stateAfterCopy), ['copy-planned', 'copied', 'copied', 'error']);
  assert.deepEqual(['ok', 'new-missing', 'old-missing', 'differ'].map(stateFromVerify), ['copied', 'old-key', 'old-retired', 'error']);
});

test('a pair must be the rename: legacy (or already current) name to a current name', () => {
  assert.equal(pairShapeProblem({ from: OLD, to: NEW }), null);
  // An archive uploaded after the id rename, at the old prefix.
  assert.equal(pairShapeProblem({ from: 'data/maps/test/pmtiles/generated/x-vector.pmtiles', to: NEW }), null);
  assert.match(pairShapeProblem({ from: OLD, to: 'data/maps/pmtiles/x-vector-test.pmtiles' }), /not named by a renamed/);
  assert.match(pairShapeProblem({ from: 'data/maps/test/pmtiles/generated/x.pmtiles', to: NEW }), /either side/);
});
