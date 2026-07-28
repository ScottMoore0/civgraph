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

FOUR ORACLES, used at different stages:
  (a) sum(ward values) == the district's own printed total
  (b) PERSONS == MALES + FEMALES on every row, in both year-halves
  (c) the number of NAMES on a page == the number of ROWS on that page
  (d) a ward's 1981 population is of the same order as its 1971 one

(b) is the workhorse: it scores a candidate alignment per row, so it can drive a search
rather than merely validate a finished parse. (c) supplies the row count, because names
survive OCR far better than digits. (a) is the final gate.

(d) exists because (b) HAS A BLIND SPOT, and it is the one that mattered most. When the
scanner drops a token from all three columns of a half, every row below shifts together
and P == M + F still holds on every one of them, so (b) sees a flawless parse while
Toome has been handed Ards's district total of 57,598. Only the other year-half can see
that: Toome held 2,058 people in 1971. The two halves are therefore aligned AGAINST EACH
OTHER, in both directions, since neither is reliably the sounder one -- Antrim and Ards
come out perfect in 1971 and shifted in 1981, Londonderry and Magherafelt the reverse.

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

 5. PIN THE ROW COUNT with oracle (c), as a DIMENSION of the alignment rather than a
    hope. The state carries d = (rows emitted) - (tokens of A consumed) and only
    d == R - len(A) is terminal, so exactly R rows come out or none do. The gap-penalty
    search this replaces merely hoped the count would land near R, and it never did.

 6. RECOVER DROPPED VALUES BY ARITHMETIC. A row whose token the scanner lost cannot be
    aligned back into existence, which is why row counts came up short rather than
    merely misaligned. But any two of P, M, F give the third, so a row may consume two
    columns and derive the third. 60 of 3,378 values are recovered this way.
    This cannot launder a bad parse: an imputed row satisfies (b) BY CONSTRUCTION, so
    (b) is reported over verified rows only, and (a) is unaffected -- a wrongly imputed
    ward breaks its district's sum exactly as a wrongly aligned one does.

 7. GATE ON ORACLE (a). Districts whose wards do not sum to their printed total are
    REJECTED, not emitted, and output is written only if EVERY district passes.

WHERE IT STANDS. Both NI control rows are recovered exactly, 1971 and 1981; oracle (b)
holds on all 1,058 verified rows; 9 of the 26 districts pass all six column checksums.
Output is still withheld, correctly, because 17 do not. Those 17 fail for two reasons
and only one of them is a bug in this script:

  - SINGLE BAD DIGITS, which no amount of alignment can fix. Armagh's 1971 males sum
    1,000 high and its females 1,000 low, with persons exact; Antrim's 1981 males are
    58 low and females 58 high. The row satisfies P == M + F, so (b) cannot see it and
    (a) correctly rejects the district. Repairing these needs a source (a) can check
    against, not a better parse.
  - LOST WARD NAMES, which shift a whole page. The scanner rendered some ward names as
    bare leader dots -- 'Hillfoot / . / Lisnasharragh' on Castlereagh's continuation
    page -- so run 3 offers 61 names for 63 rows, and because R comes from the name
    count every row below the gap is labelled with its neighbour's figures. Coleraine
    and Cookstown sit +2 out of position, Carrickfergus, Fermanagh, Larne and Limavady
    +1, Magherafelt -1. The fix is to stop deriving R from the name count -- choose it
    by alignment score -- and then attach names to rows anchored on the district totals,
    which are locatable numerically (a district total equals the sum of the rows that
    follow it, and that alone finds 20 of the 26). Table 5 of the same report lists the
    same wards and lost different names, so it is available as a second witness.

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

# A district header may be a ROW (its printed total) or a mere CAPTION repeated at the
# top of a continuation page, and the two are told apart only by this marker. Getting it
# wrong costs a whole district either way: a caption counted as a row inserts a phantom
# entity, and a row dropped as a caption loses the total everything is checked against.
# 'continued' was already handled; "cont'd" was not, and that alone put a second
# Castlereagh, Craigavon, Lisburn and Strabane into the table.
CONT = re.compile(r"con[t1l][’']?\s*(?:d|inued|mued)?\b|row\s*/", re.I)
DCX = re.compile(r'^(.*?\S)\s+(D[i1l]s[t1l]\S*.*)$', re.I)


def district_of(c):
    """The district name if c is a District Council header line, else None.

    The WHOLE tail is matched fuzzily against 'districtcouncil' after stripping
    non-letters, rather than testing 'District' and 'Council' as tokens, because the
    scanner damaged both words and in different ways: 'CcJuncil', 'Councii', 'CourvcW',
    and -- the one that hid an entire district -- 'Carrickfergus Distr ict Council',
    where the space fell inside 'District'. Ignoring the spacing costs nothing, since a
    ward name has no reason to resemble 'districtcouncil' at all, while missing a header
    files that district's wards under whichever district came before it.
    """
    m = DCX.match(c)
    if not m:
        return None
    tail = re.sub(r'[^a-z]', '', m.group(2).lower())
    if difflib.SequenceMatcher(None, tail, 'districtcouncil').ratio() < 0.72:
        return None
    return m.group(1).strip()
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
    if re.match(r'^northern\s+ireland$', c, re.I) or district_of(c):
        return False
    a = re.sub(r'[^a-z]', '', c.lower())
    if len(a) < 3:
        return False
    return bool(difflib.get_close_matches(a, HEADERS, n=1, cutoff=0.72))


def clean(s):
    c = re.sub(r'\s{2,}', ' ', re.sub(r'[.\s]+$', '', s.strip()))
    c = c.strip(" .,^|!_-—'")
    if not c or JUNK.search(c) or CONT.search(c):
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
            names.append((s, len(cur)))
            # The page break is retroactive: EVERY name since the last figure belongs to
            # the next page, because the scanner reads a page's names before any of its
            # six number columns. Splitting at the sixth consecutive name instead left
            # the first few names of each page attached to the page before it, and how
            # many depended on how many caption lines that page happened to carry --
            # five on page 21, four on page 22, which is how Carrowreagh ended up filed
            # under Belfast's page and every row below it on page 22 was labelled with
            # its neighbour's figures.
            if gap >= 6 and len(cur) >= 20:      # >=20 guards against a stray token
                out.append((names[:-gap], cur))
                # the moved names open the next page, so their figure count restarts
                names, cur = [(t, 0) for t, _ in names[-gap:]], []
    if cur:
        out.append((names, cur))
    return [(n, r) for n, r in out if len(r) > 20][:10]


COLCAP = 5      # figures that mean a number column is under way, not a stray token


def entities(names):
    """Entity rows for one page, from (name, figures already read) pairs.

    WHERE a name sits decides more than what it says. The scanner reads every ward name
    on a page before the first figure of that page's leading column, so a name arriving
    once a column is under way cannot be a ward -- it is one of the six column captions,
    which the scanner damaged past any hope of recognising by spelling: 'heniaies',
    "Fi'mak's", '(at ion', 'Nation'. Similarity cannot be used here, because real ward
    names score exactly as high: Maze, Mallusk, Falls and Clare all sit at 0.667 against
    the caption vocabulary, level with the worst of the junk.

    The one caption that precedes the figures is the leading 'Persons', so the last name
    before a page's first column is dropped too -- but only on a weak spelling signal as
    well, since a page might not have emitted that caption and the name would be a real
    ward. Dropping a real ward is not silent: its district then fails oracle (a) and is
    rejected rather than mis-stated.
    """
    pre = [i for i, (s, n) in enumerate(names) if n < COLCAP]
    cap = pre[-1] if pre else -1
    ents = []
    for idx, (s, nfig) in enumerate(names):
        if nfig >= COLCAP:
            continue
        c = clean(s)
        if not c:
            continue
        if idx == cap and not district_of(c) and difflib.SequenceMatcher(
                None, re.sub(r'[^a-z]', '', c.lower()), 'persons').ratio() >= 0.40:
            continue
        d = district_of(c)
        if re.match(r'^northern\s+ireland$', c, re.I):
            ents.append(('ni', 'NORTHERN IRELAND'))
        elif d:
            ents.append(('district', d))
        else:
            ents.append(('ward', c))
    return ents


V = 4          # how far the shortlister lets a column drift before it stops looking


def bounds(seq, ncol, S0=6, topn=5):
    """Rank candidate cut points for the NEXT triple in seq, as ABSOLUTE indices.

    Returns up to topn candidates (p0, p1, p2, p3), best first, meaning
    A = seq[p0:p1], B = seq[p1:p2], C = seq[p2:p3].

    THE SCORE IS DRIFT-TOLERANT, which the obvious one is not. Comparing A[i] with
    B[i]+C[i] at a FIXED offset means one dropped token part-way down a column
    invalidates every comparison below it, so the true split can score below a false
    one: on run 0's 1981 half the true (0,60,121) scored 15 against 22 for (0,59,120),
    one token early in both cuts. That cost the entire page, because the aligner then
    opened by imputing a row out of the two stray tokens -- cheaper than skipping them --
    and every entity shifted down by one. Here A[i] may instead pair with any B[j] and
    C[k] within V positions of i, which a value->positions index makes cheap enough to
    run over every candidate rather than a sample.

    SEVERAL CANDIDATES, NOT ONE, because even this is only a shortlister; it accepts a
    pairing anywhere in the window without requiring the choices to be consistent down
    the column. The alignment is the only scorer that enforces that, so the shortlist is
    handed to it and it makes the final choice.

    p0 IS SEARCHED. It used to be pinned at 0, and that quietly cost the single most
    valuable row in the table: run 0 opens with a stray '195' before the first real
    figure, so every candidate column A carried that token and the whole triple shifted
    by one. The search then settled on a CONSISTENTLY shifted alignment -- internally
    coherent, scoring 61 of 62 -- under which Northern Ireland's control row read
    3,145 = 2,104 + 1,041 instead of 1,536,065. A wrong answer that satisfies oracle (b)
    is exactly what this parser has to avoid, and one extra loop removes the class.

    The window comes from the TOKEN COUNT, not from the name count: ncol is how many
    columns seq still holds (6 for a whole run, 3 for its second half). Deriving it from
    the name count instead was tried and is WORSE -- junk names inflate R on runs 3-8,
    which puts the window in the wrong place and collapses those runs to ~1 hit.

    C's end is not searched. Score counts hits over i < min(column lengths) and so is
    monotone in that length, which makes the widest C always at least as good -- the
    third loop only ever confirmed its own upper bound. C's end is estimated by symmetry
    with B and then corrected by the alignment, which measures it properly.
    """
    n, out = len(seq), []
    N = max(2, n // ncol)
    lo, hi = max(2, N - 9), N + 10
    for p0 in range(0, S0):
        sub = seq[p0:]
        m = len(sub)
        pos = {}
        for idx, v in enumerate(sub):
            pos.setdefault(v, []).append(idx)
        for b1 in range(lo, min(hi, m)):
            for b2 in range(b1 + lo, min(b1 + hi, m)):
                lb, lc = b2 - b1, m - b2
                k = min(b1, lb, lc)
                if k < 2:
                    continue
                sc = 0
                for i in range(k):
                    a = sub[i]
                    for j in range(max(0, i - V), min(lb, i + V + 1)):
                        want = a - sub[b1 + j]
                        if want <= 0:
                            continue
                        for q in pos.get(want, ()):
                            kk = q - b2
                            if 0 <= kk < lc and abs(kk - i) <= V:
                                sc += 1
                                break
                        else:
                            continue
                        break
                b3 = min(m, b2 + (b2 - b1))
                out.append((sc, (p0, p0 + b1, p0 + b2, p0 + b3)))
    out.sort(key=lambda t: -t[0])
    seen, cand = set(), []
    for _, c in out:
        if c[:3] in seen:
            continue
        seen.add(c[:3])
        cand.append(c)
        if len(cand) >= topn:
            break
    return cand


NEG = float('-inf')


RLO, RHI = 0.45, 2.40      # a ward's 1981 population over its 1971 one, generously
REF = 0.45                 # weight on that agreement, per row


def dp(A, B, C, R, ref=None, W=7, D=6, GAP=-0.5, NM=-0.5, IMP=0.25):
    """Align three columns into EXACTLY R rows, deriving values the OCR lost.

    Two changes from the plain three-way Needleman-Wunsch this replaces, and both were
    forced by the same measured failure -- the 1981 half of a page returning 1-3 fewer
    rows than the 1971 half, which cannot be right when the two halves describe the same
    wards in the same order.

    IMPUTED ROWS. When the scanner drops a numeric token the row it belonged to is gone,
    and no alignment can put it back: that is why row counts came up short rather than
    merely misaligned. But PERSONS == MALES + FEMALES means any TWO of the three columns
    determine the third, so a row may consume two tokens and DERIVE the missing one.
    This is arithmetic, not a guess.

      row     one token from each column                match scored, or NM if it fails
      imputeC one from A and B, F  := P - M             IMP
      imputeB one from A and C, M  := P - F             IMP
      imputeA one from B and C, P  := M + F             IMP
      skip    one token, no row                         GAP

    Imputation cannot be allowed to launder a bad alignment, because an imputed row
    satisfies oracle (b) BY CONSTRUCTION -- so (b) is reported over verified rows only.
    Oracle (a), the district checksum, stays honest: a wrongly imputed ward breaks its
    district's sum exactly as a wrongly aligned one does. That is what makes this safe.

    ROW COUNT AS A DIMENSION. The old code searched the gap penalty hoping the emitted
    row count would land near the name count. It is pinned instead: the state carries
    d = (rows emitted) - (tokens of A consumed), which every move shifts by a known
    amount, and only d == R - len(A) is accepted as terminal. Exactly R rows come out or
    nothing does. d stays within a narrow band, so this costs one dimension of size 2D+1
    rather than one of size R.
    """
    la, lb, lc = len(A), len(B), len(C)
    target = R - la
    if abs(target) > D:
        return None
    layers = [dict() for _ in range(la + 1)]
    layers[0][(0, 0, 0)] = 0.0
    BK = {}
    for i in range(la + 1):
        cur = layers[i]
        if not cur:
            continue
        nxt = layers[i + 1] if i < la else None
        buckets = {}
        for key in cur:
            buckets.setdefault(key[0] + key[1], []).append(key)
        for s in range(0, lb + lc + 1):
            q = buckets.get(s)
            if not q:
                continue
            qi = 0
            while qi < len(q):
                j, k, d = q[qi]
                qi += 1
                cu = cur[(j, k, d)]
                mv = []
                if i < la and j < lb and k < lc:
                    mv.append((1, 1, 1, 0, 1.0 if A[i] == B[j] + C[k] else NM, 'M'))
                if i < la and j < lb and A[i] - B[j] > 0:
                    mv.append((1, 1, 0, 0, IMP, 'C'))
                if i < la and k < lc and A[i] - C[k] > 0:
                    mv.append((1, 0, 1, 0, IMP, 'B'))
                if j < lb and k < lc:
                    mv.append((0, 1, 1, 1, IMP, 'A'))
                if i < la:
                    mv.append((1, 0, 0, -1, GAP, None))
                if j < lb:
                    mv.append((0, 1, 0, 0, GAP, None))
                if k < lc:
                    mv.append((0, 0, 1, 0, GAP, None))
                for di, dj, dk, dd, w, tag in mv:
                    ni, nj, nk, nd = i + di, j + dj, k + dk, d + dd
                    if abs(nj - ni) > W or abs(nk - ni) > W or abs(nd) > D:
                        continue
                    # Agreement with the OTHER year-half, which is the only evidence
                    # that can place a dropped row. A block shifted by one satisfies
                    # PERSONS == MALES + FEMALES perfectly -- all three columns move
                    # together -- so oracle (b) is blind to exactly this failure. Ward
                    # populations between the two censuses are not: Toome held 2,058
                    # people in 1971, so the 57,598 the shift handed it (Ards's district
                    # total) is impossible and the correct placement is not.
                    if ref is not None and tag:
                        r = i + d
                        if 0 <= r < len(ref) and ref[r] > 0:
                            got = (B[j] + C[k]) if tag == 'A' else A[i]
                            w += REF if RLO <= got / ref[r] <= RHI else -REF
                    tgt = nxt if di else cur
                    if tgt is None:
                        continue
                    v = cu + w
                    nkey = (nj, nk, nd)
                    if v > tgt.get(nkey, NEG):
                        fresh = nkey not in tgt
                        tgt[nkey] = v
                        BK[(ni, nj, nk, nd)] = ((i, j, k, d), tag,
                                                A[i] if di else None,
                                                B[j] if dj else None,
                                                C[k] if dk else None)
                        if di == 0 and fresh:
                            buckets.setdefault(nj + nk, []).append(nkey)
    end = layers[la]
    best = None
    for (j, k, d), v in end.items():
        if d == target and (best is None or v > best[1]):
            best = ((la, j, k, d), v)
    if best is None:
        return None
    term, score = best
    st, rows = term, []
    while st in BK:
        pr, tag, a, b, c = BK[st]
        if tag == 'M':
            rows.append((a, b, c, ''))
        elif tag == 'C':
            rows.append((a, b, a - b, 'C'))
        elif tag == 'B':
            rows.append((a, a - c, c, 'B'))
        elif tag == 'A':
            rows.append((b + c, b, c, 'A'))
        st = pr
    rows.reverse()
    return rows, score, (term[1], term[2])


def _try(seq, R, p, W, ref):
    p0, p1, p2, p3 = p
    A = seq[p0:p1]
    B = seq[p1:min(len(seq), p2 + W)]
    C = seq[p2:min(len(seq), p3 + W)]
    return dp(A, B, C, R, ref=ref, W=W)


def fit(seq, R, ncol, W=7, ref=None):
    """Align one 3-column half into exactly R rows.

    Two stages. First the shortlist from bounds() is scored BY THE ALIGNMENT -- the
    cheap fixed-offset scorer that produced the shortlist cannot rank it, since a single
    dropped token invalidates every comparison below it.

    Then the winner is refined. B's end and C's start are the SAME cut, but bounds only
    estimates it; the alignment measures it, as term[0], the tokens of B it actually
    consumed. The cut moves there and the fit re-runs until it stops moving, usually
    once. Correcting C's end this way was worth 90% -> 93% on its own; correcting B's
    end is what lets the second half of a page start in the right place at all.
    """
    cands = bounds(seq, ncol)
    if not cands:
        return None
    best = None
    for c in cands:
        got = _try(seq, R, c, W, ref)
        if got and (best is None or got[1] > best[0][1]):
            best = (got, c)
    if best is None:
        return None
    (rows, score, term), b = best
    p0, p1, p2, p3 = b
    out, seen = (rows, score, p2 + term[1]), {p2}
    for _ in range(3):
        np2 = p1 + term[0]
        if np2 in seen:
            break
        seen.add(np2)
        p3 += np2 - p2
        p2 = np2
        got = _try(seq, R, (p0, p1, p2, p3), W, ref)
        if not got:
            break
        rows, score, term = got
        if score > out[1]:
            out = (rows, score, p2 + term[1])
    return out[0], b, out[2]


def align_run(names, run):
    """Align one page run into (entities, 1971 rows, 1981 rows), or None.

    Each half is aligned, then re-aligned against the other. Neither half is reliably
    the better one -- Antrim and Ards come out perfect in 1971 and shifted in 1981,
    Londonderry and Magherafelt the other way round -- so the pass runs in both
    directions rather than trusting a fixed order.
    """
    ents = entities(names)
    R = len(ents)
    f1 = fit(run, R, 6)
    if not f1:
        return ents, None, None
    a1, _, end1 = f1
    f2 = fit(run[end1:], R, 3, ref=[x[0] for x in a1])
    if not f2:
        return ents, a1, None
    a2 = f2[0]
    f1b = fit(run, R, 6, ref=[x[0] for x in a2])
    if f1b:
        a1, _, e1b = f1b
        f2b = fit(run[e1b:], R, 3, ref=[x[0] for x in a1])
        if f2b:
            a2 = f2b[0]
    return ents, a1, a2


def main():
    print("=" * 84)
    print("1981 Census Table 4 - ward population under the 1973 District Councils")
    all_rows, rejected, agree, total, imp = [], [], 0, 0, 0
    for ri, (names, run) in enumerate(page_runs()):
        ents, a1, a2 = align_run(names, run)
        R = len(ents)
        if a1 is None or a2 is None:
            rejected.append((ri, f'no alignment into {R} rows'))
            continue
        # oracle (b) counts VERIFIED rows only -- an imputed row satisfies it by
        # construction, so counting those would make the number self-congratulatory.
        v1 = [x for x in a1 if not x[3]]
        v2 = [x for x in a2 if not x[3]]
        o1 = sum(1 for x in v1 if x[0] == x[1] + x[2])
        o2 = sum(1 for x in v2 if x[0] == x[1] + x[2])
        n_imp = sum(1 for x in a1 + a2 if x[3])
        imp += n_imp
        agree += o1 + o2
        total += len(v1) + len(v2)
        print(f"  run {ri}: names {R:3}  1971 {o1:3}/{len(v1):<3} 1981 {o2:3}/{len(v2):<3}"
              f"  verified {o1+o2:3}/{2*R:<3}  imputed {n_imp}")
        for i, (kind, nm) in enumerate(ents):
            all_rows.append({'kind': kind, 'name': nm, 'run': ri,
                             'imputed': (a1[i][3] or '') + (a2[i][3] or ''),
                             **dict(zip(COLS, list(a1[i][:3]) + list(a2[i][:3])))})
    print(f"\n  oracle (b) on verified rows: {agree}/{total} = "
          f"{100*agree/max(1,total):.1f}%   ({imp} values imputed)")
    print(f"  runs rejected: {len(rejected)}")
    for r in rejected:
        print(f"      run {r[0]}: {r[1]}")

    # --- oracle (a): a district's wards must sum to its printed total.
    #
    # The names and the figures are allowed to sit at DIFFERENT OFFSETS. A page whose
    # name stream lost an entry -- a ward the scanner rendered as bare leader dots --
    # or gained one from a mangled column header labels every row below it with its
    # neighbour's figures, and the shift is cumulative down the page. Rather than
    # assume no shift, each district is looked for at a small range of offsets and
    # kept at whichever one makes all six columns sum. That cannot launder a bad
    # parse: six exact equalities over 15 to 51 wards do not come out right by
    # coincidence, so the checksum is still deciding, not the search.
    di = [i for i, r in enumerate(all_rows) if r['kind'] == 'district']
    groups, kept, failed = [], [], []
    for n, i in enumerate(di):
        end = di[n + 1] if n + 1 < len(di) else len(all_rows)
        wname = [r['name'] for r in all_rows[i + 1:end] if r['kind'] == 'ward']
        k = len(wname)
        if not k:
            continue
        hit = None
        for o in (0, 1, -1, 2, -2, 3, -3):
            j = i + o
            if j < 0 or j + k >= len(all_rows):
                continue
            tot, blk = all_rows[j], all_rows[j + 1:j + 1 + k]
            if all(sum(w[c] for w in blk) == tot[c] for c in COLS):
                hit = (o, tot, blk)
                break
        g = {'district': all_rows[i]['name'], 'wards': k}
        groups.append(g)
        if hit is None:
            failed.append((g['district'], k, sum(
                1 for c in COLS
                if sum(w[c] for w in all_rows[i + 1:i + 1 + k]) != all_rows[i][c])))
            continue
        o, tot, blk = hit
        g.update({'offset': o, 'total': tot,
                  'rows': [dict(v, name=nm) for nm, v in zip(wname, blk)]})
        kept.append(g)
    print(f"\n  districts checksummed: {len(groups)}   PASS {len(kept)}   FAIL {len(failed)}")
    for d, n, b in failed[:14]:
        print(f"      FAIL {d:24} {n:3} wards, {b}/6 columns off")
    if kept:
        print("\n  PASSING districts:")
        for g in kept:
            sh = '' if not g['offset'] else f"  names shifted {g['offset']:+d}"
            print(f"      {g['district']:24} {g['wards']:3} wards  "
                  f"1971 {g['total']['pop_1971_persons']:>9,}{sh}")
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
                for wd in g['rows']:
                    w.writerow({'district': g['district'], 'ward': wd['name'],
                                **{c: wd[c] for c in COLS}})
        print(f"\n  wrote {p}")
    else:
        print(f"\n  NOT WRITING OUTPUT - {len(failed)} districts fail their checksum.")


if __name__ == '__main__':
    main()
