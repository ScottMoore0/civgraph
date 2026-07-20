# How NISRA census composition relates to referendum turnout & Yes/No (descriptive)

Not a backtest — just correlations, for context. The three referendums differ enormously in data
depth, so the confidence differs too.

## 2016 EU referendum — n=18 constituencies, real census join (the rigorous one)

**Remain vote — loads strongly on the constitutional/ethnonational axis:**

| census feature | r with Remain % |
|---|---|
| Irish-only national identity | **+0.87** |
| UK-only passport | **−0.84** |
| Catholic background | **+0.83** |
| No religion | −0.58 |
| Aged 65+ | −0.58 |
| Higher NS-SeC (ABC1) | +0.42 |

**Turnout — loads on a *different*, socioeconomic axis:**

| census feature | r with turnout % |
|---|---|
| Social renting (deprivation) | **−0.76** |
| No qualifications | **−0.68** |
| Degree-level | **+0.64** |
| Owner-occupation | +0.55 |
| Aged 65+ | +0.44 |
| Catholic background | −0.61 |

**And the two axes pull in opposite directions: corr(Remain, turnout) = −0.49.** The most-Remain
seats (Foyle 78, Belfast West 74 — Catholic/nationalist) had the **lowest** turnout (49–57%), while
the highest-turnout seats (North Down, Belfast South, Fermanagh & S. Tyrone, 66–68%) were the
affluent/educated middle.

**What this says about the model.** The census predicts the *Remain level* by area well (religion/
identity r≈0.83–0.87) — the EU vote *did* run along the constitutional cleavage. What makes it the
model's hardest target is two residuals the religion axis can't see: (1) **turnout** is socioeconomic,
not ethnonational, and it's *anti-correlated* with Remain, so it re-weights the actual vote count away
from the high-Remain areas; and (2) the **soft-unionist Remain** — Belfast South 69% Remain at 45%
Catholic, North Down 52% at 13% Catholic — a liberal-unionist Remain that cross-cuts religion. The
census gets the broad split but misses that cross-cutting middle. Data: `euref2016_census_corr.csv`.

## 2011 AV referendum — n=8 counting areas, composition approximate (indicative only)

The AV vote is only reported for 8 count centres, and there is no clean census join to them, so the
Catholic% below is an **indicative estimate per count-centre** — directional, not inferential.

| count area | turnout | Yes | ~Catholic |
|---|---|---|---|
| Omagh | 67.1 | 46.7 | ~60 |
| Ballymena | 60.1 | 42.0 | ~24 |
| Banbridge 1 | 60.4 | 45.8 | ~42 |
| Belfast | 55.3 | **59.7** | ~42 |
| Londonderry | 55.3 | 50.0 | ~55 |
| Banbridge 2 | 53.7 | 40.4 | ~44 |
| Newtownabbey | 50.3 | 39.4 | ~22 |
| Newtownards | 48.7 | **30.6** | ~14 |

- corr(Yes, ~Catholic) **+0.65**, corr(turnout, ~Catholic) **+0.65**, corr(turnout, Yes) +0.41.
- Read cautiously (n=8): AV Yes had a **mild nationalist/urban tilt** — highest in Belfast (urban) and
  the Catholic west, lowest in the unionist-suburban east (Newtownards 31%) — and turnout was higher in
  the nationalist west (Omagh 67%). But AV was low-salience and *not* a religion-structured question,
  so even this weak tilt is mostly the urban/left character of Yes, not community background per se.
  Data: `avref2011_areas.csv`.

## 1998 GFA referendum — NI-wide only

NI-wide **Yes 71.1%, turnout 81.1%** (electorate 1.18m). There is **no constituency Yes/No breakdown**
in the data — it was declared NI-wide — so no sub-NI correlation of the vote is possible. And it would
be near-null even if it existed: the Yes was **cross-community** (~96% of Catholics *and* a majority
~55% of Protestants voted Yes), so it did not split on the religion axis the census measures. Turnout
by constituency *would* correlate (on the same socioeconomic axis as EU-2016 turnout), but 1998
constituency turnout is not in the repo.

## The one general lesson

Across all three, **turnout and vote-choice load on different census axes.** Vote-choice correlates
with the census only when the contest runs on the ethnonational cleavage (EU-Remain: strongly; AV:
weakly; GFA-Yes: not at all — cross-community). **Turnout is always socioeconomic** — deprivation/
education/age/tenure — regardless of the contest. That's why turnout is universally modellable from the
census while vote-choice is only modellable for constitutionally-structured votes.

Outputs: `euref2016_census_corr.csv`, `avref2011_areas.csv`.
