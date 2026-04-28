"""Build spatial-chunked + LOD versions of NIEA Authorised Waste Sites Feb 2021.
Mirror of build_planning_chunks.py but for NI bbox + the waste sites source.
"""
import os, json, subprocess, math
from pathlib import Path

SRC = Path(r'C:\tmp\integrate-batch1\data\maps\environment\niea-waste-sites-2021.fgb')
STAGE = Path(r'C:\tmp\waste-chunks\data\maps\environment')
STAGE.mkdir(parents=True, exist_ok=True)
CHUNKS_DIR = STAGE / 'chunks'
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)

MAP_ID = 'niea-waste-sites-2021'
SOURCE_LAYER = 'waste-sites-feb21'
CELL_DEG = 0.25

# Northern Ireland bbox (matches the FGB extent with small padding)
LON_MIN, LON_MAX = -8.20, -5.40
LAT_MIN, LAT_MAX = 54.00, 55.30

n_cols = math.ceil((LON_MAX - LON_MIN) / CELL_DEG)
n_rows = math.ceil((LAT_MAX - LAT_MIN) / CELL_DEG)
print(f'Grid: {n_rows} rows × {n_cols} cols  ({n_rows * n_cols} potential cells, {CELL_DEG}° each)')

def feature_count(p):
    out = subprocess.check_output(['ogrinfo', '-al', '-so', str(p)],
                                   stderr=subprocess.DEVNULL).decode('utf-8', errors='replace')
    for ln in out.splitlines():
        if ln.startswith('Feature Count:'):
            return int(ln.split(':')[1].strip())
    return None

print('\n=== Building per-cell chunks ===')
chunks = []
total = 0
for r in range(n_rows):
    for c in range(n_cols):
        lon0 = LON_MIN + c * CELL_DEG
        lon1 = lon0 + CELL_DEG
        lat0 = LAT_MIN + r * CELL_DEG
        lat1 = lat0 + CELL_DEG
        chunk_file = CHUNKS_DIR / f'{MAP_ID}_{r}_{c}.fgb'
        cmd = ['ogr2ogr', '-f', 'FlatGeobuf', '-overwrite',
               '-spat', str(lon0), str(lat0), str(lon1), str(lat1),
               str(chunk_file), str(SRC)]
        try:
            subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            continue
        fc = feature_count(chunk_file)
        if not fc:
            chunk_file.unlink(missing_ok=True)
            continue
        chunks.append({
            'id': f'{r}_{c}',
            'bbox': [lon0, lat0, lon1, lat1],
            'file': f'data/maps/environment/chunks/{chunk_file.name}',
            'count': fc,
        })
        total += fc

print(f'Wrote {len(chunks)} non-empty chunks, {total:,} total pts')

INDEX_PATH = STAGE / f'{MAP_ID}-chunks.json'
with open(INDEX_PATH, 'w') as f:
    json.dump({
        'mapId': MAP_ID,
        'grid': [n_rows, n_cols],
        'cellSize': CELL_DEG,
        'totalFeatures': total,
        'chunks': chunks,
    }, f, indent=2)
print(f'Wrote {INDEX_PATH}')

# LOD overviews — every Nth feature
print('\n=== Building LOD overview FGBs ===')
for level, modulo in [('lod0', 8), ('lod1', 2)]:
    out = STAGE / f'{MAP_ID}-{level}.fgb'
    sql = f'SELECT * FROM "{SOURCE_LAYER}" WHERE FID % {modulo} = 0'
    cmd = ['ogr2ogr', '-f', 'FlatGeobuf', '-overwrite', '-sql', sql, '-dialect', 'OGRSQL',
           str(out), str(SRC)]
    subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
    fc = feature_count(out)
    print(f'  {level}: {fc:,} features  {out.stat().st_size/1e6:.1f} MB')

total_size = sum(p.stat().st_size for p in STAGE.rglob('*') if p.is_file())
print(f'\nTotal: {total_size/1e6:.1f} MB across {len(list(STAGE.rglob("*")))} files')
