# Border Poll projection — v8 (learned end-to-end model, no hand-set offsets)

v7 still contained hand-set numbers: a +0.76 correction and a vector of
unity-propensity weights I assigned. **v8 replaces all of that with a model whose
coefficients are fitted** — the demographic gradient, the time trend, the gap
between survey *measures*, and the gap between survey *sources* are every one a
learned parameter, not something computed by hand and added on. Per your ask:
*the model learns how a given input produces a given output.*

Model family (your choice): **MRP backbone + ML cross-check (ensemble).**

## Inputs (all four corpora)

| Corpus | Role | Source |
|---|---|---|
| **NILT microdata** | individual-level training rows (unity outcome + demographics) | `data/surveys/nilt/raw/` (23 waves 1998–2025, persisted) |
| **LucidTalk** | second unity source; its house effect is *learned* | R2 corpus (`v3/build_unity_rates_from_r2.py`) |
| **NISRA census** | poststratification frame (religion×age per Small Area) | `data/census/derived/joint-2011-age-religion-sa.csv` |
| **Elections / EU-ref** | out-of-sample validation of the demographic gradient | `test/metadata/elections-test2/`, v5 calibration |

## What is *learned* (replacing every fixed number in v1–v7)

Fit on **27,511 weighted NILT records** (`2_fit_model.py`):
`unity ~ community × age + sex + year + measure_source`

- **Demographic gradient** — the community/age/sex coefficients (was the assumed
  gradient in v5).
- **Measure house effect** — the direct border-poll question reads **+0.62 logit**
  higher unity than the long-run preference question: a *fitted* coefficient (v6/v7
  used no such term).
- **Time trend** — a fitted year coefficient (+0.006 logit/yr on the GLM), not
  assumed flat.
- **Source house effect** — a pooled NILT+LucidTalk model (`3_calibrate_and_project.py`)
  fits a LucidTalk-vs-NILT term; the level offset is ~0, i.e. **the two sources
  agree on the average unity level** (this is the honest, data-driven answer to
  v5's 0.76/0.24 blend and v7's +0.76 — there is no net level correction to make).
- **Unity propensity by party** — **gone entirely.** v8 models unity *directly*
  from demographics, so the hand-assigned party propensities (SF 0.97 … TUV 0.01)
  that produced v7's +0.76 are not needed at all.

## Poststratification (Stage C)

The fitted per-cell unity rates are poststratified onto the **exact committed 2011
Census Small-Area religion×age joint** (`joint-2011-age-religion-sa.csv`, 4,537
Small Areas) — a self-consistent MRP that reproduces the NILT topline on its own
population. Output: per-Small-Area unity + demographic breakdowns.

## Result — learned projection

| Date | GLM (MRP) | GBM (ML) | SA p10–med–p90 | maj-unity SAs |
|---|---:|---:|---|---:|
| 2021-01 | 44.7 | 45.4 | 19.9 – 36.4 – 74.0 | 37.2% |
| 2022-08 | 44.8 | 46.7 | 20.0 – 36.4 – 74.1 | 37.4% |
| 2024-02 | 44.9 | 49.9 | 20.2 – 36.6 – 74.3 | 37.5% |
| 2025-02 | 45.0 | 49.2 | 20.3 – 36.7 – 74.3 | 37.6% |

**The ensemble is informative precisely because the two learners disagree on the
recent trend.** The linear GLM holds a flat **~45%**; the flexible GBM picks up a
stronger recent rise to **~49–50%** by 2024–25. So the learned answer is a
**~45–50% band, still short of (or right at) 50%**, with the model-form choice —
not any hand-tuning — being what separates "stable mid-40s" from "approaching
50%". This is exactly the sensitivity a single fixed offset hides.

The GLM level (~45%) reconciles with the direct NILT/LucidTalk toplines (44–46%)
and with v5/v7; v8's contribution is that it gets there with **zero hand-set
constants** and surfaces the trend uncertainty honestly.

## Cross-source finding (reported, not averaged in)

NILT and LucidTalk agree on the *level* but differ in *community polarization*:
NILT Catholics are ~78% decided-unity, LucidTalk Catholics ~94%. Naively averaging
their community rates inflates the poststratified level to ~49–50%; v8 therefore
poststratifies the self-consistent NILT backbone and **reports** the LucidTalk
divergence rather than silently pooling it. Which source's community spread is
"right" is unresolved and is a genuine open question, not something to paper over
with an offset.

## Honest position

- **Target still never observed** — no unity referendum has been held, so the
  mapping is learned on party vote / EU-Remain / survey-stated unity and
  *transferred*. Learning end-to-end does not manufacture the missing datapoint.
- **2011 census frame** — poststratification uses the durable committed 2011
  Small-Area joint; the 2021 Data-Zone religion×age frame v4 used was
  scratchpad-only. 2021 composition (more Catholic) would nudge the level up; a
  next step is to persist the 2021 DZ frame and re-poststratify.
- **GLM vs GBM trend gap is real** — with only ~24 survey-years the recent slope
  is genuinely uncertain; the band reflects that, honestly.

## Files
`1_extract_nilt.py` (harmonise NILT → `nilt_individual.csv`), `2_fit_model.py`
(learned GLM+GBM → `model_fit.json`), `3_calibrate_and_project.py` (source model +
poststratify → `areas/`, `breakdowns/`, `summary.json`).

## Addendum — re-poststratified at Data Zone on the REAL 2021 census joint

**Correction to an earlier claim:** I first said NISRA's Cantabular portal "resisted
scripted download" and used a community-marginal approximation. That was wrong — the
**complete NISRA Cantabular flexible-table corpus was already scraped to R2** in earlier
work (`data.civgraph.net/data/census/nisra-ftb/`, harvested exhaustively to 5-way
crosstabs). The real 2021 Data-Zone **religion×age×sex joint** is
`PEOPLE__DZ21~AGE_BAND_5YR~RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO~UR_SEX.csv.gz`, now
persisted at `data/census/derived/dz21-religion-age-sex-2021.csv.gz` and used directly —
no raking, no marginal approximation (`4_poststratify_dz2021.py`).

Poststratifying the learned v8 model onto this real joint:

| Frame | 2021-01 | 2024-02 | 2025-02 | maj-unity |
|---|--:|--:|--:|--:|
| 2011 SA (religion×coarse-age) | 44.7 | 44.9 | 45.0 | ~37% |
| 2021 DZ (community marginal) | 43.9 | 44.1 | 44.2 | ~37% |
| **2021 DZ real joint (religion×age×sex)** | **40.1** | **40.4** | **40.5** | **~19%** |

**The full joint lands ~4 pts lower (~40–41%).** Properly weighting onto the true
voting-age 2021 population — which is older, and older cohorts are much less unity-leaning
— pulls the estimate below both the coarse frames and the raw survey toplines (44–46%).
This is a real MRP reweighting, and it makes the "does not cross 50%" conclusion *more*
robust, not less. The honest span across all frames is **~40–45%**.

Caveat on grouping: the census variable is "religion or religion brought up in", whose
"None" category is tiny (~1.6%), unlike NILT's larger community-background "Other/None".
Both a Catholic-vs-non-Catholic split (robust to this) and the 3-group mapping give ~40–41%
on the real joint, so the level is not an artefact of the grouping choice. A further
refinement is to harmonise NILT's community-background definition to the exact census
variable before poststratifying.

Files: `4_poststratify_dz2021.py`, `areas_dz2021_full/<date>_DZ21.csv`,
`summary_dz2021_full.json`, `summary_dz2021_2group.json`.
