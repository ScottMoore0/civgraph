# AI Agent Guide: Advanced Styling (v1)

This file is intentionally unlinked in UI. It is for agent-assisted workflow.

## What agents can do

1. Generate Advanced Styling v1 JSON scripts.
2. Explain what is currently possible.
3. Use map metadata and loaded feature attributes to build predicates.
4. Produce compact or verbose share routes.

## Where to find map metadata

- Maps catalogue: `data/database/maps.json`
- Geographies index: `data/database/geographies.json`
- Loaded feature attributes (runtime): `mapController.getLayerFeatureProperties(layerId)`

## Route and encoding

- Compact route: `#as/v1/c.<payload>`
- Verbose route: `#as/v1/v.<payload>`
- Compression: pako deflate
- Encoding: base64url
- URL hard limit: 2000 chars

## Required config keys

- `version` (`"v1"`)
- `targetLayer`
- `requiresLayers` (array, may be empty)
- optional `where`
- optional `style`
- optional `rules`

## Style fields supported

- `fillColor`
- `color`
- `weight`
- `fillOpacity`
- `opacity`
- `dashArray`
- `radius`

Field values may be literals or expression strings prefixed with `=`.

## Expression API

- Feature object: `f` (GeoJSON feature)
- Context object: `ctx`
- Helpers:
  - `ctx.attr(name)`
  - `ctx.has(name)`
  - `ctx.num(name, defaultValue)`
  - `ctx.str(name, defaultValue)`
  - `ctx.between(value, lo, hi)`
  - `ctx.votePct(party, year)`

## Notes

- Auto-load applies to all layers in `requiresLayers` and `targetLayer`.
- Styling is applied to `targetLayer` only in v1.
- If share link exceeds 2000 chars, link copy is blocked.

