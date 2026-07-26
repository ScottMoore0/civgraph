# Phase 43 — candidate-level first preferences and transfer splitting

Two remaining engine assumptions, both crude, both now measured rather than assumed.

## (2) Transfer splitting — the assumption was roughly right

When party P's votes transfer to party Q, the engine splits them across Q's
continuing candidates in proportion to current votes. Fitting the concentration
exponent in `share_i ∝ votes_i^alpha` against **2,341 observed within-party splits**:

| alpha | mean abs split error |
|---|--:|
| 1.00 (proportional, the current assumption) | 0.2972 |
| **0.75 (fitted)** | **0.2941** |

Transfers spread slightly *more evenly* than vote share implies, but the gain is 1%
and **the end-to-end seat effect is nil** (1.99 → 1.99). The proportional assumption
was close enough that correcting it changes nothing.

## (1) Candidate-level vote splitting — small but consistent

Replacing the even split with each candidate's own prior first-preference share
(discounted 25% if they were not elected last time), from `personId` history:

| variant | seat error | exact | candidate accuracy |
|---|--:|--:|--:|
| even split, proportional transfers | 1.99 | 25.5% | 72.0% |
| **+ candidate-level vote splitting** | **1.97** | **25.9%** | **73.3%** |
| + fitted transfer alpha only | 1.99 | 25.5% | 72.0% |
| + both | 1.97 | 25.9% | 73.3% |

Improves on all three metrics. The most meaningful is **candidate accuracy 72.0 →
73.3%** — about 22 more individual winners correctly identified across 1,674 seats.
That is the metric vote splitting should move, since it changes *which* candidate of
a party wins rather than how many.

## The honest accounting

The vote-management term was measured at **+0.35 seats/area** (stage B minus stage A
in the phase-20 decomposition). This recovers **0.02** of it.

Why so little: the +0.35 was the gap between *true* first preferences and *true party
shares split evenly*. Closing it needs the candidates' relative strengths known
accurately; predicted weights are themselves noisy, and the noise eats most of the
available gain. The term is real but is not substantially recoverable from prior
personal vote alone.

This is a diminishing-returns result and is reported as such: two mechanisms
implemented, one worth 0.02 seats/area and one worth nothing.
