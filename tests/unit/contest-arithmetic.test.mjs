// The contest arithmetic check (scripts/check/rules/contest-arithmetic.mjs, arith-audit
// 11 Nov 2026) over small made-up contests: what each rule passes and what it fails.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bodyGroup, checkContest } from '../../scripts/check/rules/contest-arithmetic.mjs';

/** A candidate; stages as [[count, total, transfers, status], ...]. */
function cand(name, firstPrefs, { elected = false, electedAt = null, excluded = false, excludedAt = null, status = '', stages = [] } = {}) {
  return {
    ord: 0, name, firstPrefs, finalVotes: firstPrefs, elected, electedAt, excluded, excludedAt, status,
    unopposed: /unopposed/i.test(status), autoReturned: false,
    stages: new Map(stages.map(([s, total, transfers = 0, st = '']) => [s, { total, transfers, status: st }])),
  };
}

function contest(over = {}) {
  return {
    electionKey: 'x__2000-01-01', seq: 0, name: 'Test', sourceFile: 'test.json', bodySlug: 'dail-eireann', group: 'dail',
    date: '2000-01-01', votingSystem: 'fptp', contestStatus: 'contested', seats: 1, electorate: null, quota: null,
    validPoll: null, totalPoll: null, spoiled: null, votesPerElector: null, info: {}, nonTransferable: [], candidates: [],
    ...over,
  };
}

const rules = (c) => checkContest(c).filter((f) => f.kind === 'fail').map((f) => f.rule).sort();

test('body groups', () => {
  assert.equal(bodyGroup('house-of-commons-of-the-united-kingdom', '1950-02-23'), 'westminster');
  assert.equal(bodyGroup('local-government', '1973-05-30'), 'ni-council-1973+');
  assert.equal(bodyGroup('belfast-county-borough-council', '1949-05-18'), 'ni-council-1921-67');
  assert.equal(bodyGroup('bangor-borough-council', '1904-01-15'), 'ni-council-pre-1921');
  assert.equal(bodyGroup('northern-ireland-forum-for-political-dialogue', '1996-05-30'), 'ni-assembly');
  assert.equal(bodyGroup('ireland-referendum', '2015-05-22'), 'referendum');
});

test('FPTP: votes add up, the top candidate wins, poll figures agree', () => {
  const ok = contest({
    validPoll: 300, totalPoll: 305, spoiled: 5, electorate: 500, info: { Turnout_Pct: '61.0', Majority_Printed: '100' },
    candidates: [cand('A', 200, { elected: true }), cand('B', 100)],
  });
  assert.deepEqual(rules(ok), []);
  const bad = contest({
    validPoll: 310, totalPoll: 300, spoiled: 5, electorate: 250, info: { Turnout_Pct: '50', Majority_Printed: '90' },
    candidates: [cand('A', 100, { elected: true }), cand('B', 200)],
  });
  assert.deepEqual(rules(bad), ['electorate-poll', 'fptp-majority', 'fptp-sum', 'fptp-winner', 'poll-identity', 'turnout']);
});

test('a turnout of valid poll over electorate is the source\'s definition, not a failure', () => {
  const c = contest({ validPoll: 400, totalPoll: 410, spoiled: 10, electorate: 1000, info: { Turnout_Pct: '40.0' },
    candidates: [cand('A', 300, { elected: true }), cand('B', 100)] });
  assert.deepEqual(rules(c), []);
  assert.ok(checkContest(c).some((f) => f.rule === 'turnout-valid-basis' && f.kind === 'info'));
});

test('unopposed: no votes, and no poll of 0', () => {
  assert.deepEqual(rules(contest({ contestStatus: 'uncontested', candidates: [cand('A', null, { elected: true, status: 'Elected unopposed' })] })), []);
  assert.deepEqual(rules(contest({ contestStatus: 'uncontested', validPoll: 0, candidates: [cand('A', null, { elected: true, status: 'Elected unopposed' })] })), ['unopposed-votes']);
  assert.deepEqual(rules(contest({ candidates: [cand('A', 523, { elected: true, status: 'Elected unopposed' })] })), ['unopposed-votes']);
});

test('referendum: yes + no = valid', () => {
  const c = (no) => contest({ votingSystem: 'ordinal', validPoll: 1000, candidates: [cand('Yes', 600, { elected: true }), cand('No', no)] });
  assert.deepEqual(rules(c(400)), []);
  assert.deepEqual(rules(c(410)), ['referendum-sum']);
});

// Two seats, valid 900, quota 301. A is elected on the first count with 400 (surplus 99), which
// goes to B (+60, elected) and C (+30), 9 non-transferable; D, lowest, is excluded at the end.
function stvContest(over = {}, edit = (x) => x) {
  const cands = edit([
    cand('A', 400, { elected: true, electedAt: 1, stages: [[1, 400]] }),
    cand('B', 250, { elected: true, electedAt: 2, stages: [[1, 250], [2, 310, 60]] }),
    cand('C', 150, { stages: [[1, 150], [2, 180, 30], [3, 180]] }),
    cand('D', 100, { excluded: true, excludedAt: 2, stages: [[1, 100], [2, 100, 0, 'Excluded']] }),
  ]);
  return contest({ votingSystem: 'stv-hare', seats: 2, quota: 301, validPoll: 900, candidates: cands, ...over });
}

test('STV: a consistent count passes', () => {
  assert.deepEqual(rules(stvContest()), []);
});

test('STV: quota, first preferences, elected count', () => {
  assert.deepEqual(rules(stvContest({ quota: 350 })), ['stv-quota']);
  assert.ok(['stv-first-sum', 'stv-quota'].every((r) => rules(stvContest({ validPoll: 950 })).includes(r)));
  assert.ok(rules(stvContest({ seats: 3 })).includes('elected-count'));
});

test('STV: a stage that hands out more than it released fails conservation', () => {
  const c = stvContest({}, (cs) => { cs[2] = cand('C', 150, { stages: [[1, 150], [2, 300, 150], [3, 300]] }); return cs; });
  assert.ok(rules(c).includes('stv-conservation'));
});

test('STV: a row whose total is not the last total plus the transfer', () => {
  const c = stvContest({}, (cs) => { cs[2] = cand('C', 150, { stages: [[1, 150], [2, 190, 30], [3, 190]] }); return cs; });
  assert.ok(rules(c).includes('stv-row-transfer'));
});

test('STV: totals cut to whole votes are rebuilt from the transfers and noted', () => {
  const c = stvContest({}, (cs) => { cs[2] = cand('C', 150, { stages: [[1, 150], [2, 180, 30.6], [3, 180]] }); return cs; });
  const findings = checkContest(c);
  assert.ok(findings.some((f) => f.rule === 'stv-whole-totals' && f.kind === 'info'));
  assert.ok(!findings.some((f) => f.rule === 'stv-row-transfer'));
});

test('STV: excluding someone who was not the lowest fails', () => {
  const c = stvContest({}, (cs) => {
    cs[2] = cand('C', 150, { excluded: true, excludedAt: 2, stages: [[1, 150], [2, 180, 30, 'Excluded']] });
    cs[3] = cand('D', 100, { stages: [[1, 100], [2, 100], [3, 100]] });
    return cs;
  });
  assert.ok(rules(c).includes('stv-exclusion'));
});

test('STV: only some stages printed checks rows, not exclusions or conservation', () => {
  const c = stvContest({}, () => [
    cand('A', 400, { elected: true, electedAt: 1, stages: [[1, 400]] }),
    cand('B', 250, { elected: true, electedAt: 4, stages: [[1, 250], [4, 900, 650]] }),
    cand('C', 150, { stages: [[1, 150], [4, 150]] }),
    cand('D', 100, { stages: [[1, 100], [4, 100]] }),
  ]);
  const findings = checkContest(c);
  assert.ok(findings.some((f) => f.rule === 'stv-stages' && /only stages/.test(f.detail)));
  assert.ok(!findings.some((f) => f.rule === 'stv-conservation'));
});
