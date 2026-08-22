![Civgraph](assets/images/civgraph-wordmark-facebook-header.png)

Interactive maps, election results, census data and records for Ireland, north and south.

**Live site:** [civgraph.net](https://civgraph.net)
**Support:** [ko-fi.com/scottmoore0](https://ko-fi.com/scottmoore0)

## What Civgraph does

Civgraph is a free, open site for exploring the administrative geography and political history of the island of Ireland. You can look up any townland, ward, constituency, or census area; see how boundaries have changed over time; and browse election results and demographic data.

## What's inside

Hundreds of map layers covering every major administrative geography on the island of Ireland, from the 19th century to the present day.

- **Maps and Boundaries** - Local government districts, wards, DEAs, parliamentary constituencies, Assembly areas, townlands, civil parishes, baronies, counties, and more. Browse by era with the time slider.
- **Elections and Results** - Assembly, Westminster, local government, European Parliament, and referendum results. Full STV count animations, candidate and party entity pages, and constituency-level visualisations.
- **Census and Demographics** - Small Areas, Output Areas, Super Output Areas, Data Zones, and settlement boundaries from NISRA and the CSO.
- **Physical Geography** - Rivers, watersheds, seas, regional divides, and land classifications.
- **Built Environment and Communities** - Peacelines, railways, travel-to-work areas, settlements, and place names.
- **Spatial Search** - Find any boundary feature by name across all map layers.
- **Time Slider** - Explore how boundaries have changed decade by decade.
- **Conditional Styling** - Dynamic map styling based on data attributes.

## Coverage

| Type | Examples |
|------|----------|
| Local government | Districts, wards, DEAs, local authorities |
| Parliamentary | Westminster constituencies, Dail constituencies, European Parliament regions |
| Assembly | Northern Ireland Assembly constituencies and regions |
| Communities | Townlands, settlements, place names |
| Historical | Civil parishes, baronies, counties, historic council boundaries |
| Census | Small Areas, Output Areas, Super Output Areas, Data Zones |
| Physical | Rivers, watersheds, seas, regional divides |
| Built environment | Peacelines, railways, travel-to-work areas |

## How it's built

| Layer | Technology |
|-------|-----------|
| Maps | [MapLibre GL](https://maplibre.org/) rendering [PMTiles](https://protomaps.com/docs/pmtiles) vector tiles; [FlatGeobuf](https://flatgeobuf.org/) is a download format, not a render path |
| Build | [esbuild](https://esbuild.github.io/) with code splitting and performance budgets |
| Search | [Fuse.js](https://www.fusejs.io/) for map search, spatial index for feature search |
| Geospatial | [Turf.js](https://turfjs.org/) for area/length calculations |
| Testing | [Playwright](https://playwright.dev/) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) + [R2](https://developers.cloudflare.com/r2/) |

## Run the site on your computer

```bash
# Install dependencies
npm install

# Build JS bundle + minified CSS
npm run build

# Start local server
python -m http.server 5050

# Open http://localhost:5050
```

## Project structure

**Read this before anything else. Several directory names are historical and will
mislead you.** This section is the canonical layout;
[CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow that goes with it.

| Path | What it actually is |
|---|---|
| `app/` | **the live site** — MapLibre GL. Built bundle in `app/build/`, committed. |
| `src/` | shared browser modules, served **unbundled**. Live, not legacy. |
| `render/src/` | shared renderer source; `app/` builds from it |
| `render/metadata/` | the render catalogue — see "three stores" below |
| `tests/` | the Playwright suite |
| `test2/` | a compatibility redirect. Not a directory of tests. |
| `apps/` | standalone apps (PRONI search). Unrelated to `app/`. |
| `browse/` | the Browse page — hand-written, no build step |
| `pages/` | standalone pages (About, Census Explorer) |
| `functions/` | Cloudflare Pages Functions |
| `scripts/` | build, validation and data pipelines — **not deployed** |
| `data/database/` | the tracked catalogue: `maps.json` and friends |
| `data/maps/` | geometry, served from **R2**, not from this repository |
| `archive/` | superseded code kept for reference. Do not build on it. |

Two traps in particular:

- **`src/` is not the old Leaflet stack.** `js/` was *renamed* to `src/` when
  Leaflet was retired, and only the dead parts moved to `archive/leaflet/`. What
  is left is live and load-bearing — `app/src/app.js` imports it on line 3. This
  README described `js/` as the entry point for months after that rename, which is
  where the "src/ is dead" belief came from; it cost 36,028 lines of live code its
  linting. See `docs/review/TECH-DEBT-AUDIT.md` item 4.
- **`app/` and `apps/` are different things**, as are `render/`, `test2/` and
  `tests/`. Renaming them is planned but invalidates clones, so it is scheduled
  rather than done: `docs/directory-rename-runbook.md`.

### The catalogue is three stores

The single most confusing thing here, and getting it wrong reliably produces
convincing but false "this layer is broken" diagnoses. Joined by a bare string id,
with a `-vector-test` suffix on the render side.

| Store | Owns |
|---|---|
| `data/database/maps.json` | provenance — licence, attribution, downloads |
| `render/metadata/maps-test.json` | rendering — tiles, zoom, styling, labels |
| `c1Cards` in `src/ui-controller.js` | navigation — what a user can click |

`render/metadata/maps-test-index.json` and `render/metadata/layer-details-test2/` are
**generated** from `maps-test.json`: edit the source, then run
`node scripts/build-test2-metadata-shards.mjs`. The client fetches the generated
detail shards, so editing only `maps.json` leaves the site showing the old values.

All three edges are guarded by validators in `npm run check`.

### Which URL comes from where

| URL | Source |
|---|---|
| `/` | `index.html` + `app/build/` (from `render/src/`) + `src/` + `build/` |
| `/browse/` | `browse/` |
| `/apps/`, `/apps/proni-search/` | `apps/` |
| `/pages/about`, `/pages/census-explorer` | `pages/` |
| `/render/` | `render/` — staging shell, not the public site |

## Build

```bash
npm run build
```

That chains seven steps; the two that produce the served bundles are
`scripts/build-shared-shell-assets.mjs` (CSS, critical-CSS inlining, thumbnail
manifest) and `npm run build:test2` (the MapLibre app). Produces:

- `app/build/app.bundle.js` — the app bundle, **committed** to the repository
- `app/build/app.bundle.css`
- `build/main.css` — deferred CSS, split from `assets/css/main.css`
- `build/main.critical.css` — inlined into `index.html` by the build

The build enforces performance budgets and fails if CSS exceeds 225 KB.

Each of those is referenced from `index.html` with a `?v=` cache token derived
from the file's content hash. **Never hand-edit a token** — `npm run check` fails
if one does not match, because a stale token means returning visitors keep running
the old file. `scripts/validate-app-shell-cache-tokens.mjs` explains why.

This file told you to run a bundle script at scripts/bundle.mjs until 2026-08-17.
There is no such file — it moved to `archive/legacy-scripts/` when the Leaflet
stack was retired. `npm run check` now verifies that every repository path these
documents cite actually resolves, so that particular lie cannot recur.

## Spatial index

The feature search index can be rebuilt from FlatGeobuf sources:

```bash
node scripts/build-feature-index.js
```

This generates:
- `data/database/spatial-index.json` - Monolithic index (fallback)
- `data/database/spatial-index/*.json` - Per-map chunks (loaded on demand)
- `data/database/spatial-index/_names.json` - Lightweight search index (~3 MB)
- `data/database/spatial-index/_manifest.json` - Chunk manifest

## Tests

```bash
npx playwright test
```

## Author

Created by [Scott Moore](https://scottmoore.xyz). The project includes works from various individual contributors and organisations, as attributed on the website.

## Licence

**The code is MIT.** See [LICENSE](LICENSE). You may use, modify and
redistribute it, commercially or otherwise, provided the copyright and
permission notice travel with it.

**The data is not.** This repository tracks a large amount of third-party
material — census tables, scanned books, boundary metadata — from NISRA, the
CSO, OSNI/Land & Property Services, Tailte Éireann, PRONI, the Northern Ireland
Assembly, the Houses of the Oireachtas and individual contributors. It arrives
under its own terms, predominantly the Open Government Licence and Creative
Commons Attribution. Those terms travel with the data and are not superseded by
the MIT grant. Per-dataset licence and attribution are recorded in
`data/database/maps.json` (the `references` and `sourceDownloads` fields) and
`data/database/external-sources.json`; the entry for a layer is authoritative for
that layer.

If you reuse a map layer, credit the originating body — crediting Civgraph alone
does not satisfy a source that requires its own attribution.

[NOTICE](NOTICE) sets this out in full. Licences for the third-party packages
compiled into the browser bundle are reproduced in
`app/build/THIRD-PARTY-NOTICES.txt`, generated at build time and verified by
`npm run check`.
