# NISRA 2021 Census flexible-table-builder corpus

A machine-readable mirror of **3,664 tables** harvested from the NISRA 2021
Census flexible table builder (`build.nisra.gov.uk`), served as gzipped CSVs
from Cloudflare R2. This lets an agent read 2021 Census counts at NI
small-area geographies **without** driving the Cantabular web UI.

## Index

- **Manifest:** [`https://data.civgraph.net/data/census/nisra-ftb/manifest.json`](https://data.civgraph.net/data/census/nisra-ftb/manifest.json)

Each manifest entry is:

```json
{
  "dataset": "PEOPLE",
  "geography": "DZ21",
  "variables": ["AGE_BAND_AGG11", "UR_SEX"],
  "file": "PEOPLE__DZ21~AGE_BAND_AGG11~UR_SEX.csv.gz",
  "url": "https://data.civgraph.net/data/census/nisra-ftb/PEOPLE__DZ21~AGE_BAND_AGG11~UR_SEX.csv.gz",
  "bytes": 123456
}
```

Fetch `url` and `gunzip` — the payload is the exact CSV NISRA's builder emits
(one row per geography × category combination, with a count column).

## What's covered

- **Datasets:** `PEOPLE` (person-level, 42 attribute variables) and
  `HOUSEHOLD` (household-level, 14 attribute variables).
- **Geographies:** `LGD14` (11 councils), `DEA14` (80 District Electoral
  Areas), `SDZ21` (850 Super Data Zones), `DZ21` (3,780 Data Zones).
- **Table shapes:** all 81 NISRA ready-made tables, every univariate
  (geography × one attribute) table, every 2-way (geography × two attributes)
  table that passes disclosure control, and targeted 3-way joints for the MRP
  attribute set (sex × age × religion × NS-SeC) wherever they pass.

## Disclosure control (why some combinations are absent)

NISRA applies statistical disclosure control: fine crosstabs at small
geographies are blocked (the builder returns HTTP 403 "Whole table blocked by
output rules"). Blocking is **monotone** — any superset of a blocked variable
set is also blocked — so the harvest used Apriori downward-closure pruning:
a blocked table's supersets were never requested. **Only tables NISRA itself
publishes are present; nothing disclosure-controlled was reconstructed.** The
absence of a variable combination at a given geography means NISRA blocks it.

## Building an MRP poststratification frame

The 3-way joints here (plus the 2011 joints in
[`mrp-frame-README.md`](https://civgraph.net/agent/mrp-frame-README.md)) are the
raw margins for iterative proportional fitting. See that document for the raking
recipe.

## Licence

NISRA 2021 Census, Crown copyright, released under the Open Government Licence
v3.0. Attribute NISRA when reusing.
