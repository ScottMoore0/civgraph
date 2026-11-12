// Count rows link to their candidacy (packages/loader/src/ingest-elections.mjs countRowCandidacyOrds):
// by Candidate_Id, and by exact normalised name when a row carries no Candidate_Id, as the 1920 PR
// contest files do (review-rest item 9: in Pottinger 1920 only one candidate's rows linked).
//
//   node --test tests/unit/loader-count-links.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { countRowCandidacyOrds } from '../../packages/loader/src/ingest-elections.mjs';

const row = (/** @type {Record<string, unknown>} */ fields) => ({ Count_Number: '1', Total_Votes: '1', ...fields });

test('rows with a Candidate_Id link by id, as before', () => {
  const candidates = [{ id: 'A|UUP', name: 'A. One' }, { id: 'B|Lab', name: 'B. Two' }];
  const rows = [row({ Candidate_Id: 'B|Lab', candidateName: 'B. Two' }), row({ Candidate_Id: 'A|UUP', candidateName: 'Someone else' })];
  assert.deepEqual(countRowCandidacyOrds(candidates, rows), { ords: [1, 0], byName: 0, nonUniqueIds: 0, ambiguous: [] });
});

test('rows with an empty Candidate_Id link by exact normalised name', () => {
  const candidates = [{ id: 'D. Anderson|UUP', name: 'D. Anderson' }, { id: 'James Johnston|Irish Labour', name: 'James Johnston' }, { id: 'J. S. Johnston|UUP', name: 'J. S. Johnston' }];
  const rows = [
    row({ Candidate_Id: '', candidateName: 'D. Anderson', id: 0 }),
    row({ Candidate_Id: 'James Johnston|Irish Labour', candidateName: 'James Johnston', id: 1 }),
    row({ Candidate_Id: '', candidateName: 'J.S. Johnston', id: 2 }),
    row({ Candidate_Id: '', Firstname: 'D.', Surname: 'ANDERSON', id: 3 }),
    row({ Candidate_Id: '', candidateName: 'Non-transferable', id: 4 }),
  ];
  const out = countRowCandidacyOrds(candidates, rows);
  assert.deepEqual(out.ords, [0, 1, 2, 0, null]);
  assert.equal(out.byName, 3);
  assert.deepEqual(out.ambiguous, []);
});

test('a name two candidates share is refused and reported, never guessed', () => {
  const candidates = [{ id: 'J. Smith|UUP', name: 'J. Smith' }, { id: 'J. Smith|Lab', name: 'J. Smith' }, { id: 'K|X', name: 'K. Brown' }];
  const rows = [row({ Candidate_Id: '', candidateName: 'J. Smith' }), row({ Candidate_Id: '', candidateName: 'K. Brown' })];
  assert.deepEqual(countRowCandidacyOrds(candidates, rows), { ords: [null, 2], byName: 1, nonUniqueIds: 0, ambiguous: ['J. Smith'] });
});

test('a row whose Candidate_Id names no candidate is not relinked by name', () => {
  const candidates = [{ id: 'A|UUP', name: 'A. One' }];
  assert.deepEqual(countRowCandidacyOrds(candidates, [row({ Candidate_Id: 'Z|Z', candidateName: 'A. One' })]).ords, [null]);
});

test('an id shared by two candidates links none of its rows by id; an empty one falls back to the name', () => {
  const candidates = [{ id: '', name: 'A. One' }, { id: '', name: 'B. Two' }, { id: 'C', name: 'C. Three' }, { id: 'C', name: 'C. Four' }];
  const out = countRowCandidacyOrds(candidates, [row({ Candidate_Id: '', candidateName: 'B. Two' }), row({ Candidate_Id: 'C', candidateName: 'C. Four' })]);
  assert.deepEqual(out.ords, [1, null]);
  assert.equal(out.nonUniqueIds, 2);
});

test('curly and straight apostrophes are one name', () => {
  const candidates = [{ id: 'x', name: 'A. M’Bride' }];
  assert.deepEqual(countRowCandidacyOrds(candidates, [row({ Candidate_Id: '', candidateName: "A. M'Bride" })]).ords, [0]);
});
