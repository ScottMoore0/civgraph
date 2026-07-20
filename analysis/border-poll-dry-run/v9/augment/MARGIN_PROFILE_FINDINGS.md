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
