# Triage — the 12 remaining `test2-app.spec.js` failures

> **Status: diagnosed, not fixed. 2026-08-23.** Two of the original fourteen were fixed;
> the remaining twelve share one cause that a setup tweak cannot repair.

## Result

```
before   14 failed, 28 passed
after     12 failed, 30 passed
```

## The two that were fixed

**`boots the production shell with the MapLibre adapter`** — timed out waiting for
`.flat-election-entry`. The catalogue opens on a table of contents; election rows are not
rendered until a decade is chosen. Measured: **0 before the click, 170 after**. Two of the
three selectors it waits on (`table tr` = 147, `.catalogue-flat__toc-decade-btn` = 15)
describe the TOC and were present all along, which is why it failed on the third after two
had passed. A shared `openElectionDecade(page)` helper now covers it.

**The first-card assertion** expected `'Dáil'`; the card now reads *"29 Nov 2024 - 2024
Irish general election - 43 constituencies"*. An editorial change to a display label, not
a structural one. Now accepts either wording, because the thing actually being
smoke-checked — that real entries rendered rather than placeholders — is already carried
by the `[data-election-placeholder="0"]` selector.

## The twelve, and the one cause underneath them

**`/test2/` is no longer an app. It is a compatibility redirect.**

The MapLibre stack was promoted to `/`, and `test2/` was reduced to two files: an
`index.html` that preserves search and hash and calls `location.replace('/')`, and a
service worker that unregisters the legacy `/test2/` worker. The server log shows it
plainly:

```
GET /test2/  200
GET /        200      <- the redirect firing
```

So every test in this file navigates to a route that immediately becomes `/`. Thirty pass
because what they assert is true of the app wherever it is served. Twelve fail because
they assert something specific to `/test2/` — most visibly:

```
Expected: "/test2/"
```

| Test | Error class |
|---|---|
| active-layer drag order persists | deep equality |
| restores active Dáil election catalogue, viewport, labels | timeout |
| selected Dáil constituency party pane matches main controller | **`map.eachLayer is not a function`** |
| selected Dáil 2024 Galway East pane computes percentages | deep equality |
| election party and person links open full catalogue details | toContainText |
| duplicate promoted IDs do not cross-highlight distant DEAs | equality |
| loads generated election entries with MapLibre styling | equality |
| supports catalogue detail, unsupported notices, URL restore | equality |
| restores and persists detail, source, hidden layer, panel URL state | equality |
| loads converted child layers for composite parents | deep equality |
| hash-only shell links preserve the test2 path | equality |
| does not register the production service worker | deep equality |

Two are worth calling out separately:

- **`hash-only shell links ... preserve the test2 path`** and **`does not register the
  production service worker`** are asserting the *old* arrangement outright. `/test2/`
  preserving its own path and having its own service worker were true when it was an app.
  They are false by design now.
- **`selected Dáil constituency party pane matches main controller output`** walks Leaflet
  layers — `map.eachLayer`, `getLatLng()`, `target.fire('click')` — to compare the /test2
  pane against "the main controller". Both are MapLibre now, so it compares two things
  that were meant to differ and no longer do, by a mechanism that no longer exists. Same
  class as `map-loading-pilots.spec.js`, which was deleted on 2026-08-22 for exactly this.

## What to do, and what not to do

**Do not patch these individually.** Each fix would be a small lie: making a test pass
against a redirect while it still claims to be testing `/test2/`.

The work is a decision followed by a rewrite:

1. **Decide what this file is for.** If it is the acceptance suite for the app, point it
   at `/` and delete the `/test2/`-path assertions. If it is a guard on the redirect
   still working, it should be about six tests, not forty-two.
2. **Retarget the survivors.** Thirty already pass; most would pass unchanged at `/`.
3. **Delete or rewrite the Leaflet comparison test.** There is no longer a second
   controller to compare against.
4. **Keep two small tests for the redirect itself** — that `/test2/` reaches the app with
   search and hash intact, and that its service worker unregisters cleanly. Those are the
   only `/test2/`-specific behaviours that still exist, and they are worth guarding
   precisely because `test2/` is deliberately being kept.

## Why this was not done here

Twelve tests spread across a 2,900-line file, hinging on a product decision about what
the file is for. Rushing it would produce forty-two tests that pass and assert nothing
much — which this week has already shown is worse than a red suite, because a broken test
that looks fixed stops anyone looking again.
