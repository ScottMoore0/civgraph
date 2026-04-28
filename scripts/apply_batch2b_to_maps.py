"""Apply Batch 2b (Dublin councils) entries to maps.json."""
import json
from pathlib import Path

MAPS = Path('data/database/maps.json')
RESULTS = Path(r'C:\tmp\integrate-batch2b\data\batch2b_results.json')

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
    if d['labelProperty']:
        entry['labelProperty'] = d['labelProperty']
    if d.get('orig_relpath'):
        ext = d.get('orig_ext', '').lstrip('.')
        if ext in ('geojson', 'gpkg', 'kml'):
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
