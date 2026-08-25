# Relation-model inventory

> **Status: point-in-time inventory — 2026-08-25.** Diagnosis, not a change: nothing here
> has been acted on. The counts will age as the catalogue changes; re-run the queries
> before relying on them.
>
> **Measured 2026-08-25 against `data/database/maps.json` (1,031 entries).** Every number
> here came from querying the file, not from reading code comments.
>
> **Headline: there are five named mechanisms, but only three distinct relations. Two of
> the five are pure duplicates — one of them used exactly once.**

## Why this was worth doing before deciding anything else

The catalogue sidebar "erases the fact that map datasets are part of series" — but the
reason no UI can express that reliably is not taste. It is that *"these datasets are
related"* is currently written five different ways, read by different code paths, and
inconsistent between them.

That has already cost real defects. `build-render-time-series-chains.mjs` first shipped
handling one chain shape and silently emitted **5 of 17** chains; the other 12 stayed as
dead as they had been. Nothing failed — the code found no chains and rendered a polite
empty state.

## The five named mechanisms

| Mechanism | Entries using it | What it actually says |
|---|---:|---|
| `classes` | 44 classes, covering **350** maps | these maps are successive vintages of one thing |
| `timeSeriesChains` | 17 chains, in **4 shapes** | these classes/maps form a time series |
| `variants` | 50 | this map is assembled from these child layers |
| `members` | 27 | this map is assembled from these child layers |
| `compositeSources` | **1** | this map is assembled from these child layers |
| `cloneOf` | 60 | this record has no data of its own; use that one's |
| `parentId` | 25 | this map is a child of that one |

(That is seven rows for "five mechanisms" because `cloneOf` and `parentId` were not on
the original list and turn out to matter.)

## They collapse to three relations

### 1. PART-OF — four spellings of one relation

`variants`, `members` and `compositeSources` all mean *"this map is assembled from these
child layers"*, and `parentId` is the same relation written from the child's end.

**The duplication is exact, not approximate:**

- **27 maps carry BOTH `members` and `variants`. All 27 lists are identical** —
  same ids, same order once sorted, zero differences.
- The single map using `compositeSources` (`all-ireland-townlands`) also has `variants`,
  and again the lists are identical: `["ni-townlands", "roi-townlands"]`.

So `members` and `compositeSources` add nothing that `variants` does not already say.
`members` is a strict subset of `variants` usage — every map with members has variants.

**`parentId` is the inverse, and it is used by exactly one family.** All 25 rows point at
`dobih-v18-4`, which itself has neither `variants` nor `members`. So the DoBIH hierarchy
is expressed *only* from the child side, while every other composite is expressed *only*
from the parent side. Nothing reconciles the two directions.

### 2. SAME-DATA-AS — `cloneOf` (60 entries)

Genuinely different, and correctly separate. A clone has no data of its own and points at
the record that does — `assembly-areas-2023 → pc-2023`, `provinces → provinces-1955`.

This is not a parent-child relation and should not be merged into part-of. It is closer
to an alias, and the app already treats it that way when resolving what to load.

### 3. SUCCESSION — `classes` plus `timeSeriesChains`

**Classes** say which maps are vintages of one thing. 44 classes, 350 maps.

**Chains** say which classes form a series — and do it four different ways:

| Shape | Chains | Which |
|---|---:|---|
| `segments: [{classIds, from?, to?}]` | 5 | wards, deas, local-govt, counties, provinces |
| `classIds: [...]` (flat) | 9 | settlements, referendums, eu-parliament, ttwa, census series, roi-* |
| `maps: [...]` (direct ids, no class) | 2 | osni-50k-transport, osni-ortho-coverage |
| `parallel` + `columns: [{classIds, name}]` | 1 | parliamentary |

**16 of 44 classes belong to no chain at all.** They are series with no declared
succession, which is exactly the "erases the fact these are a series" complaint, present
in the data before it reaches any UI.

## What reads what

Runtime readers, excluding build scripts and validators:

| Mechanism | Read by |
|---|---|
| `classes` | `src/data-service.js`, `src/ui-controller.js` |
| `timeSeriesChains` | `src/data-service.js`, `render/src/{app,diagnostics,metadata-service,time-series-controller}.js` |
| `variants` | `app/src/{app,election-manager}.js`, `src/{data-service,ui-controller,public-map}.js`, `render/src/catalogue-controller.js` |
| `members` | `app/src/{app,maplibre-main-adapter,settle}.js`, `src/{data-service,ui-controller,public-map}.js` |
| `compositeSources` | `app/src/app.js`, `src/public-map.mjs` |
| `cloneOf` | `app/src/app.js`, `src/{data-service,ui-controller,public-map}.js`, `browse/browse.js` |
| `parentId` | `app/src/{app,maplibre-main-adapter}.js`, `src/data-service.js`, `render/src/metadata-service.js` |

**The split that causes bugs:** `app/src/app.js` reads `variants` and `compositeSources`
when deciding what to load; `app/src/maplibre-main-adapter.js` reads `members`. So a
composite is expanded in *two different places* depending on which field it happens to
carry. That is precisely what made the "loads converted child layers" test confusing —
`eds-1926` uses `members`, so app.js passed the whole config down and the *adapter* did
the expansion, while `all-ireland-townlands` uses `compositeSources` and app.js expanded
it itself. Same concept, two code paths, different call signatures.

## What I would do

**1. Collapse part-of to one field.** Keep `variants` (widest use, richest shape — each
entry carries a label and its own style). Drop `members` and `compositeSources`; both are
provably redundant, and the migration is mechanical because the lists are identical.

**2. Decide `parentId`'s direction.** Either derive it from `variants`, or make it the
canonical direction and derive `variants`. Do not keep both hand-maintained. Today
nothing checks that they agree, and for DoBIH only one exists.

**3. Normalise chains to one shape.** The generator already flattens all four into a
single render shape — that logic exists and is tested. Move it upstream so the catalogue
stores one shape and the generator stops compensating.

**4. Give the 16 orphan classes a chain, or record why they have none.** A series with no
declared succession is invisible to every consumer that reasons about time.

**5. Leave `cloneOf` alone.** It is the one mechanism doing a job nothing else does.

## What this says about the atom question

The measurement argues fairly directly for **series, not dataset**:

- 350 of 1,031 entries are already declared members of a series. That is the largest
  single organising fact in the catalogue.
- The relations that exist are overwhelmingly *composition* and *succession* — both of
  which are statements about groups, not about individual datasets.
- Nothing in the data models *place* yet. There is no containment relation, no continuity
  relation, and no `measures`. So "place as the atom" is not currently supported by
  anything in the catalogue; it would have to be built.

So: **series is reachable now; place is a project.** If the tools vision needs place —
and the pivot surface does — that is a deliberate build, not a reorganisation of what
already exists.
