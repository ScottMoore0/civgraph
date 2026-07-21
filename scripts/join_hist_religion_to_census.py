#!/usr/bin/env python
"""Join a parsed historical NI religion table (by 26 Local Government Districts)
onto the 2021 Data Zones and 2011 Small Areas, reusing the LGD_1993 crosswalk
built for 1991. Generalises join_1991_religion_to_census.py to any census year
whose religion table is keyed by the 26 post-1973 LGDs (i.e. 1981 and 1991).

Usage: join_hist_religion_to_census.py <year>
  reads data/census/derived/religion-<year>-lgd.csv
  writes data/census/derived/dz21-religion-<year>-lgd.csv
         data/census/derived/sa2011-religion-<year>-lgd.csv
"""
import sys, re
from pathlib import Path
import pandas as pd

YEAR = sys.argv[1] if len(sys.argv) > 1 else "1981"
D = Path("data/census/derived")
def norm(s): return re.sub(r"[^a-z0-9]", "", str(s).lower())

def main():
    rel = pd.read_csv(D / f"religion-{YEAR}-lgd.csv")
    rel = rel[rel["lgd"] != "NORTHERN IRELAND"].copy()
    rel["k"] = rel["lgd"].map(lambda s: norm(str(s).replace("Londonderry", "Derry")))
    popcol = "total_pop" if "total_pop" in rel.columns else "weight_pop_1981"
    keep = rel.set_index("k")[["catholic_pct", popcol]].rename(
        columns={"catholic_pct": f"catholic_pct_{YEAR}", popcol: f"lgd{YEAR}_pop"})

    for cfg, xw_file, idcols in [
        ("dz21", "dz2021_to_lgd1993.csv", ["DZ2021_cd", "DZ2021_nm"]),
        ("sa2011", "sa2011_to_lgd1993.csv", ["SA2011"]),
    ]:
        xw = pd.read_csv(D / xw_file)
        xw["k"] = xw["lgd1993"].map(lambda s: norm(str(s).replace("Londonderry", "Derry")))
        out = xw[idcols + ["lgd1993", "k"]].join(keep, on="k").drop(columns=["k"])
        unmatched = sorted(set(xw["k"]) - set(keep.index))
        out.to_csv(D / f"{cfg}-religion-{YEAR}-lgd.csv", index=False)
        cov = out[f"catholic_pct_{YEAR}"].notna().mean() * 100
        print(f"{cfg}: {len(out)} units, {cov:.1f}% with {YEAR} RC%; "
              f"unmatched LGD keys: {unmatched or 'none'}  -> {cfg}-religion-{YEAR}-lgd.csv")
        if cfg == "dz21":
            m = (out[f"catholic_pct_{YEAR}"] * out[f"lgd{YEAR}_pop"]).sum() / out[f"lgd{YEAR}_pop"].sum()
            print(f"   pop-weighted mean {YEAR} RC% over DZs: {m:.1f}")

if __name__ == "__main__":
    main()
