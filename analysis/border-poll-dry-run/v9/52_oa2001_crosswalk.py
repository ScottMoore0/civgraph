#!/usr/bin/env python3
"""v9 phase 52 — the 2001 Output Area geography, and the OA/SA/DZ crosswalk triangle.

Until now the model's census geography was DZ2021 alone, with SA2011 appearing only
as a crosswalk vehicle in phase 30 and 1991 arriving pre-mapped in
`dz21-census-1991.csv`. OA2001 was absent entirely, which meant the 2001 and 2005
contests were being fitted with either 1991 or 2021 demography when 2001 was the
correct vintage and was sitting on disk the whole time.

This phase closes the geography half of that gap. It builds every pairwise crosswalk
between the three census geographies rather than only the ones needed today:

    OA2001 (5,022)  <->  SA2011 (4,537)  <->  DZ2021 (3,780)

Method — areal interpolation, not centroid assignment. Phase 30's SA2011 crosswalk
used centroids and populated only 2,840 of 3,780 Data Zones, because a centroid falls
in exactly one target and small units in dense areas leave large ones empty. Here each
source unit's area is split across every target it intersects, so weights sum to 1 per
source and every target that is genuinely covered receives mass. Both are emitted:

    *_weights.csv   source, target, weight   -- for apportioning COUNTS
    *_crosswalk.csv source -> dominant target, plus the pop-weighted-centroid target

The population-weighted centroid is used for the hard assignment where available
(OA2001 ships X_POPCOORD/Y_POPCOORD in Irish Grid), because for a hard 1:1 label the
centre of population is a better representative point than the centre of area.

Areas are computed in Irish Grid (EPSG:29902), not in degrees.
"""
import os, sys, json
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GEO = os.path.join(HERE, '_geo')
OUT = os.path.join(REPO, 'data', 'census', 'derived')
IG = 29902                      # Irish Grid, the CRS the NI census coordinates use

R2 = 'https://data.civgraph.net/data/maps/census-areas/{}.fgb'
DEA_R2 = 'https://data.civgraph.net/data/maps/local-government/DEAs_{}.fgb'


def load(name, url=None):
    p = os.path.join(GEO, f'{name}.fgb')
    if not os.path.exists(p):
        import urllib.request
        os.makedirs(GEO, exist_ok=True)
        urllib.request.urlretrieve(url or R2.format(name), p)
    g = gpd.read_file(p)
    if g.crs is None:
        g = g.set_crs(4326)
    return g.to_crs(IG)


def weights(src, src_id, tgt, tgt_id):
    """Areal-interpolation weights: for each source unit, its share of area falling
    in each target unit. Weights sum to ~1 per source (less where the source pokes
    outside the target layer, e.g. at the coast where vintages digitise differently)."""
    s = src[[src_id, 'geometry']].copy()
    t = tgt[[tgt_id, 'geometry']].copy()
    s['_srcarea'] = s.geometry.area
    ix = gpd.overlay(s, t, how='intersection', keep_geom_type=True)
    ix['_ia'] = ix.geometry.area
    ix['weight'] = ix._ia / ix._srcarea
    ix = ix[ix.weight > 1e-6]
    return ix[[src_id, tgt_id, 'weight']].sort_values([src_id, 'weight'],
                                                      ascending=[True, False])


def dominant(w, src_id, tgt_id):
    return w.groupby(src_id, as_index=False).first()[[src_id, tgt_id]]


def by_point(src, src_id, tgt, tgt_id, xcol=None, ycol=None):
    """Hard assignment by representative point -- population-weighted where the layer
    provides one, geometric centroid otherwise."""
    p = src[[src_id]].copy()
    if xcol and xcol in src.columns and src[xcol].notna().any():
        p['geometry'] = gpd.points_from_xy(src[xcol], src[ycol], crs=IG)
        how = 'pop-weighted centroid'
    else:
        p['geometry'] = src.geometry.representative_point()
        how = 'representative point'
    p = gpd.GeoDataFrame(p, geometry='geometry', crs=IG)
    j = gpd.sjoin(p, tgt[[tgt_id, 'geometry']], how='left', predicate='within')
    return j[[src_id, tgt_id]].drop_duplicates(src_id), how


def report(name, w, src_id, tgt_id, n_src, n_tgt):
    cov = w[tgt_id].nunique()
    ws = w.groupby(src_id).weight.sum()
    split = (w.groupby(src_id).size() > 1).mean()
    print(f"  {name:26} {len(w):7,} pairs | targets hit {cov:5,}/{n_tgt:,} "
          f"({100*cov/n_tgt:5.1f}%) | sum(w) med {ws.median():.3f} "
          f"| split across >1: {100*split:.0f}%")


def main():
    print("=" * 78)
    print("PHASE 52 — OA2001 / SA2011 / DZ2021 crosswalk triangle (areal interpolation)")
    os.makedirs(OUT, exist_ok=True)

    print("\n  loading geographies (reprojected to Irish Grid)")
    oa = load('OA2001')
    sa = load('SA2011')
    dz = load('DZ2021')
    print(f"    OA2001 {len(oa):,}   SA2011 {len(sa):,}   DZ2021 {len(dz):,}")

    pairs = [
        ('OA2001->DZ2021', oa, 'OA_CODE', dz, 'DZ2021_cd', 'X_POPCOORD', 'Y_POPCOORD'),
        ('OA2001->SA2011', oa, 'OA_CODE', sa, 'SA2011', 'X_POPCOORD', 'Y_POPCOORD'),
        ('SA2011->DZ2021', sa, 'SA2011', dz, 'DZ2021_cd', 'X_COORD', 'Y_COORD'),
        ('SA2011->OA2001', sa, 'SA2011', oa, 'OA_CODE', 'X_COORD', 'Y_COORD'),
        ('DZ2021->OA2001', dz, 'DZ2021_cd', oa, 'OA_CODE', None, None),
        ('DZ2021->SA2011', dz, 'DZ2021_cd', sa, 'SA2011', None, None),
    ]

    print("\n  areal-interpolation weights")
    built = {}
    for name, s, sid, t, tid, xc, yc in pairs:
        w = weights(s, sid, t, tid)
        report(name, w, sid, tid, len(s), len(t))
        stem = name.replace('->', '_to_').lower()
        w.to_csv(os.path.join(OUT, f'{stem}_weights.csv'), index=False)
        dom = dominant(w, sid, tid).rename(columns={tid: f'{tid}_dominant'})
        pt, how = by_point(s, sid, t, tid, xc, yc)
        pt = pt.rename(columns={tid: f'{tid}_point'})
        cw = dom.merge(pt, on=sid, how='outer')
        agree = (cw[f'{tid}_dominant'] == cw[f'{tid}_point']).mean()
        cw.to_csv(os.path.join(OUT, f'{stem}_crosswalk.csv'), index=False)
        print(f"    {'':24} hard assignment via {how}; "
              f"agrees with dominant-area on {100*agree:.1f}%")
        built[name] = w

    # ---- OA2001 -> the DEA vintages, matching sa2011_to_deas / dz2021_to_deas ----
    print("\n  OA2001 -> DEA vintages (to match the existing SA/DZ crosswalk family)")
    oad = oa[['OA_CODE']].copy()
    for v in ['1972', '1984', '1993']:
        g = load(f'DEAs_{v}', DEA_R2.format(v))
        namecol = next((c for c in g.columns
                        if c.lower() in ('dea_name', 'name', 'dea', 'deaname')), None)
        if namecol is None:
            namecol = [c for c in g.columns if g[c].dtype == object][0]
        w = weights(oa, 'OA_CODE', g.assign(_d=g[namecol]), '_d')
        d = dominant(w, 'OA_CODE', '_d').rename(columns={'_d': f'dea_{v}'})
        oad = oad.merge(d, on='OA_CODE', how='left')
        print(f"    dea_{v:5} assigned {oad[f'dea_{v}'].notna().sum():,}/{len(oad):,}")
    # 2012/2014 DEAs come from the DZ2021 attributes via the dominant DZ
    dzd = built['OA2001->DZ2021'].groupby('OA_CODE', as_index=False).first()
    m = dz.set_index('DZ2021_cd')['DEA2014_nm']
    oad['dea_2012'] = oad.OA_CODE.map(dzd.set_index('OA_CODE').DZ2021_cd.map(m))
    print(f"    dea_2012  assigned {oad.dea_2012.notna().sum():,}/{len(oad):,}")
    oad.to_csv(os.path.join(OUT, 'oa2001_to_deas.csv'), index=False)

    # ---- the master OA table: ward, district, and each census geography ----
    master = oa[['OA_CODE']].copy()
    master['ward_2001'] = master.OA_CODE.str[:6]
    master['lgd_2001'] = master.OA_CODE.str[:4]
    for name, tid in [('OA2001->DZ2021', 'DZ2021_cd'), ('OA2001->SA2011', 'SA2011')]:
        d = dominant(built[name], 'OA_CODE', tid)
        master = master.merge(d, on='OA_CODE', how='left')
    master = master.merge(oad, on='OA_CODE', how='left')
    master.to_csv(os.path.join(OUT, 'oa2001_master_crosswalk.csv'), index=False)
    print(f"\n  wrote oa2001_master_crosswalk.csv  {master.shape}")
    print(f"    OAs with a DZ2021: {master.DZ2021_cd.notna().sum():,}  "
          f"with an SA2011: {master.SA2011.notna().sum():,}  "
          f"wards {master.ward_2001.nunique():,}  districts {master.lgd_2001.nunique()}")

    print("\n  coverage check vs the phase-30 centroid crosswalk")
    d2s = built['DZ2021->SA2011']
    print(f"    DZ2021 reached by SA2011 areal weights: "
          f"{built['SA2011->DZ2021'].DZ2021_cd.nunique():,}/3,780 "
          f"(phase 30 centroid method reached 2,840)")


if __name__ == '__main__':
    main()
