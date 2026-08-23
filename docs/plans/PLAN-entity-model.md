# Design session — the entity model

> **Status: design settled, ready to execute in stages.** Written 2026-08-23.
>
> **First correction: the entity model is not unbuilt.** I told you on 2026-08-22 that it
> was "one bullet on the goals list and the foundation the other four plans sit on", and
> implied it was greenfield. It exists, it is substantial, and it has been generated on
> every build for some time.

## What actually exists

`scripts/graph/build-semantic-graph.mjs` produces **193,132 entities** across 39 shards,
with a manifest, a search index, and reverse indexes. Eighteen types, 45 properties.

| Type | Count | | Type | Count |
|---|---:|---|---|---:|
| register-interest | 51,788 | | contest | 4,987 |
| source | 51,071 | | map-layer | 1,013 |
| candidature | 30,795 | | political-party | 804 |
| source-file | 14,632 | | date-month | 456 |
| **geographic-feature** | **14,615** | | provider | 206 |
| person | 12,104 | | date-year | 129 |
| election | 5,267 | | feature-group | 120 |
| register-record | 5,064 | | map-category | 48 |
| | | | elected-body / office | 13 / 2 |

So candidatures already link people to contests to elections; features already link to
layers via `feature-in-layer` / `has-feature`; sources and files already have provenance.

**This is most of the model in the goals document.** "You'll be able to click a
constituency and see a list of elections, then click an election, and each person will be
a data entity" — the entities for that exist today.

## What is actually missing

Three relations. Everything the other four plans need reduces to these.

### 1. Continuity across time — the one that matters

There is no `succeeds`, `replaced-by`, or `same-area-as` property. Nothing in the graph
records that a 1911 DED became part of a 1926 DED, or that a ward survived the 1972
reorganisation under a new code.

**This is the blocker for the ED population map**, and for "change since the last
election" in the party-performance plan, and for any chart of one area over time. Without
it, 126 years of census data cannot be attached to a single area, because there is no
single area — there are 14 differently-bounded areas and no statement that they are
related.

It is also the hardest, because continuity is genuinely ambiguous: boundaries split,
merge, and are renamed without moving. The relation therefore needs a **kind** and a
**confidence**, not just a link:

```jsonc
{ "from": "cg:feature:ded-1911-ballymacarrett",
  "to":   "cg:feature:ded-1926-ballymacarrett",
  "kind": "continues" | "split-into" | "merged-into" | "renamed",
  "share": 0.87,          // for splits/merges: proportion of area carried
  "basis": "geometry-overlap" | "official-order" | "manual",
  "confidence": "high" | "medium" | "low" }
```

**Derive the first pass from geometry.** Area overlap between successive vintages of the
same chain gives a defensible starting set, and `timeSeriesChains` already declares which
17 chains are successive. Official boundary orders refine it later; manual corrections
override both. Record `basis` so the three are never confused.

### 2. Containment

No `part-of` / `contains`. A ward does not know its county; a DED does not know its
poor-law union. Hierarchy is currently implicit in naming and in `feature-group`.

Cheaper than continuity — for a given date, containment is a point-in-polygon or
area-majority test between two layers — and it unlocks aggregation, which is what most
charts actually want ("population by county" from DED data).

### 3. Measures

No property carries a census or statistical value. `first-preference-votes`, `votes`,
`seats` and `vote-share` exist for elections; nothing equivalent for population, housing
or language.

A measure is a three-part fact — **area, variable, period** — and it should be modelled as
its own entity rather than an attribute, because the same variable is collected on
different bases in different years and the basis matters:

```jsonc
{ "id": "cg:measure:...", "typeIds": ["cg:entity-type:measure"],
  "area": "cg:feature:ded-1911-...", "variable": "cg:variable:population",
  "period": "cg:date-year:1911", "value": 4213,
  "source": "cg:source:census-1911-table-2" }
```

## The other thing that is missing, and it is not a relation

**Only `browse/browse.js` reads the graph.** The map app does not touch it. So the graph
is, today, a browsing index rather than an analytical substrate — which is why it felt
absent when I was reasoning about composable maps.

Whatever else happens, **the map app needs a graph client**. That is a small piece of work
with a large effect: it is what turns "we have 193,132 entities" into "the composer can
resolve a variable for an area".

## Coverage question to answer before building

**14,615 geographic features against 1,013 map layers** is roughly 14 per layer, so the
graph holds *named or notable* features rather than every polygon. Some layers have tens
of thousands of features.

Decide deliberately, because it changes the storage design:

- **Every feature becomes an entity** — millions of entities, needs a real store (D1),
  and makes per-feature analysis possible.
- **Only features that are joinable** — those with a census code, a constituency id, or a
  name that recurs across vintages. Far smaller, and covers the actual use cases.

**Recommendation: the second.** The value is in features that persist across time or carry
external identifiers; a townland polygon that appears once and joins to nothing does not
need to be in the graph to be on the map.

## Execution order

1. **Graph client for the map app.** Read the manifest, resolve an entity, follow a
   relation. No new data. Unblocks everything else.
2. **Containment**, derived from geometry, for the chains that matter first (wards, DEDs,
   counties). Validator: every child resolves to exactly one parent at a given date.
3. **Measures**, starting with census population, for the areas containment now
   aggregates over. This is where the ED population map becomes possible.
4. **Continuity**, derived from geometry overlap within `timeSeriesChains`, with `kind`,
   `share`, `basis` and `confidence`. Hand-verify one chain end to end before generating
   the rest — the 1972 ward reorganisation is the right test case because it is the
   messiest.
5. **Re-point the plans.** With 1–4 done, the composable-maps resolver, the
   change-since-last-election styling and the time-series chart all become
   straightforward.

## What I would not do

- **Do not rebuild the graph.** It works, it is generated on every build, and it is
  validated by `check:graph`. Extend it.
- **Do not model continuity as a simple link.** A split recorded as "continues" produces
  silently wrong population series, and nothing downstream will flag it.
- **Do not put measures in the map metadata.** They belong to areas and periods, not to
  layers, and duplicating them per layer is how they drift.
