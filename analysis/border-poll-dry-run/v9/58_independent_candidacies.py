#!/usr/bin/env python3
"""v9 phase 58 — the strongest independent candidacies in NI, 1970-2024.

Motivated by phase 57, where the independent vote turned out to be the single largest
confound in measuring bloc change: NI-wide Independent+Other fell 10.3% -> 5.4% between
the 2001 and 2023 local elections, and corr(bloc change, change in independent share)
was -0.576 across DEAs. If independents move results that much, it is worth knowing
where they have actually been strong.

WHO COUNTS AS INDEPENDENT. Three tiers, because the honest answer depends on the
definition and the biggest cases sit outside the obvious one.

  A  labelled Independent*  -- 'Independent', 'Independent Unionist',
     'Independent Nationalist', 'Independent Other', and the handful of
     'Independent (Name)' variants. The literal reading of the question.

  B  non-party banner candidacies -- 'Anti H-Block' (Bobby Sands, Owen Carron 1981)
     and 'Unity' (Bernadette Devlin, Frank McManus and others, 1970). These stood
     under an agreed label rather than a party: no manifesto, no organisation, no
     other candidates elsewhere in the same contest under a common whip. They are
     independents in substance and they are the largest results in the whole series,
     so burying them under a label test would be misleading.

  C  excluded, despite the name -- 'Irish Independence Party', 'Ulster Independence
     Movement', "Ulster's Independent Voice". These are parties; the word
     "independence" in the title is about the constitutional question, not the
     candidate's status.

COMPARING ACROSS VOTING SYSTEMS. Westminster is first-past-the-post in single-member
seats, so a share is directly interpretable. Assembly, local and European contests are
STV in multi-member areas, where the arithmetic ceiling on any one candidate's first
preferences is far lower -- a 6-seat DEA has a quota of about 14.3%. Raw shares are
therefore NOT comparable across the two, and this phase reports STV results in QUOTAS
(share x (seats+1) / 100) alongside the share. One quota is election on the first count.

Source: render/metadata/elections-test2, NI bodies only, 66 contests 1970-2024.
Output: independent_candidacies.csv, independent_summary.json
"""
import os, sys, re, json, glob, collections
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')

NI_BODIES = {
    'house-of-commons-of-the-united-kingdom': 'Westminster',
    'northern-ireland-assembly': 'Assembly',
    'local-government-local-government-districts': 'Local',
    'european-parliament': 'European',
    'northern-ireland-constitutional-convention': 'Convention',
    'northern-ireland-forum-for-political-dialogue': 'Forum',
    'parliament-of-northern-ireland': 'Stormont',
    'local-government-mid-and-east-antrim': 'Local',
}
TIER_A = re.compile(r'^independent\b|^independent[ -(]', re.I)
TIER_B = {'anti h-block', 'unity', 'unity (northern ireland)'}
NOT_IND = {'irish independence party', 'ulster independence movement',
           "ulster's independent voice"}


def tier(party):
    p = (party or '').strip()
    low = p.lower()
    if low in NOT_IND:
        return None
    if TIER_A.match(p):
        return 'A'
    if low in TIER_B:
        return 'B'
    return None


def load():
    rows = []
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        base = os.path.basename(f)
        body = base.split('__')[0]
        if body not in NI_BODIES:
            continue
        m = re.search(r'(\d{4})', base.split('__')[1])
        if not m:
            continue
        year = int(m.group(1))
        if not (1970 <= year <= 2024):
            continue
        d = json.load(open(f, encoding='utf-8'))
        byel = bool(d.get('isByElection'))
        title = d.get('displayTitle') or base
        # Feb and Oct 1974 share a displayTitle, as do same-year by-elections; keep the
        # date so the two are distinguishable in the output file.
        date = d.get('date') or base.split('__')[1].replace('.json', '')
        for r in d['results']:
            cs = r.get('candidates') or []
            if not cs:
                continue
            tot = float(r.get('validPoll') or 0) or sum(
                float(c.get('firstPrefs') or 0) for c in cs)
            if tot <= 0:
                continue
            seats = int(r.get('seatsTotal') or 1)
            for c in cs:
                t = tier(c.get('party'))
                if not t:
                    continue
                fp = float(c.get('firstPrefs') or 0)
                rows.append({
                    'year': year, 'date': date, 'body': NI_BODIES[body],
                    'byelection': byel, 'contest': title, 'area': str(r['constituency']).strip(),
                    'council': (c.get('district') or '').strip(),
                    'name': (c.get('name') or '?').strip(),
                    'party': (c.get('party') or '').strip(), 'tier': t,
                    'votes': fp, 'valid': tot, 'seats': seats,
                    'share': 100.0 * fp / tot,
                    'quotas': (100.0 * fp / tot) * (seats + 1) / 100.0,
                    'elected': bool(c.get('elected')),
                })
    return pd.DataFrame(rows)


def totals():
    """NI-wide independent share of the valid vote, per contest."""
    out = []
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        base = os.path.basename(f)
        body = base.split('__')[0]
        if body not in NI_BODIES:
            continue
        m = re.search(r'(\d{4})', base.split('__')[1])
        if not m:
            continue
        year = int(m.group(1))
        if not (1970 <= year <= 2024):
            continue
        d = json.load(open(f, encoding='utf-8'))
        if d.get('isByElection'):
            continue
        va = ia = ib = 0.0
        nareas = 0
        rs = d['results']
        # The 1996 Forum file carries a synthetic NI-wide row for the regional top-up
        # list alongside the 18 constituencies. Those are the SAME ballots counted a
        # second time, so including it doubles the contest's valid poll. Drop any
        # NI-wide/synthetic row whenever real areas exist alongside it (the European
        # contests are a single genuine NI-wide constituency and must survive).
        if len(rs) > 1:
            rs = [r for r in rs if not r.get('syntheticRegion')
                  and str(r.get('constituency')).strip().lower() != 'northern ireland']
        for r in rs:
            cs = r.get('candidates') or []
            if not cs:
                continue
            tot = float(r.get('validPoll') or 0) or sum(
                float(c.get('firstPrefs') or 0) for c in cs)
            if tot <= 0:
                continue
            nareas += 1
            va += tot
            for c in cs:
                t = tier(c.get('party'))
                if t == 'A':
                    ia += float(c.get('firstPrefs') or 0)
                elif t == 'B':
                    ib += float(c.get('firstPrefs') or 0)
        if va > 0:
            # source defect: the Jan-1986 file is titled a general election and carries
            # isByElection=False, but it is the 15 simultaneous by-elections forced by
            # the unionist MPs' resignations over the Anglo-Irish Agreement.
            note = 'by-elections (mislabelled in source)' if (
                year == 1986 and NI_BODIES[body] == 'Westminster') else ''
            out.append({'year': year, 'body': NI_BODIES[body], 'note': note,
                        'contest': d.get('displayTitle') or base, 'areas': nareas,
                        'valid': va, 'indA_pct': 100 * ia / va,
                        'indB_pct': 100 * ib / va,
                        'indAB_pct': 100 * (ia + ib) / va})
    return pd.DataFrame(out).sort_values(['year', 'body'])


SLUG = re.compile(r'^lg\d\d-([A-Za-z]+)-(.*)$')
COUNCIL_ABBR = {'NaM': 'Newry and Mourne', 'NoD': 'North Down'}


def tidy_area(area, council=''):
    """Some local DEAs are unmatched source slugs (lg93-NoD-Ballyholme-&-Groomsport,
    lg73-NaM-Area-C) or carry a trailing 'corrected'. Render them readably; the raw
    value is preserved in the `area` column."""
    a = str(area).strip()
    m = SLUG.match(a)
    if m:
        a = m.group(2).replace('-', ' ').replace('&', 'and')
    a = re.sub(r'\s+corrected$', '', a, flags=re.I)
    return a


def show(df, n, cols, title, by='share'):
    print("\n" + "-" * 96)
    print(title)
    d = df.sort_values(by, ascending=False).head(n)
    hdr = {'share': 'share', 'quotas': 'quotas'}
    print(f"  {'year':5} {'area':26} {'candidate':26} {'label':20} "
          f"{'votes':>7} {'share':>6} {'quotas':>7} {'el':>3}")
    for _, r in d.iterrows():
        q = f"{r.quotas:7.2f}" if r.seats > 1 else "      -"
        print(f"  {r.year:<5} {r.area[:26]:26} {r['name'][:26]:26} "
              f"{r.party[:20]:20} {r.votes:7,.0f} {r.share:5.1f}% {q} "
              f"{'Y' if r.elected else '':>3}")


def main():
    print("=" * 96)
    print("PHASE 58 — strongest independent candidacies in Northern Ireland, 1970-2024")
    df = load()
    df.to_csv(os.path.join(HERE, 'independent_candidacies.csv'), index=False)
    print(f"\n  {len(df):,} independent candidacies across "
          f"{df.contest.nunique()} contests, {df.year.min()}-{df.year.max()}")
    print(f"  tier A (labelled Independent*) {(df.tier=='A').sum():,}   "
          f"tier B (Unity / Anti H-Block) {(df.tier=='B').sum():,}")
    print(f"  elected: {int(df.elected.sum()):,}")

    A = df[df.tier == 'A']
    B = df[df.tier == 'B']

    show(B, 12, None, "TIER B — non-party banner candidacies (the largest in the series)")

    w = A[A.body == 'Westminster']
    show(w[~w.byelection], 12, None,
         "TIER A, WESTMINSTER general elections (FPTP, single-member: share is directly comparable)")
    if w.byelection.any():
        show(w[w.byelection], 6, None, "TIER A, WESTMINSTER by-elections")

    loc = A[A.body == 'Local']
    show(loc, 15, None,
         "TIER A, LOCAL government by DEA (STV multi-member — rank by QUOTAS, share shown for reference)",
         by='quotas')
    show(loc, 8, None, "TIER A, LOCAL government by DEA — highest raw SHARE")

    asm = A[A.body.isin(['Assembly', 'Convention', 'Forum'])]
    show(asm, 12, None,
         "TIER A, ASSEMBLY / Convention / Forum by constituency (STV — rank by QUOTAS)",
         by='quotas')

    eur = A[A.body == 'European']
    if len(eur):
        show(eur, 8, None, "TIER A, EUROPEAN (NI-wide single 3-seat constituency)")

    # ---------------- NI-wide ----------------
    T = totals()
    print("\n" + "-" * 96)
    print("NI-WIDE independent share of the valid vote, by contest (general elections only)")
    print(f"  {'year':5} {'body':11} {'areas':>5} {'valid':>10} {'tier A':>8} "
          f"{'tier B':>8} {'A+B':>8}")
    for _, r in T.iterrows():
        print(f"  {r.year:<5} {r.body:11} {r.areas:5.0f} {r.valid:10,.0f} "
              f"{r.indA_pct:7.2f}% {r.indB_pct:7.2f}% {r.indAB_pct:7.2f}%"
              f"  {r.note}")
    print("\n  peak tier-A NI-wide share: "
          f"{T.indA_pct.max():.2f}% ({T.loc[T.indA_pct.idxmax(),'contest']})")
    for b in ['Westminster', 'Local', 'Assembly']:
        s = T[T.body == b]
        if len(s) > 1:
            print(f"  {b:11} tier-A trend: {s.iloc[0].year} {s.iloc[0].indA_pct:.2f}%"
                  f"  ->  {s.iloc[-1].year} {s.iloc[-1].indA_pct:.2f}%"
                  f"   (peak {s.indA_pct.max():.2f}% in {int(s.loc[s.indA_pct.idxmax(),'year'])})")

    T.to_csv(os.path.join(HERE, 'independent_ni_totals.csv'), index=False)
    json.dump({'candidacies': int(len(df)), 'elected': int(df.elected.sum()),
               'peak_tierA_ni': float(T.indA_pct.max()),
               'top_tierB': B.sort_values('share', ascending=False)
               .head(5)[['year', 'area', 'name', 'party', 'share']].to_dict('records'),
               'top_tierA_westminster': w.sort_values('share', ascending=False)
               .head(5)[['year', 'area', 'name', 'share', 'byelection']].to_dict('records'),
               'top_tierA_local_quotas': loc.sort_values('quotas', ascending=False)
               .head(5)[['year', 'area', 'name', 'share', 'quotas', 'seats']].to_dict('records'),
               }, open(os.path.join(HERE, 'independent_summary.json'), 'w'), indent=1)
    print("\n  wrote independent_candidacies.csv, independent_ni_totals.csv, "
          "independent_summary.json")


if __name__ == '__main__':
    main()
