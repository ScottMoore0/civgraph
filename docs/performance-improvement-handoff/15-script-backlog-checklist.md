# Script Backlog Checklist

This is a practical backlog for the first non-browser automation layer.

Handoff-local equivalents of the highest-priority scripts now exist under:

- `docs/performance-improvement-handoff/scripts/`

This checklist remains useful if a later agent decides to promote proven scripts into the repo-level `scripts/` directory.

## Priority 1

- [ ] `scripts/report-bundle-sizes.mjs`
  - report entry JS, total JS, total CSS, per-file sizes
- [ ] `scripts/report-startup-imports.mjs`
  - trace startup imports from `js/app.js`
- [ ] `scripts/report-first-load-assets.mjs`
  - inventory `index.html` head assets and likely blocking resources

## Priority 2

- [ ] `scripts/report-font-usage.mjs`
  - list used font families and weights in shipped CSS/HTML
- [ ] `scripts/report-map-performance-metadata.mjs`
  - summarize `useLOD`, `chunked`, and `chunkLoadConcurrency`
- [ ] `scripts/report-dependency-usage.mjs`
  - list dependency import sites and startup-path presence

## Priority 3

- [ ] one benchmark harness
  - `scripts/benchmark-<target>.mjs`
- [ ] one artifact validator
  - `scripts/validate-<artifact>.mjs`
- [ ] `scripts/report-image-sizes.mjs`
  - inventory image dimensions and bytes

## For each script

- [ ] deterministic output
- [ ] single responsibility
- [ ] safe repeated runs
- [ ] output easy to paste into `tasks/todo.md`
- [ ] no browser automation dependency

## Recommended first implementation order

1. `report-bundle-sizes.mjs`
2. `report-startup-imports.mjs`
3. `report-first-load-assets.mjs`
4. `report-font-usage.mjs`
5. `report-map-performance-metadata.mjs`
6. `report-dependency-usage.mjs`
