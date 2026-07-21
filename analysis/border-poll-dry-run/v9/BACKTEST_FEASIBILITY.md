# Feasibility: backtesting the current model against elections + the three referendums

## 0. LucidTalk is found

The LucidTalk corpus is on R2 at **`data.civgraph.net/data/polling/lucidtalk/cleaned/`** —
**36 polls, 2012→2026** (manifest + a combined `lucidtalk-all.csv.gz`), tidy-melted crosstabs. The
border-poll question is broken down by **religion, age, gender, social grade, region
(Belfast/East/North/West/South), past vote (incl. 2016 EU Leave/Remain), and constitutional bloc**.
`analysis/border-poll-dry-run/v3/build_unity_rates_from_r2.py` already extracts the by-community
border-poll rates; it currently reads 6 dates and can be pointed at all 36. So the "set the level"
step can now be replaced by **raking each map to a chosen LucidTalk poll's religion×age margins** —
and every backtest below can use LucidTalk as the period level/attitude anchor from 2012 on.

## 1. What "reflects current capability" requires

The model is `estimate = level × shape`:
- **shape** — the within-NI gradient, from the **census MRP frame** (now the raked 2021 DZ frame;
  earlier the 88-feature ridge). Already validated: nationalist-gradient R² **0.96–0.98** at DEA and
  constituency, leave-one-contest-out.
- **level** — the NI topline, from a **contemporaneous poll** (NISA / NILT / LucidTalk), now
  time-anchored (per-poll joint level+area) and LucidTalk-rakeable.

A faithful current-capability backtest must (a) run *this* pipeline (new DZ frame + LucidTalk
anchoring + time-matched survey), not the old ridge-only one; (b) match each contest to its **census
vintage** (1991/2001/2011/2021) and its **nearest survey**; (c) score **results and turnout
separately**, each at its native geography; and (d) flag each target's **domain of validity**.

## 2. The decisive distinction — two skills, two validity domains

| capability | driver | backtests well when… |
|---|---|---|
| **Turnout** | age / deprivation / composition (census) | **always** — turnout is demographically structured everywhere |
| **Vote choice** | religion × age × identity (ethnonational axes) | the contest **splits on those axes** (elections, unity) |

The referendums differ on the second row. A genuinely **cross-cutting** vote — the **GFA *Yes*** (won
a Protestant majority *and* nearly all Catholics) — does **not** split on religion×age, so the model's
vote-choice axes are near-orthogonal to it; a fair backtest there will (correctly) show **low
vote-choice skill — the model's boundary, not a bug.** **Correction (established by the
`REFERENDUM_CORR_FINDINGS` analysis):** the **2011 AV Yes is *not* cross-cutting** — its constituency
pattern loads on the ethnonational axis about as hard as unity does (Irish-identity r≈0.89, Catholic
r≈0.83, UK-passport r≈−0.83), plus a class axis. So the census **shape** predicts the AV vote well;
AV's backtest limit is purely the **absence of contemporaneous AV attitude polling** (the *level*
input), not the vote being unstructured. EU *Remain* is intermediate — strongly ethnonational
(r≈0.83) but with a soft-unionist Remain residual the axis misses. Turnout is testable on all of them.

## 3. Target-by-target feasibility

| target | truth in repo | result-choice backtest | turnout backtest | survey/level anchor | verdict |
|---|---|---|---|---|---|
| **Elections** (const. + DEA, result+turnout) | ✅ complete 1998–2024 | **HIGH** (nationalist gradient R²~0.97; party-splits harder) | **HIGH** | NILT 1998+, LucidTalk 2012+ (2017 has a constituency seat poll), NISA 1989–96 | **Strong** — the core backtest; refresh onto the new frame + add turnout scoring |
| **2016 EU ref** (result+turnout, const.) | ✅ `eu-referendum-2016.json` | **MODERATE** — the known stress case: Remain cross-cuts the ethnonational axis, so shape R² drops | HIGH | NILT 2016; **LucidTalk 2016-06/09** carry EU-vote×religion×age | **Feasible & informative** — quantifies *where* the model breaks |
| **2011 AV ref** (result const., turnout counting-area) | ✅ `av-referendum-2011.json`, `av-turnout-2011` | **SHAPE: HIGH** — AV Yes *is* ethnonationally structured (Irish r≈0.89, Catholic r≈0.83); **LEVEL: infeasible** — no NI survey measured AV vote-intention | **HIGH** (turnout tracked the same-day Assembly election → nationalist-high) | none for the *level*; census for shape+turnout | **Census-shape backtest passes; full-pipeline blocked only by missing AV polling, not by the vote being unstructured** |
| **1998 GFA ref** (turnout const., NI-wide Yes/No) | ✅ `belfast-agreement-1998` overlay | NI-wide Yes = **level check only** (Yes was cross-community, ~71% incl. most Catholics + a Protestant majority — not a religion split, so *constituency* Yes-share is out-of-domain) | **HIGH** (turnout by constituency) | **NILT 1998** (autumn '98, just post-vote) carries Agreement attitudes; NISA ended 1996 | **Feasible**: NI-wide Yes as a level calibration + turnout by constituency; skip constituency Yes-share |

## 4. Era coverage (the NISA/NILT/LucidTalk point)

- **NISA 1989–96** → no referendum in-window, but backtests the **1992/1997 Westminster & 1989/1993
  local & 1994 EU elections** (level/attitude), paired with the **1991 census** for shape. This is
  how the election backtest extends to 1989.
- **NILT 1998–present** → the GFA (1998), and every election/attitude since; the unity question
  itself from 2020 (REFUNIFY) with constitutional preference back to 1998.
- **LucidTalk 2012–2026** → the level anchor for 2012 on, incl. the 2016 EU crosstabs.
- **Census vintages** 1991 / 2001 / 2011 / 2021 provide the period-matched poststratification frame.

## 5. Recommended backtest design (feasible now)

1. **One harness, contest-parameterised**: for each contest pick {census vintage, nearest survey,
   target geography, truth file}; run shape (frame) × level (survey/LucidTalk-raked); score.
2. **Score result and turnout separately**, at native geography (DEA / constituency / counting-area /
   NI-wide), leave-one-contest-out for the shape model.
3. **Emit a skill matrix** distinguishing the two half-tests — **census-shape** (backtestable
   wherever a result exists, incl. AV) versus **full pipeline** (needs a contemporaneous survey for
   the level) — with a domain-of-validity flag so a low GFA-*choice* score reads as *boundary*.
4. **Turnout model** on the census age/deprivation composition — the common denominator across all
   four targets and the one that makes AV (counting-area) and GFA (constituency) tractable.

## 6. Bottom line

- **Feasible and worth doing** for: all elections (rich, 1989–2024), 2016 EU (result+turnout), 2011
  AV **turnout + census-shape-of-Yes**, 1998 GFA **turnout + NI-wide Yes**. Truth data is already
  in-repo; survey anchors exist for every era.
- **Genuinely out-of-domain** (report, don't force): only the **1998 GFA constituency Yes-share** —
  a truly cross-community vote the ethnonational model cannot and should not predict. **2011 AV vote
  choice is NOT in this category** (its shape *is* ethnonational, r≈0.83–0.89); it is only *level*-
  blocked by the absence of AV-era attitude polling, which is a data gap, not a domain boundary.
  Surfacing these distinctions honestly *is* part of stating the model's current capability.
- **Effort**: refreshing the existing `8_backtest.py` onto the new DZ frame + LucidTalk anchoring is
  moderate; adding AV/GFA turnout + GFA NI-wide Yes is small (truth present). The genuinely hard part
  is not code — it is resisting the temptation to score cross-cutting referendums as if they were
  ethnonational contests.
