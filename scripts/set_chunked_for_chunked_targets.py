"""After scripts/build_chunks_generic.py + scripts/upload_chunks.mjs ship
chunks to R2, flip chunked:true on the targeted maps. Idempotent.
Verifies the {basename}-chunks.json index is reachable on R2 first.
"""
import json, subprocess
from urllib.parse import quote
from pathlib import Path

# Targets are point datasets only — chunking polygon datasets caused
# massive duplication (3 GB total) due to ogr2ogr -spat returning
# every polygon whose envelope overlaps the cell box. Point datasets
# are atomic, so each point lives in exactly one cell.
# Polygon layers (habitat-*, env-noise-*) rely on LOD0/LOD1 instead.
TARGETS = [
    'dfi-surface-defects-2008', 'dfi-surface-defects-2010',
    'dfi-surface-defects-2011', 'dfi-surface-defects-2012',
    'dfi-surface-defects-2013', 'dfi-surface-defects-2014',
    'dfi-surface-defects-2015', 'dfi-surface-defects-2016',
    'dfi-surface-defects-2017', 'dfi-surface-defects-2018',
    'dfi-surface-defects-2019', 'dfi-surface-defects-2020',
    'dfi-surface-defects-2021',
    'transport-carriageway-defects-2021',
]


def chunk_index_url(fgb_url: str, map_id: str) -> str:
    """Build the -chunks.json index URL the controller will look for —
    {dir}/{mapId}-chunks.json (NOT based on the FGB basename, which can
    differ from mapId for some maps)."""
    dir_url = fgb_url.rsplit('/', 1)[0] + '/'
    return f'{dir_url}{map_id}-chunks.json'


def remote_url_ok(url: str) -> bool:
    scheme, _, rest = url.partition('://')
    host, _, path = rest.partition('/')
    encoded = f"{scheme}://{host}/{quote(path, safe='/')}"
    r = subprocess.run(
        ['curl', '-sI', '-o', '/dev/null', '-w', '%{http_code}',
         '--max-time', '5', encoded],
        capture_output=True, text=True,
    )
    return r.stdout.strip() == '200'


p = Path('data/database/maps.json')
data = json.loads(p.read_text(encoding='utf-8'))
flipped, skipped = 0, 0
for m in data['maps']:
    if m['id'] not in TARGETS: continue
    fgb = m.get('files', {}).get('fgb', '')
    if not fgb: continue
    idx_url = chunk_index_url(fgb, m['id'])
    if not remote_url_ok(idx_url):
        print(f'  skip {m["id"]}: chunks index missing on R2')
        skipped += 1
        continue
    if not m.get('chunked'):
        m['chunked'] = True
        flipped += 1
        print(f'  set chunked:true on {m["id"]}')

p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'\nflipped {flipped}, skipped {skipped}')
