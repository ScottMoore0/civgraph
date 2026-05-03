"""
Patch maps.json to reflect the 1949 split of NI_Admin_Areas_1937-1963.fgb.

Re-points the FGB URL for every admin-areas date that falls on or after
01 April 1949 (and before 1964) to the new post-1949 file. Repoints the
canonical pre-1949 entry to the new pre-1949 file. Promotes
admin-areas-1949-04-01 to its own canonical (drops cloneOf), and re-targets
the cloneOf chain for 1949–1963 dates accordingly.
"""
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / 'data' / 'database' / 'maps.json'

OLD_FGB_URL = 'https://data.civgraph.net/data/maps/local-government/NI_Admin_Areas_1937-1963.fgb'
PRE_1949_FGB = 'https://data.civgraph.net/data/maps/local-government/NI_Admin_Areas_1937-1948.fgb'
POST_1949_FGB = 'https://data.civgraph.net/data/maps/local-government/NI_Admin_Areas_1949-1963.fgb'
SPLIT_DATE = date(1949, 4, 1)

with PATH.open('r', encoding='utf-8') as f:
    data = json.load(f)

changes_pre = 0
changes_post = 0

for m in data['maps']:
    mid = m.get('id', '')
    if not mid.startswith('admin-areas-'):
        continue
    fgb = m.get('files', {}).get('fgb', '')
    if fgb != OLD_FGB_URL:
        continue
    d = m.get('date')
    try:
        d_obj = date.fromisoformat(d) if d else None
    except ValueError:
        d_obj = None
    if d_obj is None:
        continue
    if d_obj < SPLIT_DATE:
        m['files']['fgb'] = PRE_1949_FGB
        changes_pre += 1
    else:
        m['files']['fgb'] = POST_1949_FGB
        # 1949-04-01 becomes the canonical for the post-1949 era; everything
        # after in the same source clones from it.
        if mid == 'admin-areas-1949-04-01':
            m.pop('cloneOf', None)
        else:
            m['cloneOf'] = 'admin-areas-1949-04-01'
        changes_post += 1

with PATH.open('w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f'pre-1949 entries repointed:  {changes_pre}')
print(f'post-1949 entries repointed: {changes_post}')
