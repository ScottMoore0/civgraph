"""
Add Belfast and Derry City & Strabane LGD entries to elections_index.json
for the 2014, 2019 and 2023 NI local-government elections.

The DEA-level data already exists in
  election-viewer-package/data/elections/local-government/{date}/_aggregates.json
and individual DEA JSON files are present too. Only the index that the
election viewer uses to build the council picker is missing both
councils.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / 'election-viewer-package' / 'data' / 'elections_index.json'
LG_DIR = ROOT / 'election-viewer-package' / 'data' / 'elections' / 'local-government'

DATES = ['2014-05-22', '2019-05-02', '2023-05-18']
COUNCILS = ['Belfast', 'Derry City and Strabane']

with INDEX.open('r', encoding='utf-8') as f:
    index = json.load(f)

# Find the Antrim and Newtownabbey body to mirror its shape exactly.
template = next(b for b in index['bodies'] if b.get('name') == 'Antrim and Newtownabbey')

# Detect existing entries (in case re-running) so we don't duplicate.
existing_lg_2014plus = {
    b.get('name') for b in index['bodies']
    if b.get('slug') == 'local-government'
    and any(d.get('date') in DATES for d in (b.get('dates') or []))
}
print('Existing post-2014 LG bodies:', sorted(existing_lg_2014plus))

added = 0
for council in COUNCILS:
    if council in existing_lg_2014plus:
        print(f'  {council!r} already present — skipping')
        continue
    dates_payload = []
    for d in DATES:
        agg_path = LG_DIR / d / '_aggregates.json'
        agg = json.loads(agg_path.read_text(encoding='utf-8'))
        cs = agg['councils'].get(council, {}).get('constituencies') or []
        if not cs:
            print(f'  WARN: no DEAs for {council} on {d}')
            continue
        dates_payload.append({'date': d, 'constituencies': cs})
    body = {
        'name': council,
        'slug': 'local-government',
        'bodyGroup': template.get('bodyGroup', 'local-government'),
        'dates': dates_payload,
    }
    index['bodies'].append(body)
    added += 1
    print(f'  Added {council!r}: {len(dates_payload)} dates')

with INDEX.open('w', encoding='utf-8') as f:
    json.dump(index, f, indent=2, ensure_ascii=False)

print(f'\n{added} bodies added; bodies now total {len(index["bodies"])}.')
