# 2011 NI local election transfers — digitised, on the map, in the model

Follow-through on `LOCAL_2011_DIGITISATION_FEASIBILITY.md`: the 2011 local count sheets are now
reconstructed to full count-by-count transfer detail, wired to the map layer, and feeding the model.

## What was done

1. **Wikipedia ingest** (`scripts/scrape_2011_lgov_wikipedia.py`, pre-existing, extended). Scraped the
   26 old-council articles → **101 DEAs, 982 candidates**, parsing the `STV Election box` templates
   into per-count running totals (max 13 counts). Derived each transfer as the count-to-count delta.
   **Fix added:** Wikipedia marks an *exclusion* by blanking a candidate's later count columns, so the
   redistribution **out** of an excluded pile was invisible (only the gains to others showed). Now an
   **elimination outflow row** is synthesised at the disappearance count (`Transfers = −last total`,
   `Status = Excluded`) — the signed source parcel the transfer model needs. Elected candidates blank
   too, but that is elected-and-surplus-distributed, a different (skipped) event, so outflow rows are
   emitted for excluded candidates only.

2. **Join + write** (`scripts/apply_2011_wikipedia_transfers.py`). Pivoted on the **deas-1993 geometry**
   (the canonical 101-DEA list, `labelProperty: DEA`): every Wikipedia DEA matched a geometry feature
   **1:1, zero residuals**. Wrote the full `countGroup` onto each existing ward file, preserving its
   identity (slug + `Constituency_Name`) so the geometry match is unchanged; created the one missing
   file (`carrick-castle.json`).

3. **Index repair** (`elections_index.json`). Deduped the **triplicated** old-council Belfast body
   (3 identical copies → 1), added Belfast's missing **Castle** DEA, and renamed Carrickfergus's
   `Castle` → `Carrick Castle` — which fixes a **council mis-attribution**: the `CASTLE` polygon is
   Belfast North (confirmed by centroid −5.925,54.634 and its SF/SDLP/Workers-Party field), not
   Carrickfergus.

## Verification

- **Map/site:** rebuilt `test/metadata/elections-test2` — the 2011 local contest now reports
  **101/101 constituencies matched to geometry, 0 unmatched, `hasCountDetail = true` for all 101**
  (was first-prefs-only before). Each ward's stage-by-stage transfer chart now renders (e.g. North
  Down Abbey's 12-count fractional WIGM sequence).
- **Internal consistency:** **seats == elected for all 101 DEAs**; max 13 counts; every DEA carries
  non-zero transfers including signed elimination parcels.
- **Independent check vs the official result:** NI-wide party **seats reproduce the published 2011
  totals exactly** — total **582**, DUP **175**, SF **138**, UUP **99**, SDLP **87**, Alliance **44**,
  Green **3**, Independent **27**. The only deltas are minor-party label boundaries (a few TUV/PUP/UKIP
  vs Independent), the expected party-classification nuance flagged in the feasibility note.
- **Model:** `transfer_openness_timeseries.py` now emits a **real 2011-local datapoint** — unionist
  openness **11.8%**, nationalist **15.6%** — which it previously could not (the pre-2014 files had no
  transfers). The **2004–2013** decade average moves 10.7% → **11.1%** (unionist) with 2011 folded in.

## Sources used vs planned

- **Wikipedia** — used as the bulk ingest (richest structured source; templates carry all counts).
- **ARK Elections** — used as an independent sanity check (the exact 582/party-seat agreement above is
  the cross-source validation the plan called for); a full per-DEA ARK reconciliation via
  `ark_to_election_json.py` remains available for a second-source audit.
- **EONI (Wayback)** — not needed for this pass; held as the authoritative tie-breaker for any DEA
  where Wikipedia and ARK disagree (none material surfaced at the seat/first-pref level).

## Honest limits (unchanged from the feasibility note)

- **Boundary vintage.** 2011 is on the **26-council / 101-DEA (deas-1993)** geography. It feeds the
  NI-level and old-DEA transfer series directly; sharpening the *current* DZ→DEA softness surface still
  needs an old→new DEA crosswalk (the 2014 reform split/merged areas).
- **STV limits.** Vote-value (fractional WIGM), blended/conditional provenance, single-source stages
  only — identical to the Assembly treatment; digitising 2011 adds coverage, not new provenance
  certainty.
- **Minor-party labels.** Wikipedia's TUV/PUP/UKIP vs Independent boundary differs slightly from other
  sources; majors and the seat total are exact.

## 1977–2005 — done the same way

The scraper was **year-parameterised** (`python scrape_2011_lgov_wikipedia.py <YEAR>`, default 2011) and
run back through **2005, 2001, 1997, 1993, 1989, 1985, 1981 and 1977**. **The full 1977–2011 local series
is now digitised** (plus native 2014–2023). Three boundary vintages, selected by year in the apply step:
**deas-1972** for 1977/1981 (98 DEAs, "AREA A/B/C" naming), **deas-1984** for 1985/1989 (98 DEAs),
**deas-1993** for 1993–2011 (101 DEAs); each carries its own spelling aliases.

### 1977

**96/98 DEAs digitised** (hasCountDetail true, 0 unmatched) on deas-1972; Larne Area A and Ballymena
Area B were uncontested (kept as-is). Same deas-1972 pipeline as 1981. Repaired the broken Belfast 1977
index (bare "Area-F/G/H", Area B–E omitted) → the full eight "Belfast Area A corrected..H". Party seats
track the official 1977 result (UUP **188**, SDLP **113**, Alliance **71** — their high-water mark, DUP
**70**; no Sinn Féin). Model datapoint: unionist openness **5.4%**, nationalist **17.5%** — the high
nationalist figure reflects the pre-SF, SDLP/Alliance-heavy era when moderate-nationalist transfers
crossed to the centre far more freely than during the tribal 1980s.

### 1981

**98/98 DEAs digitised** (hasCountDetail true, 0 unmatched) on the deas-1972 geometry. Added the 1981
election date and the **"Londonderry City Council"** article variant (the council was Londonderry
pre-1984) to recover Derry's 5 DEAs; added a Londonderry↔Derry area alias and a `lgNN-<code>-<rest>`
placeholder-slug expander (council-code map) so bare-"Area X" ward files join in place. Repaired the
**broken Belfast 1981 index** (it listed only unresolvable bare "Area-F/G/H" and omitted Area A–E) to
the full eight "Belfast Area A..H". Party seats track the official 1981 result (UUP **158**, DUP **143**,
SDLP **104**, Alliance **40**; **no Sinn Féin** — they did not contest in 1981). Model datapoint:
unionist openness **4.0%**, nationalist **9.0%**.

### 1985

**98/98 DEAs digitised** (hasCountDetail true, 0 unmatched, no uncontested gaps) on the deas-1984
geometry — up to 14 counts. Added the "Limavady District Council" article variant (Limavady was a
District Council in 1985, Borough later) to recover its 3 DEAs. Party seats reproduce the official 1985
result almost exactly (total **566**; UUP **191**, DUP **142**, SDLP **101**, SF **59**, Alliance
**34**). Model datapoint: unionist openness **3.2%** (the series floor — most tribal), nationalist
**9.6%**.

### 1989

97/98 DEAs digitised (**hasCountDetail true, 0 unmatched**) on the **deas-1984** geometry; Ballymoney
Town was uncontested (kept as-is). Party seats track the official 1989 result (UUP **192**, SDLP
**121**, DUP **109**, SF **43**, Alliance **38**). Model datapoint: unionist openness **4.5%**,
nationalist **5.7%** — the tribal trough at the base of the series.

### 1993

**101/101 DEAs digitised** (hasCountDetail true, 0 unmatched). Party seats track the official 1993
result (UUP **190**, SDLP **123**, DUP **101**, SF **46**, Alliance **44**). Model datapoint: unionist
openness **5.2%**, nationalist **6.5%**.

### 1997

**101/101 DEAs digitised** (hasCountDetail true, 0 unmatched). Added the `deas-1993` spelling aliases
(Knockveagh↔KNOCKIVEAGH, Dunmurray Cross↔DUNMURRY CROSS). Party seats track the official 1997 result
(UUP **178**, SDLP **116**, DUP **90**, SF **69**, Alliance **42**). Model datapoint: unionist openness
**4.2%** (the lowest — most tribal), nationalist **10.9%**.

> **Dungannon note.** In 1993 and 1997 the council was titled **"Dungannon District Council"** (renamed
> "Dungannon and South Tyrone" from 2001), so its article sat under a name the scraper's variant list
> initially missed — its four DEAs first came in as first-preferences only, then were backfilled to full
> transfer detail once the variant was added. Both years are now complete.

### 2001

100/101 DEAs digitised (**hasCountDetail true, 0 unmatched**); **Ards East** was uncontested (kept
as-is). Two extra name-matching cases handled: Wikipedia's council-prefixed DEA names ("Craigavon
Central" → the `CENTRAL` feature) and "corrected" ward files ("Pottinger corrected", "Rowallane
corrected"). Resolved a **pre-existing Belfast 2001 duplicate** — both `Pottinger` and
`Pottinger-corrected` were listed — by dropping the superseded uncorrected copy. Party seats track the
official 2001 result (UUP **151**, DUP **129**, SDLP **118**, SF **108**, Alliance **27**) bar the
uncontested DEA. Model datapoint: unionist openness **7.0%**, nationalist **6.4%** — visibly more
tribal than 2005/2011, the early point of the de-tribalisation trend.

### 2005

All 26 councils scraped → **101 DEAs, 912 candidates, up to 12 counts**. Outcome after wiring:

- **Map:** 2005 local reports **100/101 constituencies matched, 0 unmatched, `hasCountDetail` true for
  all 100**. The one gap is **Ballinderry (Cookstown)**, returned **uncontested** — there is no poll
  table to digitise (and no transfers), so it keeps its existing entry.
- **Elected-detection hardened.** Bold-only detection missed seats filled at the final narrowing
  ("elected without reaching quota", not always bolded) and mis-read quota-elected candidates whom
  Wikipedia blanks. Replaced with **elected = the `seats` candidates with the highest total ever
  achieved** (bold as a guaranteed-elected signal) — an elected candidate always crosses quota, so
  tops every excluded one. This fixed all five 2005 seat-count mismatches and, verified as a
  regression check, **left 2011 identical** (still 101/101, official totals exact).
- **Validation:** 2005 NI-wide party seats track the official result — DUP **181**, SF **126**, UUP
  **116**, SDLP **99**, Alliance **30** — bar the uncontested DEA and the usual minor-party label
  nuance.
- **Model:** 2005 local now contributes a real datapoint — unionist openness **11.1%**, nationalist
  **9.8%** — so the **2004–2013** decade now blends both 2005 and 2011 local behaviour.

## Series so far

Local unionist / nationalist transfer-openness now digitised from Wikipedia:

| year | unionist | nationalist | geometry |
|---|---|---|---|
| 1977 | 5.4 | 17.5 | deas-1972 |
| 1981 | 4.0 | 9.0 | deas-1972 |
| 1985 | **3.2** | 9.6 | deas-1984 |
| 1989 | 4.5 | 5.7 | deas-1984 |
| 1993 | 5.2 | 6.5 | deas-1993 |
| 1997 | 4.2 | 10.9 | deas-1993 |
| 2001 | 7.0 | 6.4 | deas-1993 |
| 2005 | 11.1 | 9.8 | deas-1993 |
| 2011 | 11.8 | 15.6 | deas-1993 |
| 2014–2023 | native | native | deas-2012 |

The unionist series (5.4 → 4.0 → 3.2 → 4.5 → 5.2 → 4.2 → 7.0 → 11.1 → 11.8) is a clean revealed-behaviour
de-tribalisation progression — the ballot-behaviour analogue of the attitudinal trend the model tracks.
1981–1997 is the tribal trough (3–5%), with the 1997 local low the Drumcree-era hardening; the rise
resumes and accelerates through 2005/2011. The **nationalist** side is high in 1977 (17.5%, the moderate
SDLP/Alliance era before Sinn Féin entered), collapses through the tribal 1980s, and climbs again post-2000.
**Every NI local cycle from 1977 to 2023 now carries transfer behaviour, all DEAs per cycle** (bar five
genuinely uncontested DEAs across the whole run). `transfer_openness_timeseries.py` runs from 1977.

## Status

**The NI local transfer series now spans 1977 → 2023 — the entire STV local record of the Troubles and
the peace process — digitised or native, at full DEA coverage across three boundary vintages.** Assembly
(1998–2022) and European (1994–2019) STV contests already fed the covariate layer. Wikipedia's structured
STV templates reach back to 1977; **1973** (the first STV local election under the current system, also
deas-1972) is the one remaining cycle — the templates thin out at the very start, so ARK's
`ark_to_election_json.py` XLS route is the more reliable source for it and an independent cross-check of
the 1977–2011 series.
