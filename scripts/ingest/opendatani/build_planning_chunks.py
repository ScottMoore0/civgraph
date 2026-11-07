"""Build spatial-chunked + LOD versions of the ROI national planning applications.

Source: C:\\tmp\\integrate-batch2a\\data\\maps\\roi-planning\\roi-national-planning-applications.fgb
        (493,439 point features, all-Ireland)

Output:
  C:\\tmp\\planning-chunks\\data\\maps\\roi-planning\\
    roi-national-planning-applications-lod0.fgb       (~5k random sample for low zoom)
    roi-national-planning-applications-lod1.fgb       (~20k random sample for mid zoom)
    roi-national-planning-applications-chunks.json    (chunks index)
    chunks/
      roi-national-planning-applications_<row>_<col>.fgb  (one per non-empty 0.25° cell)
"""
import os, json, subprocess, math
from pathlib import Path

SRC = Path(r'C:\tmp\integrate-batch2a\data\maps\roi-planning\roi-national-planning-applications.fgb')
STAGE = Path(r'C:\tmp\planning-chunks\data\maps\roi-planning')
STAGE.mkdir(parents=True, exist_ok=True)
CHUNKS_DIR = STAGE / 'chunks'
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)

MAP_ID = 'roi-national-planning-applications'
SOURCE_LAYER = '8f69dffe26324ba3acc653cf6cb5cf8b_1'
CELL_DEG = 0.25  # 0.25° cells, ~28 km × 28 km at NI latitude

# Bounding box (all-Ireland — slightly padded)
LON_MIN, LON_MAX = -10.75, -5.40
LAT_MIN, LAT_MAX = 51.40, 55.50

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

# === Step 1: Build per-cell chunks via -spat ===
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
        if not fc or fc == 0:
            chunk_file.unlink(missing_ok=True)
            continue
        chunks.append({
            'id': f'{r}_{c}',
            'bbox': [lon0, lat0, lon1, lat1],
            'file': f'data/maps/roi-planning/chunks/{chunk_file.name}',
            'count': fc,
        })
        total += fc
        if len(chunks) % 20 == 0:
            print(f'  {len(chunks)} non-empty chunks so far, {total:,} pts')

print(f'\nWrote {len(chunks)} non-empty chunks, {total:,} total pts')

# === Step 2: Write chunks-index.json ===
INDEX_PATH = STAGE / f'{MAP_ID}-chunks.json'
index = {
    'mapId': MAP_ID,
    'grid': [n_rows, n_cols],
    'cellSize': CELL_DEG,
    'totalFeatures': total,
    'chunks': chunks,
}
with open(INDEX_PATH, 'w') as f:
    json.dump(index, f, indent=2)
print(f'Wrote {INDEX_PATH}')

# === Step 3: Build LOD0 (~5k random sample, every 100th feature) and LOD1 (~20k, every 25th) ===
print('\n=== Building LOD overview FGBs ===')
for level, modulo in [('lod0', 100), ('lod1', 25)]:
    out = STAGE / f'{MAP_ID}-{level}.fgb'
    sql = f'SELECT * FROM "{SOURCE_LAYER}" WHERE FID % {modulo} = 0'
    cmd = ['ogr2ogr', '-f', 'FlatGeobuf', '-overwrite', '-sql', sql, '-dialect', 'OGRSQL',
           str(out), str(SRC)]
    subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
    fc = feature_count(out)
    print(f'  {level}: {fc:,} features  {out.stat().st_size/1e6:.1f} MB')

print(f'\n=== Output ===')
total_size = sum(p.stat().st_size for p in STAGE.rglob('*') if p.is_file())
print(f'  total: {total_size/1e6:.1f} MB across {len(list(STAGE.rglob("*")))} files')
