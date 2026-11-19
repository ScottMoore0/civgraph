// The array steps of the island-terrain fill (scripts/ingest/osni/island_terrain_fill.py, used by
// rebuild_island_terrain.py). Found 19 Nov 2026 (w19-seam): the October fill kept the half-height
// pixels along the borders of the GLO-30 cells it filled (a trench drawn as a dark seam at
// Glendalough), grew its re-light mask with a wrapping np.roll (light strips along the opposite tile
// edge) and lit in Horn 315/45 where the July tiles are GDAL multidirectional.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const DIR = fileURLToPath(new URL('../../scripts/ingest/osni/', import.meta.url));

/**
 * Runs Python with the fill module importable; skips the test when Python or numpy is missing.
 * @param {import('node:test').TestContext} t
 * @param {string} code
 * @returns {any}
 */
function py(t, code) {
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const res = spawnSync(python, ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(DIR)})\n${code}`], { encoding: 'utf8' });
  if (res.error) return t.skip(`no python (${res.error.message})`);
  if (/No module named 'numpy'/.test(res.stderr)) return t.skip('no numpy');
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test('fill_mask takes the blend beside a hole, and leaves good pixels alone', (t) => {
  const out = py(t, `
import numpy as np
from island_terrain_fill import fill_mask
h = np.full((8, 8), 400.0)
h[:, :3] = 0          # the hole (a missing cell)
h[:, 3] = 200         # the July blend of land and 0 m along its border
h[2, 4] = 450         # a LiDAR pixel above GLO-30, one from the blend
glo = np.full((8, 8), 400.0)
glo[0, 0] = 0.5       # sea in GLO-30 too
m = fill_mask(h, glo)
print(json.dumps({'hole': bool(m[1:, :3].all()), 'sea': bool(m[0, 0]), 'blend': bool(m[:, 3].all()),
                  'lidar': bool(m[2, 4]), 'far': bool(m[:, 5:].any())}))
`);
  if (!out) return;
  assert.deepEqual(out, { hole: true, sea: false, blend: true, lidar: false, far: false });
});

test('near grows a mask without wrapping round the tile', (t) => {
  const out = py(t, `
import numpy as np
from island_terrain_fill import near
m = np.zeros((256, 256), bool)
m[0, 10] = True
g = near(m, 2)
print(json.dumps({'rows': [int(r) for r in np.nonzero(g.any(1))[0]], 'count': int(g.sum()), 'bottom': bool(g[-2:].any())}))
`);
  if (!out) return;
  assert.deepEqual(out.rows, [0, 1, 2]);
  assert.equal(out.count, 9); // a diamond of radius 2, cut by the tile edge
  assert.equal(out.bottom, false);
});

test('hillshade is gdaldem -multidirectional -z 1.2 (alt 45)', (t) => {
  // gdaldem hillshade -multidirectional -z 1.2 of this 6x6 surface, 30 m pixels (GDAL 3.x, 19 Nov 2026)
  const expected = [[201, 208, 213, 218], [203, 210, 215, 219], [205, 212, 217, 221], [207, 215, 220, 223]];
  const out = py(t, `
import numpy as np
from island_terrain_fill import hillshade
h = np.array([[10,12,15,19,24,30],[11,14,18,23,29,36],[12,15,20,26,33,41],[12,16,21,28,36,45],[11,15,21,29,38,48],[10,14,20,29,39,50]], float)
flat = hillshade(np.full((3, 3), 7.0), 30.0)
print(json.dumps({'shade': np.rint(hillshade(h, 30.0)).astype(int).tolist(), 'flat': float(flat[0, 0])}))
`);
  if (!out) return;
  assert.deepEqual(out.shade, expected);
  assert.ok(Math.abs(out.flat - (1 + 254 * Math.SQRT1_2)) < 1e-9);
});

// Found 19 Nov 2026 (w19-dem-trench, w19-terrain-leftovers): above zoom 12 the July tiles are zoom 12
// blown up, so the blend along a filled cell's border is 2-4 px wide at z13, 4-8 at z14 and 8-17 at z15,
// mostly not next to an empty pixel; and a lone 0 m row beside it is under FILL_MIN of a tile. The
// offsets below are the trench rows the w19-dem-trench repair found on R2 (rows from the line, in the
// zoom's own pixels; negative is north or west).
test('border_band covers the trench rows at zooms 12-15, and only near the line', (t) => {
  const out = py(t, `
import math, numpy as np
from island_terrain_fill import border_band, band_px, _gx, _gy
trench = {12: [-2.35, -1.56], 13: [-3.7, -3.12, -0.96], 14: [-7.09, -6.4, 0.6], 15: [-14.18, -11.8, 2.13, 2.2]}
res = {}
for z, offs in trench.items():
    L = _gy(53, z)                      # 53 N at Glendalough (6.35 W): a filled cell to the north
    x = int(_gx(-6.35, z) // 256)
    y0 = int(L // 256) - 1              # two tiles, so the band never falls off a tile edge
    band = np.vstack([border_band(z, x, y0), border_band(z, x, y0 + 1)])
    rows = np.nonzero(band.all(1))[0] + y0 * 256 + 0.5 - L      # row centres, from the line
    res[z] = {'covered': all(any(abs(r - o) <= 0.5 for r in rows) for o in offs),
              'partial_rows': int((band.any(1) & ~band.all(1)).sum()),
              'reach': float(np.abs(rows).max()), 'width': band_px(z)}
print(json.dumps(res))
`);
  if (!out) return;
  for (const [z, r] of Object.entries(out)) {
    assert.equal(r.covered, true, `z${z}: a trench row lies outside the band`);
    assert.equal(r.partial_rows, 0, `z${z}: the band covers whole rows along the segment`);
    assert.ok(r.reach <= r.width, `z${z}: the band reaches ${r.reach} px from the line`);
  }
  assert.deepEqual(Object.values(out).map((r) => r.width), [3, 6, 12, 24]);
});

test('border_band follows the filled cells and stops at the NI LiDAR', (t) => {
  const out = py(t, `
from island_terrain_fill import border_band, border_segments
segs = {f"{a}{d}": iv for a, d, iv in border_segments()}
print(json.dumps({
    'segments': segs,
    # 6 W at 54.55 N (Lisburn): a filled cell's border, but inside the LiDAR; a natural channel crosses it
    'lidar': int(border_band(15, 15837, 10435).sum()),
    # 6 W at 54.07 N (Carlingford): the blend beside a 0 m row, just south of the LiDAR
    'carlingford_cols': sorted({int(c) for c in border_band(15, 15837, 10510).nonzero()[1]}),
    # inside N53W008, far from any border
    'inside': int(border_band(12, 1959, 1340).sum()),
}))
`);
  if (!out) return;
  assert.deepEqual(out.segments, {
    h52: [[-9, -8], [-8, -7]], h53: [[-7, -6]], h54: [[-9, -8]], h55: [[-8, -7], [-7, -6]],
    'v-9': [[52, 53], [53, 54]], 'v-8': [[54, 55]], 'v-7': [[52, 53]], 'v-6': [[53, 54], [54, 55]],
  });
  assert.equal(out.lidar, 0);
  assert.equal(out.carlingford_cols.length, 48); // 24 px either side of 6 W
  assert.ok(out.carlingford_cols.includes(209)); // 6 W itself
  assert.equal(out.inside, 0);
});

test('fill_mask takes the whole wide blend at zoom 15, and rewrite keeps a lone 0 m row at zoom 12', (t) => {
  const out = py(t, `
import numpy as np
from island_terrain_fill import border_band, fill_mask, rewrite, _gx, _gy
def setup(z, offs, value):
    L = _gy(53, z); y = int((L + min(offs)) // 256); x = int(_gx(-6.35, z) // 256)
    h = np.full((256, 256), 400.0); glo = np.full((256, 256), 400.0)
    for o, v in zip(offs, value):
        h[int(L + o - y * 256)] = v
    return h, glo, border_band(z, x, y)
# z15: a 17-row blend at 0.42 of the land, rows -14..+2 from 53 N; no empty pixel anywhere
h, glo, band = setup(15, list(range(-14, 3)), [168.0] * 17)
trench = h < 400
wide = {'all': bool(fill_mask(h, glo, band=band)[trench].all()), 'margin_only': int(fill_mask(h, glo)[trench].sum()),
        'outside': int((fill_mask(h, glo, band=band) & ~band).sum()), 'rewrite': rewrite(fill_mask(h, glo, band=band), h, glo, band)}
# z12: a 0 m row beside a row at 0.87 of the land (as along 7 W), 120 px long: under FILL_MIN of the tile
h, glo, band = setup(12, [-2, -1], [0.0, 348.0])
h[:, 120:] = 400.0      # the stretch of border in this tile is 120 px long
agree = rewrite(fill_mask(np.full((256, 256), 400.0), glo, band=band), np.full((256, 256), 400.0), glo, band)
m0, m1 = fill_mask(h, glo), fill_mask(h, glo, band=band)
zero = {'share': float(m0.mean()), 'old_rewrite': rewrite(m0, h, glo), 'rewrite': rewrite(m1, h, glo, band),
        'rows_taken': int(m1[(h < 400)].sum()), 'trench_px': int((h < 400).sum())}
print(json.dumps({'wide': wide, 'zero': zero, 'agree': agree}))
`);
  if (!out) return;
  assert.equal(out.wide.all, true);
  assert.equal(out.wide.margin_only, 0); // MARGIN alone reaches none of it: no empty pixel is near
  assert.equal(out.wide.outside, 0);
  assert.equal(out.wide.rewrite, true);
  assert.ok(out.zero.share < 0.005);
  assert.equal(out.zero.old_rewrite, false); // the old rule never rewrote this tile
  assert.equal(out.zero.rewrite, true);
  assert.equal(out.zero.rows_taken, out.zero.trench_px);
  assert.equal(out.agree, false); // where July and GLO-30 agree, the band alone rewrites nothing
});
