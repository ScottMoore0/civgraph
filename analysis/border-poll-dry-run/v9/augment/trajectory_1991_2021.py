#!/usr/bin/env python3
"""1991 -> 2021 demographic TRAJECTORY per Data Zone, from the newly-integrated
full 1991 SAS (data/census/derived/dz21-census-1991.csv) joined to the model's
2021 DZ census features (dz_features.csv).

Border-poll relevant momentum is not just the *level* of Catholic share but its
*trajectory*: a DZ at 40% Catholic and rising fast behaves differently from one
at 40% and static. This lands a 30-year momentum vector on every DZ:

  cath_growth_9121   2021 Catholic(community-background) - 1991 Catholic(religion)
  secular_growth     2021 None-religion - 1991 None-religion
  unemp_fall         1991 unemployment - 2021-proxy (economic convergence)
  socrent_fall       1991 social-rent  - 2021 social-rent (tenure shift)

Definitional caveat: 1991 religion is *stated religion* (~7% not-stated); 2021 is
*religion belonged-to / brought-up-in* (community background). The two are not the
same construct, so cath_growth_9121 mixes real Catholic-share growth with the
not-stated -> assigned reclassification. Direction and rank are robust; the
absolute delta is an upper bound. Documented, not silently shipped.

Output: dz21_trajectory_1991_2021.csv (per DZ), + printed NI trajectory + a check
that 1991->2021 Catholic momentum tracks the projected nationalist gradient.
"""
import os, glob
import pandas as pd, numpy as np

HERE = os.path.dirname(__file__) or "."
V = os.path.dirname(HERE)
ROOT = os.path.abspath(f"{V}/../../..")

f91 = pd.read_csv(f"{ROOT}/data/census/derived/dz21-census-1991.csv")
f21 = pd.read_csv(f"{V}/dz_features.csv")
pop = pd.read_csv(f"{ROOT}/data/census/derived/ms-a01-dz.csv").set_index("GeographyCode")["AllUsualResidents"]

catcol  = next(c for c in f21.columns if c.startswith("rel__Catholic"))
nonecol = "rel__None"
# 2021 unemployment share (of the econ block) and social-rent share (of tenure)
unemp21col = next(c for c in f21.columns if c.startswith("econ__Economically active: Unemployed"))
socren21  = [c for c in f21.columns if c.startswith("ten__Social rented")]

m = f91.merge(f21, left_on="DZ2021_cd", right_on="area", how="inner").copy()
derived = pd.DataFrame({
    "pop21": m["DZ2021_cd"].map(pop),
    "soc_rent_21": m[socren21].sum(axis=1),
})
derived["cath_growth_9121"] = (m[catcol] - m["rc_pct"]).round(2)
derived["secular_growth"]   = (m[nonecol] - m["none_relig_pct"]).round(2)
derived["socrent_fall"]     = (m["social_rent_pct"] - derived["soc_rent_21"]).round(2)
m = pd.concat([m, derived], axis=1)

out = m[["DZ2021_cd", "DZ2021_nm", "ward_key",
         "rc_pct", catcol, "cath_growth_9121",
         "none_relig_pct", nonecol, "secular_growth",
         "unemployment_pct", "social_rent_pct", "soc_rent_21", "socrent_fall",
         "no_car_pct", "llti_pct", "degree_pct"]].copy()
out.columns = ["DZ2021_cd", "DZ2021_nm", "ward_key",
               "cath_1991", "cath_2021", "cath_growth_9121",
               "none_1991", "none_2021", "secular_growth",
               "unemp_1991", "socrent_1991", "socrent_2021", "socrent_fall",
               "nocar_1991", "llti_1991", "degree_1991"]
out.to_csv(f"{HERE}/dz21_trajectory_1991_2021.csv", index=False)

def wm(col):
    d = m[[col, "pop21"]].dropna(); return (d[col] * d["pop21"]).sum() / d["pop21"].sum()

print(f"wrote dz21_trajectory_1991_2021.csv ({len(out)} DZs)")
print("\nNI trajectory 1991 -> 2021 (pop21-weighted):")
print(f"  Catholic:        {wm('rc_pct'):5.1f} -> {wm(catcol):5.1f}   ({wm('cath_growth_9121'):+.1f} pts)")
print(f"  No religion:     {wm('none_relig_pct'):5.1f} -> {wm(nonecol):5.1f}   ({wm('secular_growth'):+.1f} pts)")
print(f"  Social rent:     {wm('social_rent_pct'):5.1f} -> {wm('soc_rent_21'):5.1f}   ({wm('socrent_fall'):+.1f} pts fall)")

# does 1991->2021 Catholic momentum align with the projected nationalist gradient?
proj = sorted(glob.glob(f"{V}/areas_output/*_DZ21.csv"))
if proj:
    dz = pd.read_csv(proj[-1])           # cols: DZ21, catholic_bg_pct, proj_unity_pct, provenance
    natcol = "proj_unity_pct" if "proj_unity_pct" in dz.columns else None
    if natcol:
        j = out.merge(dz[["DZ21", natcol]], left_on="DZ2021_cd", right_on="DZ21", how="inner").dropna(subset=[natcol])
        r_lvl = np.corrcoef(j["cath_2021"], j[natcol])[0, 1]
        r_mom = np.corrcoef(j["cath_growth_9121"], j[natcol])[0, 1]
        print(f"\nvs projected pro-unity ({os.path.basename(proj[-1])}, col '{natcol}', n={len(j)}):")
        print(f"  r(2021 Catholic level, pro-unity)          = {r_lvl:+.3f}")
        print(f"  r(1991->2021 Catholic momentum, pro-unity)  = {r_mom:+.3f}")
        # partial: does momentum add over level? residualise unity on level, corr with momentum
        b = np.polyfit(j["cath_2021"], j[natcol], 1)
        resid = j[natcol] - np.polyval(b, j["cath_2021"])
        r_part = np.corrcoef(j["cath_growth_9121"], resid)[0, 1]
        print(f"  r(momentum, pro-unity | 2021 level removed) = {r_part:+.3f}  (added trajectory signal)")
