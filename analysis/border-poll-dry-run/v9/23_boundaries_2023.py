#!/usr/bin/env python3
"""v9 phase 23 — census features on the 2023 Westminster boundaries.

The 2024 Westminster election ran on the 2023 boundary review, but
constituency_features.csv is built on the 2008 boundaries. Phase 17 therefore had
to DROP "Belfast South and Mid Down" rather than match it to the wrong geography,
losing a seat from every constituency-scale result.

Fix: re-aggregate the Data Zone census features onto the 2023 constituencies.
DZ2021 nests cleanly enough inside constituencies for a centroid assignment, and
DZ population (AllUsualResidents) supplies the weights, so this is a genuine
re-aggregation of the same underlying census rather than a re-estimate.

Inputs  DZ2021.fgb (lps/, fetched in phase 10)
        2023 constituency boundaries (D:/ConstituencyBoundaries...2023...geojson)
        dz_features.csv, data/census/derived/ms-a01-dz.csv (DZ populations)
Outputs dz_constituency_2023.json      DZ -> 2023 constituency
        constituency_features_2023.csv 18 x 88 census features
"""
import os, json
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DZFGB = os.path.join(HERE, 'lps', 'DZ2021.fgb')
# OSNI open data, NI parliamentary constituencies 2023. NOTE: the similarly-named
# D:/ConstituencyBoundariesUngeneralised_National_Electoral_Boundaries_2023_*.geojson
# is the REPUBLIC's Dail boundaries (it carries GAELTACHT_AREA and Irish-language
# name fields) -- wrong jurisdiction entirely.
BND = os.environ.get(
    'CONST2023_GEOJSON',
    'D:/opendatani/land-property-services-ordnance-survey-of-northern-ireland/'
    'osni-open-data-largescale-boundaries-parliamentary-constituencies-2023/'
    'osni_open_data_largescale_boundaries_parliamentary_constituencies_2023.geojson')


def main():
    if not os.path.exists(BND):
        raise SystemExit(f"2023 boundary file not found: {BND}")
    dz = gpd.read_file(DZFGB)[['DZ2021_cd', 'geometry']]
    con = gpd.read_file(BND)
    namecol = next((c for c in con.columns
                    if con[c].dtype == object and c.lower() != 'geometry'
                    and con[c].astype(str).str.contains('BELFAST', case=False).any()), None)
    if namecol is None:
        raise SystemExit(f"could not find a constituency-name column in {list(con.columns)}")
    print(f"2023 boundaries: {len(con)} features, name column '{namecol}'")
    con = con[[namecol, 'geometry']].rename(columns={namecol: 'con2023'})
    con['con2023'] = con.con2023.astype(str).str.upper().str.strip()
    if con.crs != dz.crs:
        con = con.to_crs(dz.crs)

    # centroid assignment: a DZ belongs to the constituency containing its centroid
    cent = dz.copy()
    cent['geometry'] = dz.geometry.representative_point()
    j = gpd.sjoin(cent, con, how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    miss = j.con2023.isna().sum()
    print(f"  DZ assigned by centroid: {len(j)-miss}/{len(j)}  ({miss} unmatched)")
    if miss:
        un = j[j.con2023.isna()]
        snap = gpd.sjoin_nearest(cent.loc[un.index].to_crs(29902),
                                 con.to_crs(29902), how='left')
        snap = snap[~snap.index.duplicated(keep='first')]
        j.loc[un.index, 'con2023'] = snap.con2023
        print(f"  after nearest-snap: {j.con2023.isna().sum()} unmatched")

    mapping = dict(zip(j.DZ2021_cd, j.con2023))
    json.dump(mapping, open(os.path.join(HERE, 'dz_constituency_2023.json'), 'w'),
              ensure_ascii=False, indent=1)
    print(f"  constituencies covered: {len(set(mapping.values()))}")
    for c, n in sorted(pd.Series(list(mapping.values())).value_counts().items()):
        print(f"    {c:34} {n:4} DZs")

    # population-weighted aggregation of the DZ census features
    feats = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')
    pop = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'ms-a01-dz.csv'))
    pop = pop.set_index('GeographyCode').AllUsualResidents.astype(float)
    df = feats.copy()
    df['con2023'] = [mapping.get(i) for i in df.index]
    df['w'] = pop.reindex(df.index).fillna(0.0).values
    cols = feats.columns.tolist()
    out = {}
    for c, g in df.groupby('con2023'):
        w = g.w.values
        w = w / w.sum() if w.sum() > 0 else np.repeat(1.0 / len(g), len(g))
        out[c] = pd.Series(np.average(g[cols].values.astype(float), axis=0, weights=w),
                           index=cols)
    res = pd.DataFrame(out).T
    res.index.name = 'con'
    res.to_csv(os.path.join(HERE, 'constituency_features_2023.csv'))
    print(f"\nwrote constituency_features_2023.csv "
          f"({len(res)} constituencies x {res.shape[1]} features)")

    # sanity: do these names cover the 2024 results frame?
    pf = pd.read_csv(os.path.join(HERE, 'party_results_frame.csv'))
    w24 = sorted(pf[(pf.contest == 'westminster') & (pf.year == 2024)]
                 .area.str.upper().str.strip().unique())
    have = set(res.index)
    missing = [a for a in w24 if a not in have]
    print(f"westminster 2024 areas: {len(w24)}, matched {len(w24)-len(missing)}")
    if missing:
        print("  UNMATCHED:", missing)
        print("  available:", sorted(have)[:20])
    else:
        print("  all 2024 constituencies now have census features")


if __name__ == '__main__':
    main()
