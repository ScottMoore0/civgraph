# LPS property data — integration and validation (v9 phases 10–15)

> **Read this first.** Phases 10–12 used the EONI *address gazetteer*, which has no
> valuation and no build date. Phases 13–15 use the **real LPS valuation extract**
> (`lps_all_properties_clean.geojson`, 933,609 properties with capital value, era
> band and built form) and the **non-domestic list** (55,902 with NAV and
> institution names). The headline verdict is unchanged — none of the three
> improves the model — but the *reason* differs by source, and the valuation and
> institutional data are far stronger standalone than the address file. See
> "Three sources compared" below.

## Three sources compared

Leave-one-council-out SHAPE MAE; census baseline **4.94**, bar was ≥0.30 improvement.

| feature set | n | LOCO R² | MAE | vs census |
|---|--:|--:|--:|--:|
| census (incumbent) | 88 | +0.932 | **4.94** | — |
| census + valuation/era | 106 | +0.929 | 5.11 | +0.17 |
| census + non-domestic | 101 | +0.922 | 5.14 | +0.19 |
| census + address | 106 | +0.901 | 5.63 | +0.69 |
| census + everything | 137 | +0.896 | 5.83 | +0.89 |
| **valuation/era alone** | 18 | **+0.475** | 15.32 | — |
| **non-domestic alone** | 13 | **+0.636** | 12.39 | — |
| address alone | 18 | −0.044 | 21.66 | — |

The standalone column is the interesting one. **Non-domestic institutional/NAV data
predicts nationalist vote share at R²=0.64 on its own, and valuation/era at R²=0.48**
— these are real signals, not noise (unlike the address gazetteer at R²=−0.04).
They still add nothing on top of the census, because they are largely a
reprojection of tenure / NS-SEC / qualification, which the model already has.

Best greedy subset across all 49 LPS candidate features: **4.83, −0.11** — and
selected on the metric it is scored against, so optimistic. Still 3× short of the bar.

Top single additions: `nd_n_institutional` (−0.04), `lpsf_public_built` (−0.04),
`lpsf_era_1966_1990` (−0.01).

## Scripts (13–15)

| script | what it does |
|---|---|
| `13_nondom_ingest.py` | non-domestic list (55,902): institution classification from organisation/building names, NAV, join to DZ |
| `14_lps_full_ingest.py` | **the full LPS valuation extract** (933,609): capital value, era band, built form, floor area, public vs private built, join to DZ |
| `15_validate_full.py` | validates all three sources against real results, singly and jointly |

### What the valuation extract actually contains

- `CVNonExempt` — domestic capital value; **860,541** properties have one
- `SubClass` — encodes **era band × built form**: verified bands are
  **Pre 1919 (12.6%), 1946-1965 (17.7%), 1966-1990 (29.7%), Post 1990 (40.0%)**
  over the 697,879 domestic properties carrying a band. There is **no 1919-1945
  band** — checked across all 933,609 records, not assumed.
- `PrimaryClass` — Privately vs **Public Built Housing** (234,605 public)
- `PropertySize` (floor area m²), `Garage`, `TotalNonExemptNAV`

### Defects found in the source data

1. **`non_domestic_properties.geojson` declares EPSG:29902 but its coordinates are
   WGS84 lon/lat.** ArcGIS wrote the service's native SR into the GeoJSON `crs`
   member while emitting degrees, as the spec requires. Reprojecting from the
   declared CRS put every point in the Atlantic and matched **0 of 55,902** zones.
   Now detected by bounds and the label overridden rather than transformed —
   55,899/55,902 join.
2. **The valuation extract has no organisation/building-name field**, so
   institutions cannot be identified from it; only the non-domestic list can do
   that. Matching institution patterns against `FullAddress` instead would
   reintroduce the phase-10 "ST = Street" false positive.

---

# Phases 10–12: the EONI address gazetteer

Full official NI address dataset (831,159 points) ingested, joined to the census
frame, tested against the model, and turned into a property-level and
polling-district product.

**Headline: the address features do NOT improve the model, and were not added to
it.** What the dataset does deliver is a new *geography* (polling districts) and an
*addressable* projection layer — not extra predictive accuracy.

## Scripts

| script | what it does |
|---|---|
| `10_lps_ingest.py` | reads `D:/eoni/properties.geojson` + `DZ2021.fgb`, spatial-joins every address to its Data Zone, derives per-property features, aggregates to DZ (3,780) and DEA (80) |
| `11_fit_validate_lps.py` | runs the **exact** harness of `3_fit_validate.py` over census / census+LPS / LPS-only, plus greedy forward selection |
| `12_lps_propensity.py` | property-level unity propensity + rollup to the 607 polling districts |

Re-run in order. Fetch the boundaries once:
`curl -sSL https://data.civgraph.net/data/maps/census-areas/DZ2021.fgb -o lps/DZ2021.fgb`

## Data placement — LOCAL ONLY

All outputs land in `v9/lps/`, which is **gitignored**. The source is EONI-derived
and is not publishable; only code and this report are committed. Property-level
propensities are persisted in full (no ≥DZ aggregation gate) per explicit
instruction, on the basis that the model stays on the local machine.

## The join

- 831,156 / 831,159 addresses fell inside a Data Zone; the remaining **3** (coastal
  boundary points) were snapped to the nearest DZ. Nothing dropped.
- `DZ2021.fgb` carries DZ → SDZ → DEA2014 → LGD2014 and `Area_ha`, so no separate
  crosswalk was needed.
- **External check:** properties carry `POLLING_ID`, joining to the 607 polling
  stations, whose file carries EONI's own `TotalProperties`. Median discrepancy
  **18 properties, 1.4% of a typical district**. Independent confirmation the
  assignment is right.

## Validation — the negative result

Metric is leave-one-**council**-out SHAPE MAE: spatial blocking, because that is
what the DEA(80) → DZ(3,780) downscale actually depends on. Bar was pre-registered
in the feasibility assessment at **≥0.3 pts improvement**.

| feature set | n feats | LOCO shape R² | MAE | vs baseline |
|---|--:|--:|--:|--:|
| census (incumbent) | 88 | +0.932 | **4.94** | — |
| census + LPS | 106 | +0.901 | 5.63 | **+0.69 worse** |
| LPS alone | 18 | −0.044 | 21.66 | worse than the mean |

Greedy forward selection, best achievable subset
(`era_other`, `era_rural`, `lex_planter`): MAE **4.89, −0.05** — and that is
selected *on the same metric it is scored against*, so even that is optimistic.

**LPS alone scores R² = −0.044: worse than predicting the mean.** The address data
carries no standalone spatial signal for nationalist vote share.

Note the trap: on leave-one-*contest*-out — the weak design that keeps every DEA
in training via its other contests — census+LPS looks *better* (4.14 → 4.07). That
is precisely the overfitting illusion spatial blocking exists to catch: 106
features on 80 training rows.

This confirms the prior: capital value, build era and address form are largely a
reprojection of tenure / NS-SEC / qualification, all already in the model and
already ridge-penalised.

## Lexicon bugs found and fixed (methodological record)

The first pass produced *sign-inverted* correlations — "loyal" naming correlated
**positively** with Catholic share. Three real defects, not noise:

1. **Unanchored morphemes.** `ARD` matched inside "G**ARD**ENS" — 34,706 addresses,
   100% false positive — and `ALT` inside "W**ALT**ON". Fixed by anchoring every
   toponym morpheme at word start (`\b`).
2. **Settlement names in community lexicons.** `LONDONDERRY` was **60% of all
   "loyal" matches**. A city name labels every address in a mixed or
   majority-Catholic settlement identically, inverting the feature. Removed
   (with `CRAIGAVON`); `DERRY` now carries a negative lookbehind so it does not
   fire inside `LONDONDERRY`. Settlement names are excluded from all three
   community lexicons on principle — only naming that varies *within* a settlement
   can carry community signal.
3. **`ABBEY` and bare `ST`.** `ABBEY` was **72% of "saint" matches** and is a
   generic NI estate element (Newtownabbey, Abbey Park). Bare `\bST\b` was matching
   "St" as the abbreviation for **Street**. `ST` now requires an actual saint's
   name to follow.

Post-fix, all signs are theory-consistent — saint +0.14, Irish +0.07, Irish-language
+0.06 vs loyal −0.10, planter −0.05 — but weak, as expected. These are correlations
with census religion and are **not evidence**: the lexicon is a religion proxy by
construction. The only test that counts is prediction of real election results, and
that is the table above.

## What IS delivered

**1. `lps/property_propensity.parquet` — 831,159 rows.** Every NI address with its
projected unity share for each of the four projection dates, plus DZ / SDZ / DEA /
LGD / polling district / coordinates / address string.

Piecewise-constant within a Data Zone, **deliberately**. A within-DZ tilt from the
address lexicons was tested in phase 11 and did not survive; applying one here
would invent precision the validation refused. Median within-district spread of DZ
projections is 33 pts, so the DZ mosaic — not the address record — is doing all the
geographic work. The property layer's value is that it is *addressable and
re-aggregatable*, not that it resolves below DZ.

**2. `lps/polling_district_unity.csv` — 607 polling districts.** Genuinely new:
polling districts are not census geographies and cannot be reached from the census
frame at all, yet they are the geography a referendum is administered on.

Projected unity, 2025-02 (property-weighted): min 9.6, median 45.6, max 97.4;
**270/607 districts project a unity majority, covering 39.6% of properties** —
consistent with the DZ-level 41.8%.

Face-valid at both ends — most pro-unity: Skeoge Community Hub (97.4), St Malachy's
Camlough (90.3), Coalisland (89.4); least: Parkgate PS (9.6), Woodburn PS (12.2).

**Caveat: property-weighted, not elector-weighted.** `NUM_ELECTORS` is empty for
every row in the current extract, so no elector or vacancy feature could be built
and districts are weighted by dwelling count. An extract with electors populated
would improve this directly; the parquet keeps the column so no schema change is
needed.

## What was not done

- **Domestic valuation + era-built.** Not integrated, because they are not
  obtainable: the LPS ArcGIS org (1,168 services) publishes no domestic property
  layer, and the OpenDataNI LPS holdings are aggregate statistics only. Build era is
  therefore proxied by street-type morphology, which is what `era_*` measures.
  Non-domestic property data (`TotalNAV`, classification) **is** bulk-available and
  remains the strongest un-integrated candidate — it carries institutional
  geography (churches by denomination, GAA grounds, Orange halls) that is genuinely
  orthogonal to the census.
- **Backcasting / nowcasting.** The highest-value uses identified in the feasibility
  assessment both need era-built, which this extract lacks.
