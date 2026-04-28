"""Batch 2a — ROI Planning Apps (item 2) + TII (item 8)."""
import os, shutil, subprocess, zipfile, json, tempfile
from pathlib import Path

DGI = Path(r'D:\datagovie')
STAGE = Path(r'C:\tmp\integrate-batch2a\data\maps')
STAGE.mkdir(parents=True, exist_ok=True)

DATASETS = []

# === Item 2: ROI Planning Applications ===
plan_root = DGI / 'Department of Housing, Local Government and Heritage' / 'national-planning-applications'
# pick the largest geojson
gjs = sorted(plan_root.glob('*.geojson'), key=lambda p: p.stat().st_size, reverse=True)
if gjs:
    DATASETS.append({
        'subdir': 'roi-planning',
        'source': gjs[0],
        'slug': 'roi-national-planning-applications',
        'name': 'ROI National Planning Applications',
        'category': 'built-environment',
        'provider': ['Department of Housing, Local Government and Heritage'],
        'keywords': ['planning', 'planning applications', 'development', 'housing', 'roi', 'ireland'],
        'labelProperty': None,
        'color': '#388E3C',
        'description': 'All-Ireland planning applications submitted to local authorities — point map of permission decisions, with attributes for application type, applicant, and decision status.',
        'date': None,
    })

# === Item 8: TII transport ===
tii = DGI / 'Transport Infrastructure Ireland'
TII = [
    ('tii-national-road-network', 'TII National Road Network', 'national-road-network-2013', 'NationalRoads2013.kml', 'kml', '#1976D2'),
    ('tii-marker-plates', 'TII Roadside Marker Plates', 'marker-plates', 'TIIMarkerPlates.kml', 'kml', '#5C6BC0'),
    ('tii-collision-rates-2014-2016', 'TII Collision Rates 2014-2016', 'collision-rates-2014-to-2016', 'CollisionRate_2014to2016_ShapeFile.zip', 'shp-zip', '#D32F2F'),
    ('tii-collision-rates-2011-2013', 'TII Collision Rates 2011-2013', 'collision-rates-2011-to-2013', 'CollisionRate_2011to2013_ShapeFile.zip', 'shp-zip', '#C62828'),
    ('tii-traffic-counter-locations', 'TII Traffic Counter Locations', 'traffic-counter-locations', 'tmu-traffic-counters.geojson', 'geojson', '#0277BD'),
    ('tii-wim-sensor-locations', 'TII Weigh-in-Motion Sensor Locations', 'wim-sensor-locations', 'wim-traffic-counters.geojson', 'geojson', '#01579B'),
    ('tii-luas-stops', 'Luas Tram Stops', 'luas-stop-locations', 'luas-stops.zip', 'shp-zip', '#C2185B'),
]
for slug, name, folder, fname, fmt, colour in TII:
    src = tii / folder / fname
    if not src.exists():
        print(f'  ! TII miss: {src}')
        continue
    DATASETS.append({
        'subdir': 'roi-transport',
        'source': src,
        'src_format': fmt,
        'slug': slug,
        'name': name,
        'category': 'transport',
        'provider': ['Transport Infrastructure Ireland'],
        'keywords': ['TII', 'transport', 'roads', name.lower(), 'ireland'],
        'labelProperty': None,
        'color': colour,
        'description': f'{name} — published by Transport Infrastructure Ireland.',
        'date': None,
    })

print(f'Processing {len(DATASETS)} datasets...\n')

def feature_count(p):
    out = subprocess.check_output(['ogrinfo', '-al', '-so', str(p)],
                                   stderr=subprocess.DEVNULL).decode('utf-8', errors='replace')
    for ln in out.splitlines():
        if ln.startswith('Feature Count:'):
            return int(ln.split(':')[1].strip())
    return None

def first_string_field(p):
    out = subprocess.check_output(['ogrinfo', '-al', '-so', str(p)],
                                   stderr=subprocess.DEVNULL).decode('utf-8', errors='replace')
    for ln in out.splitlines():
        if ': String (' in ln:
            return ln.split(':')[0].strip()
    return None

results = []
for d in DATASETS:
    src = d['source']
    fmt = d.get('src_format', 'auto')
    out_dir = STAGE / d['subdir']
    out_dir.mkdir(parents=True, exist_ok=True)
    out_fgb = out_dir / f'{d["slug"]}.fgb'

    if fmt == 'shp-zip':
        # extract first
        with tempfile.TemporaryDirectory() as td:
            with zipfile.ZipFile(src) as zf:
                zf.extractall(td)
            shps = list(Path(td).rglob('*.shp'))
            if not shps:
                print(f'  ! no .shp in {src.name}')
                continue
            cmd = ['ogr2ogr', '-f', 'FlatGeobuf', '-overwrite',
                   '-t_srs', 'EPSG:4326', '-makevalid', '-skipfailures',
                   '-nlt', 'PROMOTE_TO_MULTI',
                   str(out_fgb), str(shps[0])]
            try:
                subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
            except subprocess.CalledProcessError:
                print(f'  ! conversion FAILED for {d["slug"]}')
                continue
    else:
        cmd = ['ogr2ogr', '-f', 'FlatGeobuf', '-overwrite',
               '-t_srs', 'EPSG:4326', '-makevalid', '-skipfailures',
               '-nlt', 'PROMOTE_TO_MULTI',
               str(out_fgb), str(src)]
        try:
            subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            print(f'  ! conversion FAILED for {d["slug"]}')
            continue

    fc = feature_count(out_fgb)
    label = d.get('labelProperty') or first_string_field(out_fgb)

    # Stage original
    src_ext = src.suffix
    dst_orig = out_dir / f'{d["slug"]}{src_ext}'
    try:
        shutil.copy2(src, dst_orig)
    except Exception:
        dst_orig = None

    results.append({**d, 'feature_count': fc, 'fgb_path': str(out_fgb), 'label': label,
                    'src_ext': src_ext, 'dst_orig': str(dst_orig) if dst_orig else None})
    print(f'  {d["slug"]:40} {fc:>6} features  {out_fgb.stat().st_size/1e6:>5.1f}MB')

with open(STAGE.parent / 'batch2a_results.json', 'w') as f:
    out = []
    for r in results:
        rr = {k: v for k, v in r.items() if k not in ('source', 'fgb_path', 'dst_orig')}
        rr['fgb_relpath'] = str(Path(r['fgb_path']).relative_to(STAGE)).replace('\\', '/')
        rr['orig_relpath'] = str(Path(r['dst_orig']).relative_to(STAGE)).replace('\\', '/') if r['dst_orig'] else None
        out.append(rr)
    json.dump(out, f, indent=2)
print(f'\n{len(results)} staged in {STAGE}')
