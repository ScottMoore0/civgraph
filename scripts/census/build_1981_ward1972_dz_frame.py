#!/usr/bin/env python3
"""Carry the 1981 ward census onto the model's Data-Zone / Small-Area frame.

The v9 model's census inputs start at 1991. This adds a 1981 layer, on the frame the
model already uses, following the method already established by
scripts/build_1991_sas_dz_frame.py step 3: assign every DZ/SA to its containing historic
ward by representative-point-in-polygon and carry the ward's covariates onto it.

WHAT MAY BE CARRIED, AND WHAT MAY NOT. That precedent carries RATES. A rate is a property
of the ward and remains true of any part of it under the assumption of homogeneity, so
copying it onto a contained DZ is a stated approximation with a clear meaning. A COUNT is
not: a ward's 1981 population cannot be copied onto each of the eight Data Zones inside
it, because it belongs to their union. So the counts are emitted only as ward context,
named ward_pop_* so they cannot be mistaken for a Data Zone's own population, and the
model-facing covariates are the three rates:

    ward_pop_change_pct   1971 -> 1981. This is the covariate worth having. It separates
                          the emptying inner city from the new town: Brownlow grew 264%
                          while 298 of the 526 wards lost population.
    ward_male_pct_1981
    ward_pop_density_1981 persons per km2, from the layer's own Area_SqKM

APPORTIONED COUNTS ARE PROVIDED SEPARATELY, AND ARE WEAKER. For anyone who does need a
count, the area-weighted overlap table gives each (ward, DZ) intersection and apportions
population by area share. That assumes uniform density inside each 1972 ward, which is
worst exactly where it matters most -- a large rural ward containing one small town gets
its townspeople spread evenly across the fields. Treat those columns as an estimate with
real error, not as data. The rates above do not depend on that assumption.

DO NOT DIFFERENCE THESE COUNTS AGAINST THE 1991 FRAME. dz21-census-1991.csv carries
total_pop from the 1984 ward containing each DZ; this file carries ward_pop_1981 from the
1972 ward containing it. Those are different partitions of the same country -- 526
polygons against 566 -- so a DZ's two numbers describe two differently-drawn
neighbourhoods, and subtracting them measures the boundary revision rather than any
demographic change. The within-vintage 1971->1981 change is safe precisely because both
its years are printed against the same 1972 wards. For a genuine cross-vintage
comparison use density, which is why dz_area_ha is carried here.

1972 WARDS DO NOT NEST INTO ANYTHING MODERN. They predate the 1984 revision, so they
align neither with 1984 wards nor with DZ2021/SA2011 boundaries. Containment is therefore
approximate by construction: a DZ straddling two 1972 wards is assigned to whichever one
holds its representative point. The overlap table quantifies how often that is a close
call, via the share of each DZ's area that its assigned ward actually covers.

Inputs:  data/census/derived/ward1972-pop-1981.csv          (from build_ward1972_pop_layer.py)
         data/maps/local-government/staged-w72id/Wards_1972.fgb
Outputs (data/census/derived/):
         ward1972-census-1981-covariates.csv   526 wards x covariates
         dz2021_to_ward1972.csv                DZ -> 1972 ward key
         sa2011_to_ward1972.csv                SA -> 1972 ward key
         dz21-census-1981.csv                  DZ x 1981 ward covariates
         sa2011-census-1981.csv                SA x 1981 ward covariates
         ward1972_to_dz2021_weights.csv        area-weighted overlap + apportioned counts
"""
import os, re, csv, warnings

warnings.filterwarnings('ignore')
import geopandas as gpd
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
DER = os.path.join(REPO, 'data', 'census', 'derived')
STAGE = os.path.join(REPO, 'data', 'maps', 'local-government', 'staged-w72id')
CA = 'C:/Users/scomo/boundaries-website/data/maps/census-areas'

WARDS = os.path.join(STAGE, 'Wards_1972.fgb')
POPCSV = os.path.join(DER, 'ward1972-pop-1981.csv')
IG = 29902                     # Irish Grid, metres -- areas must be planar


def key(district, ward):
    """The model's ward_key convention, as used by dz2021_to_ward1984.csv: 'lgd|ward'."""
    n = lambda s: re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', str(s).lower())).strip()
    return f'{n(district)}|{n(ward)}'


def covariates():
    df = pd.read_csv(POPCSV)
    w = gpd.read_file(WARDS).to_crs(IG)[['W72_ID', 'Area_SqKM', 'geometry']]
    df = df.merge(w[['W72_ID', 'Area_SqKM']], on='W72_ID', how='left', validate='1:1')
    if df['Area_SqKM'].isna().any():
        raise SystemExit('  ward missing from the staged layer')
    df['ward_key'] = [key(d, g) for d, g in zip(df['District'], df['Geography'])]
    if df['ward_key'].duplicated().any():
        dup = df.loc[df['ward_key'].duplicated(), 'ward_key'].tolist()[:5]
        raise SystemExit(f'  ward_key collision: {dup}')
    df['ward_pop_1971'] = df['pop_1971_persons']
    df['ward_pop_1981'] = df['pop_1981_persons']
    df['ward_pop_change_pct'] = ((df['pop_1981_persons'] - df['pop_1971_persons'])
                                 / df['pop_1971_persons'] * 100).round(2)
    df['ward_male_pct_1981'] = (df['pop_1981_males'] / df['pop_1981_persons'] * 100).round(2)
    df['ward_pop_density_1981'] = (df['pop_1981_persons'] / df['Area_SqKM']).round(1)
    return df, w


def assign(target, tcols, wards, label):
    """Containment assignment, exactly as the 1991 frame does it.

    representative_point() rather than centroid: a DZ can be concave enough that its
    centroid lies outside it, which would test the wrong ward.
    """
    t = gpd.read_file(target).to_crs(IG)
    # Selecting only the attribute columns gives a plain DataFrame, and assigning a
    # geometry column to one does not make it a GeoDataFrame -- build it explicitly.
    p = gpd.GeoDataFrame(t[tcols].copy(), geometry=t.representative_point(), crs=t.crs)
    j = gpd.sjoin(p, wards[['W72_ID', 'geometry']], how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    # A handful sit in the sliver between two 1972 polygons, or just off the coastline
    # where the vintages disagree. Fall back to the nearest ward rather than dropping them.
    lost = j['W72_ID'].isna()
    n_near = int(lost.sum())
    if n_near:
        fix = gpd.sjoin_nearest(p[lost.values][tcols + ['geometry']],
                               wards[['W72_ID', 'geometry']], how='left')
        fix = fix[~fix.index.duplicated(keep='first')]
        j.loc[lost, 'W72_ID'] = fix['W72_ID']
    if j['W72_ID'].isna().any():
        raise SystemExit(f'  {label}: {int(j["W72_ID"].isna().sum())} unassigned')
    print(f'  {label}: {len(j)} assigned  ({n_near} by nearest-ward fallback)')
    return j[tcols + ['W72_ID']]


def main():
    cov, wards = covariates()
    RATES = ['ward_pop_1971', 'ward_pop_1981', 'ward_pop_change_pct',
             'ward_male_pct_1981', 'ward_pop_density_1981']
    cov[['W72_ID', 'ward_key', 'District', 'Geography', 'Area_SqKM'] + RATES] \
        .to_csv(os.path.join(DER, 'ward1972-census-1981-covariates.csv'), index=False)
    print(f'  wards: {len(cov)}   '
          f"density {cov['ward_pop_density_1981'].min():.0f}"
          f"-{cov['ward_pop_density_1981'].max():.0f}/km2   "
          f"change {cov['ward_pop_change_pct'].min():.0f}%..+"
          f"{cov['ward_pop_change_pct'].max():.0f}%")

    look = cov[['W72_ID', 'ward_key'] + RATES]

    # ---- DZ2021 and SA2011 frames
    # Area_ha is carried through so a downstream consumer can build a 1981-vs-2021
    # DENSITY trajectory without needing geometry. Density is the only cross-vintage
    # comparison available here: see the note on counts in the module docstring.
    dz = assign(CA + '/DZ2021.fgb', ['DZ2021_cd', 'DZ2021_nm', 'Area_ha'], wards, 'DZ2021')
    dz = dz.merge(look, on='W72_ID', how='left').rename(columns={'Area_ha': 'dz_area_ha'})
    dz[['DZ2021_cd', 'DZ2021_nm', 'ward_key']].to_csv(
        os.path.join(DER, 'dz2021_to_ward1972.csv'), index=False)
    dz[['DZ2021_cd', 'DZ2021_nm', 'ward_key', 'dz_area_ha'] + RATES].to_csv(
        os.path.join(DER, 'dz21-census-1981.csv'), index=False)

    sa = assign(CA + '/SA2011.fgb', ['SA2011'], wards, 'SA2011')
    sa = sa.merge(look, on='W72_ID', how='left')
    sa[['SA2011', 'ward_key']].to_csv(
        os.path.join(DER, 'sa2011_to_ward1972.csv'), index=False)
    sa[['SA2011', 'ward_key'] + RATES].to_csv(
        os.path.join(DER, 'sa2011-census-1981.csv'), index=False)

    # ---- area-weighted overlap. Reported, and explicitly the weaker product.
    t = gpd.read_file(CA + '/DZ2021.fgb').to_crs(IG)[['DZ2021_cd', 'geometry']]
    t['dz_area'] = t.area
    wg = wards.merge(cov[['W72_ID', 'ward_key', 'pop_1981_persons', 'pop_1971_persons']],
                     on='W72_ID', how='left')
    wg['ward_area'] = wg.area
    ov = gpd.overlay(wg, t, how='intersection', keep_geom_type=True)
    ov['inter_area'] = ov.area
    ov = ov[ov['inter_area'] > 1.0]
    ov['share_of_ward'] = ov['inter_area'] / ov['ward_area']
    ov['share_of_dz'] = ov['inter_area'] / ov['dz_area']
    ov['pop_1981_apportioned'] = (ov['pop_1981_persons'] * ov['share_of_ward']).round(1)
    ov['pop_1971_apportioned'] = (ov['pop_1971_persons'] * ov['share_of_ward']).round(1)
    cols = ['W72_ID', 'ward_key', 'DZ2021_cd', 'inter_area', 'share_of_ward',
            'share_of_dz', 'pop_1971_apportioned', 'pop_1981_apportioned']
    ov[cols].sort_values(['W72_ID', 'DZ2021_cd']).to_csv(
        os.path.join(DER, 'ward1972_to_dz2021_weights.csv'), index=False)

    # How much of each ward's population survives apportionment measures how much of the
    # 1972 ward area is covered by Data Zones at all. Measured: 99.9% survives and only
    # two wards fall below 95% coverage, so the two vintages tile almost the same
    # territory and the residual is a rounding-scale sliver, not a systematic hole.
    tot = ov['pop_1981_apportioned'].sum()
    covd = ov.groupby('W72_ID')['share_of_ward'].sum()
    straddle = int((ov.groupby('DZ2021_cd')['share_of_dz'].max() < 0.9).sum())
    print(f'  overlap pairs: {len(ov):,}   mean DZ per ward: {len(ov)/len(cov):.1f}')
    print(f'  apportioned 1981 total: {tot:,.0f} of 1,490,228 '
          f'({tot/1490228*100:.1f}% -- remainder is ward area under water)')
    print(f'  wards <95% covered by Data Zones: {int((covd < 0.95).sum())}')
    print(f'  Data Zones straddling 1972 wards (no ward covers 90%): {straddle:,} '
          f'of {t.shape[0]:,}')
    print('\n  wrote 6 files to data/census/derived/')


if __name__ == '__main__':
    main()
