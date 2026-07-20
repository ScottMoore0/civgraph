# Full MRP poststratification frame at 2021 Data Zone — built by raking

`mrp_frame.py` builds a proper multilevel-regression-and-poststratification (MRP) frame at real 2021
Data-Zone geography from the NISRA Cantabular corpus, and re-derives the margin map on it.

## The disclosure reality that forces raking (and a correction)

NISRA blocks high-dimensional crosstabs at fine geography. Measured directly on the corpus at DZ21:

| table | DZs released | note |
|---|---|---|
| religion × identity × age × **sex** (4-way) | ~36 | ~99.6% of cells blanked — unusable |
| religion × identity × age (3-way) | **112** | mostly whole-DZ blocked |
| religion × age (2-way) | **3,266** | near-full coverage |
| religion × identity (2-way) | **2,197** | good coverage |

**Correction to the previous turn:** the "definitive" 2021 map I committed
(`margin_top_dz21_2021.csv`) read the *raw* 3-way, which is released for only **112 DZs** — so that
map effectively covered ~112 large DZs, not all 3,780. This file supersedes it.

The fix is exactly the recipe in `agent/mrp-frame-README.md`: **rake the joint from the
well-covered 2-way margins.** Under the standard assumption *identity ⊥ age | religion*, the raked
religion×identity×age joint is closed-form per DZ:

```
T[r,i,a] = (religion×age)[r,a] × idshare[i | r]          idshare from (religion×identity)
```

This lifts coverage from 112 to **2,189 DZs** (bound by the religion×identity margin; dropping
identity for a religion×age-only frame would reach 3,266). Sex and tenure are omitted from the
frame: the 4-way is disclosure-dead at DZ, and nested-CV testing already showed **sex and tenure add
no margin-discriminating signal**, so raking them in cannot move the map.

## Result — the margin map on the full-coverage frame

Scoring 2,189 DZs (pop-weighted mean margin rate 4.9%, range 2.0–6.5%), the top-20 is unchanged in
character — the **older-Protestant North Down / East Antrim / north-coast belt**:

- **North Down ×7, East Antrim ×7**, East Londonderry ×2, North Antrim ×2, Lagan Valley, South Antrim.
- Named DZs: Bangor East & Donaghadee, Holywood & Clandeboye, Carrick Castle, Coast Road, Larne
  Lough, Coleraine, Ballymena, Knockagh — coastal/commuter Protestant wards, **35–65% aged 65+**.

So every route — the 3-way (112 DZs), the 2011 Small-Area cell-level bridge, and now the
full-coverage raked frame (2,189 DZs) — converges: the pivotal margin is **older Protestants**,
densest in the eastern/northern coastal-commuter belt. Religion + age are the operative axes;
identity only excludes Irish-identifiers; sex and tenure are inert.

## The frame is general-purpose

`mrp_frame_dz21.csv.gz` (`DZ21, religion, national_identity, age, count`) is a reusable
poststratification frame: any NILT-modelled quantity — the unity coalition, softness, turnout, not
just the margin — can be weighted against it by fitting a religion×identity×age propensity in NILT
and summing over each DZ's cells. Swapping the propensity model is the only change.

## Caveats

- **Coverage 2,189 / 3,780 DZs** — the religion×identity margin is disclosure-blocked in ~1,600
  (typically very small or very homogeneous) DZs. A religion×age-only frame covers 3,266.
- **Raking assumption** identity ⊥ age | religion is a modelling choice (documented, per the README);
  it is exact on the two observed margins and only interpolates their interaction.
- Level/era and n≈51 caveats from the margin construction carry through unchanged.

Inputs (persisted): `dz21-religion-age-2021.csv.gz`, `dz21-religion-natid-2021.csv.gz`.
Outputs: `mrp_frame_dz21.csv.gz`, `margin_top_dz21_mrp.csv`.
