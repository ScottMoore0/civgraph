# Item 10: Dependency Trimming

## Goal

Reduce shipped and parsed code by removing or replacing dependencies with poor startup ROI.

## Main drawbacks to watch

- engineering time spent for tiny savings
- replacement bugs
- hidden transitive usage missed during removal

## Atom sequence

### 10-A1: dependency usage inventory

Change:
- produce a real usage map for dependencies in startup and non-startup paths

Automated checks:
- inventory report created

Manual checks:
- none

Rollback:
- delete report

### 10-A2: rank by startup cost and replaceability

Change:
- sort candidates by measurable payoff, not intuition

Automated checks:
- ranking report produced

Manual checks:
- none

Rollback:
- delete report

### 10-A3: replace one low-risk candidate only

Change:
- remove or replace one dependency with the best ROI and lowest blast radius

Automated checks:
- build succeeds
- bundle diff shows savings
- usage/parity checks pass

Manual checks:
- user sanity-checks affected feature

Rollback:
- restore dependency

### 10-A4: stop if savings are marginal

Change:
- explicitly stop further trimming if measured savings are not worth complexity

Automated checks:
- record decision in task notes

Manual checks:
- none

Rollback:
- none

## Accept when

- measurable size/startup benefit exists
- functionality remains unchanged

