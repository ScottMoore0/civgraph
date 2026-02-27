# Current Task: Fix Dáil / Referendum / Super Census / MEP Label Metadata (2026-02-27)

- [x] Correct the interactive label fields for 1998 and 2005 Dáil constituencies
- [x] Fix missing referendum and 2001 super census labels by adding the correct explicit label metadata
- [x] Remap 2009 European Parliament constituency labels to Dublin / East / South / North-West / Northern Ireland
- [x] Verify JS/metadata integrity and record review notes

## Review
- Symptom: 1998/2005 Dáil labels were sourced from the wrong field, several referendum/counting-area clone maps had no usable labels, 2001 super census units lacked labels, and the 2009 MEP map showed source council names instead of constituency names.
- Root cause: some map entries pointed at the wrong source attribute (`CONST_NAME` instead of `CON_NAME`), several clone-based entries were missing explicit `labelProperty` metadata entirely, and the 2009 MEP source field contained county/council names that needed a deterministic value remap rather than a different field selection.
- Permanent prevention action: clone entries that are intended to label like their base maps should carry their own explicit `labelProperty` in metadata, and when source attributes are semantically wrong-but-stable, use one centralized label cleanup/remap hook instead of hardcoding UI exceptions.
- Verification evidence: `node --check js/map-controller.js` passes, `data/database/maps.json` now contains explicit label metadata for the affected Dáil/referendum/super-census entries, and `js/map-controller.js` now supports metadata-driven `mapValues` label cleanup used by `mep-2009`.

# Current Task: ROI Settlements 2015 Naming And Cross-Border Nearest-Distance Ranking (2026-02-27)

- [x] Update the ROI Settlements metadata so the main catalogue entry shows as 2015 rather than Ungeneralised
- [x] Compute nearest-settlement distances across NI Settlements 2015 and ROI Settlements 2015 and rank all features descending by nearest-neighbour distance
- [x] Record the methodology and verification notes

## Review
- Symptom: the ROI Settlements layer appeared in the catalogue as `Ungeneralised` with no year, and there was no ranked cross-border nearest-settlement analysis for the NI and ROI 2015 layers.
- Root cause: the ROI map entry had no `date`, retained a source-file-oriented `name`, the ROI settlements class was not treated as year-based for class-member display, and the first nearest-neighbour pass accidentally excluded all same-source comparisons because temporary extracted rows did not carry stable feature IDs.
- Permanent prevention action: any new map entry intended to behave like an existing dated series must include the same minimum metadata contract (`name`, `date`, class participation, and year-based display handling); for one-off comparative analyses, persist the output artifact, state the computational method explicitly, and never use nullable source IDs as self-skip keys when doing nearest-neighbour passes.
- Verification evidence: `data/database/maps.json` now sets the ROI settlements map to `Settlements 2015` with `date: 2015`, `js/ui-controller.js` includes `roi-settlements` in `yearBasedClasses` and sets the ROI flat card years to `2015`, `node --check js/ui-controller.js` passes, and the corrected ranked nearest-neighbour output was written to `_tmp_settlement_distance/settlements_2015_nearest_ranked_corrected.csv`.

# Current Task: Feature-Instance Labels And Feature UI Readability (2026-02-27)

- [x] Restore labels for individually loaded features on the map
- [x] Improve active-layers child feature readability so names are not visually obscured or truncated
- [x] Increase individual-feature page action button/icon sizing so controls are clearly legible
- [x] Verify JS/CSS integrity and record root cause/prevention action

## Review
- Symptom: individually loaded features rendered without labels, active-layer child feature entries were hard to read and truncated, and feature-page action icons were too small to see reliably.
- Root cause: the single-feature load path explicitly disabled label registration (`registerLabels: false`), active-layer child rows reused cramped compact styling with forced truncation, and feature-detail actions reused generic small icon-button sizing meant for denser card surfaces.
- Permanent prevention action: feature-instance render paths must not diverge silently from full-layer behavior for labels, active-layer child rows need their own readable layout rather than inheriting compact list-item constraints, and detail-page action strips need explicit sizing rules instead of relying on generic small-button utilities.
- Verification evidence: `node --check js/map-controller.js` and `node --check js/ui-controller.js` pass; `js/map-controller.js` now registers labels for single-feature loads when no base layer labels exist, and the updated selectors are present in `assets/css/main.css`.

# Current Task: Add Republic Of Ireland Settlements Card (2026-02-27)

- [x] Convert `Settlements_Ungeneralised_-6398853129460496398.geojson` into an FGB layer for interactive loading
- [x] Add a new `Settlements` class/card for `Republic of Ireland` containing only the ROI settlements layer
- [x] Insert the ROI Settlements entry directly below the existing Northern Ireland Settlements entry in the flat catalogue / TOC
- [x] Verify the new metadata wiring and record review notes

## Review
- Symptom: the catalogue had a Northern Ireland `Settlements` card only, with no Republic of Ireland counterpart or TOC entry.
- Root cause: there was no ROI settlements class or map metadata in `data/database/maps.json`, and the flat catalogue ordering in `js/ui-controller.js` only declared the NI Settlements card.
- Permanent prevention action: ROI-only catalogue additions should be treated as a full metadata path change, not just a UI insertion: create the map entry, create the class, add it to the category class list, and then place the flat card explicitly in the ordered `c1Cards` array.
- Verification evidence: converted the supplied GeoJSON into `data/maps/physical/Settlements_ROI_Ungeneralised.fgb` (4,862,024 bytes), `node --check js/ui-controller.js` passes, and the new `roi-settlements` / `roi-settlements-ungeneralised` metadata paths are present in `data/database/maps.json`.

# Current Task: Additive Feature-Instance Controls On Feature Pages (2026-02-27)

- [x] Make feature-page load/unload work additively even when the full parent layer is already loaded
- [x] Add feature-page show/hide controls alongside the existing share/download controls
- [x] Keep active-layers feature child entries available for both partial-only maps and full maps with additive feature instances
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: individual feature loading previously reused the old partial-layer model, which meant a feature load could not coexist cleanly with an already-loaded full parent map.
- Root cause: `loadSingleFeature()` returned early whenever a full layer state already existed, and active-layer child rendering treated `partial` as both the storage model and the UI model for feature children.
- Permanent prevention action: feature loading is now additive within the existing map state, full-map loads can promote an existing feature-only state instead of being blocked by it, and active-layer feature child rows are driven by actual loaded feature instances rather than by `isPartial` alone.
- Verification evidence: `node --check js/map-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; feature pages now render load/unload and show/hide controls tied to feature-instance callbacks.

# Current Task: Map Detail Action Strip Parity (2026-02-27)

- [x] Replace the map-detail-page single `Load Map` / `Unload Map` button with the same action strip used on catalogue cards
- [x] Reuse shared action rendering and binding rather than duplicating button logic
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: map detail pages still used a standalone load/unload CTA while the main catalogue cards had a richer shared action strip.
- Root cause: map-detail rendering had a separate legacy action path instead of reusing the same map-action renderer/binder used by catalogue cards.
- Permanent prevention action: map action controls now route through shared `renderMapActionStrip(...)` and `bindMapActionStrip(...)` helpers so catalogue cards and map detail pages share one interaction contract.
- Verification evidence: `node --check js/ui-controller.js` and `node --check js/app.js` pass; map-detail templates no longer emit the legacy single `catalogue-detail__load-btn` button.

# Current Task: Feature-Page Share And Download Actions (2026-02-27)

- [x] Add a shareable URL button to individual feature pages
- [x] Add on-demand single-feature downloads for GeoJSON, JSON, CSV, and FlatGeobuf
- [x] Make copied feature URLs resolve back to the same feature page after reload
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: individual feature pages had no direct way to copy a feature-specific URL or download only that feature in lightweight formats or FGB.
- Root cause: feature-detail rendering stopped at presentation only; there was no shared feature-detail registration/export path, and URL restoration only understood map-layer state.
- Permanent prevention action: feature detail entries now flow through a shared cache helper, feature exports are generated from that same cached source-of-truth object, and URL restoration understands `featureMap` / `featureId` / `featureName` hash state instead of relying on ephemeral in-memory UI state.
- Verification evidence: `node --check js/ui-controller.js`, `node --check js/map-controller.js`, and `node --check js/app.js` pass; feature pages now render share/download controls and URL state restoration has a dedicated feature-detail branch.

# Current Task: Persistent Sticky Catalogue Controls And Non-Resetting Navigation (2026-02-27)

- [x] Make search bar and catalogue nav controls sticky at the top of the catalogue pane across list/detail/feature pages
- [x] Make Home act as "go to main catalogue page" unless already there, in which case it becomes "return to top"
- [x] Keep back/forward controls persistent and stop resetting catalogue history when returning to the main catalogue page
- [x] Correct the sticky-shell control-row layout so search and nav render on one desktop row
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: search/navigation controls scrolled away on detail/feature pages, the Home action reset navigation state, and back/forward were not persistent across returning to the main catalogue page.
- Root cause: catalogue controls were embedded in scrollable page content rather than a persistent sticky shell, and the history model treated “return to list” as a full reset instead of a navigable `list` state.
- Permanent prevention action: the catalogue now has a sticky control shell, history includes explicit `list` entries alongside `detail` and `feature-detail`, the Home button state is derived from current catalogue context instead of being a separate floating return-top control, and the sticky shell uses explicit desktop grid tracks with a deliberate mobile fallback so the search field and nav controls do not drift into stacked rows.
- Verification evidence: `node --check js/ui-controller.js` passes, stale references to the old return-top button were removed, and the sticky shell/search/nav CSS now enforces a single-row desktop layout.

# Current Task: Remove Redundant Feature-Page Back Button (2026-02-27)

- [x] Remove the `Back to Catalogue` button from individual feature pages
- [x] Leave navigation responsibility with the persistent sticky Home/back/forward controls

## Review
- Symptom: individual feature pages still rendered a local `Back to Catalogue` button even after the sticky Home/back/forward controls took over that responsibility.
- Root cause: `showFeatureDetailInCatalogue()` still emitted the legacy back button and click handler after catalogue navigation had been centralized in the sticky control shell.
- Permanent prevention action: feature-page navigation should come only from the persistent sticky controls; feature-detail templates should not duplicate list-navigation affordances once a shared nav shell exists.
- Verification evidence: the feature-detail template in `js/ui-controller.js` no longer emits `catalogueBackLink`, and no feature-detail-specific back-button handler remains.

# Current Task: Feature Detail History And Smooth Table-Row Camera Motion (2026-02-27)

- [x] Extend catalogue history so feature detail pages participate in back/forward navigation
- [x] Make feature-table row focus use smooth animated map travel instead of abrupt snapping
- [x] Keep feature-name links and map-layer info pages reversible through the existing nav buttons
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: feature detail pages did not participate in catalogue back/forward history, and table-row map focus snapped abruptly to the target feature.
- Root cause: catalogue history stored only `detail` map-page entries, and the bbox zoom hook only used immediate `fitBounds()` behavior.
- Permanent prevention action: catalogue history now supports explicit `feature-detail` entries, feature-detail back behavior reuses history when available, and smooth row-focus travel routes through `flyToBounds()` via the shared bbox zoom hook.
- Verification evidence: `node --check js/ui-controller.js` and `node --check js/app.js` both pass.

# Current Task: Feature-Table Row Interaction And Feature Detail Links (2026-02-27)

- [x] Inspect feature-table rendering and existing feature zoom/highlight/detail hooks
- [x] Make every feature-table row clickable to zoom to and highlight its feature
- [x] Make the feature name cell a link to the individual feature info page in the left pane
- [x] Verify syntax and record the root cause/prevention action

## Review
- Symptom: feature rows in the catalogue feature table were passive text only, with no direct path to focus a feature on the map or open its left-pane detail page.
- Root cause: the feature-table renderer only emitted static cells and had no integration with the existing feature zoom/highlight/detail selection pipeline.
- Permanent prevention action: feature-table rendering now creates feature metadata/IDs from the same source feature objects used elsewhere, rows dispatch to `focusFeatureFromTable()`, and feature-name cells route through the existing `showFeatureDetailInCatalogue()` cache path.
- Verification evidence: `node --check js/ui-controller.js`, `node --check js/map-controller.js`, and `node --check js/app.js` all pass.

# Current Task: Prevent Filter Menu Viewport Clipping (2026-02-27)

- [x] Inspect current Excel-style filter menu placement logic
- [x] Make menu choose above or below anchor based on available viewport space
- [x] Apply the fix to both election tables and catalogue feature tables
- [x] Verify syntax and record the root cause

## Review
- Symptom: the Excel-style sort/filter menu was clipped off the bottom of the browser window.
- Root cause: both menu implementations always positioned the menu below the trigger button with a fixed `rect.bottom + 4` top value.
- Permanent prevention action: both menu implementations now measure viewport space and place the menu below when it fits, otherwise above; horizontal position is also clamped within the viewport.
- Verification evidence: `node --check js/ui-controller.js` and `node --check js/election-controller.js` both pass.

# Current Task: Full-Dataset Sort/Filter For Catalogue Feature Tables (2026-02-27)

- [x] Inspect current feature-attribute table loading/rendering path and compare against election-results sort/filter controls
- [x] Replace DOM-snapshot sort/filter behavior with full-dataset feature-table state
- [x] Keep feature-table sort/filter UI aligned with the election-results pane UI
- [x] Verify sorting/filtering acts on all features, not only initially rendered rows

## Review
- Symptom: feature-attribute table sort/filter only acted on the initially rendered subset of rows.
- Root cause: `loadAttributeSchema()` attached Excel-like controls to a partial DOM snapshot while the table body kept lazy-appending more rows outside that control state.
- Permanent prevention action: the feature-attribute table now uses the full feature array as the source of truth for sort/filter state, while DOM rendering is only a paged view of that full filtered/sorted dataset.
- Verification evidence: `node --check js/ui-controller.js` passes, and the implementation now computes sort/filter options and visible rows from `state.allFeatures`, not from the currently rendered DOM rows.

# Current Task: Restore Mean Elevation (2026-02-26)

- [x] Diagnose why Mean Elevation disappeared
  - Root cause: `meanElev_m` / `meanElev_ft` were missing from current map data files.
- [x] Restore valid map binaries before backfill
  - Restored `data/maps` from `HEAD` after accidental LFS-pointer working-tree state.
- [x] Backfill `meanElev_m` and `meanElev_ft` across map datasets
  - Ran `python scripts/backfill-mean-elevation.py --root data/maps`.
- [x] Verify in representative files
  - Confirmed `meanElev_m` and `meanElev_ft` now exist in sample layers (`LGD_2012`, `PC2023`, townlands chunk sample).
- [x] Harden backfill script for future runs
  - Updated `scripts/backfill-mean-elevation.py` to force stable output layer names using `path.stem`.

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

# LFS Cleanup Pass (2026-02-26)

- [x] Audit LFS-tracked files and sizes
  - verified all current `.fgb` files are below 100MB
- [x] Verify rollback safety artifacts before migration
  - confirmed backup bundle/mirror/snapshot and safety tag existence
- [x] Convert `.fgb` tracking from Git LFS to regular Git blobs
  - updated `.gitattributes` from `*.fgb filter=lfs ...` to `*.fgb -filter -diff -merge -text`
  - re-indexed all tracked `.fgb` files so staged blobs are full binary (not LFS pointers)
- [ ] Commit and push cleanup
  - pending user confirmation after final verification summary

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

# Root-Cause Pass (Latest): Zoomed-Out Dblclick Still Missing Feature Card

- [x] Precise root cause
  - hover highlight is renderer-level (`mouseover`/`mouseout`) and can still be valid while Leaflet dblclick target dispatch is flaky at low zoom
  - selection relied on map/layer dblclick paths only; no capture-phase guarantee bound to current hover state

- [x] Permanent fix
  - added capture-phase map-container `dblclick` fallback in `js/map-controller.js` (`_handleContainerDblClick`)
  - on dblclick, if a hover candidate exists, selection now emits directly from that exact feature (`_emitFeatureSelection`)
  - unified hover-candidate selection in `handleMapClick` to use `_emitFeatureSelection` (single deduped source of truth)

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Orange Hover Persisted But Selection Expired

- [x] Symptom
  - point remained orange-highlighted, but dblclick did not open feature card when zoomed out

- [x] Precise root cause
  - hover selection candidate used time expiry (`<=2500ms`) for active hover while orange state itself did not expire
  - this created a logic mismatch: visually hovered point could be rejected by selection path

- [x] Permanent fix
  - removed time-expiry gate for active hovered point in `_getHoverSelectionCandidate`
  - active hovered point is now accepted based on proximity only
  - kept short-lived timed fallback only for `last hovered` (hover flicker between clicks)

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Hover Orange Still Not Selecting At Low Zoom

- [x] Symptom
  - feature remains orange-hovered but double-click does not open feature card unless zoomed in

- [x] Root cause
  - active-hover selection still had a second geometric gate (`activeDistPx <= hoverSelectPx`)
  - this made orange-hover eligibility and selection eligibility non-identical

- [x] Permanent prevention action
  - removed distance/time gating for active hovered point in `_getHoverSelectionCandidate`
  - active orange hover now selects by identity (exact hovered layer/feature) as source of truth
  - kept only bounded, timed fallback for `last hovered` to cover hover flicker between clicks
  - clear hover candidates when layers are hidden/unloaded to avoid stale references

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Active Hover Lost Between Dblclick Events

- [x] Symptom
  - orange hover visible, but zoomed-out dblclick still intermittently fails to open feature card

- [x] Root cause
  - low-zoom pointer jitter can fire `mouseout` between the two clicks of a dblclick
  - active hover candidate was cleared immediately on `mouseout`, dropping selection from identity path into stricter fallback path

- [x] Permanent prevention action
  - added active-hover grace window in `js/map-controller.js`:
    - new `_activeHoverGraceMs` (1800ms)
    - on `mouseout`, keep active hovered feature alive until `expiresAt`
    - on `mouseover`, set active candidate `expiresAt = Infinity`
  - `_getHoverSelectionCandidate` now respects `expiresAt` before clearing active candidate

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Orange Highlight State Still Diverged From Dblclick Selection

- [x] Symptom
  - cursor position produced orange highlight, but double-click still failed at low zoom

- [x] Root cause
  - dblclick selection still depended on hover candidate resolution paths that could diverge under jitter/flicker
  - no direct selection path from the actual set of currently orange-highlighted point layers

- [x] Permanent prevention action
  - introduced `this._highlightedPointLayers` as explicit source-of-truth for orange-highlighted points
  - `_setFeatureHover` now maintains this set on `mouseover`/`mouseout`
  - `_handleContainerDblClick` now first selects nearest currently highlighted point via `_selectHighlightedPointAt(clickPoint)`
  - fallback hover/geometric logic remains as secondary path only

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Unify Hover Highlight and Dblclick Selection Source

- [x] Symptom
  - orange highlight appears, but dblclick still intermittently fails at low zoom

- [x] Root cause
  - hover style and selection continued to rely on different event lifecycles/state transitions
  - low-zoom event churn (`mouseover`/`mouseout`) caused divergence between visible hover and dblclick target resolution

- [x] Permanent prevention action
  - introduced shared geometric resolver for point-under-cursor:
    - `_resolvePointUnderCursor(containerPoint, zoom)`
    - used for hover via map `mousemove`
  - added single source-of-truth hovered point layer:
    - `_currentHoverLayer`
    - maintained by `_setCurrentHoverLayer(...)`
  - dblclick/click selection now first selects `_currentHoverLayer` directly
  - point-layer per-feature hover handlers disabled to avoid conflicting hover ownership
  - clear hover source-of-truth when map/layer hides/unloads

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Stability Hardening: Disable Competing Legacy Point Selection Paths Under V2

- [x] Symptom
  - recurring regressions persisted because legacy per-layer/map selection handlers continued to run alongside V2 hover/selection logic

- [x] Root cause
  - multiple concurrent event pipelines (layer click/dblclick, map click/dblclick, container dblclick) could conflict under low-zoom jitter

- [x] Permanent prevention action
  - added `this._pointSelectionV2` feature flag (default `true`)
  - disabled legacy point-layer selection handlers in `_attachHistoricPointDblClick` when V2 is enabled
  - disabled legacy map click/dblclick selection handlers when V2 is enabled
  - `_handleContainerDblClick` now serves as primary deterministic point-selection entrypoint:
    1) current hover layer
    2) shared point-under-cursor resolver
    3) bounded hover fallbacks
    4) non-point geometric fallback via `handleMapClick`

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): V2 Still Depended On Native Dblclick Delivery

- [x] Symptom
  - point feature cards still failed intermittently at low zoom, despite unified resolver and legacy handler disablement

- [x] Root cause
  - with V2 enabled, point selection still depended primarily on native container `dblclick`
  - on some low-zoom interaction paths, native `dblclick` is not reliably emitted

- [x] Permanent prevention action
  - added synthetic dblclick detection on container capture `click` events:
    - second click within bounded time/pixel window triggers the same point-selection entrypoint
  - added shared `_selectPointFromInteraction(clickPoint)` used by both native and synthetic dblclick paths
  - reset synthetic click-pair state on container mouseleave

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Synthetic Dblclick Fallback Was Short-Circuited

- [x] Symptom
  - low-zoom dblclick still failed even after adding click-pair fallback

- [x] Root cause
  - `_handleContainerClick` returned early on `evt.detail >= 2`
  - second click of an actual double-click has `detail = 2`, so synthetic path never executed at the critical event

- [x] Permanent prevention action
  - removed `evt.detail >= 2` early-return in `_handleContainerClick`
  - synthetic click-pair detector now evaluates both clicks and can fire on second click as intended
  - rely on `_emitFeatureSelection` dedupe to prevent duplicate card opens when native `dblclick` also fires

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Click/Dblclick Events Still Suppressed Under Low-Zoom Jitter

- [x] Symptom
  - feature-card opening still intermittently failed on low-zoom double-click despite click-pair fallback

- [x] Root cause
  - on some interaction paths with slight drag/jitter, browser/Leaflet may suppress `click`/`dblclick`
  - synthetic fallback on `click` alone was insufficient in those suppression cases

- [x] Permanent prevention action
  - added capture-phase `pointerup` pair detector as an additional synthetic dblclick trigger
  - both synthetic paths (`click` pair and `pointerup` pair) now route to shared `_selectPointFromInteraction`
  - reset pointer pair state on container mouseleave

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Synthetic and Native Selection Paths Were Asymmetric

- [x] Symptom
  - low-zoom point selection still failed intermittently even with synthetic click/pointerup pair fallback

- [x] Root cause
  - native container dblclick path applied highlighted/candidate fallbacks
  - synthetic click/pointerup pair paths only used current-hover + geometric resolver and skipped those fallbacks
  - behavior diverged depending on which trigger path fired

- [x] Permanent prevention action
  - unified all point trigger paths through one complete resolver:
    - `_selectPointFromInteraction(clickPoint)` now includes:
      1) current hover layer
      2) shared point-under-cursor resolver
      3) highlighted-layer fallback
      4) hover-candidate fallback
  - `_handleContainerDblClick` now relies on that shared resolver only before non-point fallback

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

# Current Task: Single Measured Teardown/Rebuild of Point Interaction Contract

- [x] Audit all active point-interaction entrypoints and remove competing paths.
- [x] Rebuild to one deterministic double-activate contract with shared resolver.
- [x] Instrument hover->select->emit flow with explicit trace events.
- [x] Verify syntax and provide runtime trace hook for surgical debugging.

## Review
- `js/map-controller.js` interaction contract was simplified:
  - removed capture `click` pair path from active pipeline (kept native `dblclick` + synthetic `pointerup` pair only)
  - both trigger paths now route through one `_handlePointDoubleActivate(...)` entrypoint
  - one shared selector `_selectPointFromInteraction(clickPoint, source)` now owns point selection order
- Added instrumentation:
  - `window.__bwPointInteractionDebug` trace buffer
  - trace stages include: `hover-change`, `double-activate`, `select-current-hover`, `select-resolved-point`, `select-point-miss`, `emit-selection`, `emit-deduped`, `native-dblclick-skipped-after-synthetic`
- Verification:
  - `node --check js/map-controller.js` passes.

# Current Task: Tie Double-Click Selection Directly To Orange Hover State

- [x] Add an explicit hover-armed feature state set only when a point is orange-highlighted.
- [x] Make double-activate selection consume the armed feature first.
- [x] Clear armed state on hover loss, map-container mouseleave, and map unload/hide cleanup.
- [x] Verify syntax for map interaction controller.

## Review
- `js/map-controller.js` now maintains `_armedHoverPoint` as the strict interaction contract:
  - set on point hover-on (`hover-armed-set`)
  - cleared on point hover-off and container mouseleave (`hover-armed-cleared`)
  - cleared in `_clearHoverCandidatesForMap(...)` when layers/maps are hidden/unloaded
- `_selectPointFromInteraction(...)` now selects `_armedHoverPoint` first (`select-armed-hover`) before any other resolver path.
- Verification:
  - `node --check js/map-controller.js` passes.

# Current Task: Local Instrumented Debug Session Pipeline

- [ ] Add local HTTP debug endpoint that appends browser interaction events to a log file.
- [ ] Wire client runtime logger for point interaction, feature-selection emit, and JS errors.
- [ ] Run local server with file logging and capture repro traces from user interaction.
- [ ] Read captured log and apply surgical fix from first failing stage only.

# Current Task: Dark Theme Consistency (System vs Manual Toggle)

- [x] Identify why initial dark mode differed from toggled dark mode.
- [x] Unify system dark token values with manual `[data-theme="dark"]` tokens.
- [x] Make startup always set explicit `data-theme` from saved preference or system preference.
- [x] Verify JS syntax after theme initialization change.

## Review
- Root cause: two different dark palettes existed (`@media (prefers-color-scheme: dark)` vs `[data-theme="dark"]`), so startup/system-dark and toggled-dark could render differently.
- `assets/css/main.css` system-dark token block now matches manual dark tokens exactly.
- `js/app.js` now always sets `document.documentElement.dataset.theme` on startup (`saved theme` or `system dark/light`), preventing mixed-mode startup.

# Current Task: Deploy Consistency Fix (Last File Skip + Stale SW Cache)

- [x] Fix deploy workflow so incremental sync cannot skip the last changed file.
- [x] Fix upload/delete count logic to count non-empty lines reliably.
- [x] Add stale service-worker cleanup when `/sw.js` is absent on host.

## Review
- `.github/workflows/deploy.yml` now:
  - writes upload/delete lists with trailing newline when non-empty,
  - uses `while read ... || [ -n \"$filepath\" ]` to process final line,
  - uses non-empty-line counts for upload/delete totals.
- `js/app.js` now checks `/sw.js` with `HEAD` before registering; if absent, it unregisters existing service workers to prevent stale cached asset serving.

# Current Task: Feature Card Property Contrast In Light Mode

- [x] Identify low-contrast styles in feature-info properties block under light mode.
- [x] Apply explicit high-contrast light-mode overrides for summary, property container, keys, and values.

## Review
- `assets/css/main.css` now includes targeted light-mode contrast overrides for:
  - `.feature-info__summary`
  - `.feature-info__properties`
  - `.feature-info__property`
  - `.feature-info__key`
  - `.feature-info__value`

# Current Task: Postmortem - Protracted Point-Feature Card Fix Loop

- [x] Review why repeated fixes failed to close the defect quickly.
- [x] Identify concrete process faults that prolonged resolution.
- [x] Add permanent process guardrails in `tasks/lessons.md`.

## Review
- Why it took too long:
  - Multiple interaction paths existed simultaneously (native dblclick, synthetic click/pointer paths, hover fallbacks), so partial fixes improved one path while another still failed.
  - Changes were repeatedly committed before proving the exact user acceptance path on runtime evidence (orange hover -> dblclick -> emitted selection -> feature card render).
  - Early passes relied on inferred causes and static checks (`node --check`) instead of decisive instrumentation and trace-based failure localization.
  - Deployment/cache effects introduced additional ambiguity during validation.
- Permanent prevention:
  - Added hard “runtime proof gate” and “max-attempt escalation” lessons to force instrumentation-first diagnosis and controlled teardown/rebuild earlier.

# Current Task: Transfer Pause/Resume Stuck Until Stage Click

- [x] Root-cause pass on pause/resume behavior in `election-viewer-package/js/stages2.js`.
- [x] Implement deterministic resume recovery for interrupted in-flight transfer rounds.
- [x] Clear stale pending-transfer flags that block normal resume updates.
- [x] Verify syntax integrity.

## Review
- Root cause: pausing during in-flight transfer slices could leave round state mid-transition; resume attempted to continue from inconsistent state and appeared stuck until a manual stage click rebuilt the round.
- Fix:
  - added `pendingResumeStep` tracking in pause/resume flow
  - when paused with active transfer slices, resume now auto-runs `playStep(interruptedRound)` before restarting interval
  - clears stale `.data('pendingTransfer'/'pendingTransferRound')` flags on bars during pause cleanup
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up (Pause Did Not Freeze In-Flight Stage)
- [x] Add paused-state guards to asynchronous callbacks/timers so stage progress cannot continue while paused.
- [x] Expand pause freeze to stop all in-flight animation nodes under `#animation`.

### Follow-up Review
- Root cause: icon/mode toggled correctly, but asynchronous callbacks and timer-based status updates could still complete stage-side effects after pause.
- Fix:
  - Added `if (isPaused || !running) return;` guards in key async callbacks/timer handlers.
  - Pause now calls `$("#animation *").stop(true, false)` to freeze all in-flight animation elements, not just selected classes.
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up 2 (Forum Animation Pause Path)
- [x] Apply equivalent pause-freeze/resume behavior in forum animation controller path.

### Follow-up 2 Review
- Root cause: forum controller `stopAuto()` only stopped interval progression and did not freeze in-flight frame animation.
- Fix:
  - added `state.pausedMidFrame` tracking in forum animation state
  - `stopAuto({ freezeFrame: true })` now stops in-flight bar animations and clears deferred timers
  - `startAuto()` now resumes interrupted frame from frozen midpoint before continuing interval cadence
  - non-pause navigation actions (`step`, `again`, stage click) call `stopAuto({ freezeFrame: false })`
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up 3 (Pause Toggle Drift Between Icon and Runtime Flags)
- [x] Switch pause/play click routing to paused-state-first logic in both STV and forum paths.

### Follow-up 3 Review
- Root cause: pause/play routing still relied on `running`/`playing` in branches where those flags could drift from actual paused intent, causing icon toggles without reliable freeze semantics.
- Fix:
  - forum path now tracks explicit `state.isPaused` and click handler toggles on that state
  - STV path click handler now toggles on `isPaused` (except repeat mode), not on `running`/icon combinations
  - STV `pause()` guard simplified back to `if (isPaused) return;` to keep a single source of truth
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

# Current Task: Transfer Pause Crash Root Cause (.filter missing in shim)

- [x] Perform root-cause pass on why pause repeatedly fails despite state-machine changes.
- [x] Add `.filter()` support to `js/jquery-shim.js`.
- [x] Harden STV `pause()` to avoid dependency on shim `.filter()` in critical path.
- [x] Verify syntax integrity after patch.

## Review
- Symptom:
  - Pause click did not reliably change to play/freeze in place; behavior looked like only next-stage progression was blocked.
- Root cause:
  - `pause()` in `election-viewer-package/js/stages2.js` called `$("#animation .votes").filter(...)`.
  - custom shim `js/jquery-shim.js` did not implement `.filter()`, causing a runtime exception inside `pause()` after interval clear but before `isPaused=true` and icon/state freeze updates.
- Fix:
  - implemented `.filter(selectorOrFn)` in `js/jquery-shim.js` returning a new `$Set`.
  - rewrote `pause()` active-slice collection to use `.each(...)` + native array removal, so pause critical path no longer depends on shim `.filter()`.
- Verification evidence:
  - `node --check js/jquery-shim.js` passes.
  - `node --check election-viewer-package/js/stages2.js` passes.

# Current Task: NI-wide Results "By Local Party" Tab

- [x] Add `By Local Party` tab in NI-wide election results pane header.
- [x] Implement NI-wide local-party table renderer (party + constituency tuple aggregation).
- [x] Replace candidate status with `Elected` column formatted as `X/Y` per tuple.
- [x] Sort rows by first-preference votes descending (highest rank first, lowest last).
- [x] Keep existing table controls/sorting wiring.

## Review
- Updated `js/election-controller.js`:
  - `_setupNIWideTabs` now includes `{ id: 'local-party', label: 'By Local Party' }`.
  - `_renderNIWideView` now routes `local-party` to `_buildNIWideLocalPartyTable()`.
  - Added `_buildNIWideLocalPartyTable()` to aggregate candidate rows by `(constituency, party)`:
    - votes = sum of first-count candidate votes for tuple
    - stood (`Y`) = count of candidates in tuple
    - elected (`X`) = elected candidates in tuple (including deemed-elected logic consistent with existing candidate table path)
  - Added `_localPartyKey()` utility for stable previous-election delta matching.

### Follow-up (True Freeze/Resume Instead of Slice Removal)
- [x] Replace pause teardown behavior that removed transfer slices and forced stage replay.
- [x] Implement true in-place freeze by pausing shim animation clock.
- [x] Ensure resume continues current in-flight transfer animations from paused position.
- [x] Ensure manual controls (`replay/step/again/jump`) clear paused clock state.

### Follow-up Review
- Root cause:
  - prior pause logic removed active transfer slices and resume advanced stage scheduler, which made rectangles disappear and skipped to next stage.
- Fix:
  - `js/jquery-shim.js`: animation loop now respects `window.__evAnimationPaused` and freezes RAF progression in-place.
  - `election-viewer-package/js/stages2.js`:
    - STV `pause()` now sets `window.__evAnimationPaused = true` and does not remove slices.
    - STV `resume()` clears paused flag and restarts interval without forcing immediate `advanceCount()` or `playStep(...)`.
    - forum `stopAuto/startAuto` now use same paused-clock flag for freeze/resume consistency.
    - manual controls explicitly clear paused-clock state.
- Verification evidence:
  - `node --check js/jquery-shim.js` passes.
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up (By Local Party columns)
- [x] Changed Elected column to show elected count only.
- [x] Added Stood column immediately left of Elected.

# Current Task: Copernicus DEM Coverage, Sea Mask, and Layer Ordering

- [x] Fix DEM tile generation so sea is excluded and only land is rendered.
- [x] Regenerate Copernicus DEM tile set with land-mask applied.
- [x] Align DEM map config min zoom with available tile pyramid.
- [x] Ensure DEM renders below vector layers by pane z-index.
- [x] Assess feasibility of user-reorderable active layer stacking.

## Review
- `scripts/build-copernicus-dem-tiles.py` updated:
  - added land-mask support using `data/maps/physical/Ireland.fgb`
  - rasterizes land polygons per tile and clears alpha outside land
  - added `--land-mask` and `--no-land-mask` options
- Copernicus tile set regenerated:
  - output: `data/maps/physical/copernicus-dem-30m-ireland-tiles`
  - metadata now reports 290 written tiles, with sea-only tiles skipped
- `data/database/maps.json` updated:
  - `copernicus-dem-30m-ireland.rasterStyle.minZoom` changed `0 -> 5` (matches available/generated zoom pyramid)
- `js/map-controller.js` updated:
  - Copernicus pane z-index lowered to `250` so vector layers stay above DEM

### Follow-up (Remaining Kerry/NE DEM gaps + drag-handle doc)
- [x] Eliminate remaining coastal DEM gaps by generating full tile matrix (including transparent empty tiles).
- [x] Add markdown design note for draggable Active Layers handles.

### Follow-up Review
- Root cause of remaining visual gaps:
  - coastal/edge tiles could be physically absent when empty tiles were skipped, producing missing-tile holes at coastlines under some view/zoom combinations.
- Fix:
  - `scripts/build-copernicus-dem-tiles.py` now supports `--include-empty-tiles`.
  - Copernicus tile pyramid regenerated with full matrix (`skip_empty=False`) and land mask still enforced.
  - New metadata: `tilesWritten=539`, `tilesSkippedEmpty=0`.
- Documentation:
  - added `docs/active-layers-drag-handle-design.md` covering UX, ordering model, rendering strategy, and verification checklist.


### Follow-up (Copernicus disappears at high zoom)
- [x] Raised Copernicus raster display max zoom from 13 to 20 while keeping maxNativeZoom=10.
- [x] This preserves visibility at deep zoom by overzooming z10 tiles instead of hiding the layer.


### Follow-up (Coastal sliver gaps from mask sampling)
- [x] Changed DEM land-mask rasterization to all_touched=True to keep coast-edge pixels.
- [x] Regenerated Copernicus tiles with full matrix + updated mask behavior.
- [x] Verified each zoom (5..10) has a complete rectangular XYZ matrix with zero missing tile files.

### Follow-up Verification (Latest Regeneration)
- Tile build command:
  - `python scripts/build-copernicus-dem-tiles.py --src data/maps/physical/copernicus-dem-30m-ireland.tif --tile-dir data/maps/physical/copernicus-dem-30m-ireland-tiles --min-zoom 5 --max-zoom 10 --include-empty-tiles --force`
- Build output:
  - `Done. Wrote 539 tiles`
  - `metadata.json`: `tilesWritten=539`, `tilesSkippedEmpty=0`
- Matrix completeness check:
  - z5: 1/1, missing 0
  - z6: 4/4, missing 0
  - z7: 9/9, missing 0
  - z8: 30/30, missing 0
  - z9: 99/99, missing 0
  - z10: 396/396, missing 0

### Follow-up (GDAL CLI NoData fill for persistent on-land gaps)
- [x] Installed/validated GDAL CLI runtime (`gdal.exe`).
- [x] Filled NoData in source DEM using GDAL `raster fill-nodata`.
- [x] Rebuilt Copernicus tiles from filled DEM.
- [x] Verified previous NE/Kerry gap windows no longer contain masked pixels.

### Follow-up Review (GDAL fill pass)
- Fill command:
  - `gdal.exe raster fill-nodata -i data/maps/physical/copernicus-dem-30m-ireland.tif -o data/maps/physical/copernicus-dem-30m-ireland.filled.tif --overwrite -d 5000 -s 1 -f GTiff --co COMPRESS=DEFLATE --co PREDICTOR=2 --co TILED=YES`
- Tile rebuild command:
  - `python scripts/build-copernicus-dem-tiles.py --src data/maps/physical/copernicus-dem-30m-ireland.filled.tif --tile-dir data/maps/physical/copernicus-dem-30m-ireland-tiles --min-zoom 5 --max-zoom 10 --include-empty-tiles --force`
- Verification evidence:
  - Formerly failing windows now show `masked=0`:
    - NE1 `(-6.206667,54.277778,-5.78,54.562222)`
    - NE2 `(-5.78,54.277778,-5.353333,54.562222)`
    - KERRY1 `(-10.473333,52.002222,-10.046667,52.286667)`
    - KERRY2 `(-10.046667,52.002222,-9.62,52.286667)`
  - Tile matrix still complete at z5..z10 with zero missing files in each zoom bbox.

### Follow-up (DEM horizontal striping artifact)
- [x] Identified incorrect DEM reprojection resampling mode.
- [x] Changed tile reprojection from `nearest` to `bilinear`.
- [x] Rebuilt Copernicus tile pyramid from filled DEM source.

### Follow-up Review (Striping fix)
- Root cause:
  - `scripts/build-copernicus-dem-tiles.py` used `Resampling.nearest` when reprojecting continuous elevation into XYZ tile grid.
  - At low zoom this introduced aliasing/striping bands that do not reflect real terrain.
- Fix:
  - Changed resampling to `Resampling.bilinear` for DEM reprojection.
  - Regenerated all Copernicus tiles (z5..z10, full matrix).

# Current Task: Risk-Minimized LFS Cleanup Execution

- [x] Create immutable backups (`git bundle`, mirror clone, filesystem snapshot of `data/maps`).
- [x] Create safety refs before cleanup (`pre-lfs-cleanup-*` tag and `safety/pre-lfs-cleanup-*` branch).
- [x] Validate rollback fidelity with checksum verification against snapshot.
- [x] Apply clean push path from true GitHub `origin/main` baseline.
- [x] Push Townlands monolith removal commit without uploading bulk LFS changes.
- [x] Reconcile local workspace to pushed `origin/main` while preserving local pre-sync state.

# Current Task: Restore Mean Elevation

- [ ] Re-apply lost mean-elevation backfill changes from safety commit `44723e0` onto `main`.
- [ ] Verify feature-card rendering includes `Mean Elevation` between min/max in universal metrics.
- [ ] Verify representative map files contain `meanElev_m` and `meanElev_ft` attributes.
- [ ] Commit and push restoration to `origin/main`.

## Review
- Backup artifacts created under:
  - `backups/20260226-222514/`
  - includes `full.bundle`, `mirror.git`, and `data-maps-snapshot`.
- Safety refs created:
  - tag: `pre-lfs-cleanup-20260226-222514`
  - branch: `safety/pre-lfs-cleanup-20260226-222514`
- Verification evidence:
  - snapshot checksum match confirmed (`LGD_2012.fgb`).
- Clean remote push performed from isolated clone based on true `origin/main`:
  - commit `a00fbbf`
  - message: `Use IA direct download for Townlands monolith and keep chunked interactive loading`
  - push succeeded to `main`.
- Local reconciliation:
  - preserved branch: `safety/local-pre-sync-20260226-222514`
  - local `main` reset to `origin/main` (`a00fbbf`).

# Current Task: Add Party And Candidate Info Pages In Election Results Pane (2026-02-27)

- [ ] Add clickable party-name and candidate-name links across the election results tables
- [ ] Add election-pane info pages for parties keyed by exact party name
- [ ] Add election-pane info pages for candidates keyed by `Candidate_Id`
- [ ] Preserve the current results view so users can navigate back from an entity info page
- [ ] Verify JS integrity and record review notes
# Current Task: Add Party And Candidate Info Pages In Election Results Pane (2026-02-27)

- [x] Add clickable party-name and candidate-name links across the election results tables
- [x] Add election-pane info pages for parties keyed by exact party name
- [x] Add election-pane info pages for candidates keyed by `Candidate_Id`
- [x] Preserve the current results view so users can navigate back from an entity info page
- [x] Verify JS integrity and record review notes

## Review
- Symptom: party names and candidate/person names in the election results pane were plain text only, with no way to open a party-level or person-level info page from the tables.
- Root cause: the election results pane had no shared entity-detail abstraction at all; each table renderer emitted raw text cells and the controller only understood two navigation modes, NI-wide summary and constituency view.
- Permanent prevention action: party/candidate cells now route through a single `renderElectionEntityLink(...)` helper, entity data is built from one centralized `_getElectionEntityIndex()` aggregation pass, and entity-detail navigation restores the exact prior results view via `_currentResultsView` / `_entityDetailReturnView` instead of each table inventing its own back path.
- Verification evidence: `node --check js/election-controller.js` passes; `js/election-controller.js` now contains `_openElectionEntityDetail(...)`, `_showConstituencyPanel(...)`, `_getElectionEntityIndex(...)`, and link rendering hooks in the NI-wide party/candidate/local-party tables plus constituency party/count tables; `assets/css/main.css` now contains `election-entity-link` and `election-entity-page` styling for the new results-pane detail pages.
# Current Task: Move Election Party/Candidate Info Pages Into Catalogue Pane And Broaden Them Across All Election Data (2026-02-27)

- [x] Move party/candidate link targets from the results pane into the catalogue pane
- [x] Aggregate party/candidate detail data across all available election datasets, not only the currently loaded election
- [x] Fix blank candidate detail behavior by routing links through the catalogue pane detail system instead of the results pane renderer
- [x] Verify JS integrity and record review notes

## Review
- Symptom: clicking a party/candidate link in the results pane rendered entity details in the wrong pane, and candidate clicks such as Nicola Brogan could yield a blank-looking right-pane state instead of a usable detail page.
- Root cause: the first implementation attached a brand-new entity-detail renderer to the election results pane instead of reusing the catalogue pane, which already owns detail-page rendering and back/forward history; it also scoped aggregation to the currently loaded election rather than the full election dataset.
- Permanent prevention action: election table links now delegate to an app-level callback that opens catalogue-pane entity pages, catalogue history now supports a dedicated `election-entity-detail` entry type, and party/candidate detail data is sourced from one global cached election-entity index built across all election JSONs rather than from whichever election happens to be loaded.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; `js/election-controller.js` now exposes `getElectionEntityDetail(...)` and `_loadGlobalElectionEntityIndex()`, `js/app.js` wires `electionController.onOpenEntityDetail` to `uiController.showElectionEntityDetailInCatalogue(...)`, and `js/ui-controller.js` now renders/stores `election-entity-detail` pages in the catalogue history stack.
# Current Task: Plan Expanded Party/Person Election Info Pages (2026-02-27)

- [x] Define the target data model for party history rows, person history rows, latest-summary metrics, and election-link behavior
- [x] Break implementation into atomic stages with explicit inputs, outputs, and verification points
- [x] Identify residual risks for each stage and attach a prevention guardrail before implementation starts

## Implementation Plan

### Stage 0: Freeze the behavioral contract before coding
- Objective:
  - lock the requested behavior into one explicit implementation contract so later code changes do not drift
- Inputs:
  - user decisions already given in chat
- Output:
  - one canonical contract for:
    - party history row key = `(elected body, date, party)`
    - include by-elections
    - party rank = seats desc, then votes desc
    - latest result = latest election contested by that party
    - person latest election = literal latest appearance by date
    - person status strings = `Elected Count X/Y`, `Excluded Count X/Y`, `Not Elected Count X/X`
    - person history shows both overall ordinals and body-specific ordinals
    - party history includes uncontested elections only up to the last election that party did contest
    - party-page election links load the election only
    - person-row election links load the election and open the relevant constituency
    - party/person pages remain in the catalogue pane
- Verification:
  - compare the contract line-by-line against the user’s answers before implementation
- Risk:
  - hidden ambiguity survives into implementation
- Guardrail:
  - no coding against “assumed behavior”; every derived field must map back to one explicit contract line above

### Stage 1: Add shared election timeline helpers
- Objective:
  - create one reusable timeline helper layer before touching rendering
- Inputs:
  - election index from `elections_index.json`
- Output:
  - helper functions for:
    - normalizing body/date tuples
    - sorting elections chronologically
    - formatting election display names:
      - year only if unique within body/year
      - month + year if same body has multiple elections in that year
      - full date only if month-year still collides
    - building stable election keys
- Verification:
  - deterministic output for known edge cases like February/October 1974 Westminster and February/October 1973 Assembly
- Risk:
  - inconsistent election naming across party pages, person pages, and links
- Guardrail:
  - one formatter only; no page renderer may assemble election labels directly

### Stage 2: Build a canonical all-elections party/person index
- Objective:
  - replace ad hoc page-level aggregation with one shared global derived dataset
- Inputs:
  - all election JSON payloads across all bodies and dates
- Output:
  - one cached index containing:
    - `partyElectionRows`
    - `partyLifetimeSummaries`
    - `candidateAppearances`
    - `candidateLifetimeSummaries`
    - `electionPartyRollups`
    - `electionSeatTotals`
- Required fields for each party election row:
  - body
  - date
  - party
  - election display name
  - by-election/general election context
  - candidates stood
  - constituencies contested
  - first-preference votes
  - valid-vote percentage
  - candidates elected
  - total seats available
  - seat percentage
  - rank
  - contested flag
- Required fields for each candidate appearance:
  - `Candidate_Id`
  - candidate name
  - party at that election
  - body
  - date
  - constituency
  - first-preference votes
  - valid-vote percentage
  - final votes
  - count position/status
  - elected boolean
- Verification:
  - row counts match expected counts from raw appearances
  - no candidate with valid `Candidate_Id` is dropped
  - no party row collapses two different dates for the same body
- Risk:
  - duplicated aggregation logic or key collisions
- Guardrail:
  - one builder function owns all lifetime aggregation; all renderers consume only its output

### Stage 3: Compute per-election party rankings and totals
- Objective:
  - derive stable rank/seat/vote metrics once, centrally
- Inputs:
  - canonical party-election rows from Stage 2
- Output:
  - per-election ranking tables keyed by `(body, date)`
  - seat totals summed across the full election
  - party rank assigned by:
    - seats won descending
    - first-preference votes descending
    - party name ascending as final deterministic tie-break
- Verification:
  - each election ranking is contiguous and deterministic
  - total available seats equals the sum of constituency seat counts in that election
- Risk:
  - different pages compute “rank” differently
- Guardrail:
  - rank is computed only in this stage and stored as data, never recomputed during rendering

### Stage 4: Fill uncontested party rows up to last contested election
- Objective:
  - produce the timeline behavior requested for party pages
- Inputs:
  - complete election timeline by body/date
  - party contested rows from Stage 2
- Output:
  - completed party history rows including:
    - contested elections
    - uncontested elections up to the last contested election
    - `did not contest` marker rows in italicized-display state
- Explicit stop rule:
  - do not include elections after the last election the party contested
- Verification:
  - sample a party with gaps and confirm missing contests are shown only before its final contested election
- Risk:
  - over-filling the timeline with irrelevant future zero rows
- Guardrail:
  - timeline completion must be bounded by the party’s last contested election date before rendering

### Stage 5: Compute latest Westminster and Assembly summaries for parties
- Objective:
  - derive the four headline party metrics requested
- Inputs:
  - completed party history
- Output:
  - latest contested Westminster row per party
  - latest contested Assembly row per party
  - display metrics:
    - MPs at latest contested Westminster election + date
    - last Westminster result %
    - MLAs at latest contested Assembly election + date
    - last Assembly result %
- Display rules:
  - counts default to `0`
  - date/result fields default to `N/A` where no such contest exists
- Verification:
  - for a sample party with no Westminster contests, counts show `0` and percentage/date show `N/A`
- Risk:
  - accidentally using latest election of the body rather than latest election contested by the party
- Guardrail:
  - latest-summary selectors must filter by party-contested rows first, then choose the latest date

### Stage 6: Compute candidate lifetime sequences and ordinals
- Objective:
  - derive the requested person-page chronology cleanly
- Inputs:
  - candidate appearances from Stage 2
- Output:
  - per-candidate chronological history sorted by date ascending for ordinal assignment
  - each row gains:
    - overall standing ordinal
    - overall elected ordinal where applicable
    - body-specific standing ordinal
    - body-specific elected ordinal where applicable
  - latest appearance snapshot for the top summary
- Verification:
  - cumulative counts increase exactly by one on each appearance
  - elected ordinals increase only on elected rows
- Risk:
  - ordinal drift due to sorting inconsistency
- Guardrail:
  - assign ordinals only after one canonical chronological sort and persist them into the derived row objects

### Stage 7: Compute party candidate rollups
- Objective:
  - build the “list of candidates in descending order of number of times elected”
- Inputs:
  - candidate lifetime summaries
  - party membership across appearances
- Output:
  - per-party candidate summary list sorted by:
    - times elected descending
    - total first preferences descending
    - candidate name ascending as deterministic tie-break
  - include never-elected candidates with elected count `0`
- Verification:
  - candidates with zero wins still appear
  - party-switching candidates contribute to each relevant party page based on appearances under that party
- Risk:
  - party-switching candidates being attributed globally rather than per party
- Guardrail:
  - candidate rollups on a party page must be built from appearances under that exact party name only

### Stage 8: Replace current catalogue election entity renderer with expanded page builders
- Objective:
  - upgrade the left-pane person/party pages to the requested content model
- Inputs:
  - finalized derived data from Stages 2-7
- Output:
  - party page sections:
    - summary metrics
    - election history table
    - candidate ranking list/table
  - person page sections:
    - latest election summary
    - full election history table with overall/body-specific ordinals
- Verification:
  - pages render with non-empty content for known examples
  - no blank detail pages for sample candidates like Nicola Brogan
- Risk:
  - page renderers reaching back into raw data and bypassing the canonical derived model
- Guardrail:
  - renderer input must be pre-derived detail objects only; raw election JSON access from renderers is disallowed

### Stage 9: Add election links from entity pages back into the election map/results pane
- Objective:
  - make election-name links load the corresponding election while keeping the person/party page in the catalogue pane
- Inputs:
  - stable `(body, date)` election keys
  - optional constituency from person history rows
- Output:
  - party-page election link behavior:
    - load election if not already loaded
    - if already loaded, just switch results context
  - person-page election row behavior:
    - load election
    - open relevant constituency in the results pane
- Verification:
  - clicking a party row loads the election without losing the catalogue pane entity page
  - clicking a person row opens the correct constituency
- Risk:
  - election loads replacing the catalogue detail page or desynchronizing pane states
- Guardrail:
  - catalogue pane rendering must remain independent from election-pane rendering; use app-level callbacks, not direct DOM replacement inside the election pane

### Stage 10: Add shareable URLs for party and person pages
- Objective:
  - make the new entity pages deep-linkable like feature pages
- Inputs:
  - stable entity keys
  - catalogue history/detail IDs
- Output:
  - URL state for:
    - party detail pages
    - person detail pages
  - restore logic that:
    - opens the correct catalogue entity page
    - preserves election state if included in the URL
- Verification:
  - refresh on a party/person URL restores the same page
- Risk:
  - URL state collisions with existing map/feature/election hash parameters
- Guardrail:
  - extend the existing URL schema minimally and restore through one central branch rather than parallel ad hoc parameters

### Stage 11: Add targeted defensive validation before any visual QA
- Objective:
  - catch structural mistakes before clicking around manually
- Inputs:
  - derived data builders and renderers
- Output:
  - targeted assertions / debug checks for:
    - no duplicate party election keys
    - no duplicate candidate appearance keys for same `(Candidate_Id, body, date, constituency)`
    - no missing election display name
    - no null latest-election row for candidates with appearances
    - no uncontested party rows after final contested date
- Verification:
  - all checks pass in development
- Risk:
  - regressions reappear as silent content gaps or blank pages
- Guardrail:
  - block completion if any structural validation fails

### Stage 12: Manual verification matrix before completion
- Objective:
  - prove the behavior works for representative real cases
- Required manual QA set:
  - one party with Westminster + Assembly history
  - one party with gaps / uncontested elections
  - one party with no Westminster history
  - one candidate elected multiple times
  - one candidate never elected
  - one candidate with latest appearance in a by-election
  - Nicola Brogan path specifically
- Verification checklist:
  - no blank catalogue page
  - summary metrics populated correctly
  - uncontested rows stop at last contested election
  - election links load correct election
  - person election-row links open the correct constituency
  - back/forward still work in catalogue pane
- Risk:
  - declaring complete on syntax-only confidence
- Guardrail:
  - do not mark complete until the manual QA matrix is actually exercised

## Risk Summary

### Main risks
- Wrong aggregation key leading to merged/distorted party history
- Wrong chronology leading to broken standing/elected ordinals
- Wrong latest-election selector leading to incorrect headline metrics
- UI drift between election pane and catalogue pane
- Blank or sparse pages from renderer access to incomplete raw data

### Risk removal strategy
- Centralize all derivation in one canonical all-elections index
- Centralize election display-name formatting
- Persist rank/ordinal/status values as derived data before rendering
- Keep catalogue-pane detail rendering separate from results-pane loading
- Add structural assertions before manual QA
- Use a fixed manual verification matrix before completion
# Current Task: Implement Expanded Election Party/Person Info Pages (2026-02-27)

- [x] Build one canonical all-elections derived index with election timeline metadata, party election rows, and candidate chronological appearances
- [x] Expand party pages in the catalogue pane with latest Westminster/Assembly metrics, election history, and candidate rankings
- [x] Expand person pages in the catalogue pane with latest-election summary and full election history including overall/body-specific ordinals
- [x] Keep election links in the catalogue pane while loading the selected election into the interactive map/results pane
- [x] Verify JS integrity and record review notes

## Review
- Symptom: the first party/person catalogue pages were too shallow, were scoped only to currently loaded election data, and did not provide the requested cross-election history, latest body-specific metrics, or catalogue-to-election link behavior.
- Root cause: the earlier implementation stopped at a lightweight lifetime aggregate and a generic table renderer; it did not yet have a canonical election timeline model, per-election party rollups, chronological candidate ordinals, or a dedicated catalogue-to-election callback contract.
- Permanent prevention action: all party/person rendering now consumes one centralized all-elections index with explicit election metadata, per-election party rollups, and chronological candidate appearance rows; catalogue-pane election links route through one app-level callback that loads/switches election context without replacing the entity page itself.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; `js/election-controller.js` now contains `_buildElectionTimeline(...)`, enriched `_finalizeEntityIndex(...)`, and public `ensureElectionLoaded(...)` / `showConstituency(...)` / `showSummary()` helpers; `js/ui-controller.js` now renders expanded party/person election-history pages with link hooks; `js/app.js` now wires catalogue election links back into the election controller.
# Current Task: Refine Party Info Page Metrics And Tables (2026-02-27)

- [x] Restyle party MP/MLA summary metrics so dates sit below the headline numbers in smaller muted text
- [x] Replace cross-election total first-pref metrics with latest Westminster/Assembly vote totals
- [x] Remove the redundant party metadata table from the party page
- [x] Change election and candidate controls in party tables to text links, update constituency formatting, and rename constituency column
- [x] Reorder and expand the party candidate table with stood/elected/body-specific columns and constituency lists
- [x] Ensure by-elections render as `by-election` in election names
- [x] Verify JS integrity and record review notes

## Review
- Symptom: the first expanded party page still showed the wrong summary metrics, retained a redundant metadata table, used button-like styling where text links were requested, and lacked the fuller candidate standing/election breakdown and constituency formatting the user specified.
- Root cause: the earlier renderer had been built to validate the broader data model first, so it still exposed generic metric cards and a minimal candidate summary rather than the exact requested party-page presentation contract.
- Permanent prevention action: party-page summary cards now support stacked value/subtext rendering, party history rows now carry `totalConstituencies` for `X/Y` formatting, by-election naming is derived in the shared election display-name helper, and party candidate summaries now include stood/elected rollups by Westminster vs devolved bodies from the canonical derived index rather than being inferred at render time.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; `js/election-controller.js` now emits `totalConstituencies` and expanded `candidateSummaries` fields, and `js/ui-controller.js` now renders the revised party metrics/history/candidate table contract.

# Current Task: Handle North Antrim Recall Petition As A Special Event (2026-02-27)

- [x] Detect the `2018-08-29` North Antrim Westminster record as a recall petition, not a by-election
- [x] Provide a dedicated synthetic results payload for the petition event because the normal constituency JSON payload is absent
- [x] Render only North Antrim in a reddish fill, keep other constituencies blank, and suppress seat indicators entirely
- [x] Replace normal election tabs/results with a recall-petition overview and North Antrim detail view only
- [x] Verify JS integrity and record review notes

## Review
- Symptom: the election index contained `2018-08-29` under Westminster with only `North Antrim`, so the UI treated it like a one-seat by-election even though there was no constituency results JSON and the event was actually a recall petition.
- Root cause: the election pipeline assumed any single-constituency Westminster event was an election/by-election and had no explicit model for non-election constitutional events that reuse constituency geography but do not have party/candidate count data.
- Permanent prevention action: `js/election-controller.js` now has an explicit special-event configuration path for the `2018-08-29` North Antrim recall petition, including dedicated display naming, synthetic payload data using the official EONI figures, blank-vs-highlight constituency styling, a red map label instead of seat indicators, and a dedicated tabular results renderer that avoids party tabs and transfer animation.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check assets/css/main.css`-related JS consumers pass; the controller now contains `_getSpecialElectionConfig(...)`, `_showRecallPetitionOverview(...)`, `_showRecallPetitionPanel(...)`, `_buildRecallResultsTable(...)`, and `_buildRecallIncumbentTable(...)`, and the normal colouring/overlay/results flows branch away from generic election handling for this event.

### Recurrence note
- Symptom: non-participating constituencies in by-election/recall views lost their neutral grey fill and became fully transparent.
- Root cause: the recall-petition refactor changed the default election geography layer style to transparent instead of preserving the neutral base fill and only overriding the special-event highlight.
- Permanent prevention action: the base election geography style now stays neutral grey by default, and special-event styling only overrides the featured constituency while preserving the grey baseline for all others.
- Verification evidence: `js/election-controller.js` default `L.geoJSON` style again uses a muted grey fill/opacity, and the recall `else` branch also explicitly uses the same grey baseline instead of transparency.

### Follow-up refinement
- Symptom: the recall-petition over-map label and overview pane diverged from the established map-label and results-pane contracts.
- Root cause: the first special-event implementation used a bespoke label style and put too much summary content into the overview pane instead of reserving the tabular results for the clicked constituency view.
- Permanent prevention action: the recall label now reuses the same inline styling contract as normal interactive-map labels, and the overview pane is reduced to the title plus notes while the actual results remain only in the constituency detail view.
- Verification evidence: `js/election-controller.js` recall overlay now uses the same `text-shadow`/centered wrapping style as `js/map-controller.js` labels, and `_showRecallPetitionOverview(...)` no longer renders the removed metric/meta/results/incumbent blocks.

### Correction note
- Symptom: the previous refinement removed the recall results and incumbent MP tables as well, which was broader than requested.
- Root cause: I collapsed “remove the summary boxes” into “strip the overview down to notes only” instead of preserving the tabular content that still belonged in the pane.
- Permanent prevention action: when a user asks to remove specific UI blocks, preserve all unspecified content and remove only the named elements; for the recall overview this means the summary boxes stay out, but the results and incumbent tables remain.
- Verification evidence: `_showRecallPetitionOverview(...)` in `js/election-controller.js` now renders `Results` and `Incumbent MP` sections again while still omitting the removed Threshold/Signed/Result/click-note/Outcome blocks.

### Follow-up refinement
- Symptom: election-history and candidate rows in the catalogue-pane entity pages were still rendered as buttons instead of links.
- Root cause: the earlier “text link” pass only changed the visual styling class and left the underlying elements as `<button>` controls.
- Permanent prevention action: the catalogue entity renderer now emits anchor elements for election/entity navigation and suppresses default browser navigation in the click handler so the in-app pane/history behavior stays unchanged.
- Verification evidence: `showElectionEntityDetailInCatalogue()` in `js/ui-controller.js` now renders `<a href=\"#\">` for both election links and entity links, and their handlers call `event.preventDefault()` before dispatching the existing callbacks.
# Current Task: Refine Election Entity Tables For Party And Person Pages (2026-02-27)

- [x] Reorder party election-history columns and split out `Number of constituencies`
- [x] Add same-body delta columns for party election-history metrics, including rank delta
- [x] Style by-election rows in party/person election-history tables as italic and slightly smaller
- [x] Add Excel-style sort/filter controls to party history, party candidates, and person election-history tables
- [x] Verify syntax and record review notes

## Review
- Symptom: the party election-history table still used the older column order and `X/Y` constituency display, had no change-versus-previous-election columns, by-election rows were not visually distinct, and the party/person entity tables did not support the same Excel-style sort/filter controls used elsewhere.
- Root cause: party history rows were derived as one-off summary rows without previous-same-body comparison fields, and the entity pages still rendered fixed HTML tables with direct per-cell event bindings instead of using a reusable client-side table state path.
- Permanent prevention action: derive all previous-election deltas centrally in `js/election-controller.js`, render entity tables through reusable table helpers in `js/ui-controller.js`, use delegated link handling on the detail container so sort/filter re-renders do not silently break election/entity links, and compute by-election deltas against the prior result restricted to the same affected constituency subset rather than against whole-election totals.
- Verification evidence: `js/election-controller.js` now derives `stoodDelta`, `electedDelta`, `constituenciesContestedDelta`, `firstPrefsDelta`, `validVotePctDelta`, `totalSeatsDelta`, `seatPctDelta`, and `rankDelta` with constituency-scoped by-election baselines; `js/ui-controller.js` now initializes filterable/sortable entity tables for party history, party candidates, and candidate history; `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass.
# Follow-up Correction: Bound Party History Rows By First Contested Election (2026-02-27)

- [x] Exclude elections before a party first stood for a given body from that party's election-history table
- [x] Verify syntax and record the guardrail

## Review
- Symptom: party info pages still showed early elections as `did not contest` even when those elections occurred before the party had ever first stood for that body.
- Root cause: the party history timeline was bounded only by the last contested election for each body, not also by the first contested election.
- Permanent prevention action: when rendering a party-lifespan timeline, bound the generated rows between both the first and last contested elections for that body before inserting internal `did not contest` gaps.
- Verification evidence: `js/election-controller.js` now tracks `firstContestedByBody` and `lastContestedByBody` and filters `entry.historyRows` between those bounds; `node --check js/election-controller.js` passes.
# Follow-up Correction: Election Entity Tables Sticky Layout, Comparison Buckets, And Constituency Feature Links (2026-02-27)

- [x] Make entity-table header rows sticky vertically within their tables and first columns sticky horizontally
- [x] Change previous-election comparisons to use bucketed body groups (`devolved`, `Westminster`, `European`) and constituency-scoped by-election baselines
- [x] Add constituency map-year labels and constituency feature links to comma-separated constituency lists, with elected constituencies first and bolded
- [x] Add conditional European Parliament stood/elected columns to party candidate tables
- [x] Verify syntax and record review notes

## Review
- Symptom: entity tables did not keep context while scrolling, election deltas still compared too narrowly by exact body, constituency lists lacked map-year context and did not link to the actual feature detail pages, and party candidate tables did not expose European Parliament stood/elected counts.
- Root cause: sticky behavior had not been added to the catalogue entity-table surface, the derived comparison logic still keyed on exact body instead of comparison groups and constituency-specific prior results, constituency lists were flattened to plain strings too early, and candidate summaries did not retain European-specific counters or feature-navigation metadata.
- Permanent prevention action: keep election-comparison semantics in the derived model with explicit comparison buckets and constituency subsets, retain constituency display data as structured entries until final render, and treat scroll-heavy catalogue tables as a dedicated sticky-table surface with shared CSS rather than ad hoc table markup.
- Verification evidence: `js/election-controller.js` now derives comparison buckets, map-layer years, constituency entry metadata, and European stood/elected rollups; `js/ui-controller.js` now renders constituency feature links and conditional European columns; `assets/css/main.css` now makes entity-table headers and first columns sticky; `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass.
# Follow-up Correction: Preserve User Fill Transparency Across Feature Hover (2026-02-27)

- [x] Make feature hover-out restore respect the current user-adjusted fill transparency
- [x] Update the shared layer base-style snapshot when the Fill Transparency slider changes
- [x] Verify syntax and record the guardrail

## Review
- Symptom: after the user adjusted fill transparency, hovering a feature and moving the mouse away reset that feature's fill toward the old opacity instead of preserving the slider-selected value.
- Root cause: hover-out restored from a stale cached style snapshot, while the Fill Transparency slider only updated the live Leaflet layer style and not the cached base style used for hover restore.
- Permanent prevention action: any user-controlled visual style change must update both the live layer style and the canonical base-style snapshot used by transient interactions such as hover/highlight restore.
- Verification evidence: `js/map-controller.js` now uses `_baseStyle` / `_hoverRestoreStyle` for hover restoration and updates those snapshots inside `setFillTransparency(...)`; `node --check js/map-controller.js` passes.
