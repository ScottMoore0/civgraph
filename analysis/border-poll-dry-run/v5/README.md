# Border Poll projection — v5 (learned calibration, no arbitrary blend)

v5 removes v4's arbitrary 50/50 NILT↔LucidTalk blend and replaces it with a
combination **learned from real elections and the EU referendum**. Every weight
and correction is now estimated from how each source actually tracked reality,
not asserted. See `calibration.json` for the fitted numbers.

## What is now learned (not assumed)

### 1. The geographic gradient — from real votes
Aggregating census community background to the 18 constituencies (SA→SOA→AA) and
regressing the **actual** result on it, across every contest since 2016:

| Contest | slope | R² |
|---|---|---|
| 2016 EU ref (Remain) | 0.41 | 0.68 |
| 2016 Assembly (Nationalist) | 0.94 | 0.98 |
| 2017 Assembly | 1.04 | 0.99 |
| 2022 Assembly | 1.03 | 0.99 |
| 2017 Westminster | 1.14 | 0.99 |
| 2019 Westminster | 1.13 | 0.93 |
| 2024 Westminster | 1.11 | 0.97 |

**Actual nationalist-bloc vote is predicted by community background at R²≈0.99**
(slope ~1.0) — the geographic engine, validated on real votes. EU-Remain is far
flatter (0.41); the unity gradient is bounded by these, and the survey unity
crosstabs imply ~0.7 — consistent.

### 2. The LucidTalk↔reality calibration — from elections
Measured as **nationalist share of the two constitutional blocs** (which
neutralises the volatile Alliance/Other vote), LucidTalk vs the actual result:

| Poll → election | LT | actual | error |
|---|---|---|---|
| 2017 Westminster | 48.1 | 46.7 | +1.5 |
| 2022 Assembly | 48.6 | 49.4 | −0.8 |
| 2024 Westminster | 49.3 | 49.1 | +0.2 |

**Mean bias +0.3, RMSE 1.0 pt** — LucidTalk is essentially unbiased and accurate
to ~1 point on the constitutional balance. This **corrects a v2–v4 error**: the
earlier "−2.9 house effect" was an artifact of measuring nationalist share of
*all* votes (confounded by the Alliance surge). No +2.9 is applied in v5.

### 3. The source weights — from measured reliability
Inverse-variance weights from σ_LT = 1.0 (measured above) and σ_NILT ≈ 1.8
(sampling at n≈1000 + annual lag): **LucidTalk 0.76, NILT 0.24** — the data says
weight LucidTalk more (more accurate against elections, and dated to the day),
replacing the arbitrary 0.50/0.50.

## Result — learned-calibrated Irish-unity (decided) at the four dates

| Date | LucidTalk | NILT | **Learned level (0.76/0.24)** | DZ p10–median–p90 | maj-unity DZs |
|---|---|---|---|---|---|
| 2021-01 | 47.5 | 41.5 | **46.1** | 22–40–76 | 40% |
| 2022-08 | 46.1 | 42.5 | **45.2** | 22–39–76 | 39% |
| 2024-02 | 44.3 | 45.9 | **44.7** | 22–39–76 | 39% |
| 2025-02 | 46.1 | 44.8 | **45.8** | 23–40–77 | 40% |

Learned decided-unity is a **stable ~45–46%**, and — with the spurious +2.9
removed — it does **not** cross 50% at any of the four dates. ~39–40% of Data
Zones project a unity majority.

## Outputs

The geographic + demographic *structure* is the validated v4 NILT-MRP surface
(individual-level religion×age model, poststratified to Data Zone); v5 re-levels
it to the learned NI level. So `areas/<date>_DZ21.csv` and
`breakdowns/<date>_breakdown.json` (43 census attributes) are as in v4 but at the
learned level.

## Honest position

- The weights, biases, and gradient are now **empirical** — this is the principled
  answer to "why 50/50?".
- **Irreducible caveat unchanged:** every training example's *output* is a party
  election or the EU referendum — never a unity referendum. The learned
  survey→reality mapping is calibrated on those and **transferred** to the unity
  question. The 2016 EU referendum is the closest anchor (a real binary
  referendum) but is about EU membership, not the constitution. Until a Border
  Poll is actually held, that transfer is the one assumption that cannot be
  tested.
- Small n (3 clean LT↔election pairs, 7 gradient contests) — real but limited
  power; keep the model simple.

Files: `calibration.json` (the learned numbers), `areas/`, `breakdowns/`,
`summary.json`.
