"""After scripts/build_lod_ladders.py + scripts/upload_lod_ladders.mjs
have shipped LODs to R2, flip the corresponding maps' useLOD field
back to true in maps.json so the loader uses the simplified files at
low zoom. Idempotent.
"""
import json
from pathlib import Path

# IDs that scripts/build_lod_ladders.py targets. Keep in sync with
# DEFAULT_TARGETS there.
TARGETS = [
    'habitat-coastal-grouped', 'habitat-woodland-grouped',
    'habitat-grassland-grouped', 'habitat-wetland-grouped',
    'habitat-bog', 'habitat-deciduous-woodland',
    'habitat-ancient-semi-natural-woodland', 'habitat-fen',
    'habitat-heath', 'habitat-lake', 'habitat-pond', 'habitat-river',
    'habitat-reedbed', 'habitat-acid-grassland',
    'habitat-calcareous-grassland', 'habitat-lowland-meadow',
    'habitat-purple-moor-grass', 'habitat-traditional-orchard',
    'habitat-wood-pasture-parkland', 'habitat-coastal-sand-dune',
    'habitat-coastal-saltmarsh', 'habitat-coastal-vegetated-shingle',
    'habitat-maritime-cliff-slope', 'habitat-limestone-pavement',
    'dfi-pothole-enquiries-2014', 'dfi-pothole-enquiries-2015',
    'dfi-pothole-enquiries-2016', 'dfi-pothole-enquiries-2017',
    'dfi-pothole-enquiries-2018', 'dfi-pothole-enquiries-2019',
    'dfi-pothole-enquiries-2020', 'dfi-pothole-enquiries-2021',
    'dfi-surface-defects-2008', 'dfi-surface-defects-2010',
    'dfi-surface-defects-2011', 'dfi-surface-defects-2012',
    'dfi-surface-defects-2013', 'dfi-surface-defects-2014',
    'dfi-surface-defects-2015', 'dfi-surface-defects-2016',
    'dfi-surface-defects-2017', 'dfi-surface-defects-2018',
    'dfi-surface-defects-2019', 'dfi-surface-defects-2020',
    'dfi-surface-defects-2021',
]

import subprocess

def lod_exists_on_r2(fgb_url: str) -> bool:
    """HEAD-check the -lod0 variant. We require both -lod0 and -lod1 to
    consider the LOD ladder valid; checking just -lod0 is a fast proxy."""
    base = fgb_url[:-4]  # strip .fgb
    for suf in ('-lod0', '-lod1'):
        r = subprocess.run(
            ['curl', '-sI', '-o', '/dev/null', '-w', '%{http_code}',
             '--max-time', '5', f'{base}{suf}.fgb'],
            capture_output=True, text=True,
        )
        if r.stdout.strip() != '200':
            return False
    return True


p = Path('data/database/maps.json')
data = json.loads(p.read_text(encoding='utf-8'))
flipped = 0
skipped = 0
for m in data['maps']:
    if m['id'] not in TARGETS:
        continue
    fgb = m.get('files', {}).get('fgb', '')
    if not fgb:
        continue
    if not lod_exists_on_r2(fgb):
        print(f'  skip {m["id"]}: LOD missing on R2')
        skipped += 1
        continue
    if not m.get('useLOD'):
        m['useLOD'] = True
        flipped += 1
        print(f'  set useLOD:true on {m["id"]}')
p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'\nflipped {flipped}, skipped (LOD missing) {skipped}')
