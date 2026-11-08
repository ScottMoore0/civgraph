# LANDING: r3-mapapp (refactor round 3, part 2 of the tightening)

Branch `r3-mapapp`, worktree `C:\Users\scomo\civgraph-r3-mapapp`, on main c334a79abc (main had not moved at the end).
Owned: `src/`, `app/src/`, `app/js/` (jquery-shim), `packages/core/`. Nothing pushed, published, uploaded or deployed. No Co-Authored-By trailers.

## Commits (oldest first)

| Commit | What |
|---|---|
| 55e058dd0e | `check:types:mapapp` turns `strictNullChecks` on (`src/tsconfig.check.json`). The 118 findings are fixed without `@ts-ignore`, `@ts-expect-error` or any-casts. The election models' loose records are typed in `packages/core/src/election-view-model.mjs`: `ElectionRecord` (an entry or bundle, with the fields the models read, and the rest readable as unknown), `ElectionResult` (open record, `countInfo` and `candidates` typed) and `ElectionContext` (bundle, entry, previousBundle). The models that destructure `{ previousBundle = null }` now use a typed null default (`/** @type {ElectionRecord | null} */ (null)`), which narrowed to never before. Other fixes: typed `@param`s in results-model, palette, the renderer and the main-pane contract; the census overlay's `decimals` default, crosswalk and class groups; a type predicate on results-model's seat filter; a typed state object in the trend chart. Where the chart used a value as present (its svg and crosshair), the new `present(value, what)` in `src/map/state-helpers.mjs` returns it or throws a TypeError at the same statement, as reading a property of null did before. The stage and legend take the same cast the tooltip already had, because the markup just above creates them. `tests/unit/map-typecheck.test.mjs` gains a test that fails if a strict flag (strictNullChecks among them) is turned off or inherited. |
| 9b92985286 | MA-L, the remaining items. **DOM hidden toggles:** all 39 `x.hidden = ...` writes in `src/` (catalogue index/edit/slider, timeline changes/controls, messages, mobile peek, sources, the trend tooltip, the toast in renderer/utils, the map labels in map-controller, and ui-controller) and the performance dashboard's `setAttribute('hidden', '')` go through `setHidden(node, hidden)` in `state-helpers.mjs`. It throws for a value that is not a boolean, which would have been coerced before. Every value set today is a boolean, and a missing element throws as the assignment did. `app/src/` had none. **jquery-shim:** `_shimQueueRunning` in `src/jquery-shim.js` and its `app/js/` copy (classic scripts) is written only through `_setQueueRunning` and an inline `QUEUE_RUNNING_TRANSITIONS` table (the flag table). New tests: `tests/unit/jquery-shim-queue.test.mjs` checks the table against `createFlag` for every pair and that both copies agree, then drives delay, the end of the queue and stop(true) in a vm page. `tests/unit/map-state-helpers-r3.test.mjs` tests setHidden and present, and fails on any direct hidden write in `src/` or `app/src/`. |

Readers see no change. The only runtime differences are reachable only on bad input: a non-boolean hidden value now throws, and a missing chart svg or crosshair throws a TypeError with a named message instead of the engine's message, at the same statement.

`src/map/app/retire-legacy-workers.mjs` is untouched and still imports nothing.

## Landing steps

1. Merge. package.json, CHECKS.md and the CI files are untouched. The tsconfig change is `src/tsconfig.check.json` only. The two new test files are picked up by the existing `tests/unit/*.test.mjs` glob.
2. Regenerate with `npm run build`. It rebuilds the app bundle (which now bundles `setHidden` and `present`) and re-stamps `sw.js` VERSION and the `maps/index.html` and `maps/classic/index.html` tokens. Those files are not committed here, as in r2. `app/js/jquery-shim.js` is committed in step with `src/jquery-shim.js`; the build's copy step re-copies it. The one-space whitespace difference on line 4 is older than this branch.
3. No records build, no D1 migration, no R2 upload, nothing for the owner.

## Tests run (on the branch, after `npm run build`)

- `npm run test:unit`: 449 tests, 445 pass, 0 fail (the rest are skipped, as on main). That includes the 4 tests of map-typecheck, the 3 of jquery-shim-queue and the 4 of map-state-helpers-r3.
- `check:types:mapapp`: 0 errors with strictNullChecks on.
- `npm run check:fast`: CHECKS OK, 75 steps. The worktree needs copies of tmp/records `elections*`, `election-provenance*` and `browse/`, plus `node scripts/build/shell-assets.mjs` and `npm run build`.
- Browser: test:browser:maps plus app.spec.js on port 5050, 75 tests. **74 passed and 1 failed:** app.spec "election party and person links open full catalogue details only" ("No record of FF was found."). It fails the same way alone on main c334a79abc, built in this worktree, so it is environmental (the party record is not in the copied data) and not a regression. retired-service-worker passed.
- `npm run check:clean` (once, at the end, on the final branch): CLEAN-EXPORT CHECKS OK, 75 steps.

## Files others may touch

- `src/map/state-helpers.mjs`: new exports `setHidden` and `present`.
- `packages/core/src/election-view-model.mjs`: new JSDoc typedefs `ElectionRecord`, `ElectionResult` and `ElectionContext`, plus @param types. There is no runtime change. They could move to `packages/types/hand/core.d.ts` when its owner wants them shared.
- `src/jquery-shim.js` and `app/js/jquery-shim.js`: the table literal must stay on one line (the test reads it with a one-line regex, as the sw.js test does).

## Left

- `noImplicitAny` is still off in check:types:mapapp (about 830 findings). The method modules of `src/map/app/` and `ui-controller.js` still need a typed app interface before they can join the checked set.
- The trend chart's label `mode` and `map-image-export.js`'s mode stay as they are. Both read the styling mode and are not state, as r2 noted.
