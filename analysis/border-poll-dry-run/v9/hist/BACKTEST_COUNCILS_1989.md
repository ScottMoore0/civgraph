# Pre-NILT census-shape backtest — 1989 / 1993 / 1997 local elections (26 councils)

This is the **build** the feasibility note said was tractable: extend the census-shape backtest back
to **1989**, on the era-matched geography (the 26 legacy Local Government Districts) and era-matched
census (**1991**), avoiding the pre-1996 Westminster-boundary problem entirely by using councils.

`backtest_councils_1989.py`. **Catholic %** by district is extracted from the **1991 Census Religion
Report, Table 2** (Roman Catholic per-cent — e.g. Derry 69.5, Newry & Mourne 71.8, North Down 9.0).
**Nationalist vote share** = (SDLP + Sinn Féin first-preferences) / all first-preferences per council,
from the in-repo local-election results.

## Result — the shape skill holds all the way back to 1989

| contest | r(1991 Catholic %, nationalist vote %) | n |
|---|---|---|
| 1989 local | **+0.94** | 26 |
| 1993 local | **+0.95** | 26 |
| 1997 local | **+0.94** | 26 |
| **pooled** | **+0.94 (R² = 0.89)** | 78 |

- **Slope ≈ 0.99 nationalist-points per Catholic-point** — the nationalist vote tracks community
  background almost 1:1 across councils, three decades before the current model's 2014–2024 window.
- Within-year linear fit **MAE = 5.1 pts**. So the census predicts *where* the nationalist vote is,
  pre-NILT, about as well as it does today (the 2014–2024 constituency shape was R² ≈ 0.97 / MAE ≈ 2.8;
  councils are coarser and the 1991 OCR adds noise, hence the slightly larger error — but the skill is
  clearly intact).

## The residuals are interpretable (and mostly not model error)

- **Belfast** is consistently *more* nationalist than its 39% Catholic background predicts (resid
  +18→+22 across the three elections): the nationalist bloc consolidates behind SDLP/SF while the
  unionist vote fragments (Alliance, independents, multiple unionist parties), so nationalist *vote
  share* runs ahead of Catholic *population share* in the city.
- **Larne 1989** shows nationalist 0% — a **candidate-availability artifact** (no SDLP/SF candidate
  stood in a low-Catholic council), not a prediction failure. A production version would flag
  uncontested/under-contested councils rather than score them.

## What this does and doesn't establish

- **Does**: confirms the feasibility assessment empirically — the **census-shape half** of the
  pipeline is valid back to 1989 (R² ≈ 0.89 at council level), on 1991 census + 1990s results. The
  "elections back to 1989" extension is real, not hypothetical, for the shape skill.
- **Doesn't**: this is the shape half only. The **full pipeline** (level × shape) for that era would
  anchor the level on **NISA 1989–96** (harvested at `hist/nisa_reunify.*`) — that wiring is still not
  built. And this is *nationalist vote*, the axis the census predicts; it says nothing about
  cross-cutting contests.
- **Geography choice**: councils (26), deliberately, to dodge the 1983–1997 17-seat Westminster
  boundaries. A constituency version would additionally need 1991 census features rebuilt on those
  boundaries.

Output: `backtest_councils_1989.csv` (year, district, cath91, nat_pct, residual).
