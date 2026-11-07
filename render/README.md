# `render/` — the development renderer, and the layer metadata

> **Status: current, 7 November 2026. The metadata is load-bearing in production; the
> development harness that was served at `/render/` is retired.**

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

## 2. `/render/` — retired

The page at `/render/` was a development view of the renderer, used to test layers
before promoting them. It retired on 7 November 2026 (site restructure F5): `/render/`
answers 301 to `/maps/` (`_redirects`), and its page and bundle are deleted. The renderer
modules the map app imports live on, outside this directory.

`sw.js` here is not the old app's worker but its **kill switch**, served byte for byte the
same at `/render/sw.js`, `/test2/sw.js` and (proxied) `/test/sw.js`: a browser that still
holds a worker registered from one of those addresses installs it on its next update check,
and it unregisters itself, clears the old caches and moves any open page to `/maps/`. It must
stay at this address, as a 200, while any such browser may be out there. Its bytes are
pinned in `tests/unit/retired-service-worker.test.mjs`.

## 3. Tiles — 5.6 GB, almost all untracked

`tiles/`, `pmtiles/` and `source-cache/` hold generated tile pyramids: 51,158
files, of which about 2,000 are tracked. In production these are served from R2 at
`data.civgraph.net`, not from Pages — `scripts/clean-for-pages.sh` deletes them
from the deployment because they would blow through Cloudflare's 20,000-file
limit.

So a clean checkout will not have most of this, and that is correct.

## Uploading tiles

Use the S3 endpoint (`scripts/publish/r2-upload-tree.mjs`), never the REST API
path — the latter is rate-limited to roughly 1.4 objects per second, which for a
tile pyramid means days.
