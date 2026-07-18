# Border Poll projection — v3 (NISRA + LucidTalk + NILT + elections, integrated)

v3 brings all four data sources into one model, each **provenance-tagged**, ties
each to actual election/referendum results, and projects the Border Poll
decided-unity share at every survey time point.

## Sources & provenance

| Source | Provenance tag | Role |
|---|---|---|
| NISRA Census (2011 SA, 2021 DZ community background) | `census` | poststratification frame |
| **NILT** — all waves 1998–2025, weighted | `survey-microdata` | individual-level unity by community background |
| **LucidTalk** — border-poll VI by religion | `survey-crosstab` | frequent unity signal (kept alongside NILT) |
| NI elections + 2016 EU referendum | `actual` | reality anchors / calibration |

NILT ingested from ARK (free, `ark.ac.uk/nilt/<year>/nilt<yy>w?.sav`), 23 waves
(missing 2002/2009/2011/2013/2015). Harmonised by `nilt_ingest.py` →
`nilt_constitutional_series.json`: `NIRELND/NIRELND2` (constitutional preference,
1998–2025) and `REFUNIFY/BORDPOLL` (direct border-poll VI, 2017/2019–2025),
weighted, overall + by community background (`FAMRCODE`).

## How each source relates to reality

- **census ↔ 2016 EU referendum:** aggregating 2011 community background to the
  18 constituencies, `Remain% = 37.9 + 0.41·Catholic-bg%`, **R² = 0.68** — the
  poststratification engine reproduces real constitutional-adjacent geography.
- **LucidTalk ↔ NI elections:** its bloc VI **understates the nationalist bloc
  ~2.9 pts** vs the 2022 Assembly result → +2.9 correction to its unity headline.
- **NILT ↔ NI elections:** random-probability survey used as the benchmark; no
  house-effect correction applied.
- **NILT ↔ LucidTalk:** on the same unity question NILT runs **~1–3 pts below**
  LucidTalk — an independent cross-check that brackets the estimate.

## Result — projected Border Poll (decided-unity %), poststratified to SA/DZ

| Date | Source (provenance) | raw | projected NI | area p10–median–p90 | maj-unity areas |
|---|---|---|---|---|---|
| 2019 | NILT (microdata) | 32.7 | 32.7 | 10–25–60 | 25% |
| 2020 | NILT | 35.7 | 35.7 | 13–28–63 | 28% |
| 2021 | NILT | 41.5 | 41.5 | 17–37–70 | 36% |
| 2021-01 | LucidTalk (crosstab) | 47.5 | 50.4 | 17–44–88 | 46% |
| 2021-05 | LucidTalk | 46.2 | 49.1 | 17–43–85 | 45% |
| 2022 | NILT | 42.5 | 42.5 | 18–38–71 | 37% |
| 2022-08 | LucidTalk | 46.1 | 49.0 | 19–43–83 | 45% |
| 2023 | NILT | 43.0 | 43.0 | 18–38–73 | 38% |
| 2024 | NILT | 45.9 | 45.9 | 21–41–75 | 41% |
| 2024-02 | LucidTalk | 44.3 | 47.2 | 16–41–84 | 43% |
| 2025 | NILT | 44.8 | 44.8 | 19–40–75 | 40% |
| 2025-02 | LucidTalk | 46.1 | 49.0 | 16–43–86 | 45% |

Both surveys agree unity is a **minority-but-rising** on decided voters, and
they **bracket** the estimate: NILT lower (~42–46%), LucidTalk higher (~47–50%
after house-effect correction). NILT's flatter community gradient (Protestant
unity ~10–13% vs LucidTalk ~4–9%) yields a less geographically polarised map.

## Long-run context (NILT constitutional preference, `NIRELND`, decided reunify)

~27% (1998) → trough ~18–20% (2008–2014) → post-Brexit rise to ~41% (2024–25) —
in `nilt_constitutional_series.json`.

## Limitations (carried from v1/v2, plus new)

- NILT gives individual demographics but **no sub-NI geography** — geography
  still comes from the census; the NILT contribution is the demographic model.
- Community-background-driven; NILT's other demographics (age, tenure, NS-SeC,
  identity) not yet used in a joint individual-level regression (next step: fit
  real MRP on pooled NILT records rather than community-background rates).
- House effect from one election; 2016 residuals are an EU proxy; no
  DZ→constituency crosswalk (2021 maps lack per-constituency residuals).
- **The target remains unobserved** — no Border Poll has been held. This is a
  triangulated, reality-anchored engine, not a measured result.

Files: `nilt_ingest.py`, `nilt_constitutional_series.json`,
`lucidtalk_unity_rates.json`, `pipeline_v3.py`, `v3_summary.json`.
