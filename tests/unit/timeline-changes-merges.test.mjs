// Mergers, divisions and city/county names in the timeline changes (scripts/build/timeline-changes.py).
// Phelim Birch (26 Nov 2026): the 2014 step listed North Tipperary as "abolished, joined to
// Tipperary" and passed over South Tipperary, and Limerick as a city abolished plus a county
// renamed; and the 2019 Cork City extension went unreported, the builder taking "Cork County
// Council" and "Cork City Council" for two spellings of one name.
//
//   Run with node --test on this file. Needs python with shapely (skipped without python).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);

/** @param {import('node:test').TestContext} t @param {string} body */
function py(t, body) {
  const code = ['import json, runpy, warnings', "warnings.filterwarnings('ignore')",
    "m = runpy.run_path('scripts/build/timeline-changes.py')", body].join('\n');
  const res = spawnSync(process.env.CIVGRAPH_PYTHON || 'python', ['-c', code], { encoding: 'utf8', cwd: REPO });
  if (res.error) { t.skip(`no python (${res.error.message})`); return null; }
  if (res.status !== 0 && /No module named '(geopandas|shapely|pyogrio)'/.test(res.stderr)) { t.skip('no shapely'); return null; }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop() || 'null');
}

test('timeline changes: a city and its county are different units, however alike the names', (t) => {
  const out = py(t, `print(json.dumps([m['same_name'](a, b) for a, b in [
    ('CORK COUNTY COUNCIL', 'CORK CITY COUNCIL'), ('GALWAY CITY COUNCIL', 'GALWAY COUNTY COUNCIL'),
    ('Cork County Council', 'CORK COUNTY COUNCIL'), ('Laoighis', 'LAOIGHIS')]]))`);
  if (out) assert.deepEqual(out, [false, false, true, true]);
});

test('timeline changes: two councils into one with a new name is one merger; one into three is a division', (t) => {
  const out = py(t, `
import shapely
sq = lambda x: shapely.box(x, 0, x + 1, 1)
names_a = ['NORTH TIPPERARY', 'SOUTH TIPPERARY', 'KILKENNY']
names_b = ['TIPPERARY', 'KILKENNY']
area_a, area_b = [1.0, 1.0, 1.0], [2.0, 1.0]
pair_area = {(0, 0): 1.0, (1, 0): 1.0, (2, 1): 1.0}
changes = [{'type': 'abolished', 'from': 'NORTH TIPPERARY', 'to': 'TIPPERARY', 'ia': 0, 'ib': 0, 'geom': sq(0)}]
merged, renames = m['merge_and_divide'](changes, [], pair_area, area_a, area_b, names_a, names_b)
c = merged[0]
# One into three: Dublin County Council divided into Fingal, South Dublin, Dun Laoghaire-Rathdown.
names_a2, names_b2 = ['DUBLIN'], ['FINGAL', 'SOUTH DUBLIN', 'DLR']
pa2 = {(0, 0): 1.0, (0, 1): 1.0, (0, 2): 1.0}
ch2 = [{'type': 'created', 'from': 'DUBLIN', 'to': n, 'ia': 0, 'ib': i, 'geom': sq(i)} for i, n in enumerate(names_b2[1:], 1)]
ren2 = [{'type': 'renamed', 'from': 'DUBLIN', 'to': 'FINGAL', 'ia': 0, 'ib': 0, 'geom': sq(0)}]
div, ren_left = m['merge_and_divide'](ch2, ren2, pa2, [3.0], [1.0, 1.0, 1.0], names_a2, names_b2)
# Absorbed by a unit keeping its own name: still 'abolished, joined to'.
ab = [{'type': 'abolished', 'from': 'CLONMEL', 'to': 'TIPPERARY', 'ia': 0, 'ib': 0, 'geom': sq(0)}]
kept, _ = m['merge_and_divide'](ab, [], {(0, 0): 1.0, (1, 0): 5.0}, [1.0, 5.0], [6.0], ['CLONMEL', 'TIPPERARY'], ['TIPPERARY'])
print(json.dumps({'n': len(merged), 'type': c['type'], 'from': c['fromNames'], 'to': c['to'],
  'text': m['describe'](c, 1), 'div': [d['type'] for d in div], 'divText': m['describe'](div[0], 1),
  'renLeft': len(ren_left), 'kept': [k['type'] for k in kept]}))`);
  if (!out) return;
  assert.equal(out.n, 1);
  assert.equal(out.type, 'merged');
  assert.deepEqual(out.from.sort(), ['NORTH TIPPERARY', 'SOUTH TIPPERARY']);
  assert.match(out.text, /^(NORTH|SOUTH) TIPPERARY and (NORTH|SOUTH) TIPPERARY merged to form TIPPERARY$/);
  assert.deepEqual(out.div, ['divided']);
  assert.equal(out.divText, 'DUBLIN divided into FINGAL, SOUTH DUBLIN and DLR');
  assert.equal(out.renLeft, 0);
  assert.deepEqual(out.kept, ['abolished']);
});
