"""Fix two DCC datasets that were ingested with the wrong source CRS:

  - dcc-parking-meters-...: claimed EPSG:4326 but coordinates are raw
    TM65 Irish Grid metres (e.g. (316197, 230375)). Force CRS to 29902
    and reproject to 4326. Same pattern as the HED + Pothole 2020/2021
    fix.

  - dcc-record-protected-structures: claimed EPSG:4326 with degree-shaped
    coordinates but located in the Atlantic at (~-11.87, ~48.80). Source
    was TM65 Irish Grid; upstream applied an EPSG:2157 (ITM) reprojection
    by mistake, producing the Atlantic offset. Reverse the bad ITM→4326,
    then apply the correct TM65→4326 transform.

Output overwrites the local fgb files; upload to R2 separately.
"""
from __future__ import annotations
import warnings
import geopandas as gpd
import pyproj
import shapely
from shapely.ops import transform as shapely_transform
warnings.filterwarnings('ignore')

# ── Parking Meters: raw TM65 coords mis-labelled as 4326 ──────────────
def fix_parking_meters():
    src_url = 'https://data.civgraph.net/data/maps/roi-dcc/dcc-parking-meters-location-tariffs-and-zones-in-dublin-city.fgb'
    dst = 'data/maps/roi-dcc/dcc-parking-meters-location-tariffs-and-zones-in-dublin-city.fgb'
    import subprocess, os
    os.makedirs('data/maps/roi-dcc', exist_ok=True)
    subprocess.check_call(['curl', '-sL', src_url, '-o', dst])
    g = gpd.read_file(dst)
    print(f'parking meters: {len(g)} rows; raw bounds: {g.total_bounds}')

    # Drop any features with sentinel (0, 0) coordinates that pollute bounds.
    SENTINEL_X = 0.0
    SENTINEL_Y = 0.0

    def has_sentinel(geom):
        if geom is None or geom.is_empty: return True
        for x, y in shapely.get_coordinates(geom):
            if x == SENTINEL_X and y == SENTINEL_Y: return True
        return False

    mask = ~g.geometry.apply(has_sentinel)
    dropped = (~mask).sum()
    if dropped: print(f'  dropping {dropped} (0,0)-sentinel features')
    g = g[mask].copy()

    g = g.set_crs('EPSG:29902', allow_override=True)
    g = g.to_crs('EPSG:4326')
    xmin, ymin, xmax, ymax = g.total_bounds
    print(f'  reprojected -> 4326, bounds: {g.total_bounds}')
    if xmin < -11 or xmax > -5 or ymin < 51 or ymax > 56:
        raise SystemExit('parking meters bounds still off — abort')

    g.to_file(dst, driver='FlatGeobuf')
    print(f'  wrote {dst}')


# ── Record of Protected Structures: WGS84 location wrong ──────────────
def fix_rps():
    src_url = 'https://data.civgraph.net/data/maps/roi-dcc/dcc-record-protected-structures.fgb'
    dst = 'data/maps/roi-dcc/dcc-record-protected-structures.fgb'
    import subprocess
    subprocess.check_call(['curl', '-sL', src_url, '-o', dst])
    g = gpd.read_file(dst)
    print(f'RPS: {len(g)} rows; raw bounds: {g.total_bounds}')

    # Reverse the upstream's bad ITM→4326, then apply the correct TM65→4326.
    # equivalent: f(x, y) = TM65→4326( 4326→ITM(x, y) )
    to_itm = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:2157', always_xy=True)
    tm65_to_wgs = pyproj.Transformer.from_crs('EPSG:29902', 'EPSG:4326', always_xy=True)

    def fix(x, y, z=None):
        e, n = to_itm.transform(x, y)   # back-out the broken ITM→WGS84
        lon, lat = tm65_to_wgs.transform(e, n)  # apply the correct TM65→WGS84
        return (lon, lat) if z is None else (lon, lat, z)

    g['geometry'] = g.geometry.apply(lambda geom: shapely_transform(fix, geom))
    g = g.set_crs('EPSG:4326', allow_override=True)
    xmin, ymin, xmax, ymax = g.total_bounds
    print(f'  fixed -> 4326, bounds: {g.total_bounds}')
    if xmin < -7 or xmax > -6 or ymin < 53 or ymax > 54:
        raise SystemExit('RPS bounds still off — abort')

    g.to_file(dst, driver='FlatGeobuf')
    print(f'  wrote {dst}')


if __name__ == '__main__':
    fix_parking_meters()
    fix_rps()
