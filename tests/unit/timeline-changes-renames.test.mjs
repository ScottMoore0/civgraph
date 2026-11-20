// Renames between consecutive timeline editions (scripts/build/timeline-changes.py). Phelim (20 Nov
// 2026): Leix was renamed Laoighis between the 1927 and 1955 counties, and the changes panel
// listed only a 16 ha transfer. The builder finds a rename by the unit's stable id where the two
// editions share one, else by geometry, and tells a rename from two sources labelling one unit
// differently (rename_verdict). The panel lists renames as their own kind, counted in the summary.
//
//   Run with node --test on this file. Needs python with geopandas (skipped without python).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);

/**
 * Run `body` (Python, with `m` the builder's namespace and `cases` the JSON input) and return the
 * JSON it prints last; null (the test skipped) without python.
 * @param {import('node:test').TestContext} t
 * @param {string} body
 * @param {unknown} [cases]
 */
function py(t, body, cases = null) {
  const code = [
    'import json, runpy, sys, warnings',
    "warnings.filterwarnings('ignore')",
    "m = runpy.run_path('scripts/build/timeline-changes.py')",
    'cases = json.loads(sys.stdin.read())',
    body,
  ].join('\n');
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const res = spawnSync(python, ['-c', code], { encoding: 'utf8', cwd: REPO, input: JSON.stringify(cases) });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return null;
  }
  if (res.status !== 0 && /No module named '(geopandas|shapely|pyogrio)'/.test(res.stderr)) {
    t.skip('no geopandas');
    return null;
  }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop() || 'null');
}

test('rename_verdict: a real rename, and the label differences that are not one', (t) => {
  /** @type {Array<[string, string, string, Record<string, unknown>?]>} [old, new, expected, context] */
  const cases = [
    ['LEIX', 'LAOIGHIS', 'renamed'],
    ["QUEEN'S COUNTY", 'LAOIGHIS', 'renamed'],
    ['Kingstown No. 1', 'Dún Laoghaire No. 1', 'renamed'],
    ['Bangor Urban District', 'Bangor Municipal Borough', 'renamed'],
    // The 1980 Act renamed South Kerry as Kerry South: word order alone is a rename.
    ['South Kerry', 'Kerry South', 'renamed'],
    // Case, spacing, accents and punctuation are one name.
    ['LAOIGHIS', 'Laoighis', 'same'],
    ['  Dun   Laoghaire ', 'DÚN LAOGHAIRE', 'same'],
    ['Cavan-Monaghan (4)\n', 'Cavan-Monaghan (4)', 'same'],
    ['', 'Anything', 'same'],
    // Two sources labelling one unit differently.
    ['95PP030006', 'N00002929', 'code'],
    ['Galway East', 'Galway East (3)', 'seats'],
    ['Kildare South (3)', 'Kildare South (4)', 'seats'],
    ['ATHLONE EAST URBAN', "ATHLONE EAST URBAN (ST. MARY'S)", 'parenthetical'],
    ['NORTH EAST', 'CORK No. 3 URBAN (NORTH EAST WARD)', 'parenthetical'],
    ['Co. Antrim', 'ANTRIM', 'type word'],
    ['Omagh Rural District', 'OMAGH', 'type word'],
    ['North Mayo', 'Mayo N', 'abbreviation'],
    ['South-East Cork', 'Cork SE', 'abbreviation'],
    ['SLIGO WEST URBAN', 'SLIGO WEST', 'qualifier', { namesA: ['sligo west urban'], namesB: ['sligo west'] }],
    // Buncrana became an urban district: the old ED was divided into Urban and Rural.
    ['BUNCRANA', 'BUNCRANA RURAL', 'renamed', { namesA: ['buncrana'], namesB: ['buncrana rural', 'buncrana urban'] }],
    ['AGHAGALLON', 'Aghagallon_2', 'numbered part', { namesB: ['aghagallon 1', 'aghagallon 2'] }],
    ['GLASNEVIN', 'GLASNEVIN A', 'numbered part', { namesB: ['glasnevin a', 'glasnevin b'] }],
    ['CENTRAL', 'Central_Ards', 'numbered part'],
    ['GLENDUN', 'Glenaan_&_Glendun', 'renamed'],
    // The 1918 constituencies write "Mayo N": their "Cork Mid" is the same convention.
    ['Mid Cork', 'Cork Mid', 'abbreviation', { namesB: ['cork mid', 'mayo n'] }],
    ['Gort na Tiobratan', 'GORTNATUBBRID', 'other name field', { altsB: ['Gort na Tiobratan'] }],
    ['Port Láirge', 'WATERFORD', 'other name field', { altsA: ['Waterford'] }],
    // Both editions label from one field: the source itself renamed it (an official renaming,
    // though the old unit's Irish-name field already held the new name).
    ['EDGEWORTHSTOWN', 'MEATHAS TRUIM', 'renamed', { altsA: ['Meathas Troim'], sameField: true }],
    // A code against a name is a change of label field, not a rename.
    ['067048003', 'CARROWBROWNE', 'code'],
  ];
  const got = py(t, [
    'out = []',
    'for na, nb, _, ctx in cases:',
    '    ctx = ctx or {}',
    "    out.append(m['rename_verdict'](na, nb, tuple(ctx.get('altsA', [])), tuple(ctx.get('altsB', [])), frozenset(ctx.get('namesA', [])), frozenset(ctx.get('namesB', [])), bool(ctx.get('sameField'))))",
    'print(json.dumps(out))',
  ].join('\n'), cases.map(([a, b, want, ctx]) => [a, b, want, ctx || null]));
  if (!got) return;
  assert.deepEqual(got.map((verdict, i) => `${cases[i]?.[0]} -> ${cases[i]?.[1]}: ${verdict}`),
    cases.map(([a, b, want]) => `${a} -> ${b}: ${want}`));
});

test('summary_line counts renames apart from the land that changed hands', (t) => {
  const got = py(t, "print(json.dumps([m['summary_line'](*c) for c in cases]))",
    [[1, 0, 15.5], [2, 1, 15.5], [1, 1, 0], [3, 3, 0], [3, 2, 0]]);
  if (!got) return;
  assert.deepEqual(got, ['1 change, 16 ha in all.', '2 changes (1 rename), 16 ha in all.', '1 rename.', '3 renames.', '3 changes (2 renames).']);
});

// Two editions of a row of square units, written as GeoJSON and compared by compare(). Each unit:
// [west edge in steps, east edge in steps, name, code, other-name field]; a case may name the
// field each edition labels from (fieldA, fieldB; NAME by default).
const COMPARE = `
import os, tempfile, geopandas as gpd
from shapely.geometry import box
STEP = 0.02
def write(units, path, field):
    rows = [{field: n, 'CODE': c, 'GAEILGE': g, 'geometry': box(-8 + w * STEP, 53, -8 + e * STEP, 53 + STEP)} for w, e, n, c, g in units]
    gpd.GeoDataFrame(rows, crs='EPSG:4326').to_file(path, driver='GeoJSON')
out = []
with tempfile.TemporaryDirectory() as tmp:
    for k, case in enumerate(cases):
        a, b = os.path.join(tmp, f'{k}a.geojson'), os.path.join(tmp, f'{k}b.geojson')
        fa, fb = case.get('fieldA', 'NAME'), case.get('fieldB', 'NAME')
        write(case['a'], a, fa)
        write(case['b'], b, fb)
        pair = {'id': f'a{k}__b{k}', 'fromMapId': 'a', 'toMapId': 'b', 'fromSources': [(a, fa)], 'toSources': [(b, fb)]}
        summary, fc = m['compare'](pair)
        out.append({'summary': summary, 'changes': [c['text'] for c in (fc or {}).get('changes', [])],
                    'types': [c['type'] for c in (fc or {}).get('changes', [])],
                    'roles': sorted({f['properties']['role'] for f in (fc or {}).get('features', [])})})
print(json.dumps(out))
`;

/** A row of eight units, 0-8 steps, named U0..U7 with codes 100..107 (and no other names). */
const row = () => Array.from({ length: 8 }, (_, i) => [i, i + 1, `U${i}`, 100 + i, null]);

test('compare: Leix renamed Laoighis is listed as a rename, counted, and outlined', (t) => {
  const a = row();
  a[3] = [3, 4, 'LEIX', 103, 'Laois'];
  const b = row();
  b[3] = [3, 4, 'LAOIGHIS', 103, 'Laois'];
  // Case and spacing alone ("U5" / " u5 ") are no change.
  b[5] = [5, 6, ' u5 ', 105, null];
  const got = py(t, COMPARE, [{ a, b }]);
  if (!got) return;
  const [one] = got;
  assert.deepEqual(one.changes, ['LEIX renamed LAOIGHIS']);
  assert.equal(one.summary.kind, 'changes');
  assert.equal(one.summary.count, 1);
  assert.equal(one.summary.renamed, 1);
  assert.equal(one.summary.text, '1 rename.');
  assert.deepEqual(one.roles, ['renamed'], 'a rename is an outline, not a changed area');
});

test('compare: a unit matched by its stable id is a rename even when it lost much of its land', (t) => {
  // U3 (code 103) gives most of its land to U4 and is renamed: geometry alone (60% of each)
  // cannot call it a rename; the code the two editions share does.
  const a = row();
  const b = row();
  b[3] = [3, 3.45, 'NEWNAME', 103, null];
  b[4] = [3.45, 5, 'U4', 104, null];
  const noCodes = (/** @type {any[][]} */ units) => units.map(([w, e, n]) => [w, e, n, null, null]);
  const got = py(t, COMPARE, [{ a, b }, { a: noCodes(a), b: noCodes(b) }]);
  if (!got) return;
  const [withId, without] = got;
  assert.ok(withId.changes.includes('U3 renamed NEWNAME'), JSON.stringify(withId.changes));
  assert.ok(withId.types.includes('transfer'), 'the land it lost is listed too');
  assert.ok(!without.changes.some((/** @type {string} */ text) => /renamed/.test(text)), JSON.stringify(without.changes));
});

test('compare: an Irish name in one edition and the English in the next is not a rename', (t) => {
  // eds-2006 labels Gaeltacht EDs in Irish (EDNAME); eds-2019 in English, with a GAEILGE field.
  const a = row();
  a[2] = [2, 3, 'Gort na Tiobratan', 102, null];
  const b = row();
  b[2] = [2, 3, 'GORTNATUBBRID', 102, 'Gort na Tiobratan'];
  // The same two editions labelled from one field: the source renamed it.
  const got = py(t, COMPARE, [{ a, b, fieldA: 'EDNAME', fieldB: 'ENGLISH' }, { a, b }]);
  if (!got) return;
  const [fields, oneField] = got;
  assert.deepEqual(fields.changes, []);
  assert.equal(fields.summary.kind, 'none');
  assert.deepEqual(fields.summary.labelVariants, { 'other name field': 1 });
  assert.deepEqual(oneField.changes, ['Gort na Tiobratan renamed GORTNATUBBRID']);
});
