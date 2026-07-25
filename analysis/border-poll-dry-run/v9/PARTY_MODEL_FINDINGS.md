# Party-share model — stages 1–2 (v9 phases 16–17)

Extends the bloc model (nat/uni/oth) to **11 party categories**, with the
compositional and presence machinery party prediction needs. Scripts:
`16_party_results_frame.py` (stage 1), `17_party_model.py` (stage 2).

## Stage 1 — party-wise results frame

`party_results_frame.csv`: **3,828 rows** = 98 areas × 9 contests × 11 parties
(assembly 2016/2017/2022 and westminster 2017/2019/2024 at 18 constituencies;
local 2014/2019/2023 at 80 DEAs). Each row carries votes, share, seats won, seats
available, valid poll, electorate, turnout and a **`stood` flag**.

Party presence varies enormously, which is why `stood` is not optional:

| party | stood in | mean share where stood |
|---|--:|--:|
| DUP | 94.3% | 27.2% |
| UUP | 93.1% | 14.4% |
| Alliance | 92.0% | 12.3% |
| Sinn Féin | 86.5% | 28.6% |
| SDLP | 86.2% | 13.0% |
| Independent | 51.1% | 8.5% |
| TUV | 50.3% | 7.3% |
| Green | 43.7% | 3.6% |
| Aontú | 18.4% | 3.4% |
| PBP | 16.7% | 5.7% |

A party that did not contest an area is an **absence, not a zero**. Treating the
two alike would train the model to predict near-zero shares in half of all
TUV/Green/Independent cells for reasons that have nothing to do with demography.

### Defect found in the incumbent frame — and it was costing accuracy

Re-aggregating the party shares into the v9 blocs reproduces `results_frame.csv`
**exactly (≤0.005 pt, i.e. rounding) for assembly ×3, westminster ×3 and local
2023** — but **not for local 2014 and local 2019**.

For **40 of 348 area-contests**, `results_frame.csv` carries a vote total matching
neither `validPoll`, nor `totalVotes`, nor the sum of `firstPrefs` in the source
file. Example — Bangor Central 2019: source says **7,357** on all three measures;
the incumbent frame says **6,479**. Because bloc shares divide by that understated
denominator, the *labels* are distorted too, by up to **20 pts** (The Mournes 2019:
52.2 actual vs 72.5 in the frame).

This is not confined to the party work: **two of the three local contests the v9
bloc model trains on are affected.** Rebuilding the labels from source and re-running
the incumbent harness unchanged:

| labels | LOCO shape R² | MAE |
|---|--:|--:|
| incumbent `results_frame.csv` | +0.932 | 4.94 |
| **corrected from source** | **+0.938** | **4.59** |

**Fixing the labels is worth 0.35 pts — more than every LPS property feature
tested combined (best: 0.11).** `results_frame_corrected.csv` is written alongside
rather than over the incumbent file, so nothing changes silently; adopting it is a
decision for the model owner.

## Stage 2 — compositional share model + presence model

**Share model.** Independent per-party ridges do not respect the simplex — they
neither sum to 100 nor stay non-negative. Shares are therefore centred-log-ratio
transformed (additive smoothing `eps=0.5`), a ridge fit per CLR coordinate with the
per-contest level removed exactly as the bloc model does, and predictions mapped
back through a **softmax restricted to parties present**, summing to 100.

**Presence model.** Logistic ridge per party, `P(stood | census)`.

Scored by **total variation distance** — half the summed absolute error across
parties, i.e. *the share of the electorate allocated to the wrong party*. Folds are
leave-one-council-out at DEA (spatial blocking, as in the bloc model) and
leave-one-area-out at constituency.

### Results

| | DEA (240) | constituency (107) |
|---|--:|--:|
| contest mean (no model) | 32.56 | 30.10 |
| **area persistence** | **16.43** | **16.62** |
| census, LO-contest-out | 18.71 | 15.19 |
| census, LO-council-out | 20.77 | 17.24 (median **13.72**) |
| end-to-end (predicted presence) | 22.70 | 19.34 |

**The census model does not beat area persistence** — the same verdict the bloc
model reaches (persistence MAE 2.65 vs the model's 5.35). Knowing how an area voted
last time remains more informative than its demography.

**But the split by party is the useful finding** (DEA, MAE on share):

| party | census | persistence | winner |
|---|--:|--:|---|
| DUP | 7.79 | **3.37** | persistence |
| Sinn Féin | 8.26 | **5.03** | persistence |
| SDLP | 6.80 | **3.70** | persistence |
| Independent | 4.28 | **3.69** | persistence |
| Alliance | **4.06** | 4.42 | census |
| TUV | **2.20** | 2.43 | census |
| Aontú | **0.46** | 0.91 | census |
| Other | **1.49** | 3.64 | census |

**Census wins for small, new and rising parties; persistence wins for the large
established ones.** That is exactly the structure you would expect — persistence
needs a history to persist, so it fails for Aontú (founded 2019) and for parties
whose support is moving. The practical implication for stage 3+ is a **blended
model**, not a choice between the two.

### NI-wide aggregation is already usable

Poll-weighted party shares aggregated to NI, leave-one-council-out:

| contest | mean abs err | max abs err |
|---|--:|--:|
| assembly 2022 | 0.66 | 2.8 |
| assembly 2017 | 0.79 | 2.8 |
| local 2023 | 1.35 | 3.7 |
| westminster 2024 | 1.37 | 4.3 |
| westminster 2019 | 1.44 | 7.0 |

Westminster is visibly the worst, as expected: FPTP induces tactical voting and
**unionist pacts** (2017, 2019) that suppress party shares for reasons no
demographic model can see.

### Honest limitations

- **Independents are not predictable.** Presence accuracy **0.479 at DEA** — worse
  than the majority-class baseline of 0.517, i.e. worse than guessing. Their vote
  is a personal/candidate effect, not an area property. Treat "Independent" as a
  residual, never as a modelled party.
- **Presence overall 0.817**, but below the majority-class baseline for DUP,
  Alliance and Aontú. It is genuinely informative only for SF, SDLP, TUV, Green and
  PBP — parties whose decision to stand is geographically structured.
- **End-to-end costs ~2 pts TVD** (20.77 → 22.70): presence errors compound.
- **Westminster 2024 ran on the 2023 boundaries.** "Belfast South and Mid Down" has
  no counterpart in `constituency_features.csv` (2008 boundaries) and is **dropped**
  rather than silently matched to the wrong geography — 107 rows, not 108.
- `eps=0.5` is a smoothing choice; sensitivity is exposed via `PARTY_EPS`.

---

# Phases 23–25: 2023 boundaries, Westminster seats, DZ allocation

## Phase 23 — 2023 Westminster boundaries fixed

`constituency_features.csv` is built on the 2008 boundaries, so the 2024 contest
(2023 review) previously lost "Belfast South and Mid Down" entirely. Rebuilt by
re-aggregating the DZ census features onto the 2023 constituencies: centroid
assignment, **3,780/3,780 DZs matched, 0 unmatched**, population-weighted by
`AllUsualResidents`. All 18 of the 2024 constituencies now have features
(constituency scale: 107 → **108** area-contests).

Phase 17 now selects the feature vintage per contest — 2023 boundaries for
Westminster ≥2024, 2008 for everything earlier and for the 2022 Assembly.

**A trap worth recording:** `D:/ConstituencyBoundariesUngeneralised_National_
Electoral_Boundaries_2023_*.geojson` is the **Republic's Dáil** boundaries (it
carries `GAELTACHT_AREA` and Irish-language name fields), not NI Westminster. The
correct source is the OSNI open-data file under `land-property-services-ordnance-
survey-of-northern-ireland/`.

## Phase 24 — Westminster (FPTP) seats: mechanically trivial, empirically hard

One seat per constituency, winner = highest share. No transfers, no quota, and the
nomination model is irrelevant. Leave-one-constituency-out:

| year | winner accuracy | seat error | margin MAE |
|---|--:|--:|--:|
| 2017 | 77.8% | 6 of 18 | 15.9 |
| 2019 | 72.2% | 6 of 18 | 12.1 |
| 2024 | 61.1% | 10 of 18 | 9.6 |
| **all** | **70.4%** | — | 12.5 |

**This is markedly worse than STV seat prediction** (Assembly 2022 end-to-end was
6 seats off out of 90), which inverts the naive expectation that FPTP is the easy
case. The reason is visible in the misses:

- **Foyle 2019 and 2024** — actual SDLP by 36.3 and 10.9 pts, predicted Sinn Féin.
  A personal/incumbency vote, invisible to census features.
- **Belfast South 2019** — actual SDLP by 32.5 pts, predicted Alliance. A
  **nationalist pact**: Sinn Féin stood aside.
- **North Down 2017 and 2024** — an Independent won; independents are unmodellable.
- **North Antrim 2024** — TUV by 1.1 pts.

Accuracy on **safe** seats (margin ≥15 pts) is only **77.4%**, barely better than
on marginals (53.8%). That is the diagnostic: under FPTP a seat is often "safe"
*because of a pact or a personal vote*, not because of demography, so the model
misses seats that look uncompetitive. Proportional STV maps demographic share to
seats far more directly.

**Implication:** Westminster seat projection needs a pact/stand-aside layer as an
explicit scenario input. Without one, 70% is close to the ceiling.

## Phase 25 (stage 5) — party shares for all 3,780 Data Zones

`areas_party/<contest><year>_DZ21.csv`, one row per DZ, one column per party,
population-weighted, raked so each DEA's weighted mean reproduces the observed DEA
result exactly.

| contest | DZ→DEA TVD (unraked) | DZ→DEA (raked) | DZ→NI max party err (raked) |
|---|--:|--:|--:|
| local 2014 | 20.73 | 0.00 | 1.47 |
| local 2019 | 20.98 | 0.00 | 1.42 |
| local 2023 | 18.54 | 0.00 | 1.64 |

The raked DEA column is 0.00 **by construction** — raking targets DEA, so it is a
consistency check, not evidence. The honest numbers are the **unraked** column
(the model's own DZ→DEA accuracy, ~19–21 TVD, in line with the DEA share model)
and the **NI** column (max party error 1.4–1.6 pts).

Cross-scale: the local-2023 DZ mosaic aggregated to the 18 constituencies sits
**9.72 median TVD** against the actual 2022 Assembly result — different contests,
so this measures geographic coherence rather than forecast accuracy.

NI shares recovered from the mosaic (local 2023): SF 29.3, DUP 23.9, Alliance 14.0,
UUP 11.0, SDLP 8.6.

**Standing caveat:** no party result exists below DEA and none ever will, because
NI counts centrally rather than by box. These DZ figures are an *allocation
consistent with observed totals*, not a measurement, and must be labelled as such
wherever they are displayed.
