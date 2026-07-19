# Border Poll projection — v6 (per-party LucidTalk↔actual calibration)

v5 calibrated the survey→reality mapping on the **nationalist bloc only** (nationalist
share of the two constitutional blocs). This was the user's correction: calibrate on
**every party and the "independents & others" group**, plus the EU referendum — not just
the aggregate bloc — and only then read the implication for the unity metric.

`party_calibration.json` holds the fitted numbers.

## What was measured

For every contest that has a clean final **LucidTalk** pre-election poll, LucidTalk's
party voting-intention is compared to the **actual** NI first-preference / vote share
(from the repo `partySummary`). Error = LucidTalk − actual.

| Contest | LucidTalk poll | Actual source |
|---|---|---|
| 2016 Assembly | 30 Mar–1 Apr 2016 | `northern-ireland-assembly__2016-05-05` |
| 2017 Assembly | 24–26 Feb 2017 | `northern-ireland-assembly__2017-03-02` |
| 2022 Assembly | 22–24 Apr 2022 | `northern-ireland-assembly__2022-05-05` |
| 2024 Westminster | 24–25 Jun 2024 | `house-of-commons-of-the-united-kingdom__2024-07-04` |

The **2017 Westminster** contest is deliberately excluded: there is no clean final
LucidTalk NI voting-intention poll before June 2017, so including it would mean
fabricating a poll row. NILT is an **attitudes** survey and runs no party horse-race, so
the per-party election calibration is **LucidTalk-only**; NILT enters the pipeline via the
EU/unity attitude series, not party VI.

## Per-party house effect (mean LucidTalk − actual, points)

| Party | Mean error | n contests | Reading |
|---|---:|---:|---|
| DUP | **−1.71** | 4 | LucidTalk **understates** the largest unionist party |
| Sinn Féin | **−1.97** | 4 | LucidTalk **understates** the largest nationalist party |
| UUP | +1.94 | 4 | overstated |
| SDLP | +0.98 | 4 | overstated |
| Alliance | +1.25 | 4 | overstated |
| TUV | +0.42 | 4 | ~accurate |
| Green | +0.50 | 4 | ~accurate |
| PBP | +0.47 | 3 | ~accurate (not listed 2016) |
| Aontú | +0.04 | 1 | only 2024 listed |
| Others / Independents | −0.88 | 4 | mildly understated |

**The signature is a "flagship-party understatement".** LucidTalk's online panel
under-reads the two dominant, highly-mobilised parties (DUP −1.7, SF −2.0) and
correspondingly over-reads the softer middle (UUP, SDLP, Alliance). This is the *opposite*
of the "−2.9 nationalist house effect" that v2–v4 wrongly asserted: the error is not
partisan-directional, it is **turnout/enthusiasm-directional** and it lands on *both* blocs'
lead parties roughly symmetrically.

## EU referendum (the closest real binary anchor)

| | Remain | Leave |
|---|---:|---:|
| Actual NI result | **55.78** | 44.22 |
| LucidTalk final Brexit poll (raw) | 52.15 | 38.04 |
| LucidTalk decided share | **57.82** | 42.18 |

LucidTalk **overstated the decided Remain share by +2.04 pts**. The Remain vote is the
socially-liberal / pro-EU disposition that most closely tracks the demographic axis of a
unity vote, so this is the single most relevant calibration point — and it says the panel
tilts ~2 pts toward the "change" option on a real referendum.

## Implication for the unity projection

Weighting each party's house effect by its **unity propensity** (SF 0.97, SDLP 0.88,
Aontú 0.80, PBP 0.70, Green 0.55, Alliance 0.38, Others 0.35, UUP 0.10, DUP 0.03,
TUV 0.01) gives the net push the per-party errors exert on the unity metric:

**Net implied unity bias = −0.10 pts** — essentially zero.

The reason is now explicit rather than assumed: **SF's understatement (pro-unity) and DUP's
understatement (anti-unity) very nearly cancel** across the constitutional divide. So the
per-party evidence *confirms* v5's headline conclusion by a completely independent route —
LucidTalk is not systematically biased on the constitutional question — while the EU-ref
anchor adds a small, opposite caution: on a *referendum* (not a party election) the panel
leaned +2 toward the change option. Net, the unity level is left essentially where v5 put
it (~45–46% decided), with the EU-ref anchor arguing for **not** shading it upward.

## Honest position

- Per-party calibration rests on **4 contests** (3 for PBP, 1 for Aontú) — directionally
  clear for the big parties, thin for the minors. The minor-party errors (< 0.5 pt) are
  within sampling noise and are not acted on.
- The unity-propensity weights are a modelling choice, not a measurement; the −0.10 result
  is robust to plausible re-weightings only because the two large cancelling terms dominate.
- The irreducible caveat is unchanged from v5: no training example's *output* is a unity
  referendum. The per-party + EU-ref calibration is transferred to the unity question.

Files: `party_calibration.json` (per-contest table, per-party mean errors, EU-ref
comparison, implied unity bias).
