# Start Here

This file is for the next agent. Read this first.

## Objective

Carry out the performance improvements in this package safely:

- one numbered item at a time
- one atom at a time
- automated non-browser checks first
- user manual browser checks second

## Do not do these first

- do not start with workers
- do not start with virtualization
- do not start with caching changes
- do not batch multiple numbered items into one patch
- do not remove fallback paths early

## Read in this order

1. `README.md`
2. `00-execution-protocol.md`
3. `12-first-wave-starter-pack.md`
4. `13-acceptance-criteria-matrix.md`
5. the specific item file you are about to execute

Use as-needed:

- `02-repo-hotspots.md`
- `09-file-touch-matrix.md`
- `14-known-constraints-and-non-goals.md`
- `11-glossary.md`

## First commands to run

Run these from repo root:

```powershell
node docs/performance-improvement-handoff/scripts/report-bundle-sizes.mjs
node docs/performance-improvement-handoff/scripts/report-startup-imports.mjs
node docs/performance-improvement-handoff/scripts/report-first-load-assets.mjs
node docs/performance-improvement-handoff/scripts/report-font-usage.mjs
```

Then read the current baselines in:

- `reports/current-state-summary.md`
- `reports/bundle-size-report.txt`
- `reports/startup-import-report.txt`
- `reports/first-load-asset-report.txt`
- `reports/font-usage-report.txt`

## Best first atom

Start with:

- `01-A1` startup import inventory only

Then:

- `01-A2` startup bundle size report

Then:

- `03-A1` first-load asset inventory
- `03-A2` font usage inventory

Only after those are accepted should you consider behavior-changing atoms.

## Working rules

- keep each change additive where possible
- keep rollback easy
- prefer config-only rollout when available
- record evidence in `tasks/todo.md`
- if the user reports a correction, update `tasks/lessons.md`

## If you are unsure what to touch

Check:

- `02-repo-hotspots.md`
- `09-file-touch-matrix.md`

## If you need a worksheet

Use:

- `04-atom-worksheet-template.md`
- `05-decision-log-template.md`
- `06-risk-register-template.md`
- `07-manual-test-report-template.md`

## Definition of a good first session

- no broad refactors
- no user-visible regressions
- at least one new objective report or baseline artifact
- clearer evidence for the next atom than existed before you started

