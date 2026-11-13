// Two overrides in the person-id builders (owner-approved 13 Nov 2026, stream persons-13):
//   * a key declared for a row in data/elections/persons/label-blanked-identity-keys.csv outranks
//     the row's ElectionsIreland ("ei:") or IrelandElection.com ("ie:") id
//     (build_person_registry_v2.declared_identity), for the rows listed there and no others;
//   * a row of person_id_confirmed_merges.csv whose override_vetoes column names a veto joins its
//     own pair over that veto (ei_relatives.load_overrides / overridden), and no other pair.
// A rebuild with these changes and no new data moved none of 79,479 stamps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);

function runPython(t, code) {
  const res = spawnSync(process.env.CIVGRAPH_PYTHON || 'python', ['-c', code], { encoding: 'utf8', cwd: REPO });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return null;
  }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

const PRELUDE = 'import sys, json; sys.path.insert(0, "scripts/ingest/persons")';

test('PDK-01 a declared key outranks an ei:/ie: id; other source ids are untouched', (t) => {
  const out = runPython(t, [
    PRELUDE,
    'from build_person_registry_v2 import declared_identity as d',
    'print(json.dumps([',
    "  d('Daniel Kennedy|nenagh-rearcross-1950-1979', '3', 'ie:2117'),",
    "  d('Daniel Kennedy|leix-offaly-farmers-1923-1932', '7', 'ei:1338'),",
    "  d('ei:1927', '1', 'ie:1845'),",
    "  d('James Watt|UUP', 'James Webb|', ''),",
    "  d('X|y', '5', 'wikipedia:Some Title'),",
    ']))',
  ].join('\n'));
  if (out) {
    assert.deepEqual(out, [
      ['Daniel Kennedy|nenagh-rearcross-1950-1979', ''],
      ['Daniel Kennedy|leix-offaly-farmers-1923-1932', ''],
      ['1', 'ei:1927'],
      ['James Watt|UUP', ''],
      ['X|y', 'wikipedia:Some Title'],
    ]);
  }
});

test('PDK-02 the override applies only to rows the file lists: the registry scan leaves every other row as it was', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pdk-'));
  try {
    const keys = join(dir, 'keys.csv');
    writeFileSync(keys, 'election,constituency,name,identity_key,prior_person_id,label_blanked_in\n'
      + 'ireland-local__1950-09-20,Castlebar,Mícheál Ó Móráin,ei:1927,127812,persons-13\n');
    const meta = join(dir, 'meta');
    const bundle = {
      key: 'ireland-local__1950-09-20', date: '1950-09-20', bodySlug: 'ireland-local',
      results: [
        { constituency: 'Castlebar', candidates: [{ name: 'Mícheál Ó Móráin', id: '1', sourcePersonId: 'ie:1845' }] },
        { constituency: 'Connemara', candidates: [{ name: 'Mícheál Ó Móráin', id: '2', sourcePersonId: 'ie:1845' }] },
      ],
    };
    const out = runPython(t, [
      PRELUDE,
      'import os',
      `os.makedirs(${JSON.stringify(meta)})`,
      `json.dump(${JSON.stringify(bundle)}, open(os.path.join(${JSON.stringify(meta)}, 'x.json'), 'w', encoding='utf-8'))`,
      'import build_person_registry_v2 as b',
      `b.LABEL_BLANKED = ${JSON.stringify(keys)}`,
      `b.META = ${JSON.stringify(meta)}`,
      "print(json.dumps([(r['cons'], r['id'], r['src']) for r in b.scan()]))",
    ].join('\n'));
    if (out) assert.deepEqual(out, [['Castlebar', '1', 'ei:1927'], ['Connemara', '2', 'ie:1845']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PDK-03 a confirmed row overrides the vetoes it names for its own pair only', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pdk-'));
  try {
    const csv = join(dir, 'confirmed.csv');
    writeFileSync(csv, 'keep,drop,name,keep_years,drop_years,article,evidence_keep,evidence_drop,keep_keys,drop_keys,override_vetoes\n'
      + '100298,111146,John Beirne,,,x,,,ei:4933 ; oireachtas:J-Jnr,ei:2114 ; oireachtas:J-Snr,ei-relatives ; official-ids\n'
      + '1,2,Other,,,x,,,ei:1,ei:2\n');
    const people = {
      'ei:4933': { name: 'John Beirne 2 Jnr', relatives: {} }, 'ei:2114': { name: 'John Beirne 1 Snr', relatives: {} },
      'ei:2517': { name: 'Brian Lenihan 1 Snr', relatives: { 'ei:6470': 'Son' } }, 'ei:6470': { name: 'Brian Lenihan 2 Jnr', relatives: {} },
    };
    const out = runPython(t, [
      PRELUDE,
      'import ei_relatives as e',
      `o = e.load_overrides(${JSON.stringify(csv)})`,
      `p = ${JSON.stringify(people)}`,
      'print(json.dumps([',
      "  e.distinct(p, {'ei:4933'}, {'ei:2114'}) is not None,",
      "  e.distinct(p, {'ei:4933'}, {'ei:2114'}, o),",
      "  e.distinct(p, {'ei:2114', 'oireachtas:J-Snr'}, {'ei:4933'}, o),",
      "  e.distinct(p, {'ei:2517'}, {'ei:6470'}, o) is not None,",
      "  e.overridden(o, 'official-ids', {'oireachtas:J-Jnr'}, {'oireachtas:J-Snr'}),",
      "  e.overridden(o, 'official-ids', {'oireachtas:J-Jnr'}, {'oireachtas:Other'}),",
      "  e.overridden(o, 'ei-relatives', {'ei:1'}, {'ei:2'}),",
      ']))',
    ].join('\n'));
    if (out) assert.deepEqual(out, [true, null, null, true, true, false, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PDK-04 the crosswalk builder never writes a pair the papers rejected, even one on file', (t) => {
  const out = runPython(t, [
    PRELUDE,
    'import build_ie_ei_crosswalk as x',
    "print(json.dumps([list(k) for k in x.REJECTED_PAIRS]))",
  ].join('\n'));
  if (out) assert.deepEqual(out, [['ie:2117', 'ei:1338']]);
});
