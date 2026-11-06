"""List the features of the boundary layers the grouped pre-1973 NI local elections draw on.

  python scripts/ni-local/build-layer-features.py [--cache render/source-cache/vector-intake]

Writes data/elections/ni-local/layer-features.json: for each boundary layer, every Northern
Ireland feature's label (the value of the layer's label property, exactly as the tiles carry it),
its county, and the district it lies in. The district comes from the layer itself where it has
one (the Ulster DED sets and the 1901/1911 districts), and otherwise from the complete 1930
administrative-areas edition by largest overlap, so a DED with no result can be told apart: in a
district that polled that year (hatched, result missing) or in one that did not (left plain).

The FlatGeobuf files are the converted layers' sources, cached locally (render/source-cache is not
in git). The output is committed, so scripts/build-ni-local-grouped.mjs runs from a clean checkout.
Needs geopandas.
"""
import argparse, json, os, re, sys, warnings
warnings.filterwarnings('ignore')
import geopandas as gpd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'elections', 'ni-local', 'layer-features.json')
NI_COUNTIES = {'ANTRIM', 'ARMAGH', 'DOWN', 'FERMANAGH', 'LONDONDERRY', 'TYRONE'}

# source file -> label property, how to read the county and the district.
LAYERS = {
    'ded-1921-05-03': {'label': 'ED_NAME', 'county': 'COUNTY', 'districtFrom': 'admin-areas-1930-04-01', 'keyProps': ['ED_NAME', 'COUNTY']},
    'ded-1930-04-01': {'label': 'ED_NAME', 'county': 'COUNTY', 'districtFrom': 'admin-areas-1930-04-01', 'keyProps': ['ED_NAME', 'COUNTY']},
    'eds-ulster-1911': {'label': 'name', 'county': 'county', 'district': 'district'},
    'eds-ulster-1912': {'label': 'ENGLISH', 'county': None, 'districtFrom': 'rural-urban-districts-1911'},
    'eds-ulster-1913': {'label': 'ENGLISH', 'county': None, 'districtFrom': 'rural-urban-districts-1911'},
    'eds-ulster-1914': {'label': 'ENGLISH', 'county': None, 'districtFrom': 'rural-urban-districts-1911'},
    'eds-ulster-1915': {'label': 'ENGLISH', 'county': None, 'districtFrom': 'rural-urban-districts-1911'},
    'eds-ulster-1916': {'label': 'ENGLISH', 'county': None, 'districtFrom': 'rural-urban-districts-1911'},
    'county-ed-1911': {'label': 'ED_NAME', 'county': 'COUNTY'},
    'county-ed-1924-06-20': {'label': 'CED', 'county': 'COUNTY'},
    'admin-areas-1930-04-01': {'label': 'AdministrativeArea', 'county': None},
    'admin-areas-1966-07-04': {'label': 'FullName', 'county': 'CountyName'},
    'rural-urban-districts-1901': {'label': 'name', 'county': 'county'},
    'rural-urban-districts-1911': {'label': 'name', 'county': 'county'},
    'counties-county-boroughs-1915': {'label': 'CountyName', 'county': 'CountyName'},
    'tia-towns-ni-1921-05-03': {'label': 'town', 'county': 'county', 'district': 'rural_district'},
    'tia-towns-ni-1925-04-01': {'label': 'town', 'county': 'county', 'district': 'rural_district'},
    'tia-towns-ni-1927-04-01': {'label': 'town', 'county': 'county', 'district': 'rural_district'},
    'tia-towns-ni-1934-08-01': {'label': 'town', 'county': 'county', 'district': 'rural_district'},
    'tia-towns-ni-1937-04-01': {'label': 'town', 'county': 'county', 'district': 'rural_district'},
    'tia-towns-ni-1959-05-29': {'label': 'town', 'county': 'county', 'district': 'rural_district'},
}


def county_of(value):
    text = str(value or '').upper()
    text = re.sub(r'^(ADMINISTRATIVE COUNTY OF|COUNTY BOROUGH OF|COUNTY OF|CO\.?)\s+', '', text).strip()
    for name in NI_COUNTIES:
        if text == name or text.startswith(name):
            return name.title()
    if 'BELFAST' in text:
        return 'Antrim'
    return None


def clean(value):
    if value is None:
        return ''
    text = str(value)
    return '' if text == 'nan' else text


def main():
    ap = argparse.ArgumentParser()
    # A worktree has no source cache of its own: point --cache at the main checkout's.
    ap.add_argument('--cache', default=os.path.join(ROOT, 'render', 'source-cache', 'vector-intake'))
    args = ap.parse_args()
    frames = {}

    def read(source):
        if source not in frames:
            path = os.path.join(args.cache, f'{source}.fgb')
            if not os.path.exists(path):
                sys.exit(f'missing {path}')
            frames[source] = gpd.read_file(path).to_crs(29902)
        return frames[source]

    out = {}
    for source, spec in LAYERS.items():
        df = read(source)
        district_col = spec.get('district')
        districts = None
        if spec.get('districtFrom'):
            ref = read(spec['districtFrom'])
            ref_label = LAYERS[spec['districtFrom']]['label']
            ref = ref[[ref_label, 'geometry']].rename(columns={ref_label: '_district'})
            ref = ref[ref['geometry'].notna()]
            inter = gpd.overlay(df[['geometry']].reset_index().rename(columns={'index': '_fid'}), ref, how='intersection', keep_geom_type=True)
            inter['_a'] = inter.geometry.area
            best = inter.sort_values('_a', ascending=False).drop_duplicates('_fid')
            districts = dict(zip(best['_fid'], best['_district']))
        features = []
        for idx, row in df.iterrows():
            label = clean(row.get(spec['label']))
            if not label:
                continue
            county = county_of(row.get(spec['county'])) if spec.get('county') else None
            district = clean(row.get(district_col)) if district_col else (clean(districts.get(idx)) if districts is not None else '')
            if county is None and district and districts is not None:
                pass
            if spec.get('county') and county is None:
                continue  # outside Northern Ireland
            item = {'label': label}
            if spec.get('keyProps'):
                item['key'] = '|'.join(clean(row.get(prop)) for prop in spec['keyProps'])
            if county:
                item['county'] = county
            if district:
                item['district'] = district
            if source.startswith('rural-urban-districts') or source.startswith('admin-areas-1966'):
                kind = clean(row.get('type') or row.get('Type'))
                if kind:
                    item['type'] = kind
            features.append(item)
        if spec.get('county') is None and districts is not None:
            # eds-ulster-1912..1916 carry no county: keep the features in a Northern Ireland district.
            ni_districts = set()
            ref = read(spec['districtFrom'])
            for _, r in ref.iterrows():
                if county_of(r.get('county')):
                    ni_districts.add(clean(r.get(LAYERS[spec['districtFrom']]['label'])))
            features = [f for f in features if f.get('district') in ni_districts]
        entry = {'labelProperty': spec['label'], 'features': sorted(features, key=lambda f: f['label'])}
        if spec.get('keyProps'):
            # Two features can share a label (CLIFTON is a Belfast ward and a Bangor DED): the map
            # tells them apart by these properties joined with '|'.
            entry['keyProps'] = spec['keyProps']
        out[source] = entry
        print(f'{source}: {len(features)} features')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump({'schemaVersion': 1, 'about': 'Northern Ireland features of the boundary layers the grouped pre-1973 local elections use. Written by scripts/ni-local/build-layer-features.py.', 'layers': out}, fh, ensure_ascii=False, indent=0)
        fh.write('\n')
    print(f'wrote {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
