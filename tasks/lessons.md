# Lessons Log

# Lessons Log

### 71) Party lifespan tables need both start and end bounds
- Mistake pattern: Treating a party's election-history timeline as bounded only by the last contested election, which leaves pre-foundation/pre-participation elections visible as `did not contest`.
- Impact: Party pages imply the party existed and declined to contest elections before it had actually first stood.
- Guardrail:
  1) for any entity lifespan table, compute both the first and last relevant participation dates,
  2) only insert gap rows inside that bounded lifespan,
  3) verify one early-history party to ensure the table no longer starts before the first real appearance.

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


### 46) Raster DEM quality issues should be fixed at tile-generation source, not only in UI
- Mistake pattern: Treating DEM sea coverage and tile-edge gaps as purely runtime layer settings.
- Impact: Persistent visual artifacts (sea tinting, apparent coverage gaps) and repeated front-end-only tweaks.
- Guardrail:
  1) apply land/sea masking in the tile-build pipeline,
  2) keep maps config zoom range aligned to generated tile pyramid,
  3) keep raster pane ordering explicit (DEM below vectors) via pane z-index contract.


### 47) Keep raster display max zoom above user interaction range
- Mistake pattern: Setting raster maxZoom too low for a map that users can zoom beyond.
- Impact: Layer disappears at higher zoom, appearing broken.
- Guardrail: For static raster pyramids, set maxNativeZoom to data limit and keep maxZoom high enough (e.g., 20) for overzoom continuity.


### 48) Coastal raster completeness requires full tile matrix, not sparse tile outputs
- Mistake pattern: Skipping empty tiles in a masked coastal DEM pyramid can leave physical tile holes that appear as coastline gaps in specific view/zoom combinations.
- Impact: User-visible missing DEM coverage around coasts (e.g., Kerry/NE).
- Guardrail: For production coastal rasters, generate complete XYZ matrix for target zoom range and use transparent empty tiles instead of missing files.


### 49) For coastal land masks at low zoom, avoid center-only rasterization
- Mistake pattern: Using all_touched=False for coast masks drops edge pixels when a pixel intersects land but its center is offshore.
- Impact: Persistent coastal sliver gaps despite full tile coverage.
- Guardrail: Use all_touched=True (or equivalent edge-preserving mask strategy) for low-zoom coastal DEM products.


### 50) After tile-coverage fixes, prove whether gaps are source NoData
- Mistake pattern: Treating all remaining visual DEM holes as tile-generation or masking bugs.
- Impact: Repeated tile/mask iterations while root cause is missing elevations in the source raster over land.
- Guardrail:
  1) quantify on-land NoData directly from the source DEM before further tile logic changes,
  2) if on-land NoData exists, run a source-level fill/rebuild step (e.g., GDAL `raster fill-nodata`) or refresh source mosaic,
  3) verify on the exact previously failing bbox windows before declaring fixed.


### 51) Never use nearest-neighbour resampling for continuous DEM rendering
- Mistake pattern: Reprojecting DEM values to display tiles with nearest-neighbour sampling.
- Impact: Horizontal/latitudinal striping and aliasing artifacts that misrepresent real terrain patterns.
- Guardrail:
  1) use bilinear (or cubic) for continuous elevation reprojection to map tiles,
  2) reserve nearest for categorical rasters only,
  3) add a visual QA check at low zoom after any DEM tile rebuild.

### 52) Sticky control bars need explicit desktop and mobile layout rules
- Mistake pattern: Added sticky catalogue controls without locking the search field and nav buttons into explicit desktop tracks.
- Impact: The controls stayed sticky, but the UI regressed into stacked rows instead of the intended single-row desktop layout.
- Guardrail:
  1) define explicit desktop grid/flex tracks for primary and secondary controls,
  2) set a deliberate mobile breakpoint rather than relying on block flow,
  3) visually QA both desktop and narrow-width layouts after any sticky-shell refactor.

### 53) Remove duplicate local navigation once a shared nav shell exists
- Mistake pattern: Left page-local navigation buttons in place after introducing persistent shared catalogue controls.
- Impact: The UI exposes overlapping navigation affordances and drifts from the intended interaction model.
- Guardrail:
  1) when introducing persistent shared navigation, audit detail templates for redundant local back/home controls,
  2) remove the duplicates at the render source,
  3) keep one navigation contract per pane.

### 54) Feature-detail actions must use a stable shared reference, not transient DOM state
- Mistake pattern: Treating feature-detail pages as purely presentational, with no canonical feature reference for share/download/restore actions.
- Impact: Feature-level actions would only work in-session and could not reliably survive reload or deep linking.
- Guardrail:
  1) register feature-detail entries through one shared cache helper,
  2) derive share URLs and exports from that cached feature object,
  3) teach URL restoration to resolve the same feature reference back into a feature-detail page.

### 55) Shared action UIs must share render and bind logic
- Mistake pattern: Keeping a legacy one-off action implementation on map detail pages after the catalogue cards had already evolved to a richer action strip.
- Impact: UI capabilities drift between surfaces and fixes have to be repeated in multiple places.
- Guardrail:
  1) extract repeated action strips into a shared renderer,
  2) extract the event wiring into a shared binder,
  3) remove legacy single-purpose action paths once parity exists.

### 56) Do not let storage-model flags define UI capability by accident
- Mistake pattern: Treating `isPartial` as both the persistence model for feature-only layers and the gate for whether feature child UI should exist.
- Impact: Full-map states could not gain additive feature instances cleanly, and UI behavior was constrained by an internal implementation shortcut.
- Guardrail:
  1) drive feature-child UI from actual loaded feature-instance data,
  2) keep storage-model flags like `isPartial` narrowly scoped to what they really mean,
  3) when extending behavior, first separate “what is stored” from “what the UI should show”.


### 57) Feature-instance paths must preserve labels and readable controls
- Mistake pattern: Letting the single-feature render path disable labels while feature-specific UI surfaces inherited compact styling meant for dense card/list controls.
- Impact: Individually loaded features appeared unlabeled, active-layer child entries were hard to read, and feature-page action icons became too small to use confidently.
- Guardrail:
  1) compare feature-instance render paths against full-layer paths for labels and visibility affordances,
  2) only suppress label registration when duplicate labels from an already loaded base layer are explicitly expected,
  3) give active-layer child rows and feature-detail action strips dedicated readability sizing instead of relying on generic compact utilities.

### 58) Nearest-neighbour analysis must use a stable self-identity key
- Mistake pattern: Using temporary extracted `feature_id` values that were blank across whole source groups as the self-skip key in a nearest-neighbour pass.
- Impact: The analysis silently excluded all same-source comparisons, producing obviously wrong cross-source nearest matches.
- Guardrail:
  1) when extracting temporary comparison tables, create a guaranteed unique synthetic row ID if source IDs are absent or nullable,
  2) sanity-check one or two known examples before trusting the full ranking,
  3) if the top results violate obvious geographic expectations, stop and re-audit the self-skip and grouping logic before presenting results.

### 59) Clone-based map entries must not rely on implicit label inheritance
- Mistake pattern: Leaving clone-style map entries without their own explicit label metadata, and assuming the runtime would infer the correct label field from the base map.
- Impact: Several clone-based referendum and census layers rendered with missing labels, and source-field mismatches on dated variants went unnoticed.
- Guardrail:
  1) every clone entry that needs labels should declare its own `labelProperty`, even if it matches the base map,
  2) verify the actual source schema for each dated variant instead of assuming field names stay stable,
  3) if source values need renaming rather than field switching, route that through one metadata-driven label cleanup/remap mechanism.

### 60) New detail pages must be attached to the pane that already owns detail/history behavior
- Mistake pattern: Implementing party/candidate detail pages directly inside the election results pane because that is where the links were clicked from.
- Impact: The UI contradicted the established interaction model, navigation/history had to be reinvented, and the resulting page could fail in ways that looked like a blank pane instead of a stable detail view.
- Guardrail:
  1) before adding any new detail/info page, identify which pane already owns detail rendering and history for the app,
  2) route new links into that existing pane through an explicit callback instead of rendering ad hoc in the source pane,
  3) if the requested detail is supposed to be general, build the aggregation from the full dataset first and only then wire the UI.

### 61) Election history features need a canonical derived model before renderer work
- Mistake pattern: Starting with a lightweight party/person aggregate and a generic renderer before the election-level data model (timeline, rank, latest contested selectors, uncontested row fill, candidate ordinals) had been made explicit.
- Impact: The first implementation could show links and pages, but not the richer, correct semantics the feature actually required.
- Guardrail:
  1) for any election-history feature, define the aggregation keys and chronology rules first,
  2) compute ranks/ordinals/latest selectors once in a shared derived index,
  3) only let UI renderers consume that derived model, never infer semantics from raw JSON on the fly.

### 62) Shared metric renderers must support structured values before page-specific refinement begins
- Mistake pattern: Reusing a simple label/value metric-card renderer for richer party-page requirements where headline numbers needed supporting dates beneath them and some generic summary blocks needed to disappear entirely.
- Impact: The first pass of the party pages technically worked, but still exposed the wrong summary contract and required a second rendering pass to reach the requested layout.
- Guardrail:
  1) when a page has headline metrics with secondary context, make the metric renderer support structured `{ value, subtext }` payloads from the start,
  2) keep page-specific summary blocks optional rather than assuming every entity page needs the same metadata table,
  3) finalize the exact presentation contract for each entity type before treating the renderer as complete.

### 63) Not every dated constituency event belongs on the generic election/by-election path
- Mistake pattern: Treating any single-constituency Westminster record in the election index as a by-election, even when the source event is a constitutional process with no normal constituency results payload.
- Impact: The UI misnamed the 29 August 2018 North Antrim recall petition as a by-election and tried to render tabs/overlays/results that do not exist for that event type.
- Guardrail:
  1) before labeling a singleton constituency event as a by-election, verify that the event actually has normal election result payloads,
  2) introduce an explicit special-event registry for constitutional exceptions such as recall petitions,
  3) route special events through dedicated renderers instead of stretching the normal election pipeline to fit them.

### 64) Special-event renderers need explicit metric definitions, not recycled election summaries
- Mistake pattern: After carving out a special constitutional event path, still thinking in terms of generic election overlays and summaries rather than the exact figures and table layout the event actually needs.
- Impact: The first recall-petition pass lacked the requested over-map status label and the specific results table structure for signatures, turnout, spoiled petitions, threshold, success flag, electorate, and incumbent MP.
- Guardrail:
  1) for each special-event type, define the exact displayed metrics before rendering,
  2) use one dedicated table builder for those metrics instead of adapting party/candidate result views,
  3) when the event is non-electoral, prefer explicit status labels on-map over reusing seat-indicator logic.

### 65) Preserve neutral map baselines when adding special highlight logic
- Mistake pattern: Changing the default election geography styling while implementing a special-event highlight, instead of layering the special case on top of the existing neutral baseline.
- Impact: Constituencies not participating in a by-election/recall became transparent instead of retaining the expected grey fill, causing a visible regression outside the focal constituency.
- Guardrail:
  1) keep the default map style stable unless the user explicitly asks to change the baseline,
  2) special-event branches should override only the featured geography and leave non-featured areas on the same neutral styling contract,
  3) after any special-event map styling change, visually check both the highlighted and non-highlighted geographies.

### 66) Special-event overlays should reuse established map-label styling
- Mistake pattern: Creating a custom one-off label style for a map overlay even though the app already has a working feature-label contract with the correct text outline, wrapping, and centering behavior.
- Impact: The recall-petition label looked inconsistent with the rest of the interactive map and needed another correction pass.
- Guardrail:
  1) when adding any new map text overlay, inspect and reuse the existing map-label styling contract first,
  2) only add new label CSS if the existing contract genuinely cannot satisfy the requirement,
  3) keep special-event overview panes minimal when the actionable/tabular content belongs in the clicked geography detail view.

### 67) Remove exactly the named UI elements, not the surrounding content block
- Mistake pattern: Interpreting a request to remove several named summary boxes as permission to strip the whole section down more aggressively.
- Impact: Required tables were removed along with the unwanted boxes, creating another avoidable correction cycle.
- Guardrail:
  1) enumerate the exact elements to remove before editing,
  2) preserve all adjacent content unless the user explicitly asks to remove it,
  3) after a subtractive UI change, compare the kept-vs-removed set against the request line by line.

### 68) “Make it a link” means the element type, not just the visual style
- Mistake pattern: Converting a control to look like a text link while leaving it implemented as a `<button>`.
- Impact: The UI still behaved and inspected like a button, so the request was only half-satisfied and needed another pass.
- Guardrail:
  1) when the request distinguishes links from buttons, change the semantic element type as well as the styling,
  2) if the link is handled in-app, use an anchor with `href` plus `preventDefault()` rather than a button dressed up as a link,
  3) verify the rendered markup, not just the appearance.
### 69) Sort/filter table re-renders must use delegated link handling
- Mistake pattern: Binding click handlers directly to the initially rendered cells in a table that is later re-rendered for sorting/filtering.
- Impact: Links appear correct on first render but silently stop working after any client-side table redraw.
- Guardrail:
  1) any table that can be re-rendered client-side must use delegated click handling on a stable container,
  2) derive comparison/delta data before rendering so table redraws stay view-only,
  3) when adding sort/filter to an existing linked table, explicitly test the links after at least one sort/filter operation.

### 70) By-election deltas must compare like-for-like geography
- Mistake pattern: Reusing whole-election previous-result totals as the baseline for a by-election row.
- Impact: Delta columns compared one constituency or a small constituency subset against a prior full election across all constituencies, producing misleading seat/vote/rank changes.
- Guardrail:
  1) any by-election or partial-geography row must carry its affected constituency subset explicitly,
  2) previous-election baselines for such rows must be aggregated over that same subset before computing deltas or ranks,
  3) when adding `±` columns to election-history tables, verify by-election rows separately from full-election rows.
# Lessons Log

### 72) Preserve structured constituency metadata until final render
- Mistake pattern: Collapsing constituency participation down to a plain comma-separated string too early in the derived model.
- Impact: The UI could no longer add map-year labels, elected-first ordering, bold styling, or feature-detail links without rebuilding the data path.
- Guardrail:
  1) keep constituency participation as structured entries through derivation,
  2) only stringify at the final render boundary,
  3) when a list may later need links, styling, or ordering rules, never reduce it to a flat string in the model layer.
# Lessons Log

### 73) Transient hover restore must read from the live base style, not a stale initial snapshot
- Mistake pattern: Caching a one-time “original style” for hover restore while allowing later user controls to mutate only the live rendered style.
- Impact: Temporary interactions like hover/mouseout silently undo user-selected transparency or other style adjustments.
- Guardrail:
  1) store a mutable base-style snapshot for each interactive layer,
  2) when a user control changes style, update both the rendered layer and that base snapshot,
  3) hover/highlight restore must use the current base snapshot rather than a boot-time style capture.
