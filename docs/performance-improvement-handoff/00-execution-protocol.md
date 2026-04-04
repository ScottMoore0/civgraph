# Execution Protocol

## Objective

Deliver performance improvements with small, reversible, low-blast-radius changes.

## Required sequence for every atom

1. Confirm the target atom and leave all later atoms untouched.
2. Capture the pre-change baseline from `01-metrics-and-thresholds.md`.
3. Implement the atom behind the safest possible guard:
   - additive file
   - lazy path
   - config flag
   - fallback branch
4. Run automated non-browser checks.
5. Compare before vs after metrics.
6. If objective checks are acceptable, hand off the manual checklist to the user.
7. Accept or roll back.
8. Update `tasks/todo.md` with:
   - what changed
   - what was measured
   - what passed
   - what remains

## Risk controls

- Never mix refactor and tuning in the same atom.
- Never mix measurement setup and broad rollout in the same atom.
- Never remove an old path until the new path has passed parity and manual checks.
- For map/data changes, keep existing source files as authoritative fallback unless explicitly retiring them in a later, separate task.
- For caching and worker changes, assume rollback may be needed and design for it up front.

## Acceptance gates

An atom is accepted only if all of the following are true:

- functional parity holds for the intended scope
- no automated non-browser check fails
- no protected metric crosses its reject threshold
- the user reports no unacceptable UX or fidelity regression

## Reject conditions

Reject the atom if any of the following occurs:

- bundle size rises without a corresponding, intentional benefit
- time or memory cost rises above the defined tolerance
- a fallback path stops working
- lazy-loading creates broken first-use behavior
- map fidelity visibly degrades outside the agreed zoom range
- cache invalidation becomes ambiguous
- manual testing finds lag, flashing, broken focus, or layout drift

## Rollback rules

- Prefer metadata/config rollback over code removal.
- If rollback cannot be config-only, keep the rollback patch minimal and immediate.
- Do not continue to the next atom while a known regression remains unresolved.

## Evidence format to record after every accepted atom

- atom id
- files changed
- automated checks run
- before metrics
- after metrics
- user manual result
- rollback mechanism
- follow-up notes

