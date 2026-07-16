# 2011 Census bulk → tidy (2021-schema) converter

Converts NISRA 2011 Census bulk download tables (wide, coded) into the same
tidy long schema as the 2021 flexible-table-builder corpus.

- `convert.py` — outline (`*_Table_Outlines.xlsx`) parser + geography label
  loader. Handles crosstab layouts (DC/LC) and dashboard layouts (KS/QS, where
  the "Unit of Measure" row is used to keep only Count columns).
- `run.py` — melts every `*DATA*.CSV` under `data/census/2011/…` against its
  outline, emits `Geography Code, Geography Label, Category 1..k, Count`, gzips,
  and streams to R2 (`data/census/2011-cleaned/`), building a manifest.

Validation: decoded cell codes were checked for additivity against the raw
tables (e.g. DC1101 All = household + communal). Category columns are
self-describing labels; human dimension names live in the manifest.

Requires: openpyxl; R2 credentials in a local env file (not committed).
