# Area-specific uncertainty from measured softness (stage b)

`v11b_softness_uncertainty.py` replaces the **uniform ~6.9pt** v11 Data-Zone band with an
**area-specific** one: each DZ's interval width is driven by *its own* measured softness. Softness
per community comes from the validated hardness work — the direct NILT-2019 continuous score,
cross-checked by the demographic-volatility model (`demographic_softness.py`), giving
`SOFT = {Catholic 1.0, No-religion 0.83, Protestant 0.0}` (max-separation, volatility-ranked).
It is poststratified onto each DZ's religion composition, then:

```
sigma_DZ = sqrt( sampling^2 + (softness_DZ * swing_scale)^2 )   # SAMP=2.0, SWING=7.0
90% band = point ± 1.64·sigma
```

## The one distinction that matters: band WIDTH ≠ majority-uncertainty

This is the trap the first cut fell into. There are **two different uncertainties**, and they point
at **different places on the map**:

| | what it measures | where it peaks | who it flags |
|---|---|---|---|
| **Band width** | uncertainty in the Yes **share** | softest areas | Belfast West (98% Catholic) |
| **Majority-uncertainty** | uncertainty in **which side wins** | soft **AND** near 50 | the ~51%-Catholic mixed DZs |

**Band width (softness alone):**
- narrowest **~7.2pt** — hard-unionist **North Antrim** DZs (Protestant, unmovable share)
- widest **~23.5pt** — **Belfast West** DZs (soft Catholic, movable share)
- distribution across DZs: p10 8.3 / median 12.2 / p90 22.0 pt (vs the old flat 6.9pt)

**But a wide band is NOT an uncertain majority.** Belfast West's widest-band DZ sits at Yes ≈ 77%
±12pt — and the probability its **majority** flips to No is **0.0%**. It is a *soft but secure*
Yes area: you are genuinely unsure whether it's 65% or 88% Yes, but never unsure that it's Yes.
Labelling it "the softest / a coin-toss" (the earlier framing) was wrong — it conflated an
uncertain *share* with an uncertain *outcome*.

**Majority-uncertainty = softness × proximity to 50** — a DZ decides the referendum only when it is
both movable **and** balanced. Formalised as `p_below50` (Normal CDF that the true Yes% is below
50) and `maj_uncert = 0.5 − |p_below50 − 0.5|` (peaks at a true coin-toss). The DZs that top it are
the **~51%-Catholic, near-Yes-50 battlegrounds** — Upper Bann, Foyle, Fermanagh & South Tyrone, the
mixed fringes of North Antrim, Belfast South — exactly the persuadability battlegrounds the 5-band
work identified, now recovered from an independent uncertainty route. **~12% of the population lives
in genuinely balance-of-power DZs** (maj_uncert > 0.15); the deep-green and deep-orange DZs, however
soft or hard, do not move the result.

## What this changes vs the old v11 band

- Uncertainty is now **local**, not a single number stamped on every DZ. A hard-unionist ward is
  reported near-certain in its (losing) call; a soft Catholic ward is reported wide but still
  securely Yes; a balanced mixed ward is correctly flagged as the actual toss-up.
- The **outcome risk is spatially concentrated**: the aggregate NI band partly cancels, and what
  residual majority-risk remains is carried by that ~12% balance-of-power slice — the honest place
  to point a campaign, a recount worry, or a "too close to call" caveat.
- Where a data-poor era lacks the direct attitude items (NISA, pre-2019 NILT), the same softness
  surface is imputed from **demographic volatility** (validated same-rank against the direct score),
  so the area-specific band extends backwards in time on the same footing.

## Caveats

- **The point-unity layer here is religion-only** (Catholic 82.6 / other 26.0, re-centred to the
  survey level 45.8). So a 51%-Catholic DZ mechanically lands near Yes 50 — the *battleground set* is
  robust, but any single DZ's exact point still inherits v11's religion-only limitation (a
  religion×identity cell mix is the documented fix). The **maj_uncert ranking** — soft × balanced —
  is the durable output, not the third-decimal point estimate.
- **SWING=7.0** is a calibration choice (tuned so the widest bands sit ~22pt, not the implausible
  30pt of the first pass); it scales all widths together and does not affect *which* DZs are
  flagged as battlegrounds.
- Softness is a **within-wave attitude/volatility composite**, not observed individual switching
  (NILT has no panel) — the standard hardness caveat carries through.

Output: `v11_dz_softness_intervals.csv`
(`DZ21, con, catholic_bg_pct, soft, unity, lo90, hi90, band90_width, p_below50, maj_uncert`).
