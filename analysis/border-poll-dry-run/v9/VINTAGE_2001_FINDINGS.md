# The 2001 census, the OA/SA/DZ crosswalk triangle, and a negative result

Phases 52–55. Answers the question "do you include the 2001 Output Areas?" — the
answer was no, and this closes the gap. It also tests the assumption that motivated
closing it, and that assumption does not survive the test.

## What was missing, and where it actually was

The model's census geography was DZ2021 alone. SA2011 appeared only as a crosswalk
vehicle in phase 30; 1991 arrived pre-mapped in `dz21-census-1991.csv`; OA2001 was
absent entirely.

The 2001 census was not missing from the machine. It is the full NISRA release at
`<Downloads>/Census 2001 Complete/`, catalogued in
`data/census/source-inventory/census-source-archives.json` (100 MB, 9 archives),
including **Key Statistics at Output Area level — 5,022 units, matching OA2001.fgb
exactly**. It had simply never been wired in.

## Phase 52 — the crosswalk triangle

All six directed crosswalks between the three census geographies, by **areal
interpolation** rather than centroid assignment, in Irish Grid:

| crosswalk | pairs | targets reached | sources split across >1 target |
|---|---|---|---|
| OA2001 → DZ2021 | 23,354 | 3,780/3,780 | 100% |
| OA2001 → SA2011 | 5,215 | 4,537/4,537 | 3% |
| SA2011 → DZ2021 | 21,977 | 3,780/3,780 | 100% |
| SA2011 → OA2001 | 5,205 | 5,022/5,022 | 11% |
| DZ2021 → OA2001 | 23,086 | 5,022/5,022 | 100% |
| DZ2021 → SA2011 | 21,783 | 4,537/4,537 | 99% |

Two things fall out. **OA2001 and SA2011 are near-coterminous** — only 3% of OAs split
across more than one Small Area, so 2001 data lands on SA2011 essentially losslessly.
**DZ2021 is a genuinely different geography** from both, splitting every source unit
~4.6 ways.

The method change matters on its own: phase 30's centroid join reached **2,840 of
3,780** Data Zones. Areal weights reach **3,780 of 3,780**. Hard 1:1 labels are also
emitted, using OA2001's published population-weighted centroids where available; these
agree with dominant-area assignment on 67.6% (OA→DZ) to 99.9% (OA→SA).

Also emitted: `oa2001_to_deas.csv` across all four DEA vintages, matching the existing
`sa2011_to_deas` / `dz2021_to_deas` family, and a master OA table with ward and
district.

## Phase 53 — 2001 census features

`oa2001-census-2001.csv`, `sa2011-census-2001.csv`, `dz21-census-2001.csv`, built to
the exact column schema of `dz21-census-1991.csv`. Counts are apportioned first and
converted to percentages afterwards.

Validation against published 2001 figures:

| | built | published |
|---|---|---|
| NI population (KS01) | 1,685,267 | 1,685,267 |
| NI households (KS18) | 626,694 | 626,718 |
| Catholic | 40.12% | 40.26% |
| Protestant | 45.67% | 45.57% |
| owner-occupied | 69.55% | 69.65% |
| no car | 26.37% | 26.45% |

The 1991→2001 movements are the real ones: owner-occupation +8pp, social renting
−10pp, unemployment −9pp, degree-level +8pp, Catholic +3.2pp.

**Documented limitation.** At Output Area level NISRA published religion only as KS07a,
which merges "no religion" with "not stated", and released no religion-detail CAS table
at OA level. `relig_notstated_pct` is therefore empty for 2001, and comparisons use the
residual `100 − Catholic − Protestant`, which means the same thing in all three
vintages.

Aggregating OA2001 onto DZ2021 loses 0.5% of population (1,676,895 of 1,685,267) at the
coast, where the two vintages digitise the shoreline differently. SA2011 retains all of
it.

## Phase 54 — the A/B, and the negative result

The premise of phase 39 was that predicting an old election from 2021 demography is
anachronistic. With 2001 now available, that premise is testable. Feature set is held
fixed at the eight harmonisable variables so only the vintage assignment varies —
otherwise swapping vintages also swaps model capacity (88 features vs ~20).

**Westminster 1997–2024**, leave-one-contest-out, TVD on modern contests:

| assignment | TVD (modern) | winners | TVD 2001 | TVD 2005 |
|---|---|---|---|---|
| all2021 (single) | **19.36** | 72.9% | 21.68 | 18.67 |
| all2001 (single) | 20.37 | 76.3% | 22.67 | 19.04 |
| all1991 (single) | 20.75 | 76.3% | 22.07 | 20.15 |
| phase39 (mixed) | 21.39 | 72.9% | 24.25 | 18.30 |
| corrected (mixed) | 21.10 | 72.9% | 22.74 | 20.88 |

**Local 1993–2011 on DEA1993:**

| assignment | TVD (all) | TVD 2001 | TVD 2005 | winners |
|---|---|---|---|---|
| all2021 (single) | **21.56** | 17.61 | 19.80 | 39.4% |
| all2001 (single) | 21.76 | 17.86 | 20.49 | 36.8% |
| all1991 (single) | 22.61 | 17.42 | 20.18 | 36.6% |
| phase39 (mixed) | 23.95 | 17.74 | 20.50 | 34.0% |
| corrected (mixed) | 24.53 | **17.00** | **19.70** | 31.2% |

**Every single-vintage assignment beats every mixed assignment, in both settings.**
The three single-vintage rows cluster tightly (19.4–20.8 Westminster; 21.6–22.6 local)
while the mixed rows sit clearly outside them. The ordering is monotone in the number
of vintages in play — one beats two beats three.

The driver is therefore **vintage consistency, not era-matching**. Giving the same
constituency different feature values in different contest-years injects noise into a
design that centres per contest; the stable geographic signal is worth more than the
era-appropriate one.

The era effect is real but small and swamped. On the two contests where it should bite
hardest — local 2001 and 2005 — the vintage-matched assignment *is* the most accurate
of the five (17.00 and 19.70). It just costs more elsewhere than it gains there.

Note the absolute TVD levels are high because this is a deliberately stripped 8-feature
model built for a controlled comparison; only the differences between rows are
meaningful.

**Consequence.** Phase 39's vintage-matching rationale is not supported, and the
recommendation is to fit a single consistent vintage. This is the fourth time in this
workstream that a gain assumed under a weak design has failed a stronger one, and the
first time the assumption was mine rather than inherited.

It also partly resolves a confound flagged earlier: phase 47 rejected local 2001/2005
as harmful and attributed that to the UUP→DUP realignment, but those contests were
being fitted with 2021 features. Vintage-matching them improves them specifically
(−0.75 and −0.81 TVD), so **some** of the rejection was demography, not realignment —
but not enough to reverse it.

## Phase 55 — deprivation, and what OA unlocks

NIMDM 2005 and 2010 were sitting unused in `data/census/derived/` because they are
published on Output Areas and the model had no OA crosswalk. With one, they become a
series:

| geography | 2005 | 2010 | 2017 |
|---|---|---|---|
| DZ2021 (3,780) | 3,780 | 3,780 | 3,780 |
| SA2011 (4,537) | 4,537 | 4,537 | 4,537 |
| OA2001 (5,022) | 5,022 | 5,022 | 5,022 |

Full coverage everywhere, against phase 30's 2,840/3,780 from one snapshot.

Deprivation is persistent but not static: corr(2005,2010) 0.924, corr(2010,2017) 0.930,
corr(2005,2017) 0.886. The 2005→2017 change in deprivation percentile has sd 12.4, and
**360 Data Zones (9.5%) move more than 20 percentiles** — movement a static 2017
snapshot cannot see, in the period the model is trying to explain.

## Files

Scripts: `52_oa2001_crosswalk.py`, `53_census2001_features.py`,
`54_vintage2001_test.py`, `55_deprivation_oa.py`

Data (`data/census/derived/`): `oa2001_to_{dz2021,sa2011}_weights.csv` and the four
other directed pairs, `*_crosswalk.csv` for each, `oa2001_to_deas.csv`,
`oa2001_master_crosswalk.csv`, `oa2001-census-2001.csv`, `sa2011-census-2001.csv`,
`dz21-census-2001.csv`, `deprivation-series-{oa2001,sa2011,dz2021}.csv`

Results: `vintage2001_ab.json`

## What this does not do

- Phases 39 and 47 are **not** rewritten to the single-vintage finding; the A/B
  recommends it, applying it is a separate change with its own re-validation.
- 2001 features are the 8 harmonised variables plus ~12 more from Key Statistics, not
  a full 88-feature parallel to `dz_features.csv`. The CAS tables at OA level (37 of
  them) would support a much wider 2001 set if it were wanted.
- Nothing here is published. All outputs are local.
