# Plan — charts, infographics, and "performance by party"

> **Status: ready to execute.** Written 2026-08-23. Covers the infographic/chart creator
> and the "performance by party" election styling mode, which are the same plan: the
> party mode is the first chart, and building it first is how the general tool avoids
> being designed in the abstract.

## Sequencing, and why this order

"Infographic/graph/chart creator" is a product. "Performance by party" is a fortnight.
Building the general tool first means guessing at what charts people want; building the
specific one first means the general tool is a generalisation of something that already
works and is already used.

**Build performance-by-party. Then generalise it. Do not start with a chart library and
a blank canvas.**

## Part 1 — performance by party

### What exists

- **281 elections** in `render/metadata/elections-test2.json`, each with `votingSystem`,
  `constituencies`, `matchedCount`/`unmatchedCount`, and a `sourceMapId` binding it to
  geometry.
- `app/src/election-manager.js` already has styling modes (`stylingModes`, `activeMode`,
  default `winner`), a legend (`test2ElectionLegend`), and a geography toggle.
- Party colours: `data/elections/parties`, `party-colour-review-overrides.json`.

So the mode plugs into an existing mechanism. This is not new architecture.

### The design question that decides the work

"Performance" is ambiguous and the answer changes the implementation:

| Reading | Renders as | Needs |
|---|---|---|
| Share of first-preference votes | choropleth, one party, 0–100% | vote totals per constituency — **have** |
| Seats won | categorical, sparse | seat allocation — have for most |
| Change since the previous election | diverging choropleth, ±% | the previous election matched to the same geography — **hard** |

**Recommendation: build reading 1 first**, as `stylingMode: 'party-share'` with a party
picker. It is unambiguous, it works for every voting system in the corpus, and it is the
one people mean most often. Reading 3 is the interesting one and depends on
constituency-to-constituency matching across boundary changes — which is the entity
model again.

### Steps

1. Add `party-share` to `DEFAULT_MODE_ORDER` and the mode selector.
2. Party picker, populated from parties actually standing in that election, ordered by
   total vote.
3. Sequential colour ramp keyed to the party's own colour, with a fixed 0–100% domain so
   two elections are visually comparable. **Do not use a quantile scale here** — it makes
   a party look strong in an election it lost.
4. Legend showing the ramp and the party name; reuse `.cs-legend`.
5. Unmatched constituencies keep the existing grey — and now announce their count, which
   landed on 2026-08-22.

### Trap

Vote share must be computed against **valid poll in that constituency**, not against the
national total, or every constituency in a large election reads as near-zero. Whichever
denominator is chosen, put it in the legend.

## Part 2 — the chart creator

### Scope it by refusing to be general

A chart builder that can draw anything is a year of work and competes with tools people
already have. The useful version answers questions **about this corpus** that no general
tool can, because it knows the geography and the entity graph.

**Recommendation: three chart types, tied to the data model.**

1. **Time series for one area** — population, electorate, or vote share for a chosen
   constituency/ward/DED across every year we hold. This is the chart the entity model
   makes possible and nothing else can produce.
2. **Comparison across areas at one date** — ranked bar of the top N areas by a variable.
3. **Composition** — party shares in one contest, or census category shares in one area.

Each takes the same input as a map composition (see `PLAN-composable-maps.md`): a base
geography, a variable, a date or range. **A chart and a map are two renderings of one
composition document.** That is the design insight worth holding onto — it means the
chart creator is mostly the composer with a different renderer, and a saved composition
can be viewed either way from the same URL.

### Steps

1. Extend the composition schema with `"render": "map" | "chart"` and a `chart` block
   (`type`, `x`, `y`, `series`).
2. Implement the three chart types over the existing resolver. Inline SVG, no chart
   library — the shapes are simple and a library is a dependency, a bundle-size cost, and
   a styling fight.
3. Export as PNG and SVG. **This is the Wikipedia and social-media path**, so treat it as
   a first-class output rather than an afterthought: attribution and a source line belong
   in the exported image, not beside it on the page.
4. Embed view: a URL that renders just the chart, for iframing.

### Do not

- Do not build a drag-and-drop canvas. The value is in the data, not the layout.
- Do not add a charting dependency before writing the first chart by hand. Three SVG
  chart types are a few hundred lines and stay ours.

## Definition of done

- Party share renders for any election in the corpus, with a legend that names its
  denominator.
- A composition document renders as either a map or a chart from the same URL.
- A chart exports to PNG with attribution baked in.
