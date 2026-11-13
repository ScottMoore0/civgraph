// The figures behind the person, party and constituency pages (src/entity-detail-data.mjs).
// Run: node --test tests/catalogue/entity-detail-data.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPartyChanges,
  addStandings,
  bodyGroupOf,
  groupConstituencies,
  isListPseudoCandidate,
  knownCount,
  leadingPartyOf,
  normaliseStatus,
  partyHeadlineCards,
  yearRange
} from '../../packages/map/src/entity-detail-data.mjs';

test('a missing figure stays missing, and a 0 beside seats is unknown', () => {
  assert.equal(knownCount(null), null);
  assert.equal(knownCount(''), null);
  assert.equal(knownCount(0), 0);
  assert.equal(knownCount(0, true), null);
  assert.equal(knownCount('12'), 12);
});

test('statuses: one vocabulary, the source word kept', () => {
  assert.deepEqual(normaliseStatus({ status: 'Deemed elected', elected: true, firstPrefs: 25156 }), { label: 'Elected', raw: 'Deemed elected', elected: true });
  assert.equal(normaliseStatus({ status: 'Deemed elected', elected: true }).label, 'Elected unopposed');
  assert.equal(normaliseStatus({ status: 'Made Quota' }).label, 'Elected');
  assert.equal(normaliseStatus({ status: '', elected: false }).label, 'Not elected');
  assert.equal(normaliseStatus({ status: 'Excluded' }).label, 'Not elected');
});

test('standings are counted from the career, oldest first', () => {
  const rows = addStandings([
    { date: '2005-05-05', electionType: 'Westminster', elected: true },
    { date: '1969-02-24', electionType: 'Parliament of NI', elected: false },
    { date: '2003-11-26', electionType: 'Assembly', elected: true },
    { date: '2001-06-07', electionType: 'Westminster', elected: true }
  ]);
  assert.deepEqual(rows.map((r) => r.date), ['1969-02-24', '2001-06-07', '2003-11-26', '2005-05-05']);
  assert.deepEqual(rows.map((r) => r.overallStandingNumber), [1, 2, 3, 4]);
  assert.deepEqual(rows.map((r) => r.overallElectedNumber), [null, 1, 2, 3]);
  assert.equal(rows[3].bodyStandingNumber, 2);
  assert.equal(rows[3].bodyElectedNumber, 2);
});

test('constituencies once each, with year ranges', () => {
  const groups = groupConstituencies([
    { constituency: 'North Antrim', date: '1970-06-18', elected: true, electionType: 'Westminster' },
    { constituency: 'North Antrim', date: '2005-05-05', elected: true, electionType: 'Westminster' },
    { constituency: 'Bannside', date: '1969-02-24', elected: false, electionType: 'Parliament of NI' },
    { constituency: 'Bannside', date: '1970-04-16', elected: true, electionType: 'Parliament of NI' },
    { constituency: 'Northern Ireland', date: '1979-06-07', elected: true, electionType: 'European' }
  ]);
  assert.deepEqual(groups.map((g) => `${g.label} ${g.years}`), ['Bannside 1969–70', 'North Antrim 1970–2005', 'Northern Ireland (Europe) 1979']);
  assert.equal(yearRange(1979, 1999), '1979–99');
  assert.equal(yearRange(1885, 1918), '1885–1918');
});

test('the leading party sums its candidates (North Antrim 2022)', () => {
  const lead = leadingPartyOf({
    validPoll: 50624,
    candidates: [
      { name: 'Robin Swann', party: 'UUP', firstPrefs: 9530, elected: true },
      { name: 'Paul Frew', party: 'DUP', firstPrefs: 6500, elected: true },
      { name: 'Phillip Brett', party: 'DUP', firstPrefs: 6489, elected: false },
      { name: 'Jim Allister', party: 'TUV', firstPrefs: 8282, elected: true }
    ]
  });
  assert.equal(lead.party, 'DUP');
  assert.equal(lead.votes, 12989);
  assert.equal(lead.elected.length, 3);
});

test('party changes compare like with like, and headline cards follow the bodies contested', () => {
  const rows = addPartyChanges([
    { date: '2019-12-12', body: 'Westminster', electionType: 'Westminster', contested: true, elected: 8, firstPrefs: 244128, validVotePct: 30.6 },
    { date: '2024-07-04', body: 'Westminster', electionType: 'Westminster', contested: true, elected: 5, firstPrefs: 172058, validVotePct: 22.1 },
    { date: '2021-01-01', body: 'Westminster', electionType: 'Westminster', contested: true, isByElection: true, elected: 1 }
  ]);
  assert.equal(rows[1].electedDelta, -3);
  assert.equal(rows[2].electedDelta ?? null, null);
  const cards = partyHeadlineCards([...rows, { date: '2020-02-08', electionType: 'Dáil', contested: true, elected: 37, validVotePct: 24.5 }]);
  assert.deepEqual(cards.map((c) => c.label), ['Westminster 2024', 'Dáil 2020']);
  assert.equal(cards[0].value, '5 MPs');
  assert.equal(cards[1].value, '37 TDs');
});

test('body groups and list labels', () => {
  assert.equal(bodyGroupOf('Dáil'), 'Dáil');
  assert.equal(bodyGroupOf('Forum'), 'Devolved');
  assert.equal(isListPseudoCandidate('DUP list'), true);
  assert.equal(isListPseudoCandidate('Ian Paisley'), false);
});
