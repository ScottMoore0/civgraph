"""
PR 1 of ROI election integration: wire Dáil Éireann into the live viewer.

What this does:
  1. Rename Dáil dirs to ISO dates (01dail-1918 -> 1918-12-14, 2024 -> 2024-11-29, ...).
     Skipped if dir already in ISO form.
  2. Fix the 2024 'Wicklow Wexford3' scraper bug (file + index entry).
  3. Build Dáil Éireann body entry and merge it into elections_index.json.

Idempotent. Safe to re-run.
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DAIL_DIR = os.path.join(ROOT, 'election-viewer-package', 'data', 'elections', 'dail-eireann')
MASTER_INDEX = os.path.join(ROOT, 'election-viewer-package', 'data', 'elections_index.json')

# Original dirname -> ISO election date.
DIR_TO_DATE = {
    '01dail-1918':    '1918-12-14',
    '02dail-1921':    '1921-05-24',
    '03dail-1922':    '1922-06-16',
    '04dail-1923':    '1923-08-27',
    '05dail-1927-jun':'1927-06-09',
    '06dail-1927-sep':'1927-09-15',
    '07dail-1932':    '1932-02-16',
    '08dail-1933':    '1933-01-24',
    '09dail-1937':    '1937-07-01',
    '10dail-1938':    '1938-06-17',
    '11dail-1943':    '1943-06-22',
    '12dail-1944':    '1944-05-30',
    '13dail-1948':    '1948-02-04',
    '14dail-1951':    '1951-05-30',
    '15dail-1954':    '1954-05-18',
    '16dail-1957':    '1957-03-05',
    '17dail-1961':    '1961-10-04',
    '18dail-1965':    '1965-04-07',
    '19dail-1969':    '1969-06-18',
    '2002':           '2002-05-17',
    '2007':           '2007-05-24',
    '2011':           '2011-02-25',
    '2016':           '2016-02-26',
    '2020':           '2020-02-08',
    '2024':           '2024-11-29',
}

ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def rename_dirs():
    for old, new in DIR_TO_DATE.items():
        old_path = os.path.join(DAIL_DIR, old)
        new_path = os.path.join(DAIL_DIR, new)
        if os.path.isdir(new_path):
            continue
        if not os.path.isdir(old_path):
            continue
        os.rename(old_path, new_path)
        print(f'  renamed {old} -> {new}')


def fix_2024_wicklow():
    d = os.path.join(DAIL_DIR, '2024-11-29')
    bad_file = os.path.join(d, 'wicklow-wexford3.json')
    good_file = os.path.join(d, 'wicklow-wexford.json')
    if os.path.exists(bad_file) and not os.path.exists(good_file):
        os.rename(bad_file, good_file)
        print('  renamed wicklow-wexford3.json -> wicklow-wexford.json')
    idx_path = os.path.join(d, '_index.json')
    if not os.path.exists(idx_path):
        return
    idx = json.load(open(idx_path, encoding='utf-8'))
    changed = False
    for c in idx:
        if c.get('name') == 'Wicklow Wexford3':
            c['name'] = 'Wicklow Wexford'
            changed = True
    if changed:
        json.dump(idx, open(idx_path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
        print(f'  fixed name in {idx_path}')


def build_dail_body():
    dates = []
    for entry in sorted(os.listdir(DAIL_DIR)):
        full = os.path.join(DAIL_DIR, entry)
        if not os.path.isdir(full):
            continue
        if not ISO_RE.match(entry):
            print(f'  WARN: skipping non-ISO dir {entry}', file=sys.stderr)
            continue
        idx_path = os.path.join(full, '_index.json')
        if not os.path.exists(idx_path):
            continue
        cons = json.load(open(idx_path, encoding='utf-8'))
        names = [c['name'] for c in cons]
        dates.append({'date': entry, 'constituencies': names})
    # Sort newest first to match existing convention.
    dates.sort(key=lambda d: d['date'], reverse=True)
    return {
        'name': 'Dáil Éireann',
        'slug': 'dail-eireann',
        'dates': dates,
    }


def merge_into_master(body_entry):
    master = json.load(open(MASTER_INDEX, encoding='utf-8'))
    bodies = master.get('bodies', [])
    # Replace if present.
    bodies = [b for b in bodies if b.get('name') != body_entry['name']]
    bodies.append(body_entry)
    master['bodies'] = bodies
    json.dump(master, open(MASTER_INDEX, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(f'  wrote {MASTER_INDEX} ({len(bodies)} bodies, {len(body_entry["dates"])} Dáil dates)')


def main():
    print('1. Renaming Dáil dirs to ISO dates')
    rename_dirs()
    print('2. Fixing 2024 Wicklow Wexford3 bug')
    fix_2024_wicklow()
    print('3. Building Dáil Éireann body entry')
    entry = build_dail_body()
    print('4. Merging into elections_index.json')
    merge_into_master(entry)
    print('done')


if __name__ == '__main__':
    main()
