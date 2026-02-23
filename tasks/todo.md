# Current Task: Task Ledger Consolidation

- [x] Amend `AGENTS.md` so `tasks/todo.md` fulfills the function previously assigned to `TASKS.md`.
- [x] Move all task-tracking content into `tasks/todo.md`.
- [x] Deprecate `TASKS.md` and convert it into a pointer file.
- [x] Update `tasks/lessons.md` to capture this process correction.

## Review
- `AGENTS.md` now points recurring issue logging and task tracking to `tasks/todo.md`.
- `tasks/todo.md` now contains the full prior task ledger content copied from `TASKS.md`.
- `TASKS.md` now contains deprecation-only guidance pointing to `tasks/todo.md`.
- Added a new lessons entry enforcing a single canonical task ledger.

# Remaining Tasks From Prior 12-Point List

## Pending

- [x] New task: Catholic Dioceses offload/update
  - point Catholic Dioceses FGB download to Archive.org direct URL
  - replace repository single-file Catholic Dioceses FGB with chunked parts + reassembly note

## Completed In This Pass

- [x] 1) Map-entry controls fixed:
  - load icon visibility restored
  - overflow/menu trigger rendering made encoding-safe
  - non-placeholder C1/flat entries now render show/hide, load/unload, copy URL, download FGB, overflow menu

- [x] 2) TOC layout fixed to prevent title/year overlap and reduce word-splitting:
  - column widths rebalanced
  - name-cell layout hardened with fixed thumbnail/color columns + constrained text column
  - `word-break: keep-all` applied in relevant desktop/mobile TOC contexts

- [x] 3) Variant action button rendering fixed.

- [x] 4) Dáil card encoding hardened in `maps.json` using escaped unicode values (`\u00e1`).

- [x] 5) Map loading fixes completed for requested layers:
  - strict FGB interactive loading enforced
  - Catholic Dioceses FGB generated and wired (`data/maps/built-environment/Catholic_Dioceses.fgb`)
  - Townlands / Historic Sites / Railways / Transport Lines FGB path presence verified

- [x] 6) `AGENTS.md` updated for 24-hour ZIP check cadence.

- [x] 7) Encoding/icon prevention framework added in `AGENTS.md`.

- [x] 8) Elected-count logic fix already integrated.

- [x] 9) Pause/play transfer animation fix integrated in `election-viewer-package/js/stages2.js`.

- [x] 10) Recurring-issues workflow added in `AGENTS.md`.

- [x] 11) Flat runtime behavior enforced and Copernicus 30m DEM card present in flat catalogue.
- [x] Grouped catalogue view archived at `archive/grouped-catalogue-view/README.md` and removed from runtime markup (`index.html`).

## Already Done From That List

- [x] 12) Search suggestion map-layer text (beside features) styled smaller and greyer than feature names.

## Additional Completed Admin Tasks

- [x] Updated `AGENTS.md` to explicitly forbid repeating ZIP intake checks within 24 hours.
- [x] Added `.zip-intake-check.json` tracking file with `last_checked_utc` and `next_check_after_utc`.

## Completed In This Pass (New)

- [x] Catholic Dioceses offload/update:
  - `data/database/maps.json` now points `files.fgb` at Archive.org direct URL for `catholic-dioceses`
  - repository local single `data/maps/built-environment/Catholic_Dioceses.fgb` replaced with chunked `.partNNN` files and `README-reassemble.txt`

# Current Request (TOC, load/unload, numbers, map loading, active-feature controls)

## In Progress / Completed

- [x] 1) TOC title clipping/space rebalance
  - reduced TOC text size
  - widened usable title column
  - reduced horizontal cell/thumbnail/strip spacing
  - preserved no horizontal overflow on catalogue pane

- [x] 2) Thousands separators for numeric values > 1,000 (without altering string-typed numbers)
  - added numeric-only display formatter in `js/ui-controller.js`
  - applied to dynamic tables and detail metadata/property rendering

- [x] 3) Load button icon should change to X and support unload
  - replaced fragile text glyphs with SVG plus/X icon helper
  - applied across map cards, class members, C1 rows, and variant actions

- [x] 4) Transfer animation resume should continue from paused point
  - updated `resume()` in `election-viewer-package/js/stages2.js` to resume immediately from current point, then continue timed loop

- [x] 5) Results pane table headers align left
  - enforced left alignment for election results table headers in `assets/css/main.css`

- [x] 6) Non-loading target maps fix pass
  - restored local `data/maps/built-environment/Catholic_Dioceses.fgb` from chunk parts
  - updated `data/database/maps.json` Catholic Dioceses FGB path to local file
  - verified source files exist for Historic Sites, Railways, Transport Lines, Townlands, and Copernicus tile set

- [x] 7) Selected-feature entries under Active Layers with per-feature Hide/Unload
  - added per-feature child rows and controls in `js/ui-controller.js`
  - wired callbacks in `js/app.js`
  - implemented per-feature visibility/unload operations in `js/map-controller.js`

# Follow-up Fixes (Current)

- [x] TOC clipping follow-up
  - increased usable title column width again
  - reduced TOC horizontal padding/margins and internal icon/column spacing
  - reduced title text size further in desktop/mobile breakpoints

- [x] Transfer play/resume follow-up
  - removed premature icon mode overrides in click handler
  - hardened `resume()` guard to recover from mode/state desync (`!isPaused && running`)

- [x] Load button follow-up
  - map-card button handlers now check live card state (`map-card--active`) instead of stale closure flags

- [x] File inventory + sizes for requested maps
  - produced current local FGB/chunk/tile file size report for Railways, Catholic Dioceses, Historic Sites, Transport Lines, Copernicus, Townlands

# Root-Cause Pass: Point Feature Double-Click -> Feature Card

- [x] Diagnose runtime event chain for point-feature selection
  - verified `mapController.onFeatureClick -> uiController.showFeatureInfo` wiring in `js/app.js`
  - verified panel DOM targets (`#featureInfo`, `#featureInfoContent`) exist in `index.html`
  - traced selection logic and identified fragile dependency on `state.geoJsonLayers` snapshots instead of live rendered layers

- [x] Implement durable selection fix at source-of-truth
  - `js/map-controller.js`: added `_forEachFeatureLayer(state, callback)` to traverse live `state.group` layer graph recursively
  - `handleMapClick` now queries live rendered feature layers instead of only `state.geoJsonLayers`
  - strengthened point double-click handling with click-pair fallback (`<=450ms`) for canvas/vector cases where native `dblclick` can be inconsistent

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes
  - logic verification: selection can now dispatch via two independent paths:
    1) direct layer `dblclick`, and
    2) map-level geometric hit-test over live feature layers

# Recurrence Pass: Point Double-Click Still Not Emitting Feature Card

- [x] Root-cause update
  - identified remaining gap: some browsers/renderer paths do not reliably emit Leaflet native `dblclick` for point interactions
  - prior logic still depended on native `dblclick` at map/layer level in some paths

- [x] Permanent prevention action
  - added map-level synthetic double-click detector based on two rapid clicks within bounded time/distance
  - wired detector to trigger the same `handleMapClick` selection flow as native `dblclick`
  - guards added to avoid duplicate selection when native `dblclick` does fire

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Historic Point Double-Click Still Failing

- [x] Symptom verification
  - user reproduced on historic-sites point feature: hover visible, double-click, no feature card

- [x] Root cause (highest-confidence)
  - point-feature selection still depended on `dblclick` event delivery paths that vary by renderer/browser/propagation state
  - when `dblclick` is not reliably emitted on point layers, no selection event reaches `uiController.showFeatureInfo`

- [x] Maximally effective fix
  - made point-feature selection fire on point `click` directly in `js/map-controller.js` (`_attachHistoricPointDblClick`)
  - retained `dblclick` handling as secondary path
  - added rapid dedupe in `_emitFeatureSelection` to prevent duplicate card renders when click+dblclick both fire

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Follow-up Fix: Point Double-Click Fails When Zoomed Out

- [x] Root cause
  - point hit-testing thresholds were fixed pixel values, not zoom-aware
  - when zoomed out, user click precision decreases and fixed thresholds were too strict

- [x] Fix implemented
  - `js/map-controller.js` now uses zoom-adaptive thresholds for:
    - synthetic double-click pair detection (`time + pixel distance`)
    - point hit-testing (`pointPickPx`)
    - nearest-point fallback (`nearestFallbackPx`)

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Follow-up Fix 2: Zoomed-Out Point Selection Still Intermittent

- [x] Root cause
  - even with improved dblclick handling, selection still depended on dblclick/click-pair event delivery in some paths
  - at lower zoom, strict tolerances further reduced successful hit-detection

- [x] Maximally effective fix
  - map click handler now always runs feature hit-testing (`handleMapClick`) as primary fallback
  - increased zoom-adaptive hit radius and nearest-point fallback radius for low zoom levels
  - dedupe logic in `_emitFeatureSelection` prevents duplicate feature-card renders

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Follow-up Fix 3: Hover/Selection Consistency For Point Features

- [x] Root cause
  - hover highlighting and click/dblclick selection used different effective tolerances
  - users could trigger orange hover state but still miss feature-card selection

- [x] Fix implemented
  - tracked current hovered point candidate in `js/map-controller.js`
  - added hover-consistent fallback in `handleMapClick`:
    - if no normal hit is found, and a point is recently hover-highlighted,
      select that same hovered point when click occurs nearby

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass: Hover-Proximate Double-Click Must Always Select

- [x] Root cause
  - hover-highlight state could clear between clicks, while selection relied on separate hit-testing/event paths
  - this created a mismatch where orange-highlighted points were not always selected on double-click at lower zoom

- [x] Permanent fix
  - introduced explicit hover-driven selection candidates in `js/map-controller.js`:
    - `_activeHoveredPoint` (currently orange-hovered point)
    - `_lastHoveredPoint` (short-lived post-hover memory)
  - `handleMapClick` now first resolves selection from hover candidate and exits early
  - only if no hover candidate exists does it continue with generic geometric hit-testing

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Map Loading Stabilization (Non-townlands)

- [x] De-LFS critical non-townlands map files
  - added `.gitattributes` exceptions for:
    - `data/maps/transport/Translink_Rail_Network.fgb`
    - `data/maps/transport/Transport_Lines_Road_Rail.fgb`
    - `data/maps/built-environment/Catholic_Dioceses.fgb`
    - all historic-sites FGB files used by map entries
  - re-indexed these files (`git rm --cached` + re-add) so repository serves real FGB bytes, not LFS pointer text

- [x] Catholic Dioceses loading path hardened
  - switched `data/database/maps.json` Catholic Dioceses `files.fgb` back to local `data/maps/built-environment/Catholic_Dioceses.fgb`
  - avoids external CORS/availability failures for interactive loading

- [x] Townlands download behavior switched away from ZIP-chunk flow
  - set `ni-townlands-1844.downloads.fgb` to Internet Archive direct URL target
  - cleared `data/downloads/fgb-chunks/manifest.json` so app no longer triggers ZIP chunk queue for Townlands download
  - note: IA upload of `Townlands_AllIreland.fgb` is still pending final successful completion

# Current Fixes (Labels, Copernicus, Historic dblclick)

- [x] Set Catholic Dioceses labels to `diocese`
  - updated `data/database/maps.json` with `"labelProperty": "diocese"` on `catholic-dioceses`

- [x] Set Railways labels to `Route_Section`
  - updated `data/database/maps.json` with `"labelProperty": "Route_Section"` on `railways-network`

- [x] Copernicus raster visibility hardening
  - lowered Copernicus `rasterStyle.minZoom` from `5` to `0` in `data/database/maps.json`
  - set raster overlay `zIndex` in `js/map-controller.js` so DEM tiles reliably render above basemap

- [x] Historic Sites point-feature dblclick opens feature card
  - added `_attachHistoricPointDblClick(...)` in `js/map-controller.js`
  - wired handler into regular load, chunked fallback/full load, and incremental feature-layer adds

# Current Request (Townlands URL, Townlands loading, historic dblclick, NI-wide elected totals, transfer pause/play sync)

- [x] 1) Townlands direct download URL updated
  - `data/database/maps.json`: set `ni-townlands-1844.downloads.fgb` to `https://archive.org/download/townlands-all-ireland/Townlands_AllIreland.fgb`

- [x] 2) Townlands loading diagnosis and surgical fix
  - root cause identified in chunk-stage `minDiag` filtering
  - `js/map-controller.js`: disabled `minDiag` cull for `ni-townlands-1844` while keeping chunk loading active

- [x] 3) Historic Sites point object selection fix
  - `js/map-controller.js`: replaced point hit test from 10m geodesic threshold to screen-space threshold (`<= 14px`) for consistent click/dblclick detection

- [x] 4) 2022 Assembly NI-wide elected counts fix
  - `js/election-controller.js`: NI-wide seat aggregation now uses `_extractElected(...)` constituency logic (explicit + deemed elected)

- [x] 5) Transfer pause/play robustness hardening
  - `election-viewer-package/js/stages2.js`: added `getPauseReplayMode(...)` to re-sync icon classes and `data-mode` before action dispatch, preventing stuck pause/play button state

# Current Request (Townlands load fail, historic point dblclick, transfer pause/play)

- [x] Townlands load fail (`Failed to load ... after 0.0s`) fixed
  - symptom: immediate failure on load
  - root cause: `ni-townlands-1844-chunks.json` points to `data/maps/townlands/chunks/townlands_*.fgb`, but those files do not exist in repo
  - fix: bypass chunk mode for `ni-townlands-1844` and load stable LOD (`Townlands_AllIreland-lod1.fgb`) directly in `js/map-controller.js`
  - prevention: regenerate chunk manifest from actual chunk outputs before re-enabling chunk mode

- [x] Historic Sites point double-click feature card fix (second pass)
  - symptom: dblclick on historic point features did not open card
  - root cause: selection logic only treated geometry type strictly as `Point`
  - fix: generalized to any layer exposing `getLatLng()` and widened hit threshold to 18px
  - files: `js/map-controller.js`

- [x] Transfer animation pause/play fix (second pass)
  - symptom: pause icon remained displayed and second click did nothing
  - root cause: mode/class state path could still desync in real UI flow
  - fix: restored explicit class-toggle click logic (pause/play/repeat) before dispatching `pause()/resume()/replay()`
  - file: `election-viewer-package/js/stages2.js`

## Recurring Issue Log

- [open] Townlands chunk-manifest drift
  - symptom: chunk path references non-existent files
  - root cause: chunk index output no longer matches on-disk chunk naming
  - permanent prevention action: add build-time validation script that checks every `chunks[].file`/`zoomFiles.*.file` exists before publishing manifest
  - verification evidence: current manifest references `townlands_*.fgb` while directory contains `*-townlands_z*.fgb`

- [open] Transfer play/pause control regressions
  - symptom: repeated pause/play regressions across updates
  - root cause: multiple animation control paths and icon/mode coupling drift
  - permanent prevention action: add an automated UI state test (or deterministic unit harness) that asserts pause->icon swap->resume progression for STV animation
  - verification evidence: multiple fixes required in `election-viewer-package/js/stages2.js` across recent passes

# Current Task: Townlands + Interaction Regression Fixes

- [x] Re-enable chunked Townlands loading path in interactive map.
- [x] Verify Townlands chunk manifest integrity against on-disk files.
- [x] Fix load/unload button toggle behavior in C1/class entry controls.
- [x] Fix point-feature double-click card opening for point-like layers.
- [x] Harden transfer pause/play icon state visibility (play/pause/replay glyph + ARIA/title sync).

## Review
- Removed Townlands forced non-chunked LOD override in `js/map-controller.js`; `chunked: true` is honored again.
- Verified chunk manifest integrity: `data/maps/townlands/ni-townlands-1844-chunks.json` references 241 chunks with 0 missing files.
- Updated C1 load button handler in `js/ui-controller.js` to async-toggle with busy lock + immediate icon/state update after load/unload.
- Generalized point dblclick attachment in `js/map-controller.js` so point-like layers are clickable (not historic-only).
- Updated transfer controls in `election-viewer-package/js/stages2.js` to set explicit play/pause/replay symbols and labels.

# Current Task: Complete Regression Fix Pass (Townlands + Pause/Play + Load Toggle + Point Dblclick)

- [x] Make loaded-state check group-aware so load/unload icon toggles correctly for grouped entries.
- [x] Remove duplicate visual icon artifact on pause button while keeping pause/play state switching.
- [x] Ensure pause button can always resume from paused state even if icon class drifts.
- [x] Add remote FGB fallback for chunked/full load failures (Townlands uses Archive download URL fallback).
- [x] Increase point hit tolerance for double-click selection robustness.

## Review
- `js/app.js`: `onCheckMapLoaded` now reports group loaded state via members/variants, so `+`/`X` toggles correctly for grouped maps.
- `election-viewer-package/js/stages2.js`: removed injected unicode text on pause/play/replay (which caused duplicate visual controls) and made click dispatch state-aware (`isPaused`).
- `js/map-controller.js`: chunked/full local-load failures now retry from `mapConfig.downloads.fgb` when available.
- `js/map-controller.js`: point click/dblclick hit threshold raised from 18px to 24px.

# Current Task: Enforce Townlands Chunk-Only Interactive Loading

- [x] Remove/disable all non-chunk fallback paths for `ni-townlands-1844` interactive loading.
- [x] Keep normal fallback behavior for non-townlands chunked maps.
- [x] Preserve viewport/lazy chunk behavior (visible + nearby chunk loading).

## Review
- `js/map-controller.js`: added `enforceChunkOnly` for `ni-townlands-1844`.
- If chunk index is unavailable for Townlands, loader now fails fast (no full-file fallback).
- If chunk loading throws for Townlands, loader now fails fast (no full-file or remote-download fallback).
- Remote fallback (`downloads.fgb`) remains available only for non-townlands layers.

# Current Task: Fix Townlands Chunk Load Failure (LFS Pointer Root Cause)

- [x] Reproduce and isolate Townlands failure source from the actual load path.
- [x] Verify committed Townlands chunk blobs are real FGB bytes vs LFS pointers.
- [x] Convert Townlands chunk files to non-LFS tracked files and re-stage real bytes.
- [x] Verify committed chunk blob headers from Git object database are valid FGB magic bytes.
- [ ] Commit and push fix.

## Review (in progress)
- Root cause proven: `git cat-file -p HEAD:data/maps/townlands/chunks/townlands_0_1.fgb` returns LFS pointer text (`version https://git-lfs.github.com/spec/v1`), while working-tree file bytes are valid FGB (`66 67 62 03 ...`).
- Added `.gitattributes` exception: `data/maps/townlands/chunks/*.fgb -filter -diff -merge -text`.
- Reindexed all Townlands chunk FGBs (`git rm --cached ...` then `git add ...`) so index now contains real binary blobs.
- Index verification: 639 chunk files checked, 0 small/pointer-like blobs; sample staged blob header is valid FGB magic bytes (`66 67 62 03 66 67 62 00 ...`).

# Current Task: Restore Load/Unload Toggle Button Behavior

- [x] Trace load-button state flow from render state to click handlers and loaded-state checks.
- [x] Identify root-cause mismatches causing `+` to persist after successful map load.
- [x] Implement a centralized loaded-state resolver for map entries.
- [x] Ensure flat-view re-renders preserve real loaded-state inputs instead of resetting to empty.
- [x] Wire variant action rows to real loaded state.
- [x] Run syntax verification for updated UI controller.

## Review
- Root cause found: flat catalogue re-renders were rebuilding map entry buttons with `loadedIds: []`, forcing `isLoaded=false` and reverting buttons to `+` immediately after load.
- Additional mismatch: multiple map-entry render paths used `options.loadedIds.includes(map.id)` directly instead of callback-based loaded checks used by click handlers.
- Fix implemented in `js/ui-controller.js`:
  - Added `isMapLoadedState(mapId, options)` to centralize loaded-state checks (`onCheckMapLoaded` first, then `loadedIds` fallback).
  - Updated all map-entry render paths (`createMapCard`, class/C1/explicit-grid renderers) to use `isMapLoadedState(...)`.
  - Updated variant rows to use real loaded state instead of hardcoded `false`.
  - Preserved render options through flat-view lifecycle via `this._lastMapListOptions`.
  - `renderMapList(...)`, `setCatalogueViewMode(...)`, and `invalidateFlatView(...)` now pass stored options into `renderFlatView(...)`.
  - Removed flat-view internal reset (`const options = { loadedIds: [] }`).
- Verification: `node --check js/ui-controller.js` passes.

# Current Task: Point Feature Double-Click Card Not Opening

- [x] Trace point double-click event path from Leaflet layer events through `mapController.onFeatureClick` to `uiController.showFeatureInfo`.
- [x] Identify weak points in event propagation and point hit testing.
- [x] Implement robust point-selection handling for dblclick across loaded layers.
- [x] Verify syntax/build health of modified map controller.

## Review
- Strengthened point dblclick handling in `js/map-controller.js`:
  - Added `_emitFeatureSelection(mapId, feature)` to centralize feature-card dispatch.
  - Updated layer dblclick handler to always dispatch feature selection even if event-stop calls fail.
- Hardened map-level dblclick hit testing:
  - Increased direct point pick threshold (`32px`).
  - Added nearest-point fallback (`<=48px`) when no point is captured in strict pass.
- Verification: `node --check js/map-controller.js` passes.
