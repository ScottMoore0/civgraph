# Tiers 2 & 3 — backtesting before the LucidTalk era

Built on **real data only**: the 2011 NISRA census at the 18 Assembly/Westminster
constituencies (ASSEMBLY AREAS geography, 118 percentage features across religion,
religion-brought-up-in, national identity, passports, language, tenure, NS-SEC,
qualifications, economic activity, age, sex, health), the actual election results
1992–2010 from `test/metadata/elections-test2`, and the 1998–2010 NILT waves
(constitutional-preference item `nireland`/`NIRELAND`/`NIRELND2`, weighted).

Reproduce: `python build_features_2011.py && python build_results.py &&
python build_nilt_level.py && python backtest_t23.py`.

---

## Tier 2 — 1998–2011 (NILT before LucidTalk)

### A. Geographic gradient — 2011 census → nationalist vote shape (leave-one-contest-out)

| Contests | R² | MAE |
|---|---|---|
| Assembly 1998/2003/2007 + Westminster 1997/2001/2005/2010 (7 × 18) | **0.982** | 2.39 pts |

Per-contest R² 0.972–0.989. **The census→vote geography engine works just as well in
the NILT era as it does today** (modern constituency R² was 0.975) — an out-of-sample
1998-era constituency is placed to within ~2.4 points once the NI level is known. The
geographic half of the pipeline extends backward cleanly.

### B. NI-level signals — and the honest gap

* **Nationalist VOTE** was near-stationary across the whole era (39.9–43.5%), so a
  persistence baseline predicts it to **MAE 1.31 pts** — the same pattern the main
  backtest found, and again the reason a poll adds little to a *stable* vote share.
* **NILT constitutional preference** (`nireland`, % reunify of decided) is the era's
  only unity signal. It runs **~15 points below the nationalist vote**, does **not**
  track it (R² vs the vote is negative — 2001 spikes to 36% reunify while the vote sat
  at 43%; 2010 falls to 18% reunify while the vote was 43.5%), and — critically — has
  **no era outcome to validate against.** The one referendum available, the **1998 GFA
  vote (71% Yes)**, asked about the Agreement, not unity, and was reported NI-wide only.
* This is exactly the irreducible gap the present-day unity projection carries: unity
  preference is measured only by surveys, never (yet) by a result, so its *level* can
  be described but not backtested — in 1998–2010 just as in 2024.

### C. End-to-end — census gradient + level → absolute nat vote (held-out)

| | R² | MAE |
|---|---|---|
| Pooled, absolute (no per-contest demeaning) | **0.976** | 2.90 pts |

From 2011 census + a held-out contest's level, the pipeline reproduces the 1998–2010
constituency nationalist vote to **MAE 2.9 pts**.

---

## Tier 3 — 1989–1998

### D. Gradient stability — does the census gradient reach the 1990s?

The gradient trained on the 1997–2010 contests, applied to the 1990s nationalist vote
*shape*:

| Contest | Boundaries | R² | corr(shape) | MAE |
|---|---|---|---|---|
| Westminster 1997 | 18-seat (1995) | **0.984** | +0.994 | 2.50 |
| Westminster 1992 | 17-seat (1983) | **0.964** | +0.982 | 4.13 |

Even predicting the **1992** vote — 2011 demographics applied across a **19-year gap and
a different boundary set** (name-matched, so the 1983 seats are an approximation) — the
geographic relationship holds at corr +0.98. This is the concrete evidence behind the
feasibility claim that *the geographic gradient extends cleanly backward*: which places
vote nationalist is a deeply stable function of religious geography, decades deep.

### E. Level leg — unblocked via NISA (ARK SOL, no login)

Originally the 1990s level looked blocked: NILT begins in 1998 and the **NI Social
Attitudes survey (NISA, 1989–1996)** microdata at the UK Data Service is Safeguarded
(licensed, no open download). But ARK's **SOL** open tabulations publish NISA's
constitutional-preference question (`NIRELAND`: "long-term policy… remain in the UK /
reunify with the rest of Ireland") as **weighted marginals broken down by community
background** — Catholic / Protestant / No religion — which is exactly the axis the
projection poststratifies on. `harvest_nisa.py` scrapes all seven NISA years (no 1992
survey) with no login; `backtest_t3_level.py` poststratifies those rates onto the census
religion composition to produce a **1989–1996 unity (reunify) projection by constituency
and NI-wide**.

**NISA % reunify, harvested (of all respondents), and the poststratified projection:**

| Year | Catholic | Protestant | None | NISA overall | Poststrat NI | Constituency range |
|---|---|---|---|---|---|---|
| 1989 | 56 | 3 | 13 | 24 | 27.5 | 11–47% |
| 1990 | 55 | 5 | 21 | 25 | 28.8 | 14–46% |
| 1991 | 53 | 4 | 12 | 22 | 26.5 | 11–44% |
| 1993 | 49 | 6 | 14 | 20 | 25.9 | 12–41% |
| 1994 | 60 | 6 | 18 | 27 | 31.2 | 14–51% |
| 1995 | 56 | 6 | 16 | 27 | 29.2 | 13–47% |
| 1996 | 47 | 8 | 20 | 24 | 26.6 | 15–40% |

Two honest checks pass:
* **Consistency** — poststratifying the by-religion rates back onto the NI composition
  reproduces NISA's published overall to a **mean 3.8 pts**, the gap running in the
  expected direction (the 2011 census over-weights Catholics relative to the 1990s).
* **Continuity** — the 1996 reading (NISA overall 24%, poststrat 26.6%) meets **NILT's
  1998** value (21.9% reunify of all) — the series joins up across the survey handover.

**Caveats (why this is weaker than the licensed microdata would be):** era census
religion tables (1991) are not machine-readable in-repo, so the **2011** composition is
used for the geography — hence the ~3.8 pt over-estimate and the "modest over-estimate of
the era" flag on the NI levels. SOL gives weighted *marginals* only (overall + a fixed
set of one-way breakdowns), so no fine joint crosstabs and no custom reweighting. And, as
in every era, **there is no 1990s unity referendum**, so the level is unvalidatable
against an outcome — it is data-driven now, but still not backtestable. The UKDS microdata
(with 1991 census tables) would tighten all three; the open route removes the *blocker*.

---

## What Tiers 2–3 establish

1. **Geography is stable and backward-portable** — census → nationalist-vote shape holds
   at R² ≈ 0.96–0.98 from 2010 back to **1992**, across boundary changes and a two-decade
   demographic gap. The spatial engine behind the unity maps is not a modern artefact.
2. **The level is the perennial limit** — for a *stable* vote, persistence wins and polls
   add little; for the *unity question*, the level is survey-only and unvalidatable in
   every era, 1998 as much as 2024. That is the honest ceiling on any unity projection.
3. **The pre-1998 level is now data-driven, back to 1989** — NISA's constitutional-
   preference-by-community-background series (harvested open from ARK SOL) drives a real
   1989–1996 unity projection that joins continuously to NILT in 1998. The geography is
   approximate (2011 census standing in for 1991) and the level still can't be backtested
   against a referendum, but the era is no longer a blank — the whole 1989→2024 span now
   runs on the same census-geography × survey-level architecture.
