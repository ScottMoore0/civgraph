/**
 * The Elections app's correctness, accessibility and referendum fixes (stream el-fixes, 14 Nov 2026):
 * ties in multi-member seats, the swingometer's base, the folded party, signed figures with
 * separators, reader words for sources, the referendum template and the
 * announcer and scroll-area choices.
 *
 *   node --test tests/unit/elections-app-fixes.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { seatCountsByParty } from '../../packages/core/src/election-domain.mjs';
import { mostSeats } from '../../site/apps/elections/lib/most-seats.js';
import { WINNER_WORDS, contestWinner, winnerCellHtml, winnerChanged, winnerText } from '../../site/apps/elections/lib/winner.js';
import { SWING_WORDS, anchoredSeats, baseContests, project, projectFromResult } from '../../site/apps/elections/lib/project.js';
import { DIMENSIONS, DEFAULT_STATE, pivotSql, stateFromQuery } from '../../site/apps/elections/lib/pivot.js';
import { NOTE, pivotLimits } from '../../site/apps/elections/lib/limits.js';
import { esc, fmtDelta, fmtInt, fmtPct } from '../../site/apps/elections/lib/format.js';
import { SOURCE_WORDS, sourceWords } from '../../site/apps/elections/lib/source-words.js';
import { REFERENDUM_WORDS, referendumAreas, referendumOptions, referendumTotals, resultWords } from '../../site/apps/elections/lib/referendum.js';
import { A11Y_WORDS, announcement, focusAfter, scrollAreaName } from '../../site/apps/elections/lib/a11y.js';

const fmt = (/** @type {number} */ n) => fmtInt(n);

// ------------------------------------------------------------------ winners

test('seatCountsByParty counts the elected by party, largest first, ties by name', () => {
  assert.deepEqual(seatCountsByParty([{ party: 'UUP' }, { party: 'Sinn Féin' }, { party: 'TUV' }, { party: 'DUP' }, { party: 'Alliance' }]),
    { Alliance: 1, DUP: 1, 'Sinn Féin': 1, TUV: 1, UUP: 1 });
  assert.deepEqual(Object.entries(seatCountsByParty([{ party: 'UUP' }, { party: 'Alliance' }, { party: 'DUP' }, { party: 'Alliance' }, { party: 'DUP' }])),
    [['Alliance', 2], ['DUP', 2], ['UUP', 1]]);
  assert.deepEqual(seatCountsByParty([{ party: '' }]), { 'No party recorded': 1 });
  // Equal seats rank by the elected's first preferences, as the results map ranks them.
  assert.deepEqual(Object.keys(seatCountsByParty([{ party: 'B', firstPrefs: 900 }, { party: 'A', firstPrefs: 500 }])), ['B', 'A']);
});

test('the overview, Compare and the map find the same winner: one tie rule (lib/most-seats.js)', () => {
  const cases = [
    [{ party: 'UUP', elected: true, firstPrefs: 9000 }, { party: 'SF', elected: true, firstPrefs: 9500 }, { party: 'DUP', elected: true, firstPrefs: 7000 }, { party: 'X', elected: false, firstPrefs: 100 }],
    [{ party: 'A', elected: true, firstPrefs: 1 }, { party: 'A', elected: true, firstPrefs: 1 }, { party: 'B', elected: true, firstPrefs: 5 }],
    [{ party: 'A', elected: true, firstPrefs: 3 }, { party: 'B', elected: true, firstPrefs: 4 }, { party: 'A', elected: true }, { party: 'B', elected: true }, { party: '', elected: true }],
  ];
  for (const cands of cases) {
    const map = mostSeats(cands);
    const row = { seatsTotal: cands.length, seatsByParty: seatCountsByParty(cands.filter((c) => c.elected)) };
    const w = contestWinner(row);
    assert.deepEqual(w.parties, map.parties);
    assert.equal(w.kind === 'tie', map.tie);
    assert.equal(w.seats, map.seats);
  }
});

test('a five-way tie is a tie, never "UUP most seats" (North Antrim 2022)', () => {
  const row = { constituency: 'North Antrim', seatsTotal: 5, winnerParty: 'UUP', leadingName: 'Philip McGuigan', seatsByParty: { Alliance: 1, DUP: 1, 'Sinn Féin': 1, TUV: 1, UUP: 1 } };
  const w = contestWinner(row);
  assert.equal(w.kind, 'tie');
  assert.deepEqual(w.parties, ['Alliance', 'DUP', 'Sinn Féin', 'TUV', 'UUP']);
  assert.equal(w.seats, 1);
  assert.equal(winnerText(w, fmt), 'Alliance, DUP, Sinn Féin, TUV, UUP (tied, 1 seat each)');
  const html = winnerCellHtml(row, (p) => `<b>${p}</b>`, esc, fmt);
  assert.match(html, /data-winner="tie"/);
  assert.doesNotMatch(html, /most seats/);
  assert.match(html, /<b>UUP<\/b>/);
});

test('a two-way tie at two seats, and a clear "most seats"', () => {
  const east = contestWinner({ seatsTotal: 5, winnerParty: 'Alliance', seatsByParty: { Alliance: 2, DUP: 2, UUP: 1 } });
  assert.equal(east.kind, 'tie');
  assert.equal(winnerText(east, fmt), 'Alliance, DUP (tied, 2 seats each)');
  const bann = contestWinner({ seatsTotal: 5, winnerParty: 'DUP', seatsByParty: { DUP: 2, 'Sinn Féin': 1, UUP: 1, Alliance: 1 } });
  assert.deepEqual([bann.kind, bann.parties, bann.seats], ['most', ['DUP'], 2]);
  assert.equal(winnerText(bann, fmt), `DUP (${WINNER_WORDS.mostSeats})`);
});

test('a summary built before seatsByParty reads as before; a single seat is its winner', () => {
  assert.deepEqual(contestWinner({ seatsTotal: 4, winnerParty: 'SF' }), { kind: 'most', parties: ['SF'], seats: null, name: null });
  // A single STV seat: the elected candidate, not the leader on the first count.
  const by = contestWinner({ seatsTotal: 1, seatsWon: 1, winnerParty: 'FG', winnerName: 'A Winner', leadingParty: 'FF', leadingName: 'A Leader' });
  assert.deepEqual(by, { kind: 'single', parties: ['FG'], seats: 1, name: 'A Winner' });
  assert.equal(contestWinner({ seatsTotal: 1 }).kind, 'none');
});

test('a winner changes when the party or the tie changes, not when the same tie repeats', () => {
  const tie = (/** @type {string[]} */ ps) => ({ kind: /** @type {const} */ ('tie'), parties: ps, seats: 2, name: null });
  const one = (/** @type {string} */ p) => ({ kind: /** @type {const} */ ('most'), parties: [p], seats: 2, name: null });
  assert.equal(winnerChanged(tie(['A', 'B']), tie(['B', 'A'])), false);
  assert.equal(winnerChanged(tie(['A', 'B']), one('A')), true);
  assert.equal(winnerChanged(one('A'), one('A')), false);
  assert.equal(winnerChanged(one('A'), one('B')), true);
});

// ------------------------------------------------------------------ swingometer

test('the swingometer starts from the seats won, not the model of them', () => {
  // A 5-seat STV contest where quotas of first preferences give A three seats, but A won two.
  const rows = [
    { area: 'X', party: 'A', votes: 52, seats: 2 }, { area: 'X', party: 'B', votes: 30, seats: 2 }, { area: 'X', party: 'C', votes: 18, seats: 1 },
  ];
  const contests = baseContests(rows);
  assert.equal(project(contests, new Map()).seats.get('A'), 3, 'the model alone gives A three');
  const base = projectFromResult(contests, new Map()).seats;
  assert.deepEqual([...base].sort(), [['A', 2], ['B', 2], ['C', 1]]);
  // A swing the model does not turn into a seat changes nothing.
  assert.deepEqual([...projectFromResult(contests, new Map([['A', 1]])).seats].sort(), [['A', 2], ['B', 2], ['C', 1]]);
  // A swing that moves a model seat moves a real one.
  const moved = projectFromResult(contests, new Map([['C', 30]])).seats;
  assert.equal([...moved.values()].reduce((s, n) => s + n, 0), 5, 'the seats add up');
  assert.deepEqual([...moved].sort(), [['A', 1], ['B', 2], ['C', 2]], 'the seat the model moves from A to C moves from A to C');
});

test('anchoredSeats takes only seats a party holds and gives back what no gain claims', () => {
  const won = new Map([['A', 1], ['B', 2]]);
  // The model moves a seat from C (which won none) to A: nothing to take, nothing changes.
  assert.deepEqual([...anchoredSeats(won, new Map([['C', 1], ['B', 2]]), new Map([['A', 1], ['B', 2]]), new Map())], [['A', 1], ['B', 2]]);
  // B loses one to A.
  assert.deepEqual([...anchoredSeats(won, new Map([['A', 1], ['B', 2]]), new Map([['A', 2], ['B', 1]]), new Map())].sort(), [['A', 2], ['B', 1]]);
});

test('an unopposed contest counts in the actual seats and never moves', () => {
  const contests = baseContests([{ area: 'U', party: 'A', votes: 0, seats: 1 }, { area: 'P', party: 'A', votes: 40, seats: 0 }, { area: 'P', party: 'B', votes: 60, seats: 1 }]);
  assert.equal(contests.length, 2);
  assert.deepEqual([...projectFromResult(contests, new Map([['A', 30]])).seats].sort(), [['A', 2]]);
});

// ------------------------------------------------------------------ pivot

test('the pivot offers the folded party, the ballot label kept apart', () => {
  assert.equal(DIMENSIONS.party_folded.label, 'Party');
  assert.equal(DIMENSIONS.party.label, 'Party (ballot label)');
  assert.equal(DEFAULT_STATE.rows, 'party_folded');
  assert.equal(stateFromQuery(new URLSearchParams('rows=party')).rows, 'party', 'an old link keeps the ballot label');
  const sql = pivotSql({ ...stateFromQuery(new URLSearchParams('rows=party_folded&cols=year&f.party=SF')) });
  assert.match(sql, /COALESCE\(pf\.pf_name, party\) AS r/);
  assert.match(sql, /LEFT JOIN \(SELECT party_slug AS pf_slug, first\(party ORDER BY n DESC, party\)/);
  assert.match(sql, /WHERE party IN \('SF'\)/);
  assert.doesNotMatch(pivotSql(stateFromQuery(new URLSearchParams('rows=party&cols=year'))), /pf_name/);
  const notes = pivotLimits({ rows: 'party_folded', cols: 'year', measure: 'seats', filters: {} }, { total: 10, gender: 0, incumbent_unknown: 0, no_party: 0, unopposed: 0 }, fmt);
  assert.deepEqual(notes.map((n) => n.sentences), [[NOTE.partyFolded]]);
});

// ------------------------------------------------------------------ formats and words

test('signed changes over 999 keep their thousands separator', () => {
  assert.equal(fmtDelta(1869), '+1,869');
  assert.equal(fmtDelta(-3426.32, 2), '−3,426.32');
  assert.equal(fmtDelta(12), '+12');
  assert.equal(fmtDelta(0), '0');
});

test('a source reads in words: no basis code, kind from the registry, scope said, one badge', () => {
  const w = sourceWords({ title: 'https://example.org/ark:/1234', url: 'https://www.example.org/ark:/1234', kind: 'news', scope: 'article', check: 'partly checked: names the candidates, vote figures not found', checked: false });
  assert.equal(w.title, 'example.org');
  assert.equal(w.kind, 'newspaper');
  assert.equal(w.scope, SOURCE_WORDS.coversArticle);
  assert.equal(w.badge, 'partly');
  assert.equal(w.note, 'names the candidates, vote figures not found');
  const n = sourceWords({ title: 'A', kind: 'official-count-sheets', scope: 'odd-code', check: 'not checked: blocked or paywalled' });
  assert.deepEqual([n.kind, n.scope, n.badge, n.note], ['', '', 'unchecked', 'blocked or paywalled']);
  assert.equal(sourceWords({ title: 'B', checked: true, check: 'every figure read' }).badgeText, SOURCE_WORDS.checked);
});

// ------------------------------------------------------------------ referendums

test('a referendum: options Yes then No, totals over every area, the result in words', () => {
  const options = referendumOptions([{ party: 'No', votes: 1021546, share: 67.69, colour: '#d46a4c' }, { party: 'Yes', votes: 487564, share: 32.31, colour: '#2aa82c' }]);
  assert.deepEqual(options.map((o) => o.option), ['Yes', 'No']);
  assert.equal(resultWords(options, (v) => fmtPct(v)), 'The proposal was rejected: 67.7% voted No.');
  assert.equal(resultWords(referendumOptions([{ party: 'Remain', votes: 440707, share: 55.8 }, { party: 'Leave', votes: 349442, share: 44.2 }]), (v) => fmtPct(v)), 'Remain won, with 55.8% of the valid votes.');
  const rows = [
    { constituency: 'Carlow–Kilkenny', featureName: 'Carlow-Kilkenny (5)', validPoll: 49546, electorate: 117528, totalPoll: 50176, turnoutPct: 42.7, leadingParty: 'No', leadingVotes: 35028, leadingPct: 70.7, candidateCount: 2, majority: 20510 },
    { constituency: 'Clare', validPoll: 40000, electorate: 90000, totalPoll: 40500, turnoutPct: 45, leadingParty: 'No', leadingVotes: 27160, candidateCount: 2 },
  ];
  const t = referendumTotals(rows);
  assert.equal(t.electorate, 207528);
  assert.equal(t.totalPoll, 90676);
  assert.ok(Math.abs(Number(t.turnout) - 43.69) < 0.01);
  assert.equal(referendumTotals([{ electorate: 1 }, {}]).electorate, null, 'no total over some areas only');
  const [a, b] = referendumAreas(rows, options);
  assert.deepEqual([a.feature, a.winner, a.votes.Yes, a.votes.No, a.majority], ['CARLOW-KILKENNY (5)', 'No', 14518, 35028, 20510]);
  assert.ok(Math.abs(Number(a.shares.Yes) - 29.3) < 0.001);
  assert.equal(b.votes.Yes, 12840);
  assert.equal(b.majority, 14320);
});

// ------------------------------------------------------------------ accessibility

test('the announcer says a short line; focus returns to the control or goes to the h1', () => {
  assert.equal(announcement('Compare elections'), 'Loaded Compare elections.');
  assert.equal(announcement(''), '');
  assert.deepEqual(focusAfter({ keepScroll: true, activeId: 'cmp-a', has: () => true }), { to: 'control', id: 'cmp-a' });
  assert.deepEqual(focusAfter({ keepScroll: true, activeId: 'gone', has: () => false }), { to: 'heading' });
  assert.deepEqual(focusAfter({ keepScroll: false, activeId: 'cmp-a', has: () => true }), { to: 'heading' });
  assert.equal(scrollAreaName({ caption: "Count sheet: each candidate's total at each count" }), 'Count sheet');
  assert.equal(scrollAreaName({ heading: 'Contests' }), 'Contests');
  assert.equal(scrollAreaName({ diagram: true }), A11Y_WORDS.diagram);
  assert.equal(scrollAreaName({}), A11Y_WORDS.table);
});

test('every new wording is keyed for translation in en.json (R10)', () => {
  const en = JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings;
  const english = new Set(Object.values(en));
  const all = [...Object.values(WINNER_WORDS), ...Object.values(SWING_WORDS), NOTE.partyFolded, ...Object.values(A11Y_WORDS),
    ...Object.values(SOURCE_WORDS), ...Object.values(REFERENDUM_WORDS), DIMENSIONS.party_folded.label];
  for (const s of all) assert.ok(english.has(s), `not keyed: ${s}`);
});
