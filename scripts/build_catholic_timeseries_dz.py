#!/usr/bin/env python
"""Assemble the long-run Catholic-share time series per 2021 Data Zone from the
integrated historical census layers: 1971, 1981, 1991 (district resolution) and
2021 (community background, DZ resolution). Gives the model a ~50-year Catholic
trajectory on a common frame.

Definitional note (why the levels are not one clean series):
  1971  CAIN retabulated % Catholics on 26 districts (community-style)
  1981  enumerated Roman Catholic % of usually-resident -- BOYCOTT-DEPRESSED
        (voluntary question, ~18.5% not-stated + ~19k non-returns in nationalist
        areas), so 1981 dips below both 1971 and 1991: an artefact, not a fall.
  1991  enumerated Roman Catholic % (district) -- ~11% not-stated
  2021  Catholic 'belong to / brought up in' (community background), DZ level
The trajectory is directional/rank-robust; absolute year-on-year deltas mix real
demographic change with these definitional shifts. Documented, not smoothed over.

Output: data/census/derived/dz21-catholic-timeseries.csv
"""
from pathlib import Path
import pandas as pd

D = Path("data/census/derived")
V = Path("analysis/border-poll-dry-run/v9")

def main():
    base = pd.read_csv(D / "dz21-religion-1971-lgd.csv")[["DZ2021_cd", "DZ2021_nm", "lgd1993", "catholic_pct_1971"]]
    for yr in (1981, 1991):
        col = f"catholic_pct_{yr}"
        f = D / f"dz21-religion-{yr}-lgd.csv"
        if yr == 1991:
            f = D / "dz21-religion-1991-lgd.csv"; col = "catholic_pct"
        t = pd.read_csv(f)
        key = "catholic_pct" if yr == 1991 else col
        base = base.merge(t[["DZ2021_cd", key]].rename(columns={key: f"cath_{yr}"}), on="DZ2021_cd", how="left")
    base = base.rename(columns={"catholic_pct_1971": "cath_1971"})
    # 2021 community background from the model's DZ feature frame
    f21 = pd.read_csv(V / "dz_features.csv")
    catcol = next(c for c in f21.columns if c.startswith("rel__Catholic"))
    base = base.merge(f21[["area", catcol]].rename(columns={"area": "DZ2021_cd", catcol: "cath_2021"}),
                      on="DZ2021_cd", how="left")
    base["cath_growth_1971_2021"] = (base["cath_2021"] - base["cath_1971"]).round(1)
    out = D / "dz21-catholic-timeseries.csv"
    base.to_csv(out, index=False)

    pop = pd.read_csv(D / "ms-a01-dz.csv").set_index("GeographyCode")["AllUsualResidents"]
    w = base["DZ2021_cd"].map(pop)
    def wm(c):
        d = pd.DataFrame({"v": base[c], "w": w}).dropna(); return (d.v * d.w).sum() / d.w.sum()
    print(f"wrote {out} ({len(base)} DZs)")
    print("NI Catholic-share trajectory (pop21-weighted):")
    for c, lab in [("cath_1971", "1971 (CAIN district)"), ("cath_1981", "1981 (enumerated, BOYCOTT)"),
                   ("cath_1991", "1991 (enumerated)"), ("cath_2021", "2021 (community bg)")]:
        print(f"  {lab:30s} {wm(c):5.1f}%")
    print(f"  1971 -> 2021 shift: {wm('cath_2021') - wm('cath_1971'):+.1f} pts")

if __name__ == "__main__":
    main()
