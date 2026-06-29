# Data Pipeline Inputs

This document lists review inputs that were formerly read from ignored `tasks/` files and are now reproducible from tracked sanitized inputs. Raw review exports and source mirrors remain local/private; public generators must read from `data/review-inputs/` unless a script is deliberately regenerating those sanitized inputs. Two large upstream corpora (`content-blocker-review-2026-06-24.csv`, `already-on-site-source-review-2026-06-24.csv`) are **git-ignored** — kept locally for regeneration but never committed, since they are only producer inputs and their derived outputs are tracked.

## Source Holdings To Back Up

- Private address-layer quarantine archive: contains the raw D-drive review CSV exports and the withheld sensitive row. Keep this archive backed up, but do not commit it.
- D-drive source mirror corpus: contains provider downloads, extracted source packages, and review workbooks used to create the raw review CSVs.
- Peatland Geoportal metadata audit: ArcGIS/Peatland Geoportal item metadata only; no geometry payloads are committed.

Do not commit raw local paths, address-granular fields, property-reference data, or the sensitive source row 555.

## Artifacts

| Tracked artifact | Producer | Raw/source input | Consumer |
|---|---|---|---|
| `data/review-inputs/already-on-site-enrichment-review-2026-06-24.csv` | `scripts/sanitize-review-inputs.mjs`, or `scripts/build-already-on-site-enrichment-review.mjs` from the tracked sanitized D-drive already-on-site review CSV | Raw already-on-site review export in the private address-layer quarantine archive; row 555 is withheld | `scripts/build-already-on-site-enrichment-records.mjs` |
| `data/review-inputs/already-on-site-source-review-2026-06-24.csv` _(local only — git-ignored)_ | `scripts/sanitize-review-inputs.mjs` | Raw already-on-site source-review export in the private address-layer quarantine archive; row 555 is withheld | `scripts/build-already-on-site-enrichment-review.mjs` |
| `data/review-inputs/content-blocker-review-2026-06-24.csv` _(local only — git-ignored)_ | `scripts/sanitize-review-inputs.mjs` | Raw content-blocker review export in the private address-layer quarantine archive; row 555 is withheld | `scripts/build-medium-priority-publication-prep.mjs`, `scripts/build-raw-source-document-records.mjs` |
| `data/review-inputs/medium-priority-publication-prep-2026-06-25/row-staging-records.json` | `scripts/build-medium-priority-publication-prep.mjs` | `data/review-inputs/d-drive-content-blocker-review-2026-06-24.csv` | `scripts/build-medium-priority-publication-sources.mjs` |
| `data/review-inputs/peatland-geoportal-duplicate-review-2026-06-25.csv` | `scripts/sanitize-review-inputs.mjs` from the local Peatland metadata audit CSV | Peatland Geoportal/ArcGIS item metadata audit; no feature geometry | `scripts/build-peatland-geoportal-sources.mjs` |
| `data/review-inputs/remaining-decision-packs-2026-06-27/already-on-site-review-rankings.json` | `scripts/sanitize-review-inputs.mjs` | Remaining decision-pack review output | `scripts/review-already-on-site-remaining.mjs` |
| `data/review-inputs/remaining-decision-packs-2026-06-27/licence-risk-review.json` | `scripts/sanitize-review-inputs.mjs` | Remaining decision-pack licence review output | `scripts/review-already-on-site-remaining.mjs` |
| `data/review-inputs/already-on-site-remaining-full-review-2026-06-27/reviewed-rows.json` | `scripts/review-already-on-site-remaining.mjs` | Already-on-site enrichment sidecar plus tracked decision-pack inputs | Approval extraction for `USER_APPROVED_REVIEW_ONLY_ROWS` and `STATUTORY_BOUNDARY_FAMILY_ROWS` |

## Regeneration

From a clean clone, use the tracked inputs directly:

```powershell
node scripts/build-already-on-site-enrichment-records.mjs
node scripts/build-peatland-geoportal-sources.mjs
node scripts/build-medium-priority-publication-sources.mjs
node scripts/build-raw-source-document-records.mjs
node scripts/build-browse-indexes.mjs
```

To rebuild tracked sanitized inputs from private raw exports, first restore the raw review exports from the private archive to a local path outside Git, then run `scripts/sanitize-review-inputs.mjs` for the relevant artifact. The sanitizer redacts local paths and rejects address/source-sensitive terms before writing tracked inputs.
