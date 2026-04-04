# Item 12: Performance Budgets

## Goal

Prevent regressions after the higher-ROI improvements land.

## Main drawbacks to watch

- noisy failures
- thresholds that are too loose to matter or too strict to be useful

## Atom sequence

### 12-A1: capture current baselines

Change:
- record current bundle, asset, and benchmark baselines

Automated checks:
- baseline report generated

Manual checks:
- none

Rollback:
- regenerate baseline if needed

### 12-A2: choose a minimal budget set

Change:
- define a small set of high-signal thresholds only

Automated checks:
- budget config parses

Manual checks:
- none

Rollback:
- revise thresholds

### 12-A3: reporting-only budget enforcement

Change:
- emit warnings or reports without failing local workflow yet

Automated checks:
- report emitted on demand

Manual checks:
- none

Rollback:
- disable report

### 12-A4: stabilize noise sources

Change:
- fix or remove flaky measurements before hard enforcement

Automated checks:
- repeated runs remain stable enough

Manual checks:
- none

Rollback:
- revert noisy metric from budget scope

### 12-A5: hard enforcement only for stable metrics

Change:
- fail checks only for stable, high-signal thresholds

Automated checks:
- enforcement triggers on deliberate regression

Manual checks:
- none

Rollback:
- downgrade noisy budget back to reporting-only

## Accept when

- budgets catch obvious regressions
- false positives remain low enough to trust

