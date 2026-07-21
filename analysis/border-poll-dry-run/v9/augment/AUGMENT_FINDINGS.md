# Do more data help? Tier-1 and Tier-2 additions tested

Tested the additions proposed earlier — **deprivation** (NIMDM 2017), **contest structure**
(turnout, candidate counts, pact flags), and a **Tier-2 survey signal** (NILT 2016 Brexit-vote
recall poststratified by community background) — against the 88-feature census baseline, on the
EU referendum and the elections. All figures are out-of-sample (leave-one-area-out for the
single EU-ref contest, leave-one-contest-out for elections).

**Headline: none of them improved the model, and two actively hurt. The 88-feature census is
already at the demographic ceiling for these targets.**

Reproduce: `build_deprivation.py`, `build_structure.py`, `build_nilt_brexvote.py`, then `ablation.py`.

---

## EU referendum 2016 (constituency)

| Feature set | R² | MAE |
|---|---|---|
| census 88 (baseline) | **0.837** | 3.57 |
| + deprivation (NIMDM: MDM/income/employment rank) | 0.831 | 3.63 |
| + deprivation + turnout | 0.830 | 3.65 |
| + deprivation + turnout + NILT brexvote | 0.836 | 3.56 |
| NILT brexvote poststratified — *standalone* | **0.029** | 9.56 |

## Elections

| Feature set | Con (Assembly+Westminster) R²/MAE | DEA local R²/MAE |
|---|---|---|
| census 88 (baseline) | 0.975 / 2.77 | 0.962 / 3.81 |
| + deprivation | 0.975 / 2.77 | — |
| + deprivation + structure | 0.969 / 2.94 | — |
| + structure (turnout+cands) | — | 0.964 / 3.87 |

Per-contest with structure added, Westminster **2019 MAE rose 4.04 → 4.52** and **2024 rose
3.07 → 3.99** — the additions made the pact elections *worse*.

---

## Why each addition failed — and it's informative, not a bug

### 1. Deprivation is redundant with the census, not orthogonal to it
The earlier hypothesis was that NIMDM adds a "left-behind" axis the census misses. It doesn't.
Diagnostic on a lean base:

| | R² |
|---|---|
| religion only | 0.659 |
| religion + deprivation | 0.563 |
| religion + census class/education/economic | **0.785** |
| religion + census class + deprivation | 0.777 |

The census *class* block adds +0.13 R² over religion; deprivation on top of it adds **nothing**
(and slightly hurts). The reason is direct collinearity — NIMDM's income/employment domains are
built from the same underlying reality as the census: **corr(NIMDM income rank, census
"no qualifications") = −0.72**, **corr(income rank, "higher managerial/professional") = +0.78**.
The census already *contains* the deprivation signal via NS-SEC, qualifications and economic
activity. Adding NIMDM re-states it with noise.

### 2. NILT Brexit-vote recall hits the same cross-cutting wall — harder
NILT 2016 gives Remain-by-community-background (Catholic 88%, Protestant 43%, None 66%).
Poststratified onto census religion it scores **R² 0.03 / MAE 9.6** — far worse than the census
model — because *religion-only* poststratification hands every heavily-Protestant seat the flat
43% Protestant rate, so it predicts North Down and Belfast South at ~45% when they actually
voted 52% and 69% Remain. The affluent-unionist-Remain split is exactly what a 3-category
survey breakdown erases. The census (with NS-SEC/qualifications) captures it; the survey
crosstab cannot. This confirms the cross-cutting ceiling *from the survey side*.

### 3. Contest structure doesn't transfer across contest types — and can't be known anyway
Turnout, candidate counts and pact flags made the constituency elections *worse* (0.975 → 0.969)
because leave-one-contest-out learns the structure→vote mapping from other contests, and the
tactical dynamics of **Assembly STV multi-member** contests don't transfer to **Westminster FPTP
single-member** ones. And for a genuinely held-out election the model can't know that contest's
specific pact situation in advance — which is the whole point of a forecast. Structure is only
usable *within* a modelled contest, not transferred into one.

---

## What this means

* **The 88-feature census is already saturating the area-level demographic signal.** The EU-ref
  residual (R² 0.84) is **not** recoverable from more demographic or deprivation data — it is
  genuine local idiosyncrasy plus the class × community cross-cut, which only *finer-grained
  targets* (sub-constituency referendum results — which don't exist) or *contest-specific campaign
  data* (which doesn't transfer) could reach.
* **For the unity projection specifically, there is little to gain from more area demographic
  data.** The levers that remain are either unavailable for a referendum (candidates, pacts,
  lagged results) or non-transferable to a first-ever vote. The ~2–3 pt constituency accuracy and
  the EU-ref's R² 0.84 reflect real limits, not missing features.
* **Negative results worth keeping:** they tell us where *not* to spend effort. The one thing that
  would move the EU-ref — sub-constituency Remain results to fit the class×community joint at finer
  resolution — is precisely the thing NI elections and referendums never report.
