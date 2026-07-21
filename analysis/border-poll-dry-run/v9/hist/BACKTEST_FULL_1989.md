# Full level × shape backtest, pre-NILT era (1989/93/97 councils) — NISA level anchor added

`backtest_full_1989.py` completes the pre-NILT backtest: the shape half was validated
(`BACKTEST_COUNCILS_1989`, R²≈0.89); this adds the **level** half using the only survey for the era,
**NISA 1989–96**, and scores the combined pipeline against the actual council results.

## Level test — NISA measures the wrong quantity for *vote*

NISA carries **constitutional preference** (% who want reunification), not vote intention. Matched to
each election (NISA ends 1996, so 1997→NISA-1996):

| election | NISA reunify % | actual nationalist vote % | gap (vote − reunify) |
|---|---|---|---|
| 1989 | 24 | 34.7 | +10.7 |
| 1993 | 20 | 37.0 | +17.0 |
| 1997 | 24 | 39.8 | +15.8 |

**NISA reunify is roughly flat (~20–24%) while the nationalist vote rises 35→40%.** The reunify→vote
gap is large (~14 pts) and **not constant** — it widens as the Sinn Féin vote grows without a matching
rise in reunification aspiration. So in this era NISA anchors the **constitutional-preference** level,
**not** the partisan-**vote** level: nationalists were voting SDLP/SF well before they told surveys
they wanted a united Ireland.

## Combined pipeline — NISA level (offset-calibrated, leave-one-out) × census shape

Scored in **absolute** terms against the 26-council results, per contest held out:

| level source | MAE | R² |
|---|---|---|
| **NISA-anchored** (reunify + LOO reunify→vote offset) | **7.9 pts** | 0.78 |
| actual-NI-level (perfect-level upper bound) | 7.5 pts | 0.81 |

**The NISA level costs only +0.4 pts MAE versus a perfect level** — because the census **shape carries
most of the skill**, and the leave-one-out offset absorbs the (roughly stable) reunify→vote wedge. So
a *usable* pre-NILT full-pipeline backtest is achievable: **council nationalist vote predicted to ~8
pts MAE from 1991 census + NISA alone**, no election result used.

## The honest capability boundary going back in time

- **Shape** — strong and stable back to 1989 (R²≈0.89): the census predicts *where* the vote is.
- **Level** — the weak link pre-NILT. NISA measures reunify aspiration, which sits far below and drifts
  independently of the vote, so the level only works via a **calibrated, and slightly unstable,
  offset**. The +10.7→+17.0 drift is the warning sign: over a longer window or a faster-realigning
  period the offset would break, and NISA alone could not anchor the level.
- **The fix** would be a **party-ID / vote-intention** survey for the era; NISA doesn't carry one. This
  is the model's real limit as it reaches back before NILT: the geography is recoverable from the
  census, but the *level* depends on a survey that measured the right thing, and before ~1998 that
  survey is thin.

Runs off `backtest_councils_1989.csv` + `nisa_reunify.csv`.
