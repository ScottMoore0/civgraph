# Item 08: CSS Containment

## Goal

Reduce layout and paint work for offscreen or isolated UI sections.

## Main drawbacks to watch

- sticky breakage
- bad measurements for autosized UI
- hidden-but-needed layout work no longer happening

## Atom sequence

### 08-A1: identify high-cost layout surfaces

Change:
- list candidate panes/sections safe for containment experiments

Automated checks:
- inventory report created

Manual checks:
- none

Rollback:
- delete report

### 08-A2: add one safe `content-visibility` pilot

Change:
- apply `content-visibility: auto` to one offscreen-friendly section only

Automated checks:
- stylesheet/build checks pass

Manual checks:
- section renders correctly when brought onscreen

Rollback:
- remove rule

### 08-A3: add one safe `contain` pilot

Change:
- apply containment to one truly bounded section only

Automated checks:
- affected class application test passes

Manual checks:
- sticky elements still behave
- sizing still looks correct

Rollback:
- remove rule

### 08-A4: harden measurement-dependent scripts if needed

Change:
- patch scripts that assume immediate layout on contained sections

Automated checks:
- script-level tests for the affected helper pass

Manual checks:
- affected section rechecked

Rollback:
- revert hardening patch or containment rule, whichever is safer

## Accept when

- targeted layout/paint work falls or stays cheaper in practice
- no sticky or measurement regression remains

