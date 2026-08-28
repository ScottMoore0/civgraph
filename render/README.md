# `render/` — the development renderer, and the layer metadata

> **Status: mixed. The metadata is load-bearing in production; the page at
> `/render/` is a development harness.**

This directory does two quite different jobs, and confusing them is the main
hazard.

## 1. `render/metadata/` — production data

`maps-test.json` is the **layer index the live application reads**. It maps
catalogue map ids to the layers that actually draw them, and carries
`timeSeriesChains` and the stamped `publicMapCount`. It is generated — do not
hand-edit it:

```bash
node scripts/build-render-time-series-chains.mjs
```

`npm run build` runs that, and `check:render-time-series` fails if the file is
stale. Several validators read this file rather than the catalogue, because the
renderer is what decides whether a map can actually be drawn.

## 2. `render/src/` and `/render/` — the harness

A development view of the same renderer, used to test layers before promoting
them. It shares a lineage with `app/src/app.js` but is not the same code and does
not ship to the public site.

## 3. Tiles — 5.6 GB, almost all untracked

`tiles/`, `pmtiles/` and `source-cache/` hold generated tile pyramids: 51,158
files, of which about 2,000 are tracked. In production these are served from R2 at
`data.civgraph.net`, not from Pages — `scripts/clean-for-pages.sh` deletes them
from the deployment because they would blow through Cloudflare's 20,000-file
limit.

So a clean checkout will not have most of this, and that is correct.

## Uploading tiles

Use the S3 endpoint (`scripts/upload-tile-pyramid-s3.mjs`), never the REST API
path — the latter is rate-limited to roughly 1.4 objects per second, which for a
tile pyramid means days.
