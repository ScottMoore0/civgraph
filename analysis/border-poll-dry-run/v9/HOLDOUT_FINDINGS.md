# Phase 44 — the holdout

I predicted the headline (1.97 seats/area) would prove "meaningfully worse" under a
proper holdout. **That prediction was wrong.**

## Two leaks fixed

1. **The transfer matrix was leaking.** `18_` estimates it from all six contests and
   `19_`/`38_` then use it to project every one of them — including the contest whose
   own transfer behaviour is inside the matrix. That leak was present in *every* seat
   number reported in this workstream. Here it is re-estimated per fold.
2. **Forward-in-time.** Leave-one-contest-out lets a 2014 prediction learn from 2023.
   The forward test trains only on strictly earlier contests — an actual forecast's
   situation.

## Results

| test | seat error |
|---|--:|
| reported headline (matrix trained on all contests) | 1.97 |
| **A — leave-one-contest-out, matrix also held out** | **1.99** |
| **B — forward-only (earlier contests only)** | **1.87** |

Per contest:

| contest | A (matrix held out) | B (forward only) | matrix events available to B |
|---|--:|--:|--:|
| local 2014 | 2.33 | — | 0 (skipped) |
| assembly 2016 | 1.56 | 1.22 | 513 |
| assembly 2017 | 0.78 | 0.89 | 648 |
| local 2019 | 1.88 | 1.95 | 736 |
| assembly 2022 | 2.00 | 1.89 | 1,168 |
| local 2023 | 2.15 | 2.15 | 1,278 |

## Reading it correctly

**The transfer-matrix leak was worth 0.02** (1.97 → 1.99). Negligible. The matrix
generalises across contests, which is what you would expect of party-to-party
transfer behaviour — it is a stable feature of the electorate, not of a particular
election.

**B looks better than A, but that is composition, not a real gain.** B cannot score
local 2014 (no prior contests), and local 2014 is the hardest contest at 2.33. On the
five contests both can score, **A and B are identical at 1.87**. So training
forward-in-time costs *nothing measurable* — even with a transfer matrix built from
as few as 513 events.

## What this does and does not establish

**Establishes:** the model's *parameters* are not overfitted to the evaluation set.
Removing the leak and restricting to forward-only training leaves performance
essentially unchanged. That is a genuine robustness result and it was not guaranteed.

**Does not establish:** that the *architecture* is unoverfitted. Which features,
`alpha=50`, field features on, the per-type policy, `eps=0.5`, the blend design —
all were chosen while looking at these six contests across ~43 phases. No
retrospective procedure can un-know that, so 1.87–1.99 remains an upper bound on true
out-of-sample performance. The only clean test is the next real election.

**Honest correction:** I expected this to expose substantial optimism and told you so.
It did not. The parameter-level robustness is better than I predicted, and the
remaining uncertainty is concentrated in architecture selection, which this test
cannot reach.
