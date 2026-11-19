"""The array steps of rebuild_island_terrain.py, apart so they can be tested without rasterio.

    border_band(z, x, y)                which pixels of a tile lie along a filled GLO-30 cell's border
    fill_mask(h_old, glo, band=None)    which DEM pixels take GLO-30
    rewrite(filled, h_old, glo, band)   whether a tile is rewritten
    near(mask, steps)                   a mask grown by whole pixels, without wrapping round the tile
    hillshade(h, res)                   the shading the island tiles carry (GDAL multidirectional)

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

Found 19 Nov 2026 (w19-dem-trench, w19-terrain-leftovers): MARGIN alone does not reach the
whole trench. Above zoom 12 the July tiles are zoom 12 blown up, so the blend is 2-4 px wide at
z13, 4-8 at z14 and 8-17 at z15, mostly not next to an empty pixel; and in places the July
tiles kept a single 0 m row beside the blend, under FILL_MIN of the tile, so the tile was never
rewritten. Now every land pixel within BAND_PX z12 pixels of a filled cell's border takes
GLO-30 (border_band), and a tile is rewritten whenever that raises a pixel by TRENCH_MIN.
Outside NI the July pyramid is itself GLO-30, so the band only changes resampling there. Inside
the NI LiDAR rectangle (LIDAR_BOX) the July tiles hold LiDAR, with no blend: the band stops at
it, because a band there would overwrite LiDAR (a DTM, often below GLO-30's surface model) with
GLO-30, and natural features that happen to lie along 6 W are not a trench.
"""
import math

import numpy as np

MARGIN = 2
FILL_MIN = 0.005        # share of a tile's pixels that must be empty land for the tile to be rewritten
TRENCH_MIN = 1.0        # metres: a border-band pixel raised by more than this rewrites the tile anyway
BAND_PX = 3             # half-width of the border band, in zoom-12 pixels (the trench reaches 2.35)
SIZE = 256
# The seven GLO-30 cells the October fill filled, by (south latitude, west longitude).
FILLED_CELLS = frozenset({(52, -9), (53, -9), (52, -8), (53, -8), (54, -8), (53, -7), (54, -7)})
# The NI LiDAR rectangle (west, south, east, north): the layer's zoom-16 extent (54.085 N; the
# July blend at Carlingford reaches 54.0852 N, so the south edge is 54.086).
LIDAR_BOX = (-7.62, 54.086, -5.58, 55.23)


def border_segments(cells=FILLED_CELLS):
    """The whole-degree lines where a filled cell meets one that was not filled:
    [('h', lat, [(lon0, lon1), ...]), ('v', lon, [(lat0, lat1), ...]), ...]."""
    if not cells:
        return []
    lats = [c[0] for c in cells]
    lons = [c[1] for c in cells]
    segs = []
    for lat in range(min(lats), max(lats) + 2):
        iv = [(lon, lon + 1) for lon in range(min(lons), max(lons) + 1)
              if ((lat - 1, lon) in cells) != ((lat, lon) in cells)]
        if iv:
            segs.append(('h', lat, iv))
    for lon in range(min(lons), max(lons) + 2):
        iv = [(lat, lat + 1) for lat in range(min(lats), max(lats) + 1)
              if ((lat, lon - 1) in cells) != ((lat, lon) in cells)]
        if iv:
            segs.append(('v', lon, iv))
    return segs


def _gx(lon, z):
    return (lon + 180) / 360 * 2 ** z * SIZE


def _gy(lat, z):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z * SIZE


def band_px(z):
    """Half-width of the border band at zoom z, in that zoom's pixels."""
    return BAND_PX * 2 ** max(0, z - 12)


def border_band(z, x, y, cells=FILLED_CELLS, exclude=LIDAR_BOX, size=SIZE):
    """The pixels of tile z/x/y whose centres lie within band_px(z) of the border between a filled
    GLO-30 cell and an original one, outside `exclude` (west, south, east, north)."""
    gx = x * size + np.arange(size) + 0.5            # global pixel coordinates of the centres
    gy = y * size + np.arange(size) + 0.5
    w = band_px(z)
    out = np.zeros((size, size), bool)
    for axis, deg, iv in border_segments(cells):
        if axis == 'h':
            rows = np.abs(gy - _gy(deg, z)) <= w
            if not rows.any():
                continue
            cols = np.zeros(size, bool)
            for a, b in iv:
                cols |= (gx >= _gx(a, z)) & (gx <= _gx(b, z))
        else:
            cols = np.abs(gx - _gx(deg, z)) <= w
            if not cols.any():
                continue
            rows = np.zeros(size, bool)
            for a, b in iv:
                rows |= (gy >= _gy(b, z)) & (gy <= _gy(a, z))
        out |= rows[:, None] & cols[None, :]
    if exclude is not None and out.any():
        west, south, east, north = exclude
        rows = (gy >= _gy(north, z)) & (gy <= _gy(south, z))
        cols = (gx >= _gx(west, z)) & (gx <= _gx(east, z))
        out &= ~(rows[:, None] & cols[None, :])
    return out


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


def fill_mask(h_old, glo, margin=MARGIN, band=None):
    """Pixels to take from GLO-30, all where GLO-30 has land (> 1 m): empty ones (<= 0.5 m); within
    `margin` px of an empty pixel, any that sit below GLO-30 (a blend of land and the hole); and
    every pixel of `band` (border_band: the blend along a filled cell's border, however wide)."""
    empty = h_old <= 0.5
    land = glo > 1.0
    take = empty | (near(empty, margin) & (h_old < glo))
    if band is not None:
        take = take | band
    return land & take


def rewrite(filled, h_old, glo, band=None):
    """Whether a tile is rewritten: FILL_MIN of it is filled outside the border band, or a band pixel
    it fills rises by more than TRENCH_MIN (a trench row, or a lone 0 m row, is under FILL_MIN of a
    tile; and a band where July and GLO-30 agree is no reason to rewrite one)."""
    if band is None:
        return float(filled.mean()) >= FILL_MIN
    if float((filled & ~band).mean()) >= FILL_MIN:
        return True
    return bool((filled & band & (glo - h_old > TRENCH_MIN)).any())


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
