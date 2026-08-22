# /test Cutover PR Checklist

Use this before replacing the Leaflet main map with the MapLibre `/test` shell.

## Required Checks

1. `npm run check`
2. `npm run check:test`
3. `npm run test:browser:test`
4. `npm run smoke:test:mobile`
5. CDN byte-range verification for every PMTiles layer in the promoted catalogue.
6. Manual mobile pass on at least one iOS Safari device and one Android Chromium device.

## PR Requirements

1. Explain the route change and service-worker scope change.
2. List data coverage gaps that remain unavailable in MapLibre.
3. Include screenshots for desktop, mobile portrait, and mobile landscape.
4. Include diagnostics readiness output and warnings.
5. Confirm rollback commit and Cloudflare Pages rollback target.
6. Confirm CDN cache invalidation plan for regenerated PMTiles and bundle assets.

## Do Not Cut Over If

1. Any converted PMTiles layer needs local directory fallback in production.
2. Civil parishes, townlands, or large administrative layers crash mobile browsers.
3. The catalogue cannot show unconverted main-site maps as first-class entries.
4. Feature details, sources, and URL restore fail browser regression tests.
