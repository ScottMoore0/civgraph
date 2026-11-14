/**
 * Readable STV counts in the Elections app (el-stv, 14 Nov 2026): site/apps/elections/lib/stv.js
 * (what each count did, its sentences, the quota's formula, the last seat's margin, the transfer
 * matrices), lib/sankey.js (the whole count as a flow) and the HTML of views/stv-contest.js and
 * views/stv-election.js. Nothing may be invented: a count without a loss is "not recorded", and
 * votes passed on together are never split by source.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { countSheet } from '../../site/apps/elections/lib/count.js';
import {
  STV_TEXT, closestSeats, contestMatrix, countEvents, countLabel, countSentences, droopQuota, electedFrom, inQuotas, lastSeatMargin,
  marginSentence, orderLabels, partyTransfers, quotaExplained, standingAt, stepFromQuery, stepSearch, stepTo, transfersOpen, transfersSearch,
} from '../../site/apps/elections/lib/stv.js';
import { SANKEY_TEXT, countSankey, heldVotes } from '../../site/apps/elections/lib/sankey.js';
import { STV_VIEW_TEXT, afterSheetHtml, matrixHtml, quotaSectionHtml, signed, stvParts } from '../../site/apps/elections/views/stv-contest.js';
import { STV_ELECTION_TEXT, closestSeatsHtml, electionStvHtml, partyTransfersHtml } from '../../site/apps/elections/views/stv-election.js';
import { STV_TRANSFERS } from '../../site/apps/elections/state-machines.js';

/** A candidate with a total at each count (null: no cell at that count). */
function cand(id, party, totals, extra = {}) {
  return {
    id, name: id, party, colour: '#123456', firstPrefs: totals[0], elected: false, electedAt: null, excludedAt: null,
    counts: totals.map((total, i) => (total === undefined ? null : { count: i + 1, total, transfers: null })).filter((k) => k && k.total !== null),
    ...extra,
  };
}

/**
 * Northern Ireland style: every candidate keeps a total to the end. Quota 1001 (3000 / 3 + 1, 2 seats).
 * Count 2: A's surplus of 199 (B +150, C +40, 9 non-transferable). Count 3: D excluded (100: B +60, C +30, 10 n/t).
 * Count 4: B and C... B elected with 1050 at count 3; count 4: B's surplus 49 to C (+49).
 */
const NI = [
  cand('A', 'Red', [1200, 1001, 1001, 1001], { elected: true, electedAt: 1 }),
  cand('B', 'Blue', [840, 990, 1050, 1001], { elected: true, electedAt: 3 }),
  cand('C', 'Red', [860, 900, 930, 979], { excludedAt: null }),
  cand('D', 'Green', [100, 100, 0, 0], { excludedAt: 2 }),
];
const niSheet = () => countSheet(NI, { quota: 1001, validPoll: 3000, seatsTotal: 2 });

test('Northern Ireland style: each count labelled with what it did, from the totals', () => {
  const sheet = niSheet();
  assert.equal(sheet.kind, 'stages');
  const ev = countEvents(sheet);
  assert.deepEqual(ev.map((e) => e.kind), ['first', 'surplus', 'exclusion', 'surplus']);
  assert.deepEqual(ev.map(countLabel), [
    'Count 1: first preferences',
    "Count 2: distribution of A's surplus (199)",
    'Count 3: exclusion of D (100)',
    "Count 4: distribution of B's surplus (49)",
  ]);
  // Non-transferable: not given by the source, so worked out (passed on less received).
  assert.equal(ev[1].nonTransferable, 9);
  assert.equal(ev[1].ntRecorded, false);
  assert.equal(ev[2].nonTransferable, 10);
  assert.equal(ev[3].nonTransferable, 0);
  assert.deepEqual(ev[1].gains.map((g) => [g.id, g.amount]), [['B', 150], ['C', 40]]);
});

test('each count has plain sentences: what moved, who gained most, what could not be passed on, who was elected', () => {
  const sheet = niSheet();
  const ev = countEvents(sheet);
  assert.deepEqual(countSentences(ev[0], sheet.quota), ['The first preferences were counted.', 'The quota is 1,001 votes.', 'A reached the quota and was elected.']);
  assert.deepEqual(countSentences(ev[1], sheet.quota), [
    'A had 199 votes more than the quota, and these were passed on to the next preferences marked.',
    'B gained the most, 150 votes.',
    '9 votes did not pass to any candidate (worked out from the totals).',
    'D was excluded.',
  ]);
  assert.deepEqual(countSentences(ev[2], sheet.quota), [
    'D was excluded, and their 100 votes were passed on to the next preferences marked.',
    'B gained the most, 60 votes.',
    '10 votes did not pass to any candidate (worked out from the totals).',
    'B reached the quota and was elected.',
  ]);
  assert.ok(countSentences(ev[3], sheet.quota).includes('This was the last count.'));
});

test('a non-transferable figure the source gives is used, and said to be the source\'s', () => {
  const sheet = countSheet(NI, { quota: 1001, validPoll: 3000, seatsTotal: 2, nonTransferable: [{ count: 2, total: 9, transfers: 9 }] });
  const ev = countEvents(sheet);
  assert.equal(ev[1].ntRecorded, true);
  assert.match(countSentences(ev[1], sheet.quota).join(' '), /9 votes could not be passed on, because no further preference/);
});

/**
 * The Dáil style: a candidate's column stops once excluded or elected. Quota 1001. Count 1: A
 * 1300 (made quota), E and F excluded at 1. Count 2: E and F's 120 passed on together (B +70,
 * C +50). Count 3: A's waiting surplus of 299 (B +200, C +80; 19 n/t). Count 4: C excluded at 3 (B +900).
 */
const DAIL = [
  cand('A', 'Red', [1300], { elected: true, electedAt: 1 }),
  cand('B', 'Blue', [700, 770, 970, 1870], { elected: true, electedAt: 4 }),
  cand('C', 'Red', [700, 750, 830], { excludedAt: 3 }),
  cand('E', 'Green', [80], { excludedAt: 1 }),
  cand('F', 'Green', [40], { excludedAt: 1 }),
];
const dailSheet = () => countSheet(DAIL, { quota: 1001, validPoll: 2820, seatsTotal: 1 });

test('the Dáil style: a stopped column is an exclusion or a waiting surplus, the largest first', () => {
  const sheet = dailSheet();
  const ev = countEvents(sheet);
  assert.deepEqual(ev.map((e) => e.kind), ['first', 'exclusion', 'surplus', 'exclusion']);
  assert.equal(countLabel(ev[1]), 'Count 2: exclusion of E, F (120)');
  assert.equal(countLabel(ev[2]), "Count 3: distribution of A's surplus (299)");
  assert.equal(ev[2].nonTransferable, 19);
  assert.equal(countLabel(ev[3]), 'Count 4: exclusion of C (830)');
  // Votes passed on together are said to be one pool, never split by source.
  assert.ok(countSentences(ev[1], sheet.quota).some((s) => /shown as one pool/.test(s)));
  // B never reached the quota... it did at count 4 (1870), so it was elected there.
  assert.equal(electedFrom(sheet.rows.find((r) => r.id === 'B'), sheet.stages, sheet.quota), 4);
  // The waiting surplus is taken off A's held votes for the flow.
  assert.deepEqual(heldVotes(sheet, ev).get('A'), [1300, 1300, 1001, 1001]);
});

test('gains no loss explains and no surplus waiting: "not recorded"; a count where nothing moved says so', () => {
  const rows = [
    cand('A', 'Red', [500, 600, 600]),
    cand('B', 'Blue', [400, 400, 400], { elected: true, electedAt: 3 }),
  ];
  const sheet = countSheet(rows, { quota: 401, validPoll: 900, seatsTotal: 1 });
  const ev = countEvents(sheet);
  assert.deepEqual(ev.map((e) => e.kind), ['first', 'unrecorded', 'quiet']);
  assert.equal(countLabel(ev[1]), 'Count 2: what was distributed is not recorded');
  assert.ok(countSentences(ev[1], sheet.quota).includes(STV_TEXT.unrecorded));
  assert.equal(countLabel(ev[2]), 'Count 3: no votes moved');
  // Elected at count 3 below the quota.
  assert.ok(countSentences(ev[2], sheet.quota).includes('B was elected without reaching the quota.'));
});

test('a source that declares everyone at the last count: reaching the quota and being declared are both said', () => {
  const rows = [
    cand('A', 'Red', [1100, 1001, 1001], { elected: true, electedAt: 3 }),
    cand('B', 'Blue', [800, 890, 890], { elected: true, electedAt: 3 }),
    cand('C', 'Red', [100, 100, 100]),
  ];
  const sheet = countSheet(rows, { quota: 1001, validPoll: 2000, seatsTotal: 2 });
  const ev = countEvents(sheet);
  assert.equal(ev[1].kind, 'surplus', 'a fall from over the quota is a surplus, whatever count the source names');
  assert.ok(countSentences(ev[0], sheet.quota).includes('A reached the quota.'));
  assert.ok(countSentences(ev[2], sheet.quota).includes('A was declared elected.'));
  assert.ok(countSentences(ev[2], sheet.quota).includes('B was elected without reaching the quota.'));
  assert.equal(standingAt(sheet, 1).find((s) => s.row.id === 'A')?.state, 'elected');
});

test('a count-order sheet: who was elected or excluded at each count, and "not recorded" between', () => {
  const rows = [
    { ...cand('A', 'Red', [500]), elected: true, electedAt: 3 },
    { ...cand('B', 'Blue', [300]), excludedAt: 1 },
    { ...cand('C', 'Red', [200]), excludedAt: 3 },
  ];
  const sheet = countSheet(rows, { quota: 400, validPoll: 1000, seatsTotal: 1 });
  assert.equal(sheet.kind, 'order');
  assert.deepEqual(countEvents(sheet), []);
  assert.deepEqual(orderLabels(sheet).map((l) => l.label), ['Count 1: exclusion of B', 'Count 2: not recorded', 'Count 3: exclusion of C; A elected']);
  assert.match(afterSheetHtml(sheet, []), /Count 2: not recorded/);
});

test('the quota: the Droop formula with the contest\'s figures, or what differs, never a percentage', () => {
  assert.equal(droopQuota(43248, 5), 7209);
  assert.equal(droopQuota(3000, 2), 1001);
  const ok = quotaExplained({ quota: 7209, validPoll: 43248, seats: 5 });
  assert.equal(ok?.matches, true);
  assert.equal(ok?.sentence, 'The quota is 7,209 votes: the valid poll of 43,248 divided by 6 (the 5 seats plus one), rounded down, plus one. This is the Droop quota.');
  const off = quotaExplained({ quota: 7300, validPoll: 43248, seats: 5 });
  assert.equal(off?.matches, false);
  assert.match(off?.sentence || '', /gives a quota of 7,300 votes\. The Droop formula on the valid poll here gives 7,209/);
  assert.match(quotaExplained({ quota: null, validPoll: 43248, seats: 5 })?.sentence || '', /gives no quota\. The Droop formula .* 7,209 votes/);
  assert.equal(quotaExplained({ quota: 1, validPoll: null, seats: 5 }), null);
  // An outgoing Ceann Comhairle returned without a poll takes no seat of the count.
  assert.equal(quotaExplained({ quota: 10734, validPoll: 42934, seats: 4, rows: [{ autoReturned: true }, { autoReturned: false }] })?.matches, true);
  assert.equal(inQuotas(8195, 7209), '1.14 quotas');
  assert.doesNotMatch(inQuotas(8195, 7209), /%/);
});

test('the last seat: the margin between the last elected and the runner-up while the runner-up still held votes', () => {
  const m = lastSeatMargin(niSheet());
  assert.deepEqual(m && [m.lastElected.id, m.runnerUp.id, m.margin, m.stage], ['B', 'C', 22, 4]);
  assert.equal(m && marginSentence(m), 'B won the last seat ahead of C by 22 votes at count 4.');
  // The Dáil style: C's column stops at count 3, its last count with votes; B had 970 there.
  const d = lastSeatMargin(dailSheet());
  assert.deepEqual(d && [d.lastElected.id, d.runnerUp.id, d.margin, d.stage], ['B', 'C', 140, 3]);
  // No margin without stage totals, without a loser, or for a seat won from behind.
  assert.equal(lastSeatMargin(countSheet([cand('A', 'R', [10]), cand('B', 'B', [5])], { seatsTotal: 1 })), null);
  const behind = countSheet([cand('A', 'R', [50, 50], { elected: true, electedAt: 2 }), cand('B', 'B', [60, 60])], { quota: 56, seatsTotal: 1 });
  assert.equal(lastSeatMargin(behind), null);
});

test('the contest\'s transfer matrix: one row a count, from whom to whom, pooled rows marked', () => {
  const m = contestMatrix(countEvents(dailSheet()));
  assert.deepEqual(m.map((r) => [r.stage, r.pooled, [...r.cells.entries()], r.nonTransferable]), [
    [2, true, [['B', 70], ['C', 50]], 0],
    [3, false, [['B', 200], ['C', 80]], 19],
    [4, false, [['B', 900]], 0],
  ]);
  const html = matrixHtml(dailSheet(), countEvents(dailSheet()));
  assert.match(html, /passed on together/);
  assert.match(html, /19\*/, 'a worked-out non-transferable figure is marked');
  assert.match(html, /el-narrow-only/, 'a stacked twin for phones');
  assert.match(html, /tabindex="0" role="region"/, 'the wide table scrolls from the keyboard');
});

test('party-to-party transfers: only single-candidate counts, with how many contests they cover', () => {
  const pt = partyTransfers([niSheet(), dailSheet(), countSheet([cand('X', 'R', [10])], { seatsTotal: 1 })]);
  assert.equal(pt.contestsTotal, 3);
  assert.equal(pt.contestsWithStages, 2);
  assert.equal(pt.contests, 2);
  assert.equal(pt.pooled, 1, "the Dáil sheet's count 2 passed on two candidates together");
  assert.equal(pt.transfers, 5);
  const red = pt.rows.find((r) => r.from === 'Red');
  // A's 199 (NI) + A's 299 and C's 830 (Dáil).
  assert.equal(red?.distributed, 1328);
  assert.deepEqual(red && [...red.to.entries()].sort(), [['Blue', 1250], ['Red', 120]]);
  assert.equal(red?.nonTransferable, 28);
  const html = partyTransfersHtml(pt).replace(/&#39;/g, "'");
  assert.match(html, /Built from 2 of the 3 contests, from the 5 counts that passed on one candidate's votes\./);
  assert.match(html, /1 count that passed on several candidates' votes together is left out/);
  assert.match(html, /1 contest has no stage-by-stage count/);
  assert.match(partyTransfersHtml(partyTransfers([])), /there are no transfers between parties to show/);
});

test('closest last seats: closest first, with how many contests have a margin', () => {
  const c = closestSeats([{ sheet: dailSheet(), name: 'D', href: '/d/' }, { sheet: niSheet(), name: 'N', href: null }, { sheet: countSheet([], {}), name: 'E', href: null }]);
  assert.deepEqual(c.list.map((x) => [x.name, x.margin.margin]), [['N', 22], ['D', 140]]);
  assert.equal(c.covered, 2);
  assert.equal(c.total, 3);
  const html = closestSeatsHtml(c);
  assert.match(html, /Margins are given for 2 of the 3 contests/);
  assert.match(html, /<a href="\/d\/">D<\/a>/);
});

test('the stepper\'s URL state: ?count= parsed and written, the first count without one', () => {
  const stages = [1, 2, 3, 4];
  assert.equal(stepFromQuery(new URLSearchParams('count=3'), stages), 3);
  assert.equal(stepFromQuery(new URLSearchParams('count=9'), stages), 1);
  assert.equal(stepFromQuery(new URLSearchParams(''), stages), 1);
  assert.equal(stepSearch('?a=1', 3, stages), '?a=1&count=3');
  assert.equal(stepSearch('?count=3', 1, stages), '');
  assert.deepEqual(['first', 'prev', 'next', 'last'].map((m) => stepTo(/** @type {any} */ (m), 2, stages)), [1, 1, 3, 4]);
  assert.equal(stepTo('next', 4, stages), 4);
  assert.equal(stepTo('prev', 1, stages), 1);
  assert.equal(transfersOpen(new URLSearchParams('transfers=1')), true);
  assert.equal(transfersSearch('?x=1', true), '?x=1&transfers=1');
  assert.equal(transfersSearch('?transfers=1', false), '');
});

test('the whole count as a flow: names at both ends, bands titled, the pool drawn as one grey block, natural size', () => {
  const svg = countSankey(dailSheet(), countEvents(dailSheet()));
  assert.match(svg, /^<svg viewBox="0 0 (\d+) (\d+)" width="\1" height="\2" role="img" aria-labelledby/);
  assert.match(svg, /<title id="el-sankey-title">The whole count as a flow<\/title>/);
  assert.match(svg, />B \(elected\)</);
  assert.match(svg, />E</);
  assert.match(svg, /120 votes passed on together at count 2/);
  assert.match(svg, /A to B: 200/);
  assert.match(svg, />Non-transferable</);
  assert.doesNotMatch(svg, /E to B|F to B/, 'votes passed on together are never split by source');
  assert.equal(countSankey(countSheet([cand('A', 'R', [10])], { seatsTotal: 1 }), []), '');
});

test('the contest page parts: labels list and stacked counts for a stage sheet, quota and margin, stepper, matrix, flow', () => {
  const parts = stvParts(niSheet(), new URLSearchParams('count=2'));
  assert.match(parts.afterSheet, /<ol class="el-count-labels"><li>Count 1: first preferences<\/li>/);
  assert.match(parts.afterSheet, /class="el-stacked el-narrow-only"/);
  assert.match(parts.sections, /data-stv-stepper/);
  assert.match(parts.sections, /Count 2 of 4/);
  assert.match(parts.sections, /id="el-matrix"/);
  assert.match(parts.sections, /class="el-sankey"/);
  assert.match(quotaSectionHtml(niSheet()), /data-quota-formula="droop"/);
  assert.match(quotaSectionHtml(niSheet()), /B won the last seat ahead of C by 22 votes at count 4\./);
  assert.equal(signed(-3426.32), '−3,426.32');
  assert.equal(signed(1869), '+1,869');
  assert.equal(signed(0), '');
  assert.match(electionStvHtml(true), /<details class="el-stv-load" open>/);
  assert.doesNotMatch(electionStvHtml(false), / open>/);
});

test('STV_TRANSFERS: read once when opened; every move not in its table is refused', () => {
  STV_TRANSFERS.assertPath(['loading', 'failed', 'loading', 'shown']);
  for (const from of STV_TRANSFERS.states) {
    for (const to of STV_TRANSFERS.states) {
      const listed = STV_TRANSFERS.transitions[from].includes(to);
      assert.equal(STV_TRANSFERS.can(from, to), listed, `${from} -> ${to}`);
    }
  }
  assert.equal(STV_TRANSFERS.can('shown', 'loading'), false, 'what is shown is not read again');
});

test('every word is keyed for translation in en.json (R10)', () => {
  const en = new Set(Object.values(JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings));
  for (const table of [STV_TEXT, SANKEY_TEXT, STV_VIEW_TEXT, STV_ELECTION_TEXT]) {
    for (const s of Object.values(table)) if (/[A-Za-z]/.test(s)) assert.ok(en.has(s), `not keyed: ${s}`);
  }
});
