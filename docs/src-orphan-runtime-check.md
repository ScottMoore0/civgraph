# `src/` orphans — runtime check

> **Status: current — records a completed check and why it was needed.** Kept for
> the method (a real browser in a foreground tab), which remains the only way to
> prove the runtime is healthy.

Recorded 2026-08-11. Partial: read this before acting on it.

## Why a runtime check at all

`fgb-worker.js`, `sql.js-httpvfs/*` and `libs/pako.min.js` under `src/` have no
static importer, which is the usual signal that a file is dead. That signal is
not trustworthy here. Static analysis is exactly what cleared the `js/`
directory during the Leaflet archiving, and four build scripts were still
importing from it — the build then failed on every Cloudflare Pages deployment
for 18 consecutive commits. A worker or a `sql.js` VFS is loaded by URL string
at runtime, which no import graph shows.

## What was measured

Real Chrome against production, reading `performance.getEntriesByType('resource')`
after the app had fully initialised.

| Surface | Requests | `fgb-worker` | `sql.js-httpvfs` | `pako` | any `/src/` |
|---|---|---|---|---|---|
| `/` homepage, map rendered | 48 | none | none | none | **none** |
| `/pages/census-explorer.html` | static page, no scripts | none | none | none | none |

The homepage run is a genuine one: `__civgraphTest2BootStarted` true, a MapLibre
canvas present, attribution rendered, and both catalogues fetched
(`data/database/maps.json` and `render/metadata/maps-test-index.json`).

## A trap worth recording

The first three attempts showed no map, no canvas and no catalogue fetches, and
looked exactly like a broken production site. It was not. `app/src/boot.js`
starts the runtime inside a double `requestAnimationFrame`, and Chrome does not
fire `requestAnimationFrame` in a hidden tab. `document.visibilityState` was
`"hidden"` throughout, and a probe confirmed rAF did not fire within 3 seconds.
Focusing the tab started everything immediately.

So: **any automated check of this site must run in a foreground tab**, and a
headless or background run will report a dead app that is perfectly healthy.
That is a side effect of deferring startup work in hidden tabs, which is
reasonable behaviour, not a bug — but it will mislead anyone who does not know.

## What this does and does not establish

Establishes: none of the three is fetched on homepage load with the map running,
nor by the census explorer.

Does NOT establish that they are dead. Not yet exercised:

- loading a **chunked or FGB-backed layer** — the most likely `fgb-worker.js`
  consumer, since FlatGeobuf parsing is what a worker would be for
- `/browse/` and the `/apps/` pages
- any path that opens a SQLite database in the browser, which is what
  `sql.js-httpvfs` exists for and which nothing on the two surfaces tested does

`pako` is plausibly a transitive dependency of the FGB path rather than a direct
import, so it should be judged together with `fgb-worker.js`, not separately.

**Do not delete any of the three on the strength of this file.** Exercise the
three surfaces above first, in a foreground tab.
