#!/usr/bin/env python
"""Crosswalk the four NI DEA boundary vintages (1972 / 1984 / 1993 / 2012) to the
2011 Small Areas and 2021 Data Zones, so election/transfer covariates measured on
any DEA vintage can be carried onto a common census small-area frame and compared
over time.

Method: representative-point-in-polygon spatial join. Each SA/DZ is assigned to the
DEA (of each vintage) whose polygon contains the SA/DZ's representative point (a
point guaranteed to lie inside the unit, robust to sliver misalignment between the
independently-drawn boundary sets). Points that fall in no DEA (coastal/edge slivers)
fall back to the nearest DEA centroid.

Inputs (WGS84 .fgb, all NI-wide): DEAs_{1972,1984,1993,2012}.fgb, SA2011.fgb, DZ2021.fgb
Outputs: sa2011_to_deas.csv, dz2021_to_deas.csv
"""
import sys
from pathlib import Path
import geopandas as gpd
import pandas as pd

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("_tmp_xwalk")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/census/derived")
OUT.mkdir(parents=True, exist_ok=True)

# DEA vintage -> (file, label field)
DEAS = {
    "dea_1972": ("DEAs_1972.fgb", "NAME"),
    "dea_1984": ("DEAs_1984.fgb", "DEA"),
    "dea_1993": ("DEAs_1993.fgb", "DEA"),
    "dea_2012": ("DEAs_2012.fgb", "FinalR_DEA"),
}

PROJ = 29903  # Irish Grid (metres) for accurate nearest-neighbour distances

def load_deas():
    out = {}
    for key, (fn, label) in DEAS.items():
        g = gpd.read_file(SRC / fn)[[label, "geometry"]]
        n = len(g)
        g = g[g[label].notna()]                       # drop true-null labels first
        g = g.rename(columns={label: key})
        g[key] = g[key].astype(str).str.strip()
        g = g[~g[key].isin(["", "None", "nan", "NaN"])].copy()  # then any string blanks
        g = g.set_crs(4326, allow_override=True)
        if len(g) < n:
            print(f"  ({key}: dropped {n-len(g)} unlabelled source polygon(s))")
        out[key] = g
    return out

def assign(points_gdf, dea_gdf, key):
    """Assign each point to the DEA containing it; nearest-labelled-DEA fallback
    (in a projected CRS) for points in unlabelled/sliver gaps."""
    j = gpd.sjoin(points_gdf, dea_gdf, predicate="within", how="left")
    j = j[~j.index.duplicated(keep="first")]  # a point on a shared edge can match >1
    miss = j[key].isna()
    if miss.any():
        p = points_gdf.loc[miss].to_crs(PROJ)
        near = gpd.sjoin_nearest(p, dea_gdf.to_crs(PROJ), how="left")
        near = near[~near.index.duplicated(keep="first")]
        j.loc[miss, key] = near[key]
    return j[key].values

def crosswalk(census_path, id_fields, deas):
    g = gpd.read_file(SRC / census_path).set_crs(4326, allow_override=True)
    keep = {f: g[f].astype(str) for f in id_fields if f in g.columns}
    pts = g.copy()
    pts["geometry"] = g.geometry.representative_point()
    res = pd.DataFrame(keep)
    for key, dg in deas.items():
        res[key] = assign(pts[["geometry"]], dg, key)
    return res

def main():
    deas = load_deas()
    for k, g in deas.items():
        print(f"  {k}: {len(g)} DEAs, {g[k].nunique()} distinct labels")

    sa = crosswalk("SA2011.fgb", ["SA2011", "SOA2011"], deas)
    sa.to_csv(OUT / "sa2011_to_deas.csv", index=False)
    print(f"\nSA2011 -> DEAs: {len(sa)} small areas -> {OUT/'sa2011_to_deas.csv'}")
    for k in DEAS:
        print(f"  {k}: {sa[k].notna().sum()}/{len(sa)} assigned, {sa[k].nunique()} DEAs used")

    # DZ2021 carries its native 2014 DEA (DEA2014_nm) — keep it as an independent check
    dz = crosswalk("DZ2021.fgb", ["DZ2021_cd", "DZ2021_nm", "DEA2014_nm"], deas)
    dz.to_csv(OUT / "dz2021_to_deas.csv", index=False)
    print(f"\nDZ2021 -> DEAs: {len(dz)} data zones -> {OUT/'dz2021_to_deas.csv'}")
    for k in DEAS:
        print(f"  {k}: {dz[k].notna().sum()}/{len(dz)} assigned, {dz[k].nunique()} DEAs used")

    # validate the spatial 2012 assignment against DZ's built-in DEA2014 attribute
    if "DEA2014_nm" in dz.columns:
        def norm(s): return s.str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
        agree = (norm(dz["dea_2012"]) == norm(dz["DEA2014_nm"])).mean()
        print(f"\nVALIDATION: spatial dea_2012 vs native DEA2014_nm agree: {agree*100:.1f}%")

if __name__ == "__main__":
    main()
