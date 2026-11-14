/**
 * Contests whose sources name only the winners (countInfo Candidates_Recorded "winners"; the
 * Seanad's 1938-97 panels and its by-elections): a poll was held, but the losers and the votes are
 * not known. They are built as contested with no figures, never "Elected unopposed"; the Elections
 * app says "Only the winners are on record"; check:contest-arithmetic skips them. A fixture contest
 * (tests/fixtures/winners-only/labour-panel.json) is run through each step.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contestStatusForResult, summarizeResult } from '../../packages/core/src/election-domain.mjs';
import { contestPollStatus, isWinnersOnlyRecord, summaryPollStatus, WINNERS_ONLY } from '../../packages/core/src/unopposed.mjs';
import { countSheet } from '../../site/apps/elections/lib/count.js';
import { NOTE, contestLimits, winnersOnly } from '../../site/apps/elections/lib/limits.js';
import { checkContest } from '../../scripts/check/rules/contest-arithmetic.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/winners-only/labour-panel.json', import.meta.url), 'utf8'));
/** The same file without the field: three winners for three seats and no votes. */
const withoutField = () => {
  const raw = structuredClone(FIXTURE);
  delete raw.Constituency.countInfo.Candidates_Recorded;
  return raw;
};

test('core: the field is read from a contest file\'s countInfo, a built contest and a summary row', () => {
  assert.equal(WINNERS_ONLY, 'winners');
  assert.equal(isWinnersOnlyRecord({ countInfo: { Candidates_Recorded: 'winners' } }), true);
  assert.equal(isWinnersOnlyRecord({ candidatesRecorded: 'winners' }), true);
  assert.equal(isWinnersOnlyRecord({ countInfo: { Candidates_Recorded: 'all' } }), false);
  assert.equal(isWinnersOnlyRecord({}), false);
  assert.equal(isWinnersOnlyRecord(null), false);
});

test('the manifest: the record carries the field and is contested, never unopposed', () => {
  const result = summarizeResult(FIXTURE, 'Labour Panel');
  assert.equal(result.candidatesRecorded, 'winners');
  assert.equal(result.seatsTotal, 3);
  assert.equal(result.candidates?.filter((c) => c.elected).length, 3);
  assert.ok(result.candidates?.every((c) => c.status === 'Elected'), 'each winner reads Elected');
  assert.equal(contestStatusForResult(result), 'contested');
  // Without the field, the same winners with no votes are an unopposed return, as before.
  const plain = summarizeResult(withoutField(), 'Labour Panel');
  assert.equal(plain.candidatesRecorded, undefined);
  assert.equal(contestStatusForResult(plain), 'uncontested');
  // The pre-1973 council rule is unchanged too, and the field wins over it.
  assert.equal(contestStatusForResult({ ...plain, seatsTotal: 5 }, { shortNominationsUnopposed: true }), 'uncontested');
  assert.equal(contestStatusForResult({ ...result, seatsTotal: 5 }, { shortNominationsUnopposed: true }), 'contested');
  assert.equal(contestStatusForResult({ candidates: [] }), 'contested');
});

test('the manifest builder uses core\'s rule and expects no transfers from a winners-only contest', () => {
  const source = readFileSync(new URL('../../scripts/build/build-test2-election-manifest.mjs', import.meta.url), 'utf8');
  assert.match(source, /ElectionDomain\.contestStatusForResult\(/);
  assert.doesNotMatch(source, /^function contestStatusForResult\(/m, 'no copy of the rule in the builder');
  assert.match(source, /ElectionDomain\.isWinnersOnlyRecord\(result\)\) return false/);
  const summaries = readFileSync(new URL('../../scripts/build/build-test2-election-summaries.mjs', import.meta.url), 'utf8');
  assert.match(summaries, /candidatesRecorded: result\.candidatesRecorded/);
});

test('poll status: votes not recorded, from the candidates and from a summary row alike', () => {
  const result = summarizeResult(FIXTURE, 'Labour Panel');
  assert.equal(contestPollStatus({ contestStatus: contestStatusForResult(result), candidates: result.candidates }), 'not-recorded');
  const row = { validPoll: 0, leadingVotes: 0, candidateCount: 3, seatsTotal: 3 };
  assert.equal(summaryPollStatus(row), 'unopposed', 'a summary row without the field reads unopposed');
  assert.equal(summaryPollStatus({ ...row, candidatesRecorded: 'winners' }), 'not-recorded');
});

test('the Elections app: "Only the winners are on record", never "Returned unopposed"', () => {
  const result = summarizeResult(FIXTURE, 'Labour Panel');
  const contest = { ...result, contestStatus: contestStatusForResult(result) };
  const sheet = countSheet(/** @type {Array<Record<string, unknown>>} */ (result.candidates), { seatsTotal: 3, contestStatus: contest.contestStatus });
  assert.equal(sheet.kind, 'none');
  assert.equal(winnersOnly(contest), true);
  const limits = contestLimits(sheet, contest);
  assert.deepEqual(limits.notes, [{ id: 'winners', sentences: [NOTE.winnersOnly] }]);
  assert.equal(limits.losersMissing, true, 'no runner-up, so no majority');
  assert.equal(NOTE.winnersOnly, 'Only the winners are on record: the other candidates and the votes are not known.');
  const english = JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings;
  assert.equal(english['elections.limits.winners_only'], NOTE.winnersOnly, 'the note is keyed (R10)');
  // The contest view shows the note in place of the kind's own ("only the candidates are known").
  const view = readFileSync(new URL('../../site/apps/elections/views/contest.js', import.meta.url), 'utf8');
  assert.match(view, /const kindNote = winnersOnly\(c\) \? '' : KIND_NOTE\[sheet\.kind\]/);
  // A contest without the field keeps the old notes.
  assert.equal(winnersOnly({}), false);
});

test('check:contest-arithmetic skips a winners-only contest, with a note', () => {
  const base = {
    electionKey: 'seanad-eireann__1938-04-27', seq: 0, name: 'Labour Panel', sourceFile: 'labour-panel.json', bodySlug: 'seanad-eireann',
    group: 'other', date: '1938-04-27', votingSystem: 'stv-gregory', contestStatus: 'contested', seats: 3, electorate: null, quota: null,
    validPoll: null, totalPoll: null, spoiled: null, votesPerElector: null, nonTransferable: [],
    candidates: ['A', 'B', 'C'].map((name) => ({ ord: 0, name, firstPrefs: null, finalVotes: null, elected: true, electedAt: null, excluded: false,
      excludedAt: null, status: 'Elected', unopposed: false, autoReturned: false, stages: new Map() })),
  };
  const findings = checkContest({ ...base, info: { Candidates_Recorded: 'winners' } });
  assert.deepEqual(findings, [{ rule: 'winners-only', kind: 'info', detail: 'only the winners are on record: no figures to check' }]);
  // Without the field the same contest is checked, and its missing votes are listed.
  assert.ok(checkContest({ ...base, info: {} }).some((f) => f.kind === 'missing'));
});
