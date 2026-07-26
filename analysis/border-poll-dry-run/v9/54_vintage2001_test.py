#!/usr/bin/env python3
"""v9 phase 54 — does correct vintage-matching actually help? The 2001 A/B.

Phase 39 asserted that predicting a 1997 election from 2021 demography is
anachronistic, and fitted 1997, 2001 AND 2005 with 1991 features because 1991 was the
only pre-2011 vintage available at DZ2021. Phase 53 added 2001. For the 2001 and 2005
contests, 2001 is plainly the closer vintage, and this phase measures whether that
closeness is worth anything -- rather than assuming it, which is how three earlier
"improvements" in this workstream turned out to be measurement artefacts.

Design. The confound to avoid is feature COUNT: the 2021 set has 88 features and the
1991/2001 sets have ~20, so swapping vintages also swaps model capacity. Here the
feature set is held fixed at the eight variables harmonisable across all three
vintages, and ONLY the vintage assignment varies. Any difference is then attributable
to vintage, not capacity.

    catholic  protestant  no_religion  irish_speak
    owner_occ  social_rent  private_rent  degree

`no_religion` is the residual 100 - catholic - protestant in every vintage. That is
forced by the source: at Output Area level the 2001 census merges "no religion" with
"not stated" (phase 53), and 2021 as held here has no separate not-stated column. The
residual is the one definition that means the same thing in all three.

Three assignments are compared on both the Westminster and the local series:

    all2021    every contest gets 2021 features        (fully anachronistic control)
    phase39    1997/2001/2005 -> 1991                  (the status quo)
    corrected  1997 -> 1991, 2001/2005 -> 2001         (vintage-matched)

The local test matters most. Phase 47 rejected the local 2001 and 2005 contests as
harmful and attributed that to the UUP->DUP realignment -- but those contests were
being fitted with 2021 features, so "the party system changed" and "the demography was
wrong by twenty years" were confounded. This separates them.
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DER = os.path.join(REPO, 'data', 'census', 'derived')


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm', '17_party_model.py')
w39 = _load('w39', '39_westminster_tier1.py')
l47 = _load('l47', '47_local_history.py')

PARTIES = w39.PARTIES
HVARS = ['catholic', 'protestant', 'no_religion', 'irish_speak',
         'owner_occ', 'social_rent', 'private_rent', 'degree']


def _pref(df, prefix):
    cols = [c for c in df.columns if c.startswith(prefix)]
    return df[cols].sum(axis=1) if cols else pd.Series(0.0, index=df.index)


def harmonised(vintage):
    """The eight harmonised variables at DZ2021, plus that vintage's own population."""
    if vintage == 2021:
        d = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')
        pop = pd.read_csv(os.path.join(DER, 'ms-a01-dz.csv')).set_index(
            'GeographyCode').AllUsualResidents.astype(float)
        out = pd.DataFrame(index=d.index)
        out['catholic'] = _pref(d, 'rel__Catholic')
        out['protestant'] = _pref(d, 'rel__Protestant')
        out['irish_speak'] = _pref(d, 'irish__Speak') + _pref(d, '"irish__Speak')
        out['owner_occ'] = _pref(d, 'ten__Owner occupied')
        out['social_rent'] = _pref(d, 'ten__Social rented')
        out['private_rent'] = _pref(d, 'ten__Private rented')
        out['degree'] = _pref(d, 'qual__Level 4 and above')
        out['_pop'] = pop.reindex(out.index).fillna(0.0)
    else:
        fn = 'dz21-census-1991.csv' if vintage == 1991 else 'dz21-census-2001.csv'
        d = pd.read_csv(os.path.join(DER, fn)).set_index('DZ2021_cd')
        out = pd.DataFrame(index=d.index)
        out['catholic'] = d.rc_pct
        out['protestant'] = d.protestant_pct
        out['irish_speak'] = d.irish_speak_pct
        out['owner_occ'] = d.owner_occ_pct
        out['social_rent'] = d.social_rent_pct
        out['private_rent'] = d.private_rent_pct
        out['degree'] = d.degree_pct
        out['_pop'] = d.total_pop.astype(float)
    out['no_religion'] = (100.0 - out.catholic - out.protestant).clip(lower=0)
    return out[HVARS + ['_pop']]


def agg_to(dzf, mapping):
    """Population-weighted aggregation of DZ features onto an area label."""
    lab = pd.Series({i: str(mapping.get(i, '')).upper().strip() for i in dzf.index})
    w = dzf['_pop'].fillna(0.0)
    rows = {}
    for a, idx in lab[lab != ''].groupby(lab).groups.items():
        ww = w.reindex(idx).fillna(0.0).values
        if ww.sum() <= 0:
            continue
        sub = dzf.loc[idx, HVARS].astype(float)
        vals = {}
        for c in HVARS:
            v = sub[c].values
            ok = np.isfinite(v)
            vals[c] = float(np.average(v[ok], weights=ww[ok])) if ok.any() and \
                ww[ok].sum() > 0 else np.nan
        rows[a] = vals
    return pd.DataFrame(rows).T[HVARS]


def loco(X, S, stood, grp):
    """Leave-one-contest-out compositional prediction (phase 39's estimator)."""
    Y = pm.clr(S)
    P = np.zeros_like(Y)
    for c in sorted(set(grp)):
        te = grp == c
        tr = ~te
        if tr.sum() < 5:
            P[te] = Y[tr].mean(axis=0) if tr.any() else 0
            continue
        sc = StandardScaler().fit(X[tr])
        for j in range(Y.shape[1]):
            ctr = pd.Series(Y[tr, j]).groupby(grp[tr]).transform('mean').values
            m = Ridge(alpha=pm.ALPHA).fit(sc.transform(X[tr]), Y[tr, j] - ctr)
            P[te, j] = m.predict(sc.transform(X[te])) + Y[tr, j].mean()
    return pm.inv_clr(P, stood)


def score(P, S, grp, focus):
    t = 0.5 * np.abs(P - S).sum(axis=1)
    sel = np.isin(grp, focus)
    win = [100 * np.mean([int(np.argmax(P[i])) == int(np.argmax(S[i]))
                          for i in np.where(grp == c)[0]])
           for c in focus if (grp == c).any()]
    return float(np.median(t[sel])), float(np.mean(win)) if win else np.nan, t


# ----------------------------------------------------------------- Westminster
# all* assignments apply ONE vintage to every contest including the modern ones, so
# they separate two rival explanations: "recent features are simply better" (2021 wins
# regardless) versus "vintage CONSISTENCY is what matters" (any single vintage beats
# any mixture).
ASSIGN = {
    'all2021':   {y: 2021 for y in (1997, 2001, 2005)},
    'all2001':   {y: 2001 for y in (1997, 2001, 2005)},
    'all1991':   {y: 1991 for y in (1997, 2001, 2005)},
    'phase39':   {1997: 1991, 2001: 1991, 2005: 1991},
    'corrected': {1997: 1991, 2001: 2001, 2005: 2001},
}
# vintage applied to the MODERN contests too, for the all* rows
ALL_VINT = {'all2021': 2021, 'all2001': 2001, 'all1991': 1991}
MODERN = [2010, 2015, 2017, 2019, 2024]


def westminster(F):
    con = json.load(open(os.path.join(HERE, 'dz_constituency.json'), encoding='utf-8'))
    A = {v: agg_to(F[v], con) for v in (1991, 2001, 2021)}
    frame = w39.build_frame()
    share = frame.pivot_table(index=['year', 'area'], columns='party',
                              values='share')[PARTIES]
    stood = frame.pivot_table(index=['year', 'area'], columns='party',
                              values='stood', aggfunc='first')[PARTIES].astype(bool)
    keys = list(share.index)

    print("\n" + "=" * 78)
    print("WESTMINSTER 1997-2024 — vintage assignment A/B (8 harmonised features)")
    print(f"\n  {'assignment':12} {'n':>4} {'TVD modern':>11} {'winners':>9} "
          f"{'TVD 2001':>9} {'TVD 2005':>9}")
    res = {}
    for lab, amap in ASSIGN.items():
        X, keep = [], []
        for (y, a) in keys:
            v = amap.get(y, ALL_VINT.get(lab, 2021))
            src = A[v]
            if a in src.index and np.isfinite(src.loc[a].values.astype(float)).all():
                X.append(src.loc[a].values.astype(float))
                keep.append((y, a))
        X = np.vstack(X)
        S = share.loc[keep].values
        st = stood.loc[keep].values
        grp = np.array([k[0] for k in keep])
        P = loco(X, S, st, grp)
        tvd, win, t = score(P, S, grp, MODERN)
        t01 = np.median(t[grp == 2001]) if (grp == 2001).any() else np.nan
        t05 = np.median(t[grp == 2005]) if (grp == 2005).any() else np.nan
        print(f"  {lab:12} {len(keep):4} {tvd:11.3f} {win:8.1f}% "
              f"{t01:9.3f} {t05:9.3f}")
        res[lab] = (tvd, win, t01, t05)
    d39, dc = res['phase39'], res['corrected']
    print(f"\n  corrected vs phase39: TVD(modern) {dc[0]-d39[0]:+.3f}  "
          f"TVD(2001) {dc[2]-d39[2]:+.3f}  TVD(2005) {dc[3]-d39[3]:+.3f}")
    print("  (negative = the vintage-matched assignment is more accurate)")
    return res


# ----------------------------------------------------------------------- local
LOCAL_VINT = {
    'all2021':   {y: 2021 for y in ('1993', '1997', '2001', '2005', '2011')},
    'all2001':   {y: 2001 for y in ('1993', '1997', '2001', '2005', '2011')},
    'all1991':   {y: 1991 for y in ('1993', '1997', '2001', '2005', '2011')},
    'phase39':   {'2001': 1991, '2005': 1991, '2011': 2021, '1997': 1991, '1993': 1991},
    'corrected': {'2001': 2001, '2005': 2001, '2011': 2021, '1997': 1991, '1993': 1991},
}


def local(F):
    """Direct test on the DEA1993 series: predict each contest's shares from
    vintage-matched features, leave-one-contest-out."""
    dzmap = l47.DZMAPS['1993']
    A = {v: agg_to(F[v], dzmap) for v in (1991, 2001, 2021)}
    years = ['1993', '1997', '2001', '2005', '2011']
    tgt = {}
    for y in years:
        try:
            s = l47.contest_shares(y)
            tgt[y] = s[~s.index.duplicated()]
        except Exception as e:
            print(f"    {y}: shares unavailable ({type(e).__name__})")
    print("\n" + "=" * 78)
    print("LOCAL 1993-2011 on DEA1993 — vintage assignment A/B")
    print(f"  contests: {', '.join(f'{y} (n={len(tgt[y])})' for y in years if y in tgt)}")
    print(f"\n  {'assignment':12} {'n':>5} {'TVD all':>9} {'TVD 2001':>9} "
          f"{'TVD 2005':>9} {'winners':>9}")
    out = {}
    for lab, vmap in LOCAL_VINT.items():
        X, S, st, grp = [], [], [], []
        for y in years:
            if y not in tgt:
                continue
            src = A[vmap.get(y, 2021)]
            for a, row in tgt[y].iterrows():
                a = str(a).upper().strip()
                if a not in src.index:
                    continue
                v = src.loc[a].values.astype(float)
                if not np.isfinite(v).all():
                    continue
                sh = row.reindex(PARTIES).fillna(0.0).values.astype(float)
                if sh.sum() <= 0:
                    continue
                X.append(v)
                S.append(100.0 * sh / sh.sum())
                st.append(sh > 0)
                grp.append(y)
        X = np.vstack(X); S = np.vstack(S)
        st = np.vstack(st); grp = np.array(grp)
        P = loco(X, S, st, grp)
        t = 0.5 * np.abs(P - S).sum(axis=1)
        win = 100 * np.mean([int(np.argmax(P[i])) == int(np.argmax(S[i]))
                             for i in range(len(S))])
        t01 = np.median(t[grp == '2001']) if (grp == '2001').any() else np.nan
        t05 = np.median(t[grp == '2005']) if (grp == '2005').any() else np.nan
        print(f"  {lab:12} {len(S):5} {np.median(t):9.3f} {t01:9.3f} "
              f"{t05:9.3f} {win:8.1f}%")
        out[lab] = (np.median(t), t01, t05, win)
    a, b = out['phase39'], out['corrected']
    print(f"\n  corrected vs phase39: TVD(all) {b[0]-a[0]:+.3f}  "
          f"TVD(2001) {b[1]-a[1]:+.3f}  TVD(2005) {b[2]-a[2]:+.3f}")
    c = out['all2021']
    print(f"  corrected vs all2021: TVD(all) {b[0]-c[0]:+.3f}  "
          f"TVD(2001) {b[1]-c[1]:+.3f}  TVD(2005) {b[2]-c[2]:+.3f}")
    return out


def main():
    print("=" * 78)
    print("PHASE 54 — 2001 vintage A/B: does vintage-matching earn its keep?")
    F = {v: harmonised(v) for v in (1991, 2001, 2021)}
    for v, d in F.items():
        n = d[HVARS].notna().all(axis=1).sum()
        print(f"  {v} features: {d.shape[0]:,} DZs, {n:,} complete   "
              f"cath {np.average(d.catholic.fillna(0), weights=d._pop.fillna(0)):.1f}%")
    w = westminster(F)
    l = local(F)
    json.dump({'westminster': {k: list(v) for k, v in w.items()},
               'local': {k: list(v) for k, v in l.items()}},
              open(os.path.join(HERE, 'vintage2001_ab.json'), 'w', encoding='utf-8'),
              indent=1)
    print("\n  wrote vintage2001_ab.json")


if __name__ == '__main__':
    main()
