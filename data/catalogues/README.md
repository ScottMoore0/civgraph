# NISRA file inventory

Complete enumeration of data files published on the NISRA website
(`nisra.gov.uk/publications`), built by crawling all 3,342 publications until
the paginated listing saturated.

- `nisra-file-inventory.csv` / `.json` — **5,723 unique data files** across
  1,260 publications. Per file: `type`, file name, `url`, parent publication
  title and slug.

Composition: **2,631 Excel** (1,795 `.xlsx` + 836 `.xls`), **2,378 PDF**,
442 `.ods`, 211 `.zip`, 61 `.csv`.

Scope: the `/publications` universe (where NISRA's data files live). Excludes
the NISRA Data Portal (structured PxStat cubes — a separate system, ingested to
`data/nisra-portal/cleaned/`) and any file linked only from a `/statistics/`
theme page. The census bulk ZIPs, NIMDM `.xls`, and historical-census files
already ingested elsewhere are a subset of this inventory.
