# Item 05: Adaptive LOD And Chunking

## Goal

Make large-map loading adapt to device capability and zoom behavior without breaking map fidelity or existing fallbacks.

## Existing repo precedent

- `useLOD`
- `chunked`
- `chunkLoadConcurrency`

## Main drawbacks to watch

- oversimplified geometry
- visible LOD churn at threshold boundaries
- over-fetching on low zoom
- under-fetching detail on strong devices

## Atom sequence

### 05-A1: current large-map behavior inventory

Change:
- document current LOD/chunk settings by map family

Automated checks:
- inventory report generated

Manual checks:
- none

Rollback:
- delete report

### 05-A2: device capability signal design

Change:
- add read-only capability classification logic without changing selection behavior

Automated checks:
- classification outputs are deterministic for test inputs

Manual checks:
- none

Rollback:
- remove classifier

### 05-A3: source-selection truth table

Change:
- codify expected file/source selection by map id, zoom band, and device class

Automated checks:
- table-driven tests pass

Manual checks:
- none

Rollback:
- remove truth-table tests

### 05-A4: one-map adaptive threshold pilot

Change:
- enable adaptive thresholding for one safe map with existing assets only

Automated checks:
- selected source matches truth table
- fallback path still works

Manual checks:
- zoom in/out across boundaries
- fidelity remains acceptable

Rollback:
- disable pilot metadata

### 05-A5: preload radius tuning separate from detail tier

Change:
- adjust preload radius only, independent of geometry tier selection

Automated checks:
- viewport-chunk selection tests pass

Manual checks:
- initial and nearby navigation feel acceptable

Rollback:
- restore preload radius

### 05-A6: concurrency tuning separate from preload radius

Change:
- tune `chunkLoadConcurrency` for the pilot only

Automated checks:
- selection logic unchanged
- bounded concurrency tests pass

Manual checks:
- panning/zooming remains stable

Rollback:
- restore prior concurrency

### 05-A7: map-family expansion by evidence only

Change:
- expand to the next map only after prior pilot acceptance

Automated checks:
- same table-driven verification per map

Manual checks:
- same per-map fidelity check

Rollback:
- per-map metadata rollback

## Accept when

- chosen maps load and update more efficiently
- threshold transitions remain acceptable
- fidelity remains acceptable in the tested zoom ranges

