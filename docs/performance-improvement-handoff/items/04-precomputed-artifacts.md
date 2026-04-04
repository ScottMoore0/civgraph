# Item 04: Precomputed Artifacts

## Goal

Replace expensive runtime derivation with additive validated build outputs where inputs are stable.

## Existing repo precedent

- local-election `_bundle.json`
- local-election `_aggregates.json`

## Main drawbacks to watch

- stale artifacts
- schema drift
- more build complexity

## Atom sequence

### 04-A1: candidate derivation inventory

Change:
- identify runtime-derived views that are stable and expensive

Automated checks:
- inventory report created

Manual checks:
- none

Rollback:
- delete report

### 04-A2: choose one candidate and define artifact schema

Change:
- document exact input, output, and validation rules

Automated checks:
- schema validation script runs against sample output

Manual checks:
- none

Rollback:
- remove schema doc/script

### 04-A3: build additive artifact only

Change:
- emit new artifact without changing runtime consumption

Automated checks:
- artifact exists
- artifact validates

Manual checks:
- none

Rollback:
- stop emitting artifact

### 04-A4: add runtime validator and fallback path

Change:
- runtime may read artifact only after validation; fallback remains default-safe

Automated checks:
- valid artifact path works
- invalid artifact path falls back
- missing artifact path falls back

Manual checks:
- affected view still looks correct

Rollback:
- disable artifact consumption

### 04-A5: parity test for one real sample

Change:
- compare runtime-derived output vs artifact-backed output

Automated checks:
- parity report passes

Manual checks:
- affected view feels at least as good

Rollback:
- disable artifact preference

### 04-A6: roll out to one data family only

Change:
- enable for a narrow family, not globally

Automated checks:
- scope-limited validation passes

Manual checks:
- sample family behaves correctly

Rollback:
- narrow-scope config rollback

## Accept when

- runtime CPU/work falls for the chosen path
- artifacts validate
- fallback remains intact

