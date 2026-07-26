# Phases 46–47 — pre-2014 local elections, tiered

## The omission this corrects

**All thirteen NI local elections (1973–2023) are in the repo** with full count
detail, ~900–1,150 candidates each. Only three were ever used, and I described that
as a data limit. It was my selection.

## Phase 46 — the crosswalk

2014 was a wholesale redraw (26 councils → 11, ~101 DEAs → 80), so pre-2014 results
cannot be name-matched onto modern DEAs. OSNI publishes largescale DEA boundaries for
1993 (**101 features — exactly matching the 2011 election's 101 areas**).

- **DZ2021 → DEA1993 by centroid: 3,780/3,780, 0 unmatched**, covering all 101 areas.
- Name matching (election area → boundary), after handling 2014-era code prefixes
  (`LG11-NAM-CROTLIEVE` → `CROTLIEVE`), compound directions (`ANTRIM NORTHWEST` →
  `ANTRIM NORTH WEST`), dropped articles (`GLENS` → `THE GLENS`) and council context
  (`LOUGH` → `LARNE LOUGH`):

| contest | areas | matched | rate |
|---|--:|--:|--:|
| 2011 | 101 | 101 | **100.0%** |
| 2005 | 100 | 99 | 99.0% |
| 2001 | 100 | 97 | 97.0% |
| 1997 | 101 | 98 | 97.0% |
| 1993 | 101 | 99 | 98.0% |
| 1989 / 1985 | 98 | 89 | 90.8% |
| **1981 / 1977 / 1973** | 98 | **0** | **0.0%** |

**1973–1981 are out.** They use a lettered "Antrim Area A/B/C" scheme that the 1993
boundary set does not represent. Recovering them needs a lettered-DEA boundary source
that does not appear to exist in the available OSNI open data.

## Phase 47 — notionals, and the provenance problem

Each pre-2014 contest was allocated to Data Zones (raked to its own observed DEA1993
totals) and re-aggregated onto the modern 80 DEAs. All seven built.

**But the provenance is far worse than for Westminster.** Median modern DEA draws only
**71.7%** of its population from a single DEA1993 predecessor, and just **16 of 80**
exceed 90% — against 86–100% for the 2008→2023 Westminster review. 2014 really was a
redraw, not a revision, so these notionals are substantially modelled.

## The tiered test — scored only on real contests, notionals confined to training

| training set | TVD median | mean |
|---|--:|--:|
| baseline (3 real contests) | 15.46 | 15.83 |
| **TIER 1: + 2011** | **15.09** | **15.46** |
| TIER 2: + 2011, 2005, 2001 | 16.64 | 16.93 |
| + 1985–1997 as well | 20.29 | 21.54 |

**Tier 1 works. Tier 2 does not. Tier 3 is actively harmful if pooled.**

Same shape as the Westminster result in phase 39 — and the cut-off here is *later*
(only 2011 survives, where Westminster tolerated 2005). Two reasons, both expected:
the 2014 crosswalk is much messier, so notionals carry more modelling error; and
local 2005/2001 sit inside the UUP→DUP realignment.

## Tier 3 delivers what it was for

Not pooled into the share model — but the long series gives per-DEA per-party
**volatility over 10 contests instead of 3**, which was the original point:

| party | median σ | p10 | p90 |
|---|--:|--:|--:|
| UUP | **8.35** | 3.72 | 12.55 |
| Sinn Féin | 6.99 | 0.38 | 13.33 |
| DUP | 5.47 | 1.95 | 10.58 |
| SDLP | 5.21 | 1.00 | 10.63 |
| Alliance | **3.36** | 1.20 | 6.05 |

UUP is the most volatile party in the system — consistent with its long decline —
and Alliance the steadiest. Sinn Féin has the widest *spread* between areas (0.38 to
13.33), i.e. rock-solid in its strongholds and highly movable at the margins, which
is exactly the structure a directional-softness model needs.

**Observed floors** (minimum share across the series): DUP's highest floor is
Castlereagh East at **44.9%**; Sinn Féin's is Black Mountain at **53.2%**. Both fall
to 0.0% in areas they do not contest.

## Verdict

- **Adopt 2011** into the share model.
- **Reject 2005 and earlier** for the share model — measured, not assumed.
- **Use 1985–2011 for volatility and floors**, which is what Tier 3 was for and where
  it demonstrably earns its place.
