# Landing note: w23-census-scripts

Branch `w23-census-scripts` (worktree `C:\Users\scomo\civgraph-w23-census-scripts`), made from main
for owner decision 13 (24 Nov 2026): land the historic-census SCRIPTS on main; their outputs stay
private and never enter git. It carries only the scripts, the shared library, the tests and one
doc from the research branch `w23-census-1926-61` (which is not to be landed itself: it also
carries its own LANDING.md and history). No data outputs, no CSV results, nothing private, no
path to any private file: the private valuation-stock steps take the extract as `--stock EXTRACT`
(`--extract EXTRACT` for the test) and write only under `<out>/private/`, outside the repository.
Nothing is published: no catalogue rows, layers, explorer entries, R2 or D1 changes.

## What it adds

- `scripts/ingest/census/hist_census_*.py` (11 driver scripts) and `hist-census-pages.json`: the 1926,
  1937, 1951, 1961 (1966 by district) census tables read and checked against their printed totals;
  each census put on 2021 Data Zones by area, town-aware and (private, `--stock`) by housing;
  1971 and 1981 on the 1972 wards; 1991, 2001 and 2011 by housing (`hist_census_1991_2011.py`,
  owner decision 12); the long-run series, stable areas and discontinuity tables; the
  known-answer test of the weighting methods (1991 wards in districts, 2001 output areas in
  wards, 2011 small areas in super output areas).
- `scripts/ingest/census/hist_census_lib.py`: the pure helpers (parsing, checks, matching,
  apportioning, era weights incl. open bands and band-less properties, the survivor-bias guard,
  `stock_apportion`, stable areas). `hist_census_paths.py`: output folder from `--out` /
  `HIST_CENSUS_OUT` / `tmp/hist-census` (gitignored); report PDFs from `HIST_CENSUS_REPORTS`; the
  1926 workbooks from `HIST_CENSUS_1926_SRC`; the main checkout found from a worktree's .git file.
- `scripts/ingest/census/plugin.mjs`: the scripts listed as research, the two modules as helpers,
  the pages file as data (test:intake accounts for every file).
- `docs/census-historic-ni-data-zones.md`: what the scripts do and the order of a run.
- `tests/unit/hist-census-1926-61.test.mjs` (8), `hist-census-1971-81-stock.test.mjs` (8),
  `hist-census-1991-2011-stock.test.mjs` (5): synthetic fixtures only; they skip without Python.

## Gates (this worktree)

- census unit tests: 21 pass.
- `npm run check:architecture`: clean against the baseline.
- `npm run check:fast`: CHECKS OK, 86 steps (after rebasing on main c5a28a61e2; before that rebase
  check:app-shell-cache failed on main's own stale token, not on this branch, which touches nothing
  under `site/`).
- `npm run check:local-paths`, `check:doc-status`, `test:intake`: pass (no machine paths; the doc
  declares its status; the plugin accounts for every file).

## Architecture rules
- Rules touched: R1 (scripts under scripts/ingest/census/, the census plugin's unit; Python, outside
  check:boundaries' import scan); R12 (the pure helpers in hist_census_lib.py and the parsers,
  tested by the three census test files); R6/C5 (no origin, User-Agent or records path; no
  machine paths: check:local-paths passes).
- Exceptions added: none (no arch-ok markers, no baseline entries).
- check:architecture: new findings 0; baseline unchanged.
- R2 no copies: yes (one library, hist_census_lib.py; dz_1991 in hist_census_series.py now reuses
  hist_census_1991_2011.units_1991 rather than its own copy).
- R3 real seams, no new dependencies: yes (geopandas, shapely, pyogrio, pymupdf, openpyxl already used
  by scripts/ingest; package.json untouched).
- R4 one data door: yes (no records database or API; reads files only).
- R8 cleanup beyond listeners (maps, workers, timers): n/a (offline scripts).
- R10 text keyed: n/a (no interface text).
- R12 logic pure and tested: yes.
- Prototype deferrals (R14): none.
