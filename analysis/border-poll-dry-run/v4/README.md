# Border Poll projection — v4 (individual-level MRP, all four sources)

The real MRP: an **individual-level multilevel regression fit on pooled NILT
records**, poststratified onto the NISRA census at Data Zone, blended with
LucidTalk and reality-anchored by elections — replacing v3's three community-
background rates. Outputs, for **four dates** (each following a LucidTalk
border-poll poll): projected Irish-unity vote at **Data Zone** and by **every
2021 Census attribute**.

## Stage 1 — regression (`1_fit_nilt_mrp.py`)  [source: NILT, survey-microdata]

Pooled **7,133 decided respondents** across NILT waves 2019–2025 (the
`REFUNIFY` border-poll question). Weighted (`WTFACTOR`) L2-regularised logistic:

> unity ~ community background + age band + sex + year + (community × age)

The regularisation gives the partial-pooling that stabilises small cells. The
fit reproduces the NILT trend (33%→46%) and, unlike v3, recovers within-group
**age gradients** — notably **younger Protestants markedly more open to unity**
(≈23% at 18–24 vs ≈13% at 65+).

## Stage 2 — poststratification + blend (`2_poststratify_project.py`)

- **Frame [NISRA census]:** the NISRA 2021 **religion × age** table *observed at
  Data Zone* (3,272 of 3,780 DZs; the crosstab is disclosure-suppressed for
  ~500 small DZs), voting-age only. The fitted model is evaluated on every
  DZ cell and population-weighted → per-DZ unity.
- **Level per date [LucidTalk + elections]:** the NI total is a 50/50 **blend**
  of the NILT-MRP prediction for that year and the **house-effect-corrected
  LucidTalk** poll (+2.9 pts, from LucidTalk↔2022-Assembly). The DZ surface is
  calibrated (single logit shift) to that blend.
- **Geographic anchor [2016 EU referendum]:** the census↔2016 relationship
  (`Remain% = 37.9 + 0.41·Catholic-bg%`, R²=0.68) validates the engine; per-DZ
  2016 residuals still await a DZ→constituency crosswalk.

Every one of the four sources has a distinct job: **NILT** trains the model,
**NISRA** is the frame, **elections/EU-ref** calibrate level + validate geography,
**LucidTalk** sets timing + level at each date.

## Result — projected Irish-unity (decided) at the four dates

| Date | NILT-MRP | LucidTalk +2.9 | **Blend (NI)** | DZ p10–median–p90 | maj-unity DZs |
|---|---|---|---|---|---|
| 2021-01 | 41.4 | 50.4 | **45.9** | 22–40–76 | 40% |
| 2022-08 | 43.1 | 49.0 | **46.1** | 22–40–77 | 40% |
| 2024-02 | 46.6 | 47.2 | **46.9** | 23–41–77 | 41% |
| 2025-02 | 48.4 | 49.0 | **48.7** | 25–43–79 | 43% |

Unity a rising minority on decided voters, ~46→49%.

## Demographic breakdowns (per date, `breakdowns/<date>_breakdown.json`)

43 attributes. From the model directly: **community background** (2025: Catholic
85%, Other/None 44%, Protestant 17%), **age** (18–24 ≈61% → 65+ ≈40%), **sex**
(≈49/48%). Via religion-composition of the NISRA crosstab (provenance-marked as
composition-derived, not fit directly): national identity (Irish-only 82%,
British-Irish-NI 41%), tenure (social renters 57% vs owners 53%), passports
(Ireland-only 79%, UK+Ireland 49%), NS-SeC, economic activity, health,
qualification, language, and 30+ more.

## Geographic output (per date, `areas/<date>_DZ21.csv`)

Per Data Zone: community-background %, projected unity %, `provenance=modelled`.

## What changed vs v3, and limits

Gained: a fitted **individual-level model** over the joint religion×age structure
(not three rates), an **age gradient**, a time trend, regularised small-cell
handling, and a principled **multi-source blend** per date.
Remaining limits: geographic frame is religion×age only (sex/tenure/etc. enter
the model but the DZ frame doesn't carry them — full raking is the next step);
non-model attributes are composition-derived; ~500 DZs disclosure-suppressed;
2016 residuals not yet on DZ; the "Other/None" model cell is noisy; and the
target — an actual Border Poll — remains unobserved.

Files: `1_fit_nilt_mrp.py`, `2_poststratify_project.py`, `areas/`,
`breakdowns/`, `summary.json`. NILT `.sav` re-downloaded from ARK by stage 1.
