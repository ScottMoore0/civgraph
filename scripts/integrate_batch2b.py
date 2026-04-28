"""Batch 2b — Dublin metropolitan councils (DCC, DLRCC, Fingal, SDCC).

Auto-discovers spatial files in each council folder and generates map entries
with names derived from parent folder names.
"""
import os, re, shutil, subprocess, json, tempfile, zipfile
from pathlib import Path

DGI = Path(r'D:\datagovie')
STAGE = Path(r'C:\tmp\integrate-batch2b\data\maps')
STAGE.mkdir(parents=True, exist_ok=True)

COUNCILS = [
    ('Dublin City Council', 'dcc', 'DCC', '#FF6F00'),
    ('Dún Laoghaire-Rathdown County Council', 'dlr', 'DLR', '#0091EA'),
    ('Fingal County Council', 'fingal', 'Fingal', '#7C4DFF'),
    ('South Dublin County Council', 'sdcc', 'SDCC', '#00BCD4'),
]

def humanise(slug):
    """Convert kebab-case into Title Case."""
    s = slug.replace('-dcc', '').replace('-dlr', '').replace('-fingal', '').replace('-sdcc', '')
    s = re.sub(r'(\b)(roi|nis|csv|gis|gp|hse|cc)(\b)', lambda m: m.group(2).upper(), s.replace('-', ' '))
    s = ' '.join(w.capitalize() if not w.isupper() else w for w in s.split())
    return s

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
seen_slugs = set()

for council_folder, abbr, abbr_disp, colour in COUNCILS:
    council_path = DGI / council_folder
    if not council_path.exists():
        continue
    print(f'\n=== {council_folder} ===')

    # Pick spatial files: prefer .geojson, fall back to .kml or .gpkg
    for dataset_folder in sorted(council_path.iterdir()):
        if not dataset_folder.is_dir():
            continue
        ds_slug = dataset_folder.name
        cands = (list(dataset_folder.glob('*.geojson'))
                 + list(dataset_folder.glob('*.gpkg'))
                 + list(dataset_folder.glob('*.kml')))
        cands = [c for c in cands if c.stat().st_size >= 1024]  # skip tiny placeholders
        if not cands:
            continue
        src = cands[0]

        slug_clean = ds_slug.lower()
        # Strip the trailing council abbr suffix from the folder name itself
        for suf in (f'-{abbr}', f'_{abbr}'):
            if slug_clean.endswith(suf):
                slug_clean = slug_clean[:-len(suf)]
        # Drop common boilerplate prefixes
        slug_clean = re.sub(r'^(devplan2022_2028_|development-plan-2022-2028-|cdp2016-2022-)', '', slug_clean)
        slug_clean = re.sub(r'-?(cdp2016-2022|cdp-2016-2022|2022_2028)$', '', slug_clean)
        slug_clean = re.sub(r'[^a-z0-9-]+', '-', slug_clean).strip('-')
        slug_clean = re.sub(r'-+', '-', slug_clean)
        slug = f'{abbr}-{slug_clean}'
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)

        out_dir = STAGE / f'roi-{abbr}'
        out_dir.mkdir(parents=True, exist_ok=True)
        out_fgb = out_dir / f'{slug}.fgb'

        cmd = ['ogr2ogr', '-f', 'FlatGeobuf', '-overwrite',
               '-t_srs', 'EPSG:4326', '-makevalid', '-skipfailures',
               '-nlt', 'PROMOTE_TO_MULTI',
               str(out_fgb), str(src)]
        try:
            subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            print(f'  ! conversion FAILED for {slug}')
            continue
        try:
            fc = feature_count(out_fgb)
        except Exception:
            print(f'  ! feature count failed for {slug}')
            continue
        if fc is None or fc == 0:
            print(f'  ! 0 features for {slug}, skipping')
            out_fgb.unlink(missing_ok=True)
            continue
        label = first_string_field(out_fgb)

        # Stage original
        src_ext = src.suffix
        dst_orig = out_dir / f'{slug}{src_ext}'
        try:
            shutil.copy2(src, dst_orig)
        except Exception:
            dst_orig = None

        # Display name: humanise the cleaned slug
        display = humanise(slug_clean) + f' ({abbr_disp})'

        results.append({
            'subdir': f'roi-{abbr}',
            'slug': slug,
            'name': display,
            'category': 'built-environment',
            'provider': [council_folder],
            'keywords': ['ROI', 'ireland', 'dublin', abbr_disp.lower(), 'amenity', 'council'] + slug_clean.split('-'),
            'labelProperty': label,
            'color': colour,
            'description': f'{display} — published by {council_folder}.',
            'date': None,
            'feature_count': fc,
            'fgb_relpath': f'roi-{abbr}/{out_fgb.name}',
            'orig_relpath': f'roi-{abbr}/{dst_orig.name}' if dst_orig else None,
            'orig_ext': src_ext,
        })
        print(f'  {slug:55} {fc:>6} feat')

with open(STAGE.parent / 'batch2b_results.json', 'w') as f:
    json.dump(results, f, indent=2)
total = sum(p.stat().st_size for p in STAGE.rglob("*") if p.is_file())
print(f'\n{len(results)} datasets staged. Total: {total/1e6:.1f} MB')
