# Scope: integrating the 1991 Census into the model

> **UPDATE — TIER B DONE (full ward SAS, all topics).** The economic-activity and
> Irish-language gap flagged below (blocked in the *printed-report* OCR) is now
> closed via the **machine-readable route** anticipated at the end of this doc: the
> full **NISRA 1991 Small Area Statistics** were sourced from **Nomis (NM_63_1)** as
> a clean digital export — **566 wards × 8,784 cells**, not an OCR project.
>
> - `data/census/1991/sas/sas91ni_wards_full.csv.gz` — the full ward SAS (all 75
>   standard tables) mirrored into the repo, `+ cell_dictionary.csv`.
> - `scripts/build_1991_sas_dz_frame.py` derives **14 model covariates per ward**
>   (religion RC/Protestant/None/not-stated, Irish, economic activity + unemployment,
>   tenure owner/social/private, no-car, LLTI, qualified/degree) and crosswalks the
>   566 frozen-1991 wards to the **1984 electoral-ward geometry** (the matching
>   vintage — exact **566/566** after LGD disambiguation via the Nomis 95A–95Z code
>   prefix + an NI-wide exact-name fallback), then lands them on **every DZ (100%)
>   and SA (100%)** by representative-point-in-polygon.
> - **Validated** vs NI aggregates: RC 38.39 (NI 38.4), Protestant 50.57 (50.6),
>   total pop 1,577,866 (printed 1,577,836), owner-occ 63%, no-car 34%.
> - **Wired into the model**: `census-1991-lgd-full.csv` (26-council aggregate) drives
>   an honest leave-one-council-out test in `hist/backtest_councils_1989.py` — the
>   fuller SAS cuts nationalist-vote LOCO MAE **4.48 → 4.02 pts (~10%)** over
>   religion alone. `augment/trajectory_1991_2021.py` adds a 1991→2021 momentum
>   vector per DZ (Catholic +8.2, secularisation +5.6, social-rent −16.4 pts).
>
> Outputs: `dz21-census-1991.csv`, `sa2011-census-1991.csv`, `ward1984-census-1991.csv`,
> `census-1991-lgd-full.csv`, `dz2021_to_ward1984.csv`, `sa2011_to_ward1984.csv`,
> `augment/dz21_trajectory_1991_2021.csv`. The Tier-A-only note below is retained
> for history but is now superseded by the full-SAS integration.

> **UPDATE — TIER A DONE (religion).** The 1991 religion table is parsed, crosswalked and joined:
> - `scripts/parse_1991_religion_lgd.py` → `data/census/derived/religion-1991-lgd.csv` (26 LGDs × 7
>   denominations). **Validated**: NI total = 1,577,836 exact; all 27 denomination-sums match the printed
>   total; all 26 Catholic %s match the independently-keyed `CATH91` exactly.
> - `scripts/join_1991_religion_to_census.py` → `dz2021_to_lgd1993.csv`, `sa2011_to_lgd1993.csv`,
>   `dz21-religion-1991-lgd.csv`. **100% coverage** (3,780/3,780 DZs, 4,537/4,537 SAs → 26 LGDs); LGD-pop-
>   weighted mean 1991 Catholic% over DZs = **38.3 vs NI 38.4**.
> - `hist/backtest_councils_1989.py` now sources the parsed table (literal kept as fallback); backtest
>   unchanged (r ≈ +0.96, R² = 0.92).
>
> Every DZ and SA now carries a **1991 religion vector at council resolution**.
>
> **Economic-activity + Irish-language — blocked in the OCR, not shipped.** Unlike religion (a single
> clean all-26-district column-major table), these topics appear only as **per-LGD repeated tables** that
> do **not** parse reliably from this OCR, verified empirically:
> - *Irish language* — per-LGD "knowledge by age" tables: OCR age-range labels ("10-14") and stray split
>   ages ("24 1"→241) collide with the count stream, so the 11 columns don't segment into whole rows
>   (289 clean values, not divisible; the leading value came out 241, not the known NI total 1,502,385).
> - *Economic activity* — each LGD has several "LGD / Males Females" occupation sub-tables, so anchoring
>   grabs the wrong block (only 19/26 matched; e.g. Ballymoney read 197/349 vs its true ~9k male 16+).
>
> Rather than ship a misparsed secondary dataset, these are deferred. **Marginal value is low anyway:** at
> 26-LGD resolution both are strongly collinear with the religion layer (already integrated) and NIMDM
> deprivation. The clean route, if wanted, is the **NINIS/NISRA digital 1991 LGD tables** (the same
> external-sourcing path as Tier B), which drop straight into the crosswalk already built here. Tier B
> (ward SAS) is unchanged below.



## What 1991 can and cannot add

**Has:** religion (denomination — RC / Presbyterian / Church of Ireland / Methodist / Other / None-or-not-stated,
with ~11% not-stated), age × sex × marital status, economic activity, Irish language, tenure, household
composition, migration, education, workplace/transport.

**Lacks** (so it cannot extend every dimension of the current MRP frame): the **"community background"**
imputation (a 2001+ construct — 1991 has raw religion with high non-response) and **national identity**
(2011+). So 1991 extends the **religion, economic-activity, Irish-language and time-depth** axes; it does
**not** feed the religion×**identity**×age join directly.

## Geography reality (the deciding constraint)

The 1991 printed-report markdowns already in-repo (`data/census/1991/*.md`, ~600k lines OCR'd) are almost
entirely at **26 Local Government District** resolution — Religion Table 2 (denominations), Table 3
(religion × age/sex/marital), economic activity, Irish language, household composition are all **by 26
LGDs**. Only the **Belfast Urban Area report** carries **ward-level** detail (Belfast wards only). Genuine
NI-wide ward/ED 1991 data is **not** in the reports — it is the NISRA **1991 Small Area Statistics (SAS)**,
sourced separately.

Both era boundaries exist on R2 and crosswalk with the existing `build_dea_census_crosswalk.py`:
- **`lgd-1993.fgb`** (26 districts) — **DZ→LGD proven: 3,780/3,780 DZs assigned, 26 LGDs** (this scope run).
- **`wards-1993.fgb`** (~566 wards — the 1991-census ward geography) — ready for the same treatment.

## Two tiers

### Tier A — LGD-level 1991, entirely from in-repo data (recommended first)

- **Source:** parse the 1991 report tables already in the repo (Religion Table 2 + 3, economic activity,
  Irish language) into structured CSV keyed by the 26 LGDs.
- **Crosswalk:** DZ/SA → LGD-1993 (proven above; a one-line reuse of the crosswalk script).
- **Result:** 1991 religion (full denominations), economic-activity and Irish-language shares on **every
  DZ and SA at council resolution**, plus a clean structured table that upgrades the 1989 backtest from
  the single hardcoded `CATH91` Catholic-% dict to the full religion profile.
- **Effort:** LOW–MODERATE. The work is **OCR table cleanup**, not sourcing: the tables are column-major
  and noisy (e.g. `31,0`→`31.0`, `28 J`→`28.1`, `Castiereagh`→`Castlereagh`), so each parsed column must be
  validated against a control total. Two free controls exist: the **NI totals** printed in each table
  (e.g. population 1,577,836) and the existing **`CATH91`** Catholic-% column (cross-check the parsed RC
  column against it exactly). Per repo token-discipline, the bulk OCR extraction is a good Flash-delegate
  candidate; the validation and wiring stay Sonnet/Opus-side.
- **Limitation:** 26-unit resolution — it adds a real 1991 **time anchor** and a **fuller religion signal**
  to the backtest, but at council granularity it cannot sharpen the DZ softness surface the way fine data
  would. Its main value is time-depth + backtest fidelity, not sub-seat resolution.

### Tier B — ward-level 1991 (finer; needs external SAS)

- **Source:** NISRA 1991 SAS ward tables (religion, economic activity, Irish language by ~566 wards),
  from NISRA/NINIS or the ARK/CAIN archives — **not currently in the repo**. The Belfast Urban Area report
  is a partial in-repo down-payment (Belfast wards only).
- **Crosswalk:** `wards-1993.fgb` → SA2011/DZ2021 via the existing script (identical method to the DEA
  crosswalk; expected to validate the same way).
- **Result:** a genuine **DZ-level 1991 religion layer** — a real 1991 point on the Data-Zone frame,
  feeding the softness/uncertainty surface at fine resolution and enabling within-DZ 1991↔2011↔2021
  comparison.
- **Effort:** MODERATE–HIGH, gated on **sourcing** the ward SAS (a probe of NISRA/NINIS/ARK is step 0). If
  the SAS is obtainable as digital tables the parse is clean; if only as scanned volumes it becomes an OCR
  project on ~566 wards.

## Recommended plan

1. **Tier A now** (self-contained, no external dependency):
   a. Parse Religion Table 2 (denominations × 26 LGD) → `data/census/derived/religion-1991-lgd.csv`;
      validate the RC column against `CATH91` and the row against the printed NI total.
   b. Add economic-activity and Irish-language LGD tables (same parser).
   c. Emit `dz2021_to_lgd1993.csv` / `sa2011_to_lgd1993.csv` (crosswalk-script reuse) and a joined
      `dz21-religion-1991-lgd.csv` (1991 religion per DZ at council resolution).
   d. Upgrade `hist/backtest_councils_1989.py` to read the parsed full-religion table instead of the
      hardcoded `CATH91`.
2. **Tier B — scope step 0 only:** probe NISRA/NINIS/ARK/CAIN for machine-readable 1991 ward SAS; if found,
   run the ward crosswalk and build the DZ-level 1991 religion layer. If not found, stop at Belfast wards.

**Bottom line:** Tier A is a bounded, in-repo, immediately-doable win (parse + a crosswalk I've already
proven) that gives a validated 1991 council-level religion/economic/language layer and a better backtest;
Tier B is the higher-value fine-resolution version but hinges on sourcing the ward SAS. 1991 will deepen
the model's **time axis and religion signal**, not its identity dimension.
