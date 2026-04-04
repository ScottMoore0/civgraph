# Performance Improvement Handoff

This folder is the execution package for performance items `1` through `13`.

It is designed for a one-item-at-a-time workflow:

1. take one item only
2. implement one atom only
3. run automated non-browser tests first
4. review objective metrics and diffs
5. run manual browser tests
6. accept, tune, or roll back
7. move to the next atom only after acceptance

## Contents

- `START-HERE.md`
- `00-execution-protocol.md`
- `01-metrics-and-thresholds.md`
- `02-repo-hotspots.md`
- `03-command-catalog.md`
- `04-atom-worksheet-template.md`
- `05-decision-log-template.md`
- `06-risk-register-template.md`
- `07-manual-test-report-template.md`
- `08-recommended-execution-order.md`
- `09-file-touch-matrix.md`
- `10-non-browser-test-script-specs.md`
- `11-glossary.md`
- `12-first-wave-starter-pack.md`
- `13-acceptance-criteria-matrix.md`
- `14-known-constraints-and-non-goals.md`
- `15-script-backlog-checklist.md`
- `scripts/README.md`
- `scripts/report-bundle-sizes.mjs`
- `scripts/report-startup-imports.mjs`
- `scripts/report-first-load-assets.mjs`
- `scripts/report-font-usage.mjs`
- `scripts/report-map-performance-metadata.mjs`
- `scripts/report-dependency-usage.mjs`
- `scripts/run-first-wave.mjs`
- `scripts/templates/benchmark-template.mjs`
- `scripts/templates/validator-template.mjs`
- `reports/current-state-summary.md`
- `reports/bundle-size-report.txt`
- `reports/bundle-size-report.json`
- `reports/startup-import-report.txt`
- `reports/startup-import-report.json`
- `reports/first-load-asset-report.txt`
- `reports/first-load-asset-report.json`
- `reports/font-usage-report.txt`
- `reports/font-usage-report.json`
- `reports/map-performance-metadata-report.txt`
- `reports/map-performance-metadata-report.json`
- `reports/dependency-usage-report.txt`
- `reports/dependency-usage-report.json`
- `items/index.json`
- `state/current-status.json`
- `state/next-actions.json`
- `manifest.json`
- `items/01-code-splitting.md`
- `items/02-web-workers.md`
- `items/03-critical-path-payload.md`
- `items/04-precomputed-artifacts.md`
- `items/05-adaptive-lod-and-chunking.md`
- `items/06-virtualization.md`
- `items/07-caching-and-versioning.md`
- `items/08-css-containment.md`
- `items/09-interaction-batching.md`
- `items/10-dependency-trimming.md`
- `items/11-image-pipeline.md`
- `items/12-performance-budgets.md`
- `items/13-combined-verification.md`

## Repo-specific context already present

- Large-map optimization already exists in metadata and runtime:
  - `useLOD`
  - `chunked`
  - `chunkLoadConcurrency`
- Local-election precomputation already exists:
  - `_bundle.json`
  - `_aggregates.json`
- Existing runtime timing hooks already exist in `js/map-controller.js`
- Existing lazy image loading already exists in `js/ui-controller.js`
- Existing service-worker handling already exists in `js/app.js`

This means later agents should prefer additive extension of existing mechanisms, not greenfield replacement.

## Operating rules

- Do not execute more than one numbered item at once.
- Within an item, do not execute more than one atom at once.
- Prefer additive paths plus fallback over replacement.
- Add objective automated checks before broad rollout.
- Keep rollback config-only where possible.
- Record evidence after every accepted atom.
- If an atom exposes a new drawback, stop and re-plan before the next atom.

## Definition of done for an atom

- implementation completed
- automated non-browser checks passed
- before/after metrics captured
- manual test checklist completed by the user
- rollback path documented
- task ledger updated

## What the supplemental files are for

- `START-HERE.md`
  - the fastest safe entrypoint for a later agent
- `02-repo-hotspots.md`
  - fast orientation for likely high-ROI edit points in this repo
- `03-command-catalog.md`
  - repeatable non-browser verification commands and what they prove
- `04-atom-worksheet-template.md`
  - a copyable execution record for a single atom
- `05-decision-log-template.md`
  - a structured record for keeping or rejecting tradeoffs
- `06-risk-register-template.md`
  - a structured way to track new risks discovered during rollout
- `07-manual-test-report-template.md`
  - a consistent handoff format for the user's manual test results
- `08-recommended-execution-order.md`
  - the safest recommended sequencing and dependency notes across items
- `09-file-touch-matrix.md`
  - likely file-entry points per item, so exploration starts in the right place
- `10-non-browser-test-script-specs.md`
  - concrete script/report ideas to build the automated first-check layer
- `11-glossary.md`
  - repo-specific and plan-specific terms for faster orientation
- `12-first-wave-starter-pack.md`
  - the most sensible first atoms and what order to execute them in
- `13-acceptance-criteria-matrix.md`
  - quick pass/reject criteria by item without rereading every file
- `14-known-constraints-and-non-goals.md`
  - boundaries that should prevent wasted work or overreach
- `15-script-backlog-checklist.md`
  - a concrete staged backlog for the first non-browser automation scripts
- `scripts/`
  - runnable handoff-local reporting scripts for the first automated verification wave
- `scripts/run-first-wave.mjs`
  - one-command refresh of the highest-priority first-wave text reports
- `scripts/templates/`
  - starter templates for later benchmark and validator scripts
- `reports/`
  - current baseline outputs generated from the handoff-local scripts for this repo state
- `items/index.json`
  - machine-readable summary of the numbered items and their first atoms
- `state/current-status.json`
  - machine-readable current recommendation and package status
- `state/next-actions.json`
  - machine-readable ordered next-step queue for the safest initial wave
- `manifest.json`
  - machine-readable index of the handoff package contents
