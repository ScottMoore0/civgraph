// The pure steps of the housing-weighted (valuation era band) census series for 1991, 2001 and
// 2011 (stream w23-census-1926-61, owner decision 12, 24 Nov 2026): era bands read in every
// spelling a list may use, pro-rated to the later census days, open-ended bands, properties with
// no band, the band table a run prints, and placing units with no town figures by stock with the
// survivor-bias guard, every unit keeping its count. Synthetic fixtures only (no valuation data).
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

test('era bands: kinds and spellings, closed and open', (t) => {
  const out = py(t, `
from hist_census_lib import era_band
bands = ['Pre 1919', 'Pre-1919', 'Inter-War', '1966-1990', '1991 - 2000', 'Post 2005', 'Post-2005', '2006 onwards', '2006+',
         '2006-', '2006-present', 'Apartment', '', None]
print(json.dumps([list(era_band(b, 2025.0)) for b in bands]))`);
  if (!out) return;
  assert.deepEqual(out, [
    ['pre', null, null], ['pre', null, null], ['inter-war', 1919, 27], ['range', 1966, 25], ['range', 1991, 10],
    ['open', 2006, 19], ['open', 2006, 19], ['open', 2006, 19], ['open', 2006, 19], ['open', 2006, 19], ['open', 2006, 19],
    [null, null, null], [null, null, null], [null, null, null],
  ]);
});

test('era bands pro-rated to the 1991, 2001 and 2011 census days', (t) => {
  const out = py(t, `
from hist_census_lib import era_weight, CENSUS_DAY as D
bands = ['Pre 1919', 'Inter-War', '1946-1965', '1966-1990', '1991-2000', '2001-2005', 'Post 2005', 'Apartment']
r = {y: [round(era_weight(b, D[y]), 4) for b in bands] for y in ('1991', '2001', '2011')}
r['2011 open to 2015'] = round(era_weight('Post 2005', D['2011'], 2015.0), 4)
print(json.dumps(r))`);
  if (!out) return;
  // 21 Apr 1991: 0.3 of 1991-2000's ten years; 29 Apr 2001: 0.33 of 2001-2005's five
  assert.deepEqual(out['1991'], [1, 1, 1, 1, 0.03, 0, 0, 0]);
  assert.deepEqual(out['2001'], [1, 1, 1, 1, 1, 0.066, 0, 0]);
  // 27 Mar 2011: 5.24 of the 19 years 2006-2025 of an open band (default end 2025)
  assert.deepEqual(out['2011'], [1, 1, 1, 1, 1, 1, 0.2758, 0]);
  assert.equal(out['2011 open to 2015'], 0.5822);
});

test('properties with no band: left out unless a weight is given; the band table flags them', (t) => {
  const out = py(t, `
from hist_census_lib import stock_weight, era_band_table
w = [stock_weight('Apartment', 2011.24), stock_weight('Apartment', 2011.24, bandless=1), stock_weight('1966-1990', 1971.31, bandless=1)]
tab = era_band_table({'Pre 1919': 5, 'Apartment': 9, '1991-2000': 2}, {'1991': 1991.3, '2011': 2011.24})
print(json.dumps([[round(x, 4) for x in w], tab]))`);
  if (!out) return;
  assert.deepEqual(out[0], [0, 1, 0.2124]);
  assert.deepEqual(out[1], [
    { band: 'Apartment', kind: 'none', properties: 9, weight_1991: 0, weight_2011: 0 },
    { band: 'Pre 1919', kind: 'pre', properties: 5, weight_1991: 1, weight_2011: 1 },
    { band: '1991-2000', kind: 'range', properties: 2, weight_1991: 0.03, weight_2011: 1 },
  ]);
});

test('units without towns placed by stock: totals kept, guard, units off the Data Zones', (t) => {
  const out = py(t, `
from hist_census_lib import stock_apportion
pieces = [('u1', 'U', 1.0, 90.0), ('u2', 'U', 9.0, 10.0),      # 400 people, 100 homes: by stock
          ('v1', 'V', 1.0, 10.0), ('v2', 'V', 3.0, 0.0),       # 150 people, 10 homes: blend
          ('w1', 'W', 1.0, 1.0), ('w2', 'W', 1.0, 0.0),        # 50 people, 1 home: area
          ('x1', 'X', 2.0, 0.0), ('x2', 'X', 6.0, 0.0),        # no stock: area
          ('z1', 'Z', 0.0, 0.0), ('z2', 'Z', 0.0, 0.0)]        # no area, no stock: equal shares
r = stock_apportion(pieces, {'U': 400, 'V': 150, 'W': 50, 'X': 80, 'Z': 10, 'Q': 7})
tot = {}
for m in ('stock', 'area'):
    for p, v in r[m].items():
        tot.setdefault(m, {}).setdefault(p[0].upper(), 0)
        tot[m][p[0].upper()] += v
print(json.dumps({'stock': {k: round(v, 3) for k, v in r['stock'].items()}, 'tot': {m: {k: round(v, 9) for k, v in d.items()} for m, d in tot.items()},
                  'flags': [[f['unit'], f['used'].split(' ')[0], f['persons_per_property']] for f in r['flags']], 'lost': r['lost']}))`);
  if (!out) return;
  for (const m of ['stock', 'area']) assert.deepEqual(out.tot[m], { U: 400, V: 150, W: 50, X: 80, Z: 10 });
  assert.equal(out.stock.u1, 360);
  assert.equal(out.stock.u2, 40);
  // V: half by stock (all in v1), half by area (1 of 4)
  assert.equal(out.stock.v1, 93.75);
  assert.equal(out.stock.w1, 25);
  assert.equal(out.stock.x2, 60);
  assert.equal(out.stock.z1, 5);
  assert.deepEqual(out.flags, [['V', 'blend', 15], ['W', 'area', 50], ['X', 'area', null], ['Z', 'area', null]]);
  assert.deepEqual(out.lost, ['Q']);
});

test('a worktree finds its main checkout from its .git file', (t) => {
  const out = py(t, `
import os, tempfile
from pathlib import Path
from hist_census_paths import main_checkout
with tempfile.TemporaryDirectory() as d:
    wt = Path(d) / 'wt'
    wt.mkdir()
    (wt / '.git').write_text('gitdir: ' + str(Path(d) / 'main' / '.git' / 'worktrees' / 'wt') + '\\n', encoding='utf-8')
    plain = Path(d) / 'plain'
    (plain / '.git').mkdir(parents=True)
    print(json.dumps([main_checkout(wt) == Path(d) / 'main', main_checkout(plain) == plain]))`);
  if (!out) return;
  assert.deepEqual(out, [true, true]);
});
