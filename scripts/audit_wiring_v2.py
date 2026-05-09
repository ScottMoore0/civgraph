"""Audit wiring for the 22 zip files: maps.json entry + labelProperty
matches FGB columns. Reads from the zip's extracted dir for files we
didn't copy locally."""
import json, os, sys, warnings
import geopandas as gpd
warnings.filterwarnings('ignore')

# (canonical R2 path, friendly label, fallback path inside zip extraction)
ZIP_ROOT = '_tmp_idb_zip2/Irish Digitised Boundaries'
TARGETS = [
    ('data/maps/parliamentary/1974_Dail.fgb', 'D 1974', 'Dáil Constituencies/1974.fgb'),
    ('data/maps/parliamentary/1980_Dail.fgb', 'D 1980', 'Dáil Constituencies/1980.fgb'),
    ('data/maps/parliamentary/1983_Dail.fgb', 'D 1983', 'Dáil Constituencies/1983.fgb'),
    ('data/maps/parliamentary/1995_Dail.fgb', 'D 1995', 'Dáil Constituencies/Files already on the site/1995.fgb'),
    ('data/maps/parliamentary/1998_Dail.fgb', 'D 1998', 'Dáil Constituencies/Files already on the site/1998.fgb'),
    ('data/maps/parliamentary/2007_Dail.fgb', 'D 2007', 'Dáil Constituencies/Files already on the site/2005.fgb'),
    ('data/maps/parliamentary/2011_Dail.fgb', 'D 2011', 'Dáil Constituencies/Files already on the site/2009.fgb'),
    ('data/maps/parliamentary/ROIConstituencies2013.fgb', 'D 2013', 'Dáil Constituencies/Files already on the site/2013.fgb'),
    ('data/maps/parliamentary/ROIConstituencies2017.fgb', 'D 2017', 'Dáil Constituencies/Files already on the site/2017.fgb'),
    ('data/maps/local-government/ROI_Local_Authorities_1966.fgb', 'LA 66', 'Local Authorities/1966.fgb'),
    ('data/maps/local-government/ROI_Local_Authorities_1977.fgb', 'LA 77', 'Local Authorities/1977.fgb'),
    ('data/maps/local-government/ROI_Local_Authorities_1980.fgb', 'LA 80', 'Local Authorities/1980.fgb'),
    ('data/maps/local-government/ROI_Local_Authorities_1985.fgb', 'LA 85', 'Local Authorities/1985.fgb'),
    ('data/maps/local-government/ROI_Local_Authorities_1986.fgb', 'LA 86', 'Local Authorities/1986.fgb'),
    ('data/maps/local-government/ROI_Local_Authorities_1994.fgb', 'LA 94', 'Local Authorities/1994.fgb'),
    ('data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Connacht_1986.fgb',  'C 1986', 'EDs/Wards_DEDs_Connacht_1986.fgb'),
    ('data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Leinster_1971.fgb',  'L 1971', 'EDs/Wards_DEDs_Leinster_1971.fgb'),
    ('data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Leinster_1977.fgb',  'L 1977', 'EDs/Wards_DEDs_Leinster_1977.fgb'),
    ('data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Munster_1971.fgb',   'M 1971', 'EDs/Wards_DEDs_Munster_1971.fgb'),
    ('data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Munster_1983.fgb',   'M 1983 NEW', 'EDs/Files already on the site/Wards_DEDs_Munster_1983.fgb'),
    ('data/maps/electoral-divisions/DEDs_Connacht_1919.fgb',                                       'C 1919 NEW', 'EDs/DEDs_Connacht_1919.fgb'),
    ('data/maps/electoral-divisions/DEDs_Ulster_1921.fgb',                                         'U 1921 ROI NEW', 'EDs/DEDs_Ulster_1921.fgb'),
]

with open('data/database/maps.json', encoding='utf-8') as f:
    d = json.load(f)
url_to_entries = {}
for m in d['maps']:
    fgb = m.get('files', {}).get('fgb', '')
    if fgb:
        key = fgb.replace('https://data.civgraph.net/', '')
        url_to_entries.setdefault(key, []).append({'id': m['id'], 'lp': m.get('labelProperty'), 'isVariant': False, 'parent': None})
    for v in m.get('variants', []) or []:
        vfgb = v.get('files', {}).get('fgb', '')
        if vfgb:
            key = vfgb.replace('https://data.civgraph.net/', '')
            url_to_entries.setdefault(key, []).append({
                'id': m['id'] + '/' + v.get('id', '?'),
                'lp': v.get('labelProperty') or m.get('labelProperty'),
                'isVariant': True,
                'parent': m['id'],
            })

# Geography rules — rules in election-controller.js reference R2 paths directly,
# without going through maps.json. We'll grep for them as well.
import re
ec = open('js/election-controller.js', encoding='utf-8').read()
gr_paths = set(re.findall(r"fgb:\s*'(data/maps/[^']+)'", ec))

ok = 0
problems = []
for r2, label, zip_rel in TARGETS:
    entries = url_to_entries.get(r2, [])
    in_geo = r2 in gr_paths
    # Read columns
    src = r2 if os.path.exists(r2) else os.path.join(ZIP_ROOT, zip_rel)
    cols = None
    if os.path.exists(src):
        try:
            g = gpd.read_file(src, rows=1)
            cols = list(g.columns)
        except Exception as e:
            cols = f'(read error: {e})'
    # Verify label property
    label_issues = []
    for e in entries:
        if e['lp'] and isinstance(cols, list) and e['lp'] not in cols:
            label_issues.append(f'{e["id"]}: labelProperty "{e["lp"]}" not in {sorted(set(cols)-{"geometry"})[:6]}')
    refs = sorted({e['id'] for e in entries})
    geo_marker = ' [in geography rules]' if in_geo else ''
    label_status = '✓' if not label_issues else '✗'
    summary = ', '.join(refs) if refs else ('-' if in_geo else 'NO ENTRY')
    print(f'{label:<14} entries={len(entries):>1} cat-refs={summary}{geo_marker} | label {label_status}')
    if label_issues:
        for li in label_issues: print(f'                {li}')
    if not entries and not in_geo:
        problems.append((r2, label, 'no maps.json entry AND no controller reference'))
    elif not entries:
        problems.append((r2, label, 'in controller geography rules only — not a catalogue card'))
    elif label_issues:
        problems.append((r2, label, '; '.join(label_issues)))
    else:
        ok += 1

print(f'\n== {ok}/{len(TARGETS)} cleanly wired ==')
if problems:
    print(f'\n== {len(problems)} concern(s) ==')
    for r2, label, note in problems:
        print(f'  - {label} ({r2}): {note}')
