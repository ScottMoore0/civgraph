// The intake status machines: every allowed transition, and the ones that must stay forbidden.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defineMachine, defineToggle } from '../../scripts/intake/lib/state-machine.mjs';
import { BATCH_STATUS, COMMAND_GATES, commandAllowed, CONTRIBUTION_STATUS } from '../../scripts/intake/lib/statuses.mjs';
import { canMarkApplied } from '../../scripts/intake/contributions.mjs';

const schema = JSON.parse(readFileSync(new URL('../../scripts/intake/batch.schema.json', import.meta.url), 'utf8'));

test('defineMachine refuses a malformed table', () => {
  assert.throws(() => defineMachine({ name: 'm', states: ['a', 'a'], initial: 'a', transitions: { a: [] } }), /twice/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a'], initial: 'b', transitions: { a: [] } }), /initial/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a', 'b'], initial: 'a', transitions: { a: ['b'] } }), /no transitions given for b/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a'], initial: 'a', transitions: { a: ['c'] } }), /unknown state/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a', 'b'], initial: 'a', transitions: { a: ['b'], b: [] }, guards: { 'b->a': () => null } }), /guard b->a/);
});

test('a toggle goes both ways and nowhere else', () => {
  const t = defineToggle('panel', ['closed', 'open']);
  assert.equal(t.initial, 'closed');
  assert.equal(t.assert('closed', 'open'), 'open');
  assert.equal(t.assert('open', 'closed'), 'closed');
  assert.equal(t.check('open', 'open').ok, false);
  assert.equal(t.check('open', 'ajar').ok, false);
});

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
      const verdict = BATCH_STATUS.check(from, to, FULL);
      assert.equal(verdict.ok, ALLOWED.has(`${from}->${to}`), `${from} -> ${to}`);
    }
  }
  assert.ok(BATCH_STATUS.isTerminal('published'));
  assert.ok(BATCH_STATUS.isTerminal('abandoned'));
});

test('batch status: the guards need the commit and the owner approvals', () => {
  assert.match(BATCH_STATUS.check('staged', 'committed', {}).reason, /repo\.commits/);
  assert.match(BATCH_STATUS.check('committed', 'uploaded', { approvals: [{ step: 'apply' }] }).reason, /approvals entry for upload/);
  assert.match(BATCH_STATUS.check('uploaded', 'published', { approvals: [{ step: 'upload' }] }).reason, /approvals entry for publish/);
  assert.throws(() => BATCH_STATUS.assert('draft', 'published', FULL), /not allowed/);
  assert.throws(() => BATCH_STATUS.assert('draft', 'shipped', FULL), /not a state/);
});

test('upload --yes keeps its gate: committed or uploaded only', () => {
  assert.deepEqual([...COMMAND_GATES['upload --yes']], ['committed', 'uploaded']);
  for (const s of BATCH_STATUS.states) assert.equal(commandAllowed('upload --yes', s), s === 'committed' || s === 'uploaded', s);
  assert.throws(() => commandAllowed('publish', 'draft'), /no gate/);
});

test('contribution status: applied only from approved, and never left', () => {
  const allowed = new Set(['pending-review->approved', 'pending-review->rejected', 'approved->applied', 'approved->rejected', 'rejected->approved']);
  for (const from of CONTRIBUTION_STATUS.states) {
    for (const to of CONTRIBUTION_STATUS.states) assert.equal(CONTRIBUTION_STATUS.check(from, to).ok, allowed.has(`${from}->${to}`), `${from} -> ${to}`);
  }
  assert.ok(CONTRIBUTION_STATUS.isTerminal('applied'));
});

test('canMarkApplied answers as it did before the machine', () => {
  assert.deepEqual(canMarkApplied('approved'), { ok: true });
  assert.deepEqual(canMarkApplied('applied'), { ok: false, reason: 'already marked applied' });
  for (const s of ['pending-review', 'rejected', 'pending', undefined]) {
    assert.deepEqual(canMarkApplied(s), { ok: false, reason: `status is "${s}"; only an approved submission can be marked applied` });
  }
});
