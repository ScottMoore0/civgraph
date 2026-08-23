# `test2-app.spec.js` — retargeted at `/`, and what is left

> **Status: retarget done, 2026-08-23. 14 failures → 7.** The remaining seven are
> individual assertions, not one shared cause, and each needs its own answer.

## What was done

`/test2/` is not an app. It is a compatibility redirect: an `index.html` that preserves
search and hash and calls `location.replace('/')`, plus a service worker whose only job is
to unregister the legacy `/test2/` worker. The server log shows it firing:

```
GET /test2/  200
GET /        200
```

So a 2,900-line acceptance suite had been navigating to a route that immediately became
`/`. Thirty tests passed for the wrong reason and twelve failed on assertions about a path
that no longer serves anything.

| Change | Count |
|---|---|
| navigations retargeted `'/test2/…'` → `'/…'` | 31 |
| path assertions retargeted | 7 |
| obsolete tests removed | 2 |
| focused redirect guards added (`test2-redirect.spec.js`) | 2 |
| tests fixed outright | 2 |
| annotated with a measured product finding | 1 |

**Removed, not repaired:**

- **`does not register the production service worker`** — asserted that staging must not
  register the production worker. At `/` it must, so the assertion is false by design.
- **`selected Dáil constituency party pane matches main controller output`** — walked
  Leaflet layers (`map.eachLayer`, `getLatLng()`, `target.fire('click')`) to compare
  against "the main controller". Both are MapLibre now, so it compared two things meant to
  differ that no longer do, by a mechanism that no longer exists.

**The two redirect guards are the whole of what `/test2/` still needs.** A `_redirects`
rule could do the first and cannot do the second — a redirect never runs, so it can never
unregister a service worker, and anyone who loaded `/test2/` before June 2026 still has
that worker installed. That is why `test2/` is kept.

## Where it stands after the second pass

```
14 failed  ->  6 failed, 36 passed
```

The file is now `tests/browser/app.spec.js` and its 39 test titles no longer begin
`/test2 `, because every one of them loads `/`.

### Two fixed, and one of them was a real bug with a one-line cause

**`duplicate promoted IDs do not cross-highlight distant DEAs`** — not a regression. It
forced the layer onto its MVT dev fallback,
`/render/tiles/generated/deas-1972/{z}/{x}/{y}.pbf`, which is a gitignored local artefact
and is not present. The tiles 404ed, nothing rendered, and `duplicateIdDetected` came back
false. It now runs against PMTiles, which is what production serves — testing the dev
fallback tested a path no visitor uses. Passes.

**`setTimelineItems` matched the wrong item, always.** The predicate was

```js
item.mapId === requested.mapId || item.timestamp === requested.timestamp
```

Election timeline items carry `{ label, body, date }` and have **neither** field, so both
comparisons read `undefined === undefined`, matched the **first** item, and the slider
snapped to index 0. Measured: loading the 2024-07-04 UK general election gave
`activeEntry.date` `"2024-07-04"`, a 60-item timeline starting 1922-11-15, and a slider
reading **"15 Nov 1922"**. `updateElectionTimeline` computed the right index and handed it
over; it was discarded one function later.

Each clause now requires the field to be present on the requested item before it can
match, and elections match on body+date. This is a **user-visible fix**: load any election
and the timeline now shows its date instead of the earliest in the series.

### Where it ended

```
whole browser suite:  87 passed, 3 skipped, 0 failed
```

Three of the five known-broken tests were resolved on 2026-08-23. **One was a product
bug; two were my own test code, and I had mis-stated both.**

| Was skipped | Verdict | What it actually was |
|---|---|---|
| restores active Dail election catalogue | **product fix** | the catalogue opens on a TOC, so election rows exist only inside an opened decade card. Restoring from a URL had nothing to mark. It now opens the decade holding the election, so the test no longer depends on a neighbour to set up its precondition |
| active-layer drag order persists | **test** | the drop landed 12px BELOW the row, outside the droppable region. Reordering was never broken |
| loads converted child layers | **test** | "134 children" was the DIFF LINE COUNT. The five expected children arrived in the right order, as configs rather than id strings -- a shape `loadLayer(mapOrId)` accepts by design |

| Still skipped | What was measured |
|---|---|
| loads generated election entries | `.election-results-table--constituency-party` count 0; the class still exists at election-manager.js:1656 |
| election party and person links | detail view renders 4,412 chars, expected substring absent |
| mobile catalogue first open (other file) | catalogue opens on a TOC and renders no cards |

**Two assertions inside the restore test were wrong about the data, not the product.**
The row's label is the election's *name* and does not repeat the body, so the body is now
asserted from `data-election-body`. And sorting votes descending puts Fianna Fail
(481,414) first, not Fine Gael (458,134) -- and asserting the first row could not have
caught a broken sort in any case, because the default seats order also begins with Fianna
Fail. The top three discriminate: seats order is FF, SF, FG; votes order is FF, FG, SF.

**The pattern across all three.** In each case I had recorded a confident claim -- "the
only remaining candidate for a genuine regression", "134 children where 5 are expected",
"a 27x change" -- and in each case the measurement contradicted it. The one that was real
was the one I had described as merely order-dependent.

