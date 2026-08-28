# `app/` — the production map application

> **Status: current — this is what civgraph.net serves at `/`.**

The MapLibre map at the root of the site. If you change how the map behaves, you
almost certainly change something here.

## Layout

| Path | What it is |
|---|---|
| `src/app.js` | The application. One file, and the entry point for everything the map does — catalogue, layer loading, election panes, URL state, the support modal. |
| `build/` | **Generated. Do not edit.** esbuild output (`app.bundle.js`, `app.bundle.css`, `chunks/`) produced by `scripts/build-test2-app.mjs`. Tracked in git so Cloudflare Pages can serve it without a build step. |
| `election-viewer-package/` | The STV count animation and election viewer. Derived from ElectionsNI's `stages.css` — see `data/database/external-sources.json` for the attribution that derivation requires. |
| `js/` | Two vendored shims (`jquery-shim.js`, a FlatGeobuf build) that the election viewer expects. |

## The trap

`build/` is **tracked**, so an edit to `src/app.js` that is committed without
rebuilding produces a repository where the source and the deployed bundle
disagree, and the site keeps serving the old behaviour. After editing anything
under `src/`, run:

```bash
npm run build          # includes build:test2 and promote-test2-root
```

and commit the resulting `build/` changes in the same commit.

## What it shares with `/render/`

The renderer under `render/src/` and this application share a lineage, and much
of `render/src/` is the same code at an earlier stage. They are not
interchangeable: `render/` is the development harness at `/render/`, this is what
the public sees. Changing one does not change the other.

## Related

- `render/metadata/maps-test.json` — the layer index this reads at runtime
- `data/database/maps.json` — the catalogue behind it
- `tests/browser/` — Playwright specs, most of which drive this app
