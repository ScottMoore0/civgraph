# Medium-Priority Resolution Worklist (Step-1 read-only research)

Generated: 2026-07-08 · Builder: `scripts/build-medium-priority-resolution-worklist.mjs` (deterministic, offline)

Resolves the still-unpublished medium-priority buckets (after the 2026-07-08 publication of
849 source records) to concrete **targets** and **feasibility**, so Step-2 execution is
evidence-driven rather than guessed. Read-only: nothing here is published.

Source pool: `../medium-priority-publication-prep-2026-06-25/row-staging-records.json`.
Targets matched against the LIVE corpora: `data/browse/elections.json` (5,238),
`data/database/maps.json` (858), `data/browse/sources.json` (19,715 sharded).

## Findings by bucket

### enrich-existing-election — 96 rows, only ~half are elections
- **47 real election datasets** → 31 high-confidence target matches, 2 medium, 14 low/none.
- **49 MISCLASSIFIED non-election rows** — snagged by a **"daily" → "Dáil"** substring match in
  the prep generator: weather stations ("Athenry Daily Data"), CSO stat cubes ("HSPAA54 …
  daily amount of fruit", "TOA09 … daily Luas passengers"), gas demand, salmon-migration
  counts. These must be **re-routed** (most are source-download/stats records) or dropped —
  NOT enriched onto election records. See `classification: "MISCLASSIFIED-non-election"`.

### enrich-existing-source — 95 rows, all resolvable
- **95/95 resolve to an exact-title existing source record** (e.g. "Bicycle Parking Stands
  SDCC" → itself). Targets reliable. **Caveat:** because the match is exact, confirm each
  enrichment actually ADDS provenance (a provider URL the existing record lacks) rather than
  being a redundant restatement of a record already on the site.

### variant-child-map — 67 rows, 41 have a parent
- **16 high + 25 medium = 41** resolve to an on-site parent map ("Coastal Flood Boundary … NI
  Extract" → *Coastal Flood Boundary — Extreme Sea Levels (2018)*). **21 have no on-site
  parent** — new maps, or blocked until the parent is published.

### new-interactive-map (44) + hold-special-format (288) — conversion feasibility
- **Format triage is favourable:** new-map 44/44 spatial; special-format **263/288 directly
  convertible vector**, only 13 raster + 11 non-spatial + 1 point-cloud need special handling.
  The "special format" label is mostly a red herring (~91% are `ogr2ogr`-able).
- **~63 rows (9 + 54) are boundary-family titles** (statutory/electoral boundaries, admin
  areas, townlands) that are **largely already on the site** as Tailte/OSI boundary maps →
  dedup before converting.
- **Wayback fallback exists** for ~all rows (40/44 and 288/288 carry a `waybackUrl`).

## Live data.gov.ie CKAN probe evidence (2026-07-08)

Probed `https://data.gov.ie/api/3/action/package_show?id=<slug>` for 16 dataset slugs taken
from the provider URLs. Two blockers for autonomous fetch:

1. **~50% of provider URLs are STALE.** 8/16 returned `success=false` — every Tailte
   "…national-statutory-boundaries-2019**1**" / "…-2015**1**" style, which data.gov.ie
   renamed/reorganised since the prep pack (2026-06). Autonomous fetch needs a CKAN
   title-search / Wayback fallback, not the raw URL slug. Some may be genuinely delisted.
   - FAIL examples: `administrative-areas-national-statutory-boundaries-20191`,
     `constituency-boundaries-generalised-20m-national-electoral-boundaries-20171`.
   - OK examples: `general-election-2016-constituency-details`, `administrative-areas1`,
     `district-electoral-divisions-boundaries`, `ed-boundaries-dlr`.
2. **Licence genuinely varies.** Election datasets returned **CC-BY-SA-4.0 (share-alike)**;
   boundary/admin datasets returned **CC-BY-4.0**. The blanket "data.gov.ie → CC BY 4.0"
   assumption is unsafe for *redistribution* — share-alike constrains how derived/hosted
   tiles may be licensed. Per-dataset licence check via CKAN is mandatory before
   converting+hosting (lower-stakes for pure pointer records).

## Recommended Step-2 sequence (hardest risk retired first)

1. **enrich-election (47 real)** — highest value/lowest risk; simultaneously **re-route the 49
   misclassified rows** so they are never enriched onto elections.
2. **variant-child-map (41 with parent)** + **enrich-source (95)** — verify-then-attach.
3. **Conversion buckets last** — they carry the stale-URL + per-dataset-licence + dedup work;
   need a fetch→resolve(CKAN/Wayback)→licence-check→dedup harness before any convert/upload.

## Conversion Step-1 resolution (Track B, added 2026-07-08)

`conversion-resolution-worklist.json` — for each of the 328 new-map + hold-special-format
rows: live download URL (CKAN `package_show`, then `package_search` title-fallback for stale
slugs), licence, convertibility class, and dedup vs. existing maps. User decision 2026-07-08:
**host CC-BY-SA-derived tiles** (all *declared-open* licences eligible). Outcome:

- **136 READY TO CONVERT** — declared-open licence (135 CC BY 4.0 + 1 CC0 1.0), a live spatial
  download resource (124 GeoJSON/vector, 12 raster), not a map duplicate. All carry a working
  ArcGIS-OpenData download URL. This is the net-new interactive-map candidate set.
- **12 Open Data NI** — OGL, convertible; download URL to be resolved via the ODNI portal at
  convert time (`odni-defer`).
- **86 Tailte statutory-boundary family** (`skip-tailte-boundary-undeclared`) — Admin Areas /
  Baronies / NUTS3 / Rural Areas etc. in multiple generalisations, **undeclared CKAN licence**
  and almost certainly **already on-site** as boundary maps/variants. Held for a dedicated
  dedup + Tailte-licence-confirmation pass — bulk-converting would create ~86 near-duplicate
  boundary maps under an unconfirmed licence.
- **86 other undeclared-licence** (`skip-nonopen`) — no declared open licence; held pending
  per-dataset licence confirmation (can't host derived tiles without a confirmed open licence,
  even given the share-alike decision).
- 5 map dups, 2 truly stale (not found even via title-search), 1 non-spatial.

**Note on stale URLs:** the CKAN title-search recovered 169 of 171 "stale" rows — they were
renamed, not deleted — but 169 came back with an EMPTY package licence (the Tailte + other
undeclared sets above), so recovery mostly surfaced the licence-confirmation problem rather
than new convertibles. The real net-new convert set is 136 (+12 ODNI).

**Track-B next step:** build the fetch→`ogr2ogr`/tippecanoe→R2→`maps-test.json`→gate harness,
prove on ONE of the 136 end-to-end, then batch. The 172 undeclared-licence rows need a
licence-confirmation pass (Tailte's actual terms) before they can join.

## Files
- `summary.json` — machine-readable rollup (counts above).
- `enrich-existing-election-worklist.json` — per-row target + classification (election vs misclassified).
- `enrich-existing-source-worklist.json` — per-row exact-title target.
- `variant-child-map-worklist.json` — per-row parent (none-tier = no on-site parent).
- `conversion-feasibility.json` — per-row format class + duplicate/wayback flags.
