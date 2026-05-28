# PMTiles CDN Cache Invalidation Procedure

Use this when regenerated PMTiles, generated MVT, feature indexes, or `/test` bundles have been published.

## Version Discipline

1. Bump `TEST_ASSET_VERSION` for bundle-visible changes.
2. Bump `TEST_CACHE_VERSION` in `/test/sw.js` when cached asset behaviour changes.
3. Prefer immutable PMTiles object keys for regenerated archives. If replacing an existing key, invalidate CDN cache before announcing the deployment.
4. Keep `cdn-upload-manifest.json` in sync with local archive names, remote keys, byte sizes, and expected URLs.

## Invalidation Steps

1. Upload PMTiles archives to R2/CDN.
2. Purge affected CDN keys or the narrowest prefix containing regenerated PMTiles.
3. Purge affected feature-index JSON keys if indexes changed.
4. Run `npm run verify:test:pmtiles-cdn`.
5. Run `npm run check:test:ci` where CDN access is available.
6. Open `/test/` in a clean browser profile and confirm diagnostics reports PMTiles/CDN health without fallback warnings.

## Evidence To Record

Record changed keys, purge time, byte-range verification output, affected layer ids, and whether service-worker cache eviction was needed.
