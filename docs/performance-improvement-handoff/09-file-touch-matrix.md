# File Touch Matrix

This matrix is for fast scoping. It does not mean every file must change.

## Item 01: Code-Splitting

- primary:
  - `js/app.js`
  - `scripts/bundle.mjs`
  - `package.json`
- possible:
  - `js/election-controller.js`
  - `js/ui-controller.js`

## Item 02: Web Workers

- primary:
  - `js/map-controller.js`
  - `js/election-controller.js`
  - `js/app.js`
- likely new:
  - `js/workers/*`
  - `scripts/benchmark-*.mjs`

## Item 03: Critical-Path Payload Reduction

- primary:
  - `index.html`
  - `assets/css/*`
  - `assets/fonts/*`
- possible:
  - `scripts/bundle.mjs`
  - `package.json`

## Item 04: Precomputed Artifacts

- primary:
  - `js/election-controller.js`
  - `scripts/*`
  - artifact directories under `data/`
- possible:
  - `js/data-service.js`

## Item 05: Adaptive LOD And Chunking

- primary:
  - `js/map-controller.js`
  - `data/database/maps.json`
- possible:
  - chunk-manifest or derived-map asset paths
  - reporting scripts

## Item 06: Virtualization

- primary:
  - `js/ui-controller.js`
  - `js/election-controller.js`
  - `assets/css/*`
- possible:
  - helper modules for virtual window logic

## Item 07: Caching And Versioning

- primary:
  - `js/app.js`
  - service-worker-related assets/scripts
  - build output naming in `scripts/bundle.mjs`
- possible:
  - `index.html`

## Item 08: CSS Containment

- primary:
  - `assets/css/*`
  - `js/ui-controller.js`
  - `js/election-controller.js`

## Item 09: Interaction Batching

- primary:
  - `js/map-controller.js`
  - `js/ui-controller.js`
  - `js/time-slider-controller.js`
  - `js/election-controller.js`

## Item 10: Dependency Trimming

- primary:
  - `package.json`
  - imports in `js/*`
  - `scripts/bundle.mjs`

## Item 11: Image Pipeline

- primary:
  - `assets/thumbnails/*`
  - image-generation scripts
  - `js/ui-controller.js`
- possible:
  - `index.html`

## Item 12: Performance Budgets

- primary:
  - `package.json`
  - `scripts/*`
  - build/report configuration

## Item 13: Combined Verification

- primary:
  - mostly reports and task records
  - no product-code changes unless a combined regression is discovered

