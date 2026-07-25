#!/usr/bin/env python3
"""v9 phase 13 — LPS Non-Domestic Property Data: download, classify, join to DZ.

This is the LPS property dataset that actually carries a valuation (TotalNAV) and
a use classification, and unlike the address gazetteer of phase 10 it is not a
reprojection of census tenure/NS-SEC. It locates INSTITUTIONS -- churches, GAA
grounds, Orange halls, schools, clubs -- which is ethnonational geography with no
census counterpart.

Source: LPS NonDomesticPropertyData FeatureServer (55,902 records, public).
Cached to lps/nondomestic.geojson so re-runs do not re-hit the service.

Outputs (LOCAL ONLY, lps/ is gitignored):
    lps/nondomestic.geojson       raw cache
    lps/nd_features_dz.csv        3,780 Data Zones x institutional features
    lps/nd_features_dea.csv       80 DEAs
"""
import os, json, time, sys
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'lps')
os.makedirs(OUT, exist_ok=True)
CACHE = os.path.join(OUT, 'nondomestic.geojson')
DZFGB = os.environ.get('DZ2021_FGB', os.path.join(OUT, 'DZ2021.fgb'))

URL = ("https://services3.arcgis.com/HRuPlEcokYlz4mdz/ArcGIS/rest/services/"
       "NonDomesticPropertyData/FeatureServer/0/query")
FIELDS = ("AOPropertyId,ORGANISATION_NAME,BUILDING_NAME,PRIMARY_THORFARE,TOWNLAND,"
          "TOWN,COUNTY,POSTCODE,CLASSIFICATION,PrimaryClass,SubClass,Type,"
          "Description,TotalNAV,Exempt,X_COR,Y_COR")


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def _local():
    """Prefer an already-downloaded local extract over re-hitting the service."""
    parts = os.path.abspath(os.path.join(HERE, "..", "..", "..")).replace(os.sep, '/').split('/')
    roots = ['/'.join(parts)]
    if '.claude' in parts:
        roots.append('/'.join(parts[:parts.index('.claude')]))
    for r in roots:
        c = os.path.join(r, 'non_domestic_properties.geojson')
        if os.path.exists(c):
            return c
    return None


def download():
    """Page through the FeatureServer into one GeoJSON cache."""
    import subprocess
    if os.path.exists(CACHE):
        log(f"using cached {CACHE}")
        return
    feats, offset, page = [], 0, 0
    while True:
        q = (f"{URL}?where=1%3D1&outFields={FIELDS}&returnGeometry=true&f=geojson"
             f"&resultRecordCount=2000&resultOffset={offset}&orderByFields=OBJECTID")
        raw = subprocess.run(["curl", "-fsSL", "--max-time", "120", q],
                             capture_output=True).stdout
        try:
            d = json.loads(raw.decode('utf-8'))
        except Exception as e:
            sys.exit(f"bad response at offset {offset}: {e}\n{raw[:400]}")
        # ArcGIS returns HTTP 200 with an {"error":...} body for a bad field name.
        # Fail loudly instead of caching an empty collection.
        if 'error' in d:
            sys.exit(f"service error at offset {offset}: {d['error']}")
        got = d.get('features', [])
        if not got and not feats:
            sys.exit(f"service returned no features at all: {str(d)[:400]}")
        feats.extend(got)
        page += 1
        log(f"  page {page}: +{len(got)} -> {len(feats):,}")
        if len(got) < 2000:
            break
        offset += 2000
        time.sleep(0.3)
    json.dump({"type": "FeatureCollection", "features": feats}, open(CACHE, 'w'))
    log(f"wrote {CACHE} ({len(feats):,} records)")


# --------------------------------------------------------------- classifier ---
# Community-marked institutions. Matched on the free-text fields (organisation /
# building name / description), because the LPS SubClass taxonomy is about RATING
# category (Church, Hall, Recreation) and does not record denomination or code.
CATHOLIC = (r"(?:\bR\.?C\.?\b|ROMAN CATHOLIC|\bST\.?\s+[A-Z]|SAINT\s+[A-Z]|"
            r"CHAPEL|PAROCHIAL|PRESBYTERY|CONVENT|FRIARY|MONASTER|ORATORY|"
            r"OUR LADY|SACRED HEART|MERCY|CHRISTIAN BROTHERS|MARIST|LOURDES|"
            r"MAYNOOTH|DIOCESAN|PARISH PRIORITY)")
PROTESTANT = (r"(?:PRESBYTERIAN|METHODIST|CHURCH OF IRELAND|BAPTIST|"
              r"FREE PRESBYTERIAN|CONGREGATIONAL|ELIM|BRETHREN|GOSPEL HALL|"
              r"MISSION HALL|REFORMED|MORAVIAN|PENTECOSTAL|SALVATION ARMY|"
              r"ORANGE|LOYAL ORDER|APPRENTICE BOYS|\bLOL\b|ROYAL BLACK)")
GAA = r"(?:\bGAA\b|GAELIC ATHLETIC|\bCLG\b|CUMANN|CAMOGIE|HURLING|\bGFC\b|\bG\.?A\.?C\b)"
ORANGE_HALL = r"(?:ORANGE HALL|\bLOL\b|LOYAL ORANGE|APPRENTICE BOYS|BLACK INSTITUTION)"
IRISH_CULT = r"(?:GAELSCOIL|IRISH LANGUAGE|CULTURLANN|AN CHULTURLANN|CONRADH|\bCLG\b)"
BAND_HALL = r"(?:FLUTE BAND|ACCORDION BAND|PIPE BAND|BAND HALL|SILVER BAND)"

# rating classes that are plausibly community-marked at all
INSTITUTIONAL = r"(?:CHURCH|HALL|RECREATION|SPORT|CLUB|SCHOOL|COMMUNITY)"


def classify(gdf):
    # Names and rating description ONLY. PRIMARY_THORFARE is deliberately excluded:
    # a street name locates a property, it does not identify the institution, and
    # including it reintroduces the phase-10 "ST" false-positive problem.
    txt = (gdf.ORGANISATION_NAME.fillna('') + ' ' + gdf.BUILDING_NAME.fillna('') + ' '
           + gdf.AOBuildingName.fillna('') + ' ' + gdf.Description.fillna(''))
    txt = txt.str.upper().str.replace(r'\s+', ' ', regex=True)
    gdf['txt'] = txt
    gdf['nd_catholic'] = txt.str.contains(CATHOLIC, regex=True, na=False)
    gdf['nd_protestant'] = txt.str.contains(PROTESTANT, regex=True, na=False)
    gdf['nd_gaa'] = txt.str.contains(GAA, regex=True, na=False)
    gdf['nd_orange'] = txt.str.contains(ORANGE_HALL, regex=True, na=False)
    gdf['nd_irishcult'] = txt.str.contains(IRISH_CULT, regex=True, na=False)
    gdf['nd_band'] = txt.str.contains(BAND_HALL, regex=True, na=False)
    gdf['nd_institutional'] = txt.str.contains(INSTITUTIONAL, regex=True, na=False)
    # a property counted for both sides is ambiguous -- drop it from both
    both = gdf.nd_catholic & gdf.nd_protestant
    gdf.loc[both, ['nd_catholic', 'nd_protestant']] = False
    gdf['nav'] = pd.to_numeric(gdf.TotalNAV, errors='coerce').fillna(0)
    return gdf


FLAGS = ['nd_catholic', 'nd_protestant', 'nd_gaa', 'nd_orange', 'nd_irishcult',
         'nd_band', 'nd_institutional']


def aggregate(gdf, key):
    g = gdf.groupby(key)
    out = pd.DataFrame({'nd_n': g.size()})
    for f in FLAGS:
        out['nd_n_' + f.replace('nd_', '')] = g[f].sum()
    out['nd_nav_total'] = g.nav.sum()
    out['nd_nav_mean'] = g.nav.mean()
    out['nd_nav_median'] = g.nav.median()
    # the signed institutional balance: the feature with no census counterpart
    cath = out['nd_n_catholic'] + out['nd_n_gaa'] + out['nd_n_irishcult']
    prot = out['nd_n_protestant'] + out['nd_n_orange'] + out['nd_n_band']
    out['nd_inst_balance'] = (cath - prot) / (cath + prot).replace(0, np.nan)
    out['nd_inst_n'] = cath + prot
    return out


def main():
    src = _local()
    if src:
        log(f"using local extract {src}")
    else:
        download()
        src = CACHE
    gdf = gpd.read_file(src)
    log(f"  {len(gdf):,} non-domestic properties, crs={gdf.crs}")
    gdf = classify(gdf)

    log("\nclassification counts:")
    for f in FLAGS:
        log(f"  {f:20} {int(gdf[f].sum()):6,}")

    dz = gpd.read_file(DZFGB)[['DZ2021_cd', 'DEA2014_nm', 'geometry']]
    # The downloaded extract declares EPSG:29902 (Irish Grid) but its coordinates
    # are WGS84 lon/lat -- ArcGIS wrote the service's native SR into the GeoJSON
    # crs member while emitting degrees, as the GeoJSON spec requires. Reprojecting
    # from the declared CRS puts every point in the Atlantic and matches 0 zones.
    # Detect it by bounds and override the label instead of transforming.
    bx = gdf.total_bounds
    looks_lonlat = (-180 <= bx[0] <= 180 and -90 <= bx[1] <= 90 and
                    -180 <= bx[2] <= 180 and -90 <= bx[3] <= 90)
    if looks_lonlat and (gdf.crs is None or gdf.crs.is_projected):
        log(f"  CRS mismatch: declared {gdf.crs}, coords are lon/lat -> overriding to EPSG:4326")
        gdf = gdf.set_crs(4326, allow_override=True)
    if gdf.crs != dz.crs:
        gdf = gdf.to_crs(dz.crs)
    j = gpd.sjoin(gdf, dz, how='left', predicate='within')
    miss = j.DZ2021_cd.isna().sum()
    log(f"\njoined to DZ: {len(j) - miss:,}/{len(j):,} ({miss:,} unmatched)")
    if miss:
        un = j[j.DZ2021_cd.isna()]
        snap = gpd.sjoin_nearest(gdf.loc[un.index], dz, how='left')
        snap = snap[~snap.index.duplicated(keep='first')]
        for c in ['DZ2021_cd', 'DEA2014_nm']:
            j.loc[un.index, c] = snap[c]
        log(f"  after snap: {j.DZ2021_cd.isna().sum():,} unmatched")

    j.drop(columns=['geometry']).to_parquet(os.path.join(OUT, 'nondomestic.parquet'),
                                            index=False)
    for key, name in [('DZ2021_cd', 'dz'), ('DEA2014_nm', 'dea')]:
        a = aggregate(j, key)
        a.index.name = 'area'
        a.to_csv(os.path.join(OUT, f'nd_features_{name}.csv'))
        log(f"wrote nd_features_{name}.csv ({len(a)} areas x {a.shape[1]} features)")


if __name__ == '__main__':
    main()
