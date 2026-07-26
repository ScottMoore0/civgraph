#!/usr/bin/env python3
"""v9 phase 39 — Tier 1: Westminster 1997/2001/2005, vintage-matched.

Phase 37 showed Westminster's binding constraint is SAMPLE SIZE: 5 contests x 18 =
90 rows, too few to afford a type-separated ridge. 1997, 2001 and 2005 are in the
repo with full candidate data and would take it to 144 -- a 60% increase.

Two obstacles, and how each is handled.

BOUNDARIES. Those contests ran on the 1995 review; the repo has OSNI boundary files
for 2008 and 2023 only, so no exact DZ -> 1995 crosswalk can be built. The 1995 and
2008 sets share all 18 constituency NAMES and the 2008 review was a minor revision,
so 2008 geography is used as an approximation. That is an assumption, recorded here,
not a derivation -- and it is much smaller than the second problem.

CENSUS VINTAGE. Predicting a 1997 election from 2021 demography is anachronistic:
the Catholic share rose several points over the period, which is precisely the
variable the model leans on hardest. `data/census/derived/dz21-census-1991.csv`
carries the 1991 census at DZ2021 level, so a genuinely vintage-matched feature set
is available.

The two vintages do not share the 88-feature schema, so a HARMONISED subset is used
-- the variables present in both -- and each contest is given its nearest vintage:

    1997, 2001, 2005      -> 1991 census
    2010, 2015, 2017,
    2019, 2024            -> 2021 census

Tested: does the Westminster model improve with 8 contests and vintage-matched
harmonised features, versus 5 contests on the full 2021 schema?
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
PARTIES = pm.PARTIES

CONTESTS = [
    (1997, 'house-of-commons-of-the-united-kingdom__1997-05-01.json', 1991),
    (2001, 'house-of-commons-of-the-united-kingdom__2001-06-07.json', 1991),
    (2005, 'house-of-commons-of-the-united-kingdom__2005-05-05.json', 1991),
    (2010, 'house-of-commons-of-the-united-kingdom__2010-05-06.json', 2021),
    (2015, 'house-of-commons-of-the-united-kingdom__2015-05-07.json', 2021),
    (2017, 'house-of-commons-of-the-united-kingdom__2017-06-08.json', 2021),
    (2019, 'house-of-commons-of-the-united-kingdom__2019-12-12.json', 2021),
    (2024, 'house-of-commons-of-the-united-kingdom__2024-07-04.json', 2021),
]
IND = {'Independent', 'Independent Other', 'Independent Unionist',
       'Independent Nationalist'}
MAIN = ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP', 'Aontú']

# harmonised variables: 1991 column -> how to build the 2021 equivalent
HARM = {
    'catholic':    ('rc_pct',            ['rel__Catholic']),
    'protestant':  ('protestant_pct',    ['rel__Protestant and Other Christian (including Christian rel']),
    'no_religion': ('none_relig_pct',    ['rel__None']),
    'irish_speak': ('irish_speak_pct',   ['irish__Speaks but does not read or write Irish',
                                          'irish__Speaks and reads but does not write Irish',
                                          'irish__Speaks, reads, writes and understands Irish']),
    'owner_occ':   ('owner_occ_pct',     ['ten__Owner occupied: Owns outright',
                                          'ten__Owner occupied: Owns with a mortgage or loan or shared ']),
    'social_rent': ('social_rent_pct',   ['ten__Social rented: Northern Ireland Housing Executive',
                                          'ten__Social rented: Housing association or charitable trust']),
    'private_rent': ('private_rent_pct', ['ten__Private rented: Private landlord or letting agency',
                                          'ten__Private rented: Other private rented']),
    'degree':      ('degree_pct',        ['qual__Level 4 and above: Degree (BA, BSc), foundation degree']),
}


def cat(p):
    return 'Independent' if p in IND else (p if p in MAIN else 'Other')


def build_features():
    """Harmonised constituency features for both vintages, on 2008 boundaries."""
    c91 = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived',
                                   'dz21-census-1991.csv')).set_index('DZ2021_cd')
    dz21 = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')
    con = json.load(open(os.path.join(HERE, 'dz_constituency.json'), encoding='utf-8'))
    pop = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'ms-a01-dz.csv'))
    pop = pop.set_index('GeographyCode').AllUsualResidents.astype(float)

    def agg(dzvals, weights):
        rows = collections.defaultdict(list)
        wts = collections.defaultdict(list)
        for dz, v in dzvals.items():
            a = str(con.get(dz, '')).upper().strip()
            if not a or not np.isfinite(v):
                continue
            rows[a].append(v)
            wts[a].append(float(weights.get(dz, 1.0)))
        return {a: float(np.average(vs, weights=ws)) for a, vs, ws
                in ((a, rows[a], wts[a]) for a in rows) if sum(ws) > 0}

    f91, f21 = {}, {}
    w91 = c91.total_pop.to_dict()
    for name, (col91, cols21) in HARM.items():
        if col91 in c91.columns:
            f91[name] = agg(c91[col91].to_dict(), w91)
        have = [c for c in cols21 if c in dz21.columns]
        if have:
            s = dz21[have].sum(axis=1)
            f21[name] = agg(s.to_dict(), pop.to_dict())
    F91 = pd.DataFrame(f91)
    F21 = pd.DataFrame(f21)
    common = [c for c in F91.columns if c in F21.columns]
    print(f"  harmonised variables ({len(common)}): {common}")
    print(f"  1991 features: {F91.shape}   2021 features: {F21.shape}")
    return F91[common], F21[common]


def build_frame():
    rows = []
    for year, fn, vintage in CONTESTS:
        p = os.path.join(META, fn)
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        seen = set()
        for r in d['results']:
            a = str(r['constituency']).upper().strip()
            if a in seen:
                continue
            seen.add(a)
            cs = r.get('candidates') or []
            tot = sum(float(c.get('firstPrefs') or 0) for c in cs)
            if tot <= 0:
                continue
            v = collections.defaultdict(float)
            for c in cs:
                v[cat((c.get('party') or '').strip())] += float(c.get('firstPrefs') or 0)
            for pty in PARTIES:
                rows.append({'year': year, 'vintage': vintage, 'area': a, 'party': pty,
                             'share': 100.0 * v.get(pty, 0.0) / tot,
                             'stood': pty in v, 'valid': tot})
    return pd.DataFrame(rows)


def main():
    print("Tier 1 — Westminster 1997/2001/2005 with vintage-matched features")
    F91, F21 = build_features()
    frame = build_frame()
    print(f"  frame: {frame.year.nunique()} contests, "
          f"{frame.groupby(['year','area']).ngroups} area-contests")

    share = frame.pivot_table(index=['year', 'area'], columns='party',
                              values='share')[PARTIES]
    stood = frame.pivot_table(index=['year', 'area'], columns='party',
                              values='stood', aggfunc='first')[PARTIES].astype(bool)
    keys = list(share.index)
    vint = {(y, a): v for y, a, v in
            frame[['year', 'area', 'vintage']].drop_duplicates().values}
    X, keep = [], []
    for (y, a) in keys:
        src = F91 if vint[(y, a)] == 1991 else F21
        if a in src.index:
            X.append(src.loc[a].values.astype(float))
            keep.append((y, a))
    X = np.vstack(X)
    share = share.loc[keep]; stood = stood.loc[keep]
    yrs = np.array([k[0] for k in keep])
    S = share.values
    print(f"  matched {len(keep)} area-contests to features")

    def loco(sel_years, Xm, Sm, stm, yv):
        """Leave-one-contest-out over the given contest set."""
        Y = pm.clr(Sm)
        P = np.zeros_like(Y)
        for c in sorted(set(yv)):
            te = yv == c; tr = ~te
            sc = StandardScaler().fit(Xm[tr])
            for j in range(Y.shape[1]):
                ctr = pd.Series(Y[tr, j]).groupby(yv[tr]).transform('mean').values
                m = Ridge(alpha=pm.ALPHA).fit(sc.transform(Xm[tr]), Y[tr, j] - ctr)
                P[te, j] = m.predict(sc.transform(Xm[te])) + Y[tr, j].mean()
        return pm.inv_clr(P, stm)

    print("\n  Westminster-only model, leave-one-contest-out share TVD (median):")
    for lab, yrsel in [('5 contests (2010-2024, current)', [2010, 2015, 2017, 2019, 2024]),
                       ('8 contests (1997-2024, Tier 1)', sorted(set(yrs)))]:
        m = np.isin(yrs, yrsel)
        P = loco(yrsel, X[m], S[m], stood.values[m], yrs[m])
        t = 0.5 * np.abs(P - S[m]).sum(axis=1)
        # score only on the MODERN contests so the comparison is like-for-like
        mod = np.isin(yrs[m], [2010, 2015, 2017, 2019, 2024])
        tm = t[mod]
        wins = []
        for c in [2010, 2015, 2017, 2019, 2024]:
            s2 = yrs[m] == c
            if not s2.any():
                continue
            ok = sum(1 for i in np.where(s2)[0]
                     if int(np.argmax(P[i])) == int(np.argmax(S[m][i])))
            wins.append(100 * ok / s2.sum())
        print(f"    {lab:34} n={m.sum():3}  TVD(modern)={np.median(tm):5.2f}  "
              f"winners(modern)={np.mean(wins):5.1f}%")

    print("\n  per-contest winner accuracy under the 8-contest model:")
    P = loco(sorted(set(yrs)), X, S, stood.values, yrs)
    for c in sorted(set(yrs)):
        s2 = yrs == c
        ok = sum(1 for i in np.where(s2)[0]
                 if int(np.argmax(P[i])) == int(np.argmax(S[i])))
        print(f"    {c}  {100*ok/s2.sum():5.1f}%   (n={s2.sum()})")
    pd.DataFrame(P, index=pd.MultiIndex.from_tuples(keep), columns=PARTIES).to_csv(
        os.path.join(HERE, 'westminster_tier1_pred.csv'))
    print("\n  wrote westminster_tier1_pred.csv")


if __name__ == '__main__':
    main()
