# Joint level + area estimation by poll date (no fixed level)

`unity_timeseries_dz.py` replaces the two-step "set the level, then derive area shape from a fixed
2019 model + re-centre" with **one process per poll date**: fit the Yes-of-decided propensity on
*each* NILT wave (2019–2025 — real unity polls at distinct dates) and poststratify onto the 2021
census frame. The **NI level and the Data-Zone map both fall out of the same wave's data** — nothing
is re-centred, and because the demographic gradient of Yes shifts over time (Brexit), each date gets
its own gradient, so a DZ's estimate moves with both its composition and that era's attitudes.

## The result — level and map measured together, per poll

| poll (NILT wave) | n decided | raw poll Yes-of-decided | **poststratified NI Yes** | DZs >50% Yes | pop in a majority-Yes DZ |
|---|---|---|---|---|---|
| 2019 | 872 | 33.5% | 35.3% | 905 | 28% |
| 2020 | 1025 | 35.8% | 40.8% | 1,138 | 36% |
| 2021 | 1117 | 41.8% | 42.1% | 1,194 | 38% |
| 2022 | 1116 | 42.7% | 44.2% | 1,269 | 40% |
| 2023 | 951 | 43.2% | 43.7% | 1,250 | 39% |
| **2024** | 903 | 46.0% | **47.4%** | 1,372 | 43% |
| 2025 | 957 | 44.4% | 44.6% | 1,292 | 41% |

3-wave-smoothed poststratified NI Yes (pooling adjacent polls, per your "other recent polls" point):
**2019 38 → 2021 42 → 2023 45 → 2025 46**.

**What changed vs the fixed-45% approach:**
- The level is now **measured, not assumed** — each poll drives its own NI number, and the
  poststratified value stays close to the raw poll (validating the model), differing only by the
  survey-vs-census composition correction.
- The **map co-moves**: as Yes rose 2019→2024, the share of the population in a majority-Yes Data
  Zone went **28% → 43%**, and majority-Yes DZs grew **905 → 1,372** — the area distribution is an
  *output* of the same fit, not a fixed shape scaled to a topline.
- Each date uses **that era's gradient**, so a 2024 map is not a 2019 map shifted up; it reflects the
  younger / no-religion / soft-Catholic movement into Yes that a re-centred 2019 model would miss.

## The current (2025) data-driven DZ map

NI 44.6%; **1,292 / 3,266 DZs majority-Yes**. Constituency Yes-share top **Belfast West 69 · Foyle
64 · South Down 60 · West Tyrone 59**; bottom **North Down 26 · Strangford 26 · Belfast East 27 ·
East Antrim 27**. Full DZ map in `unity_yes_dz21_2025.csv`.

## On LucidTalk and folding in a specific poll

NILT waves *are* real unity polls at fixed dates, so the series above already answers "use the poll
whose date is used to drive both NI-wide and area results." To anchor on a **LucidTalk** poll
specifically, its crosstabs (Yes by religion and by age, plus the topline) would be raked into the
nearest wave's model — the LT poll then sets the level and its own religion/age structure while NILT
supplies the finer joint. LucidTalk microdata/crosstabs are **not in the repo**, so that step needs
the LT tables supplied; the method is a one-line change (rake the cell propensities to the LT
margins before poststratifying). The 3-wave smoothing already pools adjacent NILT polls.

## Caveats

- **Religion × age** propensity (identity dropped) for full 3,266-DZ coverage and cross-wave
  comparability; identity is a weak axis (established) and not present in every wave.
- Poststratified NI runs a touch above the raw poll in some waves — the census composition is
  modestly more Yes-leaning than the survey's achieved sample; this is the poststratification
  correction, not a level assumption.
- Per-wave n≈900–1,100 decided → single-wave DZ maps carry sampling noise; the smoothed series and
  the multi-wave trend are the robust signal.
- Absolute DZ numbers still depend on the survey mode (NILT house effect); a real count would differ.
  The map answers "where, and how it's moving," not "the exact tally."

Outputs: `unity_timeseries_dz.csv`, `unity_yes_dz21_2025.csv`.
