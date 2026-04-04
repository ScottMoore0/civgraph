# Repo Hotspots

This file is for fast orientation before touching an item.

## Startup and application wiring

- `js/app.js`
  - app initialization
  - service-worker registration/cleanup
  - global callbacks between UI, maps, and elections
  - likely entry point for item `01` code-splitting decisions

## Map loading and runtime performance

- `js/map-controller.js`
  - LOD selection
  - chunked loading
  - chunk concurrency
  - spatial reloads
  - runtime load metrics
  - likely entry point for items `02`, `05`, `08`, and `09`

## Election loading and heavy table logic

- `js/election-controller.js`
  - local-election bundle/aggregate preference
  - results rendering
  - table autosizing
  - likely entry point for items `01`, `02`, `04`, `06`, and `09`

## Catalogue rendering and general UI cost

- `js/ui-controller.js`
  - catalogue rendering
  - lazy-loaded thumbnails
  - search debounce
  - likely entry point for items `01`, `06`, `08`, `09`, and `11`

## Static shell and first-load assets

- `index.html`
  - head assets
  - fonts
  - icon CSS
  - manifest
  - likely entry point for item `03`

## Build and packaging

- `package.json`
  - `build`
  - `test:browser`
- `scripts/bundle.mjs`
  - likely build split and reporting integration point

## Performance-sensitive metadata

- `data/database/maps.json`
  - `useLOD`
  - `chunked`
  - `chunkLoadConcurrency`
  - safest rollout point for many map-path changes because it is often config-only

## Existing test location

- `tests/browser/`
  - browser tests already exist, but this handoff assumes the first verification layer is non-browser automation plus user manual checks

## Existing process records

- `tasks/todo.md`
  - execution log and review record
- `tasks/lessons.md`
  - recurring guardrails and prevention notes

## Strong existing precedents to preserve

- additive performance artifacts with validation and fallback
- metadata-driven rollout where possible
- pilot-first deployment for large-map performance work

