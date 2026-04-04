# Known Constraints And Non-Goals

This file exists to stop later agents from wasting time or overreaching.

## Constraints

- The preferred verification model is:
  - automated non-browser checks first
  - user manual browser checks second
- The user does not want browser automation to be the primary validation path for this work.
- Improvements should be delivered one item at a time.
- Within an item, changes should be broken into small atoms.
- Existing repo mechanisms should be extended additively where possible.
- Existing fallbacks should be preserved until a later, separate retirement step is justified.

## Non-goals

- not a greenfield rewrite of the app architecture
- not a simultaneous multi-item performance branch
- not perfection claims such as "no drawbacks whatsoever"
- not global enablement of optimizations before pilot evidence exists
- not replacing measured tradeoff decisions with intuition

## Anti-patterns to avoid

- broad refactors hidden inside a performance task
- enabling caching changes before asset/version paths stabilize
- bundling virtualization and containment together in one patch
- workerizing code that still depends on DOM or unstable shared mutable state
- removing fallback data or runtime paths too early
- widening scope because an adjacent issue was noticed

## Preferred patterns

- metadata-driven rollout
- additive artifacts
- pilot-first deployment
- narrow benchmarks
- narrow validators
- explicit rollback conditions

