#!/usr/bin/env python3
"""v9 phase 10 — ingest the full official LPS/Pointer address dataset and derive
per-property + per-area features for the unity model.

Input  : D:/eoni/properties.geojson  (831,159 NI address points; UPRN, Address1-5,
         POSTCODE, POLLING_ID, NUM_ELECTORS, Irish-Grid X/Y, WGS84 point geometry)
         DZ2021.fgb                  (3,780 Data Zones; carries DEA2014 + LGD2014
                                      + Area_ha, so no separate crosswalk is needed)

Output : lps/properties.parquet      (property level, one row per address)
         lps/lps_features_dz.csv     (3,780 Data Zones x LPS features)
         lps/lps_features_dea.csv    (80 DEAs, population-weighted from properties)

LOCAL ONLY. The source is EONI-derived and must never be published, so lps/ is
gitignored; only this script and the validation report are committed.

Feature families
  A. structural   — dwelling density, electors per property, vacancy, flat share,
                    rural/urban addressing form
  B. era proxy    — street-type morphology. NI addresses carry no year-built field,
                    but street TYPE is a strong build-era marker: Street/Terrace/Row
                    (pre-1920 urban), Avenue/Park/Drive/Crescent (interwar-1970s
                    estate), Close/Court/Mews/Manor/Heights (post-1980 private).
  C. ethnonational lexicon — Irish-derived toponym morphemes, saint/Catholic
                    institutional naming, British/loyal naming, plantation-era
                    English settlement forms, Irish-language orthography.
  D. morphology   — intra-DZ dispersion of address points (compact terrace vs
                    scattered rural), from the Irish-Grid coordinates.

Family C is a religion proxy by construction. It carries no independent
information inside the 2021 census frame -- its purpose is to supply a signal for
geographies and dates the census cannot serve (sub-DZ, inter-censal, pre-2001).
It is never validated against the census religion variable it mirrors; the only
test that counts is out-of-sample prediction of real election results (11_).
"""
import os, sys, time, re
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'lps')
os.makedirs(OUT, exist_ok=True)

PROPS = os.environ.get('LPS_PROPERTIES', 'D:/eoni/properties.geojson')
# DZ2021 boundaries carry DZ -> SDZ / DEA2014 / LGD2014 and Area_ha in one file.
# Fetch once with:
#   curl -sSL https://data.civgraph.net/data/maps/census-areas/DZ2021.fgb -o lps/DZ2021.fgb
DZFGB = os.environ.get('DZ2021_FGB', os.path.join(OUT, 'DZ2021.fgb'))


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


# ---------------------------------------------------------------- lexicons ---
# B. street-type era bands. Ordered most-specific first; a street matches one band.
ERA_BANDS = {
    'era_victorian': r'\b(?:STREET|TERRACE|ROW|PLACE|COURTYARD|ENTRY|VENNEL)\b',
    'era_interwar':  r'\b(?:AVENUE|PARADE|CRESCENT|GARDENS|GROVE|DRIVE|PARK)\b',
    'era_modern':    r'\b(?:CLOSE|COURT|MEWS|MANOR|HEIGHTS|RISE|CHASE|DALE|VIEW|WAY|LINKS|MEADOWS?|GLEBE)\b',
    'era_rural':     r'\b(?:ROAD|LANE|BRAE|HILL|LOANING|PAD|TRACK)\b',
}

# C1. Irish-derived toponym morphemes, anchored at WORD START. Anchoring is not
# cosmetic: unanchored, ARD matched inside "GARDENS" (34,706 addresses, 100% false
# positive) and ALT inside "WALTON". These are the productive initial elements of
# anglicised NI townland names.
# Settlement names (OMAGH, LURGAN, GARVAGH, KESH, TRILLICK, DOAGH, CLOGHER, CLADY,
# DERG, CAVAN, BOHO) are excluded for the same reason as in C3: a road named after
# a town labels both communities in that town alike. DERRY carries a negative
# lookbehind so it does not fire inside LONDONDERRY.
IRISH_MORPH = (r'\b(?:BALLY|BALLI|(?<!LONDON)DERRY|KNOCK|LISN?|DRUM|CARRIC?K|KILL?Y?|'
               r'ARD|AGHA|CLON|DUN|GLEN|GORT|INIS|MAGHER|MULLAGH|RATH|SLIEVE|TULLY|'
               r'TOBER|COOLE?|CORR|MONEY|MOY|TAMNA|TATE|CREG|ANNA|ALT|CAPPAGH|'
               r'CREEV|EDEN|ESKER|FINN|MEEN|SHAN|TAMLAGHT|TIR|AUGHNA)')

# C2. saint / Catholic institutional naming.
# ABBEY is deliberately EXCLUDED: it was 72% of all matches and is a generic NI
# estate element (Newtownabbey, Abbey Park), not a Catholic marker. A bare \bST\b
# is also excluded -- it matched "St" as the abbreviation for STREET. ST is only
# accepted when an actual saint's name follows.
SAINT = (r'(?:\bST\.?\s+(?:PATRICK|MARY|MARYS|BRIGID|BRIDGET|COLUMB|MALACHY|JOSEPH|'
         r'JAMES|JOHN|PAUL|PETER|OLIVER|COMGALL|CANICE|EUGENE|TERESA|ANNE?S?)|'
         r'\bSAINT\b|CHAPEL|FRIAR|ROSARY|LOURDES|CONVENT|PRESBYTERY|GAA|'
         r'ARDOYNE|CLONARD|FALLS|GLENGORMLEY)')

# C3. British / loyal / royal naming.
# SETTLEMENT NAMES ARE EXCLUDED. LONDONDERRY was 60% of matches here and CRAIGAVON
# a further chunk; both are town names that label every address in a mixed or
# majority-Catholic settlement identically, which inverted the sign of this feature
# against Catholic share. Only naming that varies WITHIN a settlement can carry
# community signal.
LOYAL = (r'(?:WINDSOR|BALMORAL|SANDRINGHAM|VICTORIA|ALBERT|\bQUEENS?\b|'
         r'\bKINGS?\b|PRINCE|ROYAL|CROWN|CORONATION|JUBILEE|EMPIRE|SOMME|'
         r'CARSON|ORANGE|\bLOYAL|CONNAUGHT|CLARENCE|CUMBERLAND|CHURCHILL|'
         r'WELLINGTON|MARLBOROUGH|TRAFALGAR|WATERLOO|SHANKILL|SANDY ROW|'
         r'CREGAGH|BALLYNAFEIGH|ORANGEFIELD)')

# C4. plantation-era English settlement forms (name endings, not whole words)
PLANTER = r'\w+(?:TON|FIELD|FORD|WOOD|BOROUGH|VILLE|MOUNT|HALL|STOWN|BRIDGE)\b'

# C5. Irish-language orthography (Irish-form street signage in the address itself)
IRISH_LANG = r'(?:BOTHAR|CNOC|DOIRE|SLIABH|GAELTACHT|CUMANN|\bAN T|\bNA \w+A\b|[ÁÉÍÓÚ])'

# A. dwelling form
FLAT = r'(?:APARTMENT|\bAPT\b|\bFLAT\b|\bUNIT\b)'
RURAL_FORM = r'(?:\bHOUSE\b|COTTAGE|LODGE|FARM|BUNGALOW)'


def read_properties():
    log(f"reading {PROPS}")
    gdf = gpd.read_file(PROPS)
    log(f"  {len(gdf):,} address points, crs={gdf.crs}")
    return gdf


def read_zones():
    log(f"reading {DZFGB}")
    dz = gpd.read_file(DZFGB)
    keep = ['DZ2021_cd', 'DZ2021_nm', 'SDZ2021_cd', 'DEA2014_cd', 'DEA2014_nm',
            'LGD2014_cd', 'LGD2014_nm', 'Area_ha', 'geometry']
    dz = dz[keep]
    log(f"  {len(dz):,} Data Zones, crs={dz.crs}")
    return dz


def spatial_join(props, dz):
    log("spatial join properties -> Data Zone")
    if props.crs != dz.crs:
        props = props.to_crs(dz.crs)
    j = gpd.sjoin(props, dz.drop(columns=['Area_ha']), how='left', predicate='within')
    miss = j.DZ2021_cd.isna().sum()
    log(f"  matched {len(j) - miss:,}/{len(j):,}  ({miss:,} outside every DZ)")
    if miss:
        # Points on a boundary/coastline can fall outside every polygon. Snap them
        # to the nearest DZ rather than dropping addresses.
        log("  snapping unmatched points to nearest DZ")
        un = j[j.DZ2021_cd.isna()]
        snap = gpd.sjoin_nearest(props.loc[un.index],
                                 dz.drop(columns=['Area_ha']), how='left')
        snap = snap[~snap.index.duplicated(keep='first')]
        for c in ['DZ2021_cd', 'DZ2021_nm', 'SDZ2021_cd', 'DEA2014_cd',
                  'DEA2014_nm', 'LGD2014_cd', 'LGD2014_nm']:
            j.loc[un.index, c] = snap[c]
        log(f"  still unmatched: {j.DZ2021_cd.isna().sum():,}")
    return j.drop(columns=[c for c in ['index_right'] if c in j.columns])


def _up(df, cols):
    s = df[cols[0]].fillna('').astype(str)
    for c in cols[1:]:
        s = s.str.cat(df[c].fillna('').astype(str), sep=' ')
    return s.str.upper().str.replace(r'\s+', ' ', regex=True).str.strip()


def address_string(df):
    """Single uppercased address string per property, for reference/reporting."""
    return _up(df, ['Address1', 'Address2', 'Address3', 'Address4', 'Address5'])


def address_local(df):
    """Street + townland only (Address1-2).

    The lexicons are applied to THIS, not the full address. Address3-5 hold town,
    city and county, which are constant across a whole settlement -- matching them
    labels every address in Londonderry, Newtownards or Ballymena identically and
    destroys the within-settlement contrast that carries the actual signal.
    """
    return _up(df, ['Address1', 'Address2'])


def derive_property_features(df):
    """Per-property binary/numeric features. Vectorised regex over 831k rows."""
    log("deriving per-property address features")
    df['addr_full'] = address_string(df)
    loc = address_local(df)
    df['addr_local'] = loc
    # A. structural
    df['is_flat'] = loc.str.contains(FLAT, regex=True, na=False)
    df['is_rural_form'] = loc.str.contains(RURAL_FORM, regex=True, na=False)
    df['has_number'] = df.Address1.fillna('').astype(str).str.match(r'^\s*\d')
    # NUM_ELECTORS is empty for every row in the current extract -- no elector or
    # vacancy feature can be derived from it. Kept in the parquet so a future
    # extract that populates it needs no schema change.
    df['n_electors'] = pd.to_numeric(df.NUM_ELECTORS, errors='coerce').fillna(0)
    # depth of the address hierarchy: rural addresses carry townland + locality
    df['addr_depth'] = sum((df[c].fillna('').astype(str).str.strip() != '').astype(int)
                           for c in ['Address2', 'Address3', 'Address4', 'Address5'])
    # B. era proxy — first matching band wins
    assigned = pd.Series(False, index=df.index)
    for name, pat in ERA_BANDS.items():
        hit = loc.str.contains(pat, regex=True, na=False) & ~assigned
        df[name] = hit
        assigned |= hit
    df['era_other'] = ~assigned
    # C. ethnonational lexicons — street/townland only (see address_local)
    df['lex_irish'] = loc.str.contains(IRISH_MORPH, regex=True, na=False)
    df['lex_saint'] = loc.str.contains(SAINT, regex=True, na=False)
    df['lex_loyal'] = loc.str.contains(LOYAL, regex=True, na=False)
    df['lex_planter'] = loc.str.contains(PLANTER, regex=True, na=False)
    df['lex_irishlang'] = loc.str.contains(IRISH_LANG, regex=True, na=False)
    df['pc_sector'] = df.POSTCODE.fillna('').astype(str).str.strip().str[:5]
    return df


BOOL_FEATS = ['is_flat', 'is_rural_form', 'has_number',
              'era_victorian', 'era_interwar', 'era_modern', 'era_rural', 'era_other',
              'lex_irish', 'lex_saint', 'lex_loyal', 'lex_planter', 'lex_irishlang']


def aggregate(df, key, area_ha=None):
    """Area-level LPS feature frame. Shares for binaries, plus density/dispersion."""
    log(f"aggregating to {key}")
    g = df.groupby(key)
    out = pd.DataFrame({'lps_n_properties': g.size()})
    for f in BOOL_FEATS:
        out['lps_' + f] = g[f].mean()
    out['lps_addr_depth'] = g.addr_depth.mean()
    out['lps_pc_sectors'] = g.pc_sector.nunique()
    # D. morphology — dispersion of address points in metres (Irish Grid)
    sd = g[['X_COR', 'Y_COR']].std().fillna(0.0)
    out['lps_spread_m'] = np.sqrt(sd.X_COR ** 2 + sd.Y_COR ** 2)
    out['lps_nn_density'] = out.lps_n_properties / out.lps_spread_m.replace(0, np.nan)
    out['lps_nn_density'] = out.lps_nn_density.fillna(out.lps_nn_density.median())
    if area_ha is not None:
        out['lps_props_per_ha'] = out.lps_n_properties / area_ha.reindex(out.index)
    out = out.replace([np.inf, -np.inf], np.nan)
    return out.fillna(out.median(numeric_only=True))


def main():
    if not os.path.exists(PROPS):
        sys.exit(f"LPS property file not found: {PROPS}")
    props = read_properties()
    dz = read_zones()
    j = spatial_join(props, dz)
    j = derive_property_features(j)

    # ---- property level (LOCAL ONLY) ----
    cols = (['UPRN', 'PROPID', 'POSTCODE', 'pc_sector', 'POLLING_ID', 'n_electors',
             'X_COR', 'Y_COR', 'addr_full', 'addr_local', 'addr_depth',
             'DZ2021_cd', 'DZ2021_nm', 'SDZ2021_cd', 'DEA2014_cd', 'DEA2014_nm',
             'LGD2014_cd', 'LGD2014_nm'] + BOOL_FEATS)
    plevel = pd.DataFrame(j[cols])
    pq = os.path.join(OUT, 'properties.parquet')
    plevel.to_parquet(pq, index=False)
    log(f"wrote {pq}  ({len(plevel):,} rows)")

    # ---- area level ----
    area_ha = dz.set_index('DZ2021_cd').Area_ha
    dzf = aggregate(j, 'DZ2021_cd', area_ha)
    dzf.index.name = 'area'
    dzf.to_csv(os.path.join(OUT, 'lps_features_dz.csv'))
    log(f"wrote lps_features_dz.csv  ({len(dzf)} zones x {dzf.shape[1]} features)")

    deaf = aggregate(j, 'DEA2014_nm')
    deaf.index.name = 'area'
    deaf.to_csv(os.path.join(OUT, 'lps_features_dea.csv'))
    log(f"wrote lps_features_dea.csv ({len(deaf)} DEAs x {deaf.shape[1]} features)")

    log("summary of DZ features:")
    print(dzf.describe().T[['mean', 'std', 'min', 'max']].to_string())


if __name__ == '__main__':
    main()
