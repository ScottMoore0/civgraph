# Medium-Priority Publication Prep

Generated: 2026-06-25T01:53:52.500Z

This pack stages the five approved medium-priority D-drive queues for later Civgraph publication. It does **not** publish new website records, upload to IA/R2/CDN, or create runtime catalogue entries.

## Counts

| Queue | Rows |
|---|---:|
| Local authority planning/property/open-data layers | 1638 |
| Authoritative boundary variants from Tailte/OSI/Open Data NI/NISRA | 270 |
| Irish election source/enrichment data | 176 |
| Transport, roads, infrastructure, public assets | 170 |
| Open Data NI boundary and statistical-geography files | 93 |

Total rows: 2347

## Proposed Actions

| Action | Rows |
|---|---:|
| local-authority-batch-review | 1471 |
| hold-special-format | 288 |
| transport-public-asset-batch-review | 168 |
| source-download-only | 118 |
| enrich-existing-election | 96 |
| enrich-existing-source | 95 |
| variant-child-map | 67 |
| new-interactive-map | 44 |

Rows ready for approval without residual blockers: 1121

Rows still needing residual review: 1226

Batch review bundles: 45

## Outputs

- `row-staging-records.csv/json`: all cleaned staging records.
- `batch-review-bundles.csv/json`: approval bundles grouped by provider/topic/action.
- `election-enrichment-prep.csv/json`: election source/enrichment staging.
- `boundary-variant-prep.csv/json`: Tailte/OSI/Open Data NI/NISRA boundary variant staging.
- `local-authority-planning-property-prep.csv/json`: council/provider local authority staging.
- `transport-public-assets-prep.csv/json`: transport/infrastructure/public asset staging.
- `conversion-plan.csv/json`: rows needing PMTiles/vector/runtime or special-format decisions.
- `residual-blocker-review.csv/json`: rows that still need manual review after deterministic staging.
- `source-provenance-drafts.csv/json`: source-page/provenance drafts.
- `validation-report.json`: generation checks.

## Current Recommendation

Use these outputs as an approval pack. Approve at the batch level where possible; only after approval should a separate publication step write public Browse/catalogue/runtime records or upload raw/derived assets to IA/R2/CDN.
