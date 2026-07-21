# Cross-era unity projection — a harmonised 1989→2025 series

Builds the level backbone that lets the model project a unity referendum result **back
through the pre-LucidTalk (NILT, 1998–2012) and pre-NILT (NISA, 1989–96) eras**, so the
trend over time is visible. `unity_timeseries.py` → `unity_timeseries.csv`.

## The problem and the fix

Each era's level is a *different* survey question on a *different* scale:
LucidTalk `REFUNIFY` (2012+, direct border-poll), NILT constitutional preference (1998+),
NISA (1989–96). They can't be compared raw. Two calibrations put them on one scale:

1. **Constitutional → border-poll offset (within NILT, same respondents, 2019–2025):**
   NILT carries *both* `REFUNIFY` and the constitutional question, so the gap is clean —
   **+4.9 pt (SD 1.3):** constitutional preference understates a border-poll Yes by ~5 pt.
   Applied to NILT 1998–2018 and (bridged) to NISA.
2. **LucidTalk house effect vs NILT (overlap):** LucidTalk's online panel runs **+2.0 pt**
   above NILT's random sample — corrected onto the NILT (gold-standard) scale.

Everything is then a **border-poll-equivalent Yes %** on one scale, with bands that widen
backwards (sampling + offset + no-direct-poll + NISA-bridge uncertainty).

## The series (border-poll-equivalent Yes %, 90% band)

| Era | Years | Unity % (range) | Source |
|---|---|---|---|
| NISA | 1989–1996 | ~26–33 | NISA + offset (bridged; widest bands ±8) |
| NILT | 1998–2007 | ~27–41 (≈32 avg) | NILT const. + offset |
| NILT | 2008–2018 | ~23–29 (a **dip**) | NILT const. + offset |
| NILT/LucidTalk | 2019–2025 | 33 → **46** (a **sharp rise**) | NILT `REFUNIFY` direct |

## What it says — and it answers the question directly

**Yes, there has been change over time — but not the shape intuition suggests.** The rise
is **recent and steep, not a slow demographic drift**:

- A long **plateau of ~25–32%** from the 1990s through ~2016.
- A **dip to ~23–25%** around 2008–2016 (post-crash, pre-Brexit).
- A **sharp climb from ~2019**, from the low-30s to **~45%** now — the Brexit / Protocol
  inflection.

So the ~15-point move that took unity from its long plateau to today's near-parity is
**attitudinal and recent (post-2016)**, *not* the steady effect of demographic change or
the unionism→Alliance realignment. That is fully consistent with the model's earlier
findings: composition momentum moves unity only **~1 pt per decade** (the forward-projection
result), and the census-geography is near-static — so a 15-point swing in a few years can
only be **attitude**, which is exactly what the survey series shows.

Put plainly: the unionism→Alliance/Green shift and the rising Catholic-background share are
real and matter for the *geography* (who is persuadable, where), but the *level's* big move
is a **Brexit-era change of mind**, not demographic inertia.

## How this plugs into the model

This is the **level backbone**. Combined with the era-appropriate **census gradient**
(2021 now, 2011 for the 2000s, 2011-stand-in/1991-if-obtained for the 1990s) and the
**party-composition axis** (the Alliance/Green middle), the pipeline can now place *any*
year's harmonised level onto the area geography — a full backwards area-level unity
projection per era, using machinery already built (Tier-1/2/3 + v11).

## Caveats (front and centre)

- **Unvalidatable.** No border poll has ever been held, in any of these years — every point
  is a projection, and the backwards series compounds that.
- **Pre-2012 is inferred**, not measured: the border-poll figure is the constitutional-
  preference reading + a calibrated offset (assumed stable — it's actually drifted a little,
  +6→+3 pt over 2019–2025).
- **Pre-1998 (NISA) is bridged and thinnest** — tabulated marginals, small samples,
  wording continuity assumed — hence the widest bands.
- **Attitude, not turnout-adjusted vote.** These are survey preferences; an actual result
  would also turn on differential turnout (the #4 turnout layer).
- The single-wave **spikes (2001, 2006 ≈ 40%)** are within NILT sampling noise (~±3 pt on
  n≈1,000); read the *trend*, not individual years.
