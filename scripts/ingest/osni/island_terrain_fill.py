"""The array steps of rebuild_island_terrain.py, apart so they can be tested without rasterio.

    fill_mask(h_old, glo)        which DEM pixels take GLO-30
    near(mask, steps)            a mask grown by whole pixels, without wrapping round the tile
    hillshade(h, res)            the shading the island tiles carry (GDAL multidirectional)

Found 19 Nov 2026 (w19-seam), in the October fill of ireland-terrain-3d:
  - the July pyramid was resampled bilinearly with its missing GLO-30 cells as 0 m, so the row or
    column of pixels along each such cell's border held a blend of the land and 0 m (half the
    height at Glendalough, 236 m below its neighbours). The fill kept every pixel above 0.5 m, so
    those blends stayed: a one-pixel trench along 53 N, 55 N, 9 W, 8 W and 7 W, drawn dark by the
    hillshade. A pixel within MARGIN px of an empty one now takes GLO-30 wherever it is lower;
  - the 'near' mask was grown with np.roll, which wraps: pixels filled along one tile edge also
    re-lit two rows along the opposite edge, light strips at tile edges;
  - the fill lit in Horn 315/45, z 1, but the July tiles are GDAL's -multidirectional
    (alt 45; z 1.2 fits them best, median error 1.2 grey levels against 3.4 for Horn).
"""
import math

import numpy as np

MARGIN = 2


def near(mask, steps):
    """`mask` grown by `steps` pixels (4-connected per step); the edges do not wrap."""
    out = mask.copy()
    for _ in range(steps):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def fill_mask(h_old, glo, margin=MARGIN):
    """Pixels to take from GLO-30: empty ones (<= 0.5 m) where GLO-30 has land (> 1 m), and, within
    `margin` px of an empty pixel, any that sit below GLO-30 (a blend of land and the hole)."""
    empty = h_old <= 0.5
    land = glo > 1.0
    return land & (empty | (near(empty, margin) & (h_old < glo)))


def hillshade(h, res, z=1.2, alt=45.0):
    """GDAL's -multidirectional hillshade (225/270/315/360 weighted by aspect, Horn gradient) of the
    interior of `h`, a (H+2, W+2) array with a one-pixel margin; `res` is the pixel size in metres.
    Returns 1..255 floats, H x W."""
    w = [h[:-2, :-2], h[:-2, 1:-1], h[:-2, 2:], h[1:-1, :-2], None, h[1:-1, 2:], h[2:, :-2], h[2:, 1:-1], h[2:, 2:]]
    x = ((w[0] + 2 * w[3] + w[6]) - (w[2] + 2 * w[5] + w[8])) / res
    y = ((w[0] + 2 * w[1] + w[2]) - (w[6] + 2 * w[7] + w[8])) / res
    zs = z / 8
    sin_alt = math.sin(math.radians(alt))
    cos_z = math.cos(math.radians(alt)) * zs
    c225 = 127 * math.cos(math.radians(225)) * cos_z
    xx = x * x + y * y
    v225 = 127 * sin_alt + (x - y) * c225
    v270 = 127 * sin_alt - x * 127 * cos_z
    v315 = 127 * sin_alt + (x + y) * c225
    v360 = 127 * sin_alt - y * 127 * cos_z
    w225 = 0.5 * xx - x * y
    w270 = x * x
    w315 = xx - w225
    w360 = xx - w270
    with np.errstate(invalid='ignore', divide='ignore'):
        cang = (w225 * np.maximum(0, v225) + w270 * np.maximum(0, v270) + w315 * np.maximum(0, v315)
                + w360 * np.maximum(0, v360)) / xx / np.sqrt(1 + zs * zs * xx)
    cang = np.where(xx == 0, 254 * sin_alt, cang)
    return np.clip(1 + cang, 1, 255)
