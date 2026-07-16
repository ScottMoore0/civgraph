# 2001 NI Census — bulk download, original + cleaned

Two layers of the NISRA 2001 Census
[bulk download](https://www.nisra.gov.uk/publications/2001-census-bulk-download-files),
both on Cloudflare R2 (`data.civgraph.net`). Mirrors the structure of the
[2011 layer](https://civgraph.net/agent/census-2011-README.md).

## 1. Originals (pristine)

The 10 source ZIPs, byte-for-byte, at
`https://data.civgraph.net/data/census/2001-bulk/originals/` — Key Statistics
(KS), Univariate (UV), Standard Tables (S), Census Area Statistics (CAS) and
Migration & Travel, each in administrative- and statistical-geography files.
These are NISRA's self-contained format: each CSV embeds its title, an inline
category header row, and a single indented geography column (Northern Ireland →
district → ward → Output Area).

## 2. Cleaned (tidy, 2021-style)

**2,606 tables**, one gzipped CSV per (table × geography), at
`https://data.civgraph.net/data/census/2001-cleaned/`, indexed by
[`manifest.json`](https://data.civgraph.net/data/census/2001-cleaned/manifest.json)
(authoritative — use it rather than guessing filenames). Same tidy schema as the
2021 corpus:

```
Geography Code, Geography Label, Category 1, … Category k, Count
```

~82.6M rows, ~287 MB gzipped.

- **Families:** KS, UV, Standard Tables (S), CAS, Migration & Travel.
- **Geographies (2001's own):** Output Area (OA2001), Ward (WARD2001), District
  (LGD2001), Northern Ireland (NI), plus Parliamentary Constituency, Education &
  Library Board, Health & Social Services Board and NUTS3 for the administrative
  tables.
- **Counts only:** the percentage tables are excluded; the source's `-`
  (zero / negligible) is rendered as `0`.

### Notes / caveats

- **Category columns are self-describing labels** (e.g. `Persons in ethnic
  group: White`). The human dimension names are in each manifest entry's
  `title`.
- **Subtotals retained** (NISRA "All …" totals), which double as validation
  margins — every crosstab's parts sum to its total (checked during the build,
  e.g. S356 `All households = Σ accommodation types`).
- **2001 categories and geographies kept as-is** — no recoding to 2021
  classifications and no rebasing onto 2021 geographies.
- A handful of source tables (~8, <0.3%) failed to parse and are omitted; the
  originals remain available in layer 1.

## Licence

NISRA 2001 Census, Crown copyright, Open Government Licence v3.0.
