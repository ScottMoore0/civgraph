# Border Poll projection — v2 (poll-vs-reality calibrated)

v2 adds the missing piece from v1: it uses the **election/referendum results**
to calibrate and validate against reality, instead of trusting the LucidTalk
polls at face value. Three anchors:

## (A) House effect — LucidTalk vs actual elections

Matched each poll to the nearest actual NI Assembly election and compared its
**bloc vote-intention** to the real result:

| Poll | LT Nationalist | Actual (2022 Assembly) | Bias |
|---|---|---|---|
| Mar 2022 | 38.7% | 41.0% | −2.3 |
| Aug 2022 | 37.5% | 41.0% | −3.5 |

LucidTalk **understates** the nationalist/pro-unity bloc by ~**2.9 pts** — so
its raw unity numbers are, if anything, slightly conservative. Applied as a
+2.9-pt correction to the decided-unity headline.

*Caveat:* n=2, one election, polls 2–3 months off the vote (timing partly
confounds the estimate). A single uniform shift is a dry-run simplification.

## (B) 2016 EU referendum backtest — validates the geographic engine

Aggregated 2011 community background to the 18 constituencies (SA→SOA→AA) and
regressed the **actual 2016 Remain%** on it:

```
Remain% = 37.9 + 0.412 · Catholic%      R² = 0.68   (r = 0.83)
```

Community background explains **68%** of the real constituency variation in a
genuine constitution-adjacent vote — the engine reproduces real electoral
geography. Residuals (the "beyond community background" lean) are recognisable:
Belfast South +13.5 and North Down +9.3 (cosmopolitan Remain), North Antrim
−11.8 and Upper Bann −8.6 (DUP-heartland Leave).

## (C) Residual calibration

The 2016 constituency residuals (scaled ×0.5, since Remain ≠ unity) are added to
the 2011 Small-Area geography, then the NI total is re-pinned to the
house-corrected headline. *2021 Data-Zone residuals await a DZ→constituency
crosswalk (the 2021 DZ labels use renamed wards that don't match the 2011
bridge) — DZ maps carry house-effect + poststratification only.*

## Result: v1 → v2 (decided-unity headline)

| Poll | v1 | v2 (calibrated) |
|---|---|---|
| Sep 2016 | 46.3% | **49.2%** |
| Jan 2021 | 47.5% | **50.4%** |
| May 2021 | 46.2% | **49.1%** |
| Aug 2022 | 46.1% | **49.0%** |
| Feb 2024 | 44.3% | **47.2%** |
| Feb 2025 | 46.1% | **49.0%** |

Calibration lifts the estimates ~3 pts; Jan 2021 is the one snapshot that tips
past 50%. The headline change is modest because the polls turn out **not** to be
badly biased — the real value of v2 is that the numbers are now *validated*
(R²=0.68) and *reality-corrected*, not taken on trust.

## What still isn't done

- House effect from one election only; should span more matched poll↔election
  pairs (incl. Westminster) and be modelled over time, not a constant shift.
- 2016 residuals are an EU proxy for unity lean (down-weighted, not exact).
- DZ→constituency crosswalk missing → no per-constituency residuals on 2021 maps.
- Still community-background-driven; no NILT microdata, no full census↔election
  panel, no turnout-differential model. The target remains unobserved — this is
  a validated engine, not a measured referendum result.

Files: `pipeline_v2.py`, `areas/<month>_<geo>.csv` (v2 per-area UI%),
`summary_v2.json` (backtest + residuals + v1↔v2).
