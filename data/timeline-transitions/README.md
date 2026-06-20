# Timeline Transition Sidecars

This directory contains lazy-loaded GeoJSON sidecars for the territorial-change timeline animation.

Naming uses canonical source map IDs:

```text
{fromSourceMapId}__{toSourceMapId}.geojson
```

The app first checks the loaded MapLibre layer IDs and then falls back to each layer's `sourceMapId`, so generated vector-layer variants can share one canonical sidecar.

Current generation rule:

- Build polygon intersections between adjacent time-series layers.
- Keep only non-mutual-primary transition pieces, meaning pieces that are not the largest overlap in both directions between the earlier and later feature.
- Exclude all pieces under `100 m2`.
- Mark pieces as `split` when the earlier feature has multiple significant successors; otherwise mark them as `transfer`.

The generated properties retain source and target feature names, IDs, area shares, and original source properties so the MapLibre feature card can explain the territorial part.

Regenerate with:

```bash
npm run build:timeline-transitions
```
