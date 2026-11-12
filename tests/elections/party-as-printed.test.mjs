// Party labels: the interpreted label by default, the label as printed on request (owner's
// design, 2026-11-06). A source records the label it printed (Party_As_Printed, kept verbatim)
// and the site reads it as a party or independent label (Party_Name), through one reviewable
// mapping (data/elections/party-label-interpretations.json). Tables show the reading; "Show labels
// as printed" adds an "As printed" column. Nothing printed and nothing inferred is "No label".
//
//   node --test tests/elections/party-as-printed.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPartySummary, NO_LABEL, normalizeScraperPayloadForMain, partyColour, summarizeCandidateRows, summarizeResult } from '../../packages/core/src/election-domain.mjs';
import { partyAsPrintedLabel } from '../../packages/core/src/party-names.mjs';
import { createPartyLabelInterpreter } from '../../scripts/lib/party-label-interpretations.mjs';
import {
  PRINTED_LABELS_ROOT_ATTRIBUTE,
  PRINTED_LABELS_STORAGE_KEY,
  printedLabelsShown,
  printedLabelsToggleHtml,
  printedLabelText,
  setPrintedLabelsShown
} from '../../packages/map/src/printed-labels.mjs';

const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const interpretations = JSON.parse(read('data/elections/party-label-interpretations.json'));
const interpreter = createPartyLabelInterpreter(interpretations);

function contest(rows) {
  return {
    Constituency: {
      countInfo: { Constituency_Name: 'Test Ward', Number_Of_Seats: String(rows.filter((row) => row.elected).length || 1) },
      countGroup: rows.map((row, index) => ({
        Candidate_Id: '',
        Count_Number: '1',
        Firstname: row.first || 'A.',
        Surname: row.surname,
        candidateName: `${row.first || 'A.'} ${row.surname}`,
        Party_Name: row.party || '',
        Party_As_Printed: row.printed ?? '',
        Total_Votes: String(row.votes ?? 100 - index),
        Candidate_First_Pref_Votes: String(row.votes ?? 100 - index),
        Status: row.elected ? 'Elected' : 'Not Elected',
        id: index
      }))
    }
  };
}

const partyOf = (raw, surname) => raw.Constituency.countGroup.find((row) => row.Surname === surname).Party_Name;

test('a count row carries its printed label to the candidate', () => {
  const [candidate] = summarizeCandidateRows([
    { Candidate_Id: '1', Firstname: 'John', Surname: 'Redmond', Party_Name: 'Home Rule', Party_As_Printed: 'HR (P)', Count_Number: '1', Total_Votes: '100', Candidate_First_Pref_Votes: '100' }
  ]);
  assert.equal(candidate.party, 'Home Rule');
  assert.equal(candidate.partyAsPrinted, 'HR (P)');
  assert.equal(partyAsPrintedLabel(candidate), 'HR (P)');
  assert.equal(printedLabelText(candidate), 'HR (P)');
});

test('a printed label is kept verbatim even where it is the party itself; the ballot description comes first', () => {
  const [candidate] = summarizeCandidateRows([
    { Candidate_Id: '1', Firstname: 'A', Surname: 'B', Party_Name: 'Republican', Party_As_Printed: 'Republican', Count_Number: '1', Total_Votes: '5' }
  ]);
  assert.equal(candidate.partyAsPrinted, 'Republican', 'the column shows what was printed, whatever it is');
  assert.equal(printedLabelText(candidate), 'Republican');
  assert.equal(printedLabelText({ party: 'DUP', ballotDescription: 'Democratic Unionist Party - D.U.P.', partyAsPrinted: 'DUP' }), 'Democratic Unionist Party - D.U.P.');
  assert.equal(printedLabelText({ party: 'UUP' }), '', 'blank where nothing was printed');
  assert.equal(partyAsPrintedLabel({ party: 'Home Rule', partyAsPrinted: '' }), '');
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

test('the interpretation mapping fills blank readings and keeps the printed text', () => {
  const raw = contest([
    { surname: 'Brice', printed: 'R.A.' },
    { surname: 'Neill', printed: 'Indep.' },
    { surname: 'Gray', printed: 'Indep. U.' },
    { surname: 'Bell', printed: 'Lib.' },
    { surname: 'Kerr', printed: 'U.', party: 'UUP' }
  ]);
  interpreter.apply({ body: 'bangor-borough-council', date: '1964-05-20' }, raw);
  assert.equal(partyOf(raw, 'Brice'), "Ratepayers' Association");
  assert.equal(partyOf(raw, 'Neill'), 'Independent');
  assert.equal(partyOf(raw, 'Gray'), 'Independent Unionist');
  assert.equal(partyOf(raw, 'Bell'), 'Ulster Liberal');
  assert.equal(partyOf(raw, 'Kerr'), 'UUP', 'an existing reading is left alone');
  assert.equal(raw.Constituency.countGroup[0].Party_As_Printed, 'R.A.', 'the printed label is never changed');
});

test('a scoped rule applies only in its body and years, and an override replaces a wrong reading', () => {
  const newry1964 = contest([
    { surname: 'Connolly', printed: 'I.L.', party: 'Independent Labour' },
    { surname: 'Ruddy', printed: 'N.L.' }
  ]);
  interpreter.apply({ body: 'newry-urban-district-council', date: '1964-05-20' }, newry1964);
  assert.equal(partyOf(newry1964, 'Connolly'), 'Irish Labour');
  assert.equal(partyOf(newry1964, 'Ruddy'), 'Newry Labour');
  const belfast = contest([{ surname: 'Craig', printed: 'I.L.', party: 'Independent Labour' }]);
  interpreter.apply({ body: 'belfast-county-borough-council', date: '1925-01-15' }, belfast);
  assert.equal(partyOf(belfast, 'Craig'), 'Independent Labour', 'I.L. elsewhere stays Independent Labour');
  const lib1929 = contest([{ surname: 'Old', printed: 'Lib.' }]);
  interpreter.apply({ body: 'bangor-borough-council', date: '1929-01-15' }, lib1929);
  assert.equal(partyOf(lib1929, 'Old'), '', 'no Ulster Liberal Party before 1956');
});

test('"do." takes the reading of the candidate printed above it', () => {
  const raw = contest([
    { surname: 'Towers', printed: 'Nationalist', party: 'Nationalist Party' },
    { surname: 'Bonner', printed: 'do.' },
    { surname: 'Callaghan', printed: 'Labour', party: 'NI Labour' },
    { surname: 'Next', printed: 'do.' }
  ]);
  interpreter.apply({ body: 'londonderry-county-borough-council', date: '1931-01-15' }, raw);
  assert.equal(partyOf(raw, 'Bonner'), 'Nationalist Party');
  assert.equal(partyOf(raw, 'Next'), 'NI Labour');
  assert.equal(raw.Constituency.countGroup[1].Party_As_Printed, 'do.', 'the ditto mark stays as printed');
});

test('honours are not party labels: J.P. alone reads No label, J.P. (U.) reads UUP', () => {
  const raw = contest([
    { surname: 'Dickson', printed: 'J.P.', elected: true },
    { surname: 'Clements', printed: 'O.B.E., J.P.' },
    { surname: 'Dunlop', printed: 'V.S.' },
    { surname: 'Hamill', printed: 'J.P. (U.)' }
  ]);
  interpreter.apply({ body: 'downpatrick-urban-district-council', date: '1923-01-15' }, raw);
  assert.equal(partyOf(raw, 'Dickson'), '');
  assert.equal(partyOf(raw, 'Clements'), '');
  assert.equal(partyOf(raw, 'Dunlop'), '');
  assert.equal(partyOf(raw, 'Hamill'), 'UUP');
  const summary = buildPartySummary([summarizeResult(raw, 'Test Ward')]);
  assert.ok(summary.some((row) => row.party === NO_LABEL), 'counted under No label');
});

test('a blank label is No label: its own group, never Independent, never the winning party', () => {
  const raw = contest([
    { surname: 'Gibson', party: 'UUP', elected: true, votes: 300 },
    { surname: 'Seyers', party: '', elected: true, votes: 200 },
    { surname: 'Irwin', party: 'Independent', votes: 100 }
  ]);
  const result = summarizeResult(raw, 'Test Ward');
  const summary = buildPartySummary([result]);
  const byParty = Object.fromEntries(summary.map((row) => [row.party, row]));
  assert.equal(NO_LABEL, 'No label');
  assert.equal(byParty[NO_LABEL]?.seats, 1, 'the unlabelled member is a No label seat');
  assert.equal(byParty.UUP?.seats, 1, 'not added to the winning party');
  assert.equal(byParty.Independent?.seats, 0, 'and not folded into Independent');
  assert.equal(summary.some((row) => row.party === 'Independent/Other'), false);
  assert.match(partyColour(NO_LABEL), /^#d4d4d4$/i, 'neutral grey');
});

test('the default view hides printed labels: the column is rendered but hidden by CSS', () => {
  globalThis.localStorage = undefined;
  assert.equal(printedLabelsShown(), false);
  const toggle = printedLabelsToggleHtml((value) => String(value));
  assert.match(toggle, /data-printed-labels-toggle/);
  assert.doesNotMatch(toggle, /checked/);
  assert.match(toggle, /Show labels as printed/);
  for (const [file, cls] of [['site/assets/css/main.css', 'election-col-printed'], ['site/browse/browse.css', 'browse-col-printed']]) {
    const css = read(file).replace(/\r\n/g, '\n');
    assert.match(css, new RegExp(`\\.${cls} \\{\\n  display: none;`), `${file} hides the column by default`);
    assert.match(css, new RegExp(`:root\\[data-show-printed-labels\\] \\.${cls} \\{\\n  display: table-cell;`), `${file} shows it on request`);
  }
  const manager = read('packages/map/app/election-manager.js');
  assert.doesNotMatch(manager, />printed \$\{/, 'no inline "printed X" under the party in the map app');
  const browse = read('site/browse/browse.js');
  assert.doesNotMatch(browse, /partyAsPrintedHtml\(/, 'no inline "printed X" in Browse');
  assert.match(browse, /browse-col-printed/);
});

test('the toggle shows them, remembers the choice and survives blocked storage', () => {
  const store = new Map();
  const attributes = new Set();
  const inputs = [{ checked: false }, { checked: false }];
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.document = {
    documentElement: {
      setAttribute: (name) => attributes.add(name),
      removeAttribute: (name) => attributes.delete(name)
    },
    querySelectorAll: () => inputs,
    addEventListener: () => {}
  };
  try {
    setPrintedLabelsShown(true);
    assert.equal(store.get(PRINTED_LABELS_STORAGE_KEY), '1');
    assert.ok(attributes.has(PRINTED_LABELS_ROOT_ATTRIBUTE), 'root attribute set: CSS shows the column');
    assert.ok(inputs.every((input) => input.checked), 'every toggle on the page follows');
    assert.equal(printedLabelsShown(), true);
    assert.match(printedLabelsToggleHtml((value) => String(value)), /checked/);
    setPrintedLabelsShown(false);
    assert.equal(store.has(PRINTED_LABELS_STORAGE_KEY), false);
    assert.equal(attributes.has(PRINTED_LABELS_ROOT_ATTRIBUTE), false);
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    assert.equal(printedLabelsShown(), false);
    assert.doesNotThrow(() => setPrintedLabelsShown(true));
    assert.ok(attributes.has(PRINTED_LABELS_ROOT_ATTRIBUTE), 'still applies to this page');
  } finally {
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});
