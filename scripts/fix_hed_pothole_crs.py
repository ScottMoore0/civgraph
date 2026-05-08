"""Reproject FGBs that were ingested from Irish Grid (TM65/EPSG:29902) but
mis-labelled as EPSG:4326 (or that have a 4326 label but Irish-Grid
coordinate values). Affects:

- HED heritage layers (hed-listed-buildings, hed-sites-and-monuments,
  hed-scheduled-monument-areas, hed-defence-heritage,
  hed-industrial-heritage)
- DfI Pothole Enquiries 2020 + 2021

Strategy:
  1. Read each FGB
  2. Detect Irish-Grid-shaped coordinates (e.g. x ~ 100000–400000)
  3. Force EPSG:29902 source and reproject to EPSG:4326
  4. Drop features whose coords are FLT_MIN sentinels (-1.79e+308) so
     the bounds aren't poisoned

Outputs go to the same paths so upload script can ship them.
"""
from pathlib import Path
import warnings
import geopandas as gpd
import shapely
warnings.filterwarnings('ignore')

JOBS = [
    # (id, source_url, dest_path)
    ('hed-listed-buildings',         'https://data.civgraph.net/data/maps/heritage/hed-listed-buildings.fgb',
        'data/maps/heritage/hed-listed-buildings.fgb'),
    ('hed-sites-and-monuments',      'https://data.civgraph.net/data/maps/heritage/hed-sites-and-monuments.fgb',
        'data/maps/heritage/hed-sites-and-monuments.fgb'),
    ('hed-scheduled-monument-areas', 'https://data.civgraph.net/data/maps/heritage/hed-scheduled-monument-areas.fgb',
        'data/maps/heritage/hed-scheduled-monument-areas.fgb'),
    ('hed-defence-heritage',         'https://data.civgraph.net/data/maps/heritage/hed-defence-heritage.fgb',
        'data/maps/heritage/hed-defence-heritage.fgb'),
    ('hed-industrial-heritage',      'https://data.civgraph.net/data/maps/heritage/hed-industrial-heritage.fgb',
        'data/maps/heritage/hed-industrial-heritage.fgb'),
    ('dfi-pothole-enquiries-2020',   'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2020.fgb',
        'data/maps/transport-infra/dfi-pothole-enquiries-2020.fgb'),
    ('dfi-pothole-enquiries-2021',   'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2021.fgb',
        'data/maps/transport-infra/dfi-pothole-enquiries-2021.fgb'),
]


def looks_like_irish_grid(bounds):
    """Heuristic: bounds in 100000–500000 range = Irish Grid (TM65)."""
    if any(b == -1.7976931348623157e+308 for b in bounds):
        # FLT_MIN sentinel; check the non-sentinel halves
        xmax, ymax = bounds[2], bounds[3]
        return 50000 < xmax < 600000 and 50000 < ymax < 600000
    xmin, ymin, xmax, ymax = bounds
    return 50000 < xmin < 600000 and 50000 < ymin < 600000


def drop_sentinel(g):
    """Drop features whose coordinates are FLT_MIN — they pollute bounds
    and reproject to nonsense locations."""
    SENTINEL = -1.7976931348623157e+308

    def has_sentinel(geom):
        if geom is None or geom.is_empty: return True
        for x, y in shapely.get_coordinates(geom):
            if x == SENTINEL or y == SENTINEL or x < -180 or x > 600000:
                return True
        return False

    mask = ~g.geometry.apply(has_sentinel)
    dropped = (~mask).sum()
    if dropped:
        print(f'  dropping {dropped} sentinel-coord features')
    return g[mask].copy()


def main():
    import subprocess
    for fid, url, dest in JOBS:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        # Download
        subprocess.check_call(['curl', '-s', url, '-o', dest])
        g = gpd.read_file(dest)
        print(f'{fid}: rows={len(g)} crs={g.crs} bounds={g.total_bounds}')
        # Drop sentinel-coord features first
        g = drop_sentinel(g)
        # If bounds look like Irish Grid metres, force 29902 then reproject
        if looks_like_irish_grid(g.total_bounds):
            print(f'  detected Irish Grid coords — setting CRS to EPSG:29902')
            g = g.set_crs('EPSG:29902', allow_override=True)
            g = g.to_crs('EPSG:4326')
            print(f'  reprojected -> EPSG:4326, bounds={g.total_bounds}')
        else:
            print(f'  bounds already in degrees, skipping reprojection')
        # Write back
        if Path(dest).exists():
            Path(dest).unlink()
        g.to_file(dest, driver='FlatGeobuf')
        print(f'  wrote {dest}')
        print()


if __name__ == '__main__':
    main()
