# Stages 3–4: transfers and STV seats (v9 phases 18–20)

Both stages built **entirely from the repo's own data** — `test/metadata/elections-test2/*.json`.
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
