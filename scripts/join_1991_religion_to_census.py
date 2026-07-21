#!/usr/bin/env python
"""Carry the 1991 Census religion profile (26 Local Government Districts) onto the
2021 Data Zones and 2011 Small Areas via representative-point-in-polygon crosswalk
to the LGD_1993 boundary, so every DZ/SA carries a 1991 religion vector at council
resolution (Tier A of CENSUS_1991_INTEGRATION_SCOPE.md).

Outputs:
  data/census/derived/dz2021_to_lgd1993.csv   (DZ  -> LGD, + LGD-native check)
  data/census/derived/sa2011_to_lgd1993.csv   (SA  -> LGD)
  data/census/derived/dz21-religion-1991-lgd.csv  (DZ x 1991 religion shares)
"""
import sys, re
from pathlib import Path
import geopandas as gpd, pandas as pd

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("_tmp_xwalk")
OUT = Path("data/census/derived")
REL = OUT / "religion-1991-lgd.csv"
DENOMS = ["roman_catholic","presbyterian","church_of_ireland","methodist","other_denom","none","not_stated"]

def norm(s): return re.sub(r"[^a-z0-9]", "", str(s).lower())

def xwalk(census_fgb, id_fields):
    g = gpd.read_file(SRC / census_fgb).set_crs(4326, allow_override=True)
    lgd = gpd.read_file(SRC / "LGD_1993.fgb")[["LGDNAME","geometry"]].set_crs(4326, allow_override=True)
    pts = g[id_fields].copy(); pts["geometry"] = g.geometry.representative_point()
    pts = gpd.GeoDataFrame(pts, geometry="geometry", crs=4326)
    j = gpd.sjoin(pts, lgd, predicate="within", how="left")
    j = j[~j.index.duplicated(keep="first")]
    miss = j["LGDNAME"].isna()
    if miss.any():
        near = gpd.sjoin_nearest(pts.loc[miss].to_crs(29903), lgd.to_crs(29903), how="left")
        j.loc[miss, "LGDNAME"] = near[~near.index.duplicated(keep="first")]["LGDNAME"]
    out = g[id_fields].copy(); out["lgd1993"] = j["LGDNAME"].values
    return out

def main():
    rel = pd.read_csv(REL)
    rel = rel[rel["lgd"] != "NORTHERN IRELAND"].copy()
    rel["k"] = rel["lgd"].map(norm)
    # religion shares (of stated+notstated total) per LGD
    for d in DENOMS:
        rel[f"{d}_pct"] = (100 * rel[d] / rel["total_pop"]).round(2)
    rel_by_k = rel.set_index("k")

    dz = xwalk("DZ2021.fgb", ["DZ2021_cd","DZ2021_nm"])
    sa = xwalk("SA2011.fgb", ["SA2011"])
    for name, tbl in [("dz2021", dz), ("sa2011", sa)]:
        tbl.to_csv(OUT / f"{name}_to_lgd1993.csv", index=False)
        cov = tbl["lgd1993"].notna().mean()*100
        print(f"{name} -> LGD-1993: {len(tbl)} rows, {tbl['lgd1993'].nunique()} LGDs, {cov:.1f}% assigned")

    # join religion shares onto DZ
    dz["k"] = dz["lgd1993"].map(norm)
    unmatched = sorted(set(dz["k"]) - set(rel_by_k.index))
    cols = ["catholic_pct"] + [f"{d}_pct" for d in DENOMS]
    dzr = dz.join(rel_by_k[cols + ["total_pop"]].rename(columns={"total_pop":"lgd1991_pop"}), on="k")
    dzr = dzr.drop(columns=["k"])
    dzr.to_csv(OUT / "dz21-religion-1991-lgd.csv", index=False)
    print(f"\nwrote dz21-religion-1991-lgd.csv: {len(dzr)} DZs x 1991 religion")
    print(f"  LGD keys unmatched to religion table: {unmatched or 'none'}")
    print(f"  DZs with a 1991 catholic_pct: {dzr['catholic_pct'].notna().sum()}/{len(dzr)}")
    # sanity: population-weighted mean 1991 Catholic% across DZs vs NI 38.4
    m = (dzr["catholic_pct"] * dzr["lgd1991_pop"]).sum() / dzr["lgd1991_pop"].sum()
    print(f"  (LGD-pop-weighted mean 1991 Catholic% over DZs: {m:.1f}  vs NI 38.4)")

if __name__ == "__main__":
    main()
