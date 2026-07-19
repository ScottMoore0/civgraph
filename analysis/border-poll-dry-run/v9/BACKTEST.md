# Backtest — can NILT / LucidTalk / NISRA predict elections and the 2016 EU referendum?

`8_backtest.py` scores the whole pipeline against **known outcomes** — three local
elections, six Stormont/Westminster elections, and the 2016 EU referendum — at the
levels each is actually reported: DEA (local only), constituency (Assembly,
Westminster, EU-ref), and NI-wide. It deliberately pulls the pipeline apart into the
two distinct skills it has, tests each honestly (leave-one-contest-out, never
in-sample), then recombines them end-to-end.

Run: `python 8_backtest.py` → prints the tables below and writes `backtest_report.json`.

---

## The two skills, separated

A projection of an area result is `level × shape`:

* **Shape** — the *within-NI geographic pattern*: which places are more nationalist / more
  Remain than the NI average. This is what the **NISRA census** drives, through the
  88-feature ridge (community background, national identity, passports held, Irish
  language, tenure, NS-SEC, qualifications, economic activity, age, sex, health,
  country of birth).
* **Level** — the *NI-wide topline*: 39% vs 43%. The census is static and cannot move
  the level over time; only a **poll (LucidTalk / NILT)** carries that signal.

Testing them together would let a good shape hide a bad level (or vice-versa), so they
are scored apart first.

---

## A. Geographic gradient (census → shape), leave-one-contest-out

Ridge is trained with each contest's own mean removed, so it can only learn the
*pattern*, then predicted on a **held-out contest** it never saw.

| Level | Contests | R² | MAE |
|---|---|---|---|
| DEA (80) | local 2014 / 2019 / 2023 | **0.962** | 3.81 pts |
| Constituency (18) | Assembly 2016/17/22 + Westminster 2017/19/24 | **0.975** | 2.77 pts |

Per-contest R² never drops below 0.94. **The census predicts the geography of the
nationalist vote very accurately** — an out-of-sample area is placed to within ~3–4
points once the NI level is known. This is the strong, well-supported half of the
model.

## B. 2016 EU referendum (Remain)

Only one referendum exists, so leave-one-*contest*-out is impossible. Two honest reads:

* **Transfer from the nationalist gradient → R² = −1.14** (MAE 14.5). The *direction*
  agrees (corr = **+0.82** with the nationalist shape) but the magnitude is wrong:
  Remain won heavily unionist Belfast South/East, North Down and Strangford, so the
  nationalist gradient badly under-predicts Remain there. **Remain ≠ nationalism.**
* **Census leave-one-AREA-out CV → R² = 0.837** (MAE 3.57). Trained on a Remain-specific
  gradient and predicted on held-out constituencies, the census *does* recover the
  Remain map — just with its own coefficients, not the nationalist ones. (In-sample R²
  is not reported: with 88 features and 18 areas it is vacuous.)

## C. NI-wide level (poll → topline)

| Contest | LucidTalk nat-bloc | Actual | Error |
|---|---|---|---|
| Assembly 2017 | 37.5 | 40.3 | −2.83 |
| Assembly 2022 | 38.0 | 40.4 | −2.38 |
| Westminster 2024 | 38.0 | 39.3 | −1.33 |
| EU-ref 2016 (Remain) | 57.8 | 55.8 | +2.04 |

Poll level **MAE = 2.14 pts**, mean signed **−1.12** — a consistent house effect that
*understates nationalists* on first-preference vote share.

**A genuine, uncomfortable finding:** a persistence baseline (guess the level from the
mean of the other contests) scores **MAE 1.53 — better than the poll.** The nationalist
first-preference vote has been near-**stationary** (37.0–41.2% across a decade), so
"assume it barely moved" beats a house-biased poll.

This is real, and it matters for how the unity project reads it: **it does not transfer
to the border-poll question.** Unity preference is *non-stationary* and has *no past
referendum to persist from*. There the poll is the **only** level signal available —
persistence is not an option — which is exactly why the unity projection leans on
LucidTalk/NILT for the level and treats the ~±2 pt house effect as the irreducible
uncertainty on it.

## D. End-to-end (poll level + census shape → absolute area result)

The real input→output test: take the **poll-implied NI level** (not the actual), add the
**census gradient** trained on the *other* contests, predict every constituency in
absolute terms (no per-contest demeaning "cheat").

| Contest | Poll level | Area R² | MAE |
|---|---|---|---|
| Assembly 2017 | 37.5 | 0.972 | 3.59 |
| Assembly 2022 | 38.0 | 0.973 | 3.41 |
| Westminster 2024 | 38.0 | 0.977 | 3.21 |
| **Pooled** | — | **0.974** | **3.40** |

Feeding only NILT/LucidTalk/NISRA — no knowledge of the actual result — the pipeline
reproduces the constituency-level nationalist vote to **MAE 3.4 pts**. The residual is
dominated by the poll's level error (C), not the geography (A).

---

## Bottom line

* **Geography is a solved problem** here: census → area shape, R² ≈ 0.96–0.98 out of
  sample, at both DEA and constituency level, and it recovers the 2016 Remain map too.
* **Level is poll-limited**: ~2 pt house effect on the topline, and for stable vote
  shares a persistence baseline is competitive. For a *moving, never-before-held* border
  poll the poll input is indispensable and its house effect is the headline caveat.
* **End-to-end**, from raw inputs to a held-out contest, the pipeline lands within ~3.4
  points per constituency — which is the honest accuracy bound to attach to the unity
  projection's geography.

What the backtest **cannot** vouch for is *differential swing over time* — the fact that
a place can move 15–20 pts more than the NI average between two dates for idiosyncratic
local reasons (candidates, turnout, STV transfers). That component has cross-validated
R² below zero and is the reason the unity maps' between-date changes are modest: the
model only propagates the part of change the polls *measure* (subgroup movements), never
inventing local swings it has no basis to predict.
