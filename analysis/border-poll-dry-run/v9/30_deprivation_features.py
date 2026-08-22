#!/usr/bin/env python3
"""v9 phase 30 — NIMDM deprivation features at DZ, DEA and constituency.

NIMDM-2017 is published at SMALL AREA level (data/census/derived/nimdm-2017-sa.csv:
SA2011, MDM_rank, Income_rank, Employment_rank, MDM_decile), so deprivation is
available at every scale the model uses. The existing augment/build_deprivation.py
only ever aggregated it to the 18 constituencies, which is why it looked like a
constituency-only dataset.

Crosswalk. There is no SA2011 -> DZ2021 lookup in the repo, and the
timeline-transition overlays are display artefacts using synthetic ids
("Data Zone 2021-1"), not real codes. So the mapping is built by spatially joining
SA2011 centroids to DZ2021 polygons (SA2011.fgb and DZ2021.fgb from R2), then
population-weighting the SA ranks up with 2011 usual residents.

Ranks are converted to percentiles (0 = most deprived, 100 = least) so the feature
is scale-free and directionally readable, rather than feeding a raw rank whose
magnitude depends on how many small areas exist.

Then tested the only way that counts: added to the census block and run through the
same leave-one-council-out harness, against the same pre-registered bar.

NOTE ON NISA. NISA is NOT an area covariate and is not tested here. augment/
nisa_dz_series.csv is an NI-WIDE time series of unity support by survey wave
(1989->), i.e. a LEVEL series for the referendum question. It has no per-area
values to join to a party-share model. It is relevant to the unity model's
historical extension, not to this one.
"""
import os, sys, json, subprocess, importlib.util
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GEO = os.path.join(HERE, '_geo')
os.makedirs(GEO, exist_ok=True)
SA_FGB = os.path.join(GEO, 'SA2011.fgb')
DZ_FGB = os.path.join(HERE, 'lps', 'DZ2021.fgb')
COLS = ['dep__mdm_pct', 'dep__income_pct', 'dep__employment_pct']


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return
    print(f"  fetching {url}")
    r = subprocess.run(["curl", "-fsSL", "--max-time", "600", url, "-o", path])
    if r.returncode != 0:
        raise SystemExit(f"fetch failed: {url}")


def build_crosswalk():
    fetch("https://data.civgraph.net/data/maps/census-areas/SA2011.fgb", SA_FGB)
    sa = gpd.read_file(SA_FGB)
    idcol = next((c for c in sa.columns
                  if sa[c].astype(str).str.match(r'^N00\d{6}$').any()), None)
    if idcol is None:
        raise SystemExit(f"no SA2011 code column found in {list(sa.columns)}")
    dz = gpd.read_file(DZ_FGB)[['DZ2021_cd', 'DEA2014_nm', 'LGD2014_nm', 'geometry']]
    if sa.crs != dz.crs:
        sa = sa.to_crs(dz.crs)
    cent = sa[[idcol, 'geometry']].copy()
    cent['geometry'] = sa.geometry.representative_point()
    j = gpd.sjoin(cent, dz, how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    miss = j.DZ2021_cd.isna().sum()
    print(f"  SA2011 -> DZ2021: {len(j)-miss}/{len(j)} matched ({miss} unmatched)")
    if miss:
        un = j[j.DZ2021_cd.isna()]
        snap = gpd.sjoin_nearest(cent.loc[un.index].to_crs(29902),
                                 dz.to_crs(29902), how='left')
        snap = snap[~snap.index.duplicated(keep='first')]
        for c in ['DZ2021_cd', 'DEA2014_nm', 'LGD2014_nm']:
            j.loc[un.index, c] = snap[c]
        print(f"  after nearest-snap: {j.DZ2021_cd.isna().sum()} unmatched")
    return j.rename(columns={idcol: 'SA2011'})[['SA2011', 'DZ2021_cd', 'DEA2014_nm']]


def build_features():
    xw = build_crosswalk()
    nim = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'nimdm-2017-sa.csv'))
    pop = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'census-2011-sa.csv'))
    pop = pop[['SA2011', 'AllUsualResidents']]
    d = nim.merge(xw, on='SA2011', how='inner').merge(pop, on='SA2011', how='left')
    d['AllUsualResidents'] = d.AllUsualResidents.fillna(d.AllUsualResidents.median())
    print(f"  joined {len(d):,} small areas with rank + population")
    # rank -> percentile (0 = most deprived, 100 = least)
    n = len(d)
    for src, dst in [('MDM_rank', 'dep__mdm_pct'), ('Income_rank', 'dep__income_pct'),
                     ('Employment_rank', 'dep__employment_pct')]:
        d[dst] = 100.0 * d[src].rank(method='average') / n

    def agg(key):
        out = {}
        for g, s in d.groupby(key):
            w = s.AllUsualResidents.values.astype(float)
            w = w / w.sum() if w.sum() > 0 else np.repeat(1 / len(s), len(s))
            out[g] = {c: float(np.average(s[c].values, weights=w)) for c in COLS}
        return pd.DataFrame(out).T
    dzf = agg('DZ2021_cd'); dzf.index.name = 'area'
    deaf = agg('DEA2014_nm'); deaf.index.name = 'area'
    dzf.to_csv(os.path.join(HERE, 'deprivation_dz.csv'))
    deaf.to_csv(os.path.join(HERE, 'deprivation_dea.csv'))
    print(f"  wrote deprivation_dz.csv ({len(dzf)} DZs), "
          f"deprivation_dea.csv ({len(deaf)} DEAs)")
    return dzf, deaf


def validate(deaf):
    """Same harness, same bar: does deprivation add anything to the census block?"""
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    ALPHA = 50.0
    feat = pd.read_csv(os.path.join(HERE, 'dea_features.csv')).set_index('area')
    dep = deaf.copy()
    dep.index = [str(i).strip() for i in dep.index]
    # dea_features uses title case; the DZ2021.fgb DEA names may differ in case
    lut = {str(i).upper().strip(): i for i in feat.index}
    dep.index = [lut.get(str(i).upper().strip(), i) for i in dep.index]
    res = pd.read_csv(os.path.join(HERE, 'results_frame.csv'))
    dea = res[(res.scale == 'dea') & (res.contest == 'local')].copy()
    lf = json.load(open(f"{REPO}/render/metadata/elections-test2/"
                        "local-government-local-government-districts__2023-05-18.json",
                        encoding='utf-8'))
    d2c = lf['localBodyByConstituency']
    common = [a for a in dea.area.unique() if a in feat.index and a in dep.index]
    print(f"\n  DEA overlap with deprivation: {len(common)}/{dea.area.nunique()}")
    dea = dea[dea.area.isin(common)]
    CF = feat.columns.tolist(); DF = COLS
    joined = feat.join(dep, how='inner')
    dea['cy'] = dea.contest + dea.year.astype(str)
    sub = dea.merge(joined, left_on='area', right_index=True).reset_index(drop=True)
    sub['council'] = sub.area.map(d2c)
    y = sub.nat_pct.values.astype(float); cy = sub.cy.values; g = sub.council.values

    def loco(cols):
        shp = np.zeros(len(y))
        for gg in sorted(set(g)):
            te = g == gg; tr = ~te
            X = sub[cols].values.astype(float)
            sc = StandardScaler().fit(X[tr])
            ctr = pd.Series(y[tr]).groupby(cy[tr]).transform('mean').values
            m = Ridge(alpha=ALPHA).fit(sc.transform(X[tr]), y[tr] - ctr)
            shp[te] = m.predict(sc.transform(X[te]))
        act = y - pd.Series(y).groupby(cy).transform('mean').values
        r2 = 1 - ((shp - act) ** 2).sum() / ((act - act.mean()) ** 2).sum()
        return r2, np.abs(shp - act).mean()
    print("\n  leave-one-COUNCIL-out SHAPE (bar: >=0.30 pts improvement)")
    r0, m0 = loco(CF)
    print(f"    census        ({len(CF):3d})  R2={r0:+.3f}  MAE={m0:.2f}")
    r1, m1 = loco(CF + DF)
    print(f"    census+dep    ({len(CF+DF):3d})  R2={r1:+.3f}  MAE={m1:.2f}   "
          f"delta={m1-m0:+.2f}")
    r2_, m2 = loco(DF)
    print(f"    deprivation   ({len(DF):3d})  R2={r2_:+.3f}  MAE={m2:.2f}")
    for c in DF:
        rr, mm = loco(CF + [c])
        print(f"      + {c:22} MAE={mm:.2f} ({mm-m0:+.2f})")


def main():
    print("building NIMDM deprivation features at SA -> DZ / DEA")
    dzf, deaf = build_features()
    validate(deaf)


if __name__ == '__main__':
    main()
