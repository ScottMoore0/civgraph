# `src/` — vendored third-party browser files

> **Status: current, 12 November 2026.** The map app's modules that lived here moved into
> `packages/map/src/` (refactor F2/F4, stream rf9-mapapp). What is left is vendored code only.

## What is here

| Folder | Role |
|---|---|
| `libs/` | The browser libraries the site self-hosts: DuckDB-WASM, MapLibre GL and PMTiles for the Elections app (`scripts/build/elections-app/vendor.mjs` writes them; `libs/elections-app-vendor.json` says what is where), FlatGeobuf, which `scripts/build/app-bundle.mjs` copies for the map app, and pako. Served at `/src/libs/`. |
| `sql.js-httpvfs/` | A vendored copy of sql.js-httpvfs. Served at `/src/sql.js-httpvfs/`. |

Both are excluded from linting (`eslint.config.mjs`): not ours to fix. In `config/boundaries.json`
the `frontend` unit holds this folder and may import only itself.

## Where the map app's modules went

`ui-controller.js`, `data-service.js`, `feature-loader.js`, the catalogue (`catalogue/`), the
election renderer, trend chart and main-pane contract, the census overlay, printed labels, the
NI local groups, `public-map.mjs`, `jquery-shim.js`, `fgb-worker.js` and the rest are now
`packages/map/src/<the same name>`, with the same module boundaries. Their served URLs did not
change: `packages/served.json` serves each at its old `/src/` path (and `/src/catalogue/`), and
`tests/unit/map-served-paths.test.mjs` pins every one. They are bundled into `app/build/` by
esbuild from `packages/map/app/boot.js`; nothing loads them raw.

The type check of these modules is `packages/map/tsconfig.check.json` (`npm run check:types:mapapp`).

## History

`js/` was the Leaflet stack. It was renamed to `src/` in `fb5d246cad`; only the dead Leaflet parts
went to `archive/leaflet/` (out of the repository since November 2026: see `ARCHIVE.md`). Everything
that stayed was live: the catalogue pane, data service and feature loader the public map runs on.
It is still live, now in `packages/map/src/`.
