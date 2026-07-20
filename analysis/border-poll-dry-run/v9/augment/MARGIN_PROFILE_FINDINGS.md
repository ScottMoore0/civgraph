# The pivotal margin — full attribute profile + where it lives

Who are the ~5%+1 soft pro-UK voters who turn a 45% unity vote into 50%+1, across every attribute
set we hold, and which Data Zones are they most concentrated in? `margin_profile.py` answers both.

**Provenance & the big caveat.** The margin is defined in NILT-2019 (the only wave with the full
hardness battery); it is **n≈55 unweighted respondents**, so the *broad* strokes below are robust but
the *fine* sub-breakdowns (e.g. the income barbell) are noisy. NILT carries no geography, so the
Data-Zone map is a **poststratification**, not a direct count.

## Part 1 — the margin's attribute vector (NILT-2019)

Margin vs the pro-unity **core** vs the whole **electorate**:

| Attribute | **The margin** | (core, for contrast) |
|---|---|---|
| **Community background** | **52% Protestant**, 25% Catholic, 15% no-religion | 60% Catholic |
| **Age** | **oldest bloc — 40% are 65+**, only 2% under 25 | younger, flatter |
| **Sex** | 52% male | 57% female |
| **National identity** | **66% "Neither"**, 24% Unionist, ~0% Nationalist | 40% Neither |
| **Identity strength** | weak — almost no "very strong" | — |
| **Party ID** | **Alliance 35%**, Don't-know 19%, UUP 10%, DUP 8%, SDLP 8% | SF/SDLP |
| **Qualifications** | mixed — GCSE 34%, degree 27%, none 20% | more degrees |
| **Social class (NS-SeC)** | semi-routine 19% + **small-employer/own-account 14%** | more routine |
| **Household income** | barbell — 23% top band (£831+) alongside lower bands | — |
| **Urban/rural** | 67% urban; 45% "small city or town" | more big-city |
| **Softness score** | **0.76** (electorate 0.50, core 0.64) — the softest slice | — |

**The two attitude items that make them the margin:**
- **70% would "happily accept the wishes of the majority"** on a united Ireland — consent-democrats,
  not committed opponents. (Another 21% "could live with it".)
- **59% say Brexit "made no difference"** to their constitutional view — unmoved, low-salience, the
  opposite of the mobilised base.

In one line: **older, "Northern-Irish/Neither"-identifying, Alliance-leaning, lower-middle-class
Protestants of the eastern towns — weak on identity, high on democratic consent, low on salience.**
Not persuaded *of* unity; persuadable *into accepting* it.

## Part 2 — top-20 Data Zones (identity-refined)

Pure religion poststratification would just surface the *most-Protestant* DZs — the hardest rural
unionists, the least flippable. So the ranking is **refined by census national identity**: the
Protestant margin rate is scaled up in constituencies with a high "Northern Irish / mixed" identity
share (the soft, non-exclusive middle) and down where "British only" dominates. This moves the list
almost entirely — **only 2 of the top-20 overlap with the naive religion-only ranking.**

The result is the **North Down / Strangford / East Antrim commuter belt** — Bangor, Holywood, Comber,
Newtownards, the Ards peninsula, Carrickfergus fringe:

| representation in top-20 | Strangford ×11 · North Down ×8 · East Antrim ×1 |
|---|---|
| typical DZ | **80–90% Protestant background**, ~5% Catholic, **~40% "Northern-Irish/mixed" identity** in-seat |
| margin prevalence | ~7.2–7.4% of residents are pivotal-margin (vs ~5.9% naive), the NI ceiling |
| older-Protestant share | high — many DZs 25–47% aged-65+ Protestant, matching the age skew |

Full table (DZ code, constituency, religion background, older-Protestant share, in-seat soft-identity
share, density, margin rate) in `margin_top20_datazones.csv`.

**This is the mirror image of the coalition's base.** The base is densest in the nationalist west
(Belfast West, Foyle, Mid Ulster); the *margin* is densest in the unionist-suburban east — the same
"won in the west, decided in the east" split, now at Data-Zone resolution.

## Upgrade — using the census 3-way properly (MRP), not just religion

`margin_mrp.py` replaces the religion-only bridge with a **multivariate poststratification** over
every attribute NILT and the census-at-DZ *share*: **religion × age × sex**. A weighted logistic
model of margin membership is fit in NILT, then its predictions are poststratified onto each DZ's
census religion×age×sex cell counts (the 3-way table we hold, `dz21-religion-age-sex-2021`).

The model learns a **3× gradient** — margin propensity is highest for **older Protestant males (8.1%)**
and lowest for **young Catholics (2.6%)** — with age mattering almost as much as religion (a
65+ Protestant is far more pivotal-margin than a 25-year-old Protestant). Because age was ignored
before, this **moves the map: only 4 of the top-20 survive** from the religion-only ranking. It
surfaces the *oldest* Protestant DZs — coastal/retirement wards (Bangor, Donaghadee; some **45–69%
aged 65+**) plus older Protestant enclaves in Upper Bann, South Antrim, Belfast North/East that the
religion-only cut missed. Stacking the constituency-identity refinement on top (the fullest estimate)
pulls back toward North Down, which scores high on *both* age and soft identity. Output:
`margin_top20_mrp.csv`.

This is the genuine ceiling of the fusion: **the estimate is exactly as multivariate as the
attributes NILT and the census SHARE at the target geography** — here religion×age×sex. Adding more
census dimensions (identity, tenure, class) at DZ would require those cross-tabs to be published at DZ
(they are not — disclosure control limits DZ tables to ~1–2 variables) *and* enough NILT margin cases
(n≈51) to estimate their effect without overfitting.

## Widening the bridge with the multivariate tables (and what it revealed)

The 2-way/3-way NISRA tables *are* on disk: the **2011 Local Characteristics (LC) set at Small-Area
level**, including **LC2201 National-Identity × Religion** and **LC2101 National-Identity × Age**.
Crucially, NILT carries **`NINATID` (British / Irish / Northern-Irish / Other)** — the *same*
question as the census — so we can bridge on **religion × national-identity at the cell level**
(`margin_bridge_sa.py`), not the constituency multiplier used earlier. This is the correct, wider
poststratification the data supports.

**What it showed — a correction, not just a sharpening.** Fitting margin ∝ religion × national-
identity in NILT and poststratifying onto LC2201's 4,537 Small-Area cells:

- **Irish identity cleanly rules the margin OUT** (propensity ~1%): Irish-identifiers are the unity
  *core*, never the pivotal margin. Solid signal.
- **But within non-Irish identities the differences are small and noisy** — Protestant-"British only"
  6.7% vs Protestant-"Northern Irish" 5.0% vs Protestant-"Other" 7.8%, at **n=51 margin cases**. The
  poststratified Small-Area surface is **religion-driven and nearly flat within Protestant areas**
  (top-20 all 6.36–6.53%), and the top councils are **Ballymena, Craigavon, Coleraine** — the
  ordinary Protestant heartland, *not* a soft-identity belt.

**This revises the earlier North Down / Strangford emphasis.** That pointed east because of a
*constituency-level assumption* — "high Northern-Irish/mixed identity ⇒ softer ⇒ more margin." When
that hypothesis is actually **tested at the cell level with the multivariate table, it does not
hold**: fine national identity barely relocates the margin once religion (and age) are controlled.
The robust, data-supported conclusion is that the margin is **older Protestants broadly** (religion +
age, from the census 3-way and LC tables) — a *flatter, less east-specific* surface than the
identity-multiplier suggested. Using the fuller data corrected an overreach.

Output: `margin_top_smallareas.csv`. Caveats: **2011 vintage on 2011 Small Areas** (not 2021 DZ —
identity geography is fairly stable but this is a different frame); **n=51** caps the precision of
identity-within-religion cells; extending these cross-tabs to 2021 DZ needs the 2021 flexible-builder
multivariate tables (only 2011 LC/DC and the 2021 religion×age×sex 3-way are on disk here).

## Pushing further: (1) a 2021 DZ frame, and (2) adding class & tenure

**(1) Is there a 2021 multivariate frame (no vintage gap)?** Checked directly: **no.** There is no
2021 directory on disk — 2021 is represented only by the MS single-variable tables plus the one
religion×age×sex 3-way; the R2 bucket is `boundaries-data` (maps/geospatial, and no credentials in
this environment anyway). NISRA's **Flexible Table Builder is reachable** (`build.nisra.gov.uk`,
Cantabular-backed, datasets `PEOPLE`/`HOUSEHOLD`), so a fresh 2021 DZ cross-tab *could* be pulled —
but only by reverse-engineering the Cantabular variable-code + query API, which is a genuine follow-up
task, not an instant fetch. **The 2011 LC bridge remains the available multivariate analysis today**;
closing the vintage gap means scripting the NISRA FTB pull.

**(2) Do class (NS-SeC) and tenure add anything?** NILT has both (`NSSECRESP08`, `TENSHT1`), so we
tested the decisive question with **nested 5-fold cross-validated** margin models
(`margin_class_tenure.py`):

| model | CV log-loss | vs base |
|---|---|---|
| religion + identity + age + sex | 0.2029 | — |
| + NS-SeC (class) | 0.2066 | **+0.0037 (worse)** |
| + NS-SeC + tenure | 0.2060 | **+0.0031 (worse)** |

**Class and tenure add no out-of-sample signal — the fit gets slightly *worse*.** The margin's class
mix is close to the electorate's (a little more lower-managerial/small-employer/semi-routine, less
routine) and it is only mildly more owner-occupied (77% vs 72%) — too diffuse to relocate anything.
So the IPF synthesis needed to poststratify on class/tenure is **not worth doing: it cannot move the
margin's geography.** The operative axes are confirmed to be **religion + age**, full stop.

## CORRECTION — the 2021 Data-Zone cross-tabs exist; here is the definitive map

My earlier "no 2021 multivariate frame" was **wrong.** `agent/nisra-ftb-README.md` documents a
**147,492-table harvest of NISRA's Cantabular Flexible Table Builder** on R2
(`data.civgraph.net/data/census/nisra-ftb/`): 3,381 two-way, 24,238 three-way, 68,222 four-way and
51,431 five-way crosstabs — the exhaustive disclosure-releasable set — including **4,131 tables at
DZ21 (real 2021 Data Zones)**. I had only searched the census *scrape* index, which doesn't cover
this separate Cantabular corpus.

So I pulled the exact table needed —
`PEOPLE__DZ21~AGE_BAND_AGG11~NAT_ID_BASIC~RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO` (2021 DZ,
religion × national-identity × age) — and redid the margin poststratification on it
(`margin_dz21_ftb.py`, data persisted at `data/census/derived/dz21-religion-natid-age-2021.csv.gz`).
**No vintage gap (2021, not 2011), no Small-Area proxy (real DZ21), national identity at the cell
level.**

**What it confirms** — the learned propensity (now on real 2021 DZ cells): margin propensity rises
with **age** (Protestant 65+ ≈ 7%, under-25 ≈ 4%) and **Irish identity rules the margin out** (≈2%),
but **British vs Northern-Irish within Protestants barely differ** (7.4% vs 6.5%). Identity's only
strong role is exclusion of Irish-identifiers; the operative axes remain **religion + age** — exactly
what the 2011 Small-Area proxy said, now vindicated on the real 2021 frame.

**The definitive Top-20 Data Zones (2021)** — the older-Protestant Greater-Belfast / North-Down /
Antrim suburban belt:

| rank sample | Data Zone | seat | % Prot bg | % 65+ | margin rate |
|---|---|---|---|---|---|
| 1 | Larne Lough J4 | East Antrim | 68 | 39 | 6.0% |
| 2 | Bangor Central J1 | North Down | 73 | 39 | 6.0% |
| 3 | Comber F6 | Strangford | 77 | 34 | 6.0% |
| 4 | Lisburn South J3 | Lagan Valley | 65 | 43 | 5.9% |
| — | Ormiston (×4) | Belfast East | 60–79 | 27–45 | 5.6–5.9% |
| — | Holywood & Clandeboye (×3) | North Down | 65–68 | 34–38 | 5.7% |

Constituency counts in the top-20: **North Down ×6, Belfast East ×4, East Antrim ×3, Lagan Valley
×2**, then Strangford, North Antrim, South Down, Belfast South, East Londonderry. Full 60 in
`margin_top_dz21_2021.csv`.

**This reconciles the earlier passes.** The real 2021 DZ frame — *with age in it* — lands between my
first identity-hunch (North Down/Strangford) and the flat 2011-Small-Area religion-only result
(Ballymena/Craigavon): it points to the **oldest Protestant suburbs** (Bangor, Holywood, East
Belfast, Larne, Lisburn), because age tilts the ranking toward elderly-Protestant commuter wards.
The surface is still fairly flat (DZ margin rate 3.5–6.0%, mean 5.0%) — the margin is *broadly*
older Protestants — but its ceiling is unambiguously this suburban belt.

The corpus supports far more (up to 5-way crosstabs, and an MRP raking frame per
`agent/mrp-frame-README.md`); this 3-way is the substantive frame for the margin.

## What we can and cannot attach

- **NILT** — full individual attribute vector (above). ✓ The richest, most direct source.
- **Census 2021 at DZ** — religion background, older-Protestant share, population density, household
  size are attached to the top-20. ✓ National **identity** is only published to us at **constituency**
  level, so it enters as the area-softness refinement and as context, not a per-DZ value.
- **NIMDM deprivation** — **not cleanly joinable.** NIMDM 2017 is on 2011 Small Areas; the coalition
  model is on 2021 Data Zones, and no crosswalk is built (`canonical-geographies.json` lists it as
  *needed*). Directionally, the North Down/Ards belt is among NI's **least-deprived** areas (affluent-
  to-middling commuter suburbs), but exact deciles can't be stamped on these DZs here.
- **Rich ward tables** (tenure, NS-SeC, health, quals, identity components) exist but only at **ward**,
  with no DZ↔ward crosswalk — so they characterise the *area type*, not each DZ.
- **LucidTalk** — no microdata or geography in the corpus; it can only **corroborate the segment**
  (its crosstabs consistently show soft-No / "persuadable unionist" / Alliance voters skewing older,
  non-aligned, consent-oriented — matching the NILT profile). Not used to generate any number here.

## Caveats

- **n≈55**: broad profile robust, fine detail noisy.
- **Identity refinement is constituency-level**, so it cannot separate soft from hard DZs *within* a
  seat — North Down's DZs all inherit North Down's softness. A ward- or SDZ-level identity table would
  sharpen this; it isn't available at that resolution.
- Level/era caveats from the coalition build carry through (2019 base, reconstruction to ~45%).

Outputs: `margin_top20_datazones.csv`, `margin_profile.json`.
