/**
 * "Same votes, other systems" (site/apps/elections/lib/other-systems.js, el-context): an election's
 * first preferences shared out again under D'Hondt, Sainte-Laguë, first past the post and pure PR,
 * from its bundle results; the view's words keyed for translation (R10).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareSystems, rowShown, standsAlone, systemsContests, systemsOffered } from '../../site/apps/elections/lib/other-systems.js';

const cand = (name, party, firstPrefs, elected = false, extra = {}) => ({ name, party, firstPrefs, elected, status: elected ? 'Elected' : 'Not elected', ...extra });
const seatsOf = (cmp, party) => cmp.rows.find((r) => r.party === party)?.seats;

// A two-contest STV election: 4 and 3 seats.
const stv = [
  { constituency: 'North', seatsTotal: 4, candidates: [
    cand('A1', 'Alpha', 4000, true), cand('A2', 'Alpha', 3500, true), cand('B1', 'Beta', 3000, true),
    cand('C1', 'Gamma', 1200, true), cand('I1', 'Independent', 900), cand('B2', 'Beta', 400),
  ] },
  { constituency: 'South', seatsTotal: 3, candidates: [
    cand('A3', 'Alpha', 5000, true), cand('B3', 'Beta', 2500, true), cand('I2', 'Independent', 2400, true), cand('C2', 'Gamma', 600),
  ] },
];

test('STV, several seats a contest: D\'Hondt and Sainte-Laguë by constituency, pure PR across all seats', () => {
  const cmp = compareSystems(stv, 'stv-gregory');
  assert.equal(cmp.applicable, true);
  if (!cmp.applicable) return;
  assert.equal(cmp.singleMember, false);
  assert.deepEqual(cmp.columns, ['actual', 'dhondt', 'sainteLague', 'pr']);
  assert.equal(cmp.seats, 7);
  // North, D'Hondt over 4 seats: Alpha 7500, Beta 3400, Gamma 1200, Ind 900 -> Alpha 3, Beta 1.
  // South, D'Hondt over 3: Alpha 5000, Beta 2500, Ind 2400 (a list of one), Gamma 600 -> Alpha 2, Beta 1.
  assert.equal(seatsOf(cmp, 'Alpha').dhondt, 5);
  assert.equal(seatsOf(cmp, 'Beta').dhondt, 2);
  assert.equal(seatsOf(cmp, 'Independent').dhondt, 0);
  assert.deepEqual(seatsOf(cmp, 'Alpha').actual, 3);
  // Every system shares out the same 7 seats.
  for (const id of cmp.columns) assert.equal(cmp.rows.reduce((s, r) => s + r.seats[id], 0), 7, id);
  // Votes and shares are the first preferences summed.
  assert.equal(cmp.votes, 23500);
  assert.equal(seatsOf(cmp, 'Alpha') && cmp.rows.find((r) => r.party === 'Alpha')?.votes, 12500);
});

test('a candidate standing alone wins one seat at most; party labels starting "Independent" stand alone', () => {
  assert.equal(standsAlone('Independent'), true);
  assert.equal(standsAlone('Independent Unionist'), true);
  assert.equal(standsAlone('No party recorded'), true);
  assert.equal(standsAlone('Independents 4 Change'), false);
  assert.equal(standsAlone('Sinn Féin'), false);
  const big = [{ constituency: 'X', seatsTotal: 3, candidates: [cand('I', 'Independent', 9000, true), cand('P1', 'P', 1000, true), cand('P2', 'P', 900, true), cand('Q', 'Q', 100)] }];
  const cmp = compareSystems(big, 'stv-gregory');
  assert.ok(cmp.applicable);
  if (!cmp.applicable) return;
  for (const id of cmp.columns) assert.ok(seatsOf(cmp, 'Independent')[id] <= 1, id);
});

test('first past the post, one seat a contest: the national D\'Hondt, Sainte-Laguë and PR; no repeated FPTP column', () => {
  const fptp = [
    { constituency: 'One', seatsTotal: 1, candidates: [cand('a', 'Red', 5100, true), cand('b', 'Blue', 4900)] },
    { constituency: 'Two', seatsTotal: 1, candidates: [cand('c', 'Red', 5100, true), cand('d', 'Blue', 4900)] },
    { constituency: 'Three', seatsTotal: 1, candidates: [cand('e', 'Red', 5100, true), cand('f', 'Blue', 4900)] },
    { constituency: 'Four', seatsTotal: 1, candidates: [cand('g', 'Red', 5100, true), cand('h', 'Blue', 4900)] },
  ];
  const cmp = compareSystems(fptp, 'fptp');
  assert.ok(cmp.applicable);
  if (!cmp.applicable) return;
  assert.equal(cmp.singleMember, true);
  assert.deepEqual(cmp.columns, ['actual', 'dhondt', 'sainteLague', 'pr']);
  assert.deepEqual(seatsOf(cmp, 'Red'), { actual: 4, fptp: 4, dhondt: 2, sainteLague: 2, pr: 2 });
  assert.deepEqual(seatsOf(cmp, 'Blue'), { actual: 0, fptp: 0, dhondt: 2, sainteLague: 2, pr: 2 });
});

test('STV with one seat a contest (a by-election, the presidency): first past the post gets its own column', () => {
  const one = [{ constituency: 'By', seatsTotal: 1, candidates: [cand('a', 'Red', 4000), cand('b', 'Blue', 3000, true), cand('c', 'Green', 2500)] }];
  const cmp = compareSystems(one, 'stv-hare');
  assert.ok(cmp.applicable);
  if (!cmp.applicable) return;
  assert.deepEqual(cmp.columns, ['actual', 'fptp', 'dhondt', 'sainteLague', 'pr']);
  // Transfers elected Blue; on first preferences alone Red leads.
  assert.equal(seatsOf(cmp, 'Blue').actual, 1);
  assert.equal(seatsOf(cmp, 'Red').fptp, 1);
});

test('the block vote, list systems and referendums are not worked out', () => {
  const block = [{ constituency: 'Ward', seatsTotal: 3, candidates: [cand('a', 'Red', 900, true), cand('b', 'Red', 850, true), cand('c', 'Blue', 800, true), cand('d', 'Blue', 700)] }];
  assert.deepEqual(compareSystems(block, 'fptp'), { applicable: false, reason: 'block-vote' });
  assert.deepEqual(compareSystems(stv, 'party-list-dhondt'), { applicable: false, reason: 'system' });
  assert.deepEqual(compareSystems(stv, 'ordinal'), { applicable: false, reason: 'system' });
  assert.deepEqual(compareSystems(stv, null), { applicable: false, reason: 'system' });
});

test('unopposed contests and contests with votes missing keep their actual seats under every system', () => {
  const mixed = [
    ...stv,
    { constituency: 'Quiet', seatsTotal: 2, candidates: [cand('u1', 'Gamma', null, true, { status: 'Elected unopposed', unopposed: true }), cand('u2', 'Beta', null, true, { status: 'Elected unopposed', unopposed: true })] },
    { constituency: 'Gappy', seatsTotal: 2, candidates: [cand('g1', 'Alpha', 3000, true), cand('g2', 'Gamma', null, true), cand('g3', 'Beta', 100)] },
  ];
  const contests = systemsContests(mixed);
  assert.deepEqual(contests.map((c) => c.status), ['counted', 'counted', 'unopposed', 'incomplete']);
  const cmp = compareSystems(mixed, 'stv-gregory');
  assert.ok(cmp.applicable);
  if (!cmp.applicable) return;
  assert.equal(cmp.unopposed, 1);
  assert.equal(cmp.incomplete, 1);
  assert.equal(cmp.keptSeats, 4);
  assert.equal(cmp.seats, 11);
  for (const id of cmp.columns) assert.equal(cmp.rows.reduce((s, r) => s + r.seats[id], 0), 11, id);
  // Gamma's kept seats (one unopposed, one in the gappy contest) stay under every system.
  for (const id of cmp.columns) assert.ok(seatsOf(cmp, 'Gamma')[id] >= 2, id);
  // The kept contests add no votes.
  assert.equal(cmp.votes, 23500);
});

test('a seat returned without a poll inside a polled contest (the Ceann Comhairle) is kept; the rest are shared out', () => {
  const dail = [{ constituency: 'Kildare South', seatsTotal: 4, candidates: [
    cand('CC', 'Fianna Fáil', null, true, { status: 'Elected (auto returned)', autoReturnedCeannComhairle: true }),
    cand('x', 'Red', 9000, true), cand('y', 'Blue', 6000, true), cand('z', 'Red', 1000, true), cand('w', 'Green', 2000),
  ] }];
  const [c] = systemsContests(dail);
  assert.equal(c.status, 'counted');
  assert.equal(c.open, 3);
  const cmp = compareSystems(dail, 'stv-hare');
  assert.ok(cmp.applicable);
  if (!cmp.applicable) return;
  for (const id of cmp.columns) {
    assert.equal(seatsOf(cmp, 'Fianna Fáil')[id], 1, id);
    assert.equal(cmp.rows.reduce((s, r) => s + r.seats[id], 0), 4, id);
  }
});

test('offered before the votes load: STV, or first past the post with one seat a contest', () => {
  assert.equal(systemsOffered('stv-hare', [{ seatsTotal: 5 }]), true);
  assert.equal(systemsOffered('fptp', [{ seatsTotal: 1 }, { seatsTotal: null }]), true);
  assert.equal(systemsOffered('fptp', [{ seatsTotal: 1 }, { seatsTotal: 3 }]), false, 'the block vote');
  assert.equal(systemsOffered('party-list-dhondt', [{ seatsTotal: 5 }]), false);
  assert.equal(systemsOffered('stv-gregory', []), false);
});

test('nothing to work from: no contest has all its votes', () => {
  const none = [{ constituency: 'Q', seatsTotal: 2, candidates: [cand('a', 'Red', null, true, { unopposed: true }), cand('b', 'Blue', null, true, { unopposed: true })] }];
  assert.deepEqual(compareSystems(none, 'stv-gregory'), { applicable: false, reason: 'no-votes' });
});

test('rows: colours from the party summary; small seatless parties fold away', () => {
  const cmp = compareSystems(stv, 'stv-gregory', new Map([['Alpha', '#123456']]));
  assert.ok(cmp.applicable);
  if (!cmp.applicable) return;
  assert.equal(cmp.rows.find((r) => r.party === 'Alpha')?.colour, '#123456');
  assert.equal(rowShown({ party: 'x', colour: '', votes: 1, share: 0.5, seats: { actual: 0, fptp: 0, dhondt: 0, sainteLague: 0, pr: 0 } }), false);
  assert.equal(rowShown({ party: 'x', colour: '', votes: 1, share: 0.5, seats: { actual: 0, fptp: 0, dhondt: 0, sainteLague: 0, pr: 1 } }), true);
  assert.equal(rowShown({ party: 'x', colour: '', votes: 1, share: 1.5, seats: { actual: 0, fptp: 0, dhondt: 0, sainteLague: 0, pr: 0 } }), true);
});

test('every word of the panel is keyed for translation in en.json (R10)', async () => {
  const { SYSTEMS_STRINGS } = await import('../../site/apps/elections/views/other-systems.js');
  const english = new Set(Object.values(JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings));
  for (const s of SYSTEMS_STRINGS) assert.ok(english.has(s), `not keyed: ${s}`);
});

test('the panel is marked illustrative and its methods note names the assumptions', async () => {
  const { systemsHtml, otherSystemsSection } = await import('../../site/apps/elections/views/other-systems.js');
  assert.match(otherSystemsSection('stv-gregory', [{ seatsTotal: 5 }]), /Illustrative arithmetic, not a prediction/);
  assert.equal(otherSystemsSection('party-list-dhondt', [{ seatsTotal: 5 }]), '');
  const cmp = compareSystems(stv, 'stv-gregory');
  const html = systemsHtml(cmp, true);
  assert.match(html, /How it is worked out/);
  assert.match(html, /no tactical voting/);
  assert.match(html, /Only first preferences are used/);
  assert.match(html, /<tfoot>/);
  assert.match(systemsHtml({ applicable: false, reason: 'block-vote' }, false), /block vote/);
});
