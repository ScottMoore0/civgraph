# Border Poll projection — v7 (v6 per-party calibration folded into the projection)

v6 *measured* LucidTalk's per-party house effect against real elections but left
it as a finding; v5 was still the actual projected surface. **v7 applies the
v6-derived correction to the v5 projection**, so the SA/DZ surface and the
demographic breakdowns themselves carry the per-party learning — not just the
headline level.

`build_v7.py` reads only committed inputs (`../v5/` outputs + `../v6/
party_calibration.json`); no scratchpad/model dependencies.

## The correction

**Central (+0.76 pt, cleanly signed) — from the party-VI calibration.**
v6's net unity bias is `Σ mean_error_p · unity_propensity_p = −0.76`, where
`mean_error = LucidTalk − actual`. A negative value means LucidTalk's party VI
implies a unity-leaning composition **0.76 pt below** the actual-election
reality — i.e. LucidTalk *understates* the unity-leaning vote. Applied to the
border-poll level, the correction is therefore **+0.76 (upward)**, driven mostly
by LucidTalk's −2.9 understatement of Sinn Féin, only partly offset by its
overstatement of the (moderately unity-leaning) SDLP and Alliance.

> This revises v6's own summary wording ("no case for shading it upward"). The
> magnitude is small, but the *sign is up*: the cleanly-signed party-VI evidence
> says LucidTalk slightly understates unity, so v7 shades up by 0.76.

**Envelope (±2.04 pt) — from the EU referendum, sign-ambiguous.**
The 2016 EU referendum is the only real binary anchor, and it gives a house
effect of ~2 pt — but its **direction for unity is genuinely ambiguous**:

- *Structural analogy*: unity is the "leave-the-current-union" option, like
  Leave. LucidTalk understated Leave by 2.0 → unity correction **+2.0**.
- *Demographic analogy*: unity-supporters resemble Remain-supporters (pro-EU,
  nationalist-leaning). LucidTalk overstated Remain by 2.0 → unity correction
  **−2.0**.

Because the two readings cancel in sign, the EU-ref evidence is used as a
**symmetric uncertainty band (±2.04)** around the central estimate, not as a
point correction.

## How it is applied

A **uniform logit-space shift** `δ = logit(v5_level + 0.76) − logit(v5_level)`
is added to every Data Zone's projected unity and every demographic-breakdown
cell from v5. This preserves v5's entire geographic and demographic *structure*
(the validated NILT-MRP religion×age surface + census poststratification) and
only re-levels it. (For a sub-1-pt shift the logit map is effectively linear, so
the realised NI level matches the target to <0.05 pt.)

## Result

| Date | v5 level | **v7 level** | EU-ref envelope | DZ p10–med–p90 | maj-unity DZs |
|---|---:|---:|---|---|---:|
| 2021-01 | 46.1 | **46.9** | 44.8 – 48.9 | 22.6 – 40.8 – 77.0 | 41.1% |
| 2022-08 | 45.2 | **46.0** | 43.9 – 48.0 | 22.1 – 39.9 – 76.5 | 40.4% |
| 2024-02 | 44.7 | **45.5** | 43.4 – 47.5 | 22.0 – 39.5 – 76.4 | 39.9% |
| 2025-02 | 45.8 | **46.6** | 44.5 – 48.6 | 23.2 – 40.6 – 77.6 | 41.0% |

**The correction is small and the conclusion is robust:** folding in the
per-party calibration lifts decided-unity by ~0.8 pt to a stable **~45.5–46.9%**,
and even the top of the EU-ref envelope (~48–49%) **does not cross 50%** at any
of the four dates. ~40% of Data Zones project a unity majority.

## Outputs

- `areas/<date>_DZ21.csv` — per-Data-Zone projected unity at the v7 level
  (columns as v5: DZ21, label, catholic_bg_pct, proj_unity_pct, provenance).
- `breakdowns/<date>_breakdown.json` — unity % by every 2011/2021 census
  attribute, re-levelled to v7.
- `summary.json` — v5→v7 levels, correction, envelope, DZ percentiles, majority
  share.

## Honest position

- v7 changes the *level*, not the *structure*: the geographic/demographic shape
  is entirely v5's (validated NILT-MRP + census poststratification).
- The central correction rests on 3 clean LucidTalk↔election contests; the
  envelope on a single referendum with an ambiguous unity mapping. Both are thin.
- Irreducible caveat unchanged: no training example's output is a unity
  referendum; the survey→reality mapping is transferred, not tested on-target.
