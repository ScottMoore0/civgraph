# Scope: integrating the 1991 Census into the model

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
> Every DZ and SA now carries a **1991 religion vector at council resolution**. Remaining Tier A extras
> (economic-activity, Irish-language LGD tables) reuse the same parser; Tier B (ward SAS) is unchanged
> below.



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
