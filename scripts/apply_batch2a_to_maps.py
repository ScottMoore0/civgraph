"""Apply Batch 2a entries (planning + TII) to maps.json.
Special-cases the planning-applications entry to point at the overview FGB
for primary load (24 MB, 19,738 features) and the full FGB as download.
"""
import json
from pathlib import Path

MAPS = Path('data/database/maps.json')
RESULTS = Path(r'C:\tmp\integrate-batch2a\data\batch2a_results.json')

with open(RESULTS, 'r') as f:
    batch = json.load(f)
with open(MAPS, 'r', encoding='utf-8') as f:
    maps_data = json.load(f)

existing_ids = {m['id'] for m in maps_data['maps']}
added = 0

for d in batch:
    if d['slug'] in existing_ids:
        continue
    fgb_url = f'https://data.civgraph.net/data/maps/{d["fgb_relpath"]}'
    entry = {
        'id': d['slug'],
        'name': d['name'],
        'slug': d['slug'],
        'category': d['category'],
        'provider': d['provider'],
        'files': {
            'fgb': fgb_url,
        },
        'style': {
            'color': d['color'],
            'weight': 1,
            'fillOpacity': 0.4,
        },
        'keywords': d['keywords'],
        'description': d['description'],
        'references': [
            {
                'label': 'Source — data.gov.ie',
                'url': 'https://data.gov.ie/',
                'note': '',
            },
        ],
    }
    if d['date']:
        entry['date'] = d['date']
    if d['label']:
        entry['labelProperty'] = d['label']

    # Special: the giant planning-apps entry points at the overview for primary load
    if d['slug'] == 'roi-national-planning-applications':
        entry['files']['fgb'] = 'https://data.civgraph.net/data/maps/roi-planning/roi-national-planning-applications-overview.fgb'
        entry['files']['downloads'] = {
            'geojson': 'https://data.civgraph.net/data/maps/roi-planning/roi-national-planning-applications.geojson',
            'fgb_full': 'https://data.civgraph.net/data/maps/roi-planning/roi-national-planning-applications.fgb',
        }
        entry['description'] = ('All-Ireland planning applications — point map of decisions. '
                                'Loaded as a 19,738-point overview (1-in-25 sample) for performance; '
                                'full 493,439-feature dataset available for download (596 MB FGB / source GeoJSON).')
        entry['note'] = 'Map preview is a 1-in-25 sample for fast loading; download the full dataset for analysis.'
    elif d.get('orig_relpath'):
        ext = Path(d['orig_relpath']).suffix.lstrip('.')
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
