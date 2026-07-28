#!/usr/bin/env python3
"""Parse ward-level population from the 1981 NI Census Preliminary Report OCR.

Source: data/census/census-1981.md, Table 4 ("Population 1971 and 1981"), the most
granular published geography of that census -- wards under the 26 District Councils
created in 1973. Enumeration districts (~3,000) were a collection unit, not a
publication geography.

WHY THIS IS PARSEABLE. The OCR read each page COLUMN-WISE, so every name appears in one
block and the six numeric columns follow as six more blocks:

    NORTHERN IRELAND / Antrim District Council / Wards / Aldergrove / Baiioo / ...
    Persons / 1,536,065 / 33,998 / 2,186 / ...      <- 1971 Persons
    754,676 / 17,224 / 1,267 / ...                  <- 1971 Males, and so on

Names and numbers align by POSITION, not proximity, so OCR damage to a ward's spelling
('Baiioo', 'BaJlyrobin', 'The Mali') does not affect its numbers. What DOES corrupt the
result is a dropped or spurious numeric token shifting a column -- which happens
constantly. Everything below exists to defeat that.

THREE ORACLES, used at different stages:
  (a) sum(ward values) == the district's own printed total
  (b) PERSONS == MALES + FEMALES on every row, in both year-halves
  (c) the number of NAMES on a page == the number of ROWS on that page

(b) is the workhorse: it scores a candidate alignment per row, so it can drive a search
rather than merely validate a finished parse. (c) supplies the row count, because names
survive OCR far better than digits. (a) is the final gate.

HOW IT WORKS, and each step was forced by a measured failure of the previous one:

 1. DISCARD FOREIGN TOKENS. A second table ("Households not enumerated", "Estimated
    population effect") is interleaved on the same pages. Its values are tiny; ward,
    male and female counts are all comfortably >= 100, so that threshold removes 1,214
    of 5,732 tokens safely.

 2. SPLIT INTO PAGE RUNS, requiring >= 20 accumulated numbers before a name block may
    end a run. Without that guard a stray '195' on the very first line splits the run
    early and silently eats 'NORTHERN IRELAND' and 'Antrim District Council'.
    ONLY RUNS 0-9 ARE THIS TABLE -- together 3,377 tokens, about 553 rows of six.
    Runs 10-19 score 0% at every alignment; they are a different table.

 3. FIND THE COLUMN BOUNDARIES. Oracle (b) DECOUPLES into two independent triples
    (1971 P,M,F and 1981 P,M,F), so the five unknown boundaries are a 3-dim then 2-dim
    exhaustive search, not a 5-dim one. Cheap, and it alone lifts agreement 0% -> 64%.

 4. ALIGN WITHIN COLUMNS BY DP. Boundaries are not enough: drift accumulates INSIDE a
    column, one dropped token shifting every row after it. A banded Needleman-Wunsch
    over the three sequences -- match scored by A[i]==B[j]+C[k], gaps penalised -- takes
    it to 94%. A greedy repair was tried first and REJECTED: it helped some runs but
    drove run 5 from 92% to 5%, because a single wrong skip poisons everything after it
    and greedy cannot revise. Do not retry greedy.

 5. PIN THE ROW COUNT with oracle (c). The gap penalty is searched for the alignment
    whose row count comes closest to the page's name count.
    THIS STEP IS NOT YET WORKING, and it is the only thing left. Names still exceed
    rows by 2-5 on every page (e.g. run 0: 62 names, 62 rows in the 1971 half but 59 in
    the 1981 half). Two separate causes, and they need separate fixes:
      - the NAME side is still admitting junk on runs 3-8, where 63-65 names appear
        against ~60 real rows. Run 0 and run 1 are clean at 62, so the cleaner is close;
        what remains is page-header debris that JUNK does not yet match.
      - the 1981 half still recovers 1-3 fewer rows than the 1971 half of the same
        page, though it is much better than it was: cutting the tail at the DP's ACTUAL
        consumption point (b[1] + term[2]) instead of the search's estimate b[2] took
        overall agreement 90% -> 93% and fixed the 1981 halves of runs 6, 7 and 8
        (53->60, 52->59, 48->57 hits). The residue is a real remaining gap.
    Constraining the boundary search by the name count was tried as a fix and made
    things WORSE (90% -> 70%), because the name count is itself unreliable. Fix the two
    causes above first; do not re-couple the searches.

 6. GATE ON ORACLE (a). Districts whose wards do not sum to their printed total are
    REJECTED, not emitted. Because step 5 is unfinished, every run is currently rejected
    before reaching this gate and NO OUTPUT IS WRITTEN. That is the intended behaviour.

DO NOT ship partial output. A ward table right for Antrim and wrong for Belfast is worse
than none, because nothing downstream would reveal the difference.

Output: data/census/derived/ward1972-census-1981.csv
"""
import os, re, csv, difflib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(REPO, 'data', 'census', 'census-1981.md')
OUT = os.path.join(REPO, 'data', 'census', 'derived')
LO, HI = 1500, 9820
COLS = ['pop_1971_persons', 'pop_1971_males', 'pop_1971_females',
        'pop_1981_persons', 'pop_1981_males', 'pop_1981_females']
# published controls, used as an independent end-to-end check
CTRL = {'pop_1971_persons': 1536065, 'pop_1971_males': 754676, 'pop_1971_females': 781389,
        'pop_1981_persons': 1490228, 'pop_1981_males': 730174, 'pop_1981_females': 760054}

NUM = re.compile(r'^[^0-9]{0,4}?([0-9][0-9,]*)[^0-9]{0,4}$')
DC = re.compile(r'^(.*?)\s+District\s+Council\b', re.I)
JUNK = re.compile(r'(table\s*\d|population|^\s*wards?\s*$|^\s*persons\s*$|^\s*males\s*$|'
                  r'^\s*fema|^\s*total|page\s*\d|19\d\d|^\s*#|contd|continued|^\s*and\s|'
                  r'census|^\s*district\s+council\s*$|local government|enumerat|household|'
                  r'estimated|^\s*number\s*$|^\s*effect\s*$|^\s*at\s*ion|row/|'
                  r'^\s*are.\s*$|^\s*area\s*$)', re.I)


def is_name(s):
    s = s.strip()
    return bool(s) and not NUM.match(s) and re.search(r'[A-Za-z]{3}', s)


# Column headers survive OCR badly and then read as ward names: 'hemales',
# 'heniaies', 'Fi'mak's', '• Maks', 'Estibiated', '\9H\~confinued', '(at ion',
# 'Arf^u'. Exact patterns cannot catch these, so headers are matched FUZZILY on the
# alpha-only form. A real ward name that lands within 0.72 of one of these would be
# dropped, but the district checksum is the backstop -- a wrongly dropped ward makes
# its district fail and be rejected, never silently mis-stated.
HEADERS = ('males', 'females', 'persons', 'total', 'population', 'estimated',
           'continued', 'enumerated', 'households', 'number', 'effect', 'area',
           'wards')
# NOT in HEADERS: 'northernireland', 'district', 'council'. NI is a REAL row and the
# district lines are real entities; listing them here dropped run 0 from a correct 62
# names to 61.


def is_header(c):
    if re.match(r'^northern\s+ireland$', c, re.I) or DC.match(c):
        return False
    a = re.sub(r'[^a-z]', '', c.lower())
    if len(a) < 3:
        return False
    return bool(difflib.get_close_matches(a, HEADERS, n=1, cutoff=0.72))


def clean(s):
    c = re.sub(r'\s{2,}', ' ', re.sub(r'[.\s]+$', '', s.strip()))
    c = c.strip(" .,^|!_-—'")
    if not c or JUNK.search(c):
        return None
    if len(re.sub(r'[^A-Za-z]', '', c)) < 3:
        return None
    # heavy OCR debris: backslashes, bullets, carets rarely occur in place names
    if re.search(r'[\•^~]', c):
        return None
    return None if is_header(c) else c


def page_runs():
    L = open(SRC, encoding='utf-8').read().split('\n')
    out, names, cur, gap = [], [], [], 0
    for i in range(LO, HI):
        s = L[i].strip()
        if not s:
            continue
        m = NUM.match(s)
        if m:
            try:
                v = int(m.group(1).replace(',', ''))
                if v >= 100:
                    cur.append(v)
                    gap = 0
            except ValueError:
                pass
            continue
        if is_name(s):
            gap += 1
            if gap >= 6 and len(cur) >= 20:      # >=20 guards against a stray token
                out.append((names, cur))
                names, cur, gap = [], [], 1
            names.append(s)
    if cur:
        out.append((names, cur))
    return [(n, r) for n, r in out if len(r) > 20][:10]


def entities(names):
    ents = []
    for s in names:
        c = clean(s)
        if not c:
            continue
        m = DC.match(c)
        if re.match(r'^northern\s+ireland$', c, re.I):
            ents.append(('ni', 'NORTHERN IRELAND'))
        elif m:
            ents.append(('district', m.group(1).strip()))
        else:
            ents.append(('ward', c))
    return ents


def bounds(seq, ncol):
    """Find the three column boundaries of the NEXT triple in seq.

    The window comes from the TOKEN COUNT, not from the name count: ncol is how many
    columns seq still holds (6 for a whole run, 3 for its second half). Deriving it from
    the name count instead was tried and is WORSE -- junk names inflate R on runs 3-8,
    which puts the window in the wrong place and collapses those runs to ~1 hit.
    """
    n, best = len(seq), (-1, None)
    N = max(2, len(seq) // ncol)
    lo, hi = max(2, N - 9), N + 10
    for b1 in range(lo, hi):
        for b2 in range(b1 + lo, b1 + hi):
            for b3 in range(b2 + lo, min(b2 + hi, n + 1)):
                A, B, C = seq[0:b1], seq[b1:b2], seq[b2:b3]
                k = min(len(A), len(B), len(C))
                sc = sum(1 for i in range(k) if A[i] == B[i] + C[i])
                if sc > best[0]:
                    best = (sc, (b1, b2, b3))
    return best[1]


NEG = float('-inf')


def dp(A, B, C, W=10, GAP=-0.7, NM=-0.25):
    """banded Needleman-Wunsch over three sequences, match = A[i]==B[j]+C[k]"""
    la, lb, lc = len(A), len(B), len(C)
    S, BK = {(0, 0, 0): 0.0}, {}
    for i in range(la + 1):
        for j in range(max(0, i - W), min(lb, i + W) + 1):
            for k in range(max(0, i - W), min(lc, i + W) + 1):
                st = (i, j, k)
                cu = S.get(st)
                if cu is None:
                    continue
                mv = []
                if i < la and j < lb and k < lc:
                    mv.append((1, 1, 1, 1.0 if A[i] == B[j] + C[k] else NM))
                if i < la:
                    mv.append((1, 0, 0, GAP))
                if j < lb:
                    mv.append((0, 1, 0, GAP))
                if k < lc:
                    mv.append((0, 0, 1, GAP))
                for di, dj, dk, w in mv:
                    nx = (i + di, j + dj, k + dk)
                    if abs(nx[1] - nx[0]) > W or abs(nx[2] - nx[0]) > W:
                        continue
                    v = cu + w
                    if v > S.get(nx, NEG):
                        S[nx] = v
                        BK[nx] = (st, di, dj, dk)
    best = None
    for st, v in S.items():
        if st[0] == la and (best is None or v > best[1]):
            best = (st, v)
    if best is None:
        return [], (0, 0, 0)
    term = best[0]
    st, rows = best[0], []
    while st in BK:
        pr, di, dj, dk = BK[st]
        if di == dj == dk == 1:
            i, j, k = pr
            rows.append((A[i], B[j], C[k]))
        st = pr
    rows.reverse()
    return rows, term


def fit(seq, R, ncol, W=10):
    """align one 3-column half so EXACTLY R rows come out; the gap penalty is searched
    because a harsher penalty means fewer skips and therefore more rows."""
    b = bounds(seq, ncol)
    if not b:
        return [], None
    A = seq[0:b[0]]
    B = seq[b[0]:min(len(seq), b[1] + W)]
    C = seq[b[1]:min(len(seq), b[2] + W)]
    best = None
    for g in (-0.2, -0.3, -0.45, -0.6, -0.7, -0.85, -1.0, -1.2, -1.5, -2.0, -3.0):
        rows, term = dp(A, B, C, W=W, GAP=g)
        ok = sum(1 for x in rows if x[0] == x[1] + x[2])
        cand = (abs(len(rows) - R), -ok, rows, term)
        if best is None or cand[:2] < best[:2]:
            best = cand
    # where the third column ACTUALLY ended, not where the search guessed it would.
    # b[2] is an estimate; term[2] is how many tokens of C the alignment consumed.
    end = b[1] + best[3][2]
    return best[2], b, end


def main():
    print("=" * 84)
    print("1981 Census Table 4 - ward population under the 1973 District Councils")
    all_rows, rejected, agree, total = [], [], 0, 0
    for ri, (names, run) in enumerate(page_runs()):
        ents = entities(names)
        R = len(ents)
        a1, b1, end1 = fit(run, R, 6)
        if not b1:
            rejected.append((ri, 'no column boundaries'))
            continue
        a2, _, _ = fit(run[end1:], R, 3)
        o1 = sum(1 for x in a1 if x[0] == x[1] + x[2])
        o2 = sum(1 for x in a2 if x[0] == x[1] + x[2])
        agree += o1 + o2
        total += len(a1) + len(a2)
        status = 'ok' if len(a1) == len(a2) == R else 'ROWS != NAMES'
        print(f"  run {ri}: names {R:3}  1971 {len(a1):3} ({o1} ok)  "
              f"1981 {len(a2):3} ({o2} ok)  {status}")
        if len(a1) != R or len(a2) != R:
            rejected.append((ri, f'row/name mismatch {len(a1)}/{len(a2)} vs {R}'))
            continue
        for i, (kind, nm) in enumerate(ents):
            all_rows.append({'kind': kind, 'name': nm, 'run': ri,
                             **dict(zip(COLS, list(a1[i]) + list(a2[i])))})
    print(f"\n  oracle (b) agreement: {agree}/{total} = {100*agree/max(1,total):.1f}%")
    print(f"  runs rejected: {len(rejected)}")
    for r in rejected:
        print(f"      run {r[0]}: {r[1]}")

    # --- oracle (a): a district's wards must sum to its printed total
    groups, cur = [], None
    for r in all_rows:
        if r['kind'] == 'district':
            cur = {'district': r['name'], 'total': r, 'wards': []}
            groups.append(cur)
        elif r['kind'] == 'ward' and cur is not None:
            cur['wards'].append(r)
    kept, failed = [], []
    for g in groups:
        if not g['wards']:
            continue
        bad = [c for c in COLS if sum(w[c] for w in g['wards']) != g['total'][c]]
        if bad:
            failed.append((g['district'], len(g['wards']), len(bad)))
        else:
            kept.append(g)
    print(f"\n  districts checksummed: {len(groups)}   PASS {len(kept)}   FAIL {len(failed)}")
    for d, n, b in failed[:14]:
        print(f"      FAIL {d:24} {n:3} wards, {b}/6 columns off")
    if kept:
        print("\n  PASSING districts:")
        for g in kept:
            print(f"      {g['district']:24} {len(g['wards']):3} wards  "
                  f"1971 {g['total']['pop_1971_persons']:>9,}")
    ni = [r for r in all_rows if r['kind'] == 'ni']
    if ni:
        n = ni[0]
        good = all(n[c] == CTRL[c] for c in COLS)
        print(f"\n  NI control row: {'MATCHES published totals' if good else 'MISMATCH'}")
        for c in COLS:
            print(f"      {c:20} {n[c]:>10,}  published {CTRL[c]:>10,}"
                  f"  {'ok' if n[c] == CTRL[c] else 'X'}")
    if not failed and kept:
        os.makedirs(OUT, exist_ok=True)
        p = os.path.join(OUT, 'ward1972-census-1981.csv')
        with open(p, 'w', encoding='utf-8', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=['district', 'ward'] + COLS)
            w.writeheader()
            for g in kept:
                for wd in g['wards']:
                    w.writerow({'district': g['district'], 'ward': wd['name'],
                                **{c: wd[c] for c in COLS}})
        print(f"\n  wrote {p}")
    else:
        print(f"\n  NOT WRITING OUTPUT - {len(failed)} districts fail their checksum.")


if __name__ == '__main__':
    main()
