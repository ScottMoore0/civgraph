# DZ-level unity Yes-share map (poststratified onto the MRP frame)

`unity_dz21_map.py` points the MRP frame at the **unity vote itself**: it fits a NILT
Yes-of-decided propensity on religion × identity × age, poststratifies onto each 2021 Data Zone, and
maps the result. Two frames are used — **(a)** the raked religion×identity×age frame (**2,189 DZs**)
and **(b)** a religion×age-only frame (**3,266 DZs**, fuller coverage). The map SHAPE is the robust
output; the NI level is re-centred to a stated **~45% topline** (2019 is a low base — the
poststratified 2019 Yes-of-decided is **33.8% / 35.3%**, which validates the model against the known
2019 ebb).

## The map (re-centred to a 45% NI vote)

| | frame A (identity, 2,189 DZs) | frame B (religion×age, 3,266 DZs) |
|---|---|---|
| DZs > 50% Yes | 818 | 1,271 |
| **population in a majority-Yes DZ** | **39%** | **40%** |
| highest-Yes DZs | Slieve Gullion (S. Armagh) 88–90, Foyleside (Derry) 88 | Collin (W. Belfast) 78, Lurgan 78, The Moor 78 |
| lowest-Yes DZs | Causeway / Braid / Ormiston (E. Belfast) / Larne Lough 18–19 | Bannside / Ards Peninsula / Dungannon / Causeway 18–19 |

**Constituency Yes-share** (frame B, re-centred): top **Belfast West 66 · Foyle 62 · South Down 59 ·
West Tyrone 59 · Newry & Armagh 58**; bottom **North Down 28 · Belfast East 28 · Strangford 29 ·
East Antrim 30 · Lagan Valley 32**.

## What it says

- **The Yes vote is geographically concentrated, not spread.** At a 45% NI topline, only **~40% of
  the population lives in a majority-Yes Data Zone** — Yes runs up huge margins in the nationalist
  west and border (Slieve Gullion, Foyle, West Belfast: 78–90%) and collapses in the Protestant
  east/north-coast (East Belfast, Larne, Ards, Causeway: ~18%). A 45% vote is a *deep-west /
  shallow-everywhere-else* distribution.
- This is the same "**won in the west, decided in the east**" structure as the coalition analysis,
  now at Data-Zone resolution and from an independent route (Yes-propensity poststratification rather
  than the softness-ranked coalition).
- **The two frames agree** on shape and on the majority-Yes population share (39% vs 40%), so dropping
  identity for the fuller 3,266-DZ coverage costs almost nothing — consistent with the finding that
  identity is a weak axis once religion and age are in.

## Method & caveats

- **Yes-of-decided propensity** P(Yes | Yes or No) fit on religion×identity×age (A) / religion×age
  (B), NILT 2019 weighted; poststratified onto the DZ frame; NI mean re-centred to 45% by a uniform
  shift that **preserves the geographic shape** (the level is survey/era-dependent; the ordering is
  the finding).
- **Coverage:** frame A 2,189 DZs (bound by the religion×identity margin), frame B 3,266 DZs (bound
  by religion×age). ~500 very small/homogeneous DZs are disclosure-blocked even at 2-way.
- Re-centring is a **level assumption**, not a measurement — a real poll's absolute numbers would
  differ; the map answers "where is Yes strong/weak," not "what will the count be."
- NILT n and era caveats carry through.

Outputs: `unity_yes_dz21_identity.csv` (2,189 DZs), `unity_yes_dz21_relage.csv` (3,266 DZs) —
columns `DZ21, label, con, yes_raw (2019), yes (re-centred), pop`.
