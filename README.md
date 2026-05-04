![Civgraph](assets/images/civgraph-wordmark-facebook-header.png)

Interactive maps, election results, census data and records for Ireland, north and south.

**Live site:** [civgraph.net](https://civgraph.net)

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
| Maps | [Leaflet](https://leafletjs.com/) with [FlatGeobuf](https://flatgeobuf.org/) for streaming vector data |
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
    maps.json             # Map layer registry
    spatial-index.json    # Feature search index
    spatial-index/        # Per-map chunks for on-demand loading
  maps/                   # FlatGeobuf files (R2-hosted, multi-LOD)

build/                    # esbuild output (code-split bundles + minified CSS)
scripts/                  # Build and data processing scripts
functions/                # Cloudflare Pages Functions
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

Created by [Scott Moore](https://scottmoore.xyz). The project includes works from various individual contributors and organisations, as attributed on the website.
