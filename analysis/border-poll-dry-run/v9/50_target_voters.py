#!/usr/bin/env python3
"""v9 phase 50 — WHO and WHERE: the voters whose movement delivers 46/90.

Chains everything: the 2022 result, the mixed-channel cost model (phase 49), the
DZ-level party mosaic (phase 32), the measured switching matrix (phase 48), census
composition and the LPS valuation/era data.

For each of the ten cheapest constituencies it walks that constituency's Data Zones
in descending order of expected yield and stops when the seat's gap is covered. The
resulting Data Zones are the target geography; the people in them, in the three
movable categories, are the target voters.

Expected yield per Data Zone, using the OBSERVED transition rates:

    Green voters      x 12.9%  -> closes 2 votes of gap each (conversion)
    Alliance voters   x 11.4%  -> closes 2 votes of gap each (conversion)
    non-voters        x 22.4%  -> closes 1 vote of gap each  (mobilisation)

Unionist conversion (DUP 1.3%, UUP 1.6%) and demobilisation are available but are
7-14x more expensive per vote of gap, so they are only drawn on where the cheap
channels in that constituency are exhausted.

The profile is then reported as a CONTRAST against the NI average -- a target group
that looks exactly like Northern Ireland would not be a useful target.
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))

M = json.load(open(os.path.join(HERE, 'switching_matrix.json'), encoding='utf-8'))
BLOC = ['Sinn Féin', 'SDLP', 'PBP', 'Aontú']
P_GREEN = sum(M.get('Green', {}).get(b, 0) for b in BLOC)
P_ALLI = sum(M.get('Alliance', {}).get(b, 0) for b in BLOC)
P_NV = sum(M.get('DidNotVote', {}).get(b, 0) for b in BLOC)
VOTING_AGE = 0.796          # NI voting-age share of residents (v9 electorate work)


def main():
    seats = pd.read_csv(os.path.join(HERE, 'mixed_channel_seats.csv'))
    seats = seats[np.isfinite(seats.reach)].sort_values('reach').head(10)
    targets = {str(a).upper().strip(): g for a, g in zip(seats.area, seats.gap)}
    print("=" * 78)
    print("TARGET VOTERS FOR 46/90 — who, where, and what they look like")
    print(f"\n  ten cheapest constituencies, total gap "
          f"{seats.gap.sum():,.0f} votes, {seats.reach.sum():,.0f} voters to reach")

    dzmos = pd.read_csv(os.path.join(HERE, 'notional', 'assembly2022_DZ21.csv'),
                        index_col=0)
    con = json.load(open(os.path.join(HERE, 'dz_constituency.json'), encoding='utf-8'))
    pop = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'ms-a01-dz.csv'))
    pop = pop.set_index('GeographyCode').AllUsualResidents.astype(float)
    cens = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')
    lps = pd.read_csv(os.path.join(HERE, 'lps', 'lps_full_dz.csv')).set_index('area')

    # per-constituency turnout, to size the non-voter pool
    raw = json.load(open(os.path.join(REPO, 'test', 'metadata', 'elections-test2',
                                      'northern-ireland-assembly__2022-05-05.json'),
                         encoding='utf-8'))
    turn = {str(r['constituency']).upper().strip():
            float(r.get('validPoll') or 0) / max(float(r.get('electorate') or 1), 1)
            for r in raw['results']}

    rows = []
    for dz in dzmos.index:
        c = str(con.get(dz, '')).upper().strip()
        if c not in targets:
            continue
        adults = float(pop.get(dz, 0.0)) * VOTING_AGE
        t = turn.get(c, 0.63)
        voters = adults * t
        g = voters * dzmos.at[dz, 'Green'] / 100.0
        a = voters * dzmos.at[dz, 'Alliance'] / 100.0
        nv = adults * (1 - t)
        rows.append({'dz': dz, 'con': c, 'adults': adults,
                     'green': g, 'alliance': a, 'nonvoter': nv,
                     'gap_yield': 2 * g * P_GREEN + 2 * a * P_ALLI + nv * P_NV})
    D = pd.DataFrame(rows)

    # greedily select Data Zones within each constituency until its gap is covered
    picked = []
    for c, need in targets.items():
        sub = D[D.con == c].sort_values('gap_yield', ascending=False)
        acc = 0.0
        for _, r in sub.iterrows():
            if acc >= need:
                break
            picked.append(r.dz)
            acc += r.gap_yield
        print(f"  {c:28} gap {need:6.0f}  covered by "
              f"{len([p for p in picked if D.set_index('dz').at[p,'con']==c]):3} DZs"
              f"{'' if acc >= need else '  (NOT covered: cheap channels exhausted)'}")

    T = D[D.dz.isin(picked)]
    T.to_csv(os.path.join(HERE, 'target_voters_dz.csv'), index=False)
    print(f"\n  TARGET GEOGRAPHY: {len(T)} Data Zones of {len(dzmos)} in NI "
          f"({100*len(T)/len(dzmos):.1f}%)")
    print(f"    Green voters     {T.green.sum():9,.0f}")
    print(f"    Alliance voters  {T.alliance.sum():9,.0f}")
    print(f"    non-voters       {T.nonvoter.sum():9,.0f}")
    print(f"    TOTAL addressable {T[['green','alliance','nonvoter']].sum().sum():8,.0f}"
          f"  of {T.adults.sum():,.0f} adults in those DZs")

    # ---------------- profile: target DZs vs NI ----------------
    tz = [d for d in T.dz if d in cens.index]
    w = pop.reindex(tz).fillna(0).values
    wn = pop.reindex(cens.index).fillna(0).values

    def cmp(df, cols, title):
        print(f"\n  {title}")
        print(f"    {'attribute':52} {'target':>8} {'NI':>8} {'diff':>7}")
        out = []
        for c in cols:
            if c not in df.columns:
                continue
            t = np.average(df.reindex(tz)[c].fillna(0).values, weights=w)
            n = np.average(df[c].fillna(0).values, weights=wn)
            out.append((c, t, n, t - n))
        for c, t, n, d in sorted(out, key=lambda r: -abs(r[3]))[:8]:
            print(f"    {c[:52]:52} {t:8.1f} {n:8.1f} {d:+7.1f}")

    cmp(cens, [c for c in cens.columns if c.startswith(('rel__', 'natid__'))],
        "CENSUS — religion and national identity")
    cmp(cens, [c for c in cens.columns if c.startswith(('ten__', 'qual__', 'age__'))],
        "CENSUS — tenure, qualifications, age")
    cmp(lps, ['lpsf_era_pre1919', 'lpsf_era_1946_1965', 'lpsf_era_1966_1990',
              'lpsf_era_post1990', 'lpsf_form_detached', 'lpsf_form_semi',
              'lpsf_form_terrace', 'lpsf_form_apartment', 'lpsf_public_built',
              'lpsf_cv_median', 'lpsf_size_median'],
        "LPS — housing era, form and valuation")

    print("\n  HOW THEY POLL (from the switching matrix, by current vote):")
    for lab, p in [('Green voters', P_GREEN), ('Alliance voters', P_ALLI),
                   ('2022 non-voters', P_NV)]:
        print(f"    {lab:18} say pro-unity party next time: {100*p:5.1f}%")
    print(f"    {'DUP voters':18} say pro-unity party next time: "
          f"{100*sum(M.get('DUP',{}).get(b,0) for b in BLOC):5.1f}%  (for contrast)")


if __name__ == '__main__':
    main()
