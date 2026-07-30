#!/usr/bin/env python3
"""Put 1971, 1981 and 1991 Catholic share on one explicit basis, and quantify 1981's gap.

Three censuses, three different constructs, which is why the raw series appears to show
the Catholic population falling by nine points in the 1970s and rising by ten in the
1980s -- a movement no demography produces:

    1971  CAIN retabulation, community-style: the not-stated have already been allocated
    1981  enumerated STATED religion, with 18.5% not stated (274,584 people)
    1991  enumerated STATED religion, with 7.3% not stated (114,827 people)

THE BASIS THAT MAKES THEM COMPARABLE. Catholic as a share of those who stated a religion:

    stated_pct = Roman Catholic / (population - not stated)

This is also, exactly, the pro-rata community basis: allocating the not-stated in
proportion to the stated shares leaves the share unchanged, so the two are the same
number. That matters, because pro-rata is the neutral allocation -- the one that assumes
non-responders looked like responders. Whatever 1981's gap survives on this basis cannot
be explained away as an artefact of how the not-stated were handled.

WHAT THIS BUYS, AND WHAT IT COSTS
The raw denominator makes 1981 look like a collapse. On the stated basis 1981 rises from
28.0% to 34.3% -- most of the apparent collapse was the denominator, not the population.
A real gap remains, and that gap is the boycott.

The residual is reported as the CATHOLIC SHARE OF THE NOT-STATED POOL required to
reconcile 1981 with the 1971-1991 path, rather than as a raw count. That quantity is
bounded in [0, 100%], so the method can falsify itself: a figure above 100% would mean
non-response alone cannot explain the gap. A raw count has no such discipline.

TWO LIMITS, BOTH STRUCTURAL
  1981 not-stated is published for NORTHERN IRELAND AND BELFAST ONLY -- Table 8 lumps
  'Other and not stated' by district and Table 8A splits it only for those two areas. So
  the stated basis is computable for two areas, not twenty-six. Districts are emitted
  with the raw basis and an explicit blank, never an apportioned guess: non-response was
  geographically concentrated, so splitting the NI total pro rata across districts would
  erase the very pattern the exercise is trying to measure.

  1971 is CAIN's community-style retabulation, not a stated-religion count from the
  census. Its allocation method is CAIN's, not pro-rata, so the 1971 endpoint is on a
  neighbouring basis rather than an identical one. The 1971 County Report OCR would fix
  this but does not survive parsing (see parse_1971_religion.py: 1 of 7 counties).

NON-ENUMERATION IS SEPARATE AND IS NOT FOLDED IN. The Registrar General put the
population effect of 1981 non-returns at 19,664 -- people missed entirely, as against the
274,584 who were counted but left the religion question blank. The two are different
failures of different sizes; the first is reported alongside, never merged into the
second.

Inputs (all retained, none replaced):
    religion-1971-lgd.csv        CAIN district percentages
    religion-1981-lgd.csv        Table 8 counts by district
    religion-1981-notstated.csv  Table 8A split          (parse_1981_table8a.py)
    religion-1991-lgd.csv        1991 counts by district
    ward1972-census-1981.csv     1971 district populations, for weighting

Outputs:
    religion-common-basis-ni.csv    the three years on each basis, plus the residual
    religion-common-basis-lgd.csv   district detail, with honest blanks
"""
import os, csv, re, difflib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
DER = os.path.join(REPO, 'data', 'census', 'derived')

NI = 'NORTHERN IRELAND'
NONENUM_1981 = 19664          # RG's estimate of the population effect of non-returns
RG_NOTSTATED_PCT = {1971: 9.4, 1981: 18.5}      # Registrar General's printed figures


def rd(name):
    with open(os.path.join(DER, name), encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def key(s):
    return re.sub(r'[^a-z]', '', str(s).lower())


def num(v):
    v = str(v).strip().replace(',', '')
    return float(v) if v not in ('', 'None') else None


def main():
    r71 = {key(r['lgd']): r for r in rd('religion-1971-lgd.csv')}
    r81 = {key(r['lgd']): r for r in rd('religion-1981-lgd.csv')}
    r91 = {key(r['lgd']): r for r in rd('religion-1991-lgd.csv')}
    ns81 = {key(r['area']): r for r in rd('religion-1981-notstated.csv')}

    # 1971 district populations, from the ward table built for the 1972 boundaries.
    # Matched fuzzily because that table's district names come from the scanner and one
    # of them is wrong: Larne is recorded as 'Lame' (rn read as m). An exact join silently
    # drops it, and the loss is invisible -- it shows up only as a national total 29,897
    # short of the printed 1,536,065.
    pop71 = {}
    for r in rd('ward1972-census-1981.csv'):
        pop71[key(r['district'])] = pop71.get(key(r['district']), 0) + int(r['pop_1971_persons'])

    def pop71_of(k):
        # 0.6, the same threshold link_1972_wards.py uses for districts. 'larne' against
        # 'lame' scores 0.667, so anything stricter drops it. Safe at this threshold
        # because the pool is 26 distinctive district names, not a national gazetteer.
        # The national row is exempt: it has no counterpart and must not be fuzzy-matched
        # into some district.
        if k in pop71:
            return pop71[k]
        if k == key(NI):
            return ''
        m = difflib.get_close_matches(k, list(pop71), n=1, cutoff=0.6)
        return pop71[m[0]] if m else ''

    rows = []
    for k, a81 in r81.items():
        a91, a71 = r91.get(k), r71.get(k)
        tot81, rc81 = num(a81['total_pop']), num(a81['roman_catholic'])
        rec = {
            'area': a81['lgd'],
            'pop_1971': pop71_of(k),
            'pop_1981': int(tot81),
            'pop_1991': int(num(a91['total_pop'])) if a91 else '',
            'catholic_1981': int(rc81),
            'catholic_1991': int(num(a91['roman_catholic'])) if a91 else '',
            'raw_pct_1981': round(100 * rc81 / tot81, 2),
            'cain_pct_1971': num(a71['catholic_pct']) if a71 else '',
        }
        if a91:
            t, c, n = (num(a91['total_pop']), num(a91['roman_catholic']),
                       num(a91['not_stated']))
            rec['notstated_1991'] = int(n)
            rec['raw_pct_1991'] = round(100 * c / t, 2)
            rec['stated_pct_1991'] = round(100 * c / (t - n), 2)
        # 1981 stated basis exists only where Table 8A published the split
        hit = ns81.get(k)
        if hit:
            n81 = num(hit['persons_not_stated'])
            rec['notstated_1981'] = int(n81)
            rec['notstated_pct_1981'] = round(100 * n81 / tot81, 2)
            rec['stated_pct_1981'] = round(100 * rc81 / (tot81 - n81), 2)
        else:
            rec['notstated_1981'] = ''
            rec['notstated_pct_1981'] = ''
            rec['stated_pct_1981'] = ''
        rows.append(rec)

    # The CAIN file carries no Northern Ireland row, so the national 1971 figure is the
    # districts weighted by their own 1971 populations -- available from the ward table
    # built for the 1972 boundaries. HISTORICAL_RELIGION_1971_2021.md quotes 36.8% for
    # this, but weighted by 2021 population, which asks what the 1971 pattern would give
    # on today's distribution. For a 1971 statistic the 1971 weights are the right ones.
    lgd_src = [r for r in rows if key(r['area']) != key(NI)]
    ni_row = next(r for r in rows if key(r['area']) == key(NI))
    if not ni_row['pop_1971']:
        ni_row['pop_1971'] = sum(int(r['pop_1971']) for r in lgd_src if r['pop_1971'])
    if ni_row['cain_pct_1971'] in ('', None):
        num_, den = 0.0, 0.0
        for r in lgd_src:
            p, w = r['cain_pct_1971'], r['pop_1971']
            if p in ('', None) or not w:
                continue
            num_ += float(p) * float(w)
            den += float(w)
        if den:
            ni_row['cain_pct_1971'] = round(num_ / den, 2)
            print(f'  1971 NI (CAIN districts weighted by 1971 population): '
                  f'{ni_row["cain_pct_1971"]}%   [doc quotes 36.8%, 2021-weighted]\n')

    # ---- the residual, wherever both endpoints and the 1981 split are available
    for rec in rows:
        rec['proj_stated_pct_1981'] = ''
        rec['implied_catholic_share_of_notstated'] = ''
        a, b = rec['cain_pct_1971'], rec.get('stated_pct_1991')
        if a in ('', None) or not b or not rec['stated_pct_1981']:
            continue
        proj = (float(a) + float(b)) / 2                 # linear midpoint of the endpoints
        expected = proj / 100 * rec['pop_1981']
        gap = expected - rec['catholic_1981']
        rec['proj_stated_pct_1981'] = round(proj, 2)
        rec['implied_catholic_share_of_notstated'] = round(
            100 * gap / rec['notstated_1981'], 1)

    order = ['area', 'pop_1971', 'pop_1981', 'pop_1991', 'catholic_1981', 'catholic_1991',
             'cain_pct_1971', 'raw_pct_1981', 'raw_pct_1991',
             'notstated_1981', 'notstated_pct_1981', 'notstated_1991',
             'stated_pct_1981', 'stated_pct_1991',
             'proj_stated_pct_1981', 'implied_catholic_share_of_notstated']
    lgd = [r for r in rows if key(r['area']) != key(NI)]
    lgd.sort(key=lambda r: r['area'])
    with open(os.path.join(DER, 'religion-common-basis-lgd.csv'), 'w',
              encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=order, extrasaction='ignore')
        w.writeheader(); w.writerows(lgd)

    ni = next(r for r in rows if key(r['area']) == key(NI))
    with open(os.path.join(DER, 'religion-common-basis-ni.csv'), 'w',
              encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=order, extrasaction='ignore')
        w.writeheader(); w.writerows([ni] + [r for r in lgd if r['stated_pct_1981'] != ''])

    # ---- report
    print('  Catholic share on each basis\n')
    print(f"    {'':22} {'1971':>8} {'1981':>8} {'1991':>8}")
    print(f"    {'raw (incl. not-stated)':22} {'--':>8} "
          f"{ni['raw_pct_1981']:>7.1f}% {ni['raw_pct_1991']:>7.1f}%")
    print(f"    {'stated / pro-rata':22} {ni['cain_pct_1971']:>7}* "
          f"{ni['stated_pct_1981']:>7.1f}% {ni['stated_pct_1991']:>7.1f}%")
    print('      * 1971 is CAIN community-style, a neighbouring basis, not identical\n')
    print(f"    not stated 1981 {ni['notstated_1981']:,} "
          f"({ni['notstated_pct_1981']}%, RG printed {RG_NOTSTATED_PCT[1981]}%)   "
          f"1991 {ni['notstated_1991']:,}")
    print(f"    non-enumerated 1981 {NONENUM_1981:,} -- a separate and much smaller "
          f"failure, not merged above\n")

    for r in [ni] + [x for x in lgd if x['implied_catholic_share_of_notstated'] != '']:
        print(f"  {r['area']:18} projected {r['proj_stated_pct_1981']}% vs actual "
              f"{r['stated_pct_1981']}%  ->  "
              f"{r['implied_catholic_share_of_notstated']}% of its not-stated pool "
              f"would have to be Catholic")
    print(f"\n  districts with a computable 1981 stated basis: "
          f"{sum(1 for r in lgd if r['stated_pct_1981'] != '')} of {len(lgd)} "
          f"-- Table 8A splits the not-stated for Belfast only")
    print('  wrote religion-common-basis-ni.csv and religion-common-basis-lgd.csv')


if __name__ == '__main__':
    main()
