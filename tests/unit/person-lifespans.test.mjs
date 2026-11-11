// Activity outside a person's life (QA launch-readiness H3, 11 Nov 2026): the records check
// scripts/check/rules/person-activity-after-death.mjs, over a small in-memory records database,
// and the guard in scripts/build/build_browse_votes.py that detaches a vote dated after the
// linked person's death (Lord Craigavon, died 24 November 1940, "voted" on 28 January 1941).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { findLifespanProblems, isAfter, isBefore18 } from '../../scripts/check/rules/person-activity-after-death.mjs';

test('dates of death and birth at year, month or day precision', () => {
  assert.equal(isAfter('1941-01-28', '1940'), true);
  assert.equal(isAfter('1940-12-01', '1940'), false, 'a year-only death does not rule out December');
  assert.equal(isAfter('1940-12-01', '1940-11'), true);
  assert.equal(isAfter('1940-11-30', '1940-11'), false);
  assert.equal(isAfter('1940-11-25', '1940-11-24'), true);
  assert.equal(isAfter('1940-11-24', '1940-11-24'), false);
  assert.equal(isAfter('1941-01-01', ''), false);
  assert.equal(isBefore18('1927-06-09', '1927-06'), true);
  assert.equal(isBefore18('1968-06-01', '1950'), false);
  assert.equal(isBefore18('1967-12-31', '1950'), true);
  assert.equal(isBefore18('1968-03-01', '1950-04-02'), true);
});

function recordsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE person_cards (slug TEXT, id TEXT, ord INTEGER, card TEXT);
    CREATE TABLE persons (person_id TEXT, display_name TEXT, ord INTEGER);
    CREATE TABLE r_elections (key TEXT, date TEXT, body_slug TEXT);
    CREATE TABLE contests (election_key TEXT, seq INTEGER, name TEXT);
    CREATE TABLE candidacies (election_key TEXT, contest_seq INTEGER, ord INTEGER, person_id TEXT, elected INTEGER);
    CREATE TABLE divisions (division_id TEXT, date TEXT, body TEXT);
    CREATE TABLE division_votes (division_id TEXT, ord INTEGER, person_id TEXT, vote TEXT, entry TEXT);
  `);
  const card = (id, title, born, died, extra = {}) => db.prepare('INSERT INTO person_cards VALUES (?, ?, ?, ?)').run(`${title.toLowerCase().replace(/\W+/g, '-')}-${id}`, id, Number(id), JSON.stringify({ title, born, died, ...extra }));
  card('104106', 'James Craig, 1st Viscount Craigavon', '1871-01-08', '1940', { officesHeld: [{ office: 'Prime Minister of Northern Ireland', start: '1921', end: '1940' }] });
  card('200', 'Young Councillor', '1960', null);
  card('300', 'Long Dead MP', '1746', '1822', { officesHeld: [{ office: 'Governor', start: '1780', end: '1830' }] });
  db.prepare('INSERT INTO persons VALUES (?, ?, ?)').run('400', 'No Dates Member', 400);
  const election = (key, date, body) => db.prepare('INSERT INTO r_elections VALUES (?, ?, ?)').run(key, date, body);
  election('parliament-of-northern-ireland__1929-05-22', '1929-05-22', 'parliament-of-northern-ireland');
  election('ireland-local__1974-06-18', '1974-06-18', 'ireland-local');
  election('londonderry-county-council__1924-05-30', '1924-05-30', 'londonderry-county-council');
  election('house-of-commons-of-the-united-kingdom__1922-11-15', '1922-11-15', 'house-of-commons-of-the-united-kingdom');
  const contest = (key, name) => db.prepare('INSERT INTO contests VALUES (?, 0, ?)').run(key, name);
  contest('parliament-of-northern-ireland__1929-05-22', 'North Down');
  contest('ireland-local__1974-06-18', 'Portlaoise');
  contest('londonderry-county-council__1924-05-30', 'Clady');
  contest('house-of-commons-of-the-united-kingdom__1922-11-15', 'Belfast East');
  const cand = (key, pid, elected = 1) => db.prepare('INSERT INTO candidacies VALUES (?, 0, 0, ?, ?)').run(key, pid, elected);
  cand('parliament-of-northern-ireland__1929-05-22', '104106');
  cand('ireland-local__1974-06-18', '200');
  cand('londonderry-county-council__1924-05-30', '300');
  cand('house-of-commons-of-the-united-kingdom__1922-11-15', '400');
  const division = (id, date, body) => db.prepare('INSERT INTO divisions VALUES (?, ?, ?)').run(id, date, body);
  division('stormont:1940:13', '1940-10-08', 'stormont');
  division('stormont:1941:1', '1941-01-28', 'stormont');
  division('commons:1919', '1919-02-25', 'commons');
  const vote = (id, pid, printed) => db.prepare('INSERT INTO division_votes VALUES (?, 0, ?, ?, ?)').run(id, pid, 'aye', JSON.stringify([printed, Number(pid), 'aye', 0, 'UUP']));
  vote('stormont:1940:13', '104106', 'Craigavon, Rt. Hon. The Viscount');
  vote('stormont:1941:1', '104106', 'Craigavon, Rt. Hon. The Viscount');
  vote('commons:1919', '400', 'Member, A.');
  return db;
}

test('the check finds a vote after death, a candidacy before 18 and a candidacy 100 years after death', () => {
  const problems = findLifespanProblems(recordsDb());
  const line = (p) => `${p.kind}|${p.personId}|${p.what}|${p.date}`;
  assert.deepEqual(problems.map(line).sort(), [
    'after-death|104106|vote|1941-01-28',
    'after-death|300|candidacy|1924-05-30',
    'before-18|200|candidacy|1974-06-18',
    'office-ends-after-death|300|office|1830',
    'vote-before-first-election|400|votes|1919-02-25',
  ].sort());
  const craig = problems.find((p) => p.personId === '104106');
  assert.match(craig.detail, /stormont:1941:1 \(aye\), printed "Craigavon, Rt\. Hon\. The Viscount"/);
  assert.equal(problems.find((p) => p.personId === '400').name, 'No Dates Member');
});

test('a reviewed exception is not reported', () => {
  const problems = findLifespanProblems(recordsDb(), { exceptions: [{ personId: '200', kind: 'before-18', date: '1974-06-18' }, { personId: '300', kind: 'after-death' }] });
  assert.ok(!problems.some((p) => p.personId === '200' && p.kind === 'before-18'));
  assert.ok(!problems.some((p) => p.personId === '300' && p.kind === 'after-death'));
  assert.ok(problems.some((p) => p.personId === '104106'));
});

test('build_browse_votes.py detaches a vote dated after the linked person\'s death, by the same rule', (t) => {
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const code = [
    'import runpy, json, sys',
    "m = runpy.run_path('scripts/build/build_browse_votes.py', run_name='lifespan_test')",
    "f = m['after_death']",
    "print(json.dumps([f('1941-01-28', '1940'), f('1940-12-01', '1940'), f('1940-11-25', '1940-11-24'), f('1940-11-24', '1940-11-24'), f('1940-12-01', '1940-11'), f('1941-01-01', '')]))",
  ].join('\n');
  const res = spawnSync(python, ['-c', code], { encoding: 'utf8' });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return;
  }
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout.trim().split('\n').pop()), [true, false, true, false, true, false]);
  for (const [date, died] of [['1941-01-28', '1940'], ['1940-12-01', '1940'], ['1940-11-25', '1940-11-24'], ['1940-12-01', '1940-11']]) {
    assert.equal(isAfter(date, died), JSON.parse(res.stdout.trim().split('\n').pop())[[['1941-01-28', '1940'], ['1940-12-01', '1940'], ['1940-11-25', '1940-11-24'], ['1940-11-24', '1940-11-24'], ['1940-12-01', '1940-11']].findIndex(([a, b]) => a === date && b === died)], `${date} after ${died}: the check and the build agree`);
  }
});

// The veto in the person-id steps (scripts/ingest/persons/person_lifespans.py), lifespans stream
// 11 Nov 2026: the same precision rule as the check, and the same dates the person page shows.
function runPython(t, code) {
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const res = spawnSync(python, ['-c', code], { encoding: 'utf8', cwd: new URL('../..', import.meta.url) });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return null;
  }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

const PRECISION_CASES = [
  ['1941-01-28', '1940'], ['1940-12-01', '1940'], ['1940-12-01', '1940-11'], ['1940-11-30', '1940-11'],
  ['1940-11-25', '1940-11-24'], ['1940-11-24', '1940-11-24'], ['1941-01-01', ''], ['1961', '1961-05'], ['1962', '1961-05'],
  ['1912', '1862-05-21'], ['1948-02-04', '1948-02-03'],
];
const BIRTH_CASES = [
  ['1927-06-09', '1927-06'], ['1968-06-01', '1950'], ['1967-12-31', '1950'], ['1968-03-01', '1950-04-02'],
  ['1974-06-18', '1960'], ['1978-01-01', '1960'], ['1945', '1927-06'], ['1945-06', '1927-06'], ['1944', ''],
];

test('person_lifespans.py and the check agree on every precision case', (t) => {
  const code = [
    'import json, runpy',
    "m = runpy.run_path('scripts/ingest/persons/person_lifespans.py')",
    `a = ${JSON.stringify(PRECISION_CASES)}`,
    `b = ${JSON.stringify(BIRTH_CASES)}`,
    "print(json.dumps([[m['is_after'](d, l) for d, l in a], [m['is_before_18'](d, x) for d, x in b]]))",
  ].join('\n');
  const out = runPython(t, code);
  if (!out) return;
  assert.deepEqual(out[0], PRECISION_CASES.map(([d, l]) => isAfter(d, l)));
  assert.deepEqual(out[1], BIRTH_CASES.map(([d, b]) => isBefore18(d, b)));
});

test('person_lifespans.py reads the dates the person page shows, and the allowlist', (t) => {
  const code = [
    'import json, sys',
    "sys.path.insert(0, 'scripts/ingest/persons')",
    'import person_lifespans as pl',
    'b = pl.load()',
    'out = {}',
    // History of Parliament through the row's own source id (William Stewart, died 1850).
    "out['hop'] = b.life(['hop:1820-1832/member/stewart-william-1781-1850'], [])",
    // Wikidata through an official id; Mark Henry's birth date (his election month) is set aside.
    "out['henry'] = b.life([], ['oireachtas:Mark-C-Henry.D.1927-06-23'])",
    // A reference work by person id where neither gives a date (Sir Henry Wilson, Boylan).
    "out['wilson'] = b.life([], [], 124621)",
    "out['none'] = b.life([], [], 1)",
    "out['stewart1972'] = pl.outside('1972-02-02', out['hop'])",
    "out['stewart1826'] = pl.outside('1826-06-07', out['hop'])",
    "keane = {'born': '1889', 'died': '1948-02-03'}",
    "out['keane'] = [pl.outside('1948-02-04', keane), b.outside('1948-02-04', keane, 113219), b.outside('1948-02-04', keane, 1)]",
    'print(json.dumps(out))',
  ].join('\n');
  const out = runPython(t, code);
  if (!out) return;
  assert.equal(out.hop.died, '1850-10-02');
  assert.equal(out.hop.source, 'History of Parliament');
  assert.equal(out.henry.born, undefined, 'the rejected Wikidata birth date is not read');
  assert.equal(out.henry.died, '1952');
  assert.equal(out.wilson.died, '1922');
  assert.equal(out.none, null);
  assert.equal(out.stewart1972, 'after-death');
  assert.equal(out.stewart1826, null);
  assert.deepEqual(out.keane, ['after-death', null, 'after-death'], 'the allowlist accepts the finding for its own person only');
});

test('build_browse_votes.py detaches a vote dated before the linked person was 18, by the same rule', (t) => {
  const code = [
    'import runpy, json',
    "m = runpy.run_path('scripts/build/build_browse_votes.py', run_name='lifespan_test')",
    `b = ${JSON.stringify(BIRTH_CASES)}`,
    "print(json.dumps([m['before_18'](d, x) for d, x in b]))",
  ].join('\n');
  const out = runPython(t, code);
  if (!out) return;
  assert.deepEqual(out, BIRTH_CASES.map(([d, b]) => isBefore18(d, b)));
});

test('apply_person_ids_v2.py treats a name-and-party candidacy id as a name', (t) => {
  const code = [
    'import json, sys',
    "sys.path.insert(0, 'scripts/ingest/persons')",
    'import apply_person_ids_v2 as a',
    "print(json.dumps([a.name_keyed_id('William Stewart|'), a.name_keyed_id('Henry Wilson|UUP'), a.name_keyed_id('2997493022'), a.name_keyed_id('T3551993284'),",
    "  sorted(a.WEAK_RUNGS)]))",
  ].join('\n');
  const out = runPython(t, code);
  if (!out) return;
  assert.deepEqual(out.slice(0, 4), [true, true, false, false]);
  assert.deepEqual(out[4], ['by-name', 'by-name-group', 'by-name-id', 'by-name-local', 'by-name-modern'], 'official, source-person and source-system ids are not weak');
});
