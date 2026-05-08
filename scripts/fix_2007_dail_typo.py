"""Fix 'Cork North-Centrla' typo in 2007_Dail.fgb CON_NAME column.

Reads the gz, rewrites with corrected name, regenerates -lod0/-lod1 by
re-applying the same simplification tolerances used elsewhere
(0.005 / 0.0005). Output: ungzipped + gzipped FGBs alongside the original
locations, ready for R2 upload.
"""
from __future__ import annotations
import gzip, os, tempfile
from pathlib import Path
import geopandas as gpd

ROOT = Path('data/maps/parliamentary')
SRC_GZ = ROOT / '2007_Dail.fgb.gz'

def load_fgb_gz(p: Path) -> gpd.GeoDataFrame:
    fd, tmp = tempfile.mkstemp(suffix='.fgb'); os.close(fd)
    with gzip.open(p, 'rb') as fi, open(tmp, 'wb') as fo:
        fo.write(fi.read())
    g = gpd.read_file(tmp)
    os.unlink(tmp)
    return g

def write_fgb(g: gpd.GeoDataFrame, dst: Path):
    if dst.exists(): dst.unlink()
    g.to_file(dst, driver='FlatGeobuf')

def gz_file(src: Path, dst: Path):
    with open(src, 'rb') as fi, gzip.open(dst, 'wb', compresslevel=6) as fo:
        fo.write(fi.read())

def main():
    g = load_fgb_gz(SRC_GZ)
    bad = (g['CON_NAME'] == 'Cork North-Centrla').sum()
    print(f'fixing {bad} bad row(s)')
    g.loc[g['CON_NAME'] == 'Cork North-Centrla', 'CON_NAME'] = 'Cork North-Central'

    base = ROOT / '2007_Dail.fgb'
    write_fgb(g, base)
    gz_file(base, ROOT / '2007_Dail.fgb.gz')

    for suf, tol in [('-lod0', 0.005), ('-lod1', 0.0005)]:
        gs = g.copy()
        gs['geometry'] = gs.geometry.simplify(tolerance=tol, preserve_topology=True)
        sb = ROOT / f'2007_Dail{suf}.fgb'
        write_fgb(gs, sb)
        gz_file(sb, ROOT / f'2007_Dail{suf}.fgb.gz')
    print('done — 2007_Dail.fgb(.gz) + lod0/1 rewritten')

if __name__ == '__main__':
    main()
