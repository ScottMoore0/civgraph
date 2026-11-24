// The pure steps of the 1926-1961 Northern Ireland census extraction (stream w23-census-1926-61):
// reading printed counts and OCR rows, naming areas, the checks against a table's own totals,
// matching census DEDs to map features, apportioning counts and building stable areas
// (scripts/ingest/census/hist_census_lib.py, hist_census_parse.py, hist_census_religion.py).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const DIR = fileURLToPath(new URL('../../scripts/ingest/census/', import.meta.url));

/**
 * Runs Python with the census modules importable; skips when Python is missing.
 * @param {import('node:test').TestContext} t
 * @param {string} code
 * @returns {any}
 */
function py(t, code) {
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const res = spawnSync(python, ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(DIR)})\n${code}`], { encoding: 'utf8' });
  if (res.error) return t.skip(`no python (${res.error.message})`);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test('printed counts: commas, notes, dashes and dots', (t) => {
  const out = py(t, `
from hist_census_lib import parse_int, acres
print(json.dumps([parse_int('2,198 [Note 3]'), parse_int(' - '), parse_int('.'), parse_int(1234), parse_int('1,234*'),
                  acres(84, 2, 0), acres(155, 2, 26)]))`);
  if (!out) return;
  assert.deepEqual(out, [2198, null, null, 1234, 1234, 84.5, 155.6625]);
});

test('DED labels: serial, name and ward', (t) => {
  const out = py(t, `
from hist_census_lib import split_ded_label, norm_key, district_kind
print(json.dumps([split_ded_label('TOTAL 4. Ballymena No. 1 Urban D.E.D. or Market Ward'),
                  split_ded_label('Total 93 ECCLESVILLE D.E.D.'),
                  norm_key('Rich Hill'), norm_key('RICHHILL'), norm_key('Ballymena No. 1 Urban'),
                  district_kind('Newry No.2 Rural District [Note aa]'), district_kind('Bangor Municipal Borough')]))`);
  if (!out) return;
  assert.deepEqual(out[0], [4, 'Ballymena No. 1 Urban', 'Market']);
  assert.deepEqual(out[1], [93, 'ECCLESVILLE', null]);
  assert.equal(out[2], out[3]);
  assert.equal(out[4], 'ballymena1');
  assert.deepEqual(out.slice(5), ['rural_district', 'municipal_borough']);
});

test('checks: a missing part makes a check na, never ok', (t) => {
  const out = py(t, `
from hist_census_lib import check_sum, check_sexes, row_status
print(json.dumps([check_sum([1, 2], 3), check_sum([1, None], 3), check_sum([1, 2], 4), check_sexes(25640, 10986, 14654),
                  row_status(['ok', 'na']), row_status(['ok', 'fail']), row_status(['na'])]))`);
  if (!out) return;
  assert.deepEqual(out, [['ok', 0], ['na', null], ['fail', -1], ['ok', 0], 'ok', 'fail', 'na']);
});

test('OCR rows: serials are labels, thousands commas joined only where the tables space them', (t) => {
  const out = py(t, `
from hist_census_parse import records, find_triple, repair_triple, clean_ocr_name, smooth_serials
r37 = records(['24, Cargin -    :   5,775} 940) 898] 471   427] 257} 235)'], False)[0]
r51 = records(['1. BALLYCASTLE, NORTH D.E.D. OR WARD   416   1 [22     1, 490    1,649     710      939     369'], True)[0]
r37b = records(['15. Bovedy      »      5,351     978    974, 496    478    277    261'], False)[0]
rows = [{'area_type': 'ded', 'ref': x} for x in (62, 63, 84, 65, 66)]
smooth_serials(rows)
print(json.dumps({'label': r37['label'], 'nums': r37['nums'][:5], 'triple': find_triple(r37['nums'], 1, 3),
                  'n51': r51['nums'][:7], 't51': find_triple(r51['nums'], 1, 6), 'bovedy': find_triple(r37b['nums'], 1, 3),
                  'repair': repair_triple([5195, 1802, 1073, 7291, 275], 1, 3),
                  'clean': clean_ocr_name('Lisnagarr 6,028 1,520 1 78'), 'refs': [r['ref'] for r in rows]}))`);
  if (!out) return;
  assert.equal(out.label, '24. Cargin');
  assert.deepEqual(out.nums, [5775, 940, 898, 471, 427]);
  assert.equal(out.triple, 2);
  assert.deepEqual(out.n51.slice(3, 7), [1490, 1649, 710, 939]);
  assert.equal(out.t51, 4);
  assert.equal(out.bovedy, 2);
  assert.deepEqual(out.repair, [1, 1802, 1073, 729, 'females']); // '7291': a column rule read as a 1
  assert.equal(out.clean, 'Lisnagarr');
  assert.deepEqual(out.refs, [62, 63, 64, 65, 66]);
});

test('religion rows reconcile sexes and categories, allowing one stray digit', (t) => {
  const out = py(t, `
from hist_census_religion import religion_record
row = [11090, 5067, 6023, 2547, 1183, 1364, 5384, 2430, 2954, 1589, 723, 866, 1570, 731, 839]
bad = list(row); bad[5] = 13641          # a column rule read as a digit
wrong = list(row); wrong[3] = 2647        # one misread: its group and its column cross at it
two = list(row); two[3] = 2647; two[10] = 724   # two misreads: not solvable
print(json.dumps([religion_record(row, 4)[1], religion_record(bad, 4)[1], religion_record(wrong, 4)[1],
                  religion_record(two, 4)]))`);
  if (!out) return;
  assert.deepEqual(out, [[2547, 1183, 1364], [2547, 1183, 1364], [2547, 1183, 1364], null]);
});

test('matching DEDs to map features: urban and rural kept apart, Belfast wards in any county', (t) => {
  const out = py(t, `
from hist_census_lib import match_units
census = [{'id': 'a', 'county': 'Antrim', 'name': 'BALLYCLARE URBAN', 'district': 'Ballyclare Urban District'},
          {'id': 'b', 'county': 'Antrim', 'name': 'BALLYCLARE RURAL', 'district': 'Antrim Rural District'},
          {'id': 'c', 'county': 'Belfast County Borough', 'name': 'Ormeau', 'district': 'Belfast County Borough'},
          {'id': 'd', 'county': 'Down', 'name': 'Gilmahirk', 'district': 'Castlereagh Rural District'},
          {'id': 'e', 'county': 'Antrim', 'name': 'BALLYMENA NO. 1 URBAN', 'district': 'Ballymena Urban District'}]
layer = [{'id': 'f1', 'county': 'ANTRIM', 'name': 'BALLYCLARE RURAL'}, {'id': 'f2', 'county': 'ANTRIM', 'name': 'BALLYCLARE URBAN'},
         {'id': 'f3', 'county': 'DOWN', 'name': 'ORMEAU'}, {'id': 'f4', 'county': 'DOWN', 'name': 'GILNAHIRK'},
         {'id': 'f5', 'county': 'ANTRIM', 'name': 'BALLYMENA No. 1 URBAN (MARKET)'}]
m, uc, ul = match_units(census, layer)
print(json.dumps({k: v[0] for k, v in m.items()}))`);
  if (!out) return;
  assert.deepEqual(out, { a: 'f2', b: 'f1', c: 'f3', d: 'f4', e: 'f5' });
});

test('apportioning gives each unit its count back; town-aware puts the town in its footprint', (t) => {
  const out = py(t, `
from hist_census_lib import apportion, dasymetric_weights
a, fb = apportion({'u': 1000, 'v': 10}, {'u': {'p': 3.0, 'q': 1.0}, 'v': {'p': 0.0}})
w = dasymetric_weights({'p': 90.0, 'q': 10.0}, {'q': 10.0}, 400, 1000)
print(json.dumps([a['u'], fb, round(sum(a['v'].values()), 6), {k: round(x, 6) for k, x in w.items()},
                  dasymetric_weights({'p': 1.0}, {}, 100, 500)]))`);
  if (!out) return;
  assert.deepEqual(out[0], { p: 750, q: 250 });
  assert.deepEqual(out[1], ['v']);
  assert.equal(out[2], 10);
  assert.deepEqual(out[3], { p: 600, q: 400 }); // the town's 400 in q; the other 600 spread by area outside it
  assert.equal(out[4], null);
});

test('stable areas: Data Zones sharing a historic unit in any year end up together', (t) => {
  const out = py(t, `
from hist_census_lib import stable_areas
dz = {1926: {'A': {'u1': 1.0}, 'B': {'u1': 0.97, 'u2': 0.03}, 'C': {'u2': 1.0}, 'D': {'u3': 1.0}},
      1937: {'A': {'x1': 1.0}, 'B': {'x1': 1.0}, 'C': {'x2': 0.6, 'x3': 0.4}, 'D': {'x3': 1.0}}}
print(json.dumps(stable_areas(dz)))`);
  if (!out) return;
  assert.deepEqual(out, { A: 'A', B: 'A', C: 'C', D: 'C' });
});
