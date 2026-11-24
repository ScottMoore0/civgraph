# Historic Northern Ireland censuses on 2021 Data Zones

> **Status: current, 24 November 2026.** Research scripts, not a site feature; before acting,
> check the scripts' own header comments, which this summarises.

Research scripts (`scripts/ingest/census/hist_census_*.py`) that read the printed census tables of
1926, 1937, 1951, 1961 (and 1966 by district), check every table against its own printed totals,
and place each census on the 2021 Data Zones, so that one series runs from 1926 to 2021. Nothing
here feeds the site: the outputs are research files, kept outside the repository.

## Where things go

Every script takes `--out DIR` (else `HIST_CENSUS_OUT`, else `tmp/hist-census`, which is
gitignored). Maps and the derived census files are read from `data/maps` and
`data/census/derived` of the main checkout (`hist_census_paths.py` finds it from a worktree).
Outputs are never committed.

## Order of a run

1. `hist_census_1926.py` (1926 tables from the data-table workbooks: `--src` or
   `HIST_CENSUS_1926_SRC`), `hist_census_ocr.py` and `hist_census_parse.py` (1937, 1951, 1961
   Table 4 from the report pages listed in `hist-census-pages.json`; the report PDFs in `--reports`
   or `HIST_CENSUS_REPORTS`; Tesseract from `TESSERACT` or the PATH),
   `hist_census_religion.py` (religion tables). Corrections re-read from the page images are kept
   beside the outputs, each with its page.
2. `hist_census_crosswalk.py`: each DED or ward matched to the DED map in force on census day,
   then put on Data Zones by area and town-aware (printed town populations into their 2015
   settlement footprints, the rest by area).
3. `hist_census_1981_towns.py` (the 1981 towns table), `hist_census_1971.py` (1971 and 1981 on the
   1972 wards, area and town-aware).
4. `hist_census_series.py`: the long-run Data Zone series (1991 the 1984 wards by area, 2001 and
   2011 the output and small areas by areal weights, 2021 as published), stable areas, district
   series and the checks.

Every unit keeps its own printed count exactly under every method (checked per unit).

## The housing-weighted variant (private)

The crosswalk scripts can also place each unit's people by the surviving domestic properties of
the right build era instead of by area: `--stock EXTRACT` on `hist_census_crosswalk.py`,
`hist_census_1971.py` and `hist_census_1991_2011.py`; `hist_census_stock_test.py --extract EXTRACT`
scores the methods where the answer is known; `hist_census_stock_series.py` builds the series from
the results. The extract is private ancillary data, read in place; these runs write only to
`<out>/private/`, only aggregates per census unit and Data Zone, and nothing from them is published.

- **Era weights** (`hist_census_lib.era_weight`): a band counts the share of its years built by
  census day (Pre-1919 1; Inter-War (day - 1919) / 27; a `YYYY-YYYY` band (day - first year) / its
  years; an open band such as `Post 2005` the same up to `--open-band-end`). Properties with no
  band (apartments) count 0 unless `--bandless-weight` is given (`hist_census_1991_2011.py`, 2001
  and 2011 only). Each run of `hist_census_1991_2011.py` writes the band table it used.
- **Towns first** where the series is town-aware (1926-1981): the printed town population goes
  inside the town's footprint, by the stock there.
- **Survivor-bias guard** (`stock_guard`): where a unit has more than 20 persons per qualifying
  surviving property, area weighting; 12-20, half and half. Flags are written per year.
- **1991, 2001, 2011**: no official lookup runs from the 1984 wards, 2001 output areas or 2011
  small areas to the Data Zones (the Data Zones were drawn in 2021 from road-network building
  blocks; the output and small areas from postcode polygons), so they are placed by housing too,
  with the guard and without a towns step.

## Tests

`tests/unit/hist-census-1926-61.test.mjs`, `hist-census-1971-81-stock.test.mjs` and
`hist-census-1991-2011-stock.test.mjs` test the pure steps in `hist_census_lib.py` and the parsers
on synthetic fixtures (they skip without Python).
