#!/usr/bin/env python3
"""Parse ward-level population from the 1981 NI Census Preliminary Report OCR.

Source: data/census/census-1981.md, Table 4 ("Population 1971 and 1981"), which is the
most granular published geography of that census -- wards under the 26 District
Councils created in 1973. Enumeration districts (~3,000) existed as a collection unit
but are not a publication geography.

WHY THIS IS PARSEABLE AT ALL. The OCR read the page column-wise, so every ward NAME
appears in one block and the six numeric columns follow as separate blocks:

    NORTHERN IRELAND / Antrim District Council / Wards / Aldergrove / Balloo / ...
    1,536,065 / 33,998 / 2,186 / 2,471 / ...        <- 1971 Persons
    754,676 / 17,224 / 1,267 / 1,240 / ...          <- 1971 Males
    ...

Names and numbers are therefore aligned by POSITION, not by proximity, which means OCR
damage to a ward's spelling ('Baiioo', 'BaJlyrobin', 'The Mali') does not affect its
numbers. What would corrupt the result is a dropped or spurious numeric token shifting
the column, so every district is checksummed:

    sum(ward values) == district total     and     sum(district totals) == NI total

A district whose wards do not sum to its own printed total is REJECTED rather than
emitted. That is the whole safety argument for trusting this parse.

Output: data/census/derived/ward1972-census-1981.csv
"""
import os, re, sys, csv, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(REPO, 'data', 'census', 'census-1981.md')
OUT = os.path.join(REPO, 'data', 'census', 'derived')

# The NI-wide ward table lives in the Preliminary Report, the first of three reports
# concatenated in this file (Summary Report starts ~9822, Belfast LGD report ~68908).
LO, HI = 1500, 9820

COLS = ['pop_1971_persons', 'pop_1971_males', 'pop_1971_females',
        'pop_1981_persons', 'pop_1981_males', 'pop_1981_females']

NUMRE = re.compile(r'^[^0-9]{0,4}?([0-9][0-9,]*)[^0-9]{0,4}$')
DISTRICT = re.compile(r'^(.+?)\s+District\s+Council\s*$', re.I)
DROP = re.compile(r'^(wards?|northern ireland|table\s*\d*|persons|males|females|'
                  r'page\s*\d+|##.*|and\s*19\d\d|.?19\d\d.?|[^a-z0-9]*)$', re.I)


def numval(s):
    m = NUMRE.match(s.strip())
    if not m:
        return None
    try:
        return int(m.group(1).replace(',', ''))
    except ValueError:
        return None


def is_name(s):
    s = s.strip()
    return bool(s) and numval(s) is None and re.search(r'[A-Za-z]{3}', s)


def clean_name(s):
    s = re.sub(r'[.\s]+$', '', s.strip())
    s = re.sub(r'\s{2,}', ' ', s)
    return s.strip(" .,'^|!�_-")


def parse():
    lines = open(SRC, encoding='utf-8').read().split('\n')
    region = lines[LO:HI]

    # Page boundaries: a names block begins each page. Detect a run of >=6 name lines
    # after at least one number, and treat that as the start of a new page.
    pages, cur, seen_num = [], [], False
    run = 0
    for i, raw in enumerate(region):
        s = raw.strip()
        if not s:
            continue
        if is_name(s):
            run += 1
            if run >= 6 and seen_num:
                pages.append(cur)
                cur, seen_num, run = [], False, 1
        else:
            if numval(s) is not None:
                seen_num = True
            run = 0
        cur.append(s)
    if cur:
        pages.append(cur)

    rows, rejected, ni_totals = [], [], collections.Counter()
    for pno, page in enumerate(pages):
        # split into the leading names block and everything after
        names, nums, in_names = [], [], True
        for s in page:
            v = numval(s)
            if in_names:
                if v is not None and len(names) >= 3:
                    in_names = False
                    nums.append(v)
                elif is_name(s):
                    names.append(s)
            else:
                if v is not None:
                    nums.append(v)
        # the ordered entity sequence: NI (first page only), districts, wards
        ents = []
        for s in names:
            c = clean_name(s)
            if not c or DROP.match(c):
                continue
            d = DISTRICT.match(c)
            ents.append(('district', clean_name(d.group(1))) if d else ('ward', c))
        if len(ents) < 2 or not nums:
            continue
        n = len(ents) + (1 if pno == 0 else 0)   # page 1 leads with the NI row
        if len(nums) != n * len(COLS):
            rejected.append((pno, len(ents), len(nums), n * len(COLS), 'column count'))
            continue
        cols = [nums[k * n:(k + 1) * n] for k in range(len(COLS))]
        off = 0
        if pno == 0:
            for ci, c in enumerate(COLS):
                ni_totals[c] = cols[ci][0]
            off = 1
        # group into districts and checksum
        groups, gi = [], None
        for idx, (kind, name) in enumerate(ents):
            if kind == 'district':
                gi = {'district': name, 'idx': idx + off, 'wards': []}
                groups.append(gi)
            elif gi is not None:
                gi['wards'].append((idx + off, name))
        for g in groups:
            ok = True
            vals = {}
            for ci, c in enumerate(COLS):
                tot = cols[ci][g['idx']]
                wsum = sum(cols[ci][w] for w, _ in g['wards'])
                if g['wards'] and wsum != tot:
                    ok = False
                vals[c] = (tot, [cols[ci][w] for w, _ in g['wards']])
            if not ok or not g['wards']:
                rejected.append((pno, g['district'], len(g['wards']), 'checksum'))
                continue
            for j, (w, wname) in enumerate(g['wards']):
                rows.append({'district': g['district'], 'ward': wname,
                             **{c: vals[c][1][j] for c in COLS}})
    return rows, rejected, ni_totals, len(pages)


def main():
    rows, rejected, ni, npages = parse()
    print("=" * 76)
    print(f"1981 Census Table 4 (Preliminary Report) — ward-level population")
    print(f"  {npages} page blocks scanned")
    print(f"  {len(rows)} wards parsed and checksummed across "
          f"{len({r['district'] for r in rows})} districts")
    print(f"  {len(rejected)} rejections")
    for r in rejected[:12]:
        print(f"      {r}")
    if ni:
        print(f"\n  printed NI controls: " +
              "  ".join(f"{c.split('_',1)[1]} {ni[c]:,}" for c in COLS if ni[c]))
    if rows:
        for c in COLS:
            s = sum(r[c] for r in rows)
            ctl = ni.get(c)
            flag = '' if not ctl else (' MATCH' if s == ctl else f'  vs control {ctl:,}')
            print(f"    parsed sum {c:20} {s:10,}{flag}")
        os.makedirs(OUT, exist_ok=True)
        p = os.path.join(OUT, 'ward1972-census-1981.csv')
        with open(p, 'w', encoding='utf-8', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=['district', 'ward'] + COLS)
            w.writeheader()
            w.writerows(rows)
        print(f"\n  wrote {p}")


if __name__ == '__main__':
    main()
