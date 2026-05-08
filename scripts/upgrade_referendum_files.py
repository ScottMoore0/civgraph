"""Upgrade existing per-constituency referendum JSONs in
election-viewer-package/data/elections/ireland-referendum/<event>/<cons>.json
to the format the controller's _normaliseScraperPayload expects:

  - move flat electorate/turnout_pct/spoiled into a `meta` object
  - add `outcome` ('yes' or 'no')
  - add `candidates: [Yes, No]` with first_pref vote counts, so the
    existing scraper-payload normaliser produces a Constituency.countGroup
    that the per-constituency colouring path can read.

Idempotent: running twice is safe (skips files already upgraded).
"""
from __future__ import annotations
import json
from pathlib import Path

BASE = Path('election-viewer-package/data/elections/ireland-referendum')


def upgrade(d: dict) -> dict | None:
    """Return upgraded dict, or None if nothing to do."""
    # Only upgrade per-constituency files written by the scraper. Those have
    # a non-empty `constituency` string and a `counting_basis` field.
    cons = d.get('constituency')
    if not cons or cons == 'Ireland':
        return None
    if 'counting_basis' not in d:
        return None
    # Already upgraded?
    if isinstance(d.get('candidates'), list) and 'meta' in d and 'outcome' in d:
        return None
    yes = d.get('yes') or 0
    no = d.get('no') or 0
    yes_pct = d.get('yes_pct')
    no_pct = d.get('no_pct')
    if yes_pct is None and (yes + no) > 0:
        yes_pct = round(100.0 * yes / (yes + no), 2)
    if no_pct is None and yes_pct is not None:
        no_pct = round(100.0 - yes_pct, 2)
    outcome = 'yes' if (yes_pct or 0) >= 50 else 'no'
    out = {
        'body': d.get('body', 'Referendum (Ireland)'),
        'constituency': d.get('constituency'),
        'topic': d.get('topic'),
        'meta': {
            'electorate': d.get('electorate'),
            'turnout_pct': d.get('turnout_pct'),
            'spoiled': d.get('spoiled'),
        },
        'yes': yes, 'no': no,
        'yes_pct': yes_pct, 'no_pct': no_pct,
        'outcome': outcome,
        'counting_basis': d.get('counting_basis', 'dail-constituencies'),
        'source_url': d.get('source_url'),
        'candidates': [
            {'name': 'Yes', 'party': 'Yes',
             'first_pref': yes, 'final_count': 1,
             'counts': [yes],
             'status': 'Made Quota' if outcome == 'yes' else 'Not Elected'},
            {'name': 'No', 'party': 'No',
             'first_pref': no, 'final_count': 1,
             'counts': [no],
             'status': 'Made Quota' if outcome == 'no' else 'Not Elected'},
        ],
    }
    return out


def main():
    upgraded = 0
    skipped = 0
    for event_dir in sorted(BASE.iterdir()):
        if not event_dir.is_dir():
            continue
        for f in sorted(event_dir.glob('*.json')):
            if f.name.startswith('_'):
                continue
            with open(f, encoding='utf-8') as fh:
                d = json.load(fh)
            new_d = upgrade(d)
            if new_d is None:
                skipped += 1
                continue
            with open(f, 'w', encoding='utf-8') as fh:
                json.dump(new_d, fh, indent=2, ensure_ascii=False)
            upgraded += 1
    print(f'upgraded {upgraded}, skipped (already-correct or aggregate) {skipped}')


if __name__ == '__main__':
    main()
