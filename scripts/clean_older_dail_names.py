"""
Strip seat-count "(N)" suffixes from older Dáil constituency names + rename
the matching JSON files. Also cleans up the lone leading-asterisk in 1922.

  Cork(2)                                  -> Cork           (1918)
  Dublin University(Trinity College)(2)    -> Dublin University(Trinity College)
  *Tipperary Mid, North & South            -> Tipperary Mid, North & South  (1922)

Idempotent.
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DAIL = os.path.join(ROOT, 'election-viewer-package', 'data', 'elections', 'dail-eireann')


def slugify(s):
    s = re.sub(r'[^\w\s-]', '', s.lower().strip())
    return re.sub(r'-+', '-', re.sub(r'\s+', '-', s))


REWRITES = {
    # date_dir: { old_name: new_name }
    '1918-12-14': {
        'Cork(2)': 'Cork',
        'Dublin University(Trinity College)(2)': 'Dublin University(Trinity College)',
    },
    '1922-06-16': {
        '*Tipperary Mid, North & South': 'Tipperary Mid, North & South',
    },
}


def apply():
    for date_dir, renames in REWRITES.items():
        d = os.path.join(DAIL, date_dir)
        idx_p = os.path.join(d, '_index.json')
        if not os.path.exists(idx_p):
            print(f'  WARN: {idx_p} not found')
            continue
        idx = json.load(open(idx_p, encoding='utf-8'))
        changed = False
        for c in idx:
            old = c['name']
            new = renames.get(old)
            if not new:
                continue
            old_slug = slugify(old)
            new_slug = slugify(new)
            old_file = os.path.join(d, f'{old_slug}.json')
            new_file = os.path.join(d, f'{new_slug}.json')
            if os.path.exists(old_file) and not os.path.exists(new_file):
                os.rename(old_file, new_file)
                print(f'  {date_dir}: renamed {old_slug}.json -> {new_slug}.json')
            c['name'] = new
            changed = True
            print(f'  {date_dir}: {old!r} -> {new!r}')
        if changed:
            json.dump(idx, open(idx_p, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)


if __name__ == '__main__':
    apply()
    print('done')
