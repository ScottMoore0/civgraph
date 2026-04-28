"""Batch 3 — A1 (DfI roads time series), A2 (Translink routes), A3 (border crossings),
B3 (NIEA landfills 2013-16), B4 (NIEA water management), B5 (pedestrian crossings)."""
import os, re, shutil, subprocess, json, zipfile, tempfile
from pathlib import Path

OD = Path(r'D:\opendatani')
STAGE = Path(r'C:\tmp\integrate-batch3\data\maps')
STAGE.mkdir(parents=True, exist_ok=True)

DATASETS = []

# === A1a: DfI Roads Pothole Enquiries (multi-year) ===
roads = OD / 'Department for Infrastructure - Roads'
for gj in sorted((roads / 'pothole-enquiries').glob('*.geojson')):
    # Extract year from filename
    m = re.search(r'(\d{4})', gj.stem)
    if not m: continue
    year = m.group(1)
    DATASETS.append({
        'subdir': 'transport-infra', 'source': gj,
        'slug': f'dfi-pothole-enquiries-{year}',
        'name': f'NI Pothole Enquiries {year}',
        'category': 'transport',
        'provider': ['Department for Infrastructure - Roads'],
        'keywords': ['DfI', 'pothole', 'roads', 'maintenance', 'enquiries', year],
        'color': '#5D4037', 'date': f'{year}-01-01',
        'description': f'Pothole enquiries logged by DfI Roads in {year} — public reports of road defects requiring repair.',
    })

# === A1b: DfI Roads Surface Defects (multi-year) ===
for gj in sorted((roads / 'surface-defects').glob('*.geojson')):
    m = re.search(r'(\d{4})', gj.stem)
    if not m: continue
    year = m.group(1)
    DATASETS.append({
        'subdir': 'transport-infra', 'source': gj,
        'slug': f'dfi-surface-defects-{year}',
        'name': f'NI Road Surface Defects {year}',
        'category': 'transport',
        'provider': ['Department for Infrastructure - Roads'],
        'keywords': ['DfI', 'roads', 'surface', 'defects', 'maintenance', year],
        'color': '#795548', 'date': f'{year}-01-01',
        'description': f'Road surface defects recorded by DfI Roads inspections in {year}.',
    })

# === A2: Translink bus routes ===
translink = OD / 'Translink'
A2_ENTRIES = [
    ('translink-metro-glider-routes', 'Belfast Metro & Glider Routes', translink / 'translink-metro-bus-routes' / 'metro-glider-routes-updated-23092025.zip', '#E65100'),
    ('translink-glider-halts-2019', 'Belfast Glider Halts (2019)', translink / 'translink-metro-bus-routes' / '20190116-glider-halts.zip', '#FF6F00'),
    ('translink-ulsterbus-goldliner-routes', 'Ulsterbus / Goldliner Routes', translink / 'translink-ulsterbus-routes' / 'ulsterbus-goldliner-routes-updated-23092025.zip', '#FFA000'),
    ('translink-nir-rail-network', 'NI Railways Network', translink / 'nir20160126v2' / 'nir-16042026.zip', '#1565C0'),
]
for slug, name, src, colour in A2_ENTRIES:
    if not src.exists(): continue
    DATASETS.append({
        'subdir': 'transport-translink', 'source': src, 'src_format': 'shp-zip',
        'slug': slug, 'name': name, 'category': 'transport',
        'provider': ['Translink'],
        'keywords': ['translink', 'transit', name.lower().split()[0], 'bus', 'rail'],
        'color': colour, 'date': None,
        'description': f'{name} — published by Translink.',
    })

# === A3: DfI Border Crossings 2018 ===
for gj in (roads / 'border-crossings-2018').glob('*.geojson'):
    geom_kind = 'lines' if 'line' in gj.stem.lower() else 'points'
    DATASETS.append({
        'subdir': 'transport-infra', 'source': gj,
        'slug': f'dfi-border-crossings-2018-{geom_kind}',
        'name': f'NI Border Crossings 2018 ({geom_kind.capitalize()})',
        'category': 'transport',
        'provider': ['Department for Infrastructure - Roads'],
        'keywords': ['border', 'crossing', 'brexit', 'NI-ROI', '2018', 'roads'],
        'color': '#D84315' if geom_kind == 'lines' else '#BF360C',
        'date': '2018-01-01',
        'description': f'NI-ROI border crossings 2018 ({geom_kind}) — DfI inventory created for Brexit planning.',
    })

# === B3: NIEA Landfill annual snapshots 2013-2016 ===
niea = OD / 'Northern Ireland Environment Agency - Control & Data Management'
LANDFILL = [(2013, 'landfill2013.geojson'), (2014, 'landfill2014.geojson'),
            (2015, 'landfill2015.geojson'), (2016, 'landfill2016.geojson')]
for year, fname in LANDFILL:
    src = niea / 'niea-authorised-landfill-sites' / fname
    if not src.exists(): continue
    DATASETS.append({
        'subdir': 'environment', 'source': src,
        'slug': f'niea-landfill-sites-{year}',
        'name': f'NIEA Authorised Landfill Sites ({year})',
        'category': 'environment',
        'provider': ['NIEA'],
        'keywords': ['NIEA', 'landfill', 'waste', 'environment', str(year)],
        'color': '#263238', 'date': f'{year}-01-01',
        'description': f'Locations of authorised landfill sites in Northern Ireland as of {year}.',
    })

# === B4: NIEA Water Management Unit datasets (shp-in-zip) ===
wmu = OD / 'Northern Ireland Environment Agency - Water Management Unit'
B4_ENTRIES = [
    ('niea-transitional-water-bodies', 'NIEA Transitional Water Bodies', wmu / 'norther' / 'transitionalwaterbodiesshp.zip', '#0277BD'),
    ('niea-river-segments', 'NIEA River Segments', wmu / 'https-www-daera-ni-gov-uk-sites-default-files-publications-doe-riversegmentgml-zip' / 'riversegmentshp1.zip', '#01579B'),
    ('niea-catchment-stakeholder-groups', 'NIEA Catchment Stakeholder Groups', wmu / 'northern-ireland-catchment-stakeholder-groups' / 'catchmentstakeholdergroupshp.zip', '#039BE5'),
    ('niea-local-management-areas', 'NIEA Local Management Areas', wmu / 'northern-ireland-local-management-areas' / 'localmanagementareashp.zip', '#03A9F4'),
]
for slug, name, src, colour in B4_ENTRIES:
    if not src.exists(): continue
    DATASETS.append({
        'subdir': 'water-quality', 'source': src, 'src_format': 'shp-zip',
        'slug': slug, 'name': name, 'category': 'water-quality',
        'provider': ['NIEA'],
        'keywords': ['NIEA', 'water', 'WFD', name.lower()],
        'color': colour, 'date': None,
        'description': f'{name} — published by NIEA Water Management Unit (Water Framework Directive boundaries).',
    })

# === B5: DfI Pedestrian Crossings ===
for gj in (roads / 'pedestrain-crossing').glob('*.geojson'):
    DATASETS.append({
        'subdir': 'transport-infra', 'source': gj,
        'slug': 'dfi-pedestrian-crossings',
        'name': 'NI Pedestrian Crossings',
        'category': 'transport',
        'provider': ['Department for Infrastructure - Roads'],
        'keywords': ['pedestrian', 'crossing', 'roads', 'accessibility', 'safety'],
        'color': '#558B2F', 'date': None,
        'description': 'Locations of pedestrian crossings on the public road network in Northern Ireland.',
    })
    break

# Process all
print(f'Processing {len(DATASETS)} datasets...\n')

def feature_count(p):
    out = subprocess.check_output(['ogrinfo', '-al', '-so', str(p)], stderr=subprocess.DEVNULL).decode('utf-8', errors='replace')
    for ln in out.splitlines():
        if ln.startswith('Feature Count:'):
            return int(ln.split(':')[1].strip())
    return None

def first_string_field(p):
    out = subprocess.check_output(['ogrinfo', '-al', '-so', str(p)], stderr=subprocess.DEVNULL).decode('utf-8', errors='replace')
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
        with tempfile.TemporaryDirectory() as td:
            try:
                with zipfile.ZipFile(src) as zf:
                    zf.extractall(td)
            except Exception as e:
                print(f'  ! zip failed for {d["slug"]}: {e}')
                continue
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
    if not fc:
        print(f'  ! 0 features for {d["slug"]}')
        out_fgb.unlink(missing_ok=True)
        continue
    label = first_string_field(out_fgb)

    src_ext = src.suffix
    dst_orig = out_dir / f'{d["slug"]}{src_ext}'
    try:
        shutil.copy2(src, dst_orig)
    except Exception:
        dst_orig = None

    results.append({**d, 'feature_count': fc, 'fgb_relpath': f'{d["subdir"]}/{out_fgb.name}',
                    'orig_relpath': f'{d["subdir"]}/{dst_orig.name}' if dst_orig else None,
                    'orig_ext': src_ext, 'label': label})
    print(f'  {d["slug"]:40} {fc:>6} features  {out_fgb.stat().st_size/1e6:>5.1f}MB')

# strip non-serialisable
for r in results:
    r.pop('source', None)

with open(STAGE.parent / 'batch3_results.json', 'w') as f:
    json.dump(results, f, indent=2, default=str)
print(f'\n{len(results)} staged. Total: '
      f'{sum(p.stat().st_size for p in STAGE.rglob("*") if p.is_file())/1e6:.1f} MB')
