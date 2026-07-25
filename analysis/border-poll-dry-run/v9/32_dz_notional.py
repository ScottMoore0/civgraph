#!/usr/bin/env python3
"""v9 phase 32 — DZ notional results: prior elections re-expressed on new boundaries.

The problem this solves. Persistence ("how did this area vote last time") is one of
the model's two strongest predictors, but it is UNDEFINED whenever boundaries change:

  * westminster 2024 runs on the 2023 review, so its constituencies did not exist at
    any prior contest -- 2024 has no persistence at all, and it is the worst
    Westminster year in the model (winner accuracy 55.6%). I previously attributed
    that entirely to pact-era overfitting in the field features; the missing
    persistence is at least as likely a cause.
  * DEAs were redrawn for the 2014 local government reorganisation.
  * pre-2017 Westminster contests (1997-2015, all present in the repo and all
    currently unused) sit on the 1995 and 2008 boundary sets.

Method: the standard notional-results construction. Take the Data Zone allocation
for a past contest, re-aggregate it (population-weighted) onto a different boundary
set, and read off what each new area "would have" polled.

    DZ mosaic for contest X   ->   re-aggregate onto boundary set B   ->   notional

What this inherits, stated plainly. The DZ mosaic is raked to the observed area
totals of its own contest, so it is an ALLOCATION, not a measurement. Aggregating it
back to its own boundaries reproduces the input exactly, by construction — that is a
plumbing check, not evidence. Aggregating onto DIFFERENT boundaries produces
genuinely new numbers whose accuracy rests on the modelled within-area distribution,
which has no sub-DEA ground truth. Professional notionals make the same assumption;
NI publishes nothing below DEA, so there is no alternative.

The redraw is moderate: every 2023 seat retains 86-100% of its population from a
single 2008 predecessor (only Foyle is 100% unchanged). Per-area provenance is
reported so a notional built from fragments can be distrusted appropriately.

Decisive test: does notional persistence improve westminster 2024?
"""
import os, sys, json, importlib.util, collections
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(HERE, 'notional')
os.makedirs(OUT, exist_ok=True)


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
dza = _load('dz25', '25_dz_party_allocation.py')
PARTIES = pm.PARTIES

pop = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'ms-a01-dz.csv'))
pop = pop.set_index('GeographyCode').AllUsualResidents.astype(float)
C08 = json.load(open(os.path.join(HERE, 'dz_constituency.json'), encoding='utf-8'))
C23 = json.load(open(os.path.join(HERE, 'dz_constituency_2023.json'), encoding='utf-8'))
BOUNDARY = {'2008': C08, '2023': C23}
# which boundary set each contest was actually fought on
VINTAGE = {'assembly2016': '2008', 'assembly2017': '2008', 'assembly2022': '2008',
           'westminster2017': '2008', 'westminster2019': '2008',
           'westminster2024': '2023'}


def _n(x):
    return str(x).upper().strip()


def dz_mosaic(contest_year):
    """DZ-level party shares for a constituency contest, raked to its own result."""
    S, stood, X, meta, feats = pm.build('constituency')
    cy = meta.contest_year.values
    sel = cy == contest_year
    if not sel.any():
        return None
    dzf = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')
    dzids = dzf.index.tolist()
    dzX = dzf[feats].values.astype(float)
    n_field = X.shape[1] - dzX.shape[1]
    xmap = BOUNDARY[VINTAGE[contest_year]]
    dz2area = np.array([_n(xmap.get(i, '')) for i in dzids])
    if n_field:
        fld = {_n(a): X[i, -n_field:] for i in np.where(sel)[0]
               for a in [meta.area.values[i]]}
        default = np.mean(list(fld.values()), axis=0)
        dzX = np.hstack([dzX, np.vstack([fld.get(a, default) for a in dz2area])])
    # fit on the other contests, predict every DZ (no leakage into this contest)
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    Y = pm.clr(S)
    tr = ~sel
    sc = StandardScaler().fit(X[tr])
    dzP = np.zeros((len(dzids), len(PARTIES)))
    for j in range(len(PARTIES)):
        ctr = Y[tr, j].mean()
        m = Ridge(alpha=pm.ALPHA).fit(sc.transform(X[tr]), Y[tr, j] - ctr)
        dzP[:, j] = m.predict(sc.transform(dzX)) + ctr
    raw = pm.inv_clr(dzP, np.ones_like(dzP, dtype=bool))
    tgt = pd.DataFrame(S[sel], index=[_n(a) for a in meta.area.values[sel]],
                       columns=PARTIES)
    tgt = tgt[~tgt.index.duplicated()]
    gidx = {a: np.where(dz2area == a)[0] for a in tgt.index}
    w = pop.reindex(dzids).fillna(0.0).values
    raked = dza.rake(raw, w, gidx, tgt)
    return pd.DataFrame(raked, index=dzids, columns=PARTIES), w, dz2area, tgt


def aggregate_to(mosaic, w, boundary_key, dzids):
    xmap = BOUNDARY[boundary_key]
    key = np.array([_n(xmap.get(i, '')) for i in dzids])
    rows, names = [], []
    for a in sorted(set(key)):
        if not a:
            continue
        idx = np.where(key == a)[0]
        ww = w[idx]
        if ww.sum() > 0:
            rows.append(np.average(mosaic.values[idx], axis=0, weights=ww))
            names.append(a)
    # build with explicit column labels: pd.DataFrame(dict_of_arrays).T yields
    # INTEGER columns, so a later reindex(columns=PARTIES) silently blanks the lot
    return pd.DataFrame(rows, index=names, columns=PARTIES)


def provenance():
    """For each 2023 seat: share of population from its main 2008 predecessor."""
    dz = [k for k in C08 if k in C23]
    rows = []
    for tgt in sorted({_n(C23[k]) for k in dz}):
        m = [k for k in dz if _n(C23[k]) == tgt]
        src = collections.Counter()
        for k in m:
            src[_n(C08[k])] += float(pop.get(k, 0.0))
        tot = sum(src.values())
        top, tv = src.most_common(1)[0]
        rows.append({'area_2023': tgt, 'main_2008_source': top,
                     'pct_from_main': 100 * tv / tot, 'n_sources': len(src)})
    return pd.DataFrame(rows).set_index('area_2023')


def main():
    prov = provenance()
    prov.to_csv(os.path.join(OUT, 'provenance_2008_to_2023.csv'))
    print("2023 seats by provenance (share of population from main 2008 predecessor):")
    print(f"  min {prov.pct_from_main.min():.1f}%  median {prov.pct_from_main.median():.1f}%"
          f"  fully unchanged (>99.5%): {(prov.pct_from_main > 99.5).sum()} of {len(prov)}")

    notionals = {}
    print("\nbuilding DZ mosaics and notionals")
    for contest_year in ['westminster2017', 'westminster2019', 'assembly2022']:
        res = dz_mosaic(contest_year)
        if res is None:
            continue
        mosaic, w, dz2area, tgt = res
        mosaic.to_csv(os.path.join(OUT, f'{contest_year}_DZ21.csv'))
        native = VINTAGE[contest_year]
        # identity check: back onto its own boundaries must reproduce the actual
        back = aggregate_to(mosaic, w, native, mosaic.index.tolist()).reindex(tgt.index)
        ident = 0.5 * np.abs(back.values - tgt.values).sum(axis=1)
        other = '2023' if native == '2008' else '2008'
        noti = aggregate_to(mosaic, w, other, mosaic.index.tolist())
        notionals[(contest_year, other)] = noti
        noti.to_csv(os.path.join(OUT, f'{contest_year}__on{other}.csv'))
        print(f"  {contest_year:16} identity TVD max={ident.max():.3f} "
              f"(0 expected)   -> notional on {other} boundaries written")

    # ---- decisive test: does notional persistence help westminster 2024? ----
    print("\n" + "=" * 70)
    print("DECISIVE TEST — westminster 2024 winner accuracy with/without notional persistence")
    S, stood, X, meta, feats = pm.build('constituency')
    cy = meta.contest_year.values
    sel24 = cy == 'westminster2024'
    areas24 = [_n(a) for a in meta.area.values[sel24]]
    act = pd.DataFrame(S[sel24], index=areas24, columns=PARTIES)

    P = pm.cv_share(S, stood, X, meta, meta.council.values)
    census24 = pd.DataFrame(P[sel24], index=areas24, columns=PARTIES)

    n17 = notionals.get(('westminster2017', '2023'))
    n19 = notionals.get(('westminster2019', '2023'))
    persist = ((n17.reindex(areas24) + n19.reindex(areas24)) / 2.0)

    def winacc(pred):
        ok = 0
        for a in areas24:
            if pred.loc[a].idxmax() == act.loc[a].idxmax():
                ok += 1
        return 100.0 * ok / len(areas24)

    print(f"  {'variant':44} {'winner acc':>11}")
    print(f"  {'census only (current)':44} {winacc(census24):10.1f}%")
    print(f"  {'notional persistence only':44} {winacc(persist):10.1f}%")
    for wgt in [0.25, 0.5, 0.75]:
        bl = dza  # renorm helper lives in 25_
        mix = pm.inv_clr(np.log(np.clip(
            wgt * census24.values + (1 - wgt) * persist.values, 1e-6, None)),
            np.ones_like(census24.values, dtype=bool))
        print(f"  {'blend  w_census=' + str(wgt):44} "
              f"{winacc(pd.DataFrame(mix, index=areas24, columns=PARTIES)):10.1f}%")

    print("\n  seats where notional persistence changes the call:")
    for a in areas24:
        c, p_, t = census24.loc[a].idxmax(), persist.loc[a].idxmax(), act.loc[a].idxmax()
        if c != p_:
            tag = 'FIXED' if p_ == t else ('broke' if c == t else 'changed')
            print(f"    {a:32} actual {t:12} census {c:12} notional {p_:12} [{tag}]")


if __name__ == '__main__':
    main()
