// The pure steps of the housing-weighted (valuation era band) census series, 1926-1981, and the
// 1981 towns table (stream w23-census-1971-81-stock): era pro-rating by census day, the
// survivor-bias guard, every unit keeping its count, sharing a town among wards, matching printed
// towns to the 2015 settlements, comparing two years' patterns, and reading Table 4A's lines.
// The properties here are a small synthetic fixture (no valuation data).
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

test('era bands pro-rated by census day', (t) => {
  const out = py(t, `
from hist_census_lib import era_weight, CENSUS_DAY as D
bands = ['Pre 1919', 'Pre-1919', 'Inter-War (1919-1945)', '1946-1965', '1966-1990', '1991-2000', 'Apartment', '']
print(json.dumps({y: [round(era_weight(b, D[y]), 4) for b in bands] for y in ('1937', '1961', '1971', '1981')}))`);
  if (!out) return;
  assert.deepEqual(out['1937'], [1, 1, 0.6726, 0, 0, 0, 0, 0]);
  assert.deepEqual(out['1961'], [1, 1, 1, 0.7655, 0, 0, 0, 0]);
  // 1971: 5.31 of the 25 years of 1966-1990 built by 25 April; 1981: 15.26 by 5 April
  assert.deepEqual(out['1971'], [1, 1, 1, 1, 0.2124, 0, 0, 0]);
  assert.deepEqual(out['1981'], [1, 1, 1, 1, 0.6104, 0, 0, 0]);
});

test('survivor-bias guard: area above 20 persons per property, blend 12-20', (t) => {
  const out = py(t, `
from hist_census_lib import stock_guard
print(json.dumps([stock_guard(250, 10)[0], stock_guard(200, 10)[0], stock_guard(150, 10)[0], stock_guard(120, 10)[0],
                  stock_guard(50, 10), stock_guard(50, 0)]))`);
  if (!out) return;
  assert.deepEqual(out, ['area (persons per surviving property > 20)', 'blend (persons per surviving property 12-20)',
    'blend (persons per surviving property 12-20)', 'stock', ['stock', 5], ['area (no qualifying stock)', null]]);
});

test('a synthetic ward: towns first, the rest by stock, totals kept in 1971 and 1981', (t) => {
  const out = py(t, `
from hist_census_lib import era_weight, stock_unit_weights, CENSUS_DAY
# fixture: three pieces of one ward; piece 'a' holds the town footprint (old housing), 'b' an
# estate of 1966-1990, 'c' farms; apartments carry no band and count for nothing
props = [('a', 'Pre 1919', True)] * 40 + [('a', 'Inter-War', True)] * 20 + [('a', 'Apartment', True)] * 30 + \\
        [('b', '1966-1990', False)] * 100 + [('c', 'Pre-1919', False)] * 10 + [('c', '1946-1965', False)] * 10
area = {'a': 1.0, 'b': 2.0, 'c': 7.0}
fp = {'a': 1.0}
res = {}
for y, persons, town in (('1971', 1000.0, 400.0), ('1981', 1400.0, 500.0)):
    s_all, s_in = {}, {}
    for p, band, inside in props:
        w = era_weight(band, CENSUS_DAY[y])
        s_all[p] = s_all.get(p, 0) + w
        if inside:
            s_in[p] = s_in.get(p, 0) + w
    w, mode, ratio, rem, so = stock_unit_weights(area, fp, s_all, s_in, town, persons)
    res[y] = {'total': round(sum(w.values()), 9), 'mode': mode, 'w': {k: round(v, 1) for k, v in w.items()}}
print(json.dumps(res))`);
  if (!out) return;
  assert.equal(out['1971'].total, 1000);
  assert.equal(out['1981'].total, 1400);
  // the town's 400 stay in its footprint; outside, 1971 counts 21.2 estate homes against 20 on the farms
  assert.equal(out['1971'].w.a, 400);
  assert.equal(out['1971'].mode, 'blend (persons per surviving property 12-20)');
  assert.equal(out['1981'].mode, 'stock');
  // by 1981 the estate (61 of its 100 homes counted) holds most of the people outside the town
  assert.ok(out['1981'].w.b > 2 * out['1981'].w.c);
  assert.ok(out['1981'].w.b / out['1981'].w.c > out['1971'].w.b / out['1971'].w.c);
});

test('every unit keeps its count, also with no land outside the town or no stock at all', (t) => {
  const out = py(t, `
from hist_census_lib import stock_unit_weights
cases = [
  ({'a': 1, 'b': 1}, {'a': 1, 'b': 1}, {}, {}, 300, 500),          # all footprint, no stock
  ({'a': 1, 'b': 3}, {}, {'a': 0, 'b': 0}, {}, 0, 800),             # no town, no stock: area
  ({'a': 1, 'b': 1}, {'a': 0.5}, {'a': 10, 'b': 2}, {'a': 4}, 900, 600),   # town over the ward: capped
  ({'a': 1, 'b': 1}, {'a': 1}, {'a': 5, 'b': 0}, {'a': 5}, 100, 400),     # stock only inside the town
]
print(json.dumps([[round(sum(stock_unit_weights(*c)[0].values()), 9), stock_unit_weights(*c)[1]] for c in cases]))`);
  if (!out) return;
  assert.deepEqual(out.map((r) => r[0]), [500, 800, 600, 400]);
  assert.equal(out[1][1], 'area (no qualifying stock)');
});

test('a town shared among its wards by stock, by footprint area where there is none', (t) => {
  const out = py(t, `
from hist_census_lib import share_town
print(json.dumps([share_town(1000, {'w1': 30, 'w2': 10}, {'w1': 1, 'w2': 9}), share_town(1000, {'w1': 0}, {'w1': 1, 'w2': 3}),
                  share_town(1000, {}, {})]))`);
  if (!out) return;
  assert.deepEqual(out, [{ w1: 750, w2: 250 }, { w1: 250, w2: 750 }, {}]);
});

test('printed towns to 2015 settlements: qualifiers, compound names, aliases', (t) => {
  const out = py(t, `
from hist_census_lib import settlement_index, match_settlement
ix = settlement_index(['DROMORE (BANBRIDGE LGD)', 'DROMORE (OMAGH LGD)', 'MILLTOWN', 'MILLTOWN (CO. ARMAGH)', 'OMAGH TOWN',
                       'DERRY CITY', 'HILLSBOROUGH AND CULCAVY', 'WARRENPOINT / BURREN', 'BALLYKINLER', 'RICHHILL'])
print(json.dumps([match_settlement(ix, 'Dromore', 'omagh'), match_settlement(ix, 'Dromore'), match_settlement(ix, 'Milltown', '', 'Armagh'),
                  match_settlement(ix, 'Milltown', '', 'Antrim'), match_settlement(ix, 'Omagh'), match_settlement(ix, 'Londonderry'),
                  match_settlement(ix, 'Hillsborough'), match_settlement(ix, 'Burren (part a)'), match_settlement(ix, 'Ballykinler Camp'),
                  match_settlement(ix, 'Rich Hill'), match_settlement(ix, 'Moygashel')]))`);
  if (!out) return;
  assert.deepEqual(out, [['DROMORE (OMAGH LGD)'], [], ['MILLTOWN (CO. ARMAGH)'], ['MILLTOWN'], ['OMAGH TOWN'], ['DERRY CITY'],
    ['HILLSBOROUGH AND CULCAVY'], ['WARRENPOINT / BURREN'], ['BALLYKINLER'], ['RICHHILL'], []]);
});

test('dissimilarity of two years and pairing misspelt wards', (t) => {
  const out = py(t, `
from hist_census_lib import dissimilarity, pair_leftovers
p = pair_leftovers([('CRAIGAVON', 'waringstown'), ('BANBRIDGE', 'rathfriland'), ('DOWN', 'x')],
                   [('CRAIGAVON', 'warringstown'), ('NEWRY AND MOURNE', 'rathfriland')])
print(json.dumps([dissimilarity({'a': 10, 'b': 30}, {'a': 20, 'b': 60}), dissimilarity({'a': 10, 'b': 0}, {'a': 0, 'b': 5}),
                  round(dissimilarity({'a': 50, 'b': 50}, {'a': 75, 'b': 25}), 3), sorted([list(k) + list(v) for k, v in p.items()])]))`);
  if (!out) return;
  assert.deepEqual(out.slice(0, 3), [0, 1, 0.25]);
  assert.deepEqual(out[3], [['BANBRIDGE', 'rathfriland', 'NEWRY AND MOURNE', 'rathfriland'],
    ['CRAIGAVON', 'waringstown', 'CRAIGAVON', 'warringstown']]);
});

test('1981 Table 4A: figures in pieces, a point for a comma, district headings, the sexes check', (t) => {
  const out = py(t, `
from hist_census_1981_towns import table_lines, town_rows, column_bounds
b = column_bounds([222, 264, 305])
W = [(64, 166, 79, 173, 'Antrim'),
     (71, 178, 86, 184, 'Antrim'), (219, 178, 222, 184, '2'), (223, 178, 228, 184, '2,'), (228, 178, 238, 184, '342'),
     (261, 177, 279, 184, '10,941'), (303, 177, 321, 184, '11,401'),
     (71, 183, 89, 190, 'Crumlin'), (224, 183, 226, 190, '1'), (229, 183, 241, 190, ',708'), (271, 183, 280, 190, '878'),
     (312, 183, 321, 190, '830'),
     (75, 189, 99, 196, 'Downpatrick'), (227, 189, 242, 196, '8.245'), (261, 189, 279, 196, '4,053'), (303, 189, 321, 196, '4,192'),
     (64, 206, 75, 213, 'Lame'), (71, 217, 96, 223, 'Carnlough'), (227, 217, 242, 223, '1,462'), (265, 217, 279, 223, '702'),
     (303, 217, 321, 223, '761')]
rows = town_rows(table_lines(W, 150, b), 61)
print(json.dumps([[r['district'], r['name'], r['persons'], r['males'], r['females'], r['status']] for r in rows]))`);
  if (!out) return;
  assert.deepEqual(out, [
    ['Antrim', 'Antrim', 22342, 10941, 11401, 'ok'],
    ['Antrim', 'Crumlin', 1708, 878, 830, 'ok'],
    ['Antrim', 'Downpatrick', 8245, 4053, 4192, 'ok'],
    ['Larne', 'Carnlough', 1462, 702, 761, 'fail: sexes +1'],
  ]);
});
