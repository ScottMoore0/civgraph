#!/usr/bin/env python3
"""Register the 1981 ward populations as data entries against the 1972 ward layer.

Three entries: 1971 population, 1981 population, and the change between them. The two
counts deliberately share one logarithmic domain so the maps are directly comparable --
that comparison is the whole point of carrying both years.

JOIN KEY IS W72_ID, NOT NAME. The published layer's NAME is not unique (27 features sit
in duplicated-name groups; CENTRAL occurs five times) and OBJECTID is worse. W72_ID is
written onto the layer by build_ward1972_pop_layer.py, which must run first, and which
also emits the CSV keyed the same way.

THE ENTRIES DEPEND ON A LAYER THAT IS NOT YET PUBLISHED. W72_ID exists only in the staged
copies. Until those are uploaded, the live layer has no such property, and the loader's
recolourFeature() returns silently on a miss -- so the entries would render an
uncoloured map rather than an error. Upload is approval-gated, so this is stated rather
than worked around.

Source is the printed report; no URL is set because none is recorded in the repo for it
and the loader renders a title without a link perfectly well. Inventing a plausible
NISRA URL would be worse than omitting it.

Idempotent: entries with these ids are replaced, not duplicated.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
STORE = REPO / 'data' / 'database' / 'data-entries.json'
CSV = 'data/census/derived/ward1972-pop-1981.csv'
GEOG = 'wards-1972'
SOURCE = {'title': 'The Northern Ireland Census 1981, Preliminary Report, Tables 4 and 5 '
                   '(Registrar General Northern Ireland, HMSO)'}

TABLE = ['Geography', 'District', 'pop_1971_persons', 'pop_1981_persons', 'pop_change_pct']
PROV = ('Ward populations were transcribed from the printed report by OCR and recovered '
        'column-wise; the 526 ward figures sum to the published Northern Ireland totals '
        'of 1,536,065 (1971) and 1,490,228 (1981) exactly. Twelve cells were corrected, '
        'nine of them read directly off the page scan.')
LOD = ('At the coarsest zoom the layer draws a 500-feature simplified copy, so the 26 '
       'smallest wards are uncoloured until you zoom in.')

ENTRIES = [
    {
        'slug': 'population-1981',
        'name': 'Usual resident population (Census 1981, by 1972 Ward)',
        'valueColumn': 'pop_1981_persons',
        'ramp': 'viridis',
        'domain': [500, 10000],
        'logarithmic': True,
        'headline': 'Population of each 1972 ward at the 1981 Census',
        'keywords': ['1981', 'population', 'ward', '1972'],
    },
    {
        'slug': 'population-1971',
        'name': 'Usual resident population (Census 1971, by 1972 Ward)',
        'valueColumn': 'pop_1971_persons',
        'ramp': 'viridis',
        'domain': [500, 10000],
        'logarithmic': True,
        'headline': 'Population of each 1972 ward at the 1971 Census, as reprinted in the '
                    '1981 report for comparison',
        'keywords': ['1971', 'population', 'ward', '1972'],
    },
    {
        'slug': 'population-change-1971-1981',
        'name': 'Population change 1971-1981 (by 1972 Ward)',
        'valueColumn': 'pop_change_pct',
        'ramp': 'plasma',
        'domain': [-50, 50],
        'logarithmic': False,
        'headline': 'Percentage change in each 1972 ward between the 1971 and 1981 '
                    'Censuses. 298 of the 526 wards lost population',
        'keywords': ['population change', 'ward', '1972', '1971', '1981'],
        'extra': ('The range runs from -73% to +264%, so the ramp is clipped at plus or '
                  'minus 50% to keep the middle legible; the table panel gives each '
                  'ward\'s exact figure.'),
    },
]


def build(e):
    eid = f"data-{e['slug']}-ward1972"
    desc = ' '.join(x for x in [e['headline'] + '.', e.get('extra'), PROV, LOD] if x)
    return {
        'id': eid,
        'type': 'data-entry',
        'name': e['name'],
        'slug': eid,
        'category': 'data-population',
        'description': desc,
        'geography': GEOG,
        'csv': CSV,
        'joinKey': 'W72_ID',
        'csvKeyColumn': 'W72_ID',
        'valueColumn': e['valueColumn'],
        'ramp': e['ramp'],
        'domain': e['domain'],
        'logarithmic': e['logarithmic'],
        'tableColumns': TABLE,
        'keywords': ['census', 'historic', 'nisra', 'data'] + e['keywords'],
        'source': SOURCE,
    }


def main():
    db = json.loads(STORE.read_text(encoding='utf-8'))
    entries = db.get('dataEntries', [])
    new = [build(e) for e in ENTRIES]
    ids = {e['id'] for e in new}
    kept = [e for e in entries if e.get('id') not in ids]
    db['dataEntries'] = kept + new
    # The store is minified and has no trailing newline; match it so the diff is the
    # three added entries and nothing else.
    STORE.write_text(json.dumps(db, ensure_ascii=False, separators=(',', ':')),
                     encoding='utf-8')
    print(f"  {len(entries)} entries -> {len(db['dataEntries'])} "
          f"({len(new)} written, {len(entries) - len(kept)} replaced)")
    for e in new:
        print(f"    {e['id']:44} {e['valueColumn']}")


if __name__ == '__main__':
    main()
