"""Apply Batch 3 entries (DfI roads, NIEA water, Translink routes, more) to maps.json."""
import json
from pathlib import Path

MAPS = Path('data/database/maps.json')
RESULTS = Path(r'C:\tmp\integrate-batch3\data\batch3_results.json')

with open(RESULTS, 'r') as f:
    batch = json.load(f)

# Manually add the two bus-route entries that were generated separately after
# the batch script (since they needed special MIF handling)
batch.extend([
    {
        'subdir': 'transport-translink',
        'slug': 'translink-metro-glider-routes',
        'name': 'Belfast Metro & Glider Bus Routes',
        'category': 'transport',
        'provider': ['Translink'],
        'keywords': ['translink', 'bus', 'metro', 'glider', 'belfast', 'transit', 'routes'],
        'color': '#E65100', 'date': '2025-09-23',
        'description': 'Belfast Metro and Glider bus route geometries (PtLinks network) — Translink internal data network format converted to FGB.',
        'feature_count': 6758,
        'fgb_relpath': 'transport-translink/translink-metro-glider-routes.fgb',
        'orig_relpath': 'transport-translink/translink-metro-glider-routes.zip',
        'orig_ext': '.zip',
        'label': None,
    },
    {
        'subdir': 'transport-translink',
        'slug': 'translink-ulsterbus-goldliner-routes',
        'name': 'Ulsterbus & Goldliner Bus Routes',
        'category': 'transport',
        'provider': ['Translink'],
        'keywords': ['translink', 'bus', 'ulsterbus', 'goldliner', 'transit', 'routes', 'NI'],
        'color': '#FFA000', 'date': '2025-09-23',
        'description': 'Ulsterbus and Goldliner inter-urban bus route geometries — Translink network data converted to FGB.',
        'feature_count': 31155,
        'fgb_relpath': 'transport-translink/translink-ulsterbus-goldliner-routes.fgb',
        'orig_relpath': 'transport-translink/translink-ulsterbus-goldliner-routes.zip',
        'orig_ext': '.zip',
        'label': None,
    },
])

with open(MAPS, 'r', encoding='utf-8') as f:
    maps_data = json.load(f)

existing_ids = {m['id'] for m in maps_data['maps']}
added = 0

for d in batch:
    if d['slug'] in existing_ids:
        print(f'  ! skip {d["slug"]} (already exists)')
        continue
    fgb_url = f'https://data.civgraph.net/data/maps/{d["fgb_relpath"]}'
    entry = {
        'id': d['slug'],
        'name': d['name'],
        'slug': d['slug'],
        'category': d['category'],
        'provider': d['provider'],
        'files': {'fgb': fgb_url},
        'style': {
            'color': d['color'],
            'weight': 1,
            'fillOpacity': 0.4,
        },
        'keywords': d['keywords'],
        'description': d['description'],
        'references': [{'label': 'Source — admin.opendatani.gov.uk', 'url': 'https://admin.opendatani.gov.uk/', 'note': ''}],
    }
    if d.get('date'):
        entry['date'] = d['date']
    if d.get('label'):
        entry['labelProperty'] = d['label']
    if d.get('orig_relpath'):
        ext = d.get('orig_ext', '').lstrip('.').lower()
        if ext in ('geojson', 'gpkg', 'kml', 'zip'):
            orig_url = f'https://data.civgraph.net/data/maps/{d["orig_relpath"]}'
            entry['files']['downloads'] = {ext: orig_url}
            if ext == 'geojson':
                entry['files']['geojson'] = orig_url
    maps_data['maps'].append(entry)
    added += 1

print(f'Added {added} new map entries.')
with open(MAPS, 'w', encoding='utf-8') as f:
    json.dump(maps_data, f, indent=2, ensure_ascii=False)
print(f'Wrote {MAPS}')
