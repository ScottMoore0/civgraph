# Non-Browser Test Script Specs

This file defines the most useful scripts a later agent could add to support the first automated verification layer.

These should be implemented incrementally, not all at once.

## Script 1: bundle-size report

- suggested path:
  - `scripts/report-bundle-sizes.mjs`
- inputs:
  - build output directory
- outputs:
  - total JS bytes
  - entry JS bytes
  - total CSS bytes
  - per-file size table
- useful for:
  - item `01`
  - item `03`
  - item `10`
  - item `12`

## Script 2: startup import report

- suggested path:
  - `scripts/report-startup-imports.mjs`
- inputs:
  - `js/app.js`
- outputs:
  - direct imports
  - transitive hot-path modules
  - likely deferrable modules
- useful for:
  - item `01`

## Script 3: artifact validator

- suggested path pattern:
  - `scripts/validate-<artifact>.mjs`
- inputs:
  - candidate artifact path
- outputs:
  - schema pass/fail
  - missing fields
  - counts/sanity summary
- useful for:
  - item `04`
  - item `13`

## Script 4: pure benchmark harness

- suggested path pattern:
  - `scripts/benchmark-<target>.mjs`
- inputs:
  - fixed sample inputs
  - iteration count
- outputs:
  - mean
  - median
  - min/max
  - optional memory summary
- useful for:
  - item `02`
  - item `04`
  - item `09`
  - item `12`

## Script 5: maps metadata audit

- suggested path:
  - `scripts/report-map-performance-metadata.mjs`
- outputs:
  - maps using `useLOD`
  - maps using `chunked`
  - maps using `chunkLoadConcurrency`
  - suspicious combinations or missing assets
- useful for:
  - item `05`
  - item `13`

## Script 6: image size report

- suggested path:
  - `scripts/report-image-sizes.mjs`
- outputs:
  - per-image size
  - oversized images by threshold
  - possible conversion candidates
- useful for:
  - item `11`
  - item `12`

## Script 7: dependency usage report

- suggested path:
  - `scripts/report-dependency-usage.mjs`
- outputs:
  - dependency import sites
  - startup-path presence
  - likely removable candidates
- useful for:
  - item `10`

## Script design rules

- deterministic
- single responsibility
- machine-readable or plain text, not both mixed chaotically
- no browser automation dependency
- safe to run repeatedly
- outputs easy to paste into `tasks/todo.md`

## Recommended implementation order for the scripts

1. `report-bundle-sizes.mjs`
2. `report-startup-imports.mjs`
3. `report-map-performance-metadata.mjs`
4. one `benchmark-<target>.mjs`
5. one `validate-<artifact>.mjs`
6. `report-dependency-usage.mjs`
7. `report-image-sizes.mjs`

