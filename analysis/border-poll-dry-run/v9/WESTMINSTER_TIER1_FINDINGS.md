# Phase 39 — Tier 1: Westminster 1997/2001/2005, and where the era boundary is

## Setup

Phase 37 identified Westminster's binding constraint as sample size: 5 contests ×
18 = 90 rows, too few to afford a type-separated ridge. 1997/2001/2005 would take it
to 144.

**Boundaries.** Those contests ran on the 1995 review; the repo has OSNI boundary
files for 2008 and 2023 only, so no exact DZ → 1995 crosswalk is possible. All 18
constituency names are shared and the 2008 review was a minor revision, so 2008
geography is used as an approximation — an assumption, recorded, not a derivation.

**Census vintage.** Predicting 1997 from 2021 demography is anachronistic; the
Catholic share is the variable the model leans on hardest and it moved several points
over the period. `dz21-census-1991.csv` carries the 1991 census at DZ2021 level, so
each contest is given its nearest vintage (1997/2001/2005 → 1991; 2010+ → 2021) over
a **harmonised 8-variable subset** present in both: catholic, protestant,
no_religion, irish_speak, owner_occ, social_rent, private_rent, degree.

## Result — the era boundary is 1997/2001, not "older is worse"

Scored on the **modern contests only** (2010–2024), so the comparison is like-for-like:

| training set | n | TVD (modern) | winners (modern) |
|---|--:|--:|--:|
| 2010–2024 (5 contests, current) | 89 | 19.72 | 72.9% |
| **2005–2024 (6 contests)** | 107 | **19.02** | **74.1%** |
| 2001–2024 (7 contests) | 125 | 19.26 | 74.1% |
| 1997–2024 (8 contests) | 143 | 21.30 | 74.1% |

**Adding 2005 helps on both metrics. Adding 1997 clearly hurts** — TVD jumps from
19.02 to 21.30 while winners stay flat.

Per-contest winner accuracy under the full 8-contest model shows why:

| 1997 | 2001 | 2005 | 2010 | 2015 | 2017 | 2019 | 2024 |
|--:|--:|--:|--:|--:|--:|--:|--:|
| **22.2%** | 55.6% | 77.8% | 66.7% | 66.7% | 94.4% | 77.8% | 64.7% |

## Why: the realignment, not the age

1997 predicts at **22.2%** — worse than chance across 18 seats. It is the last
election before the Good Friday Agreement, fought under a **UUP-dominant** party
system; the DUP overtook the UUP only in 2003–2005. So the census → party mapping
itself changed, and pooling 1997 with 2024 forces one mapping across a realignment.

This is the same failure as phase 37's contest-type finding, in the time dimension
rather than the electoral-system one: **the model assumes a stable census→vote
mapping, and that assumption breaks across a realignment just as it breaks across
electoral systems.**

## Verdict

**Adopt 2005–2024 (6 contests).** It is the best configuration on both metrics and
takes Westminster from 90 to 107 rows — a real, if modest, relief of the sample
constraint. 2001 is neutral; **1997 should be excluded** from the share model.

Note these TVD figures (~19) are not comparable with the main pipeline's (~14): this
Westminster-only model uses the 8 harmonised variables, not the 88 census features
plus competitive-field. The comparison here is internally consistent only.

1997 remains useful for bloc-level backtesting and the unity model's historical
series, where nationalist/unionist/other is meaningful across the realignment even
when party labels are not.
