# Item 13: Combined Verification

## Goal

Verify that accepted improvements still behave well together after multiple items have landed.

## Main drawbacks to watch

- cross-effect regressions
- combined startup regressions
- chunk/cache/worker interactions
- hidden manual-only regressions

## Atom sequence

### 13-A1: combined baseline report

Change:
- capture an aggregate summary of accepted item metrics so far

Automated checks:
- combined report generated

Manual checks:
- none

Rollback:
- regenerate report

### 13-A2: compatibility matrix

Change:
- document which accepted items can interact and what must be rechecked when they do

Automated checks:
- matrix file updated

Manual checks:
- none

Rollback:
- revise matrix

### 13-A3: combined build and artifact consistency checks

Change:
- run all non-browser automated checks relevant to the accepted items together

Automated checks:
- build passes
- artifact validations pass
- bundle/budget reports pass

Manual checks:
- none

Rollback:
- roll back the most recent conflicting item first

### 13-A4: combined manual smoke checklist

Change:
- user manually re-checks:
  - initial load
  - Elections first open
  - Tables first open
  - one large map load
  - one large map pan/zoom cycle
  - one long table/list scroll
  - one reload/update check if caching changed

Automated checks:
- none

Manual checks:
- required

Rollback:
- revert the newest change that introduced the combined regression

### 13-A5: freeze and document new baseline

Change:
- after combined acceptance, record the new baseline for future work

Automated checks:
- reports saved

Manual checks:
- none

Rollback:
- update baseline after rollback if needed

## Accept when

- accepted items continue to pass together
- no combined regression is found in manual smoke testing

