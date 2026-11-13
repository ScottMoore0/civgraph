/**
 * The Elections app's notes on the data's known limits (site/apps/elections/lib/limits.js, EL2):
 * each note is decided from the data in front of the view and shown only where its limit applies,
 * and every sentence is keyed for translation (R10).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  COUNTED_PATTERNS, NOTE, contestLimits, counted, countsTransfers, limitHtml, pivotLimits, pivotLimitsSql, summaryLosersMissing,
  swingLimit, votesMissingNote,
} from '../../site/apps/elections/lib/limits.js';
import { countSheet } from '../../site/apps/elections/lib/count.js';
import { esc, fmtInt } from '../../site/apps/elections/lib/format.js';

const cand = (name, firstPrefs, elected = true, extra = {}) => ({ name, firstPrefs, elected, status: elected ? 'Elected' : 'Not elected', counts: firstPrefs === null ? [] : [{ count: 1, total: firstPrefs }], ...extra });

test('a polled contest with no more candidates than seats notes its missing losers, and no other contest does', () => {
  const short = countSheet([cand('A', 500), cand('B', 400)], { seatsTotal: 2 });
  const r = contestLimits(short, {});
  assert.equal(r.losersMissing, true);
  assert.deepEqual(r.notes.map((n) => n.id), ['losers']);
  // The valid poll is the elected members' votes summed, so the note says so.
  assert.deepEqual(r.notes[0].sentences, [NOTE.losersMissing, NOTE.electedVotesOnly]);
  // A source valid poll larger than the sum: only the majority is lost.
  assert.deepEqual(contestLimits(countSheet([cand('A', 500), cand('B', 400)], { seatsTotal: 2, validPoll: 1500 }), {}).notes[0].sentences, [NOTE.losersMissing, NOTE.noMajority]);
  // The contest file's flag: the source printed only the members elected.
  assert.equal(contestLimits(short, { losersNotPrinted: true }).notes[0].sentences[0], NOTE.losersNotPrinted);

  const full = countSheet([cand('A', 500), cand('B', 400), cand('C', 100, false)], { seatsTotal: 2 });
  assert.deepEqual(contestLimits(full, {}), { notes: [], losersMissing: false, votesMissing: 0 });
  // Unopposed and no-votes contests have their own notice (lib/count.js kinds), never this one.
  const unopposed = countSheet([{ name: 'A', status: 'Elected unopposed', elected: true }], { seatsTotal: 1, contestStatus: 'uncontested' });
  assert.equal(unopposed.kind, 'unopposed');
  assert.deepEqual(contestLimits(unopposed, {}).notes, []);
  const none = countSheet([cand('A', null), cand('B', null, false)], { seatsTotal: 1 });
  assert.deepEqual(contestLimits(none, {}), { notes: [], losersMissing: false, votesMissing: 0 });
});

test('candidates with no vote figure in a polled contest are counted for their note', () => {
  const sheet = countSheet([cand('A', 500), cand('B', 400), cand('C', null, false), cand('D', null, false)], { seatsTotal: 2 });
  const r = contestLimits(sheet, {});
  assert.equal(r.votesMissing, 2);
  assert.equal(r.losersMissing, false);
  assert.deepEqual(votesMissingNote(2, fmtInt), { id: 'votes', sentences: ['2 candidates have no vote figure in the sources Civgraph holds.'] });
  assert.deepEqual(votesMissingNote(1, fmtInt)?.sentences, ['1 candidate has no vote figure in the sources Civgraph holds.']);
  assert.equal(votesMissingNote(0, fmtInt), null);
  // An auto-returned Ceann Comhairle has no poll, so no missing figure.
  const cc = countSheet([cand('CC', 0, true, { status: 'Elected (auto returned)', autoReturnedCeannComhairle: true }), cand('A', 500), cand('B', 300, false)], { seatsTotal: 2 });
  assert.equal(contestLimits(cc, {}).votesMissing, 0);
});

test('an election summary row is marked when its contest was polled but has no more candidates than seats', () => {
  assert.equal(summaryLosersMissing({ candidateCount: 9, seatsTotal: 9, validPoll: 6511, leadingVotes: 864 }), true);
  assert.equal(summaryLosersMissing({ candidateCount: 11, seatsTotal: 9, validPoll: 6511, leadingVotes: 864 }), false);
  // Returned unopposed (no votes): not a missing-losers contest.
  assert.equal(summaryLosersMissing({ candidateCount: 3, seatsTotal: 3, validPoll: 0, leadingVotes: 0 }), false);
  assert.equal(counted('electionLosers', 1, fmtInt), "Party votes and shares leave out the losing candidates' votes in 1 contest, whose losers are not on file.");
  assert.equal(counted('electionLosers', 4, fmtInt), "Party votes and shares leave out the losing candidates' votes in 4 contests, whose losers are not on file.");
});

test('the swingometer caveat comes from the registry flag: STV systems transfer, first past the post does not', () => {
  assert.equal(countsTransfers('stv-gregory'), true);
  assert.equal(countsTransfers('stv-hare'), true);
  assert.equal(countsTransfers('fptp'), false);
  assert.equal(countsTransfers(null), false);
  assert.deepEqual(swingLimit('stv-gregory'), { id: 'transfers', sentences: [NOTE.transfers] });
  assert.equal(swingLimit('fptp'), null);
});

test('the pivot notes follow the table: a note only for a dimension, filter or measure it uses, with its own counts', () => {
  const counts = { total: 1000, gender: 20, incumbent_unknown: 50, no_party: 160, unopposed: 300 };
  const base = { rows: 'party', cols: 'year', measure: 'seats', filters: {} };
  // Party by year of seats: the party note only (seats count unopposed returns, so no unopposed note).
  assert.deepEqual(pivotLimits(base, counts, fmtInt).map((n) => n.id), ['party']);
  assert.deepEqual(pivotLimits(base, counts, fmtInt)[0].sentences, [NOTE.partyAsPrinted, '160 of the 1,000 candidacies in this table have no party recorded.']);
  // Gender as a dimension: how many have it recorded, and that it is never inferred.
  const g = pivotLimits({ ...base, rows: 'gender' }, counts, fmtInt);
  assert.deepEqual(g.map((n) => n.id), ['gender']);
  assert.deepEqual(g[0].sentences, ['Gender is recorded for 20 of the 1,000 candidacies in this table.', NOTE.genderNeverInferred]);
  // A gender filter counts too.
  assert.deepEqual(pivotLimits({ ...base, rows: 'year', cols: 'none', filters: { gender: ['F'] } }, counts, fmtInt).map((n) => n.id), ['gender']);
  // Incumbency: marked as worked out, with the unknowns counted.
  const i = pivotLimits({ ...base, rows: 'incumbent', cols: 'none' }, counts, fmtInt);
  assert.deepEqual(i[0].sentences, [NOTE.incumbencyDerived, 'Incumbency is unknown for 50 of the 1,000 candidacies in this table (no person link, or no earlier election of the body on file).']);
  // A vote measure over rows with unopposed returns.
  assert.deepEqual(pivotLimits({ ...base, rows: 'year', cols: 'none', measure: 'share' }, counts, fmtInt).map((n) => n.id), ['unopposed']);
  assert.deepEqual(pivotLimits({ ...base, rows: 'year', cols: 'none', measure: 'votes' }, { ...counts, unopposed: 0 }, fmtInt), []);
  // Nothing in the table, nothing to say.
  assert.deepEqual(pivotLimits({ ...base, rows: 'gender' }, { ...counts, total: 0 }, fmtInt), []);
  // The counts' SQL carries the table's own filters.
  assert.match(pivotLimitsSql("WHERE party IN ('DUP')"), /FROM rows WHERE party IN \('DUP'\)$/);
  assert.match(pivotLimitsSql(''), /party = 'No party recorded'/);
});

test('a note is one span a sentence, escaped, with its limit named', () => {
  const html = limitHtml({ id: 'losers', sentences: ['A <b>.', 'B.'] }, esc);
  assert.equal(html, '<p class="cg-notice" data-limit="losers"><span>A &lt;b&gt;.</span> <span>B.</span></p>');
  assert.match(limitHtml({ id: 'leaders', sentences: [NOTE.leaders] }, esc, 'el-muted'), /^<p class="el-muted" data-limit="leaders">/);
});

test('every note is keyed for translation in en.json (R10)', () => {
  const en = JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings;
  const english = new Set(Object.values(en));
  for (const s of [...Object.values(NOTE), ...COUNTED_PATTERNS]) assert.ok(english.has(s), `not keyed: ${s}`);
});
