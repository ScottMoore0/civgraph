/**
 * The by-election tracker's and council control's tables at build time (stream el-bodies):
 * scripts/build/elections-app/bodies-model.mjs, and, where a records build is here, the tables
 * bodies.mjs builds from it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTables, controlOf, defendingOf, districtCouncilId, foldName, irishCouncilUnits, isByElectionContest, resultOf, surnameOf, wholeElections,
} from '../../scripts/build/elections-app/bodies-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @typedef {import('../../scripts/build/elections-app/bodies-model.mjs').Contest} Contest @typedef {import('../../scripts/build/elections-app/bodies-model.mjs').El} El */

/** A candidacy. @param {string} name @param {string | null} party @param {boolean} elected @param {number | null} [votes] */
const cand = (name, party, elected, votes = null) => ({ name, personId: null, party, votes, elected });
/**
 * A contest.
 * @param {string} slug @param {ReturnType<typeof cand>[]} cands @param {Partial<Contest>} [more]
 * @returns {Contest}
 */
const contest = (slug, cands, more = {}) => ({
  seq: 1, name: slug, slug, seats: cands.filter((c) => c.elected).length || 1, electorate: null, turnout: null, majority: null, majorityPct: null,
  validPoll: null, unopposed: false, notes: [], cands, ...more,
});
/** @param {string} unit @param {string} date @param {Contest[]} contests @param {Partial<El>} [more] @returns {El} */
const election = (unit, date, contests, more = {}) => ({ key: `${unit}__${date}`, body: unit, unit, council: true, kind: 'general', date, contests, ...more });

test('a by-election: the kind says so, or a council contest filed as filling a casual vacancy', () => {
  const plain = contest('ward', [cand('A', null, true)]);
  assert.equal(isByElectionContest(election('x', '2000-01-01', [], { kind: 'by-election', council: false }), plain), true);
  assert.equal(isByElectionContest(election('x', '1912-06-04', []), contest('w', [], { notes: [{ label: 'Note', text: 'By-election of a councillor for Ormeau Ward, 4 June 1912, to fill a casual vacancy.' }] })), true);
  assert.equal(isByElectionContest(election('x', '1957-12-19', []), contest('w', [], { notes: [{ label: 'Note', text: 'Election in Clifton Ward to fill a casual vacancy as councillor.' }] })), true);
  assert.equal(isByElectionContest(election('x', '1937-06-16', []), contest('w', [], { notes: [{ label: 'Cause', text: 'vice Councillor Bradbury resigned' }] })), true);
  // A whole-council election whose note mentions a vacancy is not a by-election.
  assert.equal(isByElectionContest(election('x', '1964-06-04', []), contest('w', [], { notes: [{ label: 'Note', text: 'Triennial election. Slatequarry became a casual vacancy because the retiring member did not stand.' }] })), false);
  assert.equal(isByElectionContest(election('x', '1911-05-31', []), contest('w', [], { notes: [{ label: 'Note', text: 'Triennial election. "In place of Michael Smyth, J.P."' }] })), false);
  // A body that is not a council files its by-elections by kind only.
  assert.equal(isByElectionContest(election('x', '1937-06-16', [], { council: false }), contest('w', [], { notes: [{ label: 'Cause', text: 'Death' }] })), false);
});

test('names fold for matching: accents, case, M\' and Mac', () => {
  assert.equal(foldName("M'Cann"), 'mccann');
  assert.equal(foldName('MacDonnell'), 'mcdonnell');
  assert.equal(foldName('Séamus Ó Néill'), 'seamus o neill');
  assert.equal(surnameOf('John Campbell White'), 'white');
  assert.equal(surnameOf('Albert A. Peel, J.P.'), 'peel');
});

test('the defending member: the one member of a single-member seat, or the one sitting member the cause names', () => {
  const h = (/** @type {string} */ name, /** @type {string | null} */ party) => ({ name, personId: null, party, since: '1920-01-15' });
  const by = (/** @type {string | null} */ cause, seats = 1) => contest('w', [cand('New', 'b', true)], { seats, notes: cause ? [{ label: 'Cause', text: cause }] : [] });
  assert.deepEqual(defendingOf([h('Old Member', 'a')], true, by(null)), { ...h('Old Member', 'a'), basis: 'seat' });
  assert.deepEqual(defendingOf([h('Old Member', 'a')], true, by('Elevation to the peerage of Earl of Tyrone')), { ...h('Old Member', 'a'), basis: 'seat' });
  // A multi-member seat: only the cause links the member.
  const sitting = [h('James McClure', 'a'), h('Robert Gregg', 'b'), h('Hugh Pollock', 'c')];
  assert.equal(defendingOf(sitting, false, by(null)), null);
  assert.deepEqual(defendingOf(sitting, false, by("vice M'Clure elected Alderman")), { ...sitting[0], basis: 'cause' });
  assert.deepEqual(defendingOf(sitting, false, by('Death of Hugh MacDowell Pollock (UUP) on 15 April 1937')), { ...sitting[2], basis: 'cause' });
  assert.equal(defendingOf(sitting, false, by('Resignation')), null);
  // Two sitting members of the same surname: the cause cannot say which.
  assert.equal(defendingOf([h('John Smith', 'a'), h('Mary Smith', 'b')], false, by('vice Smith resigned')), null);
  // A single-member seat filling two places is not linked by the seat.
  assert.equal(defendingOf([h('Old Member', 'a')], true, by(null, 2)), null);
});

test('held or gained only when both parties are recorded and one seat was filled', () => {
  const def = { name: 'X', personId: null, party: 'a', since: '1990', basis: /** @type {'seat'} */ ('seat') };
  assert.equal(resultOf(def, [{ party: 'a' }], 1), 'held');
  assert.equal(resultOf(def, [{ party: 'b' }], 1), 'gained');
  assert.equal(resultOf(def, [{ party: null }], 1), null);
  assert.equal(resultOf({ ...def, party: null }, [{ party: 'a' }], 1), null);
  assert.equal(resultOf(null, [{ party: 'a' }], 1), null);
  assert.equal(resultOf(def, [{ party: 'a' }, { party: 'a' }], 2), null);
});

test('whole-council elections: three quarters of the usual size; a council renewed in thirds is not', () => {
  const whole = wholeElections([
    { key: 'a', date: '1923-01-15', filled: 45 },
    { key: 'b', date: '1924-01-15', filled: 15 },
    { key: 'c', date: '1946-09-18', filled: 45 },
    { key: 'd', date: '1955-05-18', filled: 42 },
  ], true);
  assert.deepEqual([...whole.entries()], [['a', 45], ['c', 45], ['d', 45]]);
  assert.deepEqual([...wholeElections([{ key: 'x', date: '1900', filled: 3 }], false).entries()], [['x', 3]]);
});

test('control: a majority, no overall control with its largest party, independents, and the undeterminable', () => {
  assert.deepEqual(controlOf([['a', 6], ['b', 4]]), { kind: 'majority', party: 'a' });
  assert.deepEqual(controlOf([['a', 5], ['b', 3], ['c', 2]]), { kind: 'noc', party: 'a' });
  assert.deepEqual(controlOf([['a', 5], ['b', 5]]), { kind: 'noc', party: null });
  assert.deepEqual(controlOf([['independent', 6], ['a', 4]]), { kind: 'independent', party: null });
  assert.deepEqual(controlOf([['a', 4], ['b', 3], [null, 3]]), { kind: 'unknown', party: null });
  assert.deepEqual(controlOf([['a', 3], ['b', 3], ['c', 3], [null, 1]]), { kind: 'noc', party: null });
  // Seats not on file count as members whose party is not recorded.
  assert.deepEqual(controlOf([['a', 6], ['b', 6]], 5), { kind: 'unknown', party: null });
  assert.deepEqual(controlOf([['a', 12], ['b', 3]], 2), { kind: 'majority', party: 'a' });
  assert.equal(controlOf([]), null);
});

test('a council timeline: composition after a whole-council election, moved by a linked by-election, lost after an unlinked one', () => {
  const w = (/** @type {string} */ slug, /** @type {Array<[string, string]>} */ members) => contest(slug, members.map(([n, p]) => cand(n, p, true)), { seats: members.length });
  const els = [
    election('c', '1950-05-01', [w('north', [['Ann Able', 'a'], ['Bob Baker', 'b']]), w('south', [['Cid Cole', 'a'], ['Dan Dale', 'a'], ['Eve East', 'b']])]),
    election('c', '1951-03-01', [contest('north', [cand('Fay Ford', 'b', true, 900), cand('Gus Gale', 'a', false, 800)], { notes: [{ label: 'Cause', text: 'vice Able deceased' }], majority: 100, turnout: 41.5 })]),
    election('c', '1952-03-01', [contest('south', [cand('Hal Hart', 'c', true)], { unopposed: true, notes: [{ label: 'Note', text: 'By-election to fill a casual vacancy.' }] })]),
    election('c', '1953-05-01', [w('north', [['Ivy Irwin', 'a'], ['Jo Jones', 'b']]), w('south', [['Kit King', 'a'], ['Lu Lane', 'b'], ['Max Moss', 'b']])]),
  ];
  const { rows, timelines } = buildTables(els);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].defending?.name, 'Ann Able');
  assert.equal(rows[0].defending?.party, 'a');
  assert.equal(rows[0].result, 'gained');
  assert.equal(rows[0].majority, 100);
  assert.deepEqual(rows[0].candidates.map((c) => c.share), [52.94, 47.06]);
  assert.equal(rows[1].defending, null);
  assert.equal(rows[1].unopposed, true);
  const tl = /** @type {NonNullable<ReturnType<typeof timelines.get>>} */ (timelines.get('c'));
  assert.deepEqual(tl.map((e) => e.type), ['election', 'by-election', 'by-election', 'election']);
  assert.deepEqual(tl[0].composition, [['a', 3], ['b', 2]]);
  assert.deepEqual(tl[0].control, { kind: 'majority', party: 'a' });
  assert.deepEqual(tl[1].composition, [['b', 3], ['a', 2]]);
  assert.deepEqual(tl[1].control, { kind: 'majority', party: 'b' });
  assert.equal(tl[2].composition, null, 'the departing member is not on record');
  assert.equal(tl[2].departingKnown, false);
  assert.deepEqual(tl[3].composition, [['b', 3], ['a', 2]]);
});

test('a single-member seat spelt two ways is one seat by its map feature, and the newest record of it wins', () => {
  const ge = (/** @type {string} */ date, /** @type {string} */ slug, /** @type {string} */ name, /** @type {string} */ party, /** @type {string} */ feature) => election('p', date, [contest(slug, [cand(name, party, true)], { keys: [feature, slug] })], { council: false });
  const by = (/** @type {string} */ date, /** @type {string} */ slug, /** @type {string} */ feature, /** @type {string} */ party) => election('p', date, [contest(slug, [cand('Winner', party, true)], { keys: [feature, slug] })], { council: false, kind: 'by-election' });
  const { rows } = buildTables([
    ge('1900-09-26', 'kildare-s', 'Old Member', 'x', 'pc-1885#52'),
    by('1903-05-23', 'south-kildare', 'pc-1885#52', 'x'),
    ge('1973-06-28', 'armagh', 'First', 'y', 'layer-1970#9'),
    ge('1982-10-20', 'armagh', 'Second', 'z', 'layer-1982#9'),
    by('1983-04-20', 'armagh', 'layer-1970#9', 'y'),
  ]);
  assert.equal(rows[0].defending?.name, 'Old Member');
  assert.equal(rows[0].result, 'held');
  assert.equal(rows[1].defending?.name, 'Second', 'the 1982 record of the seat, not the 1973 one the old feature points at');
  assert.equal(rows[1].result, 'gained');
});

test('a part-council election ends the known composition; a co-option is listed, and so does it', () => {
  const els = [
    election('c', '1946-09-18', [contest('w', [cand('A', 'a', true), cand('B', 'a', true), cand('C', 'b', true)], { seats: 3 })]),
    election('c', '1947-01-15', [contest('w', [cand('D', 'b', true)], { seats: 1 })]),
  ];
  const { timelines } = buildTables(els);
  const tl = /** @type {NonNullable<ReturnType<typeof timelines.get>>} */ (timelines.get('c'));
  assert.equal(tl[1].whole, false);
  assert.equal(tl[1].composition, null);
  const co = buildTables([els[0]], { coOptions: [{ unit: 'c', body: 'c', date: '1948-02-01', name: 'E', personId: '9', party: null, note: 'Co-opted in place of A.' }] });
  assert.equal(co.rows[0].type, 'co-option');
  assert.equal(co.rows[0].defending, null);
  const tl2 = /** @type {NonNullable<ReturnType<typeof co.timelines.get>>} */ (co.timelines.get('c'));
  assert.equal(tl2.at(-1)?.type, 'co-option');
  assert.equal(tl2.at(-1)?.composition, null);
});

test('district councils by name and date; the Republic\'s councils with their 2014 mergers', () => {
  const registry = [
    { id: 'ni-1973-belfast', name: 'Belfast', bodySlug: 'local-government', generation: '1973', jurisdiction: 'northern-ireland' },
    { id: 'ni-2014-belfast', name: 'Belfast', bodySlug: 'local-government', generation: '2014', jurisdiction: 'northern-ireland' },
    { id: 'ni-2014-newry-mourne-and-down', name: 'Newry, Mourne and Down', bodySlug: 'local-government', generation: '2014', jurisdiction: 'northern-ireland' },
    { id: 'ie-2014-carlow', name: 'Carlow', bodySlug: 'ireland-local', generation: '2014', jurisdiction: 'ireland' },
    { id: 'ie-2014-limerick', name: 'Limerick', bodySlug: 'ireland-local', generation: '2014', jurisdiction: 'ireland' },
    { id: 'ie-2014-tipperary', name: 'Tipperary', bodySlug: 'ireland-local', generation: '2014', jurisdiction: 'ireland' },
    { id: 'ie-2014-cork-county', name: 'Cork County', bodySlug: 'ireland-local', generation: '2014', jurisdiction: 'ireland' },
    { id: 'ie-2014-cork-city', name: 'Cork City', bodySlug: 'ireland-local', generation: '2014', jurisdiction: 'ireland' },
  ];
  assert.equal(districtCouncilId(registry, 'Belfast', '1977-05-18'), 'ni-1973-belfast');
  assert.equal(districtCouncilId(registry, 'Belfast', '2014-05-22'), 'ni-2014-belfast');
  assert.equal(districtCouncilId(registry, 'Newry, Mourne and Down', '2019-05-02'), 'ni-2014-newry-mourne-and-down');
  assert.equal(districtCouncilId(registry, 'Nowhere', '2019-05-02'), null);
  const printed = [
    { name: 'Carlow County Council', date: '1967-06-28' }, { name: 'Carlow', date: '2019-05-24' },
    { name: 'Limerick County Council', date: '1999-06-10' }, { name: 'Limerick City Council', date: '1999-06-10' }, { name: 'Limerick', date: '2019-05-24' },
    { name: 'Tipperary North Riding County Council', date: '1999-06-10' }, { name: 'Cork County Council', date: '1999-06-10' }, { name: 'Cork City Council', date: '1999-06-10' },
    { name: 'Dublin County Council', date: '1979-06-07' },
  ];
  const ie = irishCouncilUnits(registry, printed);
  assert.equal(ie.unitOf('Carlow County Council', '1967-06-28'), 'ie-2014-carlow');
  assert.equal(ie.unitOf('Carlow', '2019-05-24'), 'ie-2014-carlow');
  assert.equal(ie.unitOf('Cork County Council', '1999-06-10'), 'ie-2014-cork-county');
  assert.equal(ie.unitOf('Cork City Council', '1999-06-10'), 'ie-2014-cork-city');
  assert.equal(ie.unitOf('Limerick County Council', '1999-06-10'), 'ireland-local-limerick-county-council');
  assert.equal(ie.unitOf('Limerick City Council', '1999-06-10'), 'ireland-local-limerick-city-council');
  assert.equal(ie.unitOf('Limerick County Council', '2014-05-23'), 'ie-2014-limerick');
  assert.equal(ie.unitOf('Tipperary North Riding County Council', '1999-06-10'), 'ireland-local-tipperary-north-riding-county-council');
  assert.equal(ie.unitOf('Dublin County Council', '1979-06-07'), 'ireland-local-dublin-county-council');
  assert.equal(ie.units.get('ireland-local-limerick-city-council')?.predecessorOf, 'ie-2014-limerick');
  assert.equal(ie.units.get('ireland-local-tipperary-north-riding-county-council')?.predecessorOf, 'ie-2014-tipperary');
  assert.equal(ie.units.get('ireland-local-dublin-county-council')?.predecessorOf, null);
});

const DB = path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite');

test('from the records build: every by-election body, the 1983 Armagh by-election linked to 1982, NI councils back to 1899', { skip: !existsSync(DB) && 'no records build here' }, async () => {
  const { openSqliteHandle } = await import('@civgraph/storage/node');
  const { bodiesTables } = await import('../../scripts/build/elections-app/bodies.mjs');
  const tables = bodiesTables(openSqliteHandle(DB, { readOnly: true }));
  const rows = /** @type {any[]} */ (tables.byelections.rows);
  const bodies = new Set(rows.map((r) => r.body));
  for (const b of ['house-of-commons-of-the-united-kingdom', 'dail-eireann', 'parliament-of-northern-ireland', 'northern-ireland-assembly', 'local-government', 'belfast-county-borough-council']) assert.ok(bodies.has(b), b);
  const armagh = rows.find((r) => r.body === 'northern-ireland-assembly' && r.date === '1983-04-20');
  assert.equal(armagh?.defending?.party, 'sdlp');
  assert.equal(armagh?.defending?.since, '1982-10-20');
  // Never a defending party without a member linked to the seat.
  for (const r of rows) if (r.defending) assert.ok(r.defending.name && ['seat', 'cause'].includes(r.defending.basis));
  for (const r of rows) if (r.result) assert.ok(r.defending?.party && r.winners.length === 1);
  const councils = /** @type {any[]} */ (tables.control.councils);
  assert.ok(councils.some((c) => c.generation === 'pre-1973' && c.timeline[0].date.startsWith('1899')));
  assert.ok(councils.some((c) => c.jurisdiction === 'ireland'));
  const belfast = councils.find((c) => c.id === 'ni-1973-belfast');
  assert.ok(belfast.predecessors.some((/** @type {any} */ p) => p.id === 'belfast-county-borough-council' && p.held));
});
