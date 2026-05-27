# /test production readiness checklist

Use this checklist before promoting the MapLibre rewrite from `/test` into the main Civgraph route.

## Required checks

- `npm run build:test`
- `npm run check:test`
- `npm run verify:test:pmtiles-cdn`
- `npm run smoke:test:mobile`
- `npm run test:browser:test`
- `npm run check`
- `npm run build`

## CDN and cache discipline

- Regenerated PMTiles and directory MVT outputs must use CDN/R2 as the authoritative serving path.
- Run `npm run build:test:cdn-manifest` after metadata or generated archive changes.
- Run `npm run deploy:test:pmtiles` after generated PMTiles changes.
- Run `npm run verify:test:pmtiles-cdn` after upload and before switching metadata.
- Keep `test/pmtiles/generated/*.pmtiles` out of Git.
- Bump `TEST_ASSET_VERSION`, `test/index.html` bundle query strings, and `TEST_CACHE_VERSION` together for every `/test` runtime change.
- Treat `test/metadata/cdn-range-report.json` as evidence that PMTiles byte ranges, CORS origin handling, `Content-Length`, and `Content-Range` are working.

## Runtime readiness

- Diagnostics must show zero hard errors and only acknowledged budget warnings.
- PMTiles fallback warnings must be visible if CDN archives fail and directory MVT fallback is used.
- The all-layer mobile smoke must load every converted PMTiles layer under the configured timing budgets.
- The source/reference/download panel must expose credits, references, downloads, and technical tile links for active layers.
- URL state must restore active layers, viewport, selected feature, labels, opacity, and style state.

## Main-site parity target

- Keep the main Civgraph top navigation and catalogue-first workflow.
- Keep the left catalogue pane as the primary map selection surface.
- Replace Leaflet-only rendering with the MapLibre controller; do not port Leaflet layer internals.
- Preserve catalogue completeness by showing unconverted main-site maps as unavailable rather than hiding them.
- Preserve source/provider credit conventions, especially OSI/OSNI/CSO style credits.

## Rollback

- Because `/test` is scoped under its own service worker, rollback is primarily a route/deployment decision.
- If PMTiles CDN serving regresses, directory MVT fallback can keep converted layers usable, but byte-range verification must be rerun before declaring PMTiles authoritative again.
- If cache state causes client issues, send `CLEAR_TEST_CACHES` to the scoped `/test` service worker or bump `TEST_CACHE_VERSION`.
