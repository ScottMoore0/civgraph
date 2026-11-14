/**
 * The by-election tracker and council control in the Elections app (stream el-bodies): their URL
 * state, filters, sorting, summaries, CSVs, the control words and chart, the cross-council view
 * of a year, the routes, and every word keyed for translation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATE, NONE, PAGE, byElectionsCsv, bodyOptions, filterRows, partyOptions, partyShare, queryFromState, sortRows, stateFromQuery, summarise,
} from '../../site/apps/elections/lib/byelections.js';
import * as control from '../../site/apps/elections/lib/control.js';
import { TEXT, TEXT_KEYS, fill } from '../../site/apps/elections/lib/bodies-text.js';
import { toCsvText } from '../../site/apps/elections/lib/csv.js';
import { parseRoute } from '../../site/apps/elections/lib/route.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @typedef {import('../../site/apps/elections/lib/tables.js').ByElectionRow} Row */
/** @typedef {import('../../site/apps/elections/lib/tables.js').ControlTable} ControlTable */

/** @param {Partial<Row>} r @returns {Row} */
const row = (r) => ({
  type: 'by-election', election: 'b__2000-01-01', contest: 'north', date: '2000-01-01', body: 'b', unit: 'b', area: 'North', areaSlug: 'north',
  seats: 1, unopposed: false, turnout: null, electorate: null, majority: null, majorityPct: null,
  winners: [{ name: 'W', personId: null, party: 'a' }], candidates: [], defending: null, result: null, cause: null, ...r,
});
/** @param {string} name @param {string | null} party @param {number | null} share @param {boolean} [elected] */
const cand = (name, party, share, elected = false) => ({ name, party, votes: share === null ? null : share * 10, share, elected });

const ROWS = [
  row({ date: '1912-06-04', unit: 'bc', body: 'bc', area: 'Ormeau', unopposed: true, winners: [{ name: 'A', personId: null, party: null }], candidates: [cand('A', null, null, true)] }),
  row({ date: '1983-04-20', area: 'Armagh', turnout: 30.5, majority: 9000, defending: { name: 'S M', personId: '1', party: 'sdlp', since: '1982-10-20', basis: 'cause' }, result: 'gained', winners: [{ name: 'J S', personId: null, party: 'uup' }], candidates: [cand('J S', 'uup', 60, true), cand('X', 'dup', 25), cand('Y', 'wp', 15)] }),
  row({ date: '1984-03-01', area: 'Belfast South', turnout: 50.2, majority: 4000, defending: { name: 'E G', personId: '2', party: 'uup', since: '1982-10-20', basis: 'cause' }, result: 'held', winners: [{ name: 'F', personId: null, party: 'uup' }], candidates: [cand('F', 'uup', 45, true), cand('G', 'dup', 30), cand('H', 'alliance', 25)] }),
  row({ type: 'co-option', election: null, contest: null, date: '1990-06-04', unit: 'craig', body: 'local-government', area: null, areaSlug: null, winners: [{ name: 'C', personId: '3', party: null }] }),
];

test('by-elections: the URL state round-trips, leaves out its defaults and ignores what it cannot read', () => {
  assert.equal(queryFromState(DEFAULT_STATE), '');
  const s = stateFromQuery(new URLSearchParams('body=b&area=Bel&win=uup&def=none&stand=uup,dup&from=1980&to=1990&result=held&unopposed=no&type=by-election&sort=share&dir=asc&party=uup&n=200'));
  assert.deepEqual(s, { body: 'b', area: 'Bel', win: 'uup', def: NONE, stand: ['uup', 'dup'], from: 1980, to: 1990, result: 'held', unopposed: 'no', type: 'by-election', sort: 'share', dir: 'asc', party: 'uup', n: 200 });
  assert.deepEqual(stateFromQuery(new URLSearchParams(queryFromState(s))), s);
  const junk = stateFromQuery(new URLSearchParams('sort=votes&dir=up&result=lost&type=x&from=19&n=-3&unopposed=maybe'));
  assert.deepEqual(junk, { ...DEFAULT_STATE, stand: [] });
  assert.equal(PAGE, 100);
});

test('by-elections: each filter, and parties standing means all of them stood', () => {
  const f = (/** @type {string} */ q) => filterRows(ROWS, stateFromQuery(new URLSearchParams(q))).map((r) => r.date);
  assert.deepEqual(f(''), ROWS.map((r) => r.date));
  assert.deepEqual(f('body=bc'), ['1912-06-04']);
  assert.deepEqual(f('area=belfast'), ['1984-03-01']);
  assert.deepEqual(f('win=uup'), ['1983-04-20', '1984-03-01']);
  assert.deepEqual(f('win=none'), ['1912-06-04', '1990-06-04']);
  assert.deepEqual(f('def=sdlp'), ['1983-04-20']);
  assert.deepEqual(f('def=none'), ['1912-06-04', '1990-06-04']);
  assert.deepEqual(f('stand=uup,dup'), ['1983-04-20', '1984-03-01']);
  assert.deepEqual(f('stand=uup,alliance'), ['1984-03-01']);
  assert.deepEqual(f('from=1983&to=1984'), ['1983-04-20', '1984-03-01']);
  assert.deepEqual(f('result=gained'), ['1983-04-20']);
  assert.deepEqual(f('result=held'), ['1984-03-01']);
  assert.deepEqual(f('result=unknown'), ['1912-06-04', '1990-06-04']);
  assert.deepEqual(f('unopposed=yes'), ['1912-06-04']);
  assert.deepEqual(f('type=co-option'), ['1990-06-04']);
});

test('by-elections: sorting by date, turnout, majority and a party\'s share; missing figures last either way', () => {
  const sorted = (/** @type {string} */ q) => sortRows(ROWS, stateFromQuery(new URLSearchParams(q))).map((r) => r.date);
  assert.deepEqual(sorted(''), ['1990-06-04', '1984-03-01', '1983-04-20', '1912-06-04']);
  assert.deepEqual(sorted('dir=asc'), ['1912-06-04', '1983-04-20', '1984-03-01', '1990-06-04']);
  assert.deepEqual(sorted('sort=turnout').slice(0, 2), ['1984-03-01', '1983-04-20']);
  assert.deepEqual(sorted('sort=turnout&dir=asc').slice(0, 2), ['1983-04-20', '1984-03-01']);
  assert.deepEqual(sorted('sort=majority').slice(0, 2), ['1983-04-20', '1984-03-01']);
  assert.deepEqual(sorted('sort=share&party=dup').slice(0, 2), ['1984-03-01', '1983-04-20'], 'DUP 30% in 1984, 25% in 1983');
  assert.equal(partyShare(ROWS[1], 'uup'), 60);
  assert.equal(partyShare(ROWS[1], 'sdlp'), null);
});

test('by-elections: the summary counts and the CSV', () => {
  assert.deepEqual(summarise(ROWS), { byElections: 3, changed: 1, held: 1, unknown: 1, coOptions: 1 });
  const table = { schemaVersion: 1, parties: { uup: { name: 'UUP', colour: null }, sdlp: { name: 'SDLP', colour: null }, dup: { name: 'DUP', colour: null }, wp: { name: 'Workers, "Party"', colour: null }, alliance: { name: 'Alliance', colour: null } }, units: { b: { name: 'NI Assembly', body: 'b', bodyName: 'NI Assembly', council: false }, bc: { name: 'Belfast CB', body: 'bc', bodyName: 'Belfast CB', council: true }, craig: { name: 'Craigavon', body: 'local-government', bodyName: 'x', council: true } }, rows: ROWS };
  const csv = byElectionsCsv(ROWS, table).split('\n');
  assert.match(csv[0], /^date,type,body,area,seats,unopposed,winners,winning_party,defending_party,departing_member,defending_basis,result,/);
  assert.match(csv[2], /^1983-04-20,by-election,NI Assembly,Armagh,1,false,J S,UUP,SDLP,S M,cause,gained,30\.5,/);
  assert.ok(csv[2].includes('"J S (UUP, 600); X (DUP, 250); Y (Workers, ""Party"", 150)"'));
  assert.deepEqual(partyOptions(table).map((p) => p.key), ['alliance', 'dup', 'sdlp', 'uup', 'wp']);
  assert.deepEqual(bodyOptions(table).map((b) => [b.key, b.count]), [['bc', 1], ['craig', 1], ['b', 2]]);
  assert.equal(toCsvText(['a', 'b'], [{ a: null, b: 'x,y' }]), 'a,b\n,"x,y"\n');
});

/** @returns {ControlTable} */
const controlFixture = () => ({
  schemaVersion: 1,
  parties: { uup: { name: 'UUP', colour: '#48a5ee' }, sf: { name: 'Sinn Féin', colour: '#326760' }, independent: { name: 'Independent', colour: null } },
  councils: [
    { id: 'old', name: 'Old Rural District Council', body: 'old', generation: 'pre-1973', jurisdiction: 'northern-ireland', aldermen: null, aldermenOf: null, predecessors: [], successors: [{ id: 'new', name: 'New', held: true }], timeline: [
      { type: 'election', date: '1967-05-17', election: 'old__1967-05-17', contest: null, area: null, whole: true, filled: 9, seats: [['uup', 6], [null, 3]], composition: [['uup', 6], [null, 3]], missing: 0, total: 9, control: { kind: 'majority', party: 'uup' } },
    ] },
    { id: 'new', name: 'New', body: 'local-government', generation: '1973', jurisdiction: 'northern-ireland', aldermen: null, aldermenOf: null, predecessors: [{ id: 'old', name: 'Old Rural District Council', held: true }, { id: 'gone', name: 'Gone', held: false }], successors: [], timeline: [
      { type: 'election', date: '1973-05-30', election: 'lg__1973-05-30', contest: null, area: null, whole: true, filled: 20, seats: [['uup', 9], ['sf', 9], ['independent', 2]], composition: [['uup', 9], ['sf', 9], ['independent', 2]], missing: 0, total: 20, control: { kind: 'noc', party: null } },
      { type: 'by-election', date: '1975-05-29', election: 'lg-new__1975-05-29', contest: 'area-a', area: 'Area A', gain: 'sf', loss: null, departing: null, departingKnown: false, composition: null, missing: null, total: null, control: null },
      { type: 'election', date: '1977-05-18', election: 'lg__1977-05-18', contest: null, area: null, whole: false, filled: 8, seats: [['sf', 8]], composition: null, missing: null, total: null, control: null },
    ] },
  ],
});

test('council control: URL state, the words for control, the largest party', () => {
  assert.deepEqual(control.stateFromQuery(new URLSearchParams('council=new')), { council: 'new', year: null });
  assert.deepEqual(control.stateFromQuery(new URLSearchParams('year=1975')), { council: '', year: 1975 });
  assert.equal(control.queryFromState({ council: '', year: 1975 }), 'year=1975');
  assert.equal(control.queryFromState({ council: 'new', year: 1975 }), 'council=new');
  const p = controlFixture().parties;
  assert.equal(control.controlText({ kind: 'majority', party: 'uup' }, p), 'UUP majority');
  assert.equal(control.controlText({ kind: 'noc', party: 'sf' }, p), 'No overall control; largest party Sinn Féin');
  assert.equal(control.controlText({ kind: 'noc', party: null }, p), TEXT.noc);
  assert.equal(control.controlText({ kind: 'independent', party: null }, p), TEXT.independentMajority);
  assert.equal(control.controlText({ kind: 'unknown', party: null }, p), TEXT.notDeterminable);
  assert.equal(control.controlText(null, p), TEXT.compositionNotRecorded);
  assert.equal(control.largestParty([['independent', 9], ['uup', 4], ['sf', 3]]), 'uup');
  assert.equal(control.largestParty([['uup', 4], ['sf', 4]]), null);
});

test('council control: the year view lists each council in force, to the end of its generation, never stale', () => {
  const t = controlFixture();
  const names = (/** @type {number} */ y) => control.yearView(t, y).map((r) => `${r.council.id}@${r.entry.date}`);
  assert.deepEqual(names(1970), ['old@1967-05-17']);
  assert.deepEqual(names(1973), ['new@1973-05-30', 'old@1967-05-17']);
  assert.deepEqual(names(1974), ['new@1973-05-30'], 'pre-1973 councils end in 1973');
  assert.deepEqual(names(1976), ['new@1975-05-29'], 'the change after the election is the state in force');
  assert.deepEqual(names(1966), []);
  assert.deepEqual(names(2000), [], 'no election of it on file within twelve years');
  assert.deepEqual(control.yearCounts(control.yearView(t, 1973)), { councils: 2, majority: 1, noc: 1, other: 0 });
  assert.deepEqual(control.yearRange(t), { first: 1967, last: 1977 });
  assert.deepEqual(control.predecessorChain(t, t.councils[1]).map((c) => c.id), ['old']);
  assert.deepEqual(control.councilGroups(t).map(([label, list]) => [label, list.map((c) => c.id)]), [[TEXT.generationPre1973, ['old']], [TEXT.generation1973, ['new']]]);
});

test('council control: the chart is text and bars (half-seat mark on whole councils), the CSVs carry every entry', () => {
  const t = controlFixture();
  const html = control.controlChart(t.councils[1], t.parties);
  assert.equal((html.match(/<li /g) || []).length, 2, 'one bar per election, none for the by-election');
  assert.ok(html.includes('>1973<') && html.includes('No overall control'));
  assert.ok(html.includes('el-ctl-row--part') && html.includes(TEXT.partCouncil));
  assert.ok(html.includes('background:#326760'), 'party colours are the table\'s');
  assert.ok(html.includes('aria-hidden="true"'));
  const csv = control.councilCsv(t.councils[1], t.parties).split('\n');
  assert.equal(csv.length, 5);
  assert.match(csv[2], /^New,1975-05-29,by-election,lg-new__1975-05-29,area-a,Area A,,,Sinn Féin,,,,,,,$/);
  const year = control.yearCsv(control.yearView(t, 1973), t.parties, 1973).split('\n');
  assert.match(year[1], /^1973,New,new,1973,1973-05-30,1973-05-30,noc,,UUP|^1973,New,new,1973,1973-05-30,1973-05-30,noc,,,/);
  assert.equal(control.seatsText([['uup', 6], [null, 3]], t.parties), `UUP 6 · ${TEXT.noLabelSeats} 3`);
});

test('the routes: /elections/byelections/ and /elections/control/ are tools with their state in the query', () => {
  assert.equal(parseRoute('/elections/byelections/', '?win=uup').view, 'byelections');
  assert.equal(parseRoute('/elections/control/', '?council=ni-1973-belfast').query.get('council'), 'ni-1973-belfast');
  assert.equal(parseRoute('/apps/elections/control/').view, 'control');
  const html = readFileSync(path.join(ROOT, 'site/apps/elections/index.html'), 'utf8');
  assert.ok(html.includes('href="/elections/byelections/" data-tab="byelections"') && html.includes('href="/elections/control/" data-tab="control"'));
});

test('every word of the two views is keyed for translation (R10)', () => {
  const en = JSON.parse(readFileSync(path.join(ROOT, 'site/assets/i18n/en.json'), 'utf8'));
  const values = new Set(Object.values(en.strings || en).map(String));
  for (const s of TEXT_KEYS) assert.ok(values.has(s), `not keyed: ${s}`);
  for (const label of ['By-elections', 'Council control']) assert.ok(values.has(label), label);
  assert.equal(fill('{n} of {total}.', { n: '3', total: '9' }), '3 of 9.');
  assert.equal(fill('{n} {x}', { n: 1 }), '1 {x}');
});

test('the upload sends the tables as immutable files named by content', { skip: !existsSync(path.join(ROOT, 'site/apps/elections/extracts/manifest.json')) && 'no extracts built here' }, async () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'site/apps/elections/extracts/manifest.json'), 'utf8'));
  if (!manifest.files.some((/** @type {any} */ f) => f.table)) return; // extracts built before the tables
  const { plan, CACHE } = await import('../../scripts/publish/elections-app-r2-upload.mjs');
  const tables = plan().filter((o) => /\/(byelections|control)-[0-9a-f]{12}\.json$/.test(o.key));
  assert.equal(tables.length, 2);
  assert.ok(tables.every((o) => o.cacheControl === CACHE.immutable && o.contentType.startsWith('application/json')));
  const index = JSON.parse(readFileSync(path.join(ROOT, 'site/apps/elections/extracts/index.json'), 'utf8'));
  assert.deepEqual(Object.keys(index.tables).sort(), ['byelections', 'control']);
});
