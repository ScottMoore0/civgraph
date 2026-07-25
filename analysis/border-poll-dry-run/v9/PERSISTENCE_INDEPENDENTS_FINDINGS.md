# Phases 33–34: persistence v2, and independents from candidate history

## 33 — persistence v2: same-contest-type, boundary-bridged ✅ FIXED

Two defects, one cure. Persistence previously averaged a constituency's shares over
**all** other contests, mixing Assembly (STV) with Westminster (FPTP) — biased, not
merely noisy — and was **undefined** wherever boundaries changed.

`persistence_v2` averages only over prior contests **of the same type**, each
expressed on the target's own boundary vintage: the actual result where the vintage
matches, the phase-32 notional where it does not.

| method | constituency TVD med | DEA |
|---|--:|--:|
| census | 13.53 | 15.46 |
| persistence v1 (all types) | 15.37 | 15.56 |
| **persistence v2** | **13.81** | 15.56 |
| **BLEND census + persistence v2** | **12.74** | **14.22** |

**The constituency blend now wins** (12.74 vs census 13.53). It previously *lost* at
14.19. DEA is unchanged, exactly as predicted: local 2014/2019/2023 are one contest
type on one DEA vintage, which is why the blend already worked there.

## 34 — independents: the history classes separate as expected

`personId` is stable across contests, so candidate history is recoverable from the
repo's own metadata — no Statement of Persons Nominated scraping required. Across 11
contests: 3,974 candidacies, **289 independent candidacies**, of which 93 (32.2%)
have prior electoral history, 33 are ex-party defectors and 39 were previously elected.

Mean first-preference share by history class:

| class | n | mean share | max |
|---|--:|--:|--:|
| no prior history | 196 | 4.67 | 49.2 |
| prior, never elected | 54 | 4.07 | 22.9 |
| **prior, was elected** | **39** | **12.25** | 48.3 |
| of which ex-party | 13 | 6.77 | 16.2 |

**Refinement of the hypothesis: incumbency matters more than defection.** A sitting
independent (12.25 mean) outperforms a fresh party defector (6.77). The strongest
single discriminator is "were they elected last time", not "did they leave a party".

### Prediction — and the simple baseline wins

| model | MAE | corr |
|---|--:|--:|
| constant (mean share) | 4.83 | — |
| **prior_share only** | **4.27** | **0.520** |
| GBM on history features | 4.38 | 0.370 |

The GBM **overfits**: their last share, used directly, beats it. With 289 rows and
strictly-prior training folds, the simple estimator is the honest choice.

### Area level (local 2023)

| | MAE |
|---|--:|
| candidate history | **4.88** |
| census | 7.19 |

And the diagnostic that matters: of the 9 DEAs where independents actually polled
>15%, candidate history flags **6**; the census model flags **0**. The census model
never predicts a strong independent showing anywhere, because it cannot.

### Seats — real progress, not a solve

| variant | independent seats (actual 19) | total abs seat error |
|---|--:|--:|
| census Independent share | **0** | 156 |
| history share, split evenly | 2 | 154 |
| **history share, candidate-level** | **4** | **152** |

Feeding *candidate-level* first preferences matters: aggregating to an area total and
letting the simulator split it evenly across independents destroys the concentration
that actually wins a quota. One strong independent elects; three weak ones do not.

**Still only 4 of 19.** Consistent with the structure: only 32% of independent
candidacies have any prior history, and council level is exactly where genuine
first-time outsiders win. The tractable half is now tractable; the rest needs a
scenario input, which is the honest answer rather than a modelling failure.

### Where this connects

Phase 32's single notional miss was **North Down** — actual Independent (Alex Easton),
notional said DUP, because it carried his vote under the party label he then held.
The `personId` history built here is exactly what would let a notional follow the
*person* out of the party. The two layers should be joined next.
