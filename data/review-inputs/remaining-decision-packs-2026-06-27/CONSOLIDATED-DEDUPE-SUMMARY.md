# Consolidated dedupe decisions

Source: `data/review-inputs/remaining-decision-packs-2026-06-27/dedupe-decisions.csv` (1,022 ranked candidates) + 50-escalation adjudication + Tellus ESRIGRID reclassification.

## Final tally
- **publish-new: 629** — distinct layers cleared to publish (map-conversion backlog)
- **duplicate-skip: 392** — already represented on-site; drop
- **publish-as-variant: 1** — link as enrichment of an existing record

## How the 50 escalations resolved
- **17 → duplicate-skip**: 15 per-constituency slices of "Parliamentary Constituencies 2023" (parent already on-site); `270` NI River Segments (= on-site NIEA River Segments); `1087` (internal dup of `1085`).
- **1 → publish-as-variant**: `522` Development Planning DCC → variant of on-site "Development Plan 2022 2028 (DCC)".
- **32 → publish-new**: distinct by jurisdiction / scale / product (ROI-vs-NI splits, INSPIRE HVD registers, community-scale flood layers, county-specific civic layers, etc.).

## Tellus reclassification
- **3 → duplicate-skip**: `1112/1113/1114` (Tellus_{Electromagnetics,Magnetics,Radiometrics}_ESRIGRID) are the ESRIGRID raw-grid *download format* of the already-published Tellus geophysics rasters. The rendered raster products (985–988) correctly remain publish-new.

## Outputs
- `consolidated-dedupe-decisions.csv` — all 1,022 with finalDecision + source + reason
- `publish-new-backlog.json` — the 629 publish-new records as a conversion worklist
