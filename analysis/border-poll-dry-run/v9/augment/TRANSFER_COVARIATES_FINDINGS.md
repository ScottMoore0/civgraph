# Transfers integrated: a revealed-behaviour softness covariate

`transfer_covariates.py` turns STV transfers into a per-constituency second-dimension covariate,
pooling the **7 NI Assembly elections (1998–2022)**. It walks each count sheet, keeps only
**single-source stages** (party-attributable; bulk multi-eliminations skipped), derives the
**non-transferable** parcel as the residual, and aggregates **elimination** flows by source-bloc →
destination-bloc (vote-value units). The headline metric is **unionist openness** — the share of
transferable unionist votes that leave unionism (to Alliance/centre or across the divide).

## It resolves the exact gap the census/survey can't see

Two ~85%-Protestant seats, treated as identical by religion-only models, are opposite on transfers:

| seat | unionist openness | unionist plumping | unionist→DUP |
|---|---|---|---|
| **North Down** | **19.0%** (soft) | 14.8% | low |
| **North Antrim** | **4.0%** (hard) | 12.3% | **46%** (+11% TUV) |

North Antrim unionists transfer **~96% within unionism** — 46% to DUP, 37.5% UUP, 11.3% TUV — and
only **2.2% to Alliance**. That is hard, tribal, anti-Agreement unionism made visible from revealed
ballot behaviour — the same electorate that produced the sole GFA No. North Down's unionists, same
religion profile, transfer nearly 5× more openly. **This is the within-Protestant hard/soft
distinction the model has never had** — and it's exactly what the North Antrim case needed.

## Ranking (pooled, 20 constituencies)

- **Softest** (most cross-tribe): North Down 37.7 · East Antrim 26.6 · Belfast East 24.5
- **Hardest** (most tribal): Londonderry 1.9 · Newry & Armagh 6.4 · Armagh 7.0 · **North Antrim 8.2**
  (rank 17 of 20)

(The composite `transfer_softness` is partly confounded by *mixedness* — cross-tribe transfers need
the other tribe present — so nationalist-homogeneous seats like Londonderry score "hard" for lack of
targets. The **bloc-specific `u_openness` / `n_openness`** are the cleaner behavioural reads and the
ones to feed downstream.)

## Integration

`transfer_softness` vs the survey `mean_hardness` correlates only **r = +0.40** (n=18) — and the sign
is confounded (both partly track unionist composition). The *modest* correlation is the point: the
transfer covariate is **not redundant** with the religion-only survey hardness; it carries the
orthogonal within-bloc signal (soft North Down vs hard North Antrim unionism) that the survey surface
flattens. It plugs into the **v11 softness / persuadability / area-uncertainty** layer as a
revealed-behaviour feature that **corrects the NI-average survey softness where local transfer
behaviour says an area is harder or softer than its demographics imply** — e.g. down-weighting
persuadability in hard-transferring North Antrim, up-weighting it in open North Down.

Output: `transfer_covariates_constituency.csv` (u_plump, u_cohesion, u_openness, n_plump, n_openness,
transfer_softness).

## Caveats (carried from the feasibility assessment)

- **Single-source stages only** — parties eliminated only in bulk stages contribute nothing (their
  flow is non-attributable); this thins coverage for minor parties but not the majors.
- **Vote-value, not voter-count** (fractional WIGM); **blended/conditional provenance** (elimination
  parcels mix passed-through votes; late transfers are conditional on who remained) — so these are
  *aggregate behavioural* covariates, not individual second preferences.
- **Assembly-only here** (extends to local 1993–2023 and European 1994–2019 STV contests, ~14 more —
  the natural next pooling); **STV contests only**, so it enriches the referendum/unity estimate
  *indirectly*, through the softness surface.
- **Mixedness confound** in the composite index (use the bloc-specific openness metrics).

---

## DEA-level covariates (finer geography) — `transfer_covariates_dea.py`

Pooling the post-2014 local-government STV elections (**2014/2019/2023**, current 80-DEA geography)
gives the openness covariate at **DEA** resolution. With a minimum-transferable-base filter (≥500
vote-value; ratios on tiny bloc bases are noise and are dropped/clamped), the **hard-unionist end is
clean and reliable**: Ards Peninsula 0.6% · Three Mile Water 0.6% · Braid 1.1% · Airport 1.4% · Derg
1.8% · Coast Road 2.0% — the East-Antrim/Ards/Ballymena hard-unionist belt, the same character as
North Antrim. (The soft end stays noisy in nationalist DEAs where the unionist base is tiny; use the
covariate for *unionist-majority* DEAs.) Output: `transfer_covariates_dea.csv`. A **DZ→DEA crosswalk**
(not in-repo) would let this feed the Data-Zone softness directly; until then the v11 wiring below
uses the clean **constituency** openness via `dz_constituency`.

## Formally wired into v11 uncertainty — `v11c_softness_transfer.py`

v11b treated **all Protestants as maximally hard** (softness 0). v11c replaces that flat assumption
with a **transfer-derived Protestant softness** per seat, scaled from revealed unionist openness
(North Antrim 0.20, North Down 0.95), and recomputes the Data-Zone Yes-share uncertainty band. Effect:

| seat | Cath % | v11b band | **v11c band** | change |
|---|---|---|---|---|
| North Antrim (tribal) | 27 | 10.8 | 12.9 | **+2.1** |
| North Down (open) | 14 | 9.6 | **22.4** | **+12.8** |
| East Antrim | 18 | 9.9 | 20.5 | +10.6 |
| Strangford | 16 | 9.5 | 18.0 | +8.5 |
| Belfast East | 15 | 9.7 | 17.2 | +7.4 |

The uncertainty band now reflects **revealed movability, not just religion**: hard-tribal North
Antrim stays tight/certain, while open North Down's Protestant vote is treated as genuinely
persuadable — it now carries a *wider* band than North Antrim *despite fewer Catholics*. Two seats the
religion-only layer flattened into "identical and hard" are correctly separated. (Nationalist seats'
noisy unionist-openness is harmless — their softness is Catholic-dominated regardless.) Output:
`v11c_dz_softness_transfer.csv`. This is the transfer covariate doing real work in the uncertainty
layer, not sitting as a side-file.

---

## (a) DZ→DEA crosswalk + DEA-resolution wiring — `v11d_softness_dea.py`

The 2021 Data-Zone labels encode their DEA (`Airport_A1` → `Airport`): stripping the `_<L><n>` suffix
gives a **80/80 exact DZ→DEA crosswalk** for all 3,780 DZs (emitted as `dz_dea.json`). Wiring the
**DEA-level** openness (finer than the 18 constituencies, constituency-fallback where a DEA's unionist
base was too small) exposes **within-constituency variation the seat layer flattened**:

| constituency | hardest DEA (band) | softest DEA (band) |
|---|---|---|
| North Down | Ards Peninsula 8.9 | Bangor West 22.4 |
| East Antrim | Three Mile Water 10.1 | The Glens 23.5 |
| Strangford | Castlereagh East 9.8 | Rowallane 19.1 |

So a hard-unionist ward and an open one *inside the same constituency* now carry different Yes-share
bands — the softness surface has genuine sub-seat resolution. Output: `v11d_dz_softness_dea.csv`,
`dz_dea.json`.

## (b) Third independent read — `transfer_triangulate.py`

Pooling the **6 European STV contests (1994–2019, NI-wide)** and comparing NI-level unionist openness
against the Assembly- and local-pooled reads:

| contest type (pooled) | unionist openness | within-unionist | plumping | base |
|---|---|---|---|---|
| European (6) | **6.7%** | 93.3% | 9.0% | 211k |
| Assembly (7) | **8.4%** | 87.2% | 13.2% | 656k |
| Local (3) | **7.5%** | 89.2% | 12.8% | 130k |

The three independent contest types **agree to within ~1.7pts (6.7–8.4%)** — NI unionists transfer
~7–8% openly and ~90% stay in-bloc, consistently. The openness signal is **contest-robust**, not an
artifact of one election type, which underwrites its use as a covariate in the softness layer.

---

## (a) 30-year behavioural time series — `transfer_openness_timeseries.py`

NI-wide unionist & nationalist transfer openness per STV election. **Data limit found:** pre-2014
local-government transfer detail is **not digitized in the repo** (`hasCountDetail: false`, zero
transfers in 1993–2011 files), so the intended back-extension to 1993 is impossible; the behavioural
series rests on **Assembly 1998–2022 (complete)** + **local 2014–2023**. It shows a clear
**de-tribalisation** trend:

| decade | unionist openness | nationalist openness |
|---|---|---|
| 1993–2003 | 8.7% | 8.7% |
| 2004–2013 | 10.7% | 15.6% |
| 2014–2024 | **13.0%** | **33.9%** |

Both blocs transfer more cross-community over time, accelerating **post-2016** (the Alliance surge) —
the revealed-behaviour analogue of the attitudinal unity rise, and independent of it. (Nationalist
openness is inflated in the late 2010s by Alliance/Green absorbing nationalist transfers; the
*direction* is robust.) Output: `transfer_openness_timeseries.csv`.

## (b) Bidirectional wiring — `v11e_softness_bidirectional.py`

v11c/v11d corrected only the Protestant softness. v11e corrects **both**: Protestant from unionist
openness (hard base, raised), **Catholic from nationalist openness** (soft base, *lowered* where
nationalists plump — a conservative floor of 0.4, since nationalist openness partly reflects
intra-bloc PBP/left competition rather than unity-doubt). Effect on the DZ Yes-share band:

| seat | Cath % | v11b | **v11e** | Δ | character |
|---|---|---|---|---|---|
| Newry & Armagh | 64 | 17.4 | 14.1 | **−3.3** | tribal nationalist → certain Yes |
| Belfast West | 76 | 20.0 | 16.8 | **−3.2** | solid nationalist → certain Yes |
| Mid Ulster | 64 | 17.2 | 12.6 | **−4.6** | nationalist → certain |
| North Down | 14 | 9.6 | 19.3 | +9.6 | open unionist → uncertain |
| Belfast South | 44 | 15.6 | 21.3 | +5.7 | mixed middle → uncertain |
| North Antrim | 27 | 10.8 | 14.4 | +3.6 | tribal unionist (small real softness) |

This **fixes the v11b error** of giving solidly-tribal nationalist areas the *widest* bands: Newry &
Armagh and West Belfast are certainly Yes and now read as such. Uncertainty **concentrates in the
persuadable middle** (mixed Belfast South, open North Down) from both directions — exactly where a
referendum is actually decided. Output: `v11e_dz_softness_bidirectional.csv`.
