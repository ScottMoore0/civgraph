#!/usr/bin/env python3
"""Join a prepared property sidecar into a layer's FGB, writing a NEW file (the input is never changed).

    python scripts/join-sidecar-properties.py <sidecar.json> <in.fgb> <out.fgb>

The sidecar (data/review-inputs/electorates-*/*.json) names `joinProperty` and gives
`features: {<value of joinProperty>: {<property>: <value>, ...}}`. Every sidecar key must match
exactly one feature, or nothing is written. Features with no sidecar entry get null. Geometry,
feature order and the existing properties are kept as they are.
"""
import json
import sys

import geopandas as gpd


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    sidecar_path, src, out = sys.argv[1:]
    if src == out:
        raise SystemExit('refusing to overwrite the input FGB')
    side = json.load(open(sidecar_path, encoding='utf-8'))
    key = side['joinProperty']
    props = list(side['properties'])
    gdf = gpd.read_file(src)
    if key not in gdf.columns:
        raise SystemExit(f'{src} has no property {key!r}')
    clash = [p for p in props if p in gdf.columns]
    if clash:
        raise SystemExit(f'{src} already has {clash}; nothing written')
    values = gdf[key].astype(str)
    for name in side['features']:
        hits = int((values == name).sum())
        if hits != 1:
            raise SystemExit(f'sidecar key {name!r} matches {hits} features; nothing written')
    for p in props:
        col = [side['features'].get(v, {}).get(p) for v in values]
        gdf[p] = gpd.pd.array([None if c is None else int(c) for c in col], dtype='Int64')
    import pyogrio
    layer_name = pyogrio.list_layers(src)[0][0]  # keep the source layer name
    gdf.to_file(out, driver='FlatGeobuf', layer=layer_name)
    filled = {p: int(gdf[p].notna().sum()) for p in props}
    print(f'wrote {out}: {len(gdf)} features; filled {filled}')


if __name__ == '__main__':
    main()
