import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTRACT_COLUMNS, NO_PARTY, contestFacts, decadeOf, electedPersons, emptyTally, extractRow, foldLabel, outcomeOf,
  tallyContest, toCsv, transfersReceived,
} from '../../scripts/build/elections-app/model.mjs';

const counts = (...totals) => totals.map((total, i) => ({ count: i + 1, total, transfers: i ? total - totals[i - 1] : 0 }));
const cand = (over = {}) => ({ status: '', first_prefs: 100, party_label: 'Alliance', person_id: '1', gender: '', meta: { counts: counts(100) }, ...over });

test('a staged STV contest has stages, transfers and count order', () => {
  const f = contestFacts({ electorate: 1000, turnout_pct: 60, quota: 201, seats_total: 2 }, { validPoll: 600 }, [
    cand({ meta: { counts: counts(250, 201), electedAt: 1 } }),
    cand({ meta: { counts: counts(150, 199), electedAt: 2 } }),
    cand({ meta: { counts: counts(200, 200), excludedAt: 2 }, person_id: null, party_label: NO_PARTY }),
  ], { labelMap: new Map([['alliance', 'alliance']]) });
  assert.equal(f.stages, 2);
  assert.ok(f.hasStages && f.transfers && f.order);
  assert.ok(f.electorate && f.turnout && f.quota && f.validPoll && !f.spoiled && f.seats);
  assert.equal(f.unopposed, false);
  assert.equal(f.labelled, 2);
  assert.equal(f.linkedParty, 2);
  assert.equal(f.persons, 2);
});

test('padded counts with unchanged totals are one stage, but keep the count order', () => {
  const f = contestFacts({}, {}, [
    cand({ meta: { counts: counts(100, 100, 100), electedAt: 3 } }),
    cand({ meta: { counts: counts(90, 90, 90), excludedAt: 2 } }),
  ]);
  assert.equal(f.stages, 1);
  assert.equal(f.hasStages, false);
  assert.equal(f.transfers, false);
  assert.equal(f.order, true);
});

test('an unopposed return has no votes and is flagged; a contested one with votes is not', () => {
  const unopp = contestFacts({}, {}, [cand({ status: 'Elected unopposed', first_prefs: null, meta: { counts: [{ count: 1, total: null }] } })]);
  assert.equal(unopp.unopposed, true);
  assert.equal(unopp.votes, false);
  const byStatus = contestFacts({}, {}, [cand({ first_prefs: null, meta: {} })], { contestStatus: 'uncontested' });
  assert.equal(byStatus.unopposed, true);
  const contested = contestFacts({}, {}, [cand(), cand({ first_prefs: 50 })], { contestStatus: 'uncontested' });
  assert.equal(contested.unopposed, false);
});

test('tallies count contests and candidacies', () => {
  const t = emptyTally();
  tallyContest(t, contestFacts({}, {}, [cand(), cand()]), 'verified');
  tallyContest(t, contestFacts({}, {}, [cand({ status: 'Elected unopposed', first_prefs: null })]), null);
  assert.equal(t.contests, 2);
  assert.equal(t.candidacies, 3);
  assert.equal(t.unopposed, 1);
  assert.deepEqual(t.provenance, { verified: 1, cited: 0, recorded: 0, none: 1 });
});

test('labels fold the way party_label_map stores them', () => {
  assert.equal(foldLabel('D.U.P.'), 'd u p');
  assert.equal(foldLabel('  Sinn Féin '), 'sinn fein');
  assert.equal(decadeOf(1921), '1920s');
  assert.equal(decadeOf(null), 'undated');
});

test('extract rows carry dimensions and measures; unopposed rows have null votes, not zero', () => {
  const el = { key: 'b__2022-05-05', slug: 'b-2022-05-05', display_title: '2022 B election', body: 'B', body_slug: 'b', kind: 'general', voting_system: 'stv-gregory', date: '2022-05-05', year: 2022 };
  const contest = { seq: 0, name: 'Area', slug: 'area', electorate: 1000, turnout_pct: 60, quota: 201, meta: { validPoll: 600 } };
  const row = extractRow(el, contest, { ...cand({ first_prefs: 150, meta: { counts: counts(150, 199) } }), elected: 1, final_votes: 199, name: 'A Person' },
    { labelMap: new Map([['alliance', 'alliance']]), incumbents: new Set(['1']), stages: 2 });
  assert.deepEqual(Object.keys(row), [...EXTRACT_COLUMNS]);
  assert.equal(row.share, 25);
  assert.equal(row.party_slug, 'alliance');
  assert.equal(row.incumbent, true);
  assert.equal(row.transfers_received, 49);
  assert.equal(row.seats, 1);
  assert.equal(row.decade, '2020s');
  const un = extractRow(el, { ...contest, meta: {} }, { ...cand({ status: 'Elected unopposed', first_prefs: null, party_label: '' }), elected: 1 }, { unopposed: true });
  assert.equal(un.votes, null);
  assert.equal(un.share, null);
  assert.equal(un.outcome, 'elected unopposed');
  assert.equal(un.party, NO_PARTY);
  assert.equal(un.seats, 1);
  assert.equal(un.incumbent, null);
});

test('outcomes, transfers received, elected persons and CSV quoting', () => {
  assert.equal(outcomeOf({ elected: 1 }), 'elected');
  assert.equal(outcomeOf({ excluded: 1 }), 'excluded');
  assert.equal(outcomeOf({}), 'not elected');
  assert.equal(transfersReceived({ counts: counts(10) }), null);
  assert.equal(transfersReceived({ counts: [{ total: 10, transfers: 0 }, { total: 5, transfers: -5 }, { total: 8, transfers: 3 }] }), 3);
  assert.deepEqual([...electedPersons([{ person_id: '1', elected: 1 }, { person_id: '2', status: 'Elected unopposed' }, { person_id: '3', elected: 0 }])], ['1', '2']);
  assert.equal(toCsv(['a', 'b'], [{ a: 'x, "y"', b: null }, { a: true, b: 2 }]), 'a,b\n"x, ""y""",\ntrue,2\n');
});
