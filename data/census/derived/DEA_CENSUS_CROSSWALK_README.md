# DEA vintage ↔ census small-area crosswalks

Maps every **2011 Small Area** and **2021 Data Zone** to its containing **District Electoral Area**
in all four historical DEA vintages, so election/transfer covariates measured on any DEA boundary set
can be carried onto a common census frame and compared over time.

Built by `scripts/build_dea_census_crosswalk.py`.

## Files

| file | rows | key | columns |
|---|---|---|---|
| `sa2011_to_deas.csv` | 4,537 | `SA2011` | `SOA2011`, `dea_1972`, `dea_1984`, `dea_1993`, `dea_2012` |
| `dz2021_to_deas.csv` | 3,780 | `DZ2021_cd` | `DZ2021_nm`, `DEA2014_nm` (native check), `dea_1972`, `dea_1984`, `dea_1993`, `dea_2012` |

DEA label columns hold the exact names used by the election data / feature indexes, so a covariate
keyed by DEA joins directly (verified: crosswalk labels match the `deas-*-vector-test` feature-index
labels **95/95, 98/98, 101/101, 80/80** for 1972/1984/1993/2012).

## Method

Representative-point-in-polygon spatial join (geopandas), all layers in WGS84:

- each SA/DZ is assigned to the DEA whose polygon contains the SA/DZ **representative point** (a point
  guaranteed to sit inside the unit — robust to sliver misalignment between the independently-drawn
  boundary sets);
- points in unlabelled/edge gaps fall back to the **nearest labelled DEA**, computed in a projected CRS
  (Irish Grid, EPSG:29903) for accurate distances.

Source geometries (NI-wide, from R2 `data/maps/`): `DEAs_1972.fgb` (label `NAME`), `DEAs_1984.fgb`
(`DEA`), `DEAs_1993.fgb` (`DEA`), `DEAs_2012.fgb` (`FinalR_DEA`); `SA2011.fgb`, `DZ2021.fgb`.

## Validation

The spatial `dea_2012` assignment reproduces DZ2021's **native `DEA2014_nm` attribute exactly —
100.0%** (3,780/3,780). That is an independent ground-truth check of the join method, so the same
method is trusted for the 1972/1984/1993 vintages where DZ2021 carries no native attribute. Every SA
and DZ is assigned in all four vintages (100% coverage). Spot checks trace sensible lineages —
e.g. Downpatrick DZs: `DOWN AREA B` (1972) → `DOWNPATRICK` (1984/1993) → `Downpatrick` (2012); Botanic
(Belfast) DZs: `BELFAST AREA F` (1972) → `BALMORAL` (1984/1993) → `Botanic` (2012).

## 1972 label repair

`DEAs_1972.fgb` ships with **4 broken polygon labels**, now repaired against the curated
`deas-1972-vector-test` feature index (which names all 98 correctly) by nearest-unclaimed-centroid,
leaving every correctly-labelled polygon untouched:

| fgb polygon (rep-point) | shipped label | repaired to |
|---|---|---|
| −6.650, 54.353 (Armagh) | *(null)* | **ARMAGH AREA D** |
| −6.958, 55.043 (Limavady, NW) | *(null)* | **LIMAVADY AREA C** |
| −6.864, 54.427 (Blackwater) | DUNGANNON AREA D | DUNGANNON AREA D *(kept)* |
| −6.766, 54.504 (Dungannon Town) | DUNGANNON AREA D | **DUNGANNON AREA C** |

After repair `dea_1972` resolves to **all 98** election DEAs, 1:1 like the other vintages. (Areal-overlap
apportionment is the alternative to representative-point assignment for units that straddle a DEA
boundary; given DEAs are large relative to SAs/DZs, point assignment is accurate and gives a clean
one-DEA-per-unit mapping.)

## Use

Join any per-DEA election/transfer covariate (e.g. unionist transfer-openness for a given cycle) to the
crosswalk on the matching `dea_<vintage>` column to land it on SAs/DZs, then compare cycles on the
common census frame:

```python
import pandas as pd
dz  = pd.read_csv("data/census/derived/dz2021_to_deas.csv")
cov = pd.read_csv(".../transfer_covariates_1993.csv")   # keyed by 1993 DEA
dz  = dz.merge(cov, left_on="dea_1993", right_on="con", how="left")
# dz now carries the 1993-cycle behaviour per Data Zone; repeat per vintage to build a DZ-level time series
```
