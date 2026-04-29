"""
Register 9 ROI Local Authorities vintages (1966, 1977, 1980, 1985, 1986, 1994,
2002, 2008, 2014) in data/database/maps.json.

The 2008 + 2014 files have been replaced with versions that include Irish
translations (the existing 2014 entry stays; we add a 2008 entry that was
previously missing). The 7 historical vintages are brand-new layers.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS_JSON = ROOT / 'data' / 'database' / 'maps.json'

VINTAGES = [
    # (year_id, display_year_label, full_iso_date, name_suffix)
    ('1966', '1966', '1966-01-01', 'Local Authorities 1966'),
    ('1977', '1977', '1977-01-01', 'Local Authorities 1977'),
    ('1980', '1980', '1980-01-01', 'Local Authorities 1980'),
    ('1985', '1985', '1985-01-01', 'Local Authorities 1985'),
    ('1986', '1986', '1986-01-01', 'Local Authorities 1986'),
    ('1994', '1994', '1994-01-01', 'Local Authorities 1994'),
    ('2002', '2002', '2002-01-01', 'Local Authorities 2002'),
    ('2008', '2008', '2008-01-01', 'Local Authorities 2008'),
]


def make_entry(year, name, date):
    return {
        'id': f'roi-local-authorities-{year}',
        'name': name,
        'slug': f'roi-local-authorities-{year}',
        'category': 'local-government',
        'date': date,
        'provider': ['Phelim Birch', 'Paddy Matthews'],
        'files': {
            'fgb': f'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_{year}.fgb'
        },
        'style': {
            'color': '#4A90D9',
            'weight': 2
        },
        'keywords': [
            'local authorities',
            'republic of ireland',
            'ireland',
            'council',
            'county council',
            'city council',
            year,
            'historical',
        ],
        'labelProperty': 'ENGLISH',
        'useLOD': True,
    }


def main():
    m = json.loads(MAPS_JSON.read_text(encoding='utf-8'))

    classes = m['classes']
    parent = next(c for c in classes if c.get('id') == 'roi-local-authorities')

    # Top-level maps list
    maps_list = m['maps']
    existing_ids = {x['id'] for x in maps_list}

    new_ids = []
    for year, label, date, name in VINTAGES:
        eid = f'roi-local-authorities-{year}'
        new_ids.append(eid)
        if eid in existing_ids:
            print(f'  skip existing {eid}')
            continue
        entry = make_entry(year, name, date)
        maps_list.append(entry)
        existing_ids.add(eid)
        print(f'  added {eid}')

    # Update parent class maps[] (keep newest first, then 2014 + new ones)
    desired_order = [
        'roi-local-authorities-2024',  # 2019 boundaries (legacy id)
        'roi-local-authorities-2014',
        'roi-local-authorities-2008',
        'roi-local-authorities-2002',
        'roi-local-authorities-1994',
        'roi-local-authorities-1986',
        'roi-local-authorities-1985',
        'roi-local-authorities-1980',
        'roi-local-authorities-1977',
        'roi-local-authorities-1966',
    ]
    parent['maps'] = [mid for mid in desired_order if mid in {x['id'] for x in maps_list}]
    print(f'  parent class roi-local-authorities now lists {len(parent["maps"])} maps')

    MAPS_JSON.write_text(json.dumps(m, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('done')


if __name__ == '__main__':
    main()
