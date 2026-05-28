# Civgraph /test to Main Promotion Checklist

This checklist defines the non-data and data gates for replacing the current
Leaflet map surface with the `/test` MapLibre surface while retaining the main
top navbar and left catalogue workflow.

## Required Architecture

- Keep the main Civgraph top navbar, support modal, theme system, and route
  links.
- Keep the left catalogue-first workflow: users choose maps in the catalogue,
  and the interactive map updates on the right.
- Replace Leaflet map runtime operations with MapLibre sources, layers,
  expressions, feature-state, PMTiles, image overlays, and vector-tile indexes.
- Do not promote FGB/chunked client loading as the primary runtime path.
- Do not restore thumbnail-heavy catalogue browsing on mobile.

## Non-Data Gates

- `npm run check:test` passes.
- `npm run check:test:ci` passes in CI or an equivalent deployment-safe profile.
- Diagnostics shows a readable production-readiness summary, deploy checklist,
  service-worker cache status, and no unexplained warning groups.
- Preference import/export/reset/device-default flows pass browser tests.
- Accessibility smoke coverage passes the built-in axe-style checks and
  screen-reader-oriented DOM pass.
- Browser regression coverage passes for:
  - shell/navigation startup,
  - support modal,
  - theme toggle,
  - catalogue keyboard flow,
  - URL restore,
  - PMTiles fallback warnings,
  - mobile portrait and landscape sidebar,
  - source/reference/download panels,
  - selected-feature details,
  - layer controls and ordering.
- `/test` service worker remains scoped to `/test/`.
- Generated directory tile pyramids remain excluded from Cloudflare Pages output.
- PMTiles and heavy generated outputs are served from CDN/R2, not Pages.
- PMTiles byte-range monitoring is green.
- Known tile-budget warnings are either resolved or explicitly accepted for
  promotion with documented mobile test evidence.

## Data Gates

- All main catalogue entries that should be interactive are converted to
  PMTiles/vector tiles or registered as suitable raster/image overlays.
- Every converted vector layer has:
  - valid bounds,
  - a source layer,
  - label metadata where labels are expected,
  - feature index where feature search is expected,
  - source/provider/credit metadata,
  - download/reference metadata where available.
- Time-series chains have multiple converted layers before the time-series UI is
  presented as production-complete.
- Election workflows have converted geographies and result joins before election
  choropleths are presented as production-complete.

## Cutover Steps

1. Freeze conversion input data and regenerate PMTiles, feature indexes, and
   metadata.
2. Upload PMTiles and generated assets to CDN/R2.
3. Verify byte-range responses for every PMTiles URL.
4. Run `npm run check:test`, `npm run check:test:ci`, and browser tests.
5. Run representative mobile smoke tests on heavy layers.
6. Confirm Cloudflare Pages output remains below file-count and file-size
   limits.
7. Promote the MapLibre shell route while preserving main navbar/catalogue URL
   semantics where possible.
8. Keep the Leaflet route available only as a temporary rollback path until
   post-cutover verification is complete.

## Supporting Runbooks

- `test/metadata/rollback-runbook.md`
- `test/metadata/cutover-pr-checklist.md`
- `test/metadata/cdn-cache-invalidation-procedure.md`
- `test/metadata/security-dependency-review.md`
- `test/metadata/production-observability.md`

## Rollback Conditions

- PMTiles byte-range requests fail on production CDN.
- Mobile browser crashes or repeatedly exceeds load budgets on converted heavy
  layers.
- Catalogue entries disappear instead of being shown as unavailable/not
  converted.
- Feature selection/search/labels regress for core boundary layers.
- Cloudflare Pages deployment approaches the 20,000-file cap again.
