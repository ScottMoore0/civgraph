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

## The seven that remain

None share a cause. Each is an assertion whose expectation stopped matching the product.

| Test | What it needs |
|---|---|
| active-layer drag order persists and controls MapLibre draw order | deep-equality mismatch on layer order; check whether draw order or the reported shape changed |
| **restores active Dáil election catalogue, viewport, labels, party table** | **annotated `test.fail()` — real finding, see below** |
| selected Dáil 2024 Galway East pane computes percentages and resizes | deep-equality on computed percentages; verify against the published result before touching |
| election party and person links open full catalogue details | `toContainText` — likely a label change, same class as "Dáil" → "Irish general election" |
| duplicate promoted IDs do not cross-highlight distant DEAs | expected `true`, received `false`; this one is worth treating as a possible real regression |
| loads generated election entries with MapLibre styling | expected `"04 Jul 2024"`, received `"15 Nov 1922"` — an **ordering** assumption, not a data fault |
| loads converted child layers for composite parents | deep-equality on the child layer set |

Two are worth separating from the rest:

- **`duplicate promoted IDs do not cross-highlight distant DEAs`** is the only one whose
  failure shape suggests a genuine behavioural regression rather than a stale expectation.
  Start here.
- **`loads generated election entries`** expects the first entry to be July 2024 and gets
  November 1922. With a table-of-contents catalogue, "first" depends on which decade is
  open. Assert on a located entry rather than on ordering.

## The product finding

**Restoring an election from a URL leaves the catalogue with no active indication.**

Measured after loading `#layers=election-dil-ireann-2024-11-29`:

```
election rows rendered                            0
rows marked --active                              0
election pane present                           yes
after opening the 2020s decade by hand:   170 rows, still 0 active
```

`focusActiveElectionCatalogueEntry` in `app/src/app.js` looks for a row among
`#catalogueFlatView .flat-election-entry`, finds none because the catalogue defers
election rows until a decade is chosen, retries once, and gives up. The election loads on
the map and the catalogue shows no sign of which one it is.

The retry logic exists precisely because this was meant to work, so this is a regression
from the TOC redesign rather than a design decision.

**An attempted fix was reverted.** Making `focusRow` open the decade itself — deriving
"2020s" from the entry date, clicking the matching `.catalogue-flat__toc-decade-btn`, then
polling for the rows — did not restore the active marking. Either the synthetic click does
not reach the delegated handler, or `focusActiveElectionCatalogueEntry` is not on this
restore path at all. Left out rather than committed half-working; it needs someone who
knows the catalogue render lifecycle.

## One naming loose end

The file is still called `test2-app.spec.js` and its test titles still begin `/test2 …`,
while every one of them now loads `/`. Renaming both is cosmetic and correct, and was left
out of this pass only to keep the diff readable — the retarget is 38 substantive edits and
a rename would have buried them.
