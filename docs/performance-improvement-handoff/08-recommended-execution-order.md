# Recommended Execution Order

This is the safest default sequence, optimized for early ROI and low coordination risk.

## Phase 1: measurement and startup wins

1. Item `01` Code-Splitting
2. Item `03` Critical-Path Payload Reduction
3. Item `12` Performance Budgets, reporting-only setup for the metrics created by `01` and `03`

Reason:
- these give early startup wins
- they create visibility into bundle and asset cost
- they do not depend on workers or virtualization

## Phase 2: pure-runtime cost reduction

4. Item `04` Precomputed Artifacts
5. Item `02` Web Workers
6. Item `09` Interaction Batching

Reason:
- `04` often removes work entirely
- `02` moves unavoidable work off the main thread
- `09` smooths remaining hot paths

## Phase 3: large-surface optimization

7. Item `05` Adaptive LOD And Chunking
8. Item `06` Virtualization
9. Item `08` CSS Containment

Reason:
- these have higher UX/fidelity risk
- they benefit from earlier instrumentation and baseline work

## Phase 4: delivery and maintenance hardening

10. Item `07` Caching And Versioning
11. Item `10` Dependency Trimming
12. Item `11` Image Pipeline
13. Item `12` Performance Budgets, hard-enforcement phase
14. Item `13` Combined Verification

Reason:
- caching should come after assets/splits are more stable
- dependency trimming is easier once real hotspots are known
- image work is useful but lower ROI here than JS/data work
- combined verification belongs at the end of each accepted wave

## Dependency notes

- Item `12` should start early in reporting mode and finish late in enforcement mode.
- Item `13` is not one final step only; it can be rerun after any accepted cluster of changes.
- Item `07` should not be finalized before code-splitting and major asset-path changes settle.
- Item `06` and Item `08` should not be attempted together in one pass.
- Item `02` workerization should prefer functions made cleaner by Item `04` or earlier refactors.

## If a later agent wants the highest-confidence first atom

Start with:
- `01-A1`
- `01-A2`
- `03-A1`
- `03-A2`

These are mostly inventory/reporting atoms and reduce decision ambiguity for the rest.

