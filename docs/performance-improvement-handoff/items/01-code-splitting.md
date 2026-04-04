# Item 01: Code-Splitting

## Goal

Reduce startup parse, compile, and evaluation cost by deferring non-critical features until first use.

## Primary repo targets

- `js/app.js`
- `js/ui-controller.js`
- `js/election-controller.js`
- any table-only logic loaded at startup

## Main drawbacks to watch

- first-open delay for deferred features
- lazy-load failures due to import path mistakes
- duplicated shared code across chunks

## Atom sequence

### 01-A1: startup import inventory only

Change:
- produce a module graph and identify startup-critical vs deferrable imports

Automated checks:
- build still succeeds
- inventory report written

Manual checks:
- none required

Rollback:
- delete report only

### 01-A2: startup bundle size report

Change:
- add a script that records entry bundle sizes and chunk composition

Automated checks:
- report script runs
- output committed or saved to task notes

Manual checks:
- none required

Rollback:
- remove report script

### 01-A3: defer election bootstrap only

Change:
- lazy-load election bootstrap from `app.js`
- do not modify election internals yet

Automated checks:
- build succeeds
- startup bundle size falls
- deferred election chunk exists
- app imports still resolve

Manual checks:
- homepage loads normally
- first open of Elections tab works
- repeated Elections opens work

Rollback:
- restore eager import

### 01-A4: preload likely-next election chunk

Change:
- add conservative preload/prefetch for the election chunk only if justified by first-open latency

Automated checks:
- startup bundle does not absorb the deferred code again
- preload hint targets the correct chunk

Manual checks:
- first Elections open is acceptable
- homepage does not feel slower

Rollback:
- remove preload hint

### 01-A5: defer tables bootstrap only

Change:
- lazy-load table-specific code path

Automated checks:
- build succeeds
- startup bundle remains reduced
- deferred table chunk exists

Manual checks:
- Tables tab first open works
- table content remains correct

Rollback:
- restore eager import

### 01-A6: defer low-frequency catalogue detail helpers only

Change:
- lazy-load expensive detail helpers used only when opening heavy detail surfaces

Automated checks:
- build succeeds
- no unresolved dynamic imports

Manual checks:
- opening several detail views works
- no repeated loading errors

Rollback:
- restore eager path

### 01-A7: dedupe shared chunk boundaries

Change:
- tune split points to avoid unnecessary duplication across chunks

Automated checks:
- chunk size report shows no pathological duplication

Manual checks:
- deferred features still open correctly

Rollback:
- revert split tuning only

## Accept when

- startup JS is materially lower
- deferred features remain reliable
- first-open delay is acceptable to the user

