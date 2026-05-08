"""Walk every <event> folder under
election-viewer-package/data/elections/ireland-referendum/ that has a
_constituencies.json file (per-constituency referendum data exists),
and update the master elections_index.json so the corresponding
'Referendum (Ireland)' date entry lists the actual constituency names
instead of the placeholder ['Ireland'].

Idempotent.
"""
from __future__ import annotations
import json
from pathlib import Path

INDEX = Path('election-viewer-package/data/elections_index.json')
EVENTS = Path('election-viewer-package/data/elections/ireland-referendum')


def main():
    with open(INDEX, encoding='utf-8') as f:
        idx = json.load(f)
    bodies = idx if isinstance(idx, list) else idx.get('bodies', [])
    body = next((b for b in bodies if b.get('name') == 'Referendum (Ireland)'), None)
    if body is None:
        raise SystemExit('Referendum (Ireland) body not found in elections_index.json')

    # Build map: composite-date-slug -> [list of constituency names]
    cons_by_event = {}
    for evt_dir in sorted(EVENTS.iterdir()):
        if not evt_dir.is_dir():
            continue
        cons_index = evt_dir / '_constituencies.json'
        if not cons_index.exists():
            continue
        with open(cons_index, encoding='utf-8') as f:
            ci = json.load(f)
        names = [c['name'] for c in ci.get('constituencies', []) if c.get('name')]
        if names:
            cons_by_event[evt_dir.name] = names

    updated = 0
    for date_entry in body.get('dates', []):
        composite = date_entry.get('date')  # e.g. "2018-05-25-regulation-of-..."
        names = cons_by_event.get(composite)
        if not names:
            continue
        if date_entry.get('constituencies') != names:
            date_entry['constituencies'] = names
            updated += 1
            print(f'  {composite}: {len(names)} constituencies')

    with open(INDEX, 'w', encoding='utf-8') as f:
        json.dump(idx, f, indent=2, ensure_ascii=False)
    print(f'\nupdated {updated} referendum date entries in {INDEX}')


if __name__ == '__main__':
    main()
