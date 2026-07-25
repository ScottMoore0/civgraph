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
