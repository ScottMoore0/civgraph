# Catalogue pane: capability checklist

Every capability of the current catalogue pane, and what the rebuilt pane (`src/catalogue/`) does
with it: **kept** (same capability, possibly in a new place) or **replaced** (a deliberate change,
with the reason). Each line is checked by a browser test in `catalogue.spec.cjs` whose title
starts with the capability's number, e.g. `C03 …`.

Run: `npm run test:catalogue` (unit tests, then the browser tests against the test site).

| # | Current pane | Rebuilt pane | Status |
|---|---|---|---|
| C01 | Every series listed by category, with thumbnail, years and extent | Every series is one row under its shelf and subject: thumbnail, name, jurisdiction, years, number of editions | kept |
| C02 | One click loads any map from the list (+ on every row) | Each edition is a chip that adds its map in one click (Add for single maps); clicking again removes it | kept |
| C03 | Show or hide a loaded map from the list | Hide or Show in the row's menu and the opened row (and the active-layers panel as before) | kept |
| C04 | Copy a map's shareable link | Copy link in the row's menu and the opened row | kept |
| C05 | Download the FlatGeobuf file | Download, in the row's menu and the opened row | kept |
| C06 | Download the provider's own files (GeoJSON, KML, Shapefile, CSV, print rasters) and the original GeoJSON | All listed under Download, as before | kept |
| C07 | Variants of a map behind a ▼ button | Other versions of an edition (e.g. 1993 at 1:50k and large scale) and parts (county sheets, LiDAR tiles) as chips in the opened row | kept |
| C08 | A map's details page (style, keywords, references, attributes) | Details opens the same page | kept |
| C09 | Provider and feature count on each map | On each chip's tooltip, on single-map rows, and in the opened row | kept |
| C10 | The colour each layer is drawn in, as a stripe | Each chip's dot, and its fill while on the map; the row's stripe | kept |
| C11 | Thumbnail preview on hover | Same preview, same code | kept |
| C12 | "Show N to be added" on each card | "Show N to be added" on each series that has them; the maps join its chips in date order. Cards with nothing drawable yet (e.g. Assembly Areas) are rows of their own | kept |
| C13 | Category chips at the top, jumping to a section | A contents button left of the search box: a panel from the right lists every shelf and subject (decades on Elections, categories on Books), marks where you are, and jumps there | replaced: one list for every section, always in reach |
| C14 | Elections by decade, with thumbnails, loaded in one click | Same, plus filters by body (devolved, European and referendum bodies grouped), kind, where and years, and a link to each election's results page | kept |
| C15 | "Show N more" by-elections in each decade | Kind filter: all, general elections, by-elections | replaced: one filter for all decades |
| C16 | Books with covers, View, Markdown and Archive.org | Same cards, built by the same code, under the same category icons | kept |
| C17 | Search finds places (named features), each with thumbnail and load, show, link and download buttons | Places, grouped by name, each map's copy with the same buttons | kept |
| C18 | Search finds maps and elections | The same list, filtered in place; typos and years understood; constituency names find their elections | kept |
| C19 | Search finds parties (and people and sources, where indexed) | Same records, same links | kept |
| C20 | Tables tab | Tables in the section bar | kept |
| C21 | Links to cards (`#flat-card-…`) | Land on the series, opened | kept |
| C22 | History, Back and Home buttons by the search box | Untouched | kept |
| C23 | The section bar (Maps, Elections, Books, Tables) | Same bar and styling, with counts; Maps first | kept |

New in the rebuilt pane (no counterpart in the current one): filters by jurisdiction (NI, ROI,
Ireland), kind and years (a slider), the timeline of editions, compare two editions, cite, an
address for every view with Back and Forward, keyboard movement along chips, and search that
tolerates typos and understands years. Built but not shown for now: "What's here?" (still reachable
by address) and an "On the map" filter.
