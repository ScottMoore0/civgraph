# Phases 28–30: poll level, census/persistence blend, deprivation

## 28 — Party VI polls as the NI level input ✅ ADOPT

### First, a defect that had buried this

`8_backtest.py` read `v6/lucidtalk_vi_primary.json` with `open()` and no encoding.
On Windows that decodes UTF-8 as cp1252, so `"Sinn Féin"` became `"Sinn FÃ©in"` and
`"Aontú"` became `"AontÃº"` — **both lookups returned 0**, and the "nationalist
bloc" was SDLP alone (12.2 / 11.0 / 13.0, exactly the printed values).

The backtest therefore reported a poll house effect of **−20.45 pts** and concluded
the polls were unusable. The true figure is about **−2.5**.

| | before fix | after fix |
|---|--:|--:|
| poll level MAE | 21.47 | **2.14** |
| mean signed error | −20.45 | −1.12 |

Same bug class as the cp1252 issue in `6_`. It had silently written off the only
forward-looking level signal the election model could have.

### The layer

Party VI recovered from **22 polls (2017-01 → 2026-04)** in the LucidTalk corpus:
the Assembly tracker measure, Total, percent, decided-voter (`exc_DK`) base.
Per-party house effects calibrated **leave-one-contest-out**.

| contest | poll | raw MAE | calibrated | persistence |
|---|---|--:|--:|--:|
| assembly 2016 | 2017-01 | 1.34 | 1.17 | 1.50 |
| assembly 2017 | 2017-02 | 1.12 | 0.80 | 1.05 |
| assembly 2022 | 2022-04 | 2.32 | 1.89 | 2.10 |
| westminster 2017 | 2017-09 | 1.01 | 1.23 | 2.57 |
| westminster 2019 | 2020-10 | 2.44 | 2.44 | 2.77 |
| westminster 2024 | 2024-08 | 1.85 | 0.92 | 1.54 |
| local 2023 | 2023-04 | 1.58 | 1.53 | 1.83 |
| **mean** | | 1.67 | **1.42** | 1.91 |

**The calibrated poll beats persistence (1.42 vs 1.91)** — and unlike persistence it
works for an election that has not happened. This is what turns the party model from
a backtester into a forecaster.

House effects (poll minus actual): DUP **−3.05**, Independent **−2.40**,
TUV **+2.44**, Green +1.43, SF −0.58, Alliance +0.21. Pollsters understate the DUP
and local independents, and overstate TUV and the Greens.

**Limit:** the VI series starts 2017-01, so local 2014 and 2019 have no poll within
12 months and fall back to the observed level.

## 29 — Per-party census/persistence blend ⚠️ ADOPT AT DEA ONLY

### A design point that had to be settled first

Phase 17's persistence baseline is "this area's mean share in other contests",
computed regardless of fold. Under leave-one-**council**-out that is **leakage** —
the fold removes every contest for that council, so those other contests are
held-out data. Persistence is not legitimately available under LOCO and its 15.56
there is optimistic.

Under leave-one-**contest**-out it is legitimate, and that is also the real
forecasting situation (the previous election result is known). The blend is
therefore evaluated leave-one-contest-out, with weights fitted by an inner
leave-one-contest-out on training contests only.

| scale | census | persistence | **blend** |
|---|--:|--:|--:|
| DEA (240) | 15.46 | 15.56 | **14.22** |
| constituency (108) | **13.53** | 15.37 | 14.19 |

**DEA: the blend wins clearly** (−1.24 TVD). Fitted weights are low for entrenched
parties — DUP 0.15, SF 0.14, UUP 0.31 (persistence-heavy) — and high for new or
moving ones — Aontú 1.00, Other 0.85, PBP 0.68 (census-heavy). Exactly the
structure predicted.

**Constituency: the blend loses to census alone.** The constituency set mixes
Assembly and Westminster contests, and persistence *across contest types* is weak —
the two behave differently (pacts, turnout, tactical voting). Restricting
persistence to within-contest-type would likely fix this; as built, use census
alone at constituency.

## 30 — NIMDM deprivation ❌ REJECT (and NISA is not applicable)

NIMDM-2017 **is** published at Small Area level, so it is available at every scale —
`augment/build_deprivation.py` had simply only ever aggregated it to the 18
constituencies. Built properly here: SA2011 → DZ2021 by centroid spatial join
(4,537 SAs, 4,520 matched directly, 17 nearest-snapped), population-weighted with
2011 usual residents, ranks converted to percentiles.

| feature set | LOCO shape R² | MAE | vs census |
|---|--:|--:|--:|
| census | +0.938 | **4.59** | — |
| census + deprivation | +0.938 | 4.61 | **+0.02** |
| deprivation alone (3) | +0.378 | 17.58 | — |

Individually: MDM +0.01, income +0.01, employment +0.01. **Nothing.** Deprivation
alone has real signal (R²=0.378) but is redundant once the census block is present —
NS-SEC, qualifications, economic activity and health already carry it. The same
verdict, for the same reason, as the LPS valuation data.

**Coverage caveat:** `deprivation_dz.csv` covers 2,840 of 3,780 Data Zones. SA2011
centroids cannot populate every DZ2021 where the 2021 zones are finer than the 2011
ones. Fine at DEA (80/80); a DZ-level use would need areal interpolation instead.

**NISA is not an area covariate and was not tested.** `augment/nisa_dz_series.csv`
is an NI-wide time series of unity support by survey wave (1989→) — a *level* series
for the referendum question, with no per-area values to join to a party-share model.
It is relevant to the unity model's historical extension, not to this one.
