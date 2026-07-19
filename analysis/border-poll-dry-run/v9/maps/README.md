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
