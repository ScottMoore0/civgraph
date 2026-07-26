# Phase 37 — contest-type awareness (and why 2010/2015 "hurt")

## The question

Westminster 2010 and 2015 are perfectly good Westminster elections. Why did adding
them cost anything on Assembly seats?

## The answer: nothing is wrong with the data

The constituency model pools **all** contests into ONE ridge and treats contest type
purely as a *level* to be removed. But the census → vote **relationship** differs by
type, not merely its level:

- **Westminster is FPTP** — tactical voting, pacts, small parties squeezed
- **Assembly is STV** — sincere first preferences, small parties viable

Alliance and the Greens convert the same demography into votes differently under the
two systems. Pooling forces one mapping to serve both, so adding Westminster rows
drags the shared mapping toward FPTP behaviour — and Assembly predictions pay for it.

## But the fix is not simply "separate models"

| constituency variant | overall | assembly | westminster |
|---|--:|--:|--:|
| pooled ridge (current) | **12.62** | 11.42 | **14.12** |
| pooled + blend on westminster | 12.94 | 11.42 | 14.23 |
| typed ridge (per contest type) | 12.94 | 11.50 | 16.34 |
| typed + blend on westminster | 12.89 | 11.50 | 14.95 |
| **typed + blend on both types** | 13.05 | **10.13** | 14.95 |

**Typing HURTS Westminster** (14.12 → 16.34). Westminster alone is 5 contests × 18 =
90 rows; losing the Assembly rows costs more than the type mismatch does. Westminster
*needs* the pooled data even though the pooling is theoretically wrong.

**Typing plus blending on both types HELPS Assembly substantially** (11.42 → **10.13**).

So the correct treatment is **asymmetric**, which no single switch expresses: Assembly
wants type-separation plus persistence; Westminster wants the pooled sample.

## Winner accuracy tells a different story from share accuracy

For FPTP the seat is what matters, and there the ranking inverts:

| variant | 2010 | 2015 | 2017 | 2019 | 2024 | mean |
|---|--:|--:|--:|--:|--:|--:|
| pooled, no blend | 67% | 72% | **94%** | 83% | 56% | 74.4% |
| pooled + blend | 72% | 72% | 89% | 83% | 78% | 78.8% |
| **typed + blend** | **78%** | 72% | 89% | 83% | 78% | **80.0%** |

`typed + blend` wins on winners (80.0%) while *losing* on share TVD (14.95 vs 14.12).
A reminder that under FPTP, share accuracy and seat accuracy are different objectives
— being closer on average across eleven parties does not mean calling more seats.

## Seats

Under `typed + per-type blend` (DEA pooled+blend, constituency typed+blend):

**mean party-seat error 2.01, exact 24.5%** over 294 areas / 1,674 seats — the best
figure recorded, against 2.06 in phase 36. Assembly 2017 improves to 1.11 and
Assembly 2022 holds at 1.00.

## DEA

Typing is a no-op there, exactly as expected — local 2014/2019/2023 are one contest
type. Blend 14.56 → 13.97 either way.

## What this settles

- 2010/2015 are good data; the pooling assumption was the problem.
- The blend genuinely should be per contest type — item (1) confirmed.
- But type-separation must be applied per type too, because the small-sample cost
  falls unevenly. Westminster cannot afford to lose the Assembly rows.
- Optimising share TVD and optimising seats are not the same objective under FPTP.
