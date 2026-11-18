// The intake status machines: every allowed transition, and the ones that must stay forbidden.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BATCH_STATUS, checkBatchTransition, COMMAND_GATES, commandAllowed, CONTRIBUTION_STATUS, ROUND_STATUS, roundGate, roundStatusOf } from '@civgraph/intake/statuses.mjs';
import { canMarkApplied } from '../../scripts/intake/contributions.mjs';

const schema = JSON.parse(readFileSync(new URL('../../scripts/intake/batch.schema.json', import.meta.url), 'utf8'));

test('the batch status states are exactly the schema enum', () => {
  assert.deepEqual([...BATCH_STATUS.states].sort(), [...schema.properties.status.enum].sort());
  assert.equal(BATCH_STATUS.initial, 'draft');
});

const ALLOWED = new Set([
  'draft->staged', 'draft->abandoned',
  'staged->committed', 'staged->draft', 'staged->abandoned',
  'committed->uploaded', 'committed->abandoned',
  'uploaded->published', 'uploaded->abandoned',
]);
const FULL = { approvals: [{ step: 'upload' }, { step: 'publish' }], repo: { commits: ['abc1234567'] } };

test('batch status: the table allows exactly the listed transitions', () => {
  for (const from of BATCH_STATUS.states) {
    for (const to of BATCH_STATUS.states) {
      const verdict = checkBatchTransition(from, to, FULL);
      assert.equal(verdict.ok, ALLOWED.has(`${from}->${to}`), `${from} -> ${to}`);
    }
  }
  assert.ok(BATCH_STATUS.start('published').done());
  assert.ok(BATCH_STATUS.start('abandoned').done());
  BATCH_STATUS.assertPath(['staged', 'draft', 'staged', 'committed', 'uploaded', 'published']);
});

test('batch status: the guards need the commit and the owner approvals', () => {
  assert.match(checkBatchTransition('staged', 'committed', {}).reason, /repo\.commits/);
  assert.match(checkBatchTransition('committed', 'uploaded', { approvals: [{ step: 'apply' }] }).reason, /approvals entry for upload/);
  assert.match(checkBatchTransition('uploaded', 'published', { approvals: [{ step: 'upload' }] }).reason, /approvals entry for publish/);
  assert.match(checkBatchTransition('draft', 'published', FULL).reason, /not allowed/);
  assert.match(checkBatchTransition('draft', 'shipped', FULL).reason, /not a batch status/);
  assert.throws(() => BATCH_STATUS.assertTransition('published', 'draft'), /not a transition/);
});

test('command gates: upload --yes and post-upload --write after commit, stage --write never on a finished batch', () => {
  assert.deepEqual([...COMMAND_GATES['upload --yes']], ['committed', 'uploaded']);
  for (const s of BATCH_STATUS.states) {
    assert.equal(commandAllowed('upload --yes', s), s === 'committed' || s === 'uploaded', s);
    assert.equal(commandAllowed('post-upload --write', s), s === 'committed' || s === 'uploaded', s);
    assert.equal(commandAllowed('stage --write', s), s !== 'published' && s !== 'abandoned', s);
  }
  assert.throws(() => commandAllowed('publish', 'draft'), /no gate/);
});

test('contribution status: applied only from approved, and never left', () => {
  const allowed = new Set(['pending-review->approved', 'pending-review->rejected', 'approved->applied']);
  for (const from of CONTRIBUTION_STATUS.states) {
    for (const to of CONTRIBUTION_STATUS.states) assert.equal(CONTRIBUTION_STATUS.can(from, to), allowed.has(`${from}->${to}`), `${from} -> ${to}`);
  }
  assert.ok(CONTRIBUTION_STATUS.start('applied').done());
});

test('canMarkApplied answers as it did before the machine', () => {
  assert.deepEqual(canMarkApplied('approved'), { ok: true });
  assert.deepEqual(canMarkApplied('applied'), { ok: false, reason: 'already marked applied' });
  for (const s of ['pending-review', 'rejected', 'pending', undefined]) {
    assert.deepEqual(canMarkApplied(s), { ok: false, reason: `status is "${s}"; only an approved submission can be marked applied` });
  }
});

test('council round status: the staging lifecycle and the apply gate of 7 Nov 2026', () => {
  const allowed = new Set(['queued->held', 'queued->done', 'queued->partial', 'queued->no-election', 'held->done', 'held->partial', 'held->no-election', 'partial->done', 'partial->applied', 'done->applied']);
  for (const from of ROUND_STATUS.states) {
    for (const to of ROUND_STATUS.states) assert.equal(ROUND_STATUS.can(from, to), allowed.has(`${from}->${to}`), `${from} -> ${to}`);
  }
  assert.deepEqual(roundStatusOf({}), { status: 'done', implied: true, known: true });
  assert.deepEqual(roundStatusOf({ status: 'partial' }), { status: 'partial', implied: false, known: true });
  assert.equal(roundStatusOf({ status: 'held (no paper)' }).known, false);
  assert.equal(roundGate('done', false).verdict, 'apply');
  assert.equal(roundGate('partial', false).verdict, 'apply');
  assert.equal(roundGate('done', true).verdict, 'excluded-by-choice');
  assert.equal(roundGate('held', true).verdict, 'held-back');
  assert.equal(roundGate('no-election', false).verdict, 'would-apply-wrongly');
  assert.equal(roundGate('held (no paper)', false).verdict, 'unknown-status');
});
