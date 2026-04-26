#!/usr/bin/env python
"""Ingest Tier 1 ODNI + data.gov.ie layers onto the website.

For each layer:
  1. Locate source file (extracting ZIPs, renaming extension-less files).
  2. Convert to FGB (re-project from Irish Grid to WGS84 if needed).
  3. Stage under data/maps/<subdir>/.
  4. Compose maps.json entry; insert at correct position.
"""
import json, os, re, shutil, subprocess, sys, io, zipfile, tempfile
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"
OGR2OGR = "C:/Program Files/GDAL/ogr2ogr.exe"

# Category for the new BCN sub-card: place between 'parliamentary' and the next.
NEW_CATEGORY_BCN = {
    "id": "parliamentary-proposals",
    "name": "Parliamentary Boundary Commission",
    "group": "Political Geography",
    "description": "NI Boundary Commission redistribution proposals at Provisional, Revised, and Final stages.",
}

# Each LAYER_DEF: dict with all info to stage + register
LAYERS = [
    # === Boundary Commission for NI (3) ===
    dict(id='bcn-provisional-proposals', name='BCN Provisional Proposals',
         category='parliamentary-proposals', date=2017,
         src_root='D:/opendatani', src_dir_hint='boundary-commission-for-northern-ireland-revised-proposals',  # provisional missing on disk; revised has both
         src_pattern='agreed-revised-proposals.geojson',
         dest_subdir='parliamentary', label='Const_Nm', color='#7B5BA8',
         description='Boundary Commission for NI — Revised Proposals (the second-stage redrawn map of the abandoned 2018 redistribution review).',
         provider=['Boundary Commission for Northern Ireland'],
         skip=True,  # no provisional file; we only have revised
    ),
    dict(id='bcn-revised-proposals', name='BCN Revised Proposals',
         category='parliamentary-proposals', date=2018,
         src_root='D:/opendatani',
         src_dir_hint='boundary-commission-for-northern-ireland-revised-proposals',
         src_pattern='agreed-revised-proposals.geojson',
         dest_subdir='parliamentary', label='Const_Nm', color='#7B5BA8',
         description='Boundary Commission for Northern Ireland — Revised Proposals (January 2018).',
         provider=['Boundary Commission for Northern Ireland'],
    ),
    dict(id='bcn-final-recommendations', name='BCN Final Recommendations',
         category='parliamentary-proposals', date=2018,
         src_root='D:/opendatani',
         src_dir_hint='boundary-commision-for-northern-ireland-final-recommendations',  # typo in slug
         src_pattern=None,  # auto: pick first .geojson
         dest_subdir='parliamentary', label='Const_Nm', color='#5B3B8B',
         description='Boundary Commission for Northern Ireland — Final Recommendations (the abandoned 2018 redistribution).',
         provider=['Boundary Commission for Northern Ireland'],
    ),
    # === DfI Roads (3) ===
    dict(id='roads-pothole-enquiries', name='Pothole Enquiries',
         category='transport',
         src_root='D:/opendatani',
         src_dir_hint='pothole-enquiries',
         src_pattern='*2025_2026*.geojson|*Pothole_Enquiries_2025_2026*|pothole-enquiries-*.geojson',
         dest_subdir='transport', label='Region', color='#E0A60C',
         description='Pothole reports submitted to DfI Roads — point dataset showing locations of public reports per year (selected: latest available 2025–2026).',
         provider=['Department for Infrastructure - Roads'],
    ),
    dict(id='roads-border-crossings-2018', name='Border Crossings 2018',
         category='transport',
         src_root='D:/opendatani',
         src_dir_hint='border-crossings-2018',
         src_pattern='bordercrossingpoints2018.geojson',
         dest_subdir='transport', label='Name', color='#205493',
         description='Border crossings between Northern Ireland and the Republic of Ireland (2018 mapping). Points (crossing locations) and lines (route segments) variants both available.',
         provider=['Department for Infrastructure - Roads'],
    ),
    dict(id='roads-pedestrian-crossings', name='Pedestrian Crossings',
         category='transport',
         src_root='D:/opendatani',
         src_dir_hint='pedestrain-crossing',  # typo in upstream slug
         src_pattern='*.geojson',
         dest_subdir='transport', label='Type', color='#C9302C',
         description='Locations of pedestrian crossings across Northern Ireland (DfI Roads).',
         provider=['Department for Infrastructure - Roads'],
    ),
    # === DfI Rivers Coastal Flood (1) — FGB primary + SHP download ===
    dict(id='rivers-coastal-flood-2018', name='Coastal Flood Boundary — Extreme Sea Levels (2018)',
         category='physical-geography',
         src_root='D:/opendatani',
         src_dir_hint='coastal-flood-boundary-extreme-sea-levels-2018-ni-extract',
         src_pattern='*.zip',
         is_zipped_shp=True, src_crs='EPSG:29903',  # Irish Grid TM75
         dest_subdir='environment', label='Name', color='#3B8DBD',
         description='Modelled extreme sea levels around the NI coast at multiple return periods (2018 mapping). Used by DfI Rivers for coastal flood risk assessment.',
         provider=['Department for Infrastructure - Rivers'],
         keep_shp_download=True,
    ),
    # === DfC Historic Environment (5) ===
    dict(id='hed-listed-buildings', name='Listed Buildings (NI)',
         category='historic',
         src_root='D:/opendatani',
         src_dir_hint='listed-buildings-northern-ireland',
         src_pattern='historicbuildings_*.geojson',
         dest_subdir='heritage', label='HB_REF', color='#8E5A3C',
         description='All listed buildings in Northern Ireland (Department for Communities — Historic Environment Division).',
         provider=['Department for Communities - Historic Environment Division'],
    ),
    dict(id='hed-sites-and-monuments', name='Sites and Monuments Record (NI)',
         category='historic',
         src_root='D:/opendatani',
         src_dir_hint='northern-ireland-sites-and-monuments-record',
         src_pattern='smr_*.geojson',
         dest_subdir='heritage', label='SMR', color='#6B4226',
         description='Recorded archaeological and historic monuments across Northern Ireland (DfC HED).',
         provider=['Department for Communities - Historic Environment Division'],
    ),
    dict(id='hed-scheduled-monument-areas', name='Scheduled Historic Monument Areas',
         category='historic',
         src_root='D:/opendatani',
         src_dir_hint='scheduled-historic-monument-areas',
         src_pattern='scheduled_areas_*.geojson',
         dest_subdir='heritage', label='SAM_Ref', color='#9C7A5B',
         description='Statutorily protected monument zones — scheduled under historic-monuments legislation.',
         provider=['Department for Communities - Historic Environment Division'],
    ),
    dict(id='hed-defence-heritage', name='Defence Heritage Sites (NI)',
         category='historic',
         src_root='D:/opendatani',
         src_dir_hint='defence-heritage',
         src_pattern='*.geojson',
         dest_subdir='heritage', label='Name', color='#5C5C8E',
         description='Forts, batteries, defensive structures and military heritage sites in Northern Ireland.',
         provider=['Department for Communities - Historic Environment Division'],
    ),
    dict(id='hed-industrial-heritage', name='Industrial Heritage Record',
         category='historic',
         src_root='D:/opendatani',
         src_dir_hint='industrial-heritage-record',
         src_pattern='ihr_*.geojson',
         dest_subdir='heritage', label='IHR_REF', color='#A87648',
         description='Mills, mines, factories and other industrial-era heritage sites recorded by DfC HED.',
         provider=['Department for Communities - Historic Environment Division'],
    ),
    # === Tailte Built-Up Areas + Centres of Population (3) ===
    dict(id='tailte-built-up-1m', name='Built-Up Areas (Ireland 1M)',
         category='settlements',
         src_root='D:/datagovie',
         src_dir_hint='built-up-areas-national-1m-map-of-ireland1',
         src_pattern_extless='geoPackage',  # extension-less file
         is_gpkg=True,
         dest_subdir='settlements', label='ENGLISH_NA', color='#B07050',
         description='Built-up area polygons used in the National 1M Map of Ireland (Tailte Éireann).',
         provider=['Tailte Éireann'],
    ),
    dict(id='tailte-built-up-points-250k', name='Built-Up Areas — Points (Ireland 250k)',
         category='settlements',
         src_root='D:/datagovie',
         src_dir_hint='built-up-areas-points-national-250k-map-of-ireland',
         src_pattern_extless='geoPackage',
         is_gpkg=True,
         dest_subdir='settlements', label='ENGLISH_NA', color='#A05040',
         description='Centroid points for built-up areas at 250k mapping scale (Tailte Éireann).',
         provider=['Tailte Éireann'],
    ),
    dict(id='cso-urban-areas-2022', name='CSO Urban Areas 2022',
         category='settlements',
         src_root='D:/datagovie',
         src_dir_hint='cso-urban-areas-national-statistical-boundaries-2022-ungeneralised1',
         src_pattern_extless='geoPackage',
         is_gpkg=True,
         dest_subdir='settlements', label='ENGLISH', color='#7C4D7C',
         description='Census 2022 urban area definitions — ungeneralised statistical boundaries from Tailte Éireann / CSO.',
         provider=['Tailte Éireann', 'Central Statistics Office'],
    ),
    # === GSI (5) ===
    dict(id='gsi-bedrock-geology-50k', name='Bedrock Geology 1:50,000 (ROI)',
         category='geology-geophysics',
         src_root='D:/datagovie',
         src_dir_hint='bedrock-geology-150000-ireland-roi-itm-incomplete',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',  # Irish Transverse Mercator
         dest_subdir='geology', label='UNIT_NAME', color='#6B7A8F',
         description='Geological Survey Ireland — Bedrock geology of the Republic of Ireland at 1:50,000 (incomplete coverage; western and northern areas only).',
         provider=['Geological Survey Ireland'],
    ),
    dict(id='gsi-bedrock-boreholes-50k', name='Bedrock Boreholes 1:50,000 (ROI)',
         category='geology-geophysics',
         src_root='D:/datagovie',
         src_dir_hint='bedrock-boreholes-150000-ireland-roi-itm',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',
         dest_subdir='geology', label='SiteName', color='#8B5A2B',
         description='Verified bedrock borehole locations across the Republic of Ireland (GSI).',
         provider=['Geological Survey Ireland'],
    ),
    dict(id='gsi-groundwater-flooding-low', name='Groundwater Flooding — Low Probability (ROI)',
         category='geology-geophysics',
         src_root='D:/datagovie',
         src_dir_hint='groundwater-flooding-low-probability-120000-ireland-roi-itm',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',
         dest_subdir='geology', label='Name', color='#A6CEE3',
         description='Modelled low-probability groundwater flood extents at 1:20,000 (GSI).',
         provider=['Geological Survey Ireland'],
    ),
    dict(id='gsi-groundwater-flooding-medium', name='Groundwater Flooding — Medium Probability (ROI)',
         category='geology-geophysics',
         src_root='D:/datagovie',
         src_dir_hint='groundwater-flooding-medium-probability-120000-ireland-roi-itm',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',
         dest_subdir='geology', label='Name', color='#5B9DC9',
         description='Modelled medium-probability groundwater flood extents at 1:20,000 (GSI).',
         provider=['Geological Survey Ireland'],
    ),
    dict(id='gsi-karst-data', name='Karst Data (Ireland — all-island)',
         category='geology-geophysics',
         src_root='D:/datagovie',
         src_dir_hint='groundwater-karst-data-ireland-roini-itm',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',
         dest_subdir='geology', label='Type', color='#7BAA66',
         description='Karst features and limestone terrain across Ireland (all-island, GSI). Includes the Burren, Marble Arch, and other significant karst landscapes.',
         provider=['Geological Survey Ireland'],
    ),
    # === OPW Flood (3) ===
    dict(id='opw-nifm-river-flood-extents-current', name='NIFM River Flood Extents — Current Scenario',
         category='physical-geography',
         src_root='D:/datagovie',
         src_dir_hint='nifm-river-flood-extents-current-scenario',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',
         dest_subdir='environment', label='Scenario', color='#3F8DB0',
         description='OPW National Indicative Fluvial Mapping — modelled river flood extents under current climate (10/100/1000-year return periods).',
         provider=['Office of Public Works'],
    ),
    dict(id='opw-coastal-flood-extents-2021-current', name='National Coastal Flood Extents 2021 — Current Scenario',
         category='physical-geography',
         src_root='D:/datagovie',
         src_dir_hint='national-coastal-flood-extents-2021-current-scenario',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',
         dest_subdir='environment', label='Scenario', color='#4F94B5',
         description='OPW national coastal flood extent mapping (2021) under current climate. Multi-return-period coastal flood envelopes.',
         provider=['Office of Public Works'],
    ),
    dict(id='opw-fsu-catchments-gauged', name='FSU Catchment Boundaries — Gauged 2025',
         category='physical-geography',
         src_root='D:/datagovie',
         src_dir_hint='flood-studies-update-fsu-catchment-boundaries-gauged',
         src_pattern='*.zip', is_zipped_shp=True, src_crs='EPSG:2157',
         dest_subdir='environment', label='Stn_No', color='#2D7A8F',
         description='OPW Flood Studies Update — gauged catchment boundaries (2025 release). Catchments associated with hydrometric monitoring stations.',
         provider=['Office of Public Works'],
    ),
]

R2_BASE = "https://data.civgraph.net"


def find_pkg_dir(src_root, hint):
    root = Path(src_root)
    for org in root.iterdir():
        if not org.is_dir(): continue
        cand = org / hint
        if cand.exists() and cand.is_dir():
            return cand
    # Fuzzy
    for org in root.iterdir():
        if not org.is_dir(): continue
        for d in org.iterdir():
            if d.is_dir() and hint.replace('-', '').lower() in d.name.replace('-', '').lower():
                return d
    return None


def find_source_file(pkg_dir, layer):
    """Locate the source GeoJSON / SHP-zip / GPKG file."""
    if layer.get('skip'): return None
    if layer.get('is_gpkg'):
        # extension-less file named e.g. 'geoPackage'
        target = layer.get('src_pattern_extless') or 'geoPackage'
        for f in pkg_dir.iterdir():
            if f.is_file() and f.name == target:
                return f
        return None
    pat = layer.get('src_pattern')
    if not pat: pat = '*.geojson'
    if '|' in pat:
        for sub in pat.split('|'):
            files = sorted(pkg_dir.glob(sub))
            if files: return files[-1]  # latest
        return None
    files = sorted(pkg_dir.glob(pat))
    if not files: return None
    return files[-1]


def convert_to_fgb(src, dest, layer):
    """ogr2ogr → FGB, reprojecting if src_crs given."""
    if dest.exists(): dest.unlink()
    cmd = [OGR2OGR, '-f', 'FlatGeobuf', '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures']
    if layer.get('src_crs'):
        cmd += ['-s_srs', layer['src_crs'], '-t_srs', 'EPSG:4326']
    elif str(src).endswith('.geojson'):
        # GeoJSON is already WGS84 by spec — no reprojection
        pass
    elif layer.get('is_gpkg'):
        # GPKG often has its own CRS; let ogr2ogr autodetect, but force WGS84 output
        cmd += ['-t_srs', 'EPSG:4326']
    cmd += [str(dest), str(src)]
    if layer.get('is_zipped_shp'):
        # Need to extract the zip first into a temp dir, find the .shp
        with tempfile.TemporaryDirectory() as td:
            with zipfile.ZipFile(src) as zf:
                zf.extractall(td)
            shps = list(Path(td).rglob('*.shp'))
            if not shps:
                print(f"    ! no SHP in zip: {src}")
                return False
            cmd[-1] = str(shps[0])
            r = subprocess.run(cmd, capture_output=True, text=True)
    else:
        r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"    ! ogr2ogr failed: {r.stderr[:300]}")
        return False
    return dest.exists() and dest.stat().st_size > 1000


def main():
    db = json.loads(MAPS_JSON.read_text(encoding='utf-8'))
    maps = db['maps']

    # Add new category for BCN proposals if not present
    cats = db.setdefault('categories', [])
    if not any(c.get('id') == NEW_CATEGORY_BCN['id'] for c in cats):
        # Insert right after 'parliamentary'
        idx = next((i for i,c in enumerate(cats) if c.get('id')=='parliamentary'), len(cats))
        cats.insert(idx + 1, NEW_CATEGORY_BCN)
        print(f"  + added category {NEW_CATEGORY_BCN['id']}")

    # Stage all source files into data/maps/<dest_subdir>/
    staged_files = []  # list of paths to upload
    for L in LAYERS:
        if L.get('skip'):
            print(f"\n[skip] {L['id']}"); continue
        src_dir = find_pkg_dir(L['src_root'], L['src_dir_hint'])
        if not src_dir:
            print(f"  ! pkg dir not found: {L['id']}"); continue
        src_file = find_source_file(src_dir, L)
        if not src_file:
            print(f"  ! source file not found in {src_dir}: {L['id']}"); continue
        dest_dir = REPO / 'data' / 'maps' / L['dest_subdir']
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_fgb = dest_dir / f"{L['id']}.fgb"
        print(f"\n[{L['id']}]")
        print(f"  src: {src_file.relative_to(Path(L['src_root']))}")
        if convert_to_fgb(src_file, dest_fgb, L):
            sz = dest_fgb.stat().st_size
            print(f"  fgb: {sz/1024:.1f} KB")
            # gzip
            import gzip
            gz = dest_fgb.with_suffix(dest_fgb.suffix + '.gz')
            if gz.exists(): gz.unlink()
            with dest_fgb.open('rb') as s, gzip.open(gz, 'wb') as d:
                shutil.copyfileobj(s, d)
            staged_files.append(dest_fgb)
            staged_files.append(gz)
            # If keep_shp_download, also copy the original zip
            if L.get('keep_shp_download'):
                shp_dest = dest_dir / f"{L['id']}.zip"
                shutil.copy(src_file, shp_dest)
                staged_files.append(shp_dest)
                print(f"  shp.zip: {shp_dest.stat().st_size/1024:.1f} KB")
            # Build maps.json entry
            entry = {
                'id': L['id'],
                'name': L['name'],
                'slug': L['id'],
                'category': L['category'],
                'provider': L['provider'],
                'description': L['description'],
                'files': {
                    'fgb': f"{R2_BASE}/data/maps/{L['dest_subdir']}/{L['id']}.fgb"
                },
                'style': {'color': L.get('color', '#3388ff'), 'weight': 2},
                'labelProperty': L['label'],
                'keywords': [L['category'], L['name'].lower()],
            }
            if L.get('date'):
                entry['date'] = L['date']
            if L.get('keep_shp_download'):
                entry['files']['shp_zip'] = f"{R2_BASE}/data/maps/{L['dest_subdir']}/{L['id']}.zip"
            # Replace existing entry if present
            maps[:] = [m for m in maps if m.get('id') != L['id']]
            maps.append(entry)

    db['maps'] = maps
    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"\nWrote maps.json — total {len(maps)} maps")
    print(f"\nFiles to upload to R2: {len(staged_files)}")
    for p in staged_files:
        print(f"  {p.relative_to(REPO)}")


if __name__ == "__main__":
    main()
