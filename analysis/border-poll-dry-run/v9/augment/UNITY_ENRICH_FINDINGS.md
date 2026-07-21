# Folding the party-composition signal into the unity projection

The guarded backtest showed party composition carries real, non-nationalist signal (it
beats census on the EU-ref via the unionist-internal split). This folds that signal into
the unity projection through the one bridge that connects party vote to *unity*
specifically: a NILT calibration of unity preference by party support.

Pipeline: `nilt_unity_by_party.py` → `unity_party_enrich.py` (constituency) →
`unity_enrich_dz.py` (Data Zone). Outputs: `unity_by_party.json`,
`unity_enriched_constituency.csv`, `unity_enriched_dz_2025-02.csv`.

## Step 1 — unity by party support (NILT REFUNIFY, pooled 2020–2024, weighted)

| Party support | % voting Yes to a united Ireland | n (decided) |
|---|---|---|
| Sinn Féin | 91.9 | ~906 |
| SDLP | 76.5 | ~517 |
| Green | 57.8 | ~207 |
| **Alliance** | **43.6** | ~1156 |
| **None / other** | **31.0** | ~978 |
| UUP | 2.7 | ~659 |
| DUP | 2.0 | ~840 |

The two bolded rows are the whole point: **Alliance supporters split ~44/56 on unity and
"no party" ~31%** — a large, movable middle that census religion cannot represent (it sees
these voters only as "Protestant" or "None"). This is exactly the bloc that decides a real
border poll.

## Step 2 — constituency correction

For each constituency: `party-implied unity = Σ (2022 Assembly party share × that party's
unity rate)`, compared with the census-religion unity, both as shapes re-centred to the
survey NI level. The difference is the correction (damping w = 0.5, capped so it can only
refine):

| Constituency | Catholic % | census unity | enriched | correction |
|---|---|---|---|---|
| North Down | 13.5 | 21.3 | 23.9 | **+2.7** |
| Belfast West | 78.8 | 64.8 | 66.5 | +1.6 |
| Mid Ulster | 67.3 | 55.8 | 57.4 | +1.6 |
| Upper Bann | 44.9 | 41.3 | 39.6 | −1.7 |
| Lagan Valley | 22.7 | 26.2 | 24.1 | −2.2 |
| North Antrim | 29.0 | 29.1 | 26.9 | −2.2 |

North Down moves **up** — its heavy Alliance/Green vote signals more unity-openness than
its 13.5% Catholic share implies. Hard-unionist Lagan Valley and North Antrim move **down**.
These are precisely the middle-ground refinements census religion misses.

## Step 3 — Data Zone propagation

Each of the 3,780 Data Zones keeps its census-based value and inherits its constituency's
correction (party vote is only observed at constituency level); the surface is then
re-centred so the NI topline is unchanged (held at the projection's survey level, 45.8% for
Feb-2025). 2,536 / 3,780 DZs shift by >1 pt, max |shift| 2.7 pt — a genuine but bounded
refinement, largest in the moderate-unionist suburbs (North Down) and smallest in the
strongly-aligned areas where census and party agree.

## Honesty / scope

* The party→unity mapping is an **observed NILT association**, pooled for sample size — not
  a causal claim, and it can't be validated against a unity referendum (none has occurred).
  What *is* validated is the underlying mechanism: party composition beats census on the
  analogous EU-ref, under a strict guard (`LAG_FINDINGS.md`).
* The correction is **damped (w = 0.5) and capped** so it refines the census geography
  rather than replacing it; the survey still sets the level.
* Resolution is **constituency** (party vote isn't reported below DEA/constituency), so all
  DZs in a constituency share the same correction — the DZ-level texture still comes from
  the census.
* The Alliance/"no-party" unity rates are the single most consequential — and most
  uncertain — numbers in any border-poll projection; here they are made explicit inputs
  rather than being buried inside "non-Catholic".
