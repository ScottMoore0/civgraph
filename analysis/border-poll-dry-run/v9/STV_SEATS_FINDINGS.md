# Stages 3–4: transfers and STV seats (v9 phases 18–20)

Both stages built **entirely from the repo's own data** — `render/metadata/elections-test2/*.json`.
No data and no code was taken from the `privaterep` / `ni_votes` project; the count
engine is implemented from the published PR-STV rules, which is also what keeps a
private-repo dependency out of a public repo.

| script | what it does |
|---|---|
| `18_transfer_model.py` | estimates the party→party transfer matrix + non-transferable rates from the count-by-count data |
| `19_stv_simulator.py` | PR-STV Gregory count engine; replays real contests |
| `20_seat_projection.py` | end-to-end census → shares → count → seats, with the error decomposed |

## Stage 3 — transfer model

Source is `results[].animationPayload.Constituency.countGroup`: one row per
candidate per count with `Total_Votes`, `Transfers`, and `Status`/`Occurred_On_Count`
marking elections and exclusions. Sources at count *N* are the candidates resolved
at *N−1*; destinations are the positive transfers received.

**Attribution.** NI counts routinely exclude several candidates at once (South Down
2022 count 3 excludes four), so the destination split cannot be attributed to one
donor. Since the matrix is party→party, a bundle is still usable when every source
is the *same party*; only mixed-party bundles are dropped. **333 events usable,
1,533 mixed-party bundles excluded (17.8%)** — the single biggest limitation here,
and the problem `adjusted_transfers.py` exists to solve in the other project.

Estimated matrix (top destinations), which is face-valid against known NI politics:

| source | destinations |
|---|---|
| DUP | DUP 63%, UUP 24% |
| TUV | DUP 61%, UUP 23% |
| Sinn Féin | SF 43%, SDLP 31%, Alliance 15% |
| SDLP | SF 26%, Alliance 25%, SDLP 20% |
| Alliance | SDLP 39%, Alliance 19%, UUP 13% |
| Green | Alliance 50%, SDLP 14% |
| PBP | SDLP 33%, SF 30%, Alliance 15% |

Bloc level: **UNI → UNI 85%**, NAT → NAT 62% / OTH 29%, OTH → NAT 47% / OTH 31% / UNI 22%.
Non-transferable rates range from DUP 10.9% to PBP 33.0%.

**Validation** (leave-one-contest-out, destination-share TVD):

| held out | raw | availability-conditioned |
|---|--:|--:|
| assembly 2016 | 0.475 | **0.328** |
| assembly 2017 | 0.468 | **0.281** |
| assembly 2022 | 0.572 | **0.307** |

Restricting predictions to parties that still have a continuing candidate, and
renormalising, cuts error ~40%. Without it the matrix sends votes to parties
already eliminated. Residual ~0.30 TVD is the honest accuracy of a party-level
model that knows availability but not candidate identity.

## Stage 4 — STV count engine

Gregory surplus method: quota = ⌊valid/(seats+1)⌋+1; elect at/above quota;
distribute surplus at transfer value; eliminate lowest otherwise; split a party's
share across its continuing candidates in proportion to current votes; withhold the
source party's non-transferable rate; elect all remaining when continuing == seats left.

**Replay — true first preferences in, simulated count out** (isolates engine +
transfers from any share-prediction error):

| contest | areas | seat accuracy | party-exact | candidate-exact |
|---|--:|--:|--:|--:|
| assembly 2016 | 18 | 94.4% | 77.8% | 66.7% |
| assembly 2017 | 18 | 95.6% | 77.8% | 77.8% |
| assembly 2022 | 18 | 94.4% | 77.8% | 72.2% |
| local 2014 | 80 | 91.3% | 62.5% | 53.8% |
| local 2019 | 80 | 90.5% | 57.5% | 52.5% |
| local 2023 | 80 | 93.3% | 70.0% | 65.0% |
| **overall** | **294** | **92.2%** | 66.0% | 59.9% |

NI-wide Assembly 2022 from true first prefs: **total absolute seat error 6 of 90**
(Alliance and TUV exact; SF +1, DUP +1, SDLP +1, UUP −1, Ind Unionist −1, PBP −1).

## The error decomposition — and a correction to my earlier claim

| stage | mean party-seat error/area | exact |
|---|--:|--:|
| A replay (true first prefs) | 0.74 | 66.0% |
| B + nomination assumption (true shares) | 1.10 | 51.4% |
| C + predicted shares (full end-to-end) | **2.26** | 20.1% |

- cost of the **nomination assumption** (B−A): **+0.35** seats/area
- cost of the **share model** (C−B): **+1.16** seats/area

**I previously said seat error would be dominated by nomination strategy and vote
management. That is wrong at the current level of share-model quality — the share
model contributes over three times more error.** Nomination strategy is still
irreducible, but it is not the binding constraint; improving the share model is
where the next seat accuracy comes from.

## End-to-end NI-wide

**Assembly 2022 — total absolute seat error 6 of 90.** DUP, UUP and TUV exact;
SF +1, Alliance +1, SDLP +1; misses are Independent Unionist (2→0) and PBP (1→0).

**Local 2023 — total absolute seat error 92 of 462.** Much weaker: Alliance +21,
UUP +13, SDLP +12, SF −14, and **Independents 19 → 0**.

The scale gap is consistent with everything else found: the share model is far
better at constituency than at DEA, and **independents are unpredictable**
(presence accuracy 0.479, below the 0.517 majority-class baseline). Nineteen real
independent councillors were projected as zero. Any local-government seat
projection must treat independents as a scenario input, not a modelled quantity.

## What would improve this next, in order

1. **Recover the mixed-party bundles** (82% of transfer events currently dropped) —
   an apportionment model like `adjusted_transfers.py`'s notional single-donor rows.
2. **Improve the share model at DEA** — it contributes 3× the nomination error.
   The stage-2 finding stands: blend census with area persistence per party.
3. **Handle independents explicitly** as a scenario input.
4. Candidate-level rather than party-level transfers (needs candidate identity
   features; this is where the other project's ML approach is genuinely ahead).

---

# Phase 21–22: nomination model — the pipeline now runs ex ante

Phases 19–20 needed the real candidate list, so they could only score a contest
*after* nominations closed. Phase 21 predicts it, closing the last open link:

    census -> party share -> NOMINATIONS -> STV count -> seats

**Why it works.** Nominations are not free choices, they are quota arithmetic. A
party with share *s* in an *M*-seat district expects `s*(M+1)/100` quotas and
nominates about that many, rounded up. On the repo's own data that rule alone,
nothing fitted, matches the true count in **78.3%** of party-area cases (r = 0.780);
restricted to rows with a lagged observation it reaches 87.7%.

## Model

GBM on expected quotas, seats available, the party's candidate count and share in
the same area at the previous contest of the same type, party identity. Validated
leave-one-council-out against two baselines it must beat.

| regime | baseline: ceil(quotas) | baseline: lag | **model** | MAE | total-candidate err |
|---|--:|--:|--:|--:|--:|
| TRUE share (upper bound) | 87.7% | 70.3% | **90.0%** | 0.105 | 1.0% |
| **PREDICTED share (ex ante)** | 81.2% | 70.3% | **89.3%** | 0.114 | 1.7% |

**The model barely degrades when share is predicted rather than known** (90.0% →
89.3%), because it leans on incumbency and the rough quota level, not on precise
share. That is what makes it usable ex ante.

Per party (predicted-share regime): Aontú 100%, PBP 99.5%, TUV 98.5%, Green 98.0%,
SDLP 90.8%, Alliance 87.8%, SF 84.7%, UUP 84.2%, DUP 80.1%, **Independent 77.6%**.
Small parties are near-perfect because they almost always run exactly one or none;
the difficulty is concentrated in the big parties that run three to six, and in
independents.

## Cost to the seat projection

| stage | mean party-seat error/area | exact |
|---|--:|--:|
| D1 predicted shares + REAL candidate list | 2.21 | 22.4% |
| D2 predicted shares + PREDICTED nominations | **2.39** | 17.3% |

**Cost of predicting nominations: +0.17 seats/area.** Total candidates projected
2,056 against 2,092 real (−1.7%). Scored on 196 areas / 1,104 seats — the 2014 and
2016 contests drop out because the lag feature needs a previous contest.

## Revised error budget

| link | cost (seats/area) |
|---|--:|
| count engine + transfers | 0.74 (floor) |
| nomination assumption (even split) | +0.35 |
| **share model** | **+1.16** |
| predicting nominations | +0.17 |

The ordering is now settled: **the share model dominates, by roughly 7× the
nomination-prediction cost.** My original claim that nomination strategy would be
the binding constraint was wrong twice over — first because the share model costs
more, and second because nomination *counts* turn out to be highly predictable.

What remains genuinely irreducible is not how many candidates a party runs, but
**how it spreads its vote across them** (vote management) — that is the +0.35 in
stage B, and it is the smaller of the two nomination-related terms.

---

# Phase 18 revision — local transfer data recovered

## A correction to what this document previously claimed

It said mixed-party bundles were "the single biggest limitation", with "333 events
usable, 1,533 excluded (17.8% usable)". **That was wrong.** The true breakdown of
the 1,866 extracted events, by transferred vote:

| bucket | events | votes moved | % of vote |
|---|--:|--:|--:|
| **no source identified** | 1,473 | 536,182 | **49.6%** |
| single source party (used) | 333 | 455,269 | 42.1% |
| mixed-party bundle | 60 | 88,828 | **8.2%** |

Mixed-party bundles were only **8.2%** of transferred vote — 60 events, not 1,533.
Fixing them would have gained almost nothing. The 1,533 figure conflated the two
categories.

## The real defect, and it split perfectly by contest type

| contest | events with a source | with none |
|---|--:|--:|
| assembly 2016 / 2017 / 2022 | 156 / 110 / 127 | 0 |
| local 2014 / 2019 / 2023 | 0 | 542 / 455 / 476 |

The extractor identified the source from `Occurred_On_Count`. The Assembly files
stamp that per count; **the local-government files do not** — Airport 2023 has 35 of
38 rows reading `"5"`, the count at which the count concluded. A constant, not an
event marker.

So **the transfer matrix was estimated from Assembly contests alone** — and then
used to project *local* seats, the contest type with the worst accuracy. Council
elections were being modelled on Assembly transfer behaviour with no local evidence.

## The fix

Sources are now identified by **negative `Transfers`**, which both formats populate.
Airport 2023 resolves cleanly: count 2 Green −134/+134, count 3 DUP −490/+490,
count 4 Sinn Féin −237/+237.

Also handled: the local files carry a pseudo-candidate row literally named
**"Non-transferable"** (476 rows in 2023; absent from Assembly files). Counting it as
a destination party would both pollute the matrix and understate non-transferability.
It is now read as the *directly measured* non-transferable mass, which is better than
inferring it from the lost/moved shortfall.

Availability is likewise derived from the vote table (still holds votes, not yet
spent) rather than `Occurred_On_Count`, so it works for both formats.

## Effect

| | before | after |
|---|--:|--:|
| usable events | 333 (17.8%) | **1,723 (92.6%)** |
| DUP source mass | 69,690 votes | **147,313** |
| local contests in the matrix | none | all three |
| STV replay seat accuracy | 92.2% | **93.0%** |
| replay party-exact | 66.0% | **69.4%** |
| engine floor (stage A) | 0.74 seats/area | **0.64** |
| forecaster seats (phase 31) | 2.03 | **2.00** |

Local replay accuracy rose across the board (2014 91.3→92.0, 2019 90.5→91.8,
2023 93.3→94.2) — the contests that gained their own transfer evidence.

Non-transferable rates are now measured rather than inferred: DUP 10.7%, SDLP 24.8%,
PBP 32.3%, Aontú 37.3%. Leave-one-contest-out destination TVD is stable at
0.25–0.31 availability-conditioned, now including local folds (n=430–474 each)
that previously could not be scored at all.

The end-to-end gain is small (2.03 → 2.00) because the share model still dominates
the error budget at +1.14 seats/area against the engine's 0.64 floor. But the floor
itself improved 14%, and the matrix now rests on 5× the evidence.
