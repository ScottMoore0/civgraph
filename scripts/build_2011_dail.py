"""Download CSO Constituencies_2007.zip (despite the file name, this is
the post-Electoral (Amendment) Act 2009 layout used in the 2011 general
election), reproject to EPSG:4326, write 2011_Dail.fgb + lod0/lod1 ladder.

Source CRS: EPSG:29902 (TM65 Irish Grid).
"""
from pathlib import Path
import shutil, subprocess, tempfile, zipfile, warnings
import geopandas as gpd
warnings.filterwarnings('ignore')

URL = 'https://www.cso.ie/en/media/csoie/census/census2011boundaryfiles/Constituencies_2007.zip'
OUT_DIR = Path('data/maps/parliamentary')
OUT_DIR.mkdir(parents=True, exist_ok=True)


def main():
    work = Path(tempfile.mkdtemp(prefix='_cso_2011_'))
    zp = work / 'src.zip'
    print(f'downloading {URL}')
    subprocess.check_call(['curl', '-sL', URL, '-o', str(zp)])
    with zipfile.ZipFile(zp) as zf:
        zf.extractall(work)
    shps = list(work.rglob('*.shp'))
    if not shps:
        raise SystemExit('no SHP in zip')
    src = shps[0]
    print(f'reading {src}')
    g = gpd.read_file(src)
    print(f'  {len(g)} features in {g.crs}')

    # Drop nameless rows (one offshore polygon in this dataset has CON_NAME=None)
    if 'CON_NAME' in g.columns:
        before = len(g)
        g = g[g['CON_NAME'].notna() & (g['CON_NAME'] != 'None')].copy()
        print(f'  dropped {before - len(g)} nameless rows')

    g = g.to_crs('EPSG:4326')
    print(f'  reprojected -> EPSG:4326, bounds={g.total_bounds}')

    # Dissolve by CON_NAME so each constituency is one MultiPolygon
    # (avoids per-island TD seat-circle duplication, same fix as 2023).
    if 'CON_NAME' in g.columns:
        before = len(g)
        g = g.dissolve(by='CON_NAME', as_index=False)
        print(f'  dissolved {before} -> {len(g)} rows by CON_NAME')

    base = OUT_DIR / '2011_Dail.fgb'
    if base.exists(): base.unlink()
    g.to_file(base, driver='FlatGeobuf')
    print(f'wrote {base}')

    for suf, tol in [('-lod0', 0.005), ('-lod1', 0.0005)]:
        out = OUT_DIR / f'2011_Dail{suf}.fgb'
        if out.exists(): out.unlink()
        gs = g.copy()
        gs['geometry'] = gs.geometry.simplify(tolerance=tol, preserve_topology=True)
        gs.to_file(out, driver='FlatGeobuf')
        print(f'wrote {out}')

    shutil.rmtree(work, ignore_errors=True)
    print('done')


if __name__ == '__main__':
    main()
