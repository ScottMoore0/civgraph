# Item 06: Virtualization

## Goal

Reduce DOM, layout, and paint cost for long lists and large tables by rendering only visible content.

## Main drawbacks to watch

- broken sticky headers
- broken keyboard navigation
- scroll jumps
- incorrect row/card identity under filtering or sorting

## Atom sequence

### 06-A1: heaviest surface inventory

Change:
- identify the worst DOM-heavy surfaces by rendered node count

Automated checks:
- inventory report created

Manual checks:
- none

Rollback:
- delete report

### 06-A2: choose one target surface only

Change:
- select a single list or table for the pilot

Automated checks:
- target scope documented

Manual checks:
- none

Rollback:
- none needed

### 06-A3: extract row/card identity contract

Change:
- codify keying, sort order, and filtering invariants before virtualization

Automated checks:
- invariant tests pass

Manual checks:
- none

Rollback:
- remove invariant tests

### 06-A4: hidden feature-flagged virtual renderer

Change:
- implement virtual rendering behind a flag without changing default behavior

Automated checks:
- virtual window calculations pass
- row/card identity preserved

Manual checks:
- none

Rollback:
- disable flag

### 06-A5: pilot enablement for one surface

Change:
- enable virtualization only for the chosen surface

Automated checks:
- rendered node count falls materially

Manual checks:
- scroll up/down
- filter/search
- keyboard navigation
- sticky/header behavior

Rollback:
- disable flag for that surface

### 06-A6: focus and sticky hardening

Change:
- patch only the specific issue found during manual testing

Automated checks:
- focus/sticky invariant tests added for the found issue

Manual checks:
- re-test the failing workflow

Rollback:
- revert the hardening patch if it causes wider regressions

## Accept when

- node count falls materially
- filtered and sorted content remains correct
- user reports no unacceptable scroll/focus/sticky regression

