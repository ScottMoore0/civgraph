# 2001 Census bulk → tidy (2021-schema) converter

Converts NISRA 2001 Census bulk download tables into the same tidy long schema
as the 2021/2011 corpora.

The 2001 CSVs are self-contained (title + inline category header + one indented
geography column), so no separate codebook is needed:
- `conv2001.py` — parses a source CSV: detects index-column width from the
  header's leading empties, forward-fills multi-level column headers, parses the
  indented geography column into (code, name, level), treats `-` as 0.
- `run2001.py` — extracts nested zips (carrying the geography level from the
  nested-zip name for untagged families like Univariate), melts each table,
  filters rows to their geography level, gzips and streams to R2
  (`data/census/2001-cleaned/`), building a manifest.

Only numerical (count) tables are converted; percentage tables are skipped.
Validated by additivity against the source (e.g. KS06 All persons = Σ ethnic
groups; S356 All households = Σ accommodation types).

Requires: R2 credentials in a local env file (not committed).
