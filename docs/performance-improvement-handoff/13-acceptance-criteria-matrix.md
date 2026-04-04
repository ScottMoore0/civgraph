# Acceptance Criteria Matrix

This is a quick-reference summary. Use the per-item file for full detail.

## Item 01: Code-Splitting

- accept if:
  - startup JS falls materially
  - deferred chunks load reliably
  - user accepts first-open delay
- reject if:
  - startup JS rises materially
  - first-use breaks or repeated load errors appear

## Item 02: Web Workers

- accept if:
  - output parity is exact
  - measured heavy-path cost or responsiveness improves
- reject if:
  - worker path is slower without compensating UI gain
  - message overhead dominates

## Item 03: Critical-Path Payload Reduction

- accept if:
  - first-load bytes/blocking assets fall
  - visual quality remains acceptable
- reject if:
  - fonts/icons break
  - layout flash or visual drift becomes unacceptable

## Item 04: Precomputed Artifacts

- accept if:
  - artifact validates
  - fallback remains intact
  - artifact-backed result matches runtime result for the tested scope
- reject if:
  - stale or invalid artifact can silently win

## Item 05: Adaptive LOD And Chunking

- accept if:
  - source selection matches rules
  - map behavior improves without unacceptable fidelity loss
- reject if:
  - LOD churn or oversimplification is noticeable and unacceptable

## Item 06: Virtualization

- accept if:
  - node count falls materially
  - order, filtering, and identity remain correct
  - user sees no unacceptable scroll/focus/sticky issue
- reject if:
  - continuity, focus, or sticky behavior becomes unstable

## Item 07: Caching And Versioning

- accept if:
  - repeat loads improve
  - versioning is explicit
  - no stale/mixed-version issue is observed
- reject if:
  - cache invalidation becomes ambiguous

## Item 08: CSS Containment

- accept if:
  - target cost falls or stays cheaper in practice
  - sticky and measurement behavior remain correct
- reject if:
  - contained sections break layout assumptions

## Item 09: Interaction Batching

- accept if:
  - target path feels smoother or unchanged
  - stale updates do not occur
- reject if:
  - lag becomes noticeable

## Item 10: Dependency Trimming

- accept if:
  - savings are measurable
  - functionality is unchanged
- reject if:
  - engineering complexity exceeds measurable payoff

## Item 11: Image Pipeline

- accept if:
  - image bytes fall
  - quality remains acceptable
- reject if:
  - quality loss or layout shift is unacceptable

## Item 12: Performance Budgets

- accept if:
  - metrics are stable
  - regressions are caught without noisy false failures
- reject if:
  - checks are too noisy to trust

## Item 13: Combined Verification

- accept if:
  - accepted items still behave well together
- reject if:
  - combined regressions appear that were not visible in isolation

