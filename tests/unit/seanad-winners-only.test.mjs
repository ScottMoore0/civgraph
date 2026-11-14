/**
 * The Seanad's winners-only contests (scripts/ingest/seanad/winners_only.py, wave 14): the general
 * elections of 1938-1997 and the by-elections. WO-01..03 run the builder's pure parts in Python
 * (skipped where no Python is installed); WO-04..06 read the files it wrote.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DIR = path.join(REPO, 'data/elections-source/data/elections/seanad-eireann');

/** Runs Python code in the repo and returns the JSON its last line prints, or null without Python. */
function python(t, lines) {
  const res = spawnSync(process.env.CIVGRAPH_PYTHON || 'python', ['-c', lines.join('\n')], { encoding: 'utf8', cwd: REPO });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return null;
  }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

const SETUP = [
  'import json, runpy',
  "b = runpy.run_path('scripts/ingest/seanad/build_seanad.py', run_name='seanad')",
  "w = runpy.run_path('scripts/ingest/seanad/winners_only.py')",
];

test('WO-01 an Oireachtas name loses its honorific and its Snr./Jnr.', (t) => {
  const out = python(t, [...SETUP,
    "print(json.dumps([w['clean_name'](n) for n in ['Prof. Michael Tierney', 'Brian Lenihan Snr.', 'Daniel Hogan Jnr.', 'Dr. Robert James Rowlette', 'Mary Robinson']]))"]);
  if (out) assert.deepEqual(out, ['Michael Tierney', 'Brian Lenihan', 'Daniel Hogan', 'Robert James Rowlette', 'Mary Robinson']);
});

test('WO-02 each seat pairs an Oireachtas member with the IrelandElection.com winner: checks first, then name, initial, surname', (t) => {
  const out = python(t, [...SETUP,
    "ctx = {'fold': b['fold'], 'CHECKED': {('E', 'P', 'Ted Russell'): {'verdict': 'accept', 'oireachtas_code': 'G-Russell'},",
    "                                     ('E', 'P', 'Sean Conway'): {'verdict': 'unjoined', 'oireachtas_code': ''},",
    "                                     ('E', 'P', 'Michael Smith'): {'verdict': 'accept-without-ie-id', 'oireachtas_code': 'M'}}}",
    "x = w['WinnersOnly'](ctx, None, None)",
    "pool = [{'code': 'A', 'name': 'Ann Byrne', 'first': 'Ann', 'last': 'Byrne'},",
    "        {'code': 'J', 'name': 'John J. Brennan', 'first': 'John', 'last': 'Brennan'},",
    "        {'code': 'G-Russell', 'name': 'George E. Russell', 'first': 'George', 'last': 'Russell'},",
    "        {'code': 'T', 'name': 'Thomas Budd', 'first': 'Thomas', 'last': 'Budd'},",
    "        {'code': 'X', 'name': 'Extra Person', 'first': 'Extra', 'last': 'Person'},",
    "        {'code': 'M', 'name': 'Michael Smith', 'first': 'Michael', 'last': 'Smith'}]",
    "cands = [{'name': n} for n in ['Ann Byrne', 'John Brennan', 'Ted Russell', 'Gardner Budd', 'Sean Conway', 'Nobody Else', 'Michael Smith']]",
    "pairs = x.pair('E', 'P', pool, cands)",
    "print(json.dumps(sorted([[(m or {}).get('code'), (k or {}).get('name'), how] for m, k, how in pairs], key=str)))"]);
  if (!out) return;
  assert.deepEqual(out, [
    ['A', 'Ann Byrne', 'name'],
    ['G-Russell', 'Ted Russell', 'checked'],
    ['J', 'John Brennan', 'surname and initial'],
    ['M', 'Michael Smith', 'checked: IrelandElection.com id not carried'],
    ['T', 'Gardner Budd', 'surname alone'],
    ['X', null, 'no IrelandElection.com winner'],
    [null, 'Nobody Else', 'no Oireachtas member'],
    [null, 'Sean Conway', 'checked: unjoined'],
  ]);
});

test('WO-03 Wikipedia templates: a by-election entry and an STV count box', (t) => {
  const entry = '\n|housenum  = 3\n|constit   = [[Cultural and Educational Panel|Cultural and Educational]]\n|outgoing  = {{sortname|Thomas|Delany}}\n|winner    = [[Ray McAdam]] <ref name=x/>\n|reason    = Death\n';
  const box = "{{STV Election box begin2\n |title = 2021 Seanad by-election: [[Agricultural Panel]]\n |numcounts = 2\n}}\n"
    + "{{STV Election box candidate2\n |candidate = '''[[Maria Byrne]]'''\n |party = Fine Gael\n |count1 = '''118,000'''\n |count2 = 120,000\n}}\n"
    + "{{STV Election box candidate2\n |candidate = Angela Feeney\n |party = Labour Party (Ireland)\n |count1 = 15,000\n |count2 = &nbsp;\n}}\n"
    + "{{STV Election box end2\n |numcounts = 2\n |electorate = 218{{efn|x}}\n |valid = 133,000\n |quota = 66,501\n}}";
  const out = python(t, [...SETUP,
    `f = w['template_fields'](${JSON.stringify(entry)})`,
    `boxes = w['stv_boxes'](${JSON.stringify(box)})`,
    "print(json.dumps([f['constit'], f['outgoing'], f['winner'], boxes]))"]);
  if (!out) return;
  const [constit, outgoing, winner, boxes] = out;
  assert.equal(constit, 'Cultural and Educational');
  assert.equal(outgoing, 'Thomas Delany');
  assert.equal(winner, 'Ray McAdam');
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].title, '2021 Seanad by-election: Agricultural Panel');
  assert.deepEqual(boxes[0].candidates.map((c) => [c.name, c.elected, c.counts]), [['Maria Byrne', true, [118000, 120000]], ['Angela Feeney', false, [15000, null]]]);
  assert.equal(boxes[0].end.quota, '66501');
});

/** Every Seanad contest file, with its folder date. */
function contests() {
  const out = [];
  for (const date of readdirSync(DIR)) {
    for (const file of readdirSync(path.join(DIR, date))) {
      if (file.endsWith('.json') && file !== '_index.json') out.push({ date, file, doc: JSON.parse(readFileSync(path.join(DIR, date, file), 'utf8')) });
    }
  }
  return out;
}

const GENERAL = new Set(['1938-04-27', '1938-09-07', '1943-09-08', '1944-08-18', '1948-04-21', '1951-08-14', '1954-07-22', '1957-05-22', '1961-12-14', '1965-06-23',
  '1969-11-05', '1973-06-01', '1977-10-27', '1981-10-08', '1982-05-13', '1983-02-23', '1987-04-25', '1989-10-01', '1993-02-17', '1997-09-17']);

test('WO-04 1938-1997: twenty general elections, seven contests each, 980 winners, winners only, no votes', () => {
  const general = contests().filter((c) => GENERAL.has(c.date));
  assert.equal(new Set(general.map((c) => c.date)).size, 20);
  assert.equal(general.length, 140);
  let seats = 0;
  for (const { date, file, doc } of general) {
    const info = doc.Constituency.countInfo;
    assert.equal(info.Candidates_Recorded, 'winners', `${date}/${file}`);
    const rows = doc.Constituency.countGroup;
    assert.equal(rows.length, Number(info.Number_Of_Seats), `${date}/${file}: one row a winner`);
    assert.ok(rows.every((r) => r.Status === 'Elected' && r.Total_Votes === '' && r.Candidate_First_Pref_Votes === ''), `${date}/${file}`);
    seats += rows.length;
  }
  assert.equal(seats, 980);
  // The counted elections of 2002-2025 are untouched by the flag.
  assert.ok(contests().filter((c) => c.date >= '2002-09-12' && !c.doc.cause).every((c) => !c.doc.Constituency.countInfo.Candidates_Recorded));
});

test('WO-05 the by-elections: fifty seats, titled by the by-election templates, each with its cause', () => {
  // the Seanad of 1938 on (the Free State Seanad's, in its one constituency, are seanad-3b's: SFS tests)
  const by = contests().filter((c) => c.date >= '1937' && !GENERAL.has(c.date) && (c.doc.cause || /winner's membership/.test(c.doc.sourceNote || '')));
  const seats = by.reduce((n, c) => n + Number(c.doc.Constituency.countInfo.Number_Of_Seats), 0);
  assert.equal(seats, 50);
  assert.equal(by.length, 47);
  // Wikipedia's list names the vacancy of every one but Frederick Summerfield's (1945).
  assert.deepEqual(by.filter((c) => !c.doc.cause).map((c) => `${c.date}/${c.file}`), ['1945-03-07/industrial-and-commercial-panel.json']);
  // Counted (2014, 2021, 2022, 2026) and unopposed (2019, 2024) by-elections carry no winners-only flag.
  const flagged = by.filter((c) => c.doc.Constituency.countInfo.Candidates_Recorded !== 'winners').map((c) => c.date).sort();
  assert.deepEqual(flagged, ['2014-10-10', '2019-11-01', '2021-04-21', '2021-04-21', '2022-04-04', '2024-04-08', '2026-11-06']);
  const index = JSON.parse(readFileSync(path.join(REPO, 'data/elections-source/data/elections_index.json'), 'utf8'));
  const body = index.bodies.find((b) => b.slug === 'seanad-eireann');
  const title = (date) => canonicalElectionTitle({ body: 'Seanad Éireann', bodySlug: 'seanad-eireann', date, constituencies: body.dates.find((d) => d.date === date).constituencies });
  assert.equal(title('1941-01-22'), '1941 Seanad by-election (Cultural and Educational Panel)');
  assert.equal(title('1956-05-14'), '1956 Seanad by-elections');
  assert.equal(title('1975-04-23'), '1975 Seanad by-elections');
  assert.equal(title('1938-04-27'), 'April 1938 Seanad election');
  assert.equal(title('1938-09-07'), 'August 1938 Seanad election');
  assert.equal(title('1997-09-17'), '1997 Seanad election');
});

test('WO-06 every 1938-97 winner carries the Oireachtas member code but the three the Oireachtas holds under other names', () => {
  const official = JSON.parse(readFileSync(path.join(REPO, 'data/elections/persons/official-person-ids.json'), 'utf8'));
  const linked = new Set(official.links.filter((l) => l.system === 'oireachtas').map((l) => `${l.election}|${l.constituency}|${l.candidateId}`));
  const missing = [];
  for (const { date, doc } of contests().filter((c) => GENERAL.has(c.date))) {
    for (const r of doc.Constituency.countGroup) {
      if (!linked.has(`seanad-eireann__${date}|${doc.constituency}|${r.Candidate_Id}`)) missing.push(`${date} ${r.candidateName}`);
    }
  }
  assert.deepEqual(missing.sort(), ['1965-06-23 Dermot Honan', '1969-11-05 Dermot Honan', '1982-05-13 Seán Conway']);
});
