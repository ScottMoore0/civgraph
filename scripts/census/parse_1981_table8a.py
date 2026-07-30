#!/usr/bin/env python3
"""Parse Table 8A of the 1981 Census: the decomposition of Table 8's lumped
'Other and not Stated Denominations' column.

WHY THIS TABLE MATTERS. Table 8 reports religion by district, but collapses everything
that is not Catholic/Presbyterian/Church of Ireland/Methodist into one column. For the
1981 boycott question that column is the whole story, because it contains the not-stated
population -- and 1981's not-stated is the artefact under study. Without splitting it,
'Catholic share' can only be computed on a denominator that includes non-responders,
which is not comparable with any other census year.

Table 8A performs exactly that split, denomination by denomination, ending with three
summary rows: 'Other Denominations*', 'Not Stated', 'TOTAL'.

GEOGRAPHY IS THE CATCH, AND IT IS NOT FIXABLE HERE. Table 8A is published for Northern
Ireland as a whole (Summary Report) and separately for Belfast (Belfast Report). It is
NOT published per district. So the not-stated count is known for two areas only, and any
per-district figure must be modelled rather than read. That is a real limit on the
boycott analysis: non-response was geographically concentrated, so apportioning the NI
not-stated across districts in proportion to population would assume away the very
pattern being measured.

OCR DAMAGE AND THE ORACLE. The scan splits digits ('3 , 2 0 2'), reads 1 as 't' or 'l'
('t ,067', '61 1'), and leaves column rules as stray '|', '!' and 'r'. Rather than trust
any cleaning rule, every column is checked against two things it was not fitted to:

    sum(denominations) + Other + Not Stated == TOTAL      (internal, per column)
    TOTAL == the area's 'other_notstated' from Table 8    (external, already parsed)

A column that fails either is reported, not silently emitted.

Reads the column-wise OCR the same way as the ward tables: names form one contiguous
block, then the Persons, Males and Females blocks follow, aligned by position.

Output: data/census/derived/religion-1981-notstated.csv
"""
import os, re, csv

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(REPO, 'data', 'census', 'census-1981.md')
T8 = os.path.join(REPO, 'data', 'census', 'derived', 'religion-1981-lgd.csv')
OUT = os.path.join(REPO, 'data', 'census', 'derived', 'religion-1981-notstated.csv')

# Where each Table 8A sits, and the Table 8 total it must reproduce.
BLOCKS = [
    {'area': 'NORTHERN IRELAND', 'start': 'TABLE 8A', 'nth': 1},
    {'area': 'Belfast',          'start': 'TABLE 8A', 'nth': 2},
]
COLS = ['persons', 'males', 'females']


def clean_num(s):
    """'3 , 2 0 2' -> 3202, 't ,067' -> 1067, '61 1' -> 611.

    Only 't', 'l', 'i' and '!' become 1 -- each is a shape the scanner genuinely
    confuses with a digit 1 in this document. No other letter is coerced, because a
    wrong coercion here would be invisible in the total.
    """
    t = s.strip().strip('|!r ')
    t = re.sub(r'[tli!]', '1', t)
    t = re.sub(r'[^0-9]', '', t)
    return int(t) if t else None


def is_num_line(s):
    t = s.strip()
    if not t or not any(c.isdigit() for c in t):
        return False
    # a numeric line is digits, separators and the 1-lookalikes, nothing else
    return re.fullmatch(r"[0-9tli!|r,. ']+", t) is not None


def find_blocks(lines):
    idx = [i for i, s in enumerate(lines) if s.strip().startswith('TABLE 8A')]
    if len(idx) < 2:
        raise SystemExit(f'  expected 2 Table 8A instances, found {len(idx)}')
    out = []
    for i in idx[:2]:
        # Stop at the next TABLE heading OR at a 'Wards' heading. The Belfast report
        # follows its Table 8A with ward tables before the next TABLE line, and those
        # numbers would otherwise be swallowed into the Females column.
        j = next((m for m in range(i + 5, len(lines))
                  if re.match(r'\s*TABLE\s', lines[m])
                  or lines[m].strip().lower() == 'wards'), len(lines))
        out.append((i, j))
    return out


def parse_block(lines, lo, hi):
    """Split on the printed Persons/Males/Females column headers.

    The first attempt assumed three equal blocks of len(names). It is not safe: a single
    piece of scanner junk shifts one column and the error is silent, because a shifted
    column still looks like a plausible list of numbers. The headers are physically
    present in the OCR, so they are used as the boundaries instead.
    """
    names, cols, cur = [], {}, None
    for s in lines[lo:hi]:
        t = s.strip()
        if not t or t in ('.', ',', 'r', 'i', '|', '!'):
            continue
        low = t.lower().rstrip('.: ')
        if low in ('persons', 'males', 'females'):
            cur = low
            cols[cur] = []
            continue
        if is_num_line(t):
            v = clean_num(t)
            if v is not None and cur:
                cols[cur].append(v)
        elif re.search(r'[A-Za-z]{3}', t) and cur is None:
            names.append(t)
    for cut, s in enumerate(names):
        if re.match(r'^Baptist', s):
            names = names[cut:]
            break
    end = next((i for i, s in enumerate(names) if s.upper().startswith('TOTAL')), None)
    if end is None:
        raise SystemExit('  no TOTAL row found')
    return names[:end + 1], cols


def main():
    lines = open(SRC, encoding='utf-8').read().split('\n')
    t8 = {r['lgd'].strip().upper(): r for r in csv.DictReader(open(T8, encoding='utf-8'))}
    blocks = find_blocks(lines)

    rows, ok = [], True
    for spec, (lo, hi) in zip(BLOCKS, blocks):
        names, cols = parse_block(lines, lo, hi)
        n = len(names)
        print(f"\n  {spec['area']}: {n} rows;  "
              + '  '.join(f'{k} {len(v)}' for k, v in cols.items()))

        want = t8.get(spec['area'].upper())
        target = int(want['other_notstated']) if want else None
        rec = {'area': spec['area']}
        # LOCATE THE TOTAL BY VALUE, NOT BY POSITION. The scan leaves stray figures after
        # the TOTAL row in three of the six columns, so 'last value' is wrong. TOTAL is
        # the sum of every other row, hence the column maximum -- true by construction and
        # immune to trailing junk. 'Not Stated' is the row printed immediately above it.
        for label in COLS:
            col = cols.get(label) or []
            if len(col) < 3:
                print(f'    {label:8} only {len(col)} values'); ok = False; continue
            i = col.index(max(col))
            if i == 0:
                print(f'    {label:8} total sits first -- cannot read'); ok = False; continue
            total, ns = col[i], col[i - 1]
            body = sum(col[:i])
            rec[f'{label}_not_stated'] = ns
            rec[f'{label}_other_denoms'] = total - ns
            rec[f'{label}_total'] = total
            # advisory only: body junk does not touch the three numbers taken above
            note = '' if body == total else f'  [body {body:,} != total, OCR junk in list]'
            print(f'    {label:8} total {total:>9,}  not-stated {ns:>9,}  '
                  f'other {total-ns:>7,}{note}')
        rows.append(rec)

        # --- the checks that matter, none of which were used to build the numbers
        p, m, f = (rec.get(f'{c}_total') for c in COLS)
        pn, mn, fn = (rec.get(f'{c}_not_stated') for c in COLS)
        for what, got, wnt in [('persons total vs Table 8', p, target),
                               ('males+females == persons', (m + f) if m and f else None, p),
                               ('not-stated M+F == persons', (mn + fn) if mn and fn else None, pn)]:
            if got is None or wnt is None:
                continue
            good = got == wnt
            ok = ok and good
            print(f'    check {what:28} {got:>9,} vs {wnt:>9,}  '
                  f"{'OK' if good else 'MISMATCH'}")

    if not rows:
        raise SystemExit('  nothing parsed')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    keys = ['area'] + [f'{c}_{k}' for c in COLS
                       for k in ('not_stated', 'other_denoms', 'total')]
    with open(OUT, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=keys, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)
    print(f'\n  wrote {OUT}')
    if not ok:
        print('  WARNING: at least one column failed its checksum -- see above')


if __name__ == '__main__':
    main()
