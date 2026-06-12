# Leaflet Main Archive Before MapLibre Root Promotion

The pre-promotion Leaflet main site is archived at git tag:

`leaflet-main-before-maplibre-root-20260612`

Archived commit:

`eaf3311c5bd2faf78c796f6aa067049c689b7929`

This archive is intentionally non-destructive. The promotion keeps shared source files in place and does not delete generated map, election, PMTiles, or browse data. To inspect or restore the former Leaflet root shell, check out the tag:

```bash
git checkout leaflet-main-before-maplibre-root-20260612
```

The live root route is now generated from the `/test2` MapLibre shell by `scripts/promote-test2-root.mjs`; `/test2` remains available as a compatibility route.
