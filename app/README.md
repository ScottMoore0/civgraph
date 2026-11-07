# `app/` — the production map application

> **Status: current — this is what civgraph.net serves at `/`.**

The MapLibre map at the root of the site. If you change how the map behaves, you
almost certainly change something here.

## Layout

| Path | What it is |
|---|---|
| `src/app.js` | The application's entry: `Test2App`, its state (the constructor) and start-up (`init`). Its other methods live in `../src/map/app/` (layers, URL state, timeline, election pane, search, legend, sources, controls, ...), one module per concern, and are installed on the class by `installMethods`. Each module says in its header what it covers. |
| `build/` | **Generated. Do not edit. Not in git.** esbuild output (`app.bundle.js`, `app.bundle.css`, `chunks/`, `metafile.json`) produced by `scripts/build-test2-app.mjs`; the Pages build (`npm run build`) makes it on every deploy. |
| `election-viewer-package/` | The STV count animation and election viewer. Derived from ElectionsNI's `stages.css` — see `data/database/external-sources.json` for the attribution that derivation requires. |
| `js/` | Two vendored shims (`jquery-shim.js`, a FlatGeobuf build) that the election viewer expects. |

## The trap

`npm run build` (or `npm run build:test2:app`) also stamps cache tokens into tracked
files: the `?v=` of the bundle in `maps/index.html` (and the `maps/test/` and
`maps/classic/` copies written from it) and `VERSION` in `sw.js`. After editing
anything the bundle includes (`app/src/`, `src/map/`, `src/`, `render/src/`), rebuild
and commit those stamped files with the change, so the tokens follow the bundle.

## What it shares with `/render/`

The renderer under `render/src/` and this application share a lineage, and much
of `render/src/` is the same code at an earlier stage. They are not
interchangeable: `render/` is the development harness at `/render/`, this is what
the public sees. Changing one does not change the other.

## Related

- `render/metadata/maps-test.json` — the layer index this reads at runtime
- `data/database/maps.json` — the catalogue behind it
- `tests/browser/` — Playwright specs, most of which drive this app
