/**
 * The Elections app's results map (el-maps, 14 Nov 2026): the tie-aware winner
 * (site/apps/elections/lib/most-seats.js), the modes, margins, scales, close-contests filter and
 * patterns (lib/map-modes.js), the URL state (lib/map-state.js), and the view's key and list
 * markup (views/map.js legendHtml, closeTableHtml).
 *
 *   node --test elections-app-map-modes.test.mjs (in the unit tests folder)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { mostSeats, seatsByParty, tookSeat } from '../../site/apps/elections/lib/most-seats.js';
import {
  MAP_PATTERNS, MAP_TEXT, NO_DATA, TIES_LISTED, bundleAreas, classEdges, classOf, closeContests, contestMargin, divergingScale, fill,
  isClose, modeFigures, partyShareIn, pollToppers, rgbaOf, sequentialScale, sortRows, spoiltShare, stripeImage,
} from '../../site/apps/elections/lib/map-modes.js';
import { mapStateQuery, parseMapState } from '../../site/apps/elections/lib/map-state.js';
import { MAP_MODES, mapModeShown } from '../../site/apps/elections/state-machines.js';
import { VIEW_TEXT, closeTableHtml, legendHtml } from '../../site/apps/elections/views/map.js';
import { rampColours } from '../../site/pkg/registries/src/browser/colour-palettes.mjs';

/** A candidate of a bundle: name, party, first preferences, elected, and totals by count. */
function cand(name, party, first, elected = false, totals = [], extra = {}) {
  return { name, party, colour: '#123456', firstPrefs: first, elected, status: elected ? 'Elected' : 'Not elected', counts: totals.map((t, i) => ({ count: i + 1, total: t })), ...extra };
}

/** A contest of a bundle. */
function contest(name, candidates, extra = {}) {
  return { constituency: name, featureName: name.toUpperCase(), matched: true, seatsTotal: 1, votingSystem: 'fptp', candidates, ...extra };
}

test('most seats: one party, a tie kept as a tie, none, and seats without a poll', () => {
  const one = mostSeats([cand('A', 'X', 10, true), cand('B', 'X', 9, true), cand('C', 'Y', 8, true), cand('D', 'Z', 5)]);
  assert.deepEqual([one.parties, one.seats, one.tie], [['X'], 2, false]);
  // East Antrim 2022's shape: two parties two seats each; the summary's winnerParty named one.
  const tie = mostSeats([cand('A', 'DUP', 6256, true), cand('B', 'Alliance', 5000, true), cand('C', 'DUP', 4000, true), cand('D', 'Alliance', 3900, true), cand('E', 'UUP', 3000, true)]);
  assert.deepEqual([tie.parties, tie.seats, tie.tie], [['DUP', 'Alliance'], 2, true]);
  assert.deepEqual(mostSeats([cand('A', 'X', 10)]).parties, []);
  // Returned unopposed and the Ceann Comhairle returned automatically take seats; no party is "No party recorded".
  assert.equal(tookSeat({ status: 'Elected unopposed', elected: false }), true);
  assert.equal(tookSeat({ autoReturnedCeannComhairle: true }), true);
  assert.deepEqual(seatsByParty([{ party: '', status: 'Elected unopposed' }]).map((r) => r.party), ['No party recorded']);
});

test('margins: the last-seat gap of an STV count, at the runner-up\'s last count', () => {
  // Belfast North 2022, the last counts: McAllister elected at 11 on 6,563.03, Mallon not, 5,571.82.
  const [a] = bundleAreas({ results: [contest('Belfast North', [
    cand('Kelly', 'SF', 8395, true, [8395, 7672, 7672], { electedAt: 1 }),
    cand('Brett', 'DUP', 6329, true, [6329, 7000, 7719.37], { electedAt: 3 }),
    cand('McAllister', 'Alliance', 4381, true, [4381, 6000, 6563.03], { electedAt: 3 }),
    cand('Mallon', 'SDLP', 3604, false, [3604, 5000, 5571.82]),
    cand('McDowell', 'TUV', 3335, false, [3335, 4261.41, 0], { excludedAt: 2 }),
  ], { seatsTotal: 3, votingSystem: 'stv-gregory', validPoll: 46027 })] });
  const m = contestMargin(a);
  assert.ok(!('reason' in m));
  assert.equal(m.votes, 991.21);
  assert.equal(m.winner.name, 'McAllister');
  assert.equal(m.runnerUp.name, 'Mallon');
  assert.equal(m.count, 3);
  assert.ok(Math.abs(/** @type {number} */ (m.pct) - 2.1535) < 0.001);
  // A member elected at an earlier count sits at the quota: not the one the runner-up nearly beat.
  assert.match(fill(MAP_PATTERNS.marginAtCount, { votes: '991.21', pct: '2.15%', winner: 'McAllister (Alliance)', runnerUp: 'Mallon (SDLP)', count: 3 }), /at count 3$/);
});

test('margins: first past the post, the block vote, and the contests that have none', () => {
  const areas = bundleAreas({ results: [
    contest('Fptp', [cand('A', 'X', 600, true), cand('B', 'Y', 400)], { validPoll: 1000 }),
    contest('Block', [cand('A', 'X', 900, true), cand('B', 'Y', 800, true), cand('C', 'Z', 750)], { seatsTotal: 2, validPoll: 2450 }),
    contest('Unopposed', [cand('A', 'X', null, true, [], { status: 'Elected unopposed' })], { contestStatus: 'uncontested' }),
    contest('Losers missing', [cand('A', 'X', 500, true), cand('B', 'Y', 400, true)], { seatsTotal: 2, validPoll: 900 }),
    contest('STV no stages', [cand('A', 'X', 500, true), cand('B', 'Y', 400, true), cand('C', 'Z', 300)], { seatsTotal: 2, votingSystem: 'stv', quota: 401, validPoll: 1200 }),
    contest('STV on quotas', [cand('A', 'X', 500, true), cand('B', 'Y', 450, true), cand('C', 'Z', 250)], { seatsTotal: 2, votingSystem: 'stv', quota: 401, validPoll: 1200 }),
    contest('Ceann Comhairle', [cand('CC', 'FF', null, true, [], { status: 'Elected (auto returned)', autoReturnedCeannComhairle: true }), cand('A', 'X', 700, true), cand('B', 'Y', 650)], { seatsTotal: 2, validPoll: 1350 }),
  ] });
  const [fptp, block, unopposed, losers, noStages, onQuotas, cc] = areas.map(contestMargin);
  /** The votes of a margin, or the reason it has none. @param {ReturnType<typeof contestMargin>} m */
  const said = (m) => ('reason' in m ? m.reason : m.votes);
  assert.equal(said(fptp), 200);
  assert.equal('reason' in fptp ? null : fptp.pct, 20);
  assert.equal(said(block), 50);
  assert.equal(said(unopposed), MAP_TEXT.unopposed);
  assert.equal(said(losers), MAP_TEXT.losersMissing);
  assert.equal(said(noStages), MAP_TEXT.stagesMissing);
  assert.equal(said(onQuotas), 200);
  assert.equal(said(cc), 50, 'the seat returned without a poll is not the weakest winner');
  assert.equal(isClose(fptp, 300, 'votes'), true);
  assert.equal(isClose(fptp, 20, 'pct'), false, 'under, not up to');
  assert.equal(isClose(unopposed, 1e9, 'votes'), false);
});

test('poll-toppers, shares, spoilt ballots', () => {
  const [a, b] = bundleAreas({ results: [
    contest('A', [cand('P', 'X', 500, true), cand('Q', 'Y', 500), cand('R', 'Y', 100)], { totalPoll: 1120, validPoll: 1100 }),
    contest('B', [cand('S', 'X', 700, true), cand('T', 'Z', 300)], { spoiled: 10, validPoll: 1000 }),
  ] });
  assert.deepEqual(pollToppers(a).map((c) => c.name), ['P', 'Q']);
  assert.deepEqual(partyShareIn(a, 'Y'), { share: (100 * 600) / 1100, stood: true });
  assert.deepEqual(partyShareIn(b, 'Y'), { share: 0, stood: false });
  assert.ok(Math.abs(/** @type {number} */ (spoiltShare(a)) - (100 * 20) / 1120) < 1e-9, 'spoilt = cast less valid when not given');
  assert.ok(Math.abs(/** @type {number} */ (spoiltShare(b)) - (100 * 10) / 1010) < 1e-9, 'cast = valid plus spoilt when not given');
});

test('modes: ties are striped and keyed, no figure is hatched, swing matches by contest', () => {
  const areas = bundleAreas({ results: [
    contest('Tie', [cand('A', 'DUP', 50, true), cand('B', 'Alliance', 60, true), cand('C', 'UUP', 10)], { seatsTotal: 2, validPoll: 120 }),
    contest('Won', [cand('D', 'DUP', 70, true), cand('E', 'Alliance', 30)], { validPoll: 100 }),
    contest('Missing', [cand('F', 'DUP', null, true), cand('G', 'Alliance', null)]),
  ] });
  const w = modeFigures(areas, 'winner');
  assert.equal(w.figures[0].pattern, 'tie:Alliance|DUP');
  assert.deepEqual(w.patterns.get('tie:Alliance|DUP'), ['#123456', '#123456']);
  assert.equal(w.figures[0].text, 'Tie: Alliance, DUP, 1 seat each');
  assert.equal(w.figures[1].text, 'DUP (D)');
  assert.match(w.figures[2].text, /votes not recorded/);
  assert.deepEqual(w.legend.map((l) => l.kind), ['swatch', 'swatch', 'split']);
  const t = modeFigures(areas, 'turnout');
  assert.ok(t.figures.every((f) => f.pattern === NO_DATA && f.value === null));
  assert.deepEqual(t.legend.at(-1), { kind: 'none', colours: [], label: MAP_TEXT.noData });
  const before = bundleAreas({ results: [contest('Won', [cand('D', 'DUP', 60, true), cand('E', 'Alliance', 40)])] });
  const s = modeFigures(areas, 'swing', { party: 'DUP', before, beforeTitle: 'Earlier' });
  assert.equal(s.figures[0].text, MAP_TEXT.noMatch);
  assert.equal(s.figures[1].value, 10);
  assert.equal(s.figures[1].text, 'DUP +10.0 points (60.0% to 70.0%)');
  assert.equal(s.title, "Change in DUP's share since Earlier (points)");
  // Many ties share one key entry.
  const many = bundleAreas({ results: Array.from({ length: TIES_LISTED + 1 }, (_, i) => contest(`T${i}`, [cand('A', `P${i}`, 5, true), cand('B', `Q${i}`, 4, true)], { seatsTotal: 2 })) });
  const mw = modeFigures(many, 'winner');
  assert.deepEqual(mw.legend.filter((l) => l.kind === 'split').map((l) => l.label), [MAP_TEXT.keyTies]);
});

test('margin mode: the closer, the darker; the filter keeps the close contests, sortable', () => {
  const areas = bundleAreas({ results: [
    contest('Close', [cand('A', 'X', 510, true), cand('B', 'Y', 490)], { validPoll: 1000 }),
    contest('Safe', [cand('C', 'X', 900, true), cand('D', 'Y', 100)], { validPoll: 1000 }),
    contest('Middle', [cand('E', 'Y', 600, true), cand('F', 'X', 400)], { validPoll: 1000 }),
  ] });
  const m = modeFigures(areas, 'margin');
  const seq = rampColours.sequential;
  assert.equal(m.figures[0].colour, seq[seq.length - 1], 'closest darkest');
  assert.equal(m.figures[1].colour, seq[0], 'safest lightest');
  const dark = modeFigures(areas, 'margin', { dark: true });
  assert.equal(dark.figures[0].colour, seq[0], 'on a dark page the closest is the lightest');
  const rows = closeContests(m.figures, 300, 'votes');
  assert.deepEqual(rows.map((r) => r.name), ['Close', 'Middle']);
  assert.deepEqual(sortRows(rows, 'votes', 'desc').map((r) => r.name), ['Middle', 'Close']);
  assert.deepEqual(sortRows(rows, 'name', 'asc').map((r) => r.name), ['Close', 'Middle']);
  assert.deepEqual(sortRows([{ v: null }, { v: 2 }, { v: 1 }], 'v', 'desc').map((r) => r.v), [2, 1, null], 'missing last either way');
});

test('scales: nice class edges, the class of a value, the swing scale around zero', () => {
  assert.deepEqual(classEdges([58.4, 69.5]), [57.5, 60, 62.5, 65, 67.5, 70]);
  const e = classEdges([3.2, 63.7]);
  assert.ok(e.length - 1 <= 5 && e[0] <= 3.2 && e.at(-1) >= 63.7);
  assert.deepEqual(classEdges([0, 100]), [0, 20, 40, 60, 80, 100]);
  assert.equal(classOf(0, [0, 20, 40]), 0);
  assert.equal(classOf(20, [0, 20, 40]), 1);
  assert.equal(classOf(40, [0, 20, 40]), 1, 'the top class takes its top');
  const s = sequentialScale([0, 50, 100, null], (v, d) => v.toFixed(d));
  assert.equal(s.colourOf(null), null);
  assert.deepEqual(s.legend.map((l) => l.label), ['0–20', '20–40', '40–60', '60–80', '80–100']);
  const d = divergingScale([-7, 3, null], (v) => v.toFixed(1));
  assert.equal(d.colourOf(0.1), rampColours.divergingMid);
  assert.equal(d.colourOf(-7), rampColours.divergingLow[0]);
  assert.equal(d.colourOf(3), rampColours.divergingHigh[1]);
  assert.equal(d.legend.length, 9);
  assert.deepEqual(sequentialScale([58.4, 69.5], (v, d) => v.toFixed(d)).legend[0].label, '57.5–60.0', 'decimals as the edges need');
});

test('patterns: stripes of the tied colours, the hatch on nothing', () => {
  assert.deepEqual(rgbaOf('#ff8000'), [255, 128, 0, 255]);
  assert.deepEqual(rgbaOf('#abc'), [170, 187, 204, 255]);
  const tie = stripeImage(['#ff0000', '#0000ff']);
  assert.equal(tie.data.length, tie.width * tie.height * 4);
  assert.equal(tie.width % 8, 0, 'whole periods, so it tiles');
  assert.deepEqual([...tie.data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...tie.data.slice(4 * 4, 4 * 4 + 4)], [0, 0, 255, 255]);
  const hatch = stripeImage(['#8a8f98'], { gap: true });
  assert.deepEqual([...hatch.data.slice(4 * 4, 4 * 4 + 4)], [0, 0, 0, 0], 'the gap is clear');
});

test('URL state: parsed and written back; old links read as before', () => {
  const s = parseMapState(new URLSearchParams('e=x&mode=margin&under=500&sort=-pct'));
  assert.deepEqual(s, { e: 'x', mode: 'margin', party: null, vs: null, under: 500, unit: 'votes', sort: { key: 'pct', dir: 'desc' } });
  assert.equal(mapStateQuery(s), 'e=x&mode=margin&under=500&sort=-pct');
  const old = parseMapState(new URLSearchParams('e=y&mode=swing&party=DUP&vs=z'));
  assert.equal(mapStateQuery(old), 'e=y&mode=swing&party=DUP&vs=z');
  const bad = parseMapState(new URLSearchParams('mode=nonsense&under=-3&unit=pct&sort=nope'));
  assert.deepEqual([bad.mode, bad.under, bad.unit, bad.sort], ['winner', null, 'pct', { key: 'pct', dir: 'asc' }]);
  assert.equal(mapStateQuery({ ...bad, under: 2 }), 'mode=winner&under=2&unit=pct');
  assert.deepEqual(mapModeShown('swing', { party: true, vs: true, sameBoundaries: false }), { mode: 'share', reason: 'boundaries' });
  assert.deepEqual(mapModeShown('margin', { party: false, vs: false }), { mode: 'margin', reason: null });
});

test('the key and the close-contests list: words with every colour, sort state on the headers', () => {
  const key = legendHtml('Title', [
    { kind: 'swatch', colours: ['#111111'], label: 'One' },
    { kind: 'split', colours: ['#111111', '#222222'], label: 'Tie' },
    { kind: 'none', colours: [], label: MAP_TEXT.noData },
  ]);
  assert.match(key, /aria-label="Title"/);
  assert.match(key, /--legend-colour:#111111;--legend-colour-2:#222222/);
  assert.match(key, /cg-legend__swatch--none" aria-hidden="true"><\/span>No figure \(hatched\)/);
  const table = closeTableHtml([{ name: 'A', winner: 'W', runnerUp: 'R', votes: 5, pct: 0.5, count: 3 }], { key: 'votes', dir: 'asc' }, '10 votes');
  assert.match(table, /aria-sort="ascending"><button type="button" class="el-sort" data-sort="votes">/);
  assert.match(table, /aria-sort="none"><button type="button" class="el-sort" data-sort="name">/);
  assert.match(table, /<caption class="el-sr">Contests with a margin under 10 votes, sorted by Margin \(votes\) \(ascending\)<\/caption>/);
});

test('every word of the map is keyed for translation in en.json (R10)', () => {
  const en = JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings;
  const english = new Set(Object.values(en));
  for (const s of [...Object.values(MAP_TEXT), ...Object.values(MAP_PATTERNS), ...Object.values(VIEW_TEXT), ...MAP_MODES.map((m) => m.label)]) {
    assert.ok(english.has(s), `not keyed: ${s}`);
  }
});
