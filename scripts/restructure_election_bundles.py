#!/usr/bin/env python3
"""
Restructure election _bundle.json files to eliminate per-count candidate metadata duplication.

Original format: each countGroup row repeats all candidate fields (name, party, colour, etc.)
Compact format: candidate metadata stored once, count rows reference candidate by index.

Usage:
    python scripts/restructure_election_bundles.py [--dry-run]
"""

import json
import os
import sys
from pathlib import Path

ELECTIONS_DIR = Path(__file__).resolve().parent.parent / 'election-viewer-package' / 'data' / 'elections'

# Candidate-level fields (stored once per candidate, not per count)
CANDIDATE_FIELDS = [
    'Candidate_Id', 'Firstname', 'Surname', 'candidateName',
    'Party_Name', 'Deduplicated Party Name', 'Wikipedia Party Name',
    'Party_Colour', 'Constituency_Number'
]

# Count-level fields (vary per count row)
COUNT_FIELDS = [
    'Count_Number', 'Candidate_First_Pref_Votes', 'Transfers',
    'Total_Votes', 'Status', 'Occurred_On_Count'
]


def restructure_constituency(constituency_data):
    """Restructure a single constituency's data to compact format."""
    const_info = constituency_data.get('Constituency', {})
    count_group = const_info.get('countGroup', [])
    count_info = const_info.get('countInfo', {})

    if not count_group:
        return constituency_data  # Nothing to restructure

    # Build candidate index from unique Candidate_Id values
    candidate_map = {}  # Candidate_Id -> index
    candidates = []

    for row in count_group:
        cid = row.get('Candidate_Id', '')
        if cid not in candidate_map:
            candidate_map[cid] = len(candidates)
            candidate = {}
            for field in CANDIDATE_FIELDS:
                if field in row:
                    candidate[field] = row[field]
            candidates.append(candidate)

    # Build compact count rows: [candidateIndex, Count_Number, FirstPref, Transfers, Total, Status, OccurredOn]
    counts = []
    for row in count_group:
        cid = row.get('Candidate_Id', '')
        cidx = candidate_map.get(cid, 0)
        count_row = [cidx]
        for field in COUNT_FIELDS:
            count_row.append(row.get(field, ''))
        counts.append(count_row)

    return {
        'Constituency': {
            'countInfo': count_info,
            'candidates': candidates,
            'counts': counts,
            'countFields': COUNT_FIELDS
        }
    }


def restructure_bundle(bundle_data):
    """Restructure an entire bundle file."""
    result = {
        'format': 'compact-v2',
        'body': bundle_data.get('body', ''),
        'date': bundle_data.get('date', ''),
        'constituencies': {}
    }

    constituencies = bundle_data.get('constituencies', {})
    for name, data in constituencies.items():
        result['constituencies'][name] = restructure_constituency(data)

    return result


def main():
    dry_run = '--dry-run' in sys.argv
    total_original = 0
    total_compact = 0

    bundle_files = sorted(ELECTIONS_DIR.rglob('_bundle.json'))

    if not bundle_files:
        print('No _bundle.json files found.')
        return

    for bundle_path in bundle_files:
        original_size = bundle_path.stat().st_size

        with open(bundle_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        compact = restructure_bundle(data)
        compact_json = json.dumps(compact, separators=(',', ':'), ensure_ascii=False)
        compact_size = len(compact_json.encode('utf-8'))

        ratio = compact_size / original_size * 100 if original_size > 0 else 0
        rel_path = bundle_path.relative_to(ELECTIONS_DIR.parent.parent.parent)
        print(f'{rel_path}: {original_size:,} -> {compact_size:,} ({ratio:.1f}%)')

        total_original += original_size
        total_compact += compact_size

        if not dry_run:
            out_path = bundle_path.with_name('_bundle_v2.json')
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(compact_json)

    print(f'\n--- Summary ---')
    print(f'Bundles: {len(bundle_files)}')
    print(f'Total original:   {total_original:,} bytes ({total_original / 1024 / 1024:.1f} MB)')
    print(f'Total compact:    {total_compact:,} bytes ({total_compact / 1024 / 1024:.1f} MB)')
    if total_original > 0:
        print(f'Ratio: {total_compact / total_original * 100:.1f}%')


if __name__ == '__main__':
    main()
