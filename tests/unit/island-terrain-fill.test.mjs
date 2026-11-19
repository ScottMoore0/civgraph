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
