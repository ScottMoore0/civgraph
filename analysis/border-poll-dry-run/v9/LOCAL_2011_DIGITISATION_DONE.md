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

## 1993–2005 — done the same way

The scraper was **year-parameterised** (`python scrape_2011_lgov_wikipedia.py <YEAR>`, default 2011) and
run for **2005, 2001, 1997 and 1993**, which share the 26-old-council geography and the same Wikipedia
STV templates. **The full 1993–2011 local series is now digitised.**

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

| year | unionist | nationalist |
|---|---|---|
| 1993 | 5.2 | 6.5 |
| 1997 | **4.2** | 10.9 |
| 2001 | 7.0 | 6.4 |
| 2005 | 11.1 | 9.8 |
| 2011 | 11.8 | 15.6 |
| 2014–2023 | native | native |

The unionist series (5.2 → 4.2 → 7.0 → 11.1 → 11.8) is a clean revealed-behaviour de-tribalisation
progression — the ballot-behaviour analogue of the attitudinal trend the model tracks. The 1997 dip is
the Drumcree-era hardening; the rise resumes and accelerates through 2005/2011. **Every NI local cycle
from 1993 to 2023 now carries transfer behaviour, all 101 DEAs per cycle** (bar two genuinely
uncontested DEAs — 2001 Ards East, 2005 Ballinderry) — the local side of the transfer covariate layer
is complete for the modern era.

## Natural next step

ARK's `ark_to_election_json.py` covers **1985–1989** XLS count sheets (Wikipedia's structured templates
thin out before 1993) — the back-extension, and an independent cross-check of the 1993–2011 series.
