# Civgraph agent guide

This guide is for AI agents and scripts. It explains how to use Civgraph's data
**without** driving the website UI, and gives a tested recipe for the common
task: *determining which features on one map correspond to features on another.*

## Why not scrape the site

`https://civgraph.net` is a MapLibre GL app — map features are rendered in
**WebGL** (on the GPU), not as DOM elements. Scraping the page or clicking the
map will not let you enumerate features. Use the data files below instead; they
are static, unauthenticated HTTPS, and machine-readable.

## Data model

- **Catalogue:** [`/agent/maps-index.json`](https://civgraph.net/agent/maps-index.json)
  — one entry per map layer: `id`, `name`, `category`, `categoryGroup`,
  `provider`, `date`, `labelProperty` (the feature-name field), `bounds`, and
  `geometry` (a link to the geometry file). Prefer this over the full
  [`/data/database/maps.json`](https://civgraph.net/data/database/maps.json).
- **Geometry:** FlatGeobuf (`.fgb`), CRS **EPSG:4326**, on `data.civgraph.net`.
  Readable by GeoPandas/pyogrio, GDAL/OGR, and the flatgeobuf JS/Python libs.
  `.fgb` supports HTTP range requests, so large layers can be read
  bbox-filtered.
- `labelProperty` tells you which attribute holds the human-readable feature
  name (e.g. `LGDNAME`, `FinalR_DEA`, `ENGLISH`). Field names vary by layer —
  inspect the file's schema if unsure.

## Finding the two maps

Fetch `maps-index.json`, then match on `name` / `category` / `provider`. Example
targets and their `geometry.url`:

- "District Electoral Areas 2012" → `id: deas-2012`
- "Local Government Districts 2012" → `id: lgd-2012`

Read each entry's `geometry.url`. If `geometry` is `null`, that layer is served
as chunked FlatGeobuf (very large); 686 of ~1,014 layers have a single
fetchable `.fgb`, which covers the usual correspondence tasks.

## Recipe: feature correspondence (spatial join)

Pick the predicate from the relationship between the layers:

- **Nested hierarchy** (townland ⊂ DEA ⊂ LGD ⊂ county): join each finer feature
  to the coarser feature that **contains** its interior point (`within`).
- **Same level, different vintage** (e.g. 1993 vs 2012 boundaries): join by
  **area overlap** and keep the largest-overlap match.
- **Points vs areas** (e.g. a gazetteer of place-name points vs boundaries):
  `within` (point in polygon).

### Nested example — which LGD contains each DEA (tested, exact)

```python
import geopandas as gpd

# geometry.url values from https://civgraph.net/agent/maps-index.json
A = "https://data.civgraph.net/data/maps/local-government/DEAs_2012.fgb"  # 80 DEAs (finer)
B = "https://data.civgraph.net/data/maps/local-government/LGD_2012.fgb"   # 11 LGDs (coarser)

gdf_a = gpd.read_file(A).to_crs(4326)
gdf_b = gpd.read_file(B).to_crs(4326)

# join each A feature to the B feature that contains its interior point
reps = gdf_a.copy()
reps["geometry"] = gdf_a.representative_point()   # robust to boundary ambiguity
joined = gpd.sjoin(reps, gdf_b, how="left", predicate="within")

correspondence = joined[["FinalR_DEA", "LGDNAME"]]   # A-name -> B-name
print(correspondence)
```

Verified output: all **80** DEAs match to their **11** LGDs (Belfast → 10 DEAs,
every other council → 7), e.g. *Glengormley Urban → Antrim and Newtownabbey*.

### Same-level example — largest-overlap match (different vintages)

```python
import geopandas as gpd

a = gpd.read_file(URL_A).to_crs(4326)   # e.g. wards 1993
b = gpd.read_file(URL_B).to_crs(4326)   # e.g. wards 2012

ov = gpd.overlay(a, b, how="intersection")
ov["ov_area"] = ov.geometry.area
# for each A feature, keep the B feature it overlaps most
best = ov.sort_values("ov_area").groupby("<A_id_field>").tail(1)
```

Use an equal-area projection (e.g. `to_crs(2157)`, Irish Transverse Mercator)
before measuring areas if you need accurate overlap sizes.

## Notes

- **Attributes are on the features.** After the join, each row carries both
  layers' attributes, so you can also compare non-spatial fields.
- **Licences / attribution:** each catalogue entry names its `provider`; the
  full `maps.json` carries `license`/`references`. Commonly OGL v3.0 (NI/OSNI)
  and CC-BY 4.0 (Tailte Éireann/OSi). Attribute the original providers.
- **In-page alternative (fragile):** because the site is MapLibre, an agent that
  executes JavaScript in the page could call `map.getSource(id)` /
  `map.querySourceFeatures(id)` to read loaded features — but this needs the map
  loaded at the right zoom and the correct source IDs. The `.fgb` path above is
  the robust one.
