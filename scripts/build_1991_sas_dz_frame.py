#!/usr/bin/env python
"""Integrate the FULL 1991 Census Small Area Statistics (not just religion) onto the
model's Data-Zone / Small-Area frame.

Source: Nomis NM_63_1, 1991 census SAS for NI at 1991 frozen-ward resolution
(566 wards x 8,784 cells), mirrored to data/census/1991/sas/sas91ni_wards_full.csv.gz.

Pipeline:
  1. Derive ~15 model-relevant covariates per 1991 ward from the raw SAS cells
     (religion, Irish language, economic activity/unemployment, tenure, cars,
     limiting long-term illness, qualifications), validated against NI aggregates.
  2. Crosswalk the 566 SAS wards to the 1984 electoral-ward geometry
     (Wards_1984.fgb -- the vintage the 1991 "frozen wards" are drawn on: 566
     polygons, ~97% exact name match), disambiguating the ~13 cross-LGD name
     collisions with the Nomis geography-code prefix (95A..95Z = the 26 LGDs).
  3. Assign every 2021 Data Zone and 2011 Small Area to its containing 1984 ward
     by representative-point-in-polygon, and carry the ward covariates onto it.
  4. Emit derived DZ/SA 1991-census frames + the ward table + the crosswalks.

Outputs (data/census/derived/):
  ward1984-census-1991.csv     566 wards x derived 1991 covariates (+ raw bases)
  dz2021_to_ward1984.csv       DZ  -> 1984 ward key
  sa2011_to_ward1984.csv       SA  -> 1984 ward key
  dz21-census-1991.csv         DZ  x 1991 covariates (ward resolution)
  sa2011-census-1991.csv       SA  x 1991 covariates (ward resolution)
"""
import sys, csv, re, gzip, difflib
from pathlib import Path
from collections import Counter
import geopandas as gpd, pandas as pd, numpy as np

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("scratchpad/xwalk")
SAS = Path("data/census/1991/sas/sas91ni_wards_full.csv.gz")
OUT = Path("data/census/derived"); OUT.mkdir(parents=True, exist_ok=True)

def norm(s): return re.sub(r"[^a-z0-9]", "", str(s).lower())

# ---- model-relevant SAS cells -------------------------------------------------
# each covariate = (numerator cell-ids, denominator cell-ids); value = 100*num/den
COVARS = {
    "rc_pct":            (["S06:2"], ["S06:1"]),
    "protestant_pct":    (["S06:3","S06:4","S06:5","S06:6"], ["S06:1"]),
    "none_relig_pct":    (["S06:7"], ["S06:1"]),          # 'None' (no religion)
    "relig_notstated_pct": (["S06:8"], ["S06:1"]),
    "irish_speak_pct":   (["S67:3","S67:4"], ["S67:1","S67:2"]),
    "econ_active_pct":   (["S08:12","S08:166"], ["S08:1","S08:155"]),
    "unemployment_pct":  (["S08:78","S08:232"], ["S08:12","S08:166"]),
    "owner_occ_pct":     (["S20:2","S20:3"], ["S20:1"]),
    "social_rent_pct":   (["S20:6","S20:7"], ["S20:1"]),
    "private_rent_pct":  (["S20:4","S20:5"], ["S20:1"]),
    "no_car_pct":        (["S20:10"], ["S20:1"]),
    "llti_pct":          (["S06:65"], ["S06:1"]),
    "qualified_pct":     (["S84:4"], ["S84:1"]),
    "degree_pct":        (["S84:10"], ["S84:1"]),
}
BASES = {"total_pop": "S06:1", "total_households": "S20:1", "adults18plus": "S84:1"}

def load_sas():
    with gzip.open(SAS, "rt") as f:
        r = csv.reader(f); h = next(r)
        # map cell_id -> column index (col header: 'cell: S06:2 (...); measures: Value')
        cell_col = {}
        for i, col in enumerate(h):
            m = re.match(r"cell:\s*([SL]\d+:\d+)\s*\(", col)
            if m: cell_col[m.group(1)] = i
        rows = list(r)
    def cellsum(row, ids):
        return sum(float(row[cell_col[c]] or 0) for c in ids)
    recs = []
    for row in rows:
        rec = {"sas_name": row[1], "sas_code": row[2], "prefix": row[2].split("_")[0]}
        for b, cid in BASES.items(): rec[b] = cellsum(row, [cid])
        for name, (num, den) in COVARS.items():
            d = cellsum(row, den)
            rec[name] = round(100 * cellsum(row, num) / d, 2) if d else np.nan
        recs.append(rec)
    return pd.DataFrame(recs), rows, cell_col

def ward_lgd_frame():
    """1984 ward polygons keyed by ward_key='lgd|normname', LGD via rep-point."""
    w = gpd.read_file(SRC / "Wards_1984.fgb").set_crs(4326, allow_override=True)
    w = w[["NAME", "geometry"]].copy()
    lgd = gpd.read_file(SRC / "LGD_1993.fgb")[["LGDNAME", "geometry"]].set_crs(4326, allow_override=True)
    reps = w.geometry.representative_point()
    pts = gpd.GeoDataFrame({"NAME": w["NAME"]}, geometry=reps, crs=4326)
    j = gpd.sjoin(pts, lgd, predicate="within", how="left"); j = j[~j.index.duplicated(keep="first")]
    miss = j["LGDNAME"].isna()
    if miss.any():
        near = gpd.sjoin_nearest(pts.loc[miss].to_crs(29903), lgd.to_crs(29903), how="left")
        j.loc[miss, "LGDNAME"] = near[~near.index.duplicated(keep="first")]["LGDNAME"].values
    w["lgd"] = j["LGDNAME"].values
    w["k"] = w["NAME"].map(norm); w["lk"] = w["lgd"].map(norm)
    # dissolve multipolygon wards to one row per (lk,k)
    w = w.dissolve(by=["lk", "k"], aggfunc={"NAME": "first", "lgd": "first"}).reset_index()
    w["ward_key"] = w["lk"] + "|" + w["k"]
    return w

def build_ward_covariates(sas, wards):
    # SAS prefix -> LGD by majority vote over uniquely-named wards
    gu = wards.drop_duplicates("k", keep=False)[["k", "lgd"]]
    su = sas.drop_duplicates("sas_name", keep=False).copy(); su["k"] = su["sas_name"].map(norm)
    m = su.merge(gu, on="k", how="inner")
    pref2lgd = {p: Counter(g["lgd"]).most_common(1)[0][0] for p, g in m.groupby("prefix")}
    sas = sas.copy()
    sas["lgd"] = sas["prefix"].map(pref2lgd); sas["k"] = sas["sas_name"].map(norm)
    sas["lk"] = sas["lgd"].map(norm)
    # exact (lk,k) join
    wk = wards[["lk", "k", "ward_key"]]
    sas = sas.merge(wk, on=["lk", "k"], how="left")
    claimed = set(sas["ward_key"].dropna())
    ward_by_lk = {lk: g for lk, g in wards.groupby("lk")}
    for i, row in sas[sas["ward_key"].isna()].iterrows():
        cand = ward_by_lk.get(row["lk"])
        if cand is None: continue
        pool = cand[~cand["ward_key"].isin(claimed)]
        best = difflib.get_close_matches(row["k"], list(pool["k"]), n=1, cutoff=0.55)
        if best:
            gk = pool[pool["k"] == best[0]].iloc[0]["ward_key"]
            sas.loc[i, "ward_key"] = gk; claimed.add(gk)
    # final fallback: NI-wide EXACT name match against any still-unclaimed ward
    # (handles wards the Nomis prefix files under a neighbouring LGD, e.g.
    # Rathfriland coded 95P/Newry but sitting in the Banbridge geometry).
    for i, row in sas[sas["ward_key"].isna()].iterrows():
        pool = wards[~wards["ward_key"].isin(claimed)]
        hit = pool[pool["k"] == row["k"]]
        if len(hit) == 1:
            gk = hit.iloc[0]["ward_key"]; sas.loc[i, "ward_key"] = gk; claimed.add(gk)
    return sas, pref2lgd

def crosswalk(census_fgb, id_fields, wards):
    g = gpd.read_file(SRC / census_fgb).set_crs(4326, allow_override=True)
    pts = gpd.GeoDataFrame(g[id_fields].copy(), geometry=g.geometry.representative_point(), crs=4326)
    wk = wards[["ward_key", "geometry"]]
    j = gpd.sjoin(pts, wk, predicate="within", how="left"); j = j[~j.index.duplicated(keep="first")]
    miss = j["ward_key"].isna()
    if miss.any():
        near = gpd.sjoin_nearest(pts.loc[miss].to_crs(29903), wk.to_crs(29903), how="left")
        j.loc[miss, "ward_key"] = near[~near.index.duplicated(keep="first")]["ward_key"].values
    out = g[id_fields].copy(); out["ward_key"] = j["ward_key"].values
    return out

def wmean(df, col, wcol="total_pop"):
    d = df[[col, wcol]].dropna()
    return (d[col] * d[wcol]).sum() / d[wcol].sum()

def main():
    sas, rows, cell_col = load_sas()
    print(f"SAS: {len(sas)} wards, covariates {list(COVARS)}")
    wards = ward_lgd_frame()
    print(f"1984 ward geometry: {len(wards)} wards, {wards['lgd'].nunique()} LGDs")
    sas, pref2lgd = build_ward_covariates(sas, wards)
    matched = sas["ward_key"].notna().sum()
    print(f"SAS wards matched to 1984 geometry: {matched}/{len(sas)}")
    if matched < len(sas):
        for _, x in sas[sas["ward_key"].isna()].iterrows():
            print(f"  UNMATCHED {x['sas_code']} {x['sas_name']} [{x['lgd']}]")

    # NI-aggregate validation (population-weighted over wards)
    print("\nNI aggregates (pop-weighted over wards):")
    checks = {"rc_pct": 38.4, "protestant_pct": 50.6, "irish_speak_pct": None,
              "unemployment_pct": None, "owner_occ_pct": None, "no_car_pct": None,
              "llti_pct": None, "degree_pct": None}
    for c in COVARS:
        exp = checks.get(c)
        print(f"  {c:22s} {wmean(sas, c):6.2f}" + (f"   (~expect {exp})" if exp else ""))
    print(f"  total_pop sum = {int(sas['total_pop'].sum()):,}  (NI 1991 = 1,577,836)")

    ward_cols = ["ward_key", "sas_code", "sas_name", "lgd"] + list(BASES) + list(COVARS)
    sas[ward_cols].to_csv(OUT / "ward1984-census-1991.csv", index=False)
    print(f"\nwrote ward1984-census-1991.csv ({len(sas)} wards)")

    key = sas.set_index("ward_key")[list(BASES) + list(COVARS)]
    for cfg, (fgb, ids) in {"dz2021": ("DZ2021.fgb", ["DZ2021_cd", "DZ2021_nm"]),
                             "sa2011": ("SA2011.fgb", ["SA2011"])}.items():
        xw = crosswalk(fgb, ids, wards)
        xw.to_csv(OUT / f"{cfg}_to_ward1984.csv", index=False)
        joined = xw.join(key, on="ward_key")
        out = "dz21-census-1991.csv" if cfg == "dz2021" else "sa2011-census-1991.csv"
        joined.to_csv(OUT / out, index=False)
        cov = joined["rc_pct"].notna().mean() * 100
        print(f"{cfg}: {len(xw)} units -> {xw['ward_key'].nunique()} wards, "
              f"{cov:.1f}% with 1991 covariates; wrote {out}")
        m = wmean(joined, "rc_pct")
        print(f"   ({cfg} pop-weighted 1991 RC% = {m:.1f} vs NI 38.4)")

if __name__ == "__main__":
    main()
