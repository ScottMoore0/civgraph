// The grouped NI local round status (scripts/build/build-ni-local-grouped.mjs, catalogue PL-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUND_WORK_STATUSES, groupedRoundStatus, groupedRoundStatusMachine, isKnownRoundWork,
} from '../../scripts/build/build-ni-local-grouped.mjs';

// The derivation as it was written inline before the machine.
function before({ work, excluded, incomplete }) {
  let roundStatus = 'complete';
  if (work === 'partial' || work === 'held') roundStatus = work;
  if (excluded && roundStatus === 'complete') roundStatus = 'partial';
  if (incomplete && roundStatus === 'complete') roundStatus = 'partial';
  return roundStatus;
}

test('the machine gives the same status as the old derivation for every combination', () => {
  for (const work of [undefined, '', 'done', 'partial', 'held', 'no-election', 'typo']) {
    for (const excluded of [false, true]) {
      for (const incomplete of [false, true]) {
        assert.equal(groupedRoundStatus({ work, excluded, incomplete }), before({ work, excluded, incomplete }), JSON.stringify({ work, excluded, incomplete }));
      }
    }
  }
});

test('a round is only ever marked down, never back up', () => {
  for (const [from, to] of [['partial', 'complete'], ['held', 'complete'], ['held', 'partial'], ['partial', 'held'], ['complete', 'complete']]) {
    assert.equal(groupedRoundStatusMachine.check(from, to).ok, false, `${from} -> ${to}`);
  }
  assert.equal(groupedRoundStatusMachine.check('complete', 'partial').ok, true);
  assert.equal(groupedRoundStatusMachine.check('complete', 'held').ok, true);
  assert.equal(groupedRoundStatusMachine.check('complete', 'published').ok, false);
});

test('the intake work statuses are a closed list; anything else is flagged', () => {
  assert.deepEqual([...ROUND_WORK_STATUSES], ['done', 'partial', 'held', 'no-election']);
  for (const work of [undefined, null, '', 'done', 'no-election']) assert.equal(isKnownRoundWork(work), true, String(work));
  for (const work of ['Done', 'complete', 'parital']) assert.equal(isKnownRoundWork(work), false, work);
});
