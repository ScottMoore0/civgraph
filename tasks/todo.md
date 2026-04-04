Local-election bundled loads and precomputed aggregates
- [x] Add reversible support for optional local-election `_bundle.json` artifacts in the runtime loader.
  - [x] Prefer per-date local bundles for `local-government` only when the bundle validates and contains requested constituencies.
  - [x] Fall back automatically to the existing per-constituency JSON path for any missing or invalid bundle data.
- [x] Add reversible support for optional local-election `_aggregates.json` artifacts in the runtime loader.
  - [x] Prefer precomputed current/previous council aggregates only when the aggregate artifact validates.
  - [x] Fall back automatically to the existing runtime aggregate builder for any missing or invalid aggregate data.
- [x] Extend the local-election build script to emit additive `_bundle.json` and `_aggregates.json` files without removing existing constituency JSON outputs.
- [x] Regenerate local-election artifacts and verify:
  - [x] runtime syntax checks
  - [x] build-script syntax
  - [x] expected additive files exist
  - [x] existing local-election views still have fallback-safe inputs
- [x] Record the overdue ZIP-intake check result in `.zip-intake-check.json`.
  - Runtime now checks for `_bundle.json` and `_aggregates.json` only for `local-government`, caches them separately, validates shape, and falls back automatically to the existing constituency JSON and aggregate builder when anything is missing or invalid.
  - The builder now writes additive per-date `_bundle.json` and `_aggregates.json` files alongside the existing constituency JSON outputs. Existing constituency files were preserved and regenerated in place.
  - Verification:
    - `node --check js/election-controller.js`
    - Python AST parse of `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py`
    - Builder rerun completed successfully and wrote `249` JSON files
    - Sample verification confirmed `election-viewer-package/data/elections/local-government/2023-05-18/_bundle.json` and `_aggregates.json` exist alongside `airport.json`
  - Rollback:
    - runtime rollback is metadata-free; simply remove or ignore `_bundle.json` / `_aggregates.json` and the loader falls back automatically
    - data rollback is additive-only; constituency JSON primitives remain the authoritative fallback path

Catalogue books and TOC top links
- [x] Add legislation-book thumbnails and top-level TOC links; review 2023 local-election load bottlenecks
  - [x] Add visible thumbnail fallback treatment for legislation books so they render like other book cards
  - [x] Add clickable top-level TOC links for Elections, Maps, and Books
  - [x] Verify UI changes with syntax checks
  - [x] Report ranked 2023 local-election load bottlenecks and safest speed improvements
  - Added a generated thumbnail fallback for books without `assets/thumbnails/book-<id>.png`, which gives legislation entries visible thumbnail cards instead of blank spaces while preserving existing boundary-report thumbnails.
  - Added top-of-TOC quick links for `Elections`, `Maps`, and `Books`, and inserted matching anchors into the flat catalogue sections so they scroll correctly.
  - Verification: `node --check js/ui-controller.js`; `node --check js/election-controller.js`.

Phase 0 - Map load optimization rollout
- [x] Add observability/timing instrumentation for vector full-load, LOD selection, chunk index load, chunk fetch/decode/render, and viewport updates.
  - Added structured load metrics in `js/map-controller.js` for full-file vector loads, LOD source selection, chunk index load, chunk file fetch/decode/render, and viewport reload paths.
- [x] Add browser-safe baseline tests for one LOD candidate (`eds-ulster-1911`) and one chunk candidate (`oa-2001`).
  - Added/validated `tests/browser/map-loading-pilots.spec.js` and reran it successfully in Playwright.
- [x] Record first pilot candidates and rationale.
  - Chosen pilots:
    - `eds-ulster-1911` for isolated LOD verification
    - `oa-2001` for chunking + bounded concurrency + zoom-variant verification

Phase 1 - LOD framework hardening
- [x] Add runtime guards/fallback logging when `useLOD` is enabled but derived assets are missing.
  - Added LOD selection/fallback metric logging in `js/map-controller.js`.
- [x] Ensure source selection is observable and reversible by metadata only.
  - Verified `useLOD` remains metadata-driven and logs the selected derived/full source at runtime.

Phase 2 - One-map LOD pilot
- [x] Enable/verify `eds-ulster-1911` as the first isolated LOD pilot.
  - Verified via Playwright that low-zoom loads select a derived `lod0/lod1` source for `eds-ulster-1911`.
- [x] Compare baseline vs after timings and validate visual correctness.
  - Browser verification passed for low-zoom derived-source selection without load failure.

Phase 3 - Chunk framework hardening and pilot
- [x] Harden chunk manifest/runtime validation.
  - Added `_validateChunkIndex(...)` and runtime metric logging for missing/invalid chunk manifests.
- [x] Enable/verify `oa-2001` as the first isolated chunking pilot.
  - Verified `oa-2001` chunk index load, visible chunk loading, and chunk zoom-file selection in Playwright.

Phase 4 - Bounded parallel chunk loading
- [x] Refactor chunk loading to a bounded concurrency executor with default concurrency `1`.
  - Added `getChunkLoadConcurrency(...)` and `_mapWithConcurrency(...)` in `js/map-controller.js`.
- [x] Enable safe bounded parallelism for the pilot and verify.
  - Enabled `chunkLoadConcurrency: 4` for `oa-2001` in `data/database/maps.json` and verified the pilot stays correct in Playwright.

Phase 5 - Zoom-variant chunk framework
- [x] Harden zoom-variant chunk selection/validation.
  - Verified runtime selection through the existing chunk `zoomFiles` path and added browser assertions for low/high zoom variant use on the pilot.
- [x] Select a first chunked pilot for broader zoom-file support after prior phases pass.
  - `oa-2001` remains the first verified zoom-variant chunk pilot.

Review
- [x] Capture timing results, regression results, rollback points, and next rollout candidates.
  - Regression evidence:
    - `npm run test:browser -- --grep "eds-ulster-1911|oa-2001 uses chunk index" --workers 1`
    - `2 passed`
  - Rollback points:
    - disable `useLOD` per map in `data/database/maps.json`
    - disable `chunked` and/or `chunkLoadConcurrency` per map in `data/database/maps.json`
  - Next safe rollout candidates:
    - more medium/large maps for metadata-only LOD enablement
    - one additional large chunk candidate after asset audit

Book catalogue search fix
- [x] Fix missing legislation/statutory books when searching `book` in the catalogue.
  - Root cause: the catalogue book filter only matched book title/author/keywords, so generic searches like `book` did not match legislation entries whose titles lacked that word.
  - Fix: added `_bookMatchesSearch(...)` in `js/ui-controller.js` and used it in both catalogue book-render paths so search also matches book-category metadata and the generic `book/books/document/documents` labels.
  - Verification: `node --check js/ui-controller.js`
## LOD rollout for existing assets
- [x] Inventory maps that already have `lod0/lod1` assets and no chunked loader
- [x] Enable `useLOD` only for the safe existing-asset set
- [x] Add representative browser verification across map families
- [x] Run full verification and record outcomes

Review:
- Identified `114` maps that already had matching `-lod0.fgb` and `-lod1.fgb` assets on disk and were not using the chunked loader.
- Enabled `useLOD: true` only for that existing-asset safe set in `data/database/maps.json`, with no new runtime dependency on missing files.
- Added representative browser coverage in `tests/browser/map-loading-pilots.spec.js` for:
  - `lgd-2012`
  - `pc-2023`
  - `river-basin-districts`
  - `dail-2023`
- Verified:
  - `maps.json` parses
  - targeted LOD/chunk pilot suite passes
  - full Playwright suite passes (`12 passed`)

ZIP Intake Check (2026-03-17)
- [x] Check maps-to-be-added for qualifying ZIP files
  - No ZIP files found.
- [x] Update .zip-intake-check.json with new check time

NI SPN gap-closure collection run
- [x] Execute the three highest-yield acquisition lanes in parallel:
  - historic non-local election discovery/capture via BNA
  - old-26 council archive recovery for local-election SPNs and election-agent notices
  - focused Lisburn & Castlereagh 2019 SPN discovery
- [x] Validate new artifacts and manifests
- [x] Review and record:
  - newly collected source documents
  - elections/constituencies/DEAs materially improved
  - remaining hard gaps and blockers
  - Actions run:
    - `python scripts/download_council_spns_v4.py`
    - `python scripts/parse_eoni_pdfs.py`
    - `python scripts/convert_old26_to_markdown.py`
    - `python scripts/scrape_26_councils.py` (timed out after ~20 minutes; no new manifest evidence beyond prior old-26 recovery state)
    - `python scripts/scrape_bna.py 1979` (failed immediately; script filtered to zero elections for `1979` and Playwright persistent-context launch then exited)
  - New collection yield from the targeted council downloader:
    - `58` successful downloads, `16` failed
    - major additions landed for `2023_local_ards-north-down`, `2023_local_mid-east-antrim`, `2023_local_belfast`, `2023_local_antrim-newtownabbey`, `2023_local_derry-strabane`, `2023_local_mid-ulster`, `2023_local_armagh-banbridge-craigavon`
    - major additions landed for `2019_local_antrim-newtownabbey`, `2019_local_causeway-coast-glens`, `2019_local_newry-mourne-down`, and `2019_local_mid-east-antrim`
    - election-agent additions landed for `2019_local_newry-mourne-down`
  - Verification outputs:
    - `_tmp_eoni_pdf_analysis.json` regenerated from `540` PDFs
    - `_tmp_gazette_markdown/old26_councils/index.json` regenerated with `146` files processed, `124` extracted, `22` flagged as manual-conversion DOC failures
  - Hard blockers:
    - BNA automation is currently blocked by the Playwright browser launch failure in `scripts/scrape_bna.py`
    - many legacy `.doc` files still require a separate converter/OCR path before text can be mined
    - some recovered PDFs are image-only or otherwise text-extraction-hostile (for example Lisburn & Castlereagh samples returned zero text from both PyPDF2 and PyMuPDF)

NI SPN follow-up: BNA runner hardening and local-year correction
- [x] Fix `scripts/scrape_bna.py` election selection and non-interactive login handling
  - Added explicit `1979`/`1983`/`1938` election entries that were missing from the configured search list.
  - Replaced the year-only assumption with `select_elections(...)`, so `python scripts/scrape_bna.py 1987` now filters correctly to one configured election instead of zero.
  - Added `launch_bna_context(...)` fallback from persistent profile to a fresh browser context with optional saved storage state.
  - Added non-interactive detection via `BNA_NONINTERACTIVE=1` or non-TTY stdin and converted the login prompt into a clean `SystemExit` instead of an `EOFError`.
- [x] Verify the BNA runner behavior after the fix
  - `python -m py_compile scripts\scrape_bna.py scripts\validate_local_spn_years.py`
  - `$env:BNA_NONINTERACTIVE='1'; python scripts\scrape_bna.py 1987`
  - Verified result: the script now reports `Filtering to year 1987: 1 elections`, falls back cleanly when the persistent Chromium profile crashes, and exits with `No reusable BNA login is available in this environment` rather than crashing on `input()`.
  - Remaining blocker: no reusable subscribed BNA session is available in this environment, so no historic article capture was completed.
- [x] Add and run a year-validation pass for mislabeled local SPN files
  - Added `scripts/validate_local_spn_years.py` to inspect `2019_local_*` and `2023_local_*` SPN files, infer poll year from extracted text, and move mismatches into the correct year directory.
  - Ran `python scripts\validate_local_spn_years.py`, which wrote `_tmp_spn_year_validation.json`.
  - Verification/result:
    - `207` files scanned
    - `35` mislabeled files moved
    - detected years: `31` as `2019`, `112` as `2023`
    - confirmed corrections include cross-year duplicates in Belfast, Mid and East Antrim, Mid Ulster, Derry and Strabane, Causeway Coast and Glens, and Armagh Banbridge Craigavon
- [x] Review recurring defects and prevention
  - Symptom: BNA automation failed before scraping because configured year filters returned zero elections and the login fallback crashed on `input()`.
  - Root cause: the election list omitted some targeted years, and the script assumed an interactive terminal even in automated runs.
  - Permanent prevention action: year/name election selection is now centralized in `select_elections(...)`, and non-interactive runs fail fast with an explicit login error path.
  - Verification evidence: the `1987` rerun reached the intended clean blocker message after matching the year correctly.

BNA secure local-session setup
- [ ] Verify local auth artifacts remain untracked and open a manual-login browser session
- [ ] Capture a local reusable authenticated session without storing raw credentials in the repo
- [ ] Verify the saved session can be reused for BNA scraping

Conversation log export
- [x] Write a markdown file with the full details of this conversation, excluding any credentials or session tokens
- [x] Confirm the output path and what was included
  - Wrote `tasks/conversation-log-2026-03-20.md`
  - Included: user requests, repo-review findings, gap analysis, acquisition actions, code changes, commands run, verification outcomes, blockers, and the secure BNA-login workflow
  - Excluded: raw credentials, cookies, tokens, and storage-state contents

Performance improvement handoff package
- [x] Create a repo-local handoff folder with the full implementation and testing plan for performance items `1` through `13`
  - Added `docs/performance-improvement-handoff/README.md`
  - Added `docs/performance-improvement-handoff/00-execution-protocol.md`
  - Added `docs/performance-improvement-handoff/01-metrics-and-thresholds.md`
  - Added per-item execution sheets in `docs/performance-improvement-handoff/items/`
  - Structured the package for one-item-at-a-time delivery with:
    - atomic steps
    - automated non-browser checks first
    - manual user checks second
    - rollback and acceptance gates
  - Notes:
    - the package explicitly assumes no browser automation is required for the first verification layer
    - later agents should extend existing repo mechanisms additively instead of replacing them wholesale
  - Review:
    - the handoff package now gives Claude or another later agent a direct execution path without re-deriving ordering, test scope, or rollback criteria
    - every numbered improvement from `1` to `13` has a dedicated file and atom sequence
- [x] Add supplemental execution aids to make the handoff package more actionable for later agents
  - Added `docs/performance-improvement-handoff/02-repo-hotspots.md`
  - Added `docs/performance-improvement-handoff/03-command-catalog.md`
  - Added `docs/performance-improvement-handoff/04-atom-worksheet-template.md`
  - Added `docs/performance-improvement-handoff/05-decision-log-template.md`
  - Added `docs/performance-improvement-handoff/06-risk-register-template.md`
  - Added `docs/performance-improvement-handoff/07-manual-test-report-template.md`
  - Updated the package `README.md` to point at the new files and explain their purpose
  - Review:
    - later agents now have a repo-specific orientation map, reusable execution templates, and a consistent place to record tradeoff decisions and manual results
- [x] Add final execution-readiness aids to reduce startup ambiguity for later agents
  - Added `docs/performance-improvement-handoff/08-recommended-execution-order.md`
  - Added `docs/performance-improvement-handoff/09-file-touch-matrix.md`
  - Added `docs/performance-improvement-handoff/10-non-browser-test-script-specs.md`
  - Added `docs/performance-improvement-handoff/11-glossary.md`
  - Updated the package `README.md` again so the index is complete
  - Review:
    - later agents now have a recommended sequencing model, likely file-entry points, explicit non-browser script targets, and shared terminology
- [x] Add first-wave execution and acceptance aids so later agents can start immediately
  - Added `docs/performance-improvement-handoff/12-first-wave-starter-pack.md`
  - Added `docs/performance-improvement-handoff/13-acceptance-criteria-matrix.md`
  - Added `docs/performance-improvement-handoff/14-known-constraints-and-non-goals.md`
  - Added `docs/performance-improvement-handoff/15-script-backlog-checklist.md`
  - Updated `docs/performance-improvement-handoff/README.md` to index the new files
  - Review:
    - later agents now have a clear first wave, a fast accept/reject matrix, explicit boundaries, and a concrete script backlog to begin the non-browser automation layer
- [x] Add runnable handoff-local scripts for the first non-browser verification wave
  - Added `docs/performance-improvement-handoff/scripts/README.md`
  - Added shared helpers in `docs/performance-improvement-handoff/scripts/_shared.mjs`
  - Added runnable report scripts:
    - `report-bundle-sizes.mjs`
    - `report-startup-imports.mjs`
    - `report-first-load-assets.mjs`
    - `report-font-usage.mjs`
    - `report-map-performance-metadata.mjs`
    - `report-dependency-usage.mjs`
  - Updated the handoff `README.md` to index the scripts
  - Review:
    - later agents can now run the first reporting wave directly from the handoff package instead of creating the scripts from scratch
  - Verification:
    - `node docs\performance-improvement-handoff\scripts\report-bundle-sizes.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-startup-imports.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-first-load-assets.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-font-usage.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-map-performance-metadata.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-dependency-usage.mjs`
    - All six scripts executed successfully and produced repo-specific reports
- [x] Add current baseline report artifacts to the handoff package
  - Added `docs/performance-improvement-handoff/reports/current-state-summary.md`
  - Added current text outputs for:
    - bundle sizes
    - startup imports
    - first-load assets
    - font usage
    - map performance metadata
    - dependency usage
  - Updated the handoff `README.md` to index the `reports/` folder
  - Review:
    - later agents now have immediate repo-specific baseline evidence inside the handoff folder, even before rerunning the scripts
- [x] Add a single start-here entrypoint for later agents
  - Added `docs/performance-improvement-handoff/START-HERE.md`
  - Updated `docs/performance-improvement-handoff/README.md` to index it
  - Review:
    - later agents now have one short file that tells them what to read first, what to run first, and which atom to start with
- [x] Add machine-readable handoff artifacts for later agents
  - Added `docs/performance-improvement-handoff/manifest.json`
  - Added `docs/performance-improvement-handoff/state/current-status.json`
  - Added `docs/performance-improvement-handoff/items/index.json`
  - Added JSON versions of the current baseline reports under `docs/performance-improvement-handoff/reports/`
  - Updated the handoff `README.md` to index the machine-readable files
  - Review:
    - later agents can now consume the handoff package programmatically instead of parsing only prose and plain-text reports
- [x] Add final execution helpers beyond documentation
  - Added `docs/performance-improvement-handoff/state/next-actions.json`
  - Added `docs/performance-improvement-handoff/scripts/run-first-wave.mjs`
  - Added starter templates:
    - `docs/performance-improvement-handoff/scripts/templates/benchmark-template.mjs`
    - `docs/performance-improvement-handoff/scripts/templates/validator-template.mjs`
  - Updated `manifest.json`, `state/current-status.json`, and the handoff `README.md` to reference the new helpers
  - Review:
    - later agents can now refresh the first-wave reports with one command, consume an ordered next-action queue, and start benchmark or validator work from working templates

ZIP Intake Check (2026-03-24)
- [x] Check maps-to-be-added for qualifying ZIP files
  - Checked at `2026-03-24T15:46:29Z`
  - No ZIP files found; only `maps-to-be-added/.gitkeep` was present
- [x] Update `.zip-intake-check.json` with the new check time
