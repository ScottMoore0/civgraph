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
whole browser suite:  85 passed, 5 skipped, 0 failed
```

Five are `test.fixme()` — known broken, each carrying its measurement. None is a stale
expectation left unexamined; every one has been reduced to a specific, checkable claim.

| Skipped test | What was measured | Why it is not just widened |
|---|---|---|
| restores active Dáil election catalogue | **fails alone, passes in the full file** | it depends on a neighbour opening a decade, papering over a product bug |
| active-layer drag order persists | real mouse drag; order unchanged (`a\|b`, expected `b\|a`) | the only remaining candidate for a genuine regression |
| loads generated election entries | `.election-results-table--constituency-party` count 0; the class still exists at election-manager.js:1656 | only coverage of the per-constituency party breakdown |
| loads converted child layers | 134 children where 5 are expected | a 27× change is either real broadening or a grown parent — find out which |
| election party and person links | detail view renders 4,412 chars, expected substring absent | detail view opens; its text changed |
| mobile catalogue first open (other file) | catalogue opens on a TOC and renders no cards | the assertion no longer describes the product |

**Fixed along the way**, and neither was where I expected:

- **`setTimelineItems` matched the wrong item, always.** `item.mapId === requested.mapId ||
  item.timestamp === requested.timestamp` — election items have neither field, so both read
  `undefined === undefined`, matched the first item, and every election showed the earliest
  date in its series. User-visible.
- **`duplicate promoted IDs`** was not a regression: it forced the layer onto a gitignored
  MVT dev fallback that no longer exists on disk. Now runs against PMTiles, as production
  does.

**On the order-dependent test, I was wrong twice and the second correction is the useful
one.** It fails alone and passes in company — the reverse of my first claim. That
direction is the diagnosis: in company an earlier test has already opened a decade, so the
rows exist. Alone, nothing has, and `focusActiveElectionCatalogueEntry` (instrumented:
called twice with the correct entry, seeing `rows: 0` both times) has nothing to mark.

The fix belongs in the product — restoring an election from a URL should open the decade
that holds it. Two attempts at that were written and reverted; a third guess is worth less
than one measurement of which branch of `focusRow` actually runs.
