# Border Poll projection — v9 (multi-scale spatial downscaling, learned on real results)

The architecture requested: **don't require attributes to be in both survey and
census.** Instead learn the **census-profile → actual-result** relationship, validate
it at every scale we can observe (**NI → LucidTalk regions → 18 constituencies → 80
DEAs**), then apply it to finer census geographies (Data Zone / Small Area) where
results are never reported. The LucidTalk/NILT poll supplies the *level and date* for a
given question (including Irish unity); the census profile supplies the *geographic
shape*. This yields (a) a DZ/SA projection and (b) a demographic breakdown.

Why this beats the MRP line: census attributes are **area features** (marginals,
published at every geography) — not poststratification cells — so the small-area-joint
disclosure wall does not apply and *all* census attributes can enter (regularised,
since they are highly collinear). It trains on **real ballots**, and the multi-scale
validation (1 → 80 units) is the strongest available guard against the ecological
fallacy short of a sub-DEA result (which does not exist — results stop at DEA/constituency).

## Phases (all complete)

1. ✅ **Labelled results frame** (`results_frame.csv`) — NAT/UNI/OTH bloc share per area
   per contest: 18 constituencies × 6 higher contests + 80 DEAs × 3 locals + 18 EU-ref.
2. ✅ **Census feature matrices** (`dea_features.csv`, `dz_features.csv`) — 88 features
   (community background, national identity, Irish/UK passports, Irish-language skills,
   tenure, NS-SEC, qualifications, economic activity, age, sex, health, country of birth)
   at DEA (80) and Data Zone (3,780), from the NISRA FTB corpus on R2.
3. ✅ **Regularised census→result model** (`3_fit_validate.py`) — ridge on all 88
   features, per-contest level removed → geographic shape.
4. ✅ **Multi-scale validation** — leave-one-contest-out at **DEA (80) R²=0.962** (MAE
   3.8 pt); scale-stable **DEA→council(11) R²=0.989 → NI(1) R²=0.994** (max err 0.2 pt).
   The relationship holds across every observable scale — the evidence it holds down at
   Data Zone. Top predictors: religion **+ national identity + Irish/UK passports +
   Irish-language skills** (`gradient_coefficients.csv`).
5. ✅ **Unity projection + breakdowns** (`4_project_unity.py`) — the validated ridge
   propensity gives the geographic shape; a data-driven 2-point calibration re-maps it to
   the LucidTalk unity poll (community rates + NI level, no free parameter); poststratified
   to every Data Zone.

## Results

**(a) Irish-unity referendum projected to Data Zone**, one week after each LucidTalk poll:

| Date | NI unity | DZ p10–med–p90 | maj-unity DZs (pop-wtd) |
|---|--:|---|--:|
| 2021-01 | 47.5 | 18.3–42.6–79.1 | 43.6% |
| 2022-08 | 46.1 | 19.3–41.6–75.1 | 41.8% |
| 2024-02 | 44.3 | 16.2–39.6–74.7 | 39.8% |
| 2025-02 | 46.1 | 17.2–41.3–77.4 | 42.2% |

`areas_unity/<date>_DZ21.csv` — projected unity for all 3,780 Data Zones. NI levels track
the poll toplines; **~40–44% of Data Zones project a unity majority; the NI level does not
cross 50%.**

**(b) Demographic breakdown** (`breakdowns_unity.json`) — projected unity by every census
attribute category, e.g. 2024: national identity Irish-only 61.0 / British-only 33.2;
passport Ireland-only 58.9 / UK-only 36.1; Irish-language speakers ~59 / none 42.1.

## Honest notes

- Breakdowns are **area-compositional** (pop-weighted mean of Data-Zone unity among people
  of each category), not individual-level rates — we have no individual unity-by-passport.
- All four poll dates are treated with **2021 attributes** (2021-01 is ~2 months pre-census;
  composition change negligible).
- **Irreducible:** no unity referendum has been held, so the poll→ballot mapping is learned
  on party/EU contests and transferred to the unity question. The multi-scale validation
  bounds the geographic-downscaling risk; it cannot bound the unobserved unity target.



## Correction — the NI level is a computed OUTPUT, not the poll topline

An earlier Phase-5 draft (`4_project_unity.py`) re-centred the projection so its NI mean
*equalled the LucidTalk decided topline* — i.e. it echoed the poll. `5_project_output.py`
fixes this: the **NI level is now computed from the survey inputs**:

`output = 0.76·LucidTalk_unity + 0.24·NILT_unity + house_effect`

- weights are inverse-variance from measured reliability (σ_LT≈1.0, σ_NILT≈1.8);
- house_effect is calibrated on real elections/EU-ref (v6): ~0 central on the
  constitutional metric, with a ±2.0 EU-referendum envelope (sign-ambiguous for unity).

Because NILT and LucidTalk disagree by up to 6 pts, the output differs from either poll
(2021-01: **46.1** output vs 47.5 LucidTalk / 41.5 NILT). Outputs in `areas_output/`,
`breakdowns_output.json`, `summary_output.json`.

**What determines what (the honest architecture):**
- **Level** → the surveys (NILT + LucidTalk), because they are the only sources that
  measure unity *preference*; the census does not, and no unity election exists. There is
  no way to derive an independent unity *level* from census/elections alone — they supply
  the geography and the house-effect calibration, not the level.
- **Geography (DZ/SA)** → the validated census→result ridge (all 88 attributes; multi-scale
  R²≥0.96).
- **Demographics** → the same engine.

| Date | Output NI | band | DZ p10–med–p90 | maj-unity DZs |
|---|--:|---|---|--:|
| 2021-01 | 46.1 | 44.1–48.1 | …–41.2–… | 42.2% |
| 2024-02 | 44.7 | 42.7–46.7 | …–40.0–… | 40.2% |
| 2025-02 | 45.8 | 43.8–47.8 | …–41.0–… | 41.8% |

Still short of 50%; ~40–42% of Data Zones project a unity majority. The permanent caveat
stands: no unity referendum has been held, so the survey→ballot house effect is transferred
from party/EU contests (thin: one real referendum anchor).
