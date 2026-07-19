# Border Poll projection — v6 (per-party LucidTalk↔actual calibration)

v5 calibrated the survey→reality mapping on the **nationalist bloc only** (nationalist
share of the two constitutional blocs). This was the user's correction: calibrate on
**every party and the "independents & others" group**, plus the EU referendum — not just
the aggregate bloc — and only then read the implication for the unity metric.

`party_calibration.json` holds the fitted numbers; `lucidtalk_vi_primary.json` snapshots
the exact primary poll rows used.

## Data source — the persisted LucidTalk corpus (not Wikipedia)

The LucidTalk voting-intention figures come from the project's **own cleaned LucidTalk
corpus**, extracted from the original LucidTalk Belfast Telegraph reports + poll-table
spreadsheets and persisted on R2 at
`data.civgraph.net/data/polling/lucidtalk/cleaned/` (tidy schema: Measure / Response /
Breakdown / Base Type / Statistic / Value / Extraction Confidence). Each contest's poll
CSV is cited in `party_calibration.json → lucidtalk_source_urls`. All VI figures are the
**excl-non-voters** base.

## What was measured

For every contest that has a pre-election LucidTalk poll **in the corpus**, LucidTalk's
party voting-intention is compared to the **actual** NI first-preference / vote share
(repo `partySummary`). Error = LucidTalk − actual.

| Contest | LucidTalk poll (corpus) | Actual source |
|---|---|---|
| 2017 Assembly | `2017-02` Feb pre-Assembly tracker | `northern-ireland-assembly__2017-03-02` |
| 2022 Assembly | `2022-03` pre-Assembly poll | `northern-ireland-assembly__2022-05-05` |
| 2024 Westminster | `2024-06` pre-Westminster poll (Westminster VI) | `house-of-commons-of-the-united-kingdom__2024-07-04` |

The **2016 Assembly** is excluded: the corpus's VI series begins with the 2017
pre-election trackers, so there is no LucidTalk VI poll before the May 2016 election. NILT
is an **attitudes** survey and runs no party horse-race, so the per-party calibration is
**LucidTalk-only**; NILT enters the pipeline via the EU/unity attitude series.

## Per-party house effect (LucidTalk − actual, points)

| Party | 2017A | 2022A | 2024W | **Mean** | Reading |
|---|---:|---:|---:|---:|---|
| DUP | −1.76 | −2.33 | −1.06 | **−1.72** | LucidTalk **understates** the largest unionist party |
| Sinn Féin | −2.61 | −3.02 | −3.04 | **−2.89** | LucidTalk **understates** the largest nationalist party (every contest) |
| UUP | +1.04 | +1.83 | −0.15 | +0.91 | mildly overstated |
| SDLP | +0.25 | +1.93 | +1.86 | +1.35 | overstated |
| Alliance | +0.35 | +2.47 | +1.97 | +1.60 | overstated |
| TUV | +1.85 | +1.37 | −1.24 | +0.66 | ~accurate |
| Green | +1.09 | +0.10 | −0.11 | +0.36 | ~accurate |
| PBP | +0.64 | +0.86 | −0.08 | +0.47 | ~accurate |
| Aontú | 0.00 | −0.48 | +0.04 | −0.15 | ~accurate |
| Others / Independents | −0.85 | −2.73 | +1.81 | −0.59 | ~accurate on average |

**The signature is a "flagship-party understatement".** LucidTalk's online panel
consistently under-reads the two dominant, highly-mobilised parties — **Sinn Féin by
−2.9 in all three contests, the DUP by −1.7** — and over-reads the softer middle (SDLP
+1.4, Alliance +1.6). This is *not* the "−2.9 nationalist house effect" that v2–v4 wrongly
asserted: the error is turnout/enthusiasm-directional, landing on **both** blocs' flagship
parties, not one side of the constitutional divide.

## EU referendum (the closest real binary anchor)

| | Remain | Leave |
|---|---:|---:|
| Actual NI result | **55.78** | 44.22 |
| LucidTalk June-2016 raw | 52.15 | 38.04 |
| LucidTalk decided share | **57.82** | 42.18 |

LucidTalk **overstated the decided Remain share by +2.04 pts**. Remain is the
socially-liberal disposition closest to the demographic axis of a unity vote, so this is
the single most relevant calibration point — on a real *referendum* the panel tilted
~2 pts toward the "change" option.

## Implication for the unity projection

Weighting each party's house effect by a **unity propensity** (SF 0.97, SDLP 0.88,
Aontú 0.80, PBP 0.70, Green 0.55, Alliance 0.38, Others 0.35, UUP 0.10, DUP 0.03,
TUV 0.01) gives the net push the per-party errors exert on the unity metric:

**Net implied unity bias = −0.76 pts** — small.

The mechanism is now explicit and not the earlier "SF/DUP cancel" claim: **Sinn Féin's
−2.9 understatement is the largest single term** (it would understate the pro-unity vote),
but it is **partly offset by the overstated soft middle** (SDLP +1.4, Alliance +1.6, both
carrying moderate unity propensity). The residual is a small **negative** (LucidTalk very
slightly understates the unity-leaning composition), of the order of ¾ of a point. Set
against the EU-ref anchor's opposite **+2** referendum tilt, the two are within a point of
each other and roughly wash. Net: the unity level stays essentially where v5 put it
(~45–46% decided), with **no case for shading it upward**.

## Honest position

- Per-party calibration rests on **3 contests** — directionally clear and consistent for
  the flagship parties (SF understated in all three), thinner for the minors (|error| < 0.7
  pt, within sampling noise; not acted on).
- 2016 Assembly has no corpus VI poll; the 2024 contest is Westminster VI vs a Westminster
  result (like-for-like), the other two Assembly vs Assembly.
- The unity-propensity weights are a modelling choice, not a measurement.
- Irreducible caveat unchanged from v5: no training example's *output* is a unity
  referendum. The per-party + EU-ref calibration is transferred to the unity question.

Files: `party_calibration.json` (per-contest table, per-party mean errors, EU-ref
comparison, implied unity bias, source URLs); `lucidtalk_vi_primary.json` (exact primary
VI rows used).
