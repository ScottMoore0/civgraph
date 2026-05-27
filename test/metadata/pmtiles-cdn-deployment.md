# /test PMTiles and CDN deployment

The `/test` rewrite can load either directory MVT or single-file PMTiles archives. The constrained local build path is GDAL's writable `PMTiles` driver.

## Build order

1. Refresh converted directory MVT outputs when source data changes:

   ```powershell
   npm run build:test:batch-vectors -- --execute
   ```

2. Promote verified converted outputs into `/test` metadata:

   ```powershell
   npm run build:test:promote
   ```

3. Build PMTiles archives and update metadata to prefer archives that exist and stay under the Git hosting budget:

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
- Oversized PMTiles archives are kept out of the preferred runtime path; the layer remains on directory MVT and receives a warning.

## CDN/R2 upload

Run:

```powershell
npm run build:test:cdn-manifest
```

This writes `test/metadata/cdn-upload-manifest.json` with local paths, target keys, CDN URLs, and example `wrangler r2 object put` commands. The bucket name is intentionally not hard-coded. Override defaults with:

```powershell
$env:TEST_CDN_BASE="https://data.civgraph.net/test"
$env:TEST_R2_PREFIX="test"
npm run build:test:cdn-manifest
```

After upload, metadata can be switched from local `/test/pmtiles/...` URLs to CDN URLs if production should not serve archives from the repo host.

## Hard serving requirement

PMTiles must be served with byte-range support:

- `Accept-Ranges: bytes`
- valid `Content-Length`
- `206 Partial Content` responses for `Range: bytes=...` requests

The mobile smoke test includes a range-capable static server because PMTiles will not render reliably from a host that strips range headers.
