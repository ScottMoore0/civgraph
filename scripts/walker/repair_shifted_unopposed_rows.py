#!/usr/bin/env python3
"""Put the member's name back where it belongs in the 1885-1918 unopposed returns.

    python scripts/walker/repair_shifted_unopposed_rows.py [--write]

In the 1885-1918 Westminster files an unopposed return was harvested one column out: the
party ("Irish Parliamentary") sits in candidateName, Firstname and Surname ("Irish",
"Parliamentary"), the member's name in both vote fields, and Party_Name is empty. The
manifest has repaired this at build time (repairShiftedUnopposedRows in
build-test2-election-manifest.mjs), so the site showed the right man, but every other reader
of the files -- the Wikipedia person stamping above all -- saw a party where a name should be,
and none of these members carried a person key. The same rule is applied here to the files.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'house-of-commons-of-the-united-kingdom')


def repair(row):
    shifted = str(row.get('Total_Votes') or '').strip()
    if not shifted or re.fullmatch(r'[\d,.\s]+', shifted) or not re.search(r'[A-Za-z]{2}', shifted):
        return False
    if str(row.get('Candidate_First_Pref_Votes') or '').strip() != shifted:
        return False
    party = str(row.get('candidateName') or f"{row.get('Firstname') or ''} {row.get('Surname') or ''}").strip()
    member = re.sub(r'\s*\[[^\]]*\]', '', shifted).strip()      # "J. J. Shee [ n 1 ]"
    parts = member.split()
    row['Party_Name'] = row.get('Party_Name') or party
    row['candidateName'] = member
    row['Surname'] = parts[-1]
    row['Firstname'] = ' '.join(parts[:-1])
    row['Total_Votes'] = ''
    row['Candidate_First_Pref_Votes'] = ''
    row['unopposed'] = True
    return True


def main(write=False):
    rows = files = 0
    for path in sorted(glob.glob(os.path.join(SRC, '*', '*.json'))):
        doc = json.load(open(path, encoding='utf-8'))
        group = (doc.get('Constituency') or {}).get('countGroup') or []
        n = sum(1 for r in group if repair(r))
        if n:
            rows += n
            files += 1
            if write:
                with open(path, 'w', encoding='utf-8') as fh:
                    json.dump(doc, fh, indent=2, ensure_ascii=False)
                    fh.write('\n')
    print(f'{rows} rows in {files} files' + ('' if write else ' (dry run; --write to apply)'))


if __name__ == '__main__':
    main('--write' in sys.argv)
