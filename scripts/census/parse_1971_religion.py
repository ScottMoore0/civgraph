#!/usr/bin/env python3
"""Recover 1971 religion COUNTS from the printed County Reports.

WHY. The repo's 1971 religion layer (religion-1971-lgd.csv) is the CAIN retabulation:
district percentages on a community-style basis, with no counts and no not-stated. That
is fine for mapping a share, but it cannot be put on the same footing as 1981 and 1991,
both of which are enumerated stated-religion with an explicit not-stated residual. To
compare like with like -- which is the whole point of the 1981 boycott question -- 1971
has to be available as counts in the same six categories the other two years use.

An earlier attempt recorded in HISTORICAL_RELIGION_1971_2021.md concluded the 1971 OCR was
"too corrupt to parse safely -- only 2 of ~7 area blocks validate". This gets 6 of 7:
Tyrone, Fermanagh, Down, Armagh, Antrim and Londonderry.

Londonderry lost only its Roman Catholic PERSONS column. Its male and female columns
survived as 40,287 and 41,753, so the column is recoverable as the residual and then
checked against those two -- see recover_missing_category. All three totals close exactly:
82,040 + 39,821 + 31,443 + 2,181 + 25,045 = 180,530, and the same holds for each sex.

BELFAST COUNTY BOROUGH IS NOT RECOVERABLE, and for a different reason. Its report is laid
out the other way round -- each run is one category as 6 rows of (persons, males, females)
interleaved, so run 0 is the whole population block: 356,830 with five areas summing to
exactly that. Twelve such self-proving blocks survive, but no five of them sum to the
population on all three sexes, and all eleven non-population blocks together reach only
275,649 of 356,830. The two largest columns -- Roman Catholic and Presbyterian, on the
order of 112,000 and 85,000 -- never reach the candidate stream; the largest head present
is 42,475. Two missing columns against one identity cannot be corroborated, so the report
is skipped rather than guessed at.

Its population total is nonetheless known exactly, as the residual of Table 8's own total:
1,519,640 - 1,162,810 = 356,830, which is what run 0 independently reads.

The seven population totals do all survive, and they sum to 1,519,640. That is 16,425
below the 1,536,065 enumerated population, which is what Table 8's own note predicts: it
excludes people usually resident outside Northern Ireland and armed forces in barracks.
So the two failed reports failed on their religion columns, not their arithmetic.

STRUCTURE. The 1971 Census was published as seven County Reports (six counties plus
Belfast County Borough), each with its own TABLE 8 Religions covering that county and its
urban and rural districts. The categories are exactly 1981's: Population, Roman Catholic,
Presbyterian, Church of Ireland, Methodist, and a lumped 'Other and not stated'.

THE LAYOUT IS NOT CONSISTENT, WHICH IS THE WHOLE DIFFICULTY. Usually each (category, sex)
cell is one contiguous run with the county total first. But where the labels between
columns are lost the scan reads several columns ACROSS the page, emitting k columns as one
interleaved run of k*n values in which the county occupies indices 0..k-1. Splitting such
a run end-to-end instead lands mid-column and yields a district figure dressed as a county
total. Fermanagh settles the point: its 10-value Roman Catholic run interleaves persons
and males, and the alternate values sum to exactly 23,738 and 12,209.

Labels cannot arbitrate -- they are scrambled too, with the group header 'Population'
emitted after its own Persons column rather than before it. So everything is identified by
arithmetic:

    column_head   a column's first row is the county and the rest its districts, so a
                  correctly-located column satisfies seq[0] == sum(seq[1:])
    triples       (persons, males, females) grouped by P == M + F, not by position
    solve_by_sum  where a column was lost entirely and the sequential walk desynchronises,
                  the five religion columns are found by the identity they must satisfy
                  together, and only a UNIQUE solution is accepted

Two counties are read sequentially with all six sexes checked; three need the sum
identity, which reconciles by construction, so for those the independent evidence is the
uniqueness of the solution plus whichever sexes proved themselves. Every row records which
method produced it and how many of the six sex checks passed -- see the method and
sex_checks columns.

NOT-STATED IS NOT SPLIT OUT. Each report carries an 'Analysis of column headed Other and
not stated denominations', and its TOTAL is locatable: for all five counties exactly one
run holds a value equal to that county's other-and-not-stated, preceded by a plausible
'Other denominations*' and 'Not stated' pair. Tyrone's reads 57 then 7,232 against a total
of 19,179. It is NOT emitted, because the denomination components recoverable from the
other fragments sum to about 4,000, so 57 + 7,232 + 4,000 falls roughly 7,900 short of
19,179. The position is right and the arithmetic is not, which is exactly the case where a
figure should be left out rather than shipped on the strength of where it sits.

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


def column_head(seq, n):
    """The county total of one column: its first row.

    EVERY COLUMN CARRIES ITS OWN PROOF. The first row is the county and the rest are its
    districts, so a correctly-located column of the right length satisfies
    seq[0] == sum(seq[1:]). Tyrone's population column is 138,158 against ten districts
    summing to 138,158.

    The test is used to LOCATE the column, not to filter runs. Applying it as a filter
    was tried and cost more than it gained: a run carrying one stray extra figure is a
    perfectly good column that simply fails a length check, and dropping it loses a whole
    category. So a window of n is slid over the run and the first window that proves
    itself wins; only if none does is the leading value taken on trust.
    """
    if not seq:
        return None
    if len(seq) >= n:
        for s in range(0, len(seq) - n + 1):
            w = seq[s:s + n]
            if w[0] == sum(w[1:]):
                return w[0]
    if len(seq) >= 2 and seq[0] == sum(seq[1:]):
        return seq[0]
    return seq[0]


def solve_by_sum(pop, pool, need=5, cap=3):
    """Locate the five religion columns by the identity they must satisfy together.

    Used only where the sequential reading fails. Where a category's Persons column was
    lost or mis-headed by the scan, the triple walk desynchronises and every category
    after it is misread. But the five categories must sum to the population, so they can
    be found by that constraint instead of by position.

    Returns every solution found, up to cap. The caller requires EXACTLY ONE: a single
    ordered selection of five values summing to a six-figure total is a strong result,
    whereas two solutions mean the data cannot distinguish them and the county is
    dropped. Deliberately NOT extended to 'four values plus a residual' -- with one free
    parameter that always succeeds, so it would validate nothing.
    """
    sols = []

    def dfs(i, left, chosen):
        if len(sols) >= cap:
            return
        if len(chosen) == need:
            if left == 0:
                sols.append(list(chosen))
            return
        for j in range(i, len(pool)):
            v = pool[j]
            if 0 < v <= left:
                chosen.append((j, v))
                dfs(j + 1, left - v, chosen)
                chosen.pop()

    dfs(0, pop, [])
    return sols


def triples_idx(vals, window=3):
    """(persons, males, females, i, k) groups, located by the identity, not by position.

    Position fails: the number of scanner-noise runs between columns varies from report
    to report, so a fixed stride finds the right blocks in one report and garbage in the
    next. P == M + F is a property of the data and survives that.

    TOLERATE DEBRIS BETWEEN THE THREE. Requiring the three to be strictly adjacent is what
    lost Londonderry. Its columns are all present and correct -- Presbyterian 39,821 =
    19,564 + 20,257, Church of Ireland 31,443 = 15,513 + 15,930, Methodist 2,181 = 1,057 +
    1,124, Other 25,045 = 12,638 + 12,407 -- but the scan drops a stray figure between the
    members of four of them (813, 789, 45, 32), so an adjacency test finds none of them and
    the whole report is discarded. A short search window skips the debris.

    The window stays small, and the FIRST match wins, because P == M + F is only strong
    while the field is narrow: over a long enough span some unrelated pair will satisfy it
    by chance. Three is enough for every report here and keeps the identity meaningful.
    """
    out, i = [], 0
    while i < len(vals) - 1:
        a = vals[i]
        hit = None
        if a > 0:
            for j in range(i + 1, min(i + 1 + window, len(vals))):
                for k in range(j + 1, min(j + 1 + window, len(vals))):
                    if vals[j] > 0 and vals[k] > 0 and a == vals[j] + vals[k]:
                        hit = (a, vals[j], vals[k], i, k)
                        break
                if hit:
                    break
        if hit:
            out.append(hit)
            i = hit[4] + 1
        else:
            i += 1
    return out


def triples(vals, window=3):
    return [t[:3] for t in triples_idx(vals, window)]


def recover_missing_category(cand, tri):
    """Fill the ONE religion column the scan lost, when the page still corroborates it.

    A residual is normally worthless as evidence: subtract four categories from the total
    and the fifth always appears, fitting perfectly because it was defined to. solve_by_sum
    refuses that reasoning for exactly this reason.

    What makes it admissible here is that the residual is not the only witness. Londonderry
    lost only its Roman Catholic PERSONS column; the male and female columns survived and
    sit in the stream as 40,287 and 41,753. The residual predicts both of those numbers,
    and both are found on the page, in the right place -- between the preceding category's
    block and the following one's. So the residual is checked against evidence it did not
    generate, and could have contradicted.

    Requires a unique position: if the missing category could sit in more than one slot and
    still be corroborated, the page cannot say which, and nothing is returned.
    """
    pop, cats = tri[0], tri[1:]
    if len(cats) != len(CATS) - 2:
        return None
    res = tuple(pop[i] - sum(c[i] for c in cats) for i in range(3))
    if any(v <= 0 for v in res) or res[0] != res[1] + res[2]:
        return None
    # Both derived sex columns must actually appear on the page.
    if res[1] not in cand or res[2] not in cand:
        return None
    mi, fi = cand.index(res[1]), cand.index(res[2])
    if not mi < fi:
        return None

    ok = []
    for pos in range(len(CATS) - 1):
        before = cats[pos - 1][4] if pos > 0 else pop[4]
        after = cats[pos][3] if pos < len(cats) else len(cand)
        if before < mi and fi < after:
            ok.append(pos)
    if len(ok) != 1:
        return None

    ordered = [c[:3] for c in cats]
    ordered.insert(ok[0], res)
    return [pop[:3]] + ordered


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
        # MERGED RUNS ARE INTERLEAVED, NOT CONCATENATED. Where the labels between columns
        # are lost the scan emits several columns as one run -- but it reads them ACROSS
        # the page, so a run of k*n values is k columns interleaved row by row, and the
        # first row (the county) occupies indices 0..k-1. Splitting such a run on a stride
        # of n, as if the columns had been laid end to end, lands mid-column and yields a
        # district figure dressed as a county total.
        #
        # Fermanagh settles it: its 10-value Roman Catholic run is [23738, 12209, 2823,
        # 1361, 7250, 3738, 4968, 2600, 8697, 4510], and the alternate values 2823+7250+
        # 4968+8697 sum to exactly 23738 while 1361+3738+2600+4510 sum to exactly 12209.
        # Two interleaved columns, persons and males, with the county pair leading.
        #
        # EVERY COLUMN CARRIES ITS OWN PROOF. The first row of a column is the county and
        # the rest are its districts, so a complete, correctly-located column satisfies
        # seq[0] == sum(seq[1:]). Runs that lost a value to the scan fail it -- and those
        # are exactly the ones whose leading value is a district masquerading as a county
        # total. Rejecting them here stops a corrupt column from desynchronising
        # everything after it. Tyrone's population column: 138,158 against ten districts
        # summing to 138,158.
        cand = []
        for r in rr:
            k = len(r) // n if (len(r) >= n and len(r) % n == 0) else 1
            for j in range(k):
                seq = r[j::k] if k > 1 else r
                h = column_head(seq, n)
                if h is not None:
                    cand.append(h)
        tri = triples_idx(cand)
        # Once the interleaving is read correctly all six categories fall out of the same
        # stream in printed order, including the lumped Other-and-not-stated, so it no
        # longer needs finding by shape.
        method = ''
        if len(tri) >= 6:
            for ci, cat in enumerate(CATS):
                for si, sx in enumerate(SEX):
                    rec[f'{cat}_{sx}'] = tri[ci][si]
            method = 'sequential'
            if sum(rec[f'{c}_persons'] for c in CATS[1:]) != rec['population_persons']:
                method = ''            # sequential reading did not reconcile; fall through
        if not method and len(tri) == len(CATS) - 1:
            got = recover_missing_category(cand, tri)
            if got:
                for ci, cat in enumerate(CATS):
                    for si, sx in enumerate(SEX):
                        rec[f'{cat}_{sx}'] = got[ci][si]
                method = 'residual-corroborated'
        if not method:
            sols = solve_by_sum(cand[0], cand[3:])
            if len(sols) != 1:
                print(f'  {name:22} sequential read failed and the sum identity has '
                      f'{len(sols)} solutions -- SKIP')
                continue
            pool = cand[3:]
            rec['population_persons'] = cand[0]
            rec['population_males'] = cand[1] if cand[0] == cand[1] + cand[2] else ''
            rec['population_females'] = cand[2] if cand[0] == cand[1] + cand[2] else ''
            for (j, v), cat in zip(sols[0], CATS[1:]):
                rec[f'{cat}_persons'] = v
                # the sexes, if the two columns that follow this one prove themselves
                m, f = (pool[j + 1], pool[j + 2]) if j + 2 < len(pool) else ('', '')
                ok2 = m != '' and m + f == v
                rec[f'{cat}_males'] = m if ok2 else ''
                rec[f'{cat}_females'] = f if ok2 else ''
            method = 'sum-identity'

        # --- oracles. Under 'sum-identity' the totals reconcile by construction, so the
        # independent evidence there is the UNIQUENESS of the solution plus whichever
        # sexes proved themselves; both are recorded so no row's provenance is implicit.
        checked = [c for c in CATS if rec.get(f'{c}_males') not in ('', None)]
        sexok = all(rec[f'{c}_persons'] == rec[f'{c}_males'] + rec[f'{c}_females']
                    for c in checked)
        partsum = sum(rec[f'{c}_persons'] for c in CATS[1:])
        sumok = partsum == rec['population_persons']
        rec['areas_in_report'] = n
        rec['method'] = method
        rec['sex_checks'] = f'{len(checked)}/6'
        if sexok and sumok:
            passed += 1
            rows.append(rec)
            print(f"  {name:22} pop {rec['population_persons']:>9,}  "
                  f"RC {rec['roman_catholic_persons']:>9,}  "
                  f"other+NS {rec['other_notstated_persons']:>8,}   PASS "
                  f"[{method}, sexes {rec['sex_checks']}]")
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
                vals = [r[f'{c}_{sx}'] for r in rows]
                ni[f'{c}_{sx}'] = (sum(vals) if all(v not in ('', None) for v in vals)
                                   else '')
        rows.append(ni)

    keys = (['area', 'areas_in_report', 'method', 'sex_checks']
            + [f'{c}_{s}' for c in CATS for s in SEX])
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
        got = sum(r['population_persons'] for r in rows)
        print(f'  covering {got:,} people of the 1,519,640 in Table 8 '
              f'({100*got/1519640:.0f}%).')
        missing = 1519640 - got
        print('  NO national row written: it would be a partial sum masquerading as a '
              'control total.\n  The gap is Belfast County Borough alone -- '
              f'{missing:,} people, whose two largest religion\n  columns never reach the '
              'candidate stream. NI-level figures therefore continue to\n  come from the '
              'CAIN retabulation and that layer is retained. The six counties\n  here are '
              'new, and are counts rather than percentages.')
    print(f'  wrote {OUT}')


if __name__ == '__main__':
    main()
