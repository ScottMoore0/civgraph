# v9 unity choropleth maps

Zoomable Data-Zone choropleths of the projected Irish-unity vote for the four
LucidTalk poll dates (2021-01, 2022-08, 2024-02, 2025-02).

- `unity_maps.html` — self-contained, offline: all 3,780 Data Zones as inline SVG
  paths, diverging orange(Union)↔cream(50%)↔green(Unity) scale centred on the
  referendum threshold, wheel-zoom / drag-pan, per-date tabs, hover tooltip, legend.
- Geometry: `DZ2021.fgb` (NISRA Data Zones 2021, from data.civgraph.net/data/maps/
  census-areas/), simplified to ~80 m, equirectangular-projected to an SVG canvas.
- Colours: `../areas_output/<date>_DZ21.csv` (v9 projected unity per Data Zone).
- Build: `build_page.py` (inlines the geometry+colour payload into the page).

Published artifact: https://claude.ai/code/artifact/6ca56420-40cd-40b2-a53b-e55d4e78aeb3

## Update — blue scale, full-resolution geometry, and the multi-attribute finding

- **Colour:** Union areas are now **blue** (blue=Union, cream=50%, green=Unity).
- **Full-resolution geometry:** `build_osm_page.py` now uses the **unsimplified**
  DZ2021 boundaries (1,760,787 vertices, all kept — no Douglas-Peucker). The rendered
  HTML is ~37 MB; too heavy to commit here, so it is regenerated from the R2 geometry +
  `../areas_output/`. Canvas-rendered so it stays interactive; expect a few seconds to
  load. A ~15 m-simplified variant (`unity_maps_osm.html`, ~3.5 MB) is kept for speed.
- **On "single-axis" variation between polls:** the *static* map is genuinely
  multi-attribute — projected unity correlates with Catholic-background at r=0.87
  (r²=0.76), so the other 87 census attributes (national identity, Irish/UK passports,
  Irish-language, tenure, NS-SEC, …) explain ~24% of the variation; Data Zones at the
  same ~45% Catholic still span 17–70% unity. What collapses to one axis is the
  *between-poll change*, because the only date-varying input is the poll's community
  (religion) crosstab — so the temporal signal, not the geography, is low-dimensional.
