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
# TWO-STAGE. Stage 1 defines the institutional UNIVERSE from the LPS rating
# taxonomy (reliable, complete, no text needed). Stage 2 assigns a community to
# members of that universe from the name text (incomplete by nature).
#
# The first version skipped stage 1 and inferred the universe from name text
# alone, which both under-counted (7,070 institutions exist by rating class) and
# mixed the two questions together.
UNIV_PRIMARY = r"(?:Churches|Non Sporting Rec|Schools etc|Sporting Recreational)"
UNIV_SUB = r"(?:Place of Worship|^Hall$|^School$|Relig\. Estab|Sports Ground)"

# Denominational markers. Expanded after auditing actual names in the file:
# "(C OF I)" alone appears 209 times and the first version matched none of it.
CATHOLIC = (r"(?:\bR\.?C\.?\b|ROMAN CATHOLIC|\bST\.?\s+[A-Z]|SAINT\s+[A-Z]|"
            r"CHAPEL|PAROCHIAL|PRESBYTERY|CONVENT|FRIARY|MONASTER|ORATORY|"
            r"OUR LADY|SACRED HEART|MERCY|CHRISTIAN BROTHERS|MARIST|LOURDES|"
            r"MAYNOOTH|DIOCESAN|\bHOLY (?:FAMILY|CROSS|REDEEMER)|IMMACULATE|"
            r"\bCBS\b|LORETO|\bSTS?\b\s+[A-Z]|NAOMH)")
PROTESTANT = (r"(?:PRESBYTERIAN|METHODIST|CHURCH OF IRELAND|\bC\.? ?OF ?I\b|\bCOI\b|"
              r"BAPTIST|FREE PRESBYTERIAN|CONGREGATIONAL|ELIM|BRETHREN|GOSPEL HALL|"
              r"MISSION HALL|REFORMED|MORAVIAN|PENTECOSTAL|SALVATION ARMY|"
              r"ORANGE|LOYAL ORDER|APPRENTICE BOYS|\bLOL\b|ROYAL BLACK|"
              r"PARISH CHURCH|\bEPISCOPAL|UNITARIAN|NON.?SUBSCRIBING)")
GAA = (r"(?:\bGAA\b|GAELIC ATHLETIC|\bCLG\b|\bGAC\b|\bGFC\b|CAMOGIE|HURLING|"
       r"NAOMH|EIRE OG|\bCUMANN|SARSFIELD|WOLFE TONE|\bEMMET|\bPEARSE|"
       r"O.?DONOVAN ROSSA|SHAMROCKS?\b|\bGAELS?\b)")
ORANGE_HALL = r"(?:ORANGE HALL|\bLOL\b|LOYAL ORANGE|APPRENTICE BOYS|BLACK INSTITUTION)"
IRISH_CULT = r"(?:GAELSCOIL|IRISH LANGUAGE|CULTURLANN|CONRADH|\bCLG\b)"
BAND_HALL = r"(?:FLUTE BAND|ACCORDION BAND|PIPE BAND|BAND HALL|SILVER BAND)"

# Where BOTH communities are symmetrically detectable. Places of worship and
# order/community halls qualify: each side names itself. SCHOOLS DO NOT -- Catholic
# maintained schools carry "St"/"Our Lady" markers while controlled (de facto
# Protestant) schools carry none, so counting schools into a signed balance would
# manufacture a Catholic tilt wherever schools exist. Schools are therefore kept
# as a separate, explicitly asymmetric feature and excluded from the balance.
SYMMETRIC_SUB = r"(?:Place of Worship|^Hall$|Relig\. Estab|Sports Ground)"


def _clean(s):
    """Uppercase, and treat the literal placeholder 'NULL' as empty -- the extract
    writes 'NULL' as a string, which fillna() does not catch."""
    s = s.fillna('').astype(str).str.upper().str.strip()
    return s.str.replace(r'\bNULL\b', '', regex=True)


def classify(gdf):
    # Names + rating description ONLY. PRIMARY_THORFARE stays excluded: a street
    # name locates a property, it does not identify the institution, and including
    # it reintroduces the phase-10 "ST" false-positive problem.
    txt = (_clean(gdf.ORGANISATION_NAME) + ' ' + _clean(gdf.BUILDING_NAME) + ' '
           + _clean(gdf.AOBuildingName) + ' ' + _clean(gdf.SUB_BUILDING_NAME) + ' '
           + _clean(gdf.Description))
    txt = txt.str.replace(r'\s+', ' ', regex=True).str.strip()
    gdf['txt'] = txt
    prim = gdf.PrimaryClass.fillna('').astype(str)
    sub = gdf.SubClass.fillna('').astype(str)

    # stage 1 — universe from the rating taxonomy
    gdf['nd_institutional'] = (prim.str.contains(UNIV_PRIMARY, regex=True, na=False)
                               | sub.str.contains(UNIV_SUB, regex=True, na=False))
    gdf['nd_worship'] = sub.str.contains(r'Place of Worship|Relig\. Estab',
                                         regex=True, na=False)
    gdf['nd_school'] = sub.str.contains(r'^School$', regex=True, na=False)
    gdf['nd_symmetric'] = (gdf.nd_institutional
                           & sub.str.contains(SYMMETRIC_SUB, regex=True, na=False))

    # stage 2 — community assignment within the universe
    inst = gdf.nd_institutional
    gdf['nd_catholic'] = inst & txt.str.contains(CATHOLIC, regex=True, na=False)
    gdf['nd_protestant'] = inst & txt.str.contains(PROTESTANT, regex=True, na=False)
    gdf['nd_gaa'] = inst & txt.str.contains(GAA, regex=True, na=False)
    gdf['nd_orange'] = inst & txt.str.contains(ORANGE_HALL, regex=True, na=False)
    gdf['nd_irishcult'] = inst & txt.str.contains(IRISH_CULT, regex=True, na=False)
    gdf['nd_band'] = inst & txt.str.contains(BAND_HALL, regex=True, na=False)
    both = gdf.nd_catholic & gdf.nd_protestant
    gdf.loc[both, ['nd_catholic', 'nd_protestant']] = False
    # asymmetric, kept out of the balance
    gdf['nd_cath_school'] = gdf.nd_school & gdf.nd_catholic
    # symmetric-only community flags -- these alone feed the signed balance
    gdf['nd_cath_sym'] = gdf.nd_symmetric & (gdf.nd_catholic | gdf.nd_gaa
                                             | gdf.nd_irishcult)
    gdf['nd_prot_sym'] = gdf.nd_symmetric & (gdf.nd_protestant | gdf.nd_orange
                                             | gdf.nd_band)
    gdf['nav'] = pd.to_numeric(gdf.TotalNAV, errors='coerce').fillna(0)
    return gdf


FLAGS = ['nd_catholic', 'nd_protestant', 'nd_gaa', 'nd_orange', 'nd_irishcult',
         'nd_band', 'nd_institutional', 'nd_worship', 'nd_school', 'nd_cath_school']


def aggregate(gdf, key):
    g = gdf.groupby(key)
    out = pd.DataFrame({'nd_n': g.size()})
    for f in FLAGS:
        out['nd_n_' + f.replace('nd_', '')] = g[f].sum()
    out['nd_nav_total'] = g.nav.sum()
    out['nd_nav_mean'] = g.nav.mean()
    out['nd_nav_median'] = g.nav.median()
    # The signed institutional balance -- the feature with no census counterpart.
    # Built from SYMMETRIC categories only (worship, order/community halls, sports
    # grounds), never schools: see SYMMETRIC_SUB.
    cath = g.nd_cath_sym.sum()
    prot = g.nd_prot_sym.sum()
    out['nd_n_cath_sym'] = cath
    out['nd_n_prot_sym'] = prot
    out['nd_inst_n'] = cath + prot
    out['nd_inst_balance'] = (cath - prot) / (cath + prot).replace(0, np.nan)
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
