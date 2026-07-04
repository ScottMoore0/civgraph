# D:-drive → site backlog: true-up (2026-07-04)

The review artifacts in this directory were generated 2026-06-24…06-27. A large
amount of publishing happened **after** those snapshots, but the review counts were
never decremented, so they overstate what's outstanding. This file reconciles every
backlog against what is actually published in `data/database/maps.json` +
`test/metadata/maps-test.json` today, using git evidence (not slug-matching, which
fails because publishing renamed raw source slugs to clean layer ids).

## Evidence: what was actually published

- **maps.json grew 787 → 818 layers** between the review baseline (`a56a09794e`,
  2026-06-24) and now — **+31 layers**, all from the review candidates:
  - 13 OSNI Orthophoto Coverage year-grids (2003–2020)
  - ROI LEA 2014/2019 + Municipal Districts 2019 (3)
  - OSNI 50K Transport pair (2)
  - NI Priority Habitats — Peatland / DAERA (1)
  - NI Health Trust boundaries + OSNI NI Outline (2)
  - 8 environmental (NI Land Classification, NI 1:250k Geology, West Fermanagh
    Scarplands SAC, NPWS Designated Areas, Irish Peat Soils, NI Historic Land Use,
    NI Authorised Waste Sites, NI Licensed Waste Facilities)
  - CORINE Land Cover 2018 + NIAH Buildings (2)
- **24 GSNI Tellus geophysics layers** (10 XYZ rasters + 10 geochemistry + 3 raw +
  flight-tracks) were published in **even earlier** work — already in the 787 baseline.
  (The reviews still flagged them source-only; that was a stale gap. OGL v3.0 attached
  2026-07-04, `9b4d9b696d`.)
- All ~30 published vector layers were also made **loadable on the MapLibre map** as
  PMTiles (maps-test `-vector-test` entries).

**Net published against these reviews: 55 layers.** Every clean, spatial, rights-OK,
non-duplicate candidate the reviews surfaced has been published.

## Backlog-by-backlog reconciliation

### 1. already-on-site enrichment — `already-on-site-*-2026-06-24` (1,112 source rows)
Not new maps — these add source/provenance to layers **already** on the site.
- **317 rows applied → 129 target layers enriched** (committed `d17e5c5107`,
  `f4033685dc`; store `data/database/already-on-site-enrichments.json`).
- **794 in review**, all judgment/hold, none blocking: 482 low-confidence variant,
  117 context-overlap, 74 LA-topic-not-direct, 70 rights-provider-unresolved,
  44 Tailte-remap, plus small review families. The two "ready" families
  (15 OPW/hydro + 13 GSI/geology) are **already applied**.
- **Remaining: provenance-enrichment judgment only. Zero new maps.**

### 2. medium-priority conversion-plan — `medium-priority-publication-prep-2026-06-25` (399)
- `variant-child-map` (67): **18 published** (13 ortho + ROI LEA×2 + MD + transport×2).
  Remaining ~49 are boundary variants — the boundary sweep found **~60 of 68 boundary
  rows duplicate existing published coverage** → source-only, do not republish.
- `new-interactive-map` (44): 1 published; **43 are ROI election / polling / constituency
  layers** flagged `duplicate-or-variant-review, no existing match` — genuinely
  unpublished but judgment-gated (ROI election coverage is already comprehensive;
  most should stay source-only).
- `hold-special-format` (288): deliberately deferred — large raster / LiDAR / special
  format, a **separate raster pipeline**, low priority.

### 3. peatland-geoportal-duplicate-review (438)
- Published: DAERA Peatland + 8 environmental + CORINE + NIAH.
- Remaining: 35 dups of existing layers + off-topic items (waste/wind/geology/woodland)
  + empty PCN survey templates + link-only records. **Nothing clean left to publish.**

### 4. licence-risk review — `remaining-decision-packs-2026-06-27` (2,647)
- 2,580 `standard-open-licence-confirmed`.
- 67-row tail **fully adjudicated** (`6a753a56be`): 10 provider licences fetched
  (1 open, 3 unspecified, 5 dead, 1 dup); Tellus 24 → OGL applied (`9b4d9b696d`);
  remainder source-only / sensitive / raster-acquisition. **0 unresolved.**

### 5. Large judgment batches (genuinely open, approval-gated — overlapping, not additive)
Derived from the same 2,346-row `content-blocker-review`; the prep files re-slice it:
- `local-authority-planning-property-prep` 1,637 · `transport-public-assets-prep` 170 ·
  `boundary-variant-prep` 363 (mostly duplicates) · `residual-blocker-review` 1,225.
- These are per-bundle **publish / enrich-existing / skip** decisions. Experience with
  the batches already worked shows the large majority resolve to **enrich-existing or
  source-only**, not new maps.

## Corrected "what remains"

| Class | Volume | Nature |
|---|---|---|
| **Genuinely-new clean maps to publish** | **~0** | every clean candidate is published |
| Judgment-gated curation (approval, not engineering) | ~1,600 LA/transport rows + 794 enrichment rows + 43 ROI election + 44 Tailte remap | resolve mostly to enrich-existing / source-only / skip |
| Deferred by design | 288 special-format | large raster / LiDAR — separate pipeline |
| Hard-gated (never publish) | sensitive (row 555 EONI + Pointer/UPRN class), rights-unspecified, dead-source | keep local source, never publish |
| Source-acquisition (small) | 16 no-URL, 3 OSNI-403 | the OSNI-403 rows are duplicates anyway |

**Bottom line:** the reviews list thousands of rows, but reconciled against the live
site there is **no clean, rights-OK, non-duplicate dataset still waiting to be
published**. The residue is provenance-enrichment judgment, duplicates (don't
republish), a deferred large-raster/LiDAR set, and hard-gated sensitive/rights rows.
The only substantive "publish more" levers are (a) the deferred **special-format /
raster-LiDAR** set (new pipeline work) and (b) making the LA-batch judgment calls —
which mostly produce enrichments, not new maps.
