# 2011 NI Census — bulk download, original + cleaned

Two layers of the NISRA 2011 Census
[bulk download](https://www.nisra.gov.uk/publications/2011-census-bulk-download-files),
both on Cloudflare R2 (`data.civgraph.net`).

## 1. Originals (pristine)

The 8 source ZIPs, byte-for-byte, at
`https://data.civgraph.net/data/census/2011-bulk/originals/` — Key Statistics
(KS), Quick Statistics (QS), Detailed Characteristics (DC) and Local
Characteristics (LC), each in an *administrative-geographies* and a
*statistical-geographies* file. These are NISRA's wide, coded format
(`GeographyCode, KS101NI0001, …`) with the column meanings in the enclosed
`*_Table_Outlines.xlsx`.

## 2. Cleaned (tidy, 2021-style)

**1,565 tables**, one gzipped CSV per (table × geography), at
`https://data.civgraph.net/data/census/2011-cleaned/`, indexed by
[`manifest.json`](https://data.civgraph.net/data/census/2011-cleaned/manifest.json).
Each file is in the **same tidy schema as the 2021 flexible-table-builder
corpus**:

```
Geography Code, Geography Label, Category 1, … Category k, Count
```

produced by decoding each 2011 cell code against its table outline and melting
the wide table to long. 52.4M rows total, ~236 MB gzipped.

- **Families:** KS 225, QS 298, DC 412, LC 610 files.
- **Geographies (2011's own):** Small Area (SA2011), Super Output Area
  (SOA2011), Electoral Ward (WARD2014), Assembly Area (AA2014), and higher
  administrative geographies.
- **Counts only:** KS/QS percentage and derived columns (median age, density,
  …) are dropped via each table's "Unit of Measure" row; only counts are kept.

### Notes / caveats

- **Category columns are self-describing labels** (e.g. `Males`, `Aged 0 to 4`,
  `Lives in a household`). The human dimension names are in each manifest
  entry's `dimensions` field; the source's axis order does not always match the
  title order, so generic column names + manifest metadata is the faithful
  choice.
- **Subtotals retained:** unlike the 2021 leaf-only tables, these keep NISRA's
  own subtotal and "All …" total rows (they double as validation margins —
  every crosstab's parts sum to its total).
- **2011 categories and geographies are kept as-is.** No recoding to 2021
  classifications and no rebasing onto 2021 geographies — those are deliberately
  separate (lossy) exercises, not part of this cleaned layer.

## Licence

NISRA 2011 Census, Crown copyright, Open Government Licence v3.0.
