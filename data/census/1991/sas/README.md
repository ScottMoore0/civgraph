# 1991 Census — full ward Small Area Statistics (SAS)

The complete NISRA **1991 Small Area Statistics** for Northern Ireland, sourced from
**Nomis dataset `NM_63_1`** ("1991 census SAS (NI data)") as a clean digital bulk
export at **1991 frozen-ward** resolution (Nomis geography `TYPE1`).

## Files

| file | shape | notes |
|---|---|---|
| `sas91ni_wards_full.csv.gz` | 566 wards × 8,784 cells | wide; column headers carry the full cell descriptions (`cell: S06:2 (…); measures: Value`) |
| `cell_dictionary.csv` | 8,784 rows | `col_index, cell_id, description` — every SAS cell across the 75 standard tables S01–S95 |

The geography code (`95A_..`–`95Z_..`) prefixes 95A–95Z map 1:1 to the **26 Local
Government Districts**; the geography name is the frozen-1991 ward name.

## Derived model frames (in `data/census/derived/`)

`scripts/build_1991_sas_dz_frame.py` derives 14 covariates per ward and crosswalks
them onto the model's census frame:

- `ward1984-census-1991.csv` — 566 wards × 14 covariates (+ raw bases).
- `census-1991-lgd-full.csv` — 26-council pop-weighted aggregate.
- `dz21-census-1991.csv` / `sa2011-census-1991.csv` — covariates on every 2021 Data
  Zone / 2011 Small Area (100% coverage).
- `dz2021_to_ward1984.csv` / `sa2011_to_ward1984.csv` — the DZ/SA → 1984-ward crosswalk.

### Covariates and their SAS cells

| covariate | numerator | denominator |
|---|---|---|
| `rc_pct` | S06:2 | S06:1 |
| `protestant_pct` | S06:3+4+5+6 | S06:1 |
| `none_relig_pct` | S06:7 | S06:1 |
| `relig_notstated_pct` | S06:8 | S06:1 |
| `irish_speak_pct` | S67:3+4 | S67:1+2 |
| `econ_active_pct` | S08:12+166 | S08:1+155 |
| `unemployment_pct` | S08:78+232 | S08:12+166 |
| `owner_occ_pct` | S20:2+3 | S20:1 |
| `social_rent_pct` | S20:6+7 | S20:1 |
| `private_rent_pct` | S20:4+5 | S20:1 |
| `no_car_pct` | S20:10 | S20:1 |
| `llti_pct` | S06:65 | S06:1 |
| `qualified_pct` | S84:4 | S84:1 |
| `degree_pct` | S84:10 | S84:1 |

## Crosswalk method

The frozen-1991 wards are drawn on the **1984 electoral-ward geometry**
(`Wards_1984.fgb`, 566 polygons — the matching vintage; `Wards_1993.fgb` is a later
boundary revision that renames ~30 wards). SAS wards join to the geometry by
(normalised-name, LGD); the LGD comes from the Nomis 95A–95Z prefix (majority-voted
against uniquely-named wards). Residual name variants resolve by within-LGD fuzzy
match, then an NI-wide exact-name fallback → **566/566**. Every DZ/SA is then assigned
to its containing 1984 ward by representative-point-in-polygon.

## Validation

Population-weighted NI aggregates reproduce known 1991 controls: Roman Catholic
**38.39%** (published 38.4), Protestant **50.57%** (50.6), total population
**1,577,866** (printed 1,577,836), owner-occupation ~63%, no-car ~34%.
