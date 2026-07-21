# Transfers integrated: a revealed-behaviour softness covariate

`transfer_covariates.py` turns STV transfers into a per-constituency second-dimension covariate,
pooling the **7 NI Assembly elections (1998–2022)**. It walks each count sheet, keeps only
**single-source stages** (party-attributable; bulk multi-eliminations skipped), derives the
**non-transferable** parcel as the residual, and aggregates **elimination** flows by source-bloc →
destination-bloc (vote-value units). The headline metric is **unionist openness** — the share of
transferable unionist votes that leave unionism (to Alliance/centre or across the divide).

## It resolves the exact gap the census/survey can't see

Two ~85%-Protestant seats, treated as identical by religion-only models, are opposite on transfers:

| seat | unionist openness | unionist plumping | unionist→DUP |
|---|---|---|---|
| **North Down** | **19.0%** (soft) | 14.8% | low |
| **North Antrim** | **4.0%** (hard) | 12.3% | **46%** (+11% TUV) |

North Antrim unionists transfer **~96% within unionism** — 46% to DUP, 37.5% UUP, 11.3% TUV — and
only **2.2% to Alliance**. That is hard, tribal, anti-Agreement unionism made visible from revealed
ballot behaviour — the same electorate that produced the sole GFA No. North Down's unionists, same
religion profile, transfer nearly 5× more openly. **This is the within-Protestant hard/soft
distinction the model has never had** — and it's exactly what the North Antrim case needed.

## Ranking (pooled, 20 constituencies)

- **Softest** (most cross-tribe): North Down 37.7 · East Antrim 26.6 · Belfast East 24.5
- **Hardest** (most tribal): Londonderry 1.9 · Newry & Armagh 6.4 · Armagh 7.0 · **North Antrim 8.2**
  (rank 17 of 20)

(The composite `transfer_softness` is partly confounded by *mixedness* — cross-tribe transfers need
the other tribe present — so nationalist-homogeneous seats like Londonderry score "hard" for lack of
targets. The **bloc-specific `u_openness` / `n_openness`** are the cleaner behavioural reads and the
ones to feed downstream.)

## Integration

`transfer_softness` vs the survey `mean_hardness` correlates only **r = +0.40** (n=18) — and the sign
is confounded (both partly track unionist composition). The *modest* correlation is the point: the
transfer covariate is **not redundant** with the religion-only survey hardness; it carries the
orthogonal within-bloc signal (soft North Down vs hard North Antrim unionism) that the survey surface
flattens. It plugs into the **v11 softness / persuadability / area-uncertainty** layer as a
revealed-behaviour feature that **corrects the NI-average survey softness where local transfer
behaviour says an area is harder or softer than its demographics imply** — e.g. down-weighting
persuadability in hard-transferring North Antrim, up-weighting it in open North Down.

Output: `transfer_covariates_constituency.csv` (u_plump, u_cohesion, u_openness, n_plump, n_openness,
transfer_softness).

## Caveats (carried from the feasibility assessment)

- **Single-source stages only** — parties eliminated only in bulk stages contribute nothing (their
  flow is non-attributable); this thins coverage for minor parties but not the majors.
- **Vote-value, not voter-count** (fractional WIGM); **blended/conditional provenance** (elimination
  parcels mix passed-through votes; late transfers are conditional on who remained) — so these are
  *aggregate behavioural* covariates, not individual second preferences.
- **Assembly-only here** (extends to local 1993–2023 and European 1994–2019 STV contests, ~14 more —
  the natural next pooling); **STV contests only**, so it enriches the referendum/unity estimate
  *indirectly*, through the softness surface.
- **Mixedness confound** in the composite index (use the bloc-specific openness metrics).
