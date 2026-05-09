"""Build LOD ladders for the 4 large grouped habitat layers separately.
These are slow due to high feature counts (woodland-grouped: 126k,
grassland-grouped: ~80k, etc.). Run after build_lod_smaller.py finishes.
"""
import sys
sys.path.insert(0, 'scripts')
from build_lod_ladders import process_one

URLS = [
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-grouped.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-grassland-grouped.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-wetland-grouped.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-woodland-grouped.fgb',
]

for i, url in enumerate(URLS, 1):
    print(f'[{i}/{len(URLS)}] {url}', flush=True)
    try:
        process_one(url)
    except Exception as e:
        print(f'  ! {e}', flush=True)
print('DONE grouped batch')
