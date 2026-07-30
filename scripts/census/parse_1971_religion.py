#!/usr/bin/env python3
"""Recover 1971 religion COUNTS from the printed County Reports.

WHY. The repo's 1971 religion layer (religion-1971-lgd.csv) is the CAIN retabulation:
district percentages on a community-style basis, with no counts and no not-stated. That
is fine for mapping a share, but it cannot be put on the same footing as 1981 and 1991,
both of which are enumerated stated-religion with an explicit not-stated residual. To
compare like with like -- which is the whole point of the 1981 boycott question -- 1971
has to be available as counts in the same six categories the other two years use.

An earlier attempt recorded in HISTORICAL_RELIGION_1971_2021.md concluded the 1971 OCR was
"too corrupt to parse safely -- only 2 of ~7 area blocks validate". That verdict is
retained here as the thing to beat, not assumed: this script reports per-county pass/fail
against two independent oracles and emits only what passes.

STRUCTURE. The 1971 Census was published as seven County Reports (six counties plus
Belfast County Borough), each with its own TABLE 8 Religions covering that county and its
urban and rural districts. The categories are exactly 1981's: Population, Roman Catholic,
Presbyterian, Church of Ireland, Methodist, and a lumped 'Other and not stated'.

The OCR is column-wise, so each (category, sex) cell forms one contiguous run of numbers,
and the county total is the FIRST value of each run -- which is why county figures are
recoverable even where the district rows beneath them are damaged. Runs appear in a fixed
order, so they are identified by position, not by the surrounding labels: the labels are
themselves scrambled (the group header 'Population' is emitted after its own Persons
column, not before it).

TWO ORACLES, NEITHER FITTED
    Persons == Males + Females, for all six categories
    Population == RC + Presbyterian + Church of Ireland + Methodist + Other-and-not-stated
A county passes only if both hold. Six categories times two checks is a lot of ways to
fail, so a county that passes is very unlikely to have passed by accident.

NOT-STATED IS NOT SPLIT OUT HERE. Each report carries an 'Analysis of column headed
Other and not stated denominations', but the OCR breaks it into partial column groups of
14, 14 and 13 denominations, and the summary rows land in a later fragment. The lumped
Other-and-not-stated is emitted instead, and the split is handled at NI level in
scripts/census/build_religion_common_basis.py using the Registrar General's own printed
figure of 9.4% non-response in 1971.

Output: data/census/derived/religion-1971-counts.csv   (additive -- the CAIN
percentage layer in religion-1971-lgd.csv is left exactly as it is)
"""
import os, re, csv

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(REPO, 'data', 'census', 'census-1971.md')
OUT = os.path.join(REPO, 'data', 'census', 'derived', 'religion-1971-counts.csv')

CATS = ['population', 'roman_catholic', 'presbyterian', 'church_of_ireland',
        'methodist', 'other_notstated']
SEX = ['persons', 'males', 'females']


def clean(s):
    t = re.sub(r'[tli!]', '1', s.strip().strip("|!r' "))
    t = re.sub(r'[^0-9]', '', t)
    return int(t) if t else None


def is_num(s):
    t = s.strip()
    return bool(t) and bool(re.fullmatch(r"[0-9tli!|r,. ']+", t)) and any(c.isdigit() for c in t)


def runs_from(lines, start, limit=900):
    out, cur = [], []
    for k in range(start, min(start + limit, len(lines))):
        if is_num(lines[k]):
            v = clean(lines[k])
            if v is not None:
                cur.append(v)
                continue
        if cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


TITLE = re.compile(r'^(?:OF\s+)?(TYRONE|FERMANAGH|LONDONDERRY|ARMAGH|DOWN|ANTRIM|'
                   r'BELFAST COUNTY BOROUGH)\s*$')


def county_name(lines, start):
    """The report's title page, which is the nearest one ABOVE this TABLE 8.

    Scanned all the way back rather than over a fixed window, because the reports are
    long. 'OF LONDONDERRY' is matched explicitly: that title is split across two lines
    by the scan, so a pattern anchored on the county name alone silently attributes the
    Londonderry report to Tyrone, the previous report in the volume.
    """
    for k in range(start - 1, -1, -1):
        m = TITLE.match(lines[k].strip())
        if m:
            return m.group(1).title()
    return f'report@{start + 1}'


def triples(vals):
    """Group the runs into (persons, males, females) by the identity, not by position.

    Position fails: the number of scanner-noise runs between columns varies from report
    to report, so a fixed stride finds the right blocks in one report and garbage in the
    next. P == M + F is a property of the data and survives that.
    """
    out, i = [], 0
    while i + 2 < len(vals):
        a, b, c = vals[i], vals[i + 1], vals[i + 2]
        if a == b + c and a > 0:
            out.append((a, b, c))
            i += 3
        else:
            i += 1
    return out


def main():
    lines = open(SRC, encoding='utf-8').read().split('\n')
    starts = [i for i, s in enumerate(lines) if s.strip().startswith('TABLE 8 Religions')]
    print(f'  {len(starts)} county reports with a TABLE 8')

    rows, passed = [], 0
    for st in starts:
        rr = [r for r in runs_from(lines, st) if len(r) >= 5]
        name = county_name(lines, st)
        if len(rr) < 16:
            print(f'  {name:22} only {len(rr)} usable runs -- SKIP')
            continue
        n = len(rr[0])
        rec = {'area': name}
        # Where the label between two columns is lost, the scan merges them into one run
        # of 2n. Every column holds exactly n values (one per area in the report), so a
        # merged run is re-split on that stride and each piece contributes its own county
        # total. Without this, only the reports whose labels all survived can be read.
        cand = []
        for r in rr:
            for s in range(0, len(r), n):
                if len(r) - s >= 2:
                    cand.append(r[s])
        tri = triples(cand)
        if len(tri) < 5:
            print(f'  {name:22} only {len(tri)} category triples found -- SKIP')
            continue
        for ci, cat in enumerate(CATS[:5]):
            for si, sx in enumerate(SEX):
                rec[f'{cat}_{sx}'] = tri[ci][si]
        # The lumped Other-and-not-stated is laid out row-wise -- (persons, males,
        # females) per area in one long block -- so it is found by shape, as the first
        # wide run whose leading triple satisfies the same identity.
        oth = next((r for r in rr if len(r) >= 2.5 * n and r[0] == r[1] + r[2]), None)
        if oth is None:
            print(f'  {name:22} no other-and-not-stated block -- SKIP')
            continue
        for si, sx in enumerate(SEX):
            rec[f'other_notstated_{sx}'] = oth[si]

        # --- oracles
        sexok = all(rec[f'{c}_persons'] == rec[f'{c}_males'] + rec[f'{c}_females']
                    for c in CATS)
        partsum = sum(rec[f'{c}_persons'] for c in CATS[1:])
        sumok = partsum == rec['population_persons']
        rec['areas_in_report'] = n
        if sexok and sumok:
            passed += 1
            rows.append(rec)
            print(f"  {name:22} pop {rec['population_persons']:>9,}  "
                  f"RC {rec['roman_catholic_persons']:>9,}  "
                  f"other+NS {rec['other_notstated_persons']:>8,}   PASS")
        else:
            why = []
            if not sexok:
                why.append('P != M+F')
            if not sumok:
                why.append(f"parts {partsum:,} != pop {rec['population_persons']:,}")
            print(f'  {name:22} FAIL: {"; ".join(why)}')

    if not rows:
        raise SystemExit('  nothing validated')

    # A national row is emitted ONLY if every county validated. Summing a subset and
    # labelling it NORTHERN IRELAND would be a fabricated national total -- the single
    # most damaging thing this script could get wrong, because everything downstream
    # would treat it as the control.
    ni = None
    if passed == len(starts):
        ni = {'area': 'NORTHERN IRELAND', 'areas_in_report': ''}
        for c in CATS:
            for sx in SEX:
                ni[f'{c}_{sx}'] = sum(r[f'{c}_{sx}'] for r in rows)
        rows.append(ni)

    keys = ['area', 'areas_in_report'] + [f'{c}_{s}' for c in CATS for s in SEX]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=keys, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)

    print(f'\n  {passed} of {len(starts)} county reports validated')
    if ni:
        rc, pp = ni['roman_catholic_persons'], ni['population_persons']
        print(f"  NORTHERN IRELAND  population {pp:,}   Roman Catholic {rc:,} "
              f"({100*rc/pp:.1f}%)   other+not-stated {ni['other_notstated_persons']:,}")
    else:
        print('  NO national row written: it would be a partial sum masquerading as a '
              'control total.\n  This confirms the verdict already recorded in '
              'HISTORICAL_RELIGION_1971_2021.md -- the 1971\n  county-report OCR will not '
              'support a national reconstruction. NI-level 1971 figures\n  must come from '
              'the CAIN retabulation, which is why that layer is retained.')
    print(f'  wrote {OUT}')


if __name__ == '__main__':
    main()
