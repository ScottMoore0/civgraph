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
