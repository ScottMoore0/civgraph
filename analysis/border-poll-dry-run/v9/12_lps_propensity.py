#!/usr/bin/env python3
"""v9 phase 12 — property-level unity propensity, and the polling-district rollup.

Phase 11 established that the LPS address features do NOT improve the DEA-level
model (leave-one-council-out shape MAE 4.94 -> 5.63 when all 18 are added; best
greedy subset -0.05 pts, selected on the metric it is scored against, against a
pre-registered bar of -0.30). So this script does NOT use them as predictors.

What the address dataset does deliver, and what this builds:

  1. PROPERTY-LEVEL PROPENSITY. Every one of the 831,159 NI addresses gets the
     projected unity share of the Data Zone it sits in. This is piecewise-constant
     within a DZ -- deliberately. A within-DZ tilt from the address lexicons was
     tested in phase 11 and did not survive, so applying one here would be
     inventing precision the validation refused. The property layer's value is
     that it is ADDRESSABLE and re-aggregatable, not that it resolves below DZ.

  2. POLLING-DISTRICT ROLLUP. Properties carry POLLING_ID, joining to the 607 NI
     polling stations. Polling districts are NOT census geographies and cannot be
     reached from the census frame at all -- this is genuinely new information,
     and it is the geography a referendum is actually administered on.

LOCAL ONLY -- outputs land in lps/, which is gitignored.
"""
import os, glob
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'lps')
STATIONS = os.environ.get('EONI_STATIONS', 'D:/eoni/polling_stations.geojson')


def log(m):
    print(m, flush=True)


def main():
    props = pd.read_parquet(os.path.join(OUT, 'properties.parquet'))
    log(f"properties: {len(props):,}")

    # ---- external check: our POLLING_ID assignment vs EONI's own counts ----
    st = gpd.read_file(STATIONS).drop(columns='geometry')
    st = st.rename(columns={'Polling_ID': 'POLLING_ID'})
    mine = props.groupby('POLLING_ID').size().rename('n_assigned')
    chk = st.set_index('POLLING_ID')[['BUILDING_NAME', 'TotalProperties']].join(mine)
    # 5 of the 607 station rows carry a UPRN (~1.85e8) in TotalProperties -- a
    # column-shift defect in the EONI source. Drop them from the check rather than
    # let them swamp the comparison; the property assignment itself is unaffected.
    bad = chk.TotalProperties > 20000
    ok = chk[~bad]
    ok = ok.assign(diff=ok.n_assigned - ok.TotalProperties)
    log("\npolling-station assignment check (our count vs EONI TotalProperties):")
    log(f"  stations: {len(chk)}  ({int(bad.sum())} dropped: UPRN in TotalProperties)")
    log(f"  our total: {int(chk.n_assigned.sum()):,}   "
        f"EONI total (clean rows): {int(ok.TotalProperties.sum()):,}")
    log("  median |diff|: %.0f properties (%.1f%% of a typical district)   max |diff|: %.0f"
        % (ok['diff'].abs().median(),
           100 * ok['diff'].abs().median() / ok.TotalProperties.median(),
           ok['diff'].abs().max()))

    # ---- property-level propensity, one column per projection date ----
    files = sorted(glob.glob(os.path.join(HERE, 'areas_output', '*_DZ21.csv')))
    log(f"\nprojection dates: {[os.path.basename(f)[:7] for f in files]}")
    prop = props[['UPRN', 'POSTCODE', 'POLLING_ID', 'X_COR', 'Y_COR', 'addr_full',
                  'DZ2021_cd', 'SDZ2021_cd', 'DEA2014_nm', 'LGD2014_nm']].copy()
    dates = []
    for f in files:
        d = os.path.basename(f)[:7]
        dates.append(d)
        dz = pd.read_csv(f).set_index('DZ21')
        prop[f'unity_{d}'] = prop.DZ2021_cd.map(dz.proj_unity_pct)
        if 'catholic_bg_pct' in dz.columns and 'catholic_bg_pct' not in prop.columns:
            prop['catholic_bg_pct'] = prop.DZ2021_cd.map(dz.catholic_bg_pct)
    miss = prop[f'unity_{dates[-1]}'].isna().sum()
    log(f"  properties with no DZ projection: {miss:,}")

    pq = os.path.join(OUT, 'property_propensity.parquet')
    prop.to_parquet(pq, index=False)
    log(f"wrote {pq}  ({len(prop):,} rows x {prop.shape[1]} cols)")

    # ---- polling-district rollup (the genuinely new geography) ----
    ucols = [f'unity_{d}' for d in dates]
    g = prop.groupby('POLLING_ID')
    roll = g[ucols].mean()
    roll.insert(0, 'n_properties', g.size())
    roll['dominant_dea'] = g.DEA2014_nm.agg(lambda s: s.mode().iat[0])
    roll['dominant_lgd'] = g.LGD2014_nm.agg(lambda s: s.mode().iat[0])
    roll['n_datazones'] = g.DZ2021_cd.nunique()
    roll = roll.join(st.set_index('POLLING_ID')[['BUILDING_NAME']])
    roll.to_csv(os.path.join(OUT, 'polling_district_unity.csv'))
    log(f"wrote polling_district_unity.csv  ({len(roll)} polling districts)")

    last = f'unity_{dates[-1]}'
    log(f"\nprojected unity by polling district, {dates[-1]} "
        f"(property-weighted, NOT elector-weighted):")
    log("  min %.1f  p10 %.1f  median %.1f  p90 %.1f  max %.1f"
        % (roll[last].min(), roll[last].quantile(.1), roll[last].median(),
           roll[last].quantile(.9), roll[last].max()))
    maj = roll[roll[last] > 50]
    log("  districts projecting a unity majority: %d/%d (%.1f%% of properties)"
        % (len(maj), len(roll), 100 * maj.n_properties.sum() / roll.n_properties.sum()))
    log("\n  most pro-unity districts:")
    for pid, r in roll.nlargest(5, last).iterrows():
        log("    %5s %-42s %5.1f  (%s)" % (pid, str(r.BUILDING_NAME)[:42],
                                           r[last], r.dominant_lgd))
    log("  least pro-unity districts:")
    for pid, r in roll.nsmallest(5, last).iterrows():
        log("    %5s %-42s %5.1f  (%s)" % (pid, str(r.BUILDING_NAME)[:42],
                                           r[last], r.dominant_lgd))

    # within-district heterogeneity: how much a single district hides
    spread = prop.groupby('POLLING_ID')[last].agg(['min', 'max'])
    log("\n  within-district spread of DZ projections (pts): median %.1f, max %.1f"
        % ((spread['max'] - spread['min']).median(), (spread['max'] - spread['min']).max()))


if __name__ == '__main__':
    main()
