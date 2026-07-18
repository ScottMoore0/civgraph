# Border Poll (United Ireland) projection — DRY RUN

A first, deliberately transparent end-to-end projection of how a Northern
Ireland Irish-unity referendum ("Border Poll") might have gone **one week after
each LucidTalk unity-vote-intention poll**, broken down to **Small Area (2011)
/ Data Zone (2021)** and by **every 2011/2021 Census demographic attribute**.

This is a DRY RUN, not a forecast. See caveats.

## Inputs (all from the platform)

- **LucidTalk** unity vote-intention ("how would you vote in a Border Poll")
  with a Religion/community crosstab, for 6 polls that carry the direct
  question: Sep 2016 (PDF-report tier) and Jan 2021, May 2021, Aug 2022,
  Feb 2024, Feb 2025 (spreadsheet tier). See `lucidtalk_unity_vi_by_religion.json`.
- **NISRA Census** community background — 2011 Small Area (`census-2011-sa.csv`,
  4,537 SAs) and 2021 Data Zone (`RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO` from
  the FTB corpus, 3,780 DZs).
- **NISRA Census** 40 religion×attribute crosstabs (LGD) for the demographic
  breakdowns — every 2021 person attribute (national identity, age, tenure,
  passports, NS-SeC, economic activity, health, qualification, language, …).

## Method

1. From each poll's Religion crosstab, decided unity share per community
   group `g ∈ {Catholic, Protestant, Other/None}`: `rate_g = UI_g/(UI_g+UK_g)`.
2. Poststratify onto census composition per area:
   `UI_decided(area) = Σ_g comp_g(area)·rate_g`.
3. Calibrate: solve one logit shift so the population-weighted NI decided-UI
   equals the poll's NI decided headline (rake to the observed marginal).
4. Demographic breakdown for attribute `A`: `UI(k) = Σ_g P(g|k)·rate_g`, with
   `P(g|k)` from the NISRA religion×`A` crosstab.

Pre-2021 poll → 2011 Small Areas; 2021+ polls → 2021 Data Zones.

## Outputs

- `areas/<month>_<geo>.csv` — per Small Area / Data Zone: population, community
  background %, and projected decided-UI %, `provenance=modelled`.
- `breakdowns/<month>_breakdown.json` — projected decided-UI % for every
  category of every census attribute.
- `summary.json` — NI headline + geographic spread per poll.

Reproduce: `python3 pipeline.py` (expects the cached inputs in the scratchpad;
paths at the top of the script).

## Caveats (read before using any number)

- **Target never observed.** No unity referendum has been held; the output is
  an extrapolation of a plausible engine, not a measured or validated result.
- **NI total is pinned to the poll**, by construction (step 3). The model's job
  here is the *distribution* (geography + demographics), not the headline.
- **Sub-constituency estimates are model-carried.** No electoral outcome exists
  below constituency level to validate SA/DZ cells.
- **Community background only.** This dry run uses the single dominant driver.
  It does not yet use the full census↔election panel, poll house-effect
  calibration, direct age/gender poll crosstabs, a constituency backtest vs the
  2016 EU referendum, or NILT microdata — all identified next steps.
- **Other/None rate** is weakly identified (small, heterogeneous poll cell);
  in 2016 it is a prior. Demographic breakdowns beyond religion use census
  *composition*, not direct poll crosstabs.
- **DK** reported separately; the headline is decided voters only.
