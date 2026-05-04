# Civgraph

Interactive map explorer for Northern Ireland and Ireland boundaries - local government districts, parliamentary constituencies, wards, townlands, historic administrative areas, and more.

**Live site:** [civgraph.net](https://civgraph.net)

## What's here

Over 470 map layers across 1,100+ FlatGeobuf files covering:

- **Elections & Government** - Assembly areas, parliamentary constituencies, local government districts, DEAs, European Parliament regions, referendum results
- **Communities** - Townlands, settlements, place names
- **History** - Civil parishes, baronies, counties, historic council boundaries
- **Public Services** - Education/library boards, health trusts, census areas (output areas, super output areas, data zones)
- **Physical Geography** - Rivers, watersheds, seas, regional divides
- **Built Environment** - Peacelines, railways, travel-to-work areas

The site also integrates Northern Ireland election results with STV count animations, candidate/party entity pages, and constituency-level visualisations.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Maps | [Leaflet](https://leafletjs.com/) with [FlatGeobuf](https://flatgeobuf.org/) for streaming vector data |
| Build | [esbuild](https://esbuild.github.io/) with code splitting |
| Search | [Fuse.js](https://www.fusejs.io/) for map search, spatial index for feature search |
| Geospatial | [Turf.js](https://turfjs.org/) for area/length calculations |
| Testing | [Playwright](https://playwright.dev/) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) + [R2](https://developers.cloudflare.com/r2/) |

## Getting started

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

```
js/
  app.js                  # Entry point, wires all modules
  map-controller.js       # Leaflet map, layers, LOD selection
  ui-controller.js        # Split-pane layout, catalogue, search
  feature-loader.js       # Viewport-aware spatial index + per-feature loading
  election-controller.js  # Election results, STV animation, entity pages
  data-service.js         # Map/book metadata queries
  time-slider-controller.js
  conditional-styling.js
  election-utils.js       # Shared formatters (dates, body names, links)

data/
  database/
    maps.json             # Map layer registry (470+ entries)
    spatial-index.json    # Feature search index
    spatial-index/        # Per-map chunks for on-demand loading
  maps/                   # FlatGeobuf files (1,100+ files, multi-LOD)

build/                    # esbuild output (code-split bundles + minified CSS)
scripts/
  bundle.mjs              # Build script with performance budgets
  build-feature-index.js  # Generates spatial index from FGB sources
sw.js                     # Service worker (cache-first for map data + fonts)
```

## Build

```bash
node scripts/bundle.mjs
```

Produces:
- `build/app.bundle.js` - Main bundle (~286 KB)
- `build/election-controller-*.js` - Lazy-loaded election module (~179 KB)
- `build/chunk-*.js` - Shared code (~77 KB)
- `build/main.css` - Minified CSS (~203 KB)

The build enforces performance budgets and fails if the main bundle exceeds 313 KB or CSS exceeds 225 KB.

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

Created by [Scott Moore](https://scottmoore.xyz).
