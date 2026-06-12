# /test2 Performance Audit And Recommendations

Date: 2026-06-06

Scope: `/test2` only. This audit looks at startup cost, layer-load cost, election-layer cost, smoothness during pan/zoom/hover, mobile stability, cache behaviour, and verification coverage. Recommendations are ranked by ROI: expected user impact divided by implementation difficulty and risk.

## Executive Summary

`/test2` is functionally much richer than the earlier MapLibre rewrite, but it currently pays too much of that cost at startup. The page loads the main shell, the MapLibre bundle, the full `/test` metadata catalogue, election scaffolding, legacy election-viewer scripts, and several broad data services before the first useful interaction. That produces avoidable work on desktop and a much larger penalty on mobile.

The most valuable performance direction is:

1. Make the initial route a small, fast shell plus MapLibre map.
2. Load catalogue metadata, election logic, search indexes, feature indexes, labels, seat circles, and transfer animation code only when needed.
3. Cache immutable assets and PMTiles aggressively, but revalidate small manifests safely.
4. Add mobile/low-end-device budgets that test actual PMTiles layers and actual election layers.

Current local verification:

- `npm run build:test2`: passed after allowing esbuild to spawn; bundle output is now a tiny `/app/build/app.bundle.js` bootstrap plus split lazy chunks and `/app/build/app.bundle.css`.
- `npm run check:test2`: passed after rebuild.
- `npm run test:performance:test2`: passed in fixture mode through the `/test2/` compatibility route into the root app.

## Key Evidence

### Startup Payloads

| Asset | Size | Compressed estimate |
| --- | ---: | ---: |
| `app/build/app.bundle.js` | 741 bytes | bootstrap only |
| `app/build/chunks/*.js` | ~1.6 MB total | split runtime chunks |
| `app/build/app.bundle.css` | 95,763 bytes | gzip ~13 KB |
| `test2/index.html` | tiny compatibility redirect | not an app shell |
| `test/metadata/maps-test.json` | 5,046,981 bytes | gzip ~543 KB, brotli ~323 KB |
| `test/metadata/elections-test2.json` | 449,319 bytes | gzip ~21 KB, brotli ~14 KB |
| `data/database/maps.json` | 872,911 bytes | gzip ~83 KB, brotli ~60 KB |

The initial app code imports `data-service`, `feature-loader`, `ui-controller`, the full `/test` metadata service, `Test2ElectionManager`, and the MapLibre adapter at module startup. The `init()` path waits for `dataService.init()`, `loadBooks()`, `metadataService.load()`, `elections.load()`, catalogue rendering, and MapLibre initialization before the route is fully ready.

### Large Data Directories

| Data set | Count | Total size | Notes |
| --- | ---: | ---: | --- |
| `test/metadata/elections-test2/` | 268 files | ~159 MB | Biggest local-government bundles are 13-16 MB each. |
| `test/metadata/feature-indexes/` | 479 files | ~172 MB | Some individual indexes are ~4.5 MB. |
| `test/metadata/election-anchors-test2/` | 37 files | ~4.5 MB | One ROI local-authorities anchor file is ~3.8 MB. |
| `data/browse/` | 2,874 files | ~58 MB | `persons.json` and `elections.json` dominate. |

### Cache Headers

Live header checks on 2026-06-06 show:

- `/test2/`: `Cache-Control: public, max-age=0, must-revalidate`.
- `/app/build/app.bundle.js?v=test2-009`: `Cache-Control: public, max-age=14400, must-revalidate`.
- `/test/metadata/maps-test.json`: `Cache-Control: public, max-age=0, must-revalidate`.
- `/test/metadata/elections-test2.json`: `Cache-Control: public, max-age=0, must-revalidate`.

There is no dedicated `/test2` stanza in `_headers`. The bundle is versioned by a manually managed query string, not by content hash, so it cannot safely use long immutable caching.

### Current Guardrail Gap

`scripts/validate-test2-mobile-performance.mjs` only tests one representative layer, Civil Parishes, and forces it to directory MVT when a fallback exists. The local repo currently does not have the Civil Parishes fallback tiles, so the test fails with "civil parishes produced no rendered features". This needs to be corrected because it means the smoke test is not currently a reliable production-performance signal.

## Ranked Recommendations

### 1. Stop Doing Non-Critical Startup Work Before First Map Render

ROI: Very high. Impact: high. Difficulty: low to medium.

Current problem:

- `/test2/index.html` preloads two FGB files that are part of the old Leaflet/defaultOn path, even though `/test2` is MapLibre/PMTiles-first.
- The page loads several legacy election-viewer scripts synchronously or eagerly.
- `Test2ElectionManager` and election manifest loading happen during startup, even when the user is not loading an election layer.
- `books.json` and broad main data-service state are loaded before the first map is interactive.

Recommended change:

- Remove the two FGB preload links from `/test2/index.html` unless a measured `/test2` path still needs them.
- Do not load `election-viewer-package/js/stages2.js`, `animation_preview.js`, `animation_preview_manager.js`, or `election_viewer.js` on initial page load. Lazy-load them only when the user opens a transfer/count animation view that actually needs them.
- Replace the static import of `Test2ElectionManager` with a dynamic import when an election layer is selected or when the election catalogue is first opened.
- Load `books.json` only when Browse/source/book functionality is requested.
- Render the shell and initialize MapLibre first, then populate catalogue/election/search panels asynchronously.

Expected benefit:

- Faster first contentful interaction.
- Less main-thread parse/compile cost on mobile.
- Lower chance of blank/partially initialized screens when one non-map data fetch stalls.

Verification:

- Add a cold-start budget for `/test2/` with no active layer.
- Track time to first map render, time to first catalogue paint, and JS heap after idle.

### 2. Add Proper `/test2` Cache Headers And Content-Hashed Asset Versioning

ROI: Very high. Impact: high for repeat visits and deployment stability. Difficulty: low.

Current problem:

- `_headers` has `/test/` rules but no `/test2/` rules.
- The deployed `/test2` bundle uses `max-age=14400, must-revalidate`, not immutable caching.
- The bundle URL uses `?v=test2-009`, which is manually managed and can drift.

Recommended change:

- Add `_headers` entries for:
  - `/test2/` and `/test2/index.html`: `public, max-age=0, must-revalidate`, `X-Robots-Tag: noindex, nofollow` while test-only.
  - `/app/build/*`: `public, max-age=31536000, immutable`.
  - `/test2/sw.js`: `no-cache, must-revalidate`, `Service-Worker-Allowed: /test2/`, used only for compatibility cleanup.
- Make `scripts/build-test2-app.mjs` compute a content hash or content-derived version for the JS/CSS URLs and rewrite `index.html` automatically.
- Treat `maps-test.json`, election manifests, and source metadata as manifest assets: short/no-cache if they are not hashed; immutable if they become content-hashed.

Expected benefit:

- Repeat visits avoid re-downloading the 1.6 MB JS bundle.
- Fewer stale-bundle/stale-metadata mismatches after deployment.
- Better reliability on mobile networks.

Verification:

- Header test for `/test2/`, `/test2/index.html`, `/app/build/app.bundle.js`, `/app/build/app.bundle.css`, metadata, PMTiles URLs, and `/test2/sw.js` compatibility cleanup.
- Deployment check that the HTML references the current content-derived bundle version.

### 3. Split `maps-test.json` Into A Small Startup Catalogue Index And Lazy Detail Files

ROI: Very high. Impact: high. Difficulty: medium.

Current problem:

- `/test2` loads `test/metadata/maps-test.json`, a 5 MB JSON file, before the route is fully ready.
- The metadata service normalizes all converted and unconverted layers up front.
- It also builds search text for all layers up front.

Recommended change:

Create generated metadata shards:

- `test/metadata/maps-test-index.json`: minimal fields needed for first catalogue paint and active-layer lookup.
- `test/metadata/maps-test-layer-details/{id}.json`: full per-layer metadata, source credits, references, downloads, variants, diagnostics.
- `test/metadata/maps-test-search.json` or search shards: only fetched when the user searches.
- `test/metadata/maps-test-converted-index.json`: minimal PMTiles/MVT runtime fields for loadable layers.

Expected benefit:

- Large reduction in startup JSON parse and memory.
- Faster catalogue first paint.
- Less low-end mobile heap pressure.

Implementation notes:

- Keep the current full file during transition for tests/backwards compatibility.
- Add a compatibility service that can serve `getLayer(id)` from the small index and hydrate details on demand.
- Move search-index construction to a Web Worker or prebuilt search index.

Verification:

- Budget startup metadata bytes.
- Measure JSON parse time and heap before/after.
- Add tests for catalogue detail hydration and URL restore hydration.

### 4. Code-Split The `/test2` Bundle

ROI: Very high. Impact: high. Difficulty: medium.

Current problem:

- `scripts/build-test2-app.mjs` emits one monolithic `app.bundle.js`.
- Static imports pull MapLibre, the shared main UI, the metadata service, election manager, election view-model/rendering logic, and adapter code into one startup bundle.

Recommended split:

- `test2-shell`: header/catalogue shell, basic MapLibre adapter, URL guard, initial map.
- `test2-catalogue`: catalogue grouping, detail panes, source/download panels.
- `test2-election`: election manager, main election pane contract, election renderer/domain logic.
- `test2-transfer-animation`: legacy election viewer animation scripts and their shims.
- `test2-search`: Fuse/search UI and feature-search worker.
- `test2-diagnostics`: diagnostics/readiness panels.

Expected benefit:

- Lower initial parse/compile cost.
- Faster time to first usable map on mobile.
- Easier performance budgeting by feature area.

Verification:

- Bundle analyzer report in CI.
- Startup route must not download election chunks unless an election layer is active/restored.
- Transfer animation chunk must not download unless Transfers is opened for an entry with animation data.

### 5. Precompute Duplicate Feature-ID Sidecars Instead Of Fetching Full Feature Indexes On Layer Load

ROI: High. Impact: high on large layers. Difficulty: medium.

Current problem:

- `test/src/map-controller.js` calls `loadDuplicateFeatureIds(layer)` before adding a layer.
- That function fetches `layer.featureIndexUrl` and scans it to find duplicate IDs.
- Feature indexes total ~172 MB, with several individual indexes around 4.5 MB.

Recommended change:

- During tile/index generation, emit a tiny sidecar such as:
  - `featureIdMode`: `unique`, `duplicate`, or `missing`.
  - `duplicateFeatureIdsUrl`: only if duplicates exist.
  - `duplicateFeatureIdCount`.
- For unique layers, skip the feature-index fetch entirely.
- For duplicate layers, fetch a tiny duplicate-ID list rather than the full search index.

Expected benefit:

- Much faster first layer load for large maps.
- Lower memory pressure.
- Less network contention with PMTiles.

Verification:

- Add an assertion that normal layer load does not fetch `feature-indexes/*.json`.
- Keep cross-highlighting regression tests for known duplicate-ID layers.

### 6. Fix And Broaden The Mobile Performance Smoke

ROI: High. Impact: high as a guardrail. Difficulty: low to medium.

Current problem:

- The existing smoke test fails locally because it forces a Civil Parishes fallback path that is absent locally.
- It tests one layer only.
- It does not cover election layers, local-government election bundles, townlands, heavy feature indexes, or route restore.

Recommended change:

- Make the smoke choose the production PMTiles URL path when network/CDN is available, and choose a known local fixture when offline.
- Add representative layers:
  - Civil Parishes.
  - Townlands.
  - Small Areas.
  - Counties.
  - A raster entry.
  - A local-government election layer.
  - A Dáil election layer with seat circles.
- Track:
  - boot time,
  - layer-load time,
  - first rendered feature,
  - seat-circle render time,
  - hover latency,
  - heap,
  - PMTiles fallback count,
  - failed tile count.

Expected benefit:

- Prevents accidental regressions that are currently easy to miss.
- Gives a reliable signal for low-end/mobile readiness.

Verification:

- `npm run test:performance:test2` should pass locally in an offline fixture mode and optionally in a CDN mode.
- CI should use a lighter deterministic subset.

### 7. Split And Lazy-Load Election Result Bundles

ROI: High. Impact: very high for election layers. Difficulty: medium to high.

Current problem:

- Election bundles total ~159 MB.
- Large local-government bundles are 13-16 MB each.
- The election manager keeps `bundleCache` and `featureIndexCache` in memory without an obvious eviction policy.

Recommended change:

- Split election data into:
  - election summary,
  - constituency/DEA result files,
  - candidate/count files,
  - transfer animation files,
  - previous-election deltas or previous summary files.
- For an election-layer load, fetch only summary + map styling fields first.
- Fetch constituency/DEA detail only when selected.
- Fetch transfer animation only when the Transfers view is opened.
- Add an LRU cache with memory-aware eviction for bundles, feature indexes, anchors, and transfer data.

Expected benefit:

- Much faster election-layer open.
- Lower mobile heap usage.
- More stable behaviour on older phones.

Verification:

- Opening Dáil 2024 should not download all count/transfer data immediately.
- Selecting one constituency should fetch one constituency detail shard.
- Switching away should release large prior election bundles where safe.

### 8. Move Heavy Search, Feature Indexing, And Catalogue Search Work Off The Main Thread

ROI: High. Impact: medium to high. Difficulty: medium.

Current problem:

- Catalogue and feature search indexes are large.
- Search setup and index scanning can compete with map rendering and pointer interactions.

Recommended change:

- Use a Web Worker for:
  - search index loading,
  - Fuse initialization,
  - feature-search ranking,
  - search-result clustering.
- Lazy-load the worker only when search receives input.
- Keep only top N results in the UI and progressively hydrate details.

Expected benefit:

- Smoother pan/zoom while search is available.
- Lower main-thread stalls on mobile.

Verification:

- Interaction latency budget while typing in catalogue search.
- No long tasks above 50 ms during initial map idle on a mid-range mobile profile.

### 9. Cap And Virtualize DOM Labels And Seat-Circle DOM Overlays

ROI: High. Impact: high for smoothness. Difficulty: medium.

Current problem:

- `/test2` uses DOM labels for main-site parity.
- Election seat circles are now DOM/MapLibre marker overlays for visual parity.
- DOM overlays are expensive when many markers are visible, especially during pan/zoom.

Recommended change:

- Rebuild labels and seat circles on `idle` and debounced `moveend`, not continuously during pan.
- During active pan/zoom, keep transforms cheap and defer expensive collision recomputation.
- On mobile or low-memory devices:
  - reduce label count,
  - hide low-priority labels at low zoom,
  - show seat circles only after map settles,
  - use simplified collision.
- Keep MapLibre symbol layers for non-interactive low-priority labels where exact DOM parity is not needed.

Expected benefit:

- Better frame pacing during map movement.
- Less marker drift/jank.
- Lower layout/reflow cost.

Verification:

- Add a pan/zoom stress test that records marker count, rebuild time, long tasks, and map frame stability.
- Compare election seat-circle count before and after zoom at known screenshots.

### 10. Parallelize Group Layer Loads And Fit Once

ROI: Medium high. Impact: medium. Difficulty: low to medium.

Current problem:

- `app/src/maplibre-main-adapter.js` loads group members sequentially.
- `loadLayer()` can fit after each member load unless options suppress it.

Recommended change:

- For grouped maps, resolve runtime layer configs first, then load child layers with bounded parallelism.
- Fit once to combined bounds after all child layers are added.
- Update URL/active-layer UI once, not after every child.

Expected benefit:

- Faster all-Ireland composite/group loads.
- Less camera jitter.
- Lower visible loading churn.

Verification:

- Timed group-load tests for Townlands, Civil Parishes, Electoral Divisions, and composite local authority maps.

### 11. Add A `/test2`-Scoped Service Worker With Quota-Aware Cache Policy

ROI: Medium high. Impact: high on repeat visits/offline-ish behaviour. Difficulty: medium.

Current problem:

- `/test2/index.html` contains a service-worker placeholder, but it does not register a scoped `/test2` service worker.
- `/test/` has a dedicated service worker/header setup, but `/test2` does not.

Recommended change:

- Keep `/test2/sw.js` scoped to `/test2/` as a compatibility cleanup worker until the route is removed.
- Cache immutable `/app/build/*`, fonts, small manifests, and selected PMTiles byte ranges carefully.
- Do not blindly cache huge election bundles or unbounded PMTiles ranges.
- Add quota-aware cleanup and a diagnostics panel showing cache status.

Expected benefit:

- Faster repeat loads.
- More stable behaviour on weak mobile connections.

Verification:

- Browser tests for first load, repeat load, cache eviction, and deploy version rollover.

### 12. Optimize PMTiles/CDN Behaviour

ROI: Medium high. Impact: high for layer loads. Difficulty: medium.

Current problem:

- Metadata now points heavily at `data.civgraph.net` PMTiles: 602 PMTiles-like layers.
- PMTiles performance depends on byte-range support, CDN cache behaviour, and archive layout.

Recommended change:

- Validate every PMTiles URL for:
  - `Accept-Ranges: bytes`,
  - `Content-Length`,
  - `206 Partial Content`,
  - correct `Content-Type`,
  - long cache lifetime for immutable versioned archives.
- Keep PMTiles names content/versioned.
- Store metadata pointing to versioned PMTiles.
- Keep directory-MVT fallback only for development/recovery, not as normal production path.

Expected benefit:

- Faster vector layer startup.
- More predictable CDN behaviour.
- Fewer runtime fallback stalls.

Verification:

- Scheduled byte-range monitor for promoted PMTiles.
- CI manifest validation from metadata to CDN upload manifest.

### 13. Tune MapLibre Runtime Settings For Mobile

ROI: Medium. Impact: medium. Difficulty: low to medium.

Recommended changes:

- Set MapLibre worker count deliberately based on device class instead of defaulting blindly.
- Consider lower `pixelRatio`/DPR rendering mode on low-end mobile if visual quality remains acceptable.
- Limit tile cache size on memory-constrained devices.
- Disable unnecessary crossfade/animation during heavy layer loads.
- Avoid triggering expensive style recalculations repeatedly; batch paint/layout updates.
- Pause hover hit-testing while the map is moving.

Expected benefit:

- Lower memory use.
- Fewer frame drops on mobile.

Verification:

- Mobile stress test with memory and long-task capture.

### 14. Workerize Geometry/Anchor/Collision Calculations

ROI: Medium. Impact: medium. Difficulty: medium to high.

Current problem:

- Election anchors, label collision, result matching, and overlay placement can involve many features/results.

Recommended change:

- Move expensive placement/collision inputs to precomputed sidecars where possible.
- Where runtime calculation remains necessary, use a Web Worker and return minimal placement output.

Expected benefit:

- Less main-thread blocking during election-layer load and zoom changes.

Verification:

- Long-task budget during election layer open and zoom.

### 15. Reduce Production Source Map And Diagnostic Payload Exposure

ROI: Medium. Impact: low to medium for normal users, high for deployment hygiene. Difficulty: low.

Current problem:

- `app.bundle.js.map` is ~6.6 MB locally.
- Source maps are not normally downloaded by users, but they can affect deployment size and accidental browser/devtools fetches.

Recommended change:

- Do not deploy source maps for `/test2` production preview unless explicitly needed.
- Or serve them with noindex/no-cache and access restrictions if useful for debugging.
- Keep diagnostics JSON out of startup; load diagnostics only when the diagnostics panel opens.

Expected benefit:

- Cleaner deploy output.
- Lower accidental transfer and less sensitive implementation exposure.

Verification:

- Pages deployment output should exclude or intentionally classify source maps.

### 16. Add A Performance Budget Dashboard

ROI: Medium. Impact: high for future stability. Difficulty: medium.

Recommended tracked budgets:

- `/test2/` cold boot JS bytes.
- Startup metadata bytes.
- First map render time.
- First catalogue render time.
- Time to load representative layers.
- Time to open Dáil 2024 and one local-government election.
- Seat-circle render time.
- DOM label count and rebuild time.
- PMTiles fallback count.
- Browser heap after idle.
- Long tasks above 50 ms.

Expected benefit:

- Prevents slow regression from repeated parity work.
- Makes mobile-readiness measurable.

Verification:

- Run in CI-safe mode for core metrics.
- Run nightly/full mode for heavier CDN and mobile cases.

## Suggested Execution Order

### Phase 1: Quick Wins

1. Remove stale FGB preloads and defer legacy election scripts.
2. Add `/test2` cache headers and content-derived bundle URL versioning.
3. Fix the mobile performance smoke so it exercises a real available tile source.
4. Parallelize grouped layer loads and fit once.

### Phase 2: Startup Architecture

1. Split `maps-test.json` into startup index/detail/search shards.
2. Code-split `/test2` into shell/catalogue/election/search/diagnostics chunks.
3. Lazy-load election manager and election manifest.
4. Move search setup into a worker.

### Phase 3: Heavy Layer/Election Optimization

1. Precompute duplicate-feature-ID sidecars.
2. Split election bundles by summary/detail/count/transfer.
3. Add LRU eviction for election bundles, feature indexes, anchors, and transfer data.
4. Optimize DOM labels and seat circles with idle/debounced rebuilds and mobile caps.

### Phase 4: Production Hardening

1. Add `/test2` service worker with quota-aware caching.
2. Add PMTiles/CDN byte-range monitoring.
3. Add broader performance dashboards and regression tests.
4. Tune MapLibre worker/cache/mobile settings based on measured results.

## Risks And Tradeoffs

- Aggressive lazy loading can cause first-use latency if not preloaded after idle. Mitigation: idle-prefetch likely next actions, such as the visible active election decade.
- Metadata sharding adds generator complexity. Mitigation: keep the full manifest as a compatibility artifact until all consumers migrate.
- DOM label/seat-circle virtualization can affect visual parity. Mitigation: only simplify during active movement or constrained mobile profiles; preserve full parity after idle.
- Long immutable caching requires robust content versioning. Mitigation: build-generated content hashes, not manual query strings.

## Bottom Line

The highest-ROI performance work is not changing MapLibre itself. It is reducing what `/test2` asks the browser to download, parse, normalize, and keep in memory before the user actually requests it. The current route should become a fast shell plus a MapLibre map, with catalogue, election, search, diagnostics, and transfer-animation systems loaded progressively.
