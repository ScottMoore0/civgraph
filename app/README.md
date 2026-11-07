# `app/` — the production map application

> **Status: current — this is what civgraph.net serves at `/`.**

The MapLibre map at the root of the site. If you change how the map behaves, you
almost certainly change something here.

## Layout

| Path | What it is |
|---|---|
| `src/app.js` | The application's entry: `Test2App`, its state (the constructor) and start-up (`init`). Its other methods live in `../src/map/app/` (layers, URL state, timeline, election pane, search, legend, sources, controls, ...), one module per concern, and are installed on the class by `installMethods`. Each module says in its header what it covers. |
| `src/election-manager.js` | The election pane: `Test2ElectionManager`, its overlays and tables. Split out of it under `../src/map/election/`: `transport.mjs` (where the results come from: the API or the static bundles), `cache.mjs` (the in-memory caches and their limits), `panel-model.mjs` (the pane's view, selection and address state), `grouped-years.mjs` and `grouped-year-methods.js` (the pre-1973 council years), `results-model.mjs` and `palette.mjs`. |
| `../src/map/renderer/` | The MapLibre renderer the app draws with (`map-controller.js`, `metadata-service.js`, labels and their helpers), moved from `render/src/`. |
| `build/` | **Generated. Do not edit. Not in git.** esbuild output (`app.bundle.js`, `app.bundle.css`, `chunks/`, `metafile.json`) produced by `scripts/build-test2-app.mjs`; the Pages build (`npm run build`) makes it on every deploy. |
| `election-viewer-package/` | The STV count animation and election viewer. Derived from ElectionsNI's `stages.css` — see `data/database/external-sources.json` for the attribution that derivation requires. |
| `js/` | Two vendored shims (`jquery-shim.js`, a FlatGeobuf build) that the election viewer expects. |

## The trap

`npm run build` (or `npm run build:test2:app`) also stamps cache tokens into tracked
files: the `?v=` of the bundle in `maps/index.html` (and the `maps/classic/`
copy written from it) and `VERSION` in `sw.js`. After editing
anything the bundle includes (`app/src/`, `src/map/`, `src/`), rebuild
and commit those stamped files with the change, so the tokens follow the bundle.

## What it shares with `/render/`

The development harness at `/render/` (`render/src/app.js`) draws with the same
renderer, `src/map/renderer/`, so a change there changes both. The harness's own
modules under `render/src/` share a lineage with this application but are not
interchangeable with it: this is what the public sees.

## Related

- `render/metadata/maps-test.json` — the layer index this reads at runtime
- `data/database/maps.json` — the catalogue behind it
- `tests/browser/` — Playwright specs, most of which drive this app
