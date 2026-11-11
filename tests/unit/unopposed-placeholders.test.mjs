// scrubUnopposedPlaceholderVotes (scripts/lib/unopposed-placeholders.mjs): an unopposed return
// carries no votes and no valid poll; the placeholder 1s some imports give it go, the electorate stays.
import assert from 'node:assert/strict';
import test from 'node:test';
import { scrubUnopposedPlaceholderVotes } from '../../scripts/lib/unopposed-placeholders.mjs';

const sheetRow = (name, votes) => ({ candidateName: name, Count_Number: '1', Total_Votes: votes, Candidate_First_Pref_Votes: votes, Transfers: '0', Status: 'Elected' });

test('a three-seat return with a placeholder vote of 1 each: no votes, no valid poll, electorate kept', () => {
  const result = {
    candidates: [{ name: 'A', firstPrefs: 0, finalVotes: 1 }, { name: 'B', firstPrefs: 0, finalVotes: 1 }, { name: 'C', firstPrefs: 0, finalVotes: 1 }],
    elected: [{ name: 'A', firstPrefs: 0, finalVotes: 1, counts: [{ count: 1, total: 1 }] }],
    validPoll: 3, totalVotes: 3, electorate: 9133, leadingVotes: 1, leadingPct: 33.3, majority: 0, majorityPct: 0,
    countInfo: { Valid_Poll: '3', Total_Electorate: '9133' },
    animationPayload: { Constituency: { countInfo: { Valid_Poll: '3' }, countGroup: [sheetRow('A', '1'), sheetRow('B', '1'), sheetRow('C', '1')] } },
  };
  assert.equal(scrubUnopposedPlaceholderVotes(result), true);
  assert.deepEqual(result.candidates.map((c) => [c.firstPrefs, c.finalVotes]), [[null, null], [null, null], [null, null]]);
  assert.deepEqual(result.elected[0].counts, [{ count: 1, total: null, firstPrefs: null }]);
  assert.equal(result.validPoll, null);
  assert.equal(result.totalVotes, null);
  assert.equal(result.leadingVotes, null);
  assert.equal(result.majority, null);
  assert.equal(result.electorate, 9133);
  assert.deepEqual(result.countInfo, { Valid_Poll: '', Total_Electorate: '9133' });
  assert.equal(result.animationPayload.Constituency.countInfo.Valid_Poll, '');
  assert.deepEqual(result.animationPayload.Constituency.countGroup.map((r) => [r.Total_Votes, r.Candidate_First_Pref_Votes, r.Transfers]), [['', '', ''], ['', '', ''], ['', '', '']]);
});

test('a valid poll larger than the placeholders is the record\'s own and stays; "Unopposed" rows stay', () => {
  const result = {
    candidates: [{ name: 'A', firstPrefs: null }],
    validPoll: 31942,
    animationPayload: { Constituency: { countInfo: { Valid_Poll: '31942' }, countGroup: [{ Total_Votes: '', Candidate_First_Pref_Votes: 'Unopposed' }] } },
  };
  scrubUnopposedPlaceholderVotes(result);
  assert.equal(result.validPoll, 31942);
  assert.equal(result.animationPayload.Constituency.countInfo.Valid_Poll, '31942');
  assert.deepEqual(result.animationPayload.Constituency.countGroup, [{ Total_Votes: '', Candidate_First_Pref_Votes: 'Unopposed' }]);
});

test('a contest with real votes is left alone', () => {
  const result = { candidates: [{ name: 'A', firstPrefs: 5000 }, { name: 'B', firstPrefs: 1 }], validPoll: 5001 };
  assert.equal(scrubUnopposedPlaceholderVotes(result), false);
  assert.deepEqual(result, { candidates: [{ name: 'A', firstPrefs: 5000 }, { name: 'B', firstPrefs: 1 }], validPoll: 5001 });
});
