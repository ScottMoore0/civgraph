# /test PMTiles and CDN deployment

The `/test` rewrite can load either directory MVT or single-file PMTiles archives. The constrained local build path is GDAL's writable `PMTiles` driver.

Promotion and rollback requirements are tracked in `test/metadata/production-readiness.md`.

## Build order

1. Refresh converted directory MVT outputs when source data changes:

   ```powershell
   npm run build:test:batch-vectors -- --execute
   ```

2. Promote verified converted outputs into `/test` metadata:

   ```powershell
   npm run build:test:promote
   ```

3. Build PMTiles archives and update metadata to prefer archives that exist:

   ```powershell
   npm run build:test:pmtiles -- --force
   ```

4. Rebuild indexes and validation reports:

   ```powershell
   npm run build:test:feature-indexes
   npm run build:test:cdn-manifest
   npm run check:test
   ```

## Metadata rules

- `sourceType: "pmtiles"` is used only when `/test/pmtiles/generated/<layer-id>.pmtiles` exists and is below the configured size budget.
- `tilesFallback` remains pointed at the directory MVT tile template.
- `metadataUrl` remains pointed at the directory MVT `metadata.json`, because it is still useful for diagnostics and tile-budget checks.
- Runtime `tileUrl` should point at `https://data.civgraph.net/data/maps/test/pmtiles/generated/<layer-id>.pmtiles` after upload and range verification.
- `tilePackage.localPath` and `tilePackage.localUrl` preserve the repo-local archive location for rebuilding, validation, and local fallback.
- `tilesFallback` lets the runtime recover to directory MVT if a PMTiles request fails.
- Generated PMTiles archives are ignored by Git. R2 is the authoritative serving location.

## CDN/R2 upload

Run:

```powershell
npm run build:test:cdn-manifest
```

This writes `test/metadata/cdn-upload-manifest.json` with local paths, target keys, CDN URLs, and example `wrangler r2 object put` commands. Defaults are:

- CDN base: `https://data.civgraph.net/data/maps/test`
- R2 bucket: `boundaries-data`
- R2 prefix: `data/maps/test`

Override defaults with:

```powershell
$env:TEST_CDN_BASE="https://data.civgraph.net/data/maps/test"
$env:TEST_R2_PREFIX="data/maps/test"
npm run build:test:cdn-manifest
```

Apply the R2 CORS policy, upload archives, verify byte ranges, then switch metadata:

```powershell
npm run deploy:test:r2-cors
npm run deploy:test:pmtiles
npm run verify:test:pmtiles-cdn
npm run switch:test:pmtiles-cdn
npm run build:test:cdn-manifest
```

To retry one failed archive without repeating the full upload:

```powershell
npm run deploy:test:pmtiles -- --ids roi-townlands-vector-test
```

## Hard serving requirement

PMTiles must be served with byte-range support:

- `Accept-Ranges: bytes`
- valid `Content-Length`
- `206 Partial Content` responses for `Range: bytes=...` requests
- CORS-exposed `Accept-Ranges`, `Content-Length`, `Content-Range`, and `ETag` headers for browser access from `civgraph.net`

The verification script writes `test/metadata/cdn-range-report.json` and fails if any archive does not return a 16-byte `206 Partial Content` response for `Range: bytes=0-15`.

## Git hygiene

After CDN verification succeeds and metadata has been switched, remove generated PMTiles archives from Git tracking while keeping the local files:

```powershell
git rm --cached -- test/pmtiles/generated/*.pmtiles
```

The `.gitignore` rule prevents future PMTiles archives from being recommitted accidentally.
