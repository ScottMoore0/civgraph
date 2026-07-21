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

## 2011 AV referendum — done properly with the real geography

Using the supplied count-centre→constituency mapping, turnout is taken at **constituency level (n=18,
real per-constituency figures)** and Yes/No at **counting-area level (n=8)** with each count centre's
census composition aggregated from its constituent constituencies, electorate-weighted. (The two
official tables contradict on turnout because the counting-area "turnout %" used mismatched
denominators; the constituency turnout is the correct one.)

**Turnout (n=18) — higher in the *nationalist* areas, the OPPOSITE sign to EU-2016:**

| census feature | r with turnout |
|---|---|
| No religion | **−0.81** |
| UK-only passport | **−0.79** |
| Catholic background | **+0.74** |
| Irish identity | +0.67 |

Highest turnout: **Fermanagh & S. Tyrone 69.8, Mid Ulster 65.6, West Tyrone 64.2**; lowest: North Down
45.9, East Antrim 47.8, South Antrim 48.6. The reason is decisive and not about AV at all: **AV polling
day (5 May 2011) was the same day as the NI Assembly election**, so turnout tracked Assembly-election
mobilisation — structurally higher in the competitive nationalist west. This is the mirror image of the
2016 EU-ref turnout (deprivation/education-driven, nationalist-*low*) and a clean illustration that
"turnout" means different things depending on what else is on the ballot.

**Yes vote (n=8, real aggregated composition) — ethnonational AND class:**

| census feature | r with Yes % |
|---|---|
| Irish identity | **+0.89** |
| Higher NS-SeC (ABC1) | **+0.83** |
| Catholic background | **+0.83** |
| UK-only passport | **−0.83** |
| Owner-occupation | −0.76 |

Belfast (South+West, 62% Catholic) highest Yes at **59.7%**; Newtownards (East Belfast+North Down+
Strangford, 15% Catholic) lowest at **30.6%**. With the real composition Belfast is **not** an "urban
outlier" (my earlier approximate note) — its high Yes fits the Catholic/Irish axis exactly. So AV Yes
loaded on **two** axes at once: the ethnonational cleavage (Irish/Catholic → Yes, unionist → No) *and*
a class/urban one (professional ABC1 and renters → Yes, owner-occupier suburbs → No) — the
nationalist-plus-liberal-professional reform vote against the unionist-suburban status quo. Data:
`avref2011_census_corr.csv` (Yes, n=8), `avref2011_turnout_census.csv` (turnout, n=18).

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
