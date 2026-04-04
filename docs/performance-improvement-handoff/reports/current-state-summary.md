# Current State Summary

This file summarizes the current baseline captured for the repo at the time the handoff package was assembled.

## Startup and build snapshot

- build output currently contains:
  - `build/app.bundle.js`
  - `build/app.bundle.js.map`
- reported build totals:
  - total build bytes: about `2.1 MB`
  - JS: about `538 KB`
  - CSS in `build/`: `0 B`

## Startup import snapshot

- startup path from `js/app.js` currently visits `8` local modules
- no dynamic imports were detected from the startup entry
- high-value deferrable candidates called out by the script:
  - `js/election-controller.js`
  - `js/map-controller.js`
  - `js/time-slider-controller.js`
  - `js/ui-controller.js`

## First-load asset snapshot

- `index.html` head currently contains:
  - `11` link tags
  - `0` script tags in head
  - `6` likely render-blocking stylesheets
- notable blocking assets include:
  - Google Fonts stylesheet
  - Leaflet CSS from CDN
  - main site CSS
  - election viewer CSS
  - Font Awesome CSS from CDN

## Font snapshot

- the font usage report found:
  - `25` files scanned
  - `21` distinct `font-family` tokens
  - `2` Google Fonts family query tokens
- current head query includes `Inter`
- other CSS also references fonts including `Source Code Pro`

## Map performance metadata snapshot

- maps scanned: `327`
- `useLOD`: `101`
- `chunked`: `7`
- `chunked + useLOD`: `1`
- explicit `chunkLoadConcurrency`: `1`

## Dependency usage snapshot

- dependencies scanned: `10`
- code files scanned: `28`
- the report detected no direct import site for:
  - `@playwright/test`
  - `@turf/helpers`
  - `xlsx`

## How to use this

- treat this summary as a convenience index only
- use the adjacent report text files as the actual captured evidence
- re-run the handoff-local scripts before making major decisions if the repo state has changed materially

