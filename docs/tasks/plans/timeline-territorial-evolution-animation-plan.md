# Timeline Territorial Evolution Animation Implementation Plan

## Objective

Add a timeline animation mode for single loaded map layers. The mode should play through the loaded layer's time series, briefly compare adjacent time points, highlight territorial changes, allow pause-and-inspect interaction, and restore the originally selected layer when stopped.

The intended user experience is similar to a territorial evolution map: the user starts from one map in a time series, presses play, and watches the map advance through each available dated layer while change polygons briefly appear between each pair of dates.

## Core User Requirements

1. Add play/pause and stop buttons on the left side of the bottom timeline slider.
2. Show those controls only when exactly one compatible map layer is loaded.
3. On play, remember the originally selected layer, then move to the earliest available layer in that layer's time series.
4. Load adjacent time-series layers in pairs while comparing them.
5. Highlight territory transferred from one feature to another in translucent red.
6. Highlight split portions of earlier features in translucent purple where no single successor exists.
7. Fade transition highlights before unloading the earlier layer.
8. Repeat until the final available date in the chain.
9. Allow pause so users can zoom, pan, and inspect the temporary transition parts.
10. Make transition parts clickable/double-clickable, opening the usual top-right feature card.
11. Stop should unload temporary comparison state and restore the originally selected layer.

## Feasibility Summary

The UI and playback controller are feasible using the existing timeline infrastructure in `app/src/app.js`. The current app already derives time-series chains, slider dates, previous/next/reset actions, and layer swaps.

The territorial comparison geometry is the substantial part. It should be precomputed at build time from full source geometries. It should not be computed from rendered MapLibre tiles in the browser because vector tiles are clipped, simplified, and fragmented by tile boundaries.

The feature-card interaction is feasible once the transition geometries exist. The transition overlay can be queried before normal map features, and the card can display both earlier and later feature properties plus derived metrics.

Elevation statistics are feasible only if a DEM/elevation source is selected and processed build-side. They should not be computed client-side.

## Existing Code Touchpoints

### Timeline State

Relevant file: `app/src/app.js`

Current functions and behaviours to extend:

- `setupTimelineControls()`
- `setTimelineItems(items, activeIndex, onSelect)`
- `updateTimeline()`
- `applyTimelineTimestamp(timestamp)`
- current `timelinePrev`, `timelineNext`, and `timelineReset` button wiring

The current implementation swaps from one equivalent time-series layer to another. The new animation mode needs a state machine that can temporarily load adjacent layers together and manage transition overlays.

### MapLibre Adapter

Relevant file: `app/src/maplibre-main-adapter.js`

Useful existing capabilities:

- load/unload layer state
- query rendered features
- normalise rendered features
- feature selection/card integration points
- MapLibre overlay/source/layer management patterns

Needed extensions:

- load/unload transition overlay for a specific adjacent pair
- set transition overlay opacity for fade phases
- query transition overlay features before ordinary features
- build transition feature-card payloads
- keep map gestures native while animation is paused

### Data/Metadata

Relevant generated metadata currently drives time-series chains and layer equivalence. The new transition sidecars should be indexed from the same chain IDs or layer IDs so the runtime can discover adjacent-pair overlays lazily.

## Architecture

Use a two-layer design:

1. Build-time transition generation.
2. Runtime playback and inspection.

This keeps expensive geospatial work out of the browser and lets MapLibre remain responsible only for drawing and interaction.

## Build-Time Transition Generation

### Inputs

For each time-series chain:

- ordered list of dated map layers;
- canonical source geometry for each layer;
- stable feature IDs where available;
- feature names and source properties;
- styling metadata;
- optional DEM/elevation raster source.

### Required Geometry Normalisation

Before comparison:

1. Reproject all geometries into a suitable equal-area CRS.
2. Repair invalid geometries.
3. Normalise multipart polygons.
4. Snap or simplify where required to suppress digitisation slivers.
5. Apply minimum area thresholds.
6. Preserve a source geometry hash for provenance.

For Ireland/UK-wide administrative boundaries, the likely build CRS should be an equal-area CRS suitable for the full region. If using Irish-only data, EPSG:2157 may be appropriate; for all-islands/cross-jurisdiction data, a broader equal-area CRS should be selected deliberately.

### Successor Algorithm

For every adjacent pair, earlier layer `A` and later layer `B`:

1. Compute intersections between every earlier feature `E` and later feature `L`.
2. Build an area matrix:
   - `intersectionArea(E, L)`
   - share of `E` covered by `L`
   - share of `L` covered by `E`
3. For each earlier feature, identify the later feature with the largest overlap.
4. For each later feature, identify the earlier feature with the largest overlap.
5. Treat `L` as the successor of `E` only where both are true:
   - `L` has the greatest overlap with `E` among later-layer features;
   - `E` has the greatest overlap with `L` among earlier-layer features.
6. Where both conditions do not hold and `E` intersects multiple later features, classify the affected pieces as split territory.

### Transition Classifications

At minimum:

- `retained`: part of an earlier feature retained by its successor;
- `transferred`: part of an earlier feature assigned to a different later feature;
- `split`: part of an earlier feature where no single mutual successor exists;
- `created`: later feature area with no meaningful earlier overlap;
- `dissolved`: earlier feature area with no meaningful later overlap;
- `merge`: later feature formed from multiple earlier features;
- `sliver`: ignored or low-confidence geometry noise.

Runtime display should initially show:

- translucent red for `transferred`;
- translucent purple for `split`.

Other classifications should still exist in data for QA and future display.

### Transition Sidecar Schema

Recommended per-pair sidecar fields:

```json
{
  "transitionId": "admin-counties-1922-to-1957",
  "chainId": "admin-counties",
  "fromLayerId": "counties-1922",
  "toLayerId": "counties-1957",
  "fromDate": "1922-01-01",
  "toDate": "1957-01-01",
  "generatedAt": "2026-06-19",
  "crs": "selected-equal-area-crs",
  "areaThresholdM2": 1000,
  "featuresUrl": "https://cdn.example/.../transition.pmtiles",
  "summary": {
    "transitionFeatureCount": 0,
    "transferredAreaM2": 0,
    "splitAreaM2": 0,
    "ignoredSliverAreaM2": 0
  }
}
```

Recommended per-transition-feature properties:

```json
{
  "transitionPartId": "stable-id",
  "classification": "transferred",
  "fromLayerId": "counties-1922",
  "toLayerId": "counties-1957",
  "fromFeatureId": "earlier-feature-id",
  "fromFeatureName": "Earlier feature",
  "toFeatureId": "later-feature-id",
  "toFeatureName": "Later feature",
  "successorFeatureId": "successor-feature-id-or-null",
  "areaM2": 0,
  "perimeterM": 0,
  "elevationMinM": null,
  "elevationMeanM": null,
  "elevationMaxM": null,
  "fromProperties": {},
  "toProperties": {},
  "confidence": "high",
  "warnings": []
}
```

### Storage Format

Use small GeoJSON only for initial prototypes or very small layers. For production, prefer tiled transition overlays:

- PMTiles or equivalent vector tiles for large chains;
- immutable CDN/R2 URLs;
- manifest in the repo/static build;
- lazy-load only the current adjacent transition pair;
- cache the previous/current/next pair only.

## Runtime Playback Design

### UI

Add controls to the bottom timeline:

- play/pause button;
- stop button;
- existing previous button;
- existing next button;
- existing reset button;
- slider.

Display the new buttons only when:

- exactly one visible compatible map layer is loaded;
- the loaded layer belongs to a time series with at least two available layers;
- transition manifest coverage exists for at least one adjacent pair;
- no election layer or incompatible non-map mode is active.

If one layer is loaded but transition overlays are missing, either hide the controls or show a disabled play button with a concise tooltip.

### Animation State Machine

Recommended states:

- `idle`
- `preparing`
- `playing`
- `transitionVisible`
- `fading`
- `paused`
- `stopping`
- `error`

State should track:

- original layer ID;
- original date/timestamp;
- chain ID;
- current index;
- next index;
- loaded comparison layer IDs;
- active transition sidecar ID;
- timer IDs;
- cancellation token;
- whether reduced-motion is active.

### Playback Sequence

1. User clicks play.
2. Save original map layer and viewport state.
3. Jump timeline to earliest available layer in the chain.
4. Load earliest layer.
5. Wait a short configurable delay.
6. Load next layer without unloading earliest layer.
7. Load transition overlay for earliest-to-next.
8. Show red/purple transition parts.
9. Keep both layers and overlay visible for inspection interval.
10. Fade transition overlay.
11. Unload earlier layer and transition overlay.
12. Keep later layer as the current base layer.
13. Advance to the next adjacent pair.
14. Repeat until the chain ends.
15. Stop automatically at the last layer, or leave the last layer visible depending on final UX decision.

### Stop Behaviour

Stop must:

- cancel all timers;
- unload transition overlays;
- unload temporary comparison layers;
- restore the original layer;
- restore the timeline slider to the original timestamp;
- leave map viewport either unchanged or restored based on final UX decision.

Recommended default: restore the original layer but preserve the user's current viewport, because users may have zoomed during playback.

### Pause Behaviour

Pause must:

- freeze the current state;
- leave currently visible transition parts on the map;
- leave the map fully interactive;
- keep MapLibre gestures native;
- allow click/double-click of transition parts;
- allow resume from the same phase.

If the user changes active layers while paused, the animation should cancel cleanly.

## Transition Feature Cards

### Interaction Rules

When transition overlays are visible:

1. Query transition overlay features first.
2. If a transition feature is hit, open a transition feature card.
3. Otherwise fall back to normal feature click behaviour.
4. Double-click should select transition features without triggering unwanted map zoom where possible.

### Card Content

The top-right feature card should show:

- transition title;
- transition type;
- earlier layer name/date;
- later layer name/date;
- earlier feature name;
- later feature name;
- area;
- perimeter;
- elevation min/mean/max where available;
- earlier feature properties;
- later feature properties;
- warnings or confidence labels where relevant.

### Example Title Patterns

- `Transferred territory: Earlier Name -> Later Name`
- `Split territory from Earlier Name`
- `Created territory in Later Name`
- `Dissolved territory from Earlier Name`

## Styling

Recommended defaults:

- transferred territory: red translucent fill, deeper red outline;
- split territory: purple translucent fill, deeper purple outline;
- hover: stronger outline and modest opacity increase;
- selected: persistent outline and feature card;
- fade: opacity transition, not geometry reload if possible.

Dark mode should use the same semantic colours but tune opacity/outline contrast.

## Performance Requirements

Avoid these during active pan/pinch/playback:

- repeated catalogue rerenders;
- continuous URL writes;
- repeated full map resize calls;
- rebuilding all labels every frame;
- loading all transition overlays at once;
- computing geometry intersections in the browser.

Use:

- lazy transition sidecar loading;
- abortable fetches;
- small state transitions;
- requestAnimationFrame only for opacity/fade effects;
- timer cleanup on stop/navigation;
- reduced-motion mode with shorter/no fade animation.

## Validation And QA

### Build-Time Validation

For every generated transition pair:

- source geometries loaded successfully;
- all features have stable IDs or generated IDs;
- invalid geometries repaired or reported;
- area matrix totals reconcile within tolerance;
- ignored sliver area below threshold;
- successor mapping confidence recorded;
- no transition sidecar lacks provenance.

### Runtime Tests

Add browser tests for:

- controls hidden when zero layers are loaded;
- controls hidden when multiple layers are loaded;
- controls visible for one supported time-series layer;
- play starts at earliest time point;
- adjacent layers are temporarily co-loaded;
- transition overlay appears;
- pause leaves map gestures working;
- clicking a transition part opens a card;
- stop restores original layer;
- route/layer changes cancel playback;
- reduced-motion mode works.

### Visual Tests

Use known chains with manually verified expected transitions:

- no-change adjacent pair;
- simple transfer;
- split case;
- merge case;
- deleted/created feature case;
- province/child map alias case.

### Performance Tests

Measure:

- initial load unchanged;
- transition overlay fetch time;
- animation frame smoothness;
- memory after repeated play/stop cycles;
- mobile pan/pinch responsiveness while paused;
- cancellation behaviour under slow network.

## Data Decisions Required

These decisions should be made before full rollout:

1. Which equal-area CRS to use for all-islands comparisons.
2. Minimum sliver area threshold.
3. Whether successor ranking uses absolute overlap area or percentage overlap; recommended: absolute overlap for primary match, with percentage thresholds for confidence.
4. Whether final playback state should remain at final layer or restore original layer when natural playback ends.
5. Which DEM/elevation source to use.
6. Whether elevation stats are required for first release or can be added later.
7. Which classifications beyond red/purple should be visible to users.
8. Whether transition sidecars should be generated for every time series immediately or rolled out chain-by-chain.

## Implementation Phases

### Phase 1: Design And Metadata Contract

- Define transition manifest schema.
- Define transition feature property schema.
- Define runtime compatibility conditions.
- Add validation stubs.
- Pick two representative time-series chains for pilot testing.

Deliverable: schema, validation script, and pilot chain list.

### Phase 2: Build-Time Transition Prototype

- Write a generator for one chain.
- Load source geometries.
- Repair/reproject geometries.
- Compute pairwise intersections.
- Generate successor/split classifications.
- Emit GeoJSON sidecar for a small pilot pair.
- Validate area totals.

Deliverable: one verified adjacent-pair transition overlay.

### Phase 3: Runtime Overlay Rendering

- Add MapLibre adapter methods for transition overlays.
- Render transferred/split polygons above normal layers.
- Add hover and selection styling.
- Add feature-card payloads.

Deliverable: manually loadable transition overlay with clickable cards.

### Phase 4: Timeline Playback Controller

- Add play/pause/stop controls.
- Add animation state machine.
- Add dual-layer temporary loading.
- Add fade/unload phases.
- Add stop restore.
- Add cancellation on layer/route changes.

Deliverable: working playback for pilot chain.

### Phase 5: Productionise Transition Packaging

- Convert large transition GeoJSON outputs to PMTiles/vector tiles.
- Store bulky transition sidecars on R2/CDN.
- Keep compact manifests in repo/static build.
- Add lazy loading and abort handling.
- Add CDN availability checks.

Deliverable: production-safe transition bundle path.

### Phase 6: Elevation Metrics

- Select DEM source.
- Add zonal-stat computation for transition polygons.
- Store min/mean/max elevation in transition properties.
- Add missing-elevation warnings.

Deliverable: elevation-enriched transition feature cards.

### Phase 7: Full Chain Rollout

- Generate transition overlays chain-by-chain.
- Validate each chain.
- Enable controls only for validated chains.
- Add QA screenshots and known-case fixtures.

Deliverable: progressively enabled territorial animation across supported time series.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Browser-side geometry from tiles is inaccurate | False red/purple regions | Precompute from full source geometries |
| Historical boundaries have digitisation slivers | Visual noise | Snap/repair/threshold and mark low-confidence |
| Feature IDs are inconsistent across dates | Bad successor matching | Use geometry overlap matrix and optional name matching only as evidence |
| Transition bundles become large | Slow first load/mobile instability | Lazy-load one adjacent pair at a time from CDN/R2 |
| DEM processing is expensive | Delayed rollout | Make elevation metrics optional in first release |
| Multiple active layers create ambiguous playback | Confusing UI | Hide controls unless exactly one compatible layer is active |
| User changes layers during playback | Stale overlays | Use cancellation tokens and cleanup hooks |
| Animation hurts map gestures | Poor mobile UX | Keep MapLibre native gestures and do not rebuild UI during movement |

## Recommended First Pilot

Start with one administrative/electoral time series where:

- full source geometries are already available;
- feature counts are moderate;
- boundaries are known to change;
- dates are already represented in timeline metadata;
- visual QA can be performed easily.

After the pilot works, expand to more chains only after validation catches slivers, unmatched features, and split/merge cases reliably.

## Definition Of Done

The feature is complete when:

1. Timeline play/pause/stop controls appear only for supported single-layer chains.
2. Playback starts at the earliest layer in the chain.
3. Adjacent layers are co-loaded during transition phases.
4. Red and purple transition parts are displayed according to validated sidecar data.
5. Transition parts fade before the earlier layer unloads.
6. Stop restores the original selected layer.
7. Pause allows pan/zoom and transition feature inspection.
8. Transition feature cards display both earlier and later feature properties.
9. Area/perimeter are shown for transition parts.
10. Elevation stats are shown where the selected DEM supports them.
11. Browser tests cover play, pause, stop, route cancellation, and feature-card interaction.
12. Build-time validation prevents unsupported chains from exposing animation controls.
