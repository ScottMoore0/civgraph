// Printed party labels (owner rule: printed labels are shown as printed). A source-checked fix
// records the label a source printed (Party_As_Printed) beside the party it is read as; the
// results tables show it under the party where the two differ.
//
//   node --test tests/elections/party-as-printed.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeScraperPayloadForMain, summarizeCandidateRows } from '../../src/election-domain.mjs';
import { partyAsPrintedLabel } from '../../src/party-names.mjs';

test('a count row carries its printed label to the candidate', () => {
  const [candidate] = summarizeCandidateRows([
    { Candidate_Id: '1', Firstname: 'John', Surname: 'Redmond', Party_Name: 'Home Rule', Party_As_Printed: 'HR (P)', Count_Number: '1', Total_Votes: '100', Candidate_First_Pref_Votes: '100' }
  ]);
  assert.equal(candidate.party, 'Home Rule');
  assert.equal(candidate.partyAsPrinted, 'HR (P)');
  assert.equal(partyAsPrintedLabel(candidate), 'HR (P)');
});

test('a printed label that is the party itself is not repeated', () => {
  const [candidate] = summarizeCandidateRows([
    { Candidate_Id: '1', Firstname: 'A', Surname: 'B', Party_Name: 'Republican', Party_As_Printed: 'Republican', Count_Number: '1', Total_Votes: '5' }
  ]);
  assert.equal(candidate.partyAsPrinted, undefined);
  assert.equal(partyAsPrintedLabel({ party: 'Home Rule', partyAsPrinted: '' }), '');
  assert.equal(partyAsPrintedLabel({ party: 'Anti H-Block', partyAsPrinted: 'Anti-H-Block/Armagh Political Prisoner', ballotDescription: 'Anti-H-Block/Armagh Political Prisoner' }), '');
});

test('a Dail scraper candidate keeps its printed label and inferred flag through the count rows', () => {
  const payload = normalizeScraperPayloadForMain({
    meta: {},
    candidates: [
      { name: 'Joe Sherlock', party: 'Sinn Féin (Official)', Party_As_Printed: 'Sinn Féin', partyInferred: true, partyBasis: 'registered name 1971-77', first_pref: 3000, status: 'Elected' },
      { name: 'Someone Else', party: 'Fine Gael', first_pref: 2000 }
    ]
  }, 'Cork North-East');
  const rows = payload.Constituency.countGroup;
  const sherlock = rows.find((row) => row.candidateName === 'Joe Sherlock');
  assert.equal(sherlock.Party_As_Printed, 'Sinn Féin');
  assert.equal(sherlock.Party_Inferred, true);
  assert.equal(sherlock.Party_Basis, 'registered name 1971-77');
  const other = rows.find((row) => row.candidateName === 'Someone Else');
  assert.equal('Party_As_Printed' in other, false, 'nothing written where no label was recorded');
  const candidates = summarizeCandidateRows(rows);
  const joe = candidates.find((candidate) => candidate.name === 'Joe Sherlock');
  assert.equal(joe.partyAsPrinted, 'Sinn Féin');
  assert.equal(joe.partyInferred, true);
});
