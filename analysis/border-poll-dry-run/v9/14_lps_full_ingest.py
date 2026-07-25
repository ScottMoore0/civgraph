#!/usr/bin/env python3
"""v9 phase 14 — the FULL LPS valuation dataset: capital value, era built, form.

Supersedes phase 10. Phase 10 used the EONI address gazetteer, which carries no
valuation and no build date -- era there had to be proxied by street-type
morphology. This file is the real LPS property list and carries the attributes
directly:

  CVNonExempt          domestic capital value (the domestic valuation)
  PropertySize         floor area, m2
  Garage               0/1
  SubClass             ERA BAND x BUILT FORM, e.g. "Pre 1919 Detached",
                       "1966-1990 Semi-Detached", "Post 1990 Terrace",
                       "Purpose Built Apartment"
  PrimaryClass         Privately Built Housing vs Public Built Housing, plus the
                       non-domestic rating classes
  TotalNonExemptNAV    non-domestic net annual value
  HereditamentType     Domestic / Non Domestic / Mixed
  NonDomesticDescription  free text -- used for institutional classification

Input : lps_all_properties_clean.geojson (933,609 records, repo root)
Output: lps/lps_full_dz.csv, lps/lps_full_dea.csv, lps/lps_full_properties.parquet

LOCAL ONLY -- lps/ is gitignored.
"""
import os, time
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'lps')
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
os.makedirs(OUT, exist_ok=True)
def _find_src():
    """The LPS extract is a large gitignored local file. When running from a
    worktree it lives in the MAIN checkout root, not the worktree root."""
    if os.environ.get('LPS_FULL'):
        return os.environ['LPS_FULL']
    cands = [os.path.join(REPO, 'lps_all_properties_clean.geojson')]
    # .../<main>/.claude/worktrees/<name>  ->  <main>
    parts = REPO.replace('\\', '/').split('/')
    if '.claude' in parts:
        main = '/'.join(parts[:parts.index('.claude')])
        cands.append(os.path.join(main, 'lps_all_properties_clean.geojson'))
    for c in cands:
        if os.path.exists(c):
            return c
    raise SystemExit("lps_all_properties_clean.geojson not found in: " + ", ".join(cands))


SRC = _find_src()
DZFGB = os.environ.get('DZ2021_FGB', os.path.join(OUT, 'DZ2021.fgb'))


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


# SubClass encodes era band and built form together. Bands verified against the
# data, not assumed: PRE 1919 / PRE-1919 (both hyphenations occur), 1919-1945,
# 1946-1965, 1966-1990, POST 1990.
# Verified across all 933,609 records: the only dated ranges present are 1966-1990
# (207,030) and 1946-1965 (123,290). There is no 1919-1945 band in this list.
ERAS = {'era_pre1919': r'PRE[\s-]*1919',
        'era_1946_1965': r'1946\s*-\s*1965',
        'era_1966_1990': r'1966\s*-\s*1990',
        'era_post1990': r'POST[\s-]*1990'}
FORMS = {'form_detached': r'(?<!SEMI[- ])\bDETACHED',
         'form_semi': r'SEMI[- ]?DETACHED',
         'form_terrace': r'TERRACE',
         'form_apartment': r'APARTMENT|FLAT'}

# NOTE: institutional (denomination / GAA / Orange) classification is NOT done in
# this script. This extract has no organisation- or building-NAME field -- only
# NonDomesticDescription, which holds generic rating text ("workshop", "store",
# "office (1st floor)"), never "St Patrick's Church". Matching against FullAddress
# instead reintroduces the phase-10 bug where "ST" matches the Street abbreviation.
# Institutions are classified in 15_ from non_domestic_properties.geojson, which
# does carry ORGANISATION_NAME / BUILDING_NAME / Description.


def main():
    log(f"reading {SRC}")
    g = gpd.read_file(SRC)
    log(f"  {len(g):,} properties, crs={g.crs}")

    dz = gpd.read_file(DZFGB)[['DZ2021_cd', 'DEA2014_nm', 'LGD2014_nm',
                               'Area_ha', 'geometry']]
    if g.crs != dz.crs:
        g = g.to_crs(dz.crs)
    log("spatial join -> Data Zone")
    j = gpd.sjoin(g, dz.drop(columns=['Area_ha']), how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    miss = j.DZ2021_cd.isna().sum()
    log(f"  matched {len(j) - miss:,}/{len(j):,} ({miss:,} unmatched)")
    if miss:
        un = j[j.DZ2021_cd.isna()]
        snap = gpd.sjoin_nearest(g.loc[un.index].to_crs(29902),
                                 dz.drop(columns=['Area_ha']).to_crs(29902), how='left')
        snap = snap[~snap.index.duplicated(keep='first')]
        for c in ['DZ2021_cd', 'DEA2014_nm', 'LGD2014_nm']:
            j.loc[un.index, c] = snap[c]
        log(f"  after nearest-snap: {j.DZ2021_cd.isna().sum():,} unmatched")

    # ---------------- per-property derivation ----------------
    log("deriving property features")
    sub = j.SubClass.fillna('').astype(str).str.upper()
    prim = j.PrimaryClass.fillna('').astype(str).str.upper()
    for name, pat in ERAS.items():
        j[name] = sub.str.contains(pat, regex=True, na=False)
    for name, pat in FORMS.items():
        j[name] = sub.str.contains(pat, regex=True, na=False)
    j['era_known'] = j[list(ERAS)].any(axis=1)

    j['is_domestic'] = j.HereditamentType.astype(str).str.strip().str.lower() == 'domestic'
    j['public_built'] = prim.str.contains('PUBLIC BUILT HOUSING', na=False)
    j['private_built'] = prim.str.contains('PRIVATELY BUILT HOUSING', na=False)
    j['cv'] = pd.to_numeric(j.CVNonExempt, errors='coerce')
    j.loc[j.cv <= 0, 'cv'] = np.nan
    j['size_m2'] = pd.to_numeric(j.PropertySize, errors='coerce')
    j.loc[j.size_m2 <= 0, 'size_m2'] = np.nan
    j['garage'] = pd.to_numeric(j.Garage, errors='coerce').fillna(0)
    j['nav'] = pd.to_numeric(j.TotalNonExemptNAV, errors='coerce').fillna(0)

    log("\ncoverage:")
    log(f"  domestic properties        {int(j.is_domestic.sum()):,}")
    log(f"  with capital value         {int(j.cv.notna().sum()):,}")
    log(f"  with a known era band      {int(j.era_known.sum()):,}")
    log(f"  public built housing       {int(j.public_built.sum()):,}")
    log("\nera distribution (of those with a band):")
    for e in ERAS:
        log(f"  {e:16} {100 * j.loc[j.era_known, e].mean():5.1f}%")

    cols = ['PropertyId', 'UPRN', 'Postcode', 'FullAddress', 'Townland', 'Ward',
            'XCoordinate', 'YCoordinate', 'DZ2021_cd', 'DEA2014_nm', 'LGD2014_nm',
            'cv', 'size_m2', 'garage', 'nav', 'is_domestic', 'public_built',
            'private_built', 'era_known'] \
        + list(ERAS) + list(FORMS)
    pd.DataFrame(j[cols]).to_parquet(os.path.join(OUT, 'lps_full_properties.parquet'),
                                     index=False)
    log(f"\nwrote lps_full_properties.parquet ({len(j):,} rows)")

    # ---------------- area aggregation ----------------
    def agg(key, area_ha=None):
        d = j[j.DZ2021_cd.notna()] if key == 'DZ2021_cd' else j
        gb = d.groupby(key)
        dom = d[d.is_domestic]
        gd = dom.groupby(key)
        o = pd.DataFrame({'lpsf_n': gb.size()})
        # era + form shares, over domestic properties with a known band
        known = dom[dom.era_known]
        gk = known.groupby(key)
        for e in ERAS:
            o['lpsf_' + e] = gk[e].mean()
        for f in FORMS:
            o['lpsf_' + f] = gd[f].mean()
        o['lpsf_public_built'] = gd.public_built.mean()
        # capital value: level and dispersion
        o['lpsf_cv_median'] = gd.cv.median()
        o['lpsf_cv_log'] = np.log1p(gd.cv.median())
        o['lpsf_cv_p90_p10'] = gd.cv.quantile(.9) / gd.cv.quantile(.1).replace(0, np.nan)
        o['lpsf_cv_cv'] = gd.cv.std() / gd.cv.mean()
        o['lpsf_size_median'] = gd.size_m2.median()
        o['lpsf_garage'] = gd.garage.mean()
        o['lpsf_cv_per_m2'] = o.lpsf_cv_median / o.lpsf_size_median
        # non-domestic value + institutional balance
        o['lpsf_nav_total_log'] = np.log1p(gb.nav.sum())
        if area_ha is not None:
            o['lpsf_density'] = o.lpsf_n / area_ha.reindex(o.index)
        o = o.replace([np.inf, -np.inf], np.nan)
        return o.fillna(o.median(numeric_only=True))

    area_ha = dz.set_index('DZ2021_cd').Area_ha
    for key, name, ah in [('DZ2021_cd', 'dz', area_ha), ('DEA2014_nm', 'dea', None)]:
        a = agg(key, ah)
        a.index.name = 'area'
        a.to_csv(os.path.join(OUT, f'lps_full_{name}.csv'))
        log(f"wrote lps_full_{name}.csv ({len(a)} areas x {a.shape[1]} features)")


if __name__ == '__main__':
    main()
