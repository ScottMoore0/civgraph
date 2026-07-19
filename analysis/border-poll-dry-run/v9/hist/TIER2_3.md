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

### E. Level leg — blocked, not faked

The 1990s unity/vote **level cannot be reconstructed from data in the repository.** NILT
begins in 1998; its predecessor **NI Social Attitudes (1989–1996)** — the only source
that could carry a constitutional-preference level through the early-mid 1990s — is not
held here. Building Tier 3's level leg requires sourcing NISA microdata from the UK Data
Service and bridging its wording to NILT on the (non-overlapping) series, exactly the
caveat-heavy step flagged in `HISTORICAL_EXTENSION.md`. Rather than fabricate it, the
level leg is left explicitly blocked; the gradient-stability result (D) is what present
data can honestly support for this era.

---

## What Tiers 2–3 establish

1. **Geography is stable and backward-portable** — census → nationalist-vote shape holds
   at R² ≈ 0.96–0.98 from 2010 back to **1992**, across boundary changes and a two-decade
   demographic gap. The spatial engine behind the unity maps is not a modern artefact.
2. **The level is the perennial limit** — for a *stable* vote, persistence wins and polls
   add little; for the *unity question*, the level is survey-only and unvalidatable in
   every era, 1998 as much as 2024. That is the honest ceiling on any unity projection,
   and pushing it earlier than 1998 needs NISA data this repo doesn't yet hold.
