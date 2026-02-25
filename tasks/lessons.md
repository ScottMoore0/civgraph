# Lessons Log

## 2026-02-23

### 1) Always verify chunk manifest paths against real files
- Mistake pattern: Treated Townlands chunked loading as valid without revalidating manifest-to-file mapping.
- Impact: Immediate map-load failure (`Failed to load ... after 0.0s`).
- Guardrail: Before enabling `chunked: true` for any map, run a path-existence check for every `chunks[].file` and `zoomFiles.*.file`.

### 2) Point selection logic must be layer-capability based
- Mistake pattern: Point-hit logic depended too narrowly on geometry type string.
- Impact: Historic point feature double-click/click selection failed for some point-like layer cases.
- Guardrail: Use `layer.getLatLng()` as the primary point-layer capability check and pixel-distance hit tests.

### 3) Pause/play controls need a single robust interaction contract
- Mistake pattern: Pause/play UI state drifted between icon classes and mode/state logic.
- Impact: Button appeared stuck or non-responsive after pause.
- Guardrail: Keep explicit, deterministic icon-state transitions in click handler and validate pause->play->resume behavior after each change.

### 4) AGENTS.md process rules are mandatory, not optional
- Mistake pattern: Did not keep `tasks/lessons.md` updated after user corrections.
- Impact: Repeated regression classes were not captured promptly.
- Guardrail: After every user correction, append/update `tasks/lessons.md` in the same working pass before marking task complete.

### 5) Maintain a single canonical task ledger
- Mistake pattern: Split task tracking across `TASKS.md` and `tasks/todo.md`.
- Impact: Process drift and stale plans, violating AGENTS requirements.
- Guardrail: Keep all active and historical task tracking in `tasks/todo.md` only; keep `TASKS.md` as a deprecation pointer only.

### 6) Validate by workflow path, not only by helper function intent
- Mistake pattern: A fix looked correct in isolated logic, but the actual UI workflow still regressed.
- Impact: Load/unload and pause/play issues reappeared despite prior targeted edits.
- Guardrail: Validate full user interaction paths (click -> callback -> state refresh -> icon swap) and add explicit state synchronization where UI wiring has multiple entry points.

### 7) Group maps need aggregate loaded-state semantics
- Mistake pattern: Button state checks used only direct map id loaded state.
- Impact: Group entries remained on `+` and behaved like load-only controls.
- Guardrail: Centralize and always use group-aware loaded-state checks (members/variants) for any UI toggle icon logic.

### 8) Validate Git object content for static-hosted binaries
- Mistake pattern: Verified only working-tree binary bytes and assumed deployment would serve the same content.
- Impact: Townlands chunked loading failed because Git history contained LFS pointer blobs for chunk files.
- Guardrail: For statically served binary assets, always verify committed blobs (`git cat-file -p HEAD:path`) are real binary content, not LFS pointers.

### 9) Never re-render catalogue cards with empty loaded-state inputs
- Mistake pattern: Flat catalogue rendering path rebuilt cards with `loadedIds: []`, desynchronizing button state from real map state.
- Impact: Load buttons reverted to `+` after successful loads and did not behave as reliable load/unload toggles.
- Guardrail: Persist last render options and centralize loaded-state checks in one resolver used by all map-entry renderers.

### 10) Use a root-cause pass for recurring or opaque bugs
- Mistake pattern: Fixing symptoms before proving where runtime actually fails.
- Impact: Regressions reappear and confidence stays low.
- Guardrail: Follow this sequence every time:
  1) trace end-to-end runtime path,
  2) identify first concrete mismatch/failure point,
  3) prove with direct evidence (logs/object/file checks),
  4) fix at source-of-truth layer,
  5) run targeted verification,
  6) record prevention guardrail in `tasks/lessons.md` and task evidence in `tasks/todo.md`.

### 11) For map feature selection, combine event-path and geometric fallback
- Mistake pattern: Relying on a single event path (layer dblclick or map hit-test only) for point feature selection.
- Impact: Feature cards intermittently fail to open when event propagation or click precision varies.
- Guardrail: Keep both:
  - direct layer dblclick selection dispatch, and
  - map-level nearest-point fallback with bounded pixel thresholds.

### 12) Query live rendered layers, not stale layer snapshots
- Mistake pattern: Feature hit-testing used `state.geoJsonLayers` only, which can drift from the actual rendered layer tree after dynamic add/remove paths.
- Impact: Point double-click selection appeared to fail even when points were visibly rendered.
- Guardrail: Traverse the live `state.group` layer graph recursively for selection/hit-testing; keep `geoJsonLayers` as bookkeeping only, not as the sole interaction source-of-truth.

### 13) Never depend solely on native `dblclick` for feature selection
- Mistake pattern: Assumed Leaflet native `dblclick` always fires for point interactions across renderer/browser combinations.
- Impact: Users can double-click visible point features and still get no feature card.
- Guardrail: Keep native `dblclick` support, but add deterministic synthetic double-click detection from two rapid map `click` events (time + pixel-distance bounded) and route both to one selection handler.

### 14) For point features, use click as the primary selection event
- Mistake pattern: Treating point-feature selection as a dblclick-first interaction.
- Impact: Real users can hover a visible point and still fail to open the feature card due to dblclick propagation variability.
- Guardrail: Point features must select on single `click` (primary), with `dblclick` only as secondary compatibility path, plus dedupe to avoid duplicate emits.

### 15) Point-picking tolerances must be zoom-adaptive
- Mistake pattern: Using fixed pixel thresholds for point hit detection and click-pair recognition.
- Impact: Selection works when zoomed in but fails intermittently when zoomed out.
- Guardrail: Derive hit thresholds from current zoom (with bounded min/max), and apply the same principle to nearest-point fallback and synthetic dblclick distance windows.

### 16) Keep a map-click selection fallback active for point features
- Mistake pattern: Relying primarily on dblclick/click-pair event paths for point selection.
- Impact: Some zoom/renderer/input combinations still miss feature selection.
- Guardrail: Execute point hit-testing on map click as a baseline fallback, and use dedupe in emit path to prevent duplicate panel renders.

### 17) Hover and selection logic must share the same effective tolerance
- Mistake pattern: Hover highlight and selection each used separate thresholds/sources.
- Impact: A point can visibly highlight (orange) but fail to open feature details on user interaction.
- Guardrail: Track the active hovered point and use it as a bounded fallback candidate in selection flow so highlighted points remain selectable.

### 18) Resolve selection from hover state before geometric fallback
- Mistake pattern: Running generic nearest-feature hit-testing before honoring explicit hovered-point context.
- Impact: At low zoom, hover-highlighted target can be dropped or replaced by tolerance/event drift.
- Guardrail: In click/dblclick handling, first attempt selection from active/recent hovered point candidate; only then run general geometric hit-testing.

### 19) Add capture-phase fallback when event-target dispatch is unreliable
- Mistake pattern: Assuming Leaflet layer/map dblclick handlers always receive low-zoom pointer interactions.
- Impact: Hover-highlighted points can still fail to open feature cards despite visible hover state.
- Guardrail: Add a capture-phase map-container dblclick handler that resolves selection from hover candidate and routes through one emit path with dedupe.

### 20) Never let active hover selection expire while hover style is still visible
- Mistake pattern: Time-expiring active hover candidate while orange-highlight UI remains active.
- Impact: User sees a hovered point but selection rejects it, especially after a short delay at low zoom.
- Guardrail: Active hover must be proximity-gated, not time-gated. Only post-hover fallback memory should use timeout windows.

### 21) Do not apply a second geometric gate to active hover selection
- Mistake pattern: Re-checking active hovered feature with separate click-distance thresholds.
- Impact: A point can be visibly orange-hovered but still fail selection, especially zoomed out.
- Guardrail: Active hover selection must be identity-based (exact hovered layer/feature) with no additional distance/time gate; only `last hovered` fallback may be bounded.

### 22) Add mouseout grace for active hover in low-zoom interactions
- Mistake pattern: Clearing active hover immediately on `mouseout`, even during dblclick jitter.
- Impact: Selection path drops from active-hover identity to stricter fallback between clicks.
- Guardrail: Keep active hover candidate alive for a short grace window after `mouseout`; expire lazily in selection resolver.

### 23) Use rendered highlighted-layer set as dblclick selection source-of-truth
- Mistake pattern: Deriving selection only from candidate snapshots while visual hover state is renderer-driven.
- Impact: User sees orange-highlighted point but selection can still miss under low-zoom jitter.
- Guardrail: Maintain an explicit set of currently orange-highlighted point layers and make dblclick selection resolve from that set first.

### 24) Use one shared resolver for hover and selection
- Mistake pattern: Letting hover and selection each compute targets via different event/state paths.
- Impact: Visual hover can disagree with dblclick selection at low zoom.
- Guardrail: Keep a single point-under-cursor resolver, drive hover from it on `mousemove`, and select from the same current-hover source on click/dblclick.

### 25) Do not leave legacy interaction pipelines active after V2 cutover
- Mistake pattern: Shipping new hover/selection logic while old layer/map handlers still execute.
- Impact: Event-path races and recurring regressions despite targeted fixes.
- Guardrail: Use a feature flag and explicitly disable legacy point-selection handlers when V2 is active; keep one deterministic dblclick entrypoint.

### 26) Never rely solely on native `dblclick` delivery for point selection
- Mistake pattern: Assuming browser/native dblclick events always fire for low-zoom map interactions.
- Impact: Point feature-card opening can still fail intermittently even with correct resolver logic.
- Guardrail: Add a synthetic click-pair fallback that routes to the same selection entrypoint as native dblclick.

### 27) Don’t block synthetic dblclick on `MouseEvent.detail`
- Mistake pattern: Returning early when `evt.detail >= 2` inside click-pair logic.
- Impact: The synthetic fallback skips exactly the second click needed to detect double-click, reintroducing native-dblclick dependence.
- Guardrail: Let click-pair logic process second clicks; use emit-level dedupe for duplicate suppression instead.

### 28) Back up click-pair fallback with pointerup-pair fallback
- Mistake pattern: Assuming `click` events are always emitted even under low-zoom jitter/drag-threshold behavior.
- Impact: Synthetic dblclick fallback can still miss when click/dblclick events are suppressed.
- Guardrail: Add capture-phase pointerup pair detection routed to the same selection resolver, and keep mouseleave reset for pair state.

### 29) Keep native and synthetic trigger paths behaviorally identical
- Mistake pattern: Applying richer fallback logic on native dblclick path than on synthetic pair paths.
- Impact: Selection success depends on which trigger event fires, causing intermittent regressions.
- Guardrail: Route all trigger types through a single full resolver function with identical fallback order.

### 30) Collapse recurring interaction bugs to one instrumented contract
- Mistake pattern: Keeping multiple overlapping handlers/fallbacks without a single measurable contract.
- Impact: Repeated fixes appear to work in one path while failing in another, causing long recurrence chains.
- Guardrail: For recurring interaction bugs, do a teardown/rebuild:
  1) reduce to one primary trigger contract,
  2) route all triggers through one selector,
  3) instrument every branch (hover, select, emit, dedupe),
  4) expose a runtime trace buffer for live diagnosis before further edits.

### 31) Use orange-hover as an explicit armed selection state
- Mistake pattern: Letting hover visuals and double-click target resolution diverge.
- Impact: Users can see orange highlight but still fail to open the feature card.
- Guardrail: Maintain a strict `armed hover` feature set on hover-on and cleared on hover-off; double-click selection must consume armed feature first before any geometric fallback.

### 32) Never keep two conflicting dark-theme token sources
- Mistake pattern: Defining different dark tokens in media-query dark mode and manual dark mode.
- Impact: App can render one dark palette at startup and a different dark palette after toggling theme.
- Guardrail: Keep one canonical dark token set and ensure startup always sets explicit `data-theme` (`light`/`dark`) before user interaction.

### 33) Incremental deploy loops must process final manifest line
- Mistake pattern: Building path lists without trailing newline and iterating with plain `while read` loops.
- Impact: Last changed file can be skipped in deploy, causing partial live updates and hard-to-reproduce mismatches.
- Guardrail: Ensure list files end with newline and use `while read ... || [ -n \"$line\" ]`; also compute totals from non-empty lines.

### 34) Avoid mixed hardcoded/theme-token styling within the same component
- Mistake pattern: Component outer container uses hardcoded light colors while inner blocks use theme tokens.
- Impact: Inner sections can drift to dark/low-contrast colors despite the component appearing in light mode.
- Guardrail: Keep component surfaces on one theme source, and add explicit light-mode contrast overrides where mixed legacy styles exist.

### 35) Enforce a runtime proof gate before calling an interaction bug fixed
- Mistake pattern: Accepting code-level plausibility or syntax checks as completion for UI interaction defects.
- Impact: Multiple “fixes” were shipped while the exact user path still failed.
- Guardrail: Do not close/commit an interaction fix until this exact chain is evidenced in runtime logs:
  1) trigger condition observed,
  2) interaction event captured,
  3) selection emit fired,
  4) UI render handler executed.

### 36) Add max-attempt escalation for recurring bugs
- Mistake pattern: Iterating patch-by-patch on the same defect too many times without changing method.
- Impact: Long, frustrating fix loops and low confidence.
- Guardrail: After 2 failed attempts on the same symptom, mandatory escalation:
  - stop patching,
  - instrument end-to-end,
  - perform one teardown/rebuild with a single contract,
  - retest only against explicit acceptance criteria.

### 37) Freeze competing pathways early
- Mistake pattern: Leaving legacy and new event pipelines active together during fixes.
- Impact: Path races masked root cause and created false positives.
- Guardrail: In root-cause pass, disable non-primary paths early behind a feature flag and validate one deterministic path first; reintroduce compatibility paths only after core acceptance passes.

### 38) Separate “code push success” from “user-visible deploy correctness”
- Mistake pattern: Treating successful git push/deploy status as equivalent to user runtime correctness.
- Impact: Cache/service-worker/deploy-list edge cases obscured actual behavior.
- Guardrail: For live regressions, verify:
  - deployed commit hash,
  - changed asset presence on host,
  - cache/service-worker state,
  - and runtime logs from the failing client path.

### 39) Pause/resume must recover from interrupted animation state, not assume clean continuity
- Mistake pattern: Pause removed transient transfer elements but left round-level pending state partially set, so resume could dead-end until manual stage rebuild.
- Impact: Play button appeared non-functional after pause unless user clicked a stage number.
- Guardrail: When pausing with in-flight transfer slices:
  - record interrupted round,
  - clear stale pending-transfer data,
  - and on resume rebuild that round deterministically before restarting timers.

### 40) Paused state must gate async callbacks, not just interval timers
- Mistake pattern: Clearing the interval and toggling icons without guarding delayed/callback-driven updates.
- Impact: Stage-level side effects can continue while UI shows paused, making pause appear ineffective.
- Guardrail: In animation controllers, add explicit `isPaused || !running` guards inside asynchronous callbacks/timeouts and freeze all active animation nodes at pause time.

### 41) Fix all control-path variants, not just the main one
- Mistake pattern: Patching pause/resume in STV path while forum path retained old stop-only behavior.
- Impact: Same user symptom persists depending on election mode, even though one path is fixed.
- Guardrail: For shared UI controls, enumerate every implementation path (`STV`, `forum`, etc.) and apply equivalent pause/resume contract across all before closure.

### 42) Use paused-state as the pause/play source of truth
- Mistake pattern: Routing pause/play clicks off mixed signals (`running`, icon classes, inferred mode) instead of explicit paused state.
- Impact: Control icon can toggle while behavior does not, or behavior can drift across modes.
- Guardrail: Maintain an explicit `isPaused` state per controller and make click routing strictly `if paused -> resume else -> pause` (with explicit replay exception only).

### 43) Validate shim API parity before using jQuery methods in control-critical paths
- Mistake pattern: Calling `$.fn.filter(...)` from pause/resume code while using a micro-shim that did not implement `.filter()`.
- Impact: Runtime exception inside `pause()` after interval clear but before freeze/icon/state updates, producing misleading partial behavior and repeated failed fixes.
- Guardrail:
  1) keep a parity checklist for jQuery methods used by `stages2.js` against `js/jquery-shim.js`,
  2) for pause/resume/control paths, avoid optional helper dependencies where a simple `.each` + native array pass is sufficient,
  3) when behavior is inconsistent, first inspect console/runtime exceptions before state-machine edits.

### 44) Pause must freeze the animation clock, not mutate scene state
- Mistake pattern: Implementing pause by deleting in-flight transfer slices and rebuilding/replaying stages on resume.
- Impact: Transfer rectangles disappear on pause and resume jumps stage flow instead of continuing from paused position.
- Guardrail:
  1) pause/resume should control a single animation clock flag (`window.__evAnimationPaused`) used by the animation engine loop,
  2) do not remove active transfer primitives on pause,
  3) do not call immediate stage-advance/replay on resume unless user explicitly requested step/restart.

### 45) Lock column contract early for new tables
- Mistake pattern: Initial implementation matched previous request shape (X/Y) but table contract then shifted to separate Stood + Elected counts.
- Impact: Extra iteration and avoidable UI churn.
- Guardrail: For new table views, define column contract explicitly (labels + value formulas) in 	asks/todo.md before coding and verify against screenshot/acceptance criteria before handoff.

