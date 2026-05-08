"""Convert scraped Wikipedia per-constituency referendum tables (in
_tmp_ref/wiki_samples/) into per-constituency JSON files alongside the
existing aggregate `ireland.json` files in
election-viewer-package/data/elections/ireland-referendum/<date>-<slug>/.

Schema for each per-constituency file (e.g. dublin-central.json):
  {
    "body": "Referendum (Ireland)",
    "constituency": "Dublin Central",
    "topic": "Repeal of 8th Amendment",
    "yes": 31234, "no": 12345,
    "yes_pct": 71.6, "no_pct": 28.4,
    "electorate": 56789, "turnout_pct": 64.3,
    "counting_basis": "dail-constituencies",
    "source_url": "https://en.wikipedia.org/wiki/..."
  }

Also writes/refreshes a `_constituencies.json` in each event folder
listing the constituency rows for quick lookup by the viewer.
"""
from __future__ import annotations
import json, re
from pathlib import Path

SRC_DIR = Path('_tmp_ref/wiki_samples')
DST_BASE = Path('election-viewer-package/data/elections/ireland-referendum')


def slugify(s: str) -> str:
    s = re.sub(r'\s+', '-', s.strip().lower())
    s = re.sub(r'[^a-z0-9-]', '', s)
    return re.sub(r'-+', '-', s).strip('-')


def constituency_slug(name: str) -> str:
    """Match the slugify rules of the Dáil constituency files
    (e.g. 'Dún Laoghaire' -> 'dun-laoghaire', 'Carlow–Kilkenny' -> 'carlow-kilkenny').
    """
    # Replace en-dash and em-dash with hyphen for slug
    n = name.replace('–', '-').replace('—', '-')
    # Strip diacritics
    import unicodedata
    n = ''.join(c for c in unicodedata.normalize('NFD', n)
                if unicodedata.category(c) != 'Mn')
    return slugify(n)


def main():
    converted = 0
    written = 0
    for raw_path in sorted(SRC_DIR.glob('*.json')):
        if raw_path.name.startswith('_'):
            continue
        with open(raw_path, encoding='utf-8') as f:
            raw = json.load(f)
        date = raw['date']
        project_slug = raw['project_slug']
        topic = raw['topic']
        basis = raw.get('basis', 'dail-constituencies')
        url = raw.get('wikipedia_url')

        event_dir = DST_BASE / f'{date}-{project_slug}'
        if not event_dir.exists():
            print(f'! {raw_path.name}: event dir missing ({event_dir})')
            continue

        # Per-constituency files
        cons_summary = []
        for row in raw['rows']:
            cons_name = row.get('constituency')
            if not cons_name:
                continue
            cslug = constituency_slug(cons_name)
            out = {
                'body': 'Referendum (Ireland)',
                'constituency': cons_name,
                'topic': topic,
                'yes': row.get('yes'),
                'no': row.get('no'),
                'yes_pct': row.get('yes_pct'),
                'no_pct': row.get('no_pct'),
                'electorate': row.get('electorate'),
                'turnout_pct': row.get('turnout_pct'),
                'spoiled': row.get('spoiled'),
                'counting_basis': basis,
                'source_url': url,
            }
            (event_dir / f'{cslug}.json').write_text(
                json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8'
            )
            cons_summary.append({
                'slug': cslug,
                'name': cons_name,
                'yes_pct': row.get('yes_pct'),
                'no_pct': row.get('no_pct'),
            })
            written += 1
        # Index
        index = {
            'date': date,
            'topic': topic,
            'counting_basis': basis,
            'source': url,
            'constituencies': cons_summary,
        }
        (event_dir / '_constituencies.json').write_text(
            json.dumps(index, indent=2, ensure_ascii=False), encoding='utf-8'
        )
        print(f'  {raw_path.name}: {len(cons_summary)} constituencies -> {event_dir}')
        converted += 1
    print(f'\n=== {converted} events converted, {written} per-constituency files written ===')


if __name__ == '__main__':
    main()
