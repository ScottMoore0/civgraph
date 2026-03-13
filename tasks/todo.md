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
