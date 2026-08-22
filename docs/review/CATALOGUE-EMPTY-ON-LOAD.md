# The catalogue renders nothing on first load

> **Status: confirmed and reproducible, not diagnosed to root cause. 2026-08-23.**
> This is written up rather than fixed because the remaining step is a real debugging
> session, and half-fixing it would have been worse than recording it accurately.

## What happens

Load `https://civgraph.net/` (or the local server at `/`). The catalogue pane shows its
heading, its lede, the search box and "FILTER BY PROVIDER". It shows **no maps at all**.

Measured after the runtime settles:

```
totalMaps                     1012      the controller knows about them
[data-map-id] elements           0
.map-card / .class-member        0
.c1-grid-entry                   0
#mapList / .map-list             0
catalogue shell elements     present     catalogue-sticky-shell, catalogue-intro,
                                         catalogueNav (4 children, no text), catalogueBack
```

So the data is loaded, the chrome is rendered, and the list is absent.

## What is not the cause

- **Not lazy rendering pending interaction.** Calling
  `uiController.renderFlatView(uiController._lastMapListOptions)` directly completes
  **without throwing** and produces no rows.
- **Not a stale test selector.** Six different selectors were probed, including
  `[data-map-id]`, which matches anything in the DOM carrying a map id. Zero.
- **Not the console errors.** The two `501 (Unsupported method ('POST'))` and one `404`
  come from the local static test server, which does not implement POST. They are absent
  in production and unrelated.

## The lead

`uiController.els` is **null** at the point `renderFlatView` runs. The controller's
element references were never bound, so the render has nowhere to write and exits
quietly. `renderFlatView` returning cleanly while doing nothing is what made this hard to
see from the outside — and is itself worth fixing, whatever the root cause.

Start at whatever populates `els` on the UI controller and work out why it is unset on
this path, then check whether `renderFlatView` should be refusing loudly when it has no
container.

## How it was found

Two browser tests fail on this, independently, and had been dismissed as stale:

- `mobile-catalogue-performance.spec.js:43` — asserts a catalogue row gains a loaded
  class; the row never exists.
- `mobile-catalogue-performance.spec.js:264` — asserts `mapCards > 0`; receives 0.

Both were annotated `test.fail()` on 2026-08-22 with the diagnosis "the catalogue is not
rendered until opened". That explanation was wrong. The catalogue is not rendered at all.

**Do not loosen either assertion to make the suite green.** They are currently the only
automated evidence that anything is wrong.

## Why this matters more than its ticket size suggests

If this reproduces for real visitors, the site's primary surface — a catalogue of 1,012
maps — is empty on arrival, and every other improvement to it is invisible. Confirm
against production in a real browser before anything else; the local server and the
deployed site agree on every other measurement taken this week, but this one is worth
checking directly.
