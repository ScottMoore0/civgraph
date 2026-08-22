# Plan — composable maps and shareable derived views

> **Status: ready to execute.** Written 2026-08-23. Covers "custom secondary maps with
> shareable URLs", composable time-series maps, and the electoral-division population map
> 1901–2027 — which is **not a feature in this plan, it is the acceptance test for it**.

## The reframe, and why it is the important part

The ED population map was on the goals list as its own item. It should not be built as
one. If it is, we get a bespoke page that answers exactly one question, and the next
question — the same map for housing, or for Irish speakers, or for a different date range
— needs another bespoke page.

Build the composition tooling; the ED population map is then the first thing someone
makes with it, and it is how we know the tooling works. **If the population map cannot be
expressed in the composer, the composer is not finished.**

## What already exists

| Piece | Where | State |
|---|---|---|
| URL state round-trip | `app/src/app.js` `restoreURLState` / `updateURLState` | works; carries layers, viewport, base map, election state |
| Legacy id aliasing | `app/src/app.js` `LEGACY_LAYER_ID_PREFIXES` | works; share links survive renames |
| Time-series chains | `data/database/maps.json` `timeSeriesChains` | **17 chains**, e.g. `wards` spanning the 1972 reorganisation via `ni-wards` + `ni-deds` |
| Timeline slider + animation | `app/src/app.js` `setupTimelineControls` | works; the rebuild race was fixed 2026-08-21 |
| Conditional styling | `test/src/conditional-styling.js`, `.cs-legend` | works; drives choropleths |
| Feature attributes in tiles | per-layer, verified | attribute pruning applies below z8 — **see constraint below** |

So roughly two thirds of the machinery exists. What is missing is a **composition model**
and a UI over it.

## The model

A derived map is a document, not a page. Proposed shape:

```jsonc
{
  "v": 1,
  "base": "eds-1911",              // a layer id, or a chain id for time series
  "chain": "eds",                  // optional: makes it a time-series composition
  "join": { "on": "civ_fid" },     // how data attaches to geometry
  "data": [
    { "source": "census", "table": "population", "year": 1911, "as": "pop" }
  ],
  "derive": [
    { "as": "density", "expr": "pop / area_km2" }
  ],
  "style": { "mode": "choropleth", "by": "density", "scale": "quantile", "bins": 7 },
  "label": "Population density, 1911"
}
```

Three properties that matter:

- **Declarative.** No user-authored JavaScript. It can be validated, stored, diffed, and
  rendered server-side later for thumbnails or static exports.
- **Serialisable to a URL.** Compact JSON → deflate → base64url in the hash. Long
  compositions get a short id via KV, with the full document still in the URL as the
  fallback so a link never depends on a lookup surviving.
- **Composable over time, not just space.** `chain` plus a year-bearing `data` entry is
  what makes the 1901–2027 map a composition rather than a special case.

## The hard constraint nobody will remember

**Attribute pruning removes non-primary attributes below z8.** That was deliberate and it
recovered 25,143 features on one layer alone — but a composer that styles by an attribute
will find it absent at low zoom and silently render nothing.

Two options, and this must be decided before the styling step is built:

1. **Composition attributes bypass the tile.** The composer joins data client-side by
   `civ_fid` from a separate fetch. Keeps tiles lean; costs a request per composition.
2. **Styled attributes are added to the low-zoom keep-set.** `lowZoomColumns()` already
   takes `styleFieldReferences(layer)` — extend it to read composition documents.

**Recommendation: option 1.** Compositions are user data, not layer data, and baking them
into tiles means rebuilding tiles when someone makes a map.

## Steps

1. **Schema and validator.** `data/schemas/composition.v1.json` plus
   `scripts/validate-composition.mjs`. Negative-controlled: a composition naming a
   non-existent layer, attribute or chain must fail.
2. **URL codec.** `app/src/composition-url.js` — encode/decode, with a round-trip test over
   a corpus of 50 generated documents. Cap the URL at 2,000 characters and fall back to a
   KV-stored short id beyond that.
3. **Data resolver.** Given a `data` entry, return `{ civ_fid → value }`. First source:
   census tables. This is where most of the work is, because it needs the join keys to be
   real — see the dependency below.
4. **Renderer.** Apply `style` to the base layer via a MapLibre expression built from the
   resolved values. Reuse `conditional-styling.js` rather than adding a second styling path.
5. **Composer UI.** Pick a base, pick a variable, pick a style, see it, copy the link.
   Deliberately last: with 1–4 done, the composer is a form over a working system, and a
   composition can be hand-written in the URL before any UI exists.
6. **Acceptance: build the ED population map** as a composition document, checked into
   `data/compositions/ed-population-1901-2027.json`, and link it from the catalogue as a
   featured example.

## Dependency

Step 3 needs stable join keys between census tables and boundary features across 126
years of changing boundaries. That is the **entity model** problem, and this plan assumes
it. Attempting step 3 first means inventing a join layer that the entity model then
replaces.

**Do the entity model first, or accept that step 3 initially supports only layers whose
features already carry a census area code.**

## Definition of done

- A composition can be written by hand, put in a URL, and renders.
- The ED population map exists as a document, not code.
- A second, unrelated composition (say Irish speakers by DED, 1926) is made in under ten
  minutes by editing the first.
