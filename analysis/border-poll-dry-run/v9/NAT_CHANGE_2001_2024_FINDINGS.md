# Where the SF/SDLP/PBP/Aontú bloc grew, 2001 → 2024

Phases 56–57. First use of the phase 52/53 Output Area work for a substantive question
rather than a validation one.

## Two things to settle before answering

**Nothing below DEA is observed.** NI counts votes centrally, not by ballot box. No
party result exists below District Electoral Area and none ever will. Every Data Zone,
Small Area and Output Area number in this write-up is an allocation raked to observed
area totals — a model output that nobody can check at that level. The observed layer is
reported separately and first.

**The bloc did not grow.** NI-wide:

| | 2001 | 2024/23 | change |
|---|---|---|---|
| Westminster, SF+SDLP+PBP+Aontú | 42.67% | 40.22% | **−2.45** |
| Local, SF+SDLP+PBP+Aontú | 40.27% | 41.67% | **+1.40** |

What changed enormously is the bloc's *composition* — SF +10.2 / SDLP −9.8 in
Westminster, SF +10.2 / SDLP −10.8 in local — not its size. Alliance (+11.5 Westminster)
took the ground the UUP lost (−14.6), and that is the era's real story. So "greatest
increase" is a question about **redistribution inside a roughly constant total**, and
the meaningful quantity is the spread, not the mean.

## Construction

Each endpoint sits on its own native geography and its own census, which is what
phases 52–53 made possible:

| endpoint | geography | census | raked to |
|---|---|---|---|
| 2001 | OA2001 (5,022) | 2001 | observed local-2001 totals, 99 DEA1993 |
| 2023 | DZ2021 (3,780) | 2021 | observed local-2023 totals, 80 DEA2014 |

Both mosaics use **one** ridge fit (2023 DEA results on the 8 harmonised variables), so
they cannot differ because the model differs. They are then carried onto a common
geography with the phase-52 areal weights and differenced. Local rather than Westminster
because it gives 80–99 observed areas instead of 18.

The rake was re-checked rather than assumed: phase 25's clipped 60-sweep version is
adequate here (worst DEA residual 0.0071pp, no Data Zone's bloc share moving as much as
0.03pp versus an unclipped 4,000-sweep rake). Phase 56 uses the tighter version anyway.

## The measure has a confound, and it is large

Ranking by share of the *valid* vote is contaminated at exactly the areas it ranks
highest. NI-wide the Independent+Other share fell 10.3% → 5.4%:

| DEA | valid-vote | party-vote | Δ Independent | attributable to independents |
|---|---|---|---|---|
| THE GLENS | +27.7 | +12.8 | −25.8 | **+14.9pp** |
| THE MOOR | −22.1 | −2.6 | +20.1 | **−19.4pp** |
| CROTLIEVE | −12.9 | −4.6 | +10.8 | −8.4pp |
| DUNGANNON | −9.7 | −2.7 | +15.6 | −7.0pp |
| MACEDON | +13.8 | +11.9 | −35.6 | +1.9pp |

A nationalist-leaning independent who stood in the Glens in 2001 and not in 2023 shows
up as bloc growth with nobody changing their mind; Gary Donnelly's 25% in The Moor in
2023 shows up as bloc collapse for the same non-reason. corr(valid-vote change, Δ
independent share) = **−0.576**.

Phase 57 therefore re-measures the bloc as a share of the **party-labelled vote**
(Independent and Other dropped from the denominator), which is invariant to whether an
independent stood. That drops the correlation to −0.251. Rank correlation between the
two measures is +0.775 at DEA and +0.86 at Data Zone — the ordering mostly survives, but
the two most extreme DEAs in each direction do not.

**Everything below uses the party-labelled measure.**

## The answer: observed DEA level

Mean change +0.83pp, sd 5.01. Growth is concentrated in **greater Belfast, Lisburn,
Newtownabbey and the north-east coast** — traditionally unionist or mixed suburban
ground, not the nationalist heartland:

| DEA | 2001 | 2023 | change |
|---|---|---|---|
| AIRPORT (Antrim & Newtownabbey) | 32.8 | 47.0 | **+14.3** |
| LISBURN NORTH | 15.6 | 28.8 | **+13.1** |
| THE GLENS (Causeway Coast) | 57.8 | 70.6 | **+12.8** |
| MACEDON (Newtownabbey) | 8.9 | 20.8 | **+11.9** |
| ARDS PENINSULA | 12.6 | 24.5 | **+11.9** |
| COLERAINE | 15.5 | 24.2 | +8.7 |
| WATERSIDE (Derry) | 41.1 | 49.8 | +8.7 |
| LISNASHARRAGH (Belfast) | 17.3 | 25.1 | +7.8 |
| HOLYWOOD AND CLANDEBOYE | 0.0 | 7.0 | +7.0 |
| KILLULTAGH | 21.2 | 28.0 | +6.8 |
| GLENGORMLEY URBAN | 35.7 | 42.5 | +6.7 |
| LISBURN SOUTH | 6.3 | 12.9 | +6.5 |

The largest falls are in **strongly nationalist areas**: COURT −10.5, BENBRADAGH −10.0,
DOWNPATRICK −6.6, ROWALLANE −6.2, OLDPARK −5.5, CROTLIEVE −4.6, OMAGH −4.5.

## The pattern: convergence, not advance

Binning the 3,780 Data Zones by their 2001 level:

| bin | 2001 | 2023 | change | political channel | demographic channel | Δ Catholic |
|---|---|---|---|---|---|---|
| 1 | 0.6 | 3.2 | +2.6 | +2.7 | +0.0 | +5.6 |
| 2 | 5.4 | 10.2 | +4.9 | +4.3 | +0.5 | +8.4 |
| 3 | 11.1 | 12.8 | +1.7 | +1.6 | +0.4 | +7.6 |
| 4 | 20.0 | 22.4 | +2.4 | +2.6 | +0.8 | +7.8 |
| 5 | 35.3 | 38.0 | +2.8 | +3.7 | +0.9 | +7.2 |
| 6 | 56.9 | 57.6 | +0.6 | +4.1 | +0.1 | +5.4 |
| 7 | 78.5 | 77.0 | −1.5 | +1.4 | −1.2 | +4.5 |
| 8 | 92.8 | 88.5 | −4.2 | −0.7 | −2.0 | +1.6 |
| 9 | 99.4 | 95.2 | −4.2 | −5.2 | −1.2 | +1.0 |

corr(2001 level, change) = **−0.235**. The bloc gained where it was weak and lost where
it was strongest. 47% of Data Zones rose and 53% fell, around a mean of +0.2.

The decomposition (rebuilding the 2001 mosaic on 2021 demography, raked to the same 2001
targets) separates two channels of similar size — political sd 9.65, demographic sd 8.76.
The right-hand column shows why: the Catholic share rose **+5 to +8pp in the areas that
were least nationalist in 2001 and only +1 to +1.6pp in the most nationalist**. Religious
composition converged, and the vote converged with it, but only partly — the political
channel is negative in the top bins, i.e. the strongest nationalist areas moved away from
the bloc's parties faster than their demography did.

## How far down this is worth reading

**Data Zone is the floor.** The 2023 endpoint is native at DZ2021 and the 2001 endpoint
aggregates up from ~6 Output Areas, which averages cleanly. Going below that inverts the
problem: a coarse 2023 value has to be *disaggregated* onto smaller units, which imposes
a Data Zone's value on Output Areas that may differ from it.

Measured, that smear is usually mild — the mean absolute gap between an Output Area's
2001 Catholic share and its Data Zone's is 4.3pp. But the top-20 OA risers have a median
implied Catholic jump of +34.2pp, which is the **99th percentile** of the NI-wide OA
distribution. They are selected for being extreme, and some of that extremity is real
composition change while some is a small enclave averaged into an unlike Data Zone
(e.g. `95VV030005`, 2.5% Catholic in 2001 inside overwhelmingly Catholic Slieve Gullion).

So: the DEA table is evidence; the Data Zone pattern is a defensible model output; the
individual OA/SA rankings are illustrative only and their extreme tail should not be
quoted as fact.

## Files

Scripts: `56_nationalist_change_2001_2024.py`, `57_nat_change_robustness.py`

Data: `nat_change_{dz2021,sa2011,oa2001}.csv` (valid-vote measure, with the
political/demographic decomposition), `nat_change_{dz2021,sa2011,oa2001}_partyvote.csv`
(party-labelled measure), `nat_change_summary.json`, `nat_change_robustness.json`

## What this does not do

- No Westminster small-area version. The local series has 80–99 observed areas against
  Westminster's 18 and is the better instrument; the Westminster totals are reported
  only as the NI-level cross-check above.
- Turnout is not modelled. These are shares of those who voted, and the 2001 and 2023
  local electorates differ in size and composition.
- The single ridge fit is defensible for the bloc total, which tracks the Catholic share
  closely, and would **not** be defensible for the SF-versus-SDLP split inside it.
- Nothing here is published. All outputs are local.
