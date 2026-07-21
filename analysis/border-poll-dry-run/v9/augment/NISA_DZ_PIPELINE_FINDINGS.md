# NISA level anchor wired into the modern DZ pipeline

`nisa_dz_pipeline.py` runs **NISA 1989–96 through the same Data-Zone poststratification** the
2019–2025 NILT waves use, so the pre-NILT era now produces DZ unity maps and NI levels on one
consistent basis instead of only a backtest number.

- **Shape**: NISA's community-specific reunify rates (Catholic/Protestant/None) poststratified onto
  each DZ's religion composition (the same 2021 census frame the modern pipeline uses).
- **Level**: NISA overall reunify **+4.9pt** — the documented within-NILT constitutional→border-poll
  offset — putting NISA on the same REFUNIFY(Yes) scale as the NILT waves.

## The continuous NI series, 1989 → 2025 (one pipeline, harmonised scale)

| era | source | NI Yes (harmonised) |
|---|---|---|
| 1989–1996 | **NISA** | 25 → 32 (1989 29, 1993 25, 1994–95 32, 1996 29) |
| … 1998–2018 … | NILT constitutional | *(NI-level only, in `unity_timeseries`; not yet in the DZ pipeline)* |
| 2019–2025 | **NILT** | 35 → 47 (2024 peak 47, 2025 45) |

So the same machinery now spans the whole period: **unity support sat in the high-20s/low-30s through
1989–96 and rose to the mid-40s by 2024** — the ~15–20pt attitudinal shift, measured on one scale.

**On the modern (2021) geography, NISA-era attitudes put only 0–19% of the population in a
majority-Yes Data Zone** (vs ~40% in 2024–25). Even holding demographics at today's more-Catholic
composition, 1989–96 attitudes yield far fewer unity-majority areas — the rise is attitudinal, not
just demographic. Earliest/latest NISA DZ maps in `unity_yes_dz21_1989_nisa.csv` /
`unity_yes_dz21_1996_nisa.csv`.

## Honest caveats (why this is an anchor, not a measurement)

- **Composition basis**: running NISA on the **2021 frame isolates attitude** (fixed modern
  composition), which is what makes it comparable to the 2019–25 series. The *actual* 1989–96 level on
  **1991** composition was a few points lower (fewer Catholics then) — so these are "1989–96 attitudes
  on today's map", not the contemporaneous topline.
- **Offset uncertainty**: the +4.9 constitutional→border-poll bridge carries a **±~8pt** band, and
  NISA's own house effect is unmeasured — the NI level is anchored, not pinned.
- **NISA subsample noise**: the per-community reunify rates come from small NISA cells (Catholic
  reunify bounces 47→60% across adjacent years), so the **DZ-count figures are noisy year-to-year**
  (e.g. 0 majority-Yes DZs in 1993 when Catholic-reunify dipped to 49%, 419 in 1994 at 60%). The
  **NI series is the robust output; the DZ maps are illustrative.**
- **The 1998–2018 middle** is NILT's *constitutional* question, already bridged at NI level in
  `unity_timeseries`; folding those 15 waves into the DZ pipeline (constitutional + offset) is the
  natural next step to make the DZ series fully continuous.

Outputs: `nisa_dz_series.csv`, `unity_ni_series_1989_2025.csv`,
`unity_yes_dz21_1989_nisa.csv`, `unity_yes_dz21_1996_nisa.csv`.
