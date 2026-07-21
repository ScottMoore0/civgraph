# Fully continuous unity series, 1989 → 2025 — one Data-Zone pipeline

`unity_full_series.py` closes the gap: every year 1989–2025 is now run through the **same** DZ
poststratification, harmonised to the border-poll REFUNIFY(Yes) scale.

| era | years | source | question | harmonisation |
|---|---|---|---|---|
| pre-NILT | 1989–1996 | **NISA** | reunify (constitutional) | community rates × DZ religion, **+4.9** |
| middle | 1998–2018 | **NILT** | constitutional (NIRELND) | religion×age propensity, **+4.9** |
| modern | 2019–2025 | **NILT** | REFUNIFY (border poll) | religion×age propensity, **+0.0** |

## The trajectory is NOT a steady rise — it's a W

| period | NI Yes (harmonised) | what it is |
|---|---|---|
| 1989–1996 | ~30–35% (mean **32**) | pre-NILT plateau |
| 1998–2006 | ~38–42% (peak 2006 **42**) | **post-GFA optimism** rise |
| 2007–2016 | ~25–29% (trough 2014 **25**) | the "settled decade" — the crash + post-conflict normalisation |
| 2019–2025 | ~41–47% (peak 2024 **47**) | the **Brexit-era** surge |

So unity support **rose after the Good Friday Agreement, fell back through the 2008 crash and the
quiet 2010s, then surged after Brexit** — three distinct movements, not one trend. Era means: NISA
**32.0**, NILT-constitutional **33.8**, REFUNIFY **42.6**. This reproduces the trajectory the earlier
NI-level `unity_timeseries` found, now on the *Data-Zone* pipeline end-to-end — a consistency check
that the three eras stitch sensibly.

## Honest seams and caveats

- **Era-join discontinuities.** 1996→1998 jumps +9pt and 2018→2019 +6pt. Both are *partly real*
  (post-GFA optimism in 1998; the Brexit/turmoil lift into 2019) and *partly harmonisation seam* — the
  +4.9 offset carries ±~8pt and NISA/NILT/REFUNIFY each have their own house effect. Read the
  *within-era* movements as solid and the *cross-era joins* as soft.
- **2021 composition throughout** (as the modern pipeline requires): this isolates **attitude** at
  fixed modern demographics. The actual contemporaneous 1989–96 topline on 1991 composition was a few
  points lower; the demographic drift since then *adds* to the attitudinal rise shown here.
- **The 2007–2016 dip is genuine**, not an artifact — it appears within the single NILT-constitutional
  series (no era join inside it), and matches the known low-salience decade.
- **Small-sample noise** in the earliest NISA cells and any single wave; the 3-wave smoothing column
  and the era-level means are the robust reads.

Output: `unity_ni_series_full_1989_2025.csv` (wave, source, ni_yes, 3-wave smooth). Supersedes the
NISA-then-gap-then-NILT stitch in `NISA_DZ_PIPELINE_FINDINGS` — the middle is now filled.
