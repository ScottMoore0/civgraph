// The Seanad's person joins (stream seanad-2, owner decisions of 13 Nov 2026), as they stand in the
// committed person registry and the Seanad builder:
//   * the Mayo senator Paddy Burke keeps 119411; IrelandElection.com's 1967 Castlebar row, which
//     the era rule splits off, is held by a declared key and takes another id;
//   * the 24 winners matched by surname, or not matched by the member list, were checked against
//     the Oireachtas record of their panel or university and term (seanad-member-checks.csv), and
//     every accepted one is linked with its member code;
//   * Brendan Ryan, the National University senator of 1981-2007, is not the Fingal Brendan Ryan
//     whose IrelandElection.com id (ie:816) the university rows also carried;
//   * the four local-election ids the Seanad rows retired still redirect.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);
const at = (file) => new URL(`../../data/elections/persons/${file}`, import.meta.url);
const { entities } = JSON.parse(readFileSync(at('person_registry.json'), 'utf8'));
const byId = new Map(entities.map((e) => [e.personId, e]));
/** @param {string} key */
const holders = (key) => entities.filter((e) => (e.sourceIds || []).includes(key) || (e.sourcePersonIds || []).includes(key)
  || (e.officialPersonIds || []).includes(key)).map((e) => e.personId);
/** @param {string} key */
const holder = (key) => {
  const h = holders(key);
  assert.equal(h.length, 1, `${key} is held by ${h.length} people (${h.join(', ')})`);
  return h[0];
};
const confirmed = readFileSync(at('person_id_confirmed_merges.csv'), 'utf8').split('\n').filter(Boolean).slice(1)
  .map((l) => l.split(','));
const redirect = new Map(confirmed.map(([keep, drop]) => [Number(drop), Number(keep)]));

/** @param {string} text */
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

test('PSJ-01 the Mayo senator Paddy Burke keeps 119411; the 1967 Castlebar row is another person', () => {
  assert.equal(holder('oireachtas:Paddy-Burke.S.1993-02-17'), 119411);
  const senator = byId.get(119411);
  assert.ok(senator.bodies.includes('seanad-eireann'));
  assert.ok(senator.bodies.includes('ireland-local'));
  assert.ok(senator.firstYear >= 1974, `119411 starts in ${senator.firstYear}`);
  const castlebar1967 = holder('Paddy Burke|castlebar-1967');
  assert.notEqual(castlebar1967, 119411);
  assert.equal(byId.get(castlebar1967).candidacies, 1);
  assert.equal(byId.get(castlebar1967).firstYear, 1967);
});

test('PSJ-02 the checked winners are linked to the member code the check names, and none is left at medium confidence', () => {
  const checks = csvRows(readFileSync(at('seanad-member-checks.csv'), 'utf8'));
  assert.equal(checks.length, 24);
  const { links } = JSON.parse(readFileSync(at('official-person-ids.json'), 'utf8'));
  const seanad = links.filter((l) => String(l.election).startsWith('seanad-eireann__'));
  for (const c of checks) {
    assert.ok(c.evidence && c.checked, `${c.name}: evidence recorded`);
    const link = seanad.find((l) => l.election === c.election && l.constituency === c.contest && l.name === c.name);
    if (c.verdict === 'accept') {
      assert.ok(link, `${c.election} ${c.contest} ${c.name} is linked`);
      assert.equal(link.id, c.oireachtas_code);
      assert.equal(link.confidence, 'high');
    } else {
      assert.equal(link, undefined, `${c.name} is kept unjoined`);
    }
  }
  assert.deepEqual(seanad.filter((l) => l.confidence !== 'high').map((l) => l.name), []);
});

test('PSJ-03 Brendan Ryan of the National University is not the Fingal Brendan Ryan', () => {
  const nui = holder('Brendan Ryan|nui-senator-1981-2007');
  assert.equal(byId.get(nui).candidacies, 2);
  assert.ok(byId.get(nui).officialPersonIds.includes('oireachtas:Brendan-Ryan.S.1981-08-10'));
  assert.ok(!byId.get(nui).officialPersonIds.includes('oireachtas:Brendan-Ryan.S.2007-07-23'));
  assert.notEqual(holder('oireachtas:Brendan-Ryan.S.2007-07-23'), nui);
  assert.ok(!(byId.get(nui).sourcePersonIds || []).includes('ie:816'));
});

test('PSJ-04 the four local-election ids the Seanad rows retired redirect to the person they joined', () => {
  for (const [drop, keep] of [[128458, 101226], [129764, 118766], [151699, 108679], [129357, 118572]]) {
    assert.equal(redirect.get(drop), keep);
    assert.ok(byId.has(keep), `${keep} is a person`);
    assert.ok(!byId.has(drop), `${drop} is retired`);
    assert.ok(byId.get(keep).bodies.includes('seanad-eireann'), `${keep} sat in the Seanad`);
  }
});

test('PSJ-05 the Seanad builder takes a checked member only for its own contest and term', (t) => {
  const code = [
    'import sys, json, runpy',
    "m = runpy.run_path('scripts/ingest/seanad/build_seanad.py', run_name='seanad')",
    "m['CHECKED'].update({('seanad-eireann__2002-09-12', 'National University of Ireland', 'Brendan Ryan'): {'verdict': 'accept', 'oireachtas_code': 'B.S.1981'},",
    "                     ('seanad-eireann__2002-09-12', 'Labour Panel', 'X Y'): {'verdict': 'unjoined', 'oireachtas_code': ''}})",
    "members = [{'code': 'B.S.1981', 'name': 'Brendan Ryan', 'contest': 'National University of Ireland'}, {'code': 'B.S.1982', 'name': 'Brendan Ryan', 'contest': 'National University of Ireland'}]",
    "f = m['checked_member']",
    'out = [f("Brendan Ryan", "National University of Ireland", "2002-09-12", members, None),',
    '       f("X Y", "Labour Panel", "2002-09-12", members, None),',
    '       f("Z", "Labour Panel", "2002-09-12", members, None)]',
    'for bad in [lambda: f("Brendan Ryan", "National University of Ireland", "2002-09-12", members, members[1]),',
    "            lambda: f('Brendan Ryan', 'National University of Ireland', '2002-09-12', [dict(members[0], contest='Labour Panel')], None)]:",
    '    try:',
    '        bad(); out.append("no exit")',
    '    except SystemExit as e:',
    '        out.append(str(e).startswith("FAIL"))',
    'print(json.dumps(out))',
  ].join('\n');
  const res = spawnSync(process.env.CIVGRAPH_PYTHON || 'python', ['-c', code], { encoding: 'utf8', cwd: REPO });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return;
  }
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.deepEqual(out, [
    [{ code: 'B.S.1981', name: 'Brendan Ryan', contest: 'National University of Ireland' }, 'checked'],
    [null, 'checked: kept unjoined'],
    null,
    true,
    true,
  ]);
});
