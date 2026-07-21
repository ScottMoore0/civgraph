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

## Natural next step

The same `ark_to_election_json.py` route reaches **2001/2005** and **1985–1997** ARK XLS count sheets —
extending the revealed-behaviour transfer series back another 2–3 electoral cycles on the local side.
