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
