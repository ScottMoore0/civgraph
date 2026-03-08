# Lessons Log

### 89) Global election index loaders must respect body slug, not display name
- Mistake pattern: Using `bodyData.name` to load election JSON in global indexing when some bodies share a slug-backed storage path (`local-government`).
- Impact: Aggregates silently resolve to empty payloads (`0` valid votes, `0` seats, no leading party) even though underlying JSON files are present.
- Guardrail:
  1) always load via `bodyData.slug || bodyData.name`,
  2) for grouped/shared-body datasets, add a quick non-zero aggregate sanity check on one known body/date after index build.

### 88) Keep geographic election links on feature pages; enrich those pages instead of swapping destination type
- Mistake pattern: Implementing DEA/LGD election links by redirecting to separate election-entity pages when the product contract required feature pages as the destination.
- Impact: UX diverged from expected navigation flow and required rework even though the underlying history data existed.
- Guardrail:
  1) treat the destination type (`feature page` vs `entity page`) as a hard requirement,
  2) if geography links need richer context, attach election-history payloads to feature-detail entries and render new sections there,
  3) reserve election-entity pages for person/party entities unless explicitly requested otherwise.

### 86) Never source production STV output from stale remap artifacts
- Mistake pattern: Switching output generation to a remapped workbook artifact without revalidating core election invariants.
- Impact: Previously fixed stage-collision defects were silently reintroduced into local-election By Count output.
- Guardrail:
  1) treat the normalized workbook as STV truth unless a remapped artifact is regenerated from that exact base in the same pass,
  2) run a stage-collision audit (`multi-surplus` / `mixed elimination+surplus`) after every source-workbook switch,
  3) block release if the audit is non-zero.

### 87) Name-marker cleanup needs both data and render guardrails
- Mistake pattern: Cleaning dagger markers only in data preparation and assuming all downstream surfaces consume refreshed clean data.
- Impact: stale artifacts or alternate render paths can still surface `‚Ä°` in tables/animations.
- Guardrail:
  1) sanitize candidate names at data build time,
  2) also sanitize at display/render extraction points in both results and animation code paths.

### 85) PersonID-anchored overrides are only as good as the ID source workbook
- Mistake pattern: Implementing canonical-by-PersonID replacement while building from a workbook that did not contain approved local->full ID remaps.
- Impact: Overrides appeared to be implemented but had near-zero effect in rendered results tables.
- Guardrail:
  1) when a remapped workbook exists, make it the build source-of-truth,
  2) normalize PersonID formats (`001234`, `1234`, float-like strings) before matching,
  3) print match coverage (`matched/total`) on every build so override failures are visible immediately.

### 84) STV stage pipelines need hard validation, not only heuristic matching
- Mistake pattern: Relying on heuristic surplus-stage matching without enforcing structural invariants at build time.
- Impact: local-election outputs could still contain mixed elimination/surplus counts or multi-surplus stages even after apparent case-level fixes.
- Guardrail:
  1) enforce `distribution_stage >= exit_count` and one surplus donor per stage during assignment,
  2) treat unmatched surplus candidates as non-redistributed (deemed elected) rather than forcing illegal stage placement,
  3) fail fast in the builder on any mixed or combined event-stage collision,
  4) suppress negative transfer values outside donor stages to prevent synthetic event artifacts from source-count deltas.

### 82) Chamber seat ordering must be based on final x-position, not generation order
- Mistake pattern: Generating a correct council hemicycle shape but assigning party members to seats in the raw per-row construction order.
- Impact: Party colours fill the chamber top-to-bottom / row-by-row instead of left-to-right politically.
- Guardrail:
  1) once shaped seat positions are generated, normalize them and then sort by final `x` before assigning ordered party seats,
  2) treat geometry generation and political seat assignment as separate steps,
  3) verify one chamber visually for left-to-right colour blocks after any seat-layout refactor.

### 83) Detailed STV count headers need an explicit per-count event model
- Mistake pattern: Rendering `Count #` columns from raw count numbers alone without inferring which candidate surplus or exclusion actually caused that count.
- Impact: Headers stay generic and the table obscures when redistribution really happens.
- Guardrail:
  1) derive a per-count event map from the actual negative-transfer rows,
  2) classify each count as `Surplus` or `Exclusion` from the terminal negative-transfer candidate state,
  3) use surname by default and full name only when surnames collide within the constituency.

### 81) When a reference chamber already exists, copy its geometry model instead of tuning blind
- Mistake pattern: Iterating repeatedly on seat-layout constants without first anchoring the implementation to the known-good ParliamentArch geometry.
- Impact: Multiple visually different but still-wrong council hemicycle variants, despite touching the same branch over and over.
- Guardrail:
  1) if a target layout already has a known source algorithm, inspect and mirror that algorithm first,
  2) separate geometry-class changes from density tuning,
  3) only adjust spacing constants after the chamber uses the correct annulus/arc formulas.

### 78) STV display logic must use the event count, not the row count
- Mistake pattern: Treating `Count_Number` as the count at which a candidate was elected or excluded in local-election data.
- Impact: Candidates appear as `Elected 1/#` or `Excluded 1/#` across the UI even when the decisive event happened later.
- Guardrail:
  1) whenever STV source rows include `Occurred_On_Count`, use that as the event-count source of truth,
  2) reserve `Count_Number` for table-column placement only,
  3) verify one elected and one excluded local-election candidate after any STV display refactor.

### 79) Local-election swing baselines must skip by-elections for NI-wide comparison
- Mistake pattern: Reusing the generic `previous date` lookup for grouped local elections, which makes the 2018 Carrick Castle by-election become the baseline for 2019 NI-wide local comparisons.
- Impact: local-party, candidate, and council/DEA swing columns compare against the wrong election.
- Guardrail:
  1) grouped local elections need a dedicated previous-general-election resolver,
  2) by-elections may compare locally to their last general election, but NI-wide local comparisons must skip one-seat dates,
  3) verify `2018 -> 2014`, `2019 -> 2014`, and `2023 -> 2019` explicitly after changing local-election date logic.

### 80) Election-layer suppression must also z-lock lower layers
- Mistake pattern: Hiding labels below an election layer without blocking lower-layer `bringToFront()` paths during hover interaction.
- Impact: outlines and other lower-layer visuals can leak above the active election layer while the user moves around the map.
- Guardrail:
  1) whenever an election is active, mark lower loaded layers as election-z-locked,
  2) check hover/selection code for `bringToFront()` calls and gate them on that lock,
  3) clear the lock when the election layer is cleared or hidden.

### 77) A flat-bottom hemicycle requires shared arc endpoints, not clipped arcs
- Mistake pattern: Using a narrowed angle range to shape the chamber, which makes each ring end at a different height.
- Impact: The chamber is curved, but its base is not flat and the whole shape drifts away from the parliamentary reference.
- Guardrail:
  1) if the chamber must have a flat bottom, generate each ring on the full upper semicircle (`0..œÄ`),
  2) compress width with an explicit horizontal scale instead of clipping arc endpoints,
  3) tune density with seat gap and radial gap only after the shared baseline is correct.

### 76) Chamber orientation matters as much as arc geometry
- Mistake pattern: Switching from rows to true arcs but using a lower-bowl arc range, which still produces the wrong chamber class visually.
- Impact: The dots are genuinely curved, but the chamber reads as a rounded bowl instead of a flat-bottom parliamentary hemicycle.
- Guardrail:
  1) for a parliamentary hemicycle, place dots on an upper semicircle (`y = -sin(angle)` in screen coordinates),
  2) ensure both arc endpoints land on the same baseline before normalization,
  3) tune base flatness and dot density separately after the geometry class is correct.

### 75) A hemicycle requirement means arc geometry, not row-width tricks
- Mistake pattern: Treating a chamber overlay as solved once the overall silhouette looks semicircular, even if every seat is still placed on straight horizontal rows.
- Impact: The result reads as a stacked-row approximation rather than an actual parliamentary hemicycle.
- Guardrail:
  1) if the user asks for a real hemicycle, generate seat positions on concentric arcs using polar geometry,
  2) treat shape class, seat density, and centering as separate tuning problems,
  3) only use row-based layouts when the requirement is explicitly a grid or stepped block, not a chamber.

### 74) Tune chamber density independently from chamber shape
- Mistake pattern: Fixing the overall hemicycle geometry but leaving seat spacing on the old wider scale.
- Impact: The overlay can be structurally correct yet still look visibly looser than the reference.
- Guardrail:
  1) keep an explicit effective seat-gap constant for large chamber layouts,
  2) tune arc span and radial spacing separately from seat ordering and centering,
  3) when comparing to a reference, validate shape first, density second.
# Lessons Log

### 73) Non-grid seat overlays must be centered from bounds, not from the first point
- Mistake pattern: Switching seat geometry away from a simple grid but still positioning dots relative to the first seat coordinate.
- Impact: The overlay group can drift sideways or vertically even when the marker anchor is centered correctly.
- Guardrail:
  1) for any shaped seat layout, compute dot offsets from `min(x)` and `min(y)`,
  2) treat orientation, base shape, and anchor centering as separate checks,
  3) if seat order matters politically, sort the elected-member list before applying the geometry.
# Lessons Log

### 72) Change council seat layouts only at the seat-position helper
- Mistake pattern: A council overlay arrangement bug could tempt broad changes to marker rendering or overlay wiring when only the seat-position geometry is wrong.
- Impact: Fixing the visual layout in the wrong layer risks breaking marker styling, click behavior, overlay visibility rules, or the DEA overlay path.
- Guardrail:
  1) keep large-seat arrangement changes inside `_seatPositions()`,
  2) leave marker HTML, icon sizing, and overlay logic untouched unless the bug is actually there,
  3) verify both a large-seat council path and a small-seat DEA path after the change.
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

### 27) Don‚Äôt block synthetic dblclick on `MouseEvent.detail`
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
- Impact: Multiple ‚Äúfixes‚Äù were shipped while the exact user path still failed.
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

### 38) Separate ‚Äúcode push success‚Äù from ‚Äúuser-visible deploy correctness‚Äù
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
  3) when extending behavior, first separate ‚Äúwhat is stored‚Äù from ‚Äúwhat the UI should show‚Äù.


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

### 68) ‚ÄúMake it a link‚Äù means the element type, not just the visual style
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
  3) when adding `¬±` columns to election-history tables, verify by-election rows separately from full-election rows.
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
- Mistake pattern: Caching a one-time ‚Äúoriginal style‚Äù for hover restore while allowing later user controls to mutate only the live rendered style.
- Impact: Temporary interactions like hover/mouseout silently undo user-selected transparency or other style adjustments.
- Guardrail:
  1) store a mutable base-style snapshot for each interactive layer,
  2) when a user control changes style, update both the rendered layer and that base snapshot,
  3) hover/highlight restore must use the current base snapshot rather than a boot-time style capture.

### 74) Benchmark compiler output only after contest keys are proven sane
- Mistake pattern: Reading benchmark mismatches as parser failures before verifying that date/body/constituency keys line up between generated output and the reference workbook.
- Impact: Early benchmark numbers were misleading because older STV metadata extraction was folding extra label/value text into the constituency key, which made valid contests look uncovered.
- Guardrail:
  1) before trusting any benchmark report, prove that contest keys match on a representative old/mid/new sample,
  2) sanitize constituency extraction from cell-level metadata before using joined row text,
  3) for date fields parsed from spreadsheet serials, cross-check against the year encoded by the source path and fall back if the serial is implausible.

### 75) STV raw-source pipelines need an explicit uncontested-sheet path
- Mistake pattern: Assuming every STV source workbook contains a live count matrix with stage headers and transfer columns.
- Impact: Some `lgov` files where all candidates were returned without a count failed the parser even though they still contain valid candidate and metadata rows.
- Guardrail:
  1) detect no-contest sheets by candidate-header presence even when no stage columns exist,
  2) allow a one-stage / no-transfer contest model with blank first preferences if the source provides no count matrix,
  3) keep this path inside the shared STV parser rather than handling those files as ad hoc exceptions.

### 76) Export normalization tables only after filtering parser-noise labels
- Mistake pattern: Dumping raw extracted label fields directly into a normalization table even though older source layouts can leak metadata, occupations, or numeric artifacts into the same column.
- Impact: The output CSV looked authoritative but was polluted with non-party values like numeric counts and occupations, which would create busy-work and bad downstream normalization.
- Guardrail:
  1) add an explicit plausibility filter for the exported label type before writing a normalization table,
  2) allow real abbreviation/shorthand forms explicitly rather than using a broad "non-empty string" rule,
  3) spot-check the first output batch against expected hard cases like `Off. Un.` before presenting the file as usable.

### 77) Put occurrence metadata into normalization exports at generation time
- Mistake pattern: Emitting only the normalized label mapping even though the source-occurrence context needed to review the mapping properly was already available in the parser.
- Impact: The CSV required an immediate follow-up change to add the year context that should have been included in the first pass.
- Guardrail:
  1) when exporting a review-oriented normalization table, include the lowest-cost occurrence metadata available at generation time,
  2) for election-source normalization tables, carry at least the appearance year(s) with each raw label,
  3) if a normalization file will be manually reviewed, design it for review, not just for machine mapping.

### 78) Match workbook reference exports to the exact requested source column
- Mistake pattern: Exporting a workbook reference list from multiple similar columns (`Source Party Name` and `Party Name`) when the request was specifically for the canonical workbook party-name field.
- Impact: The CSV included extra historical/source-label variants and non-canonical values that were outside the intended scope.
- Guardrail:
  1) when a workbook contains both raw-source and normalized columns, confirm which one the user wants and export only that field,
  2) keep workbook reference exports narrowly scoped to the requested canonical column unless a comparison export is explicitly requested,
  3) name the exporter behavior after the exact source column it reads.

### 79) Review-oriented normalization exports need candidate and location context
- Mistake pattern: Treating a normalization CSV as complete once it had the raw label and canonical label, even though the user was clearly using it as a review sheet for manual adjudication.
- Impact: The file immediately needed another pass to add who used each label and where they used it.
- Guardrail:
  1) if a normalization/export sheet is meant for review, include the lowest-cost occurrence context at generation time,
  2) for election-source labels, include candidate names and geographic tuples alongside years,
  3) derive those context columns in the same source pass as the label extraction so they remain consistent.

### 80) For Wikipedia election scrapes, derive page titles from overview pages before guessing article names
- Mistake pattern: Starting from guessed article-title patterns for dozens or hundreds of related pages when Wikipedia already has year-overview pages that link to the canonical targets.
- Impact: The scrape path becomes more fragile and needs unnecessary council-name and suffix heuristics.
- Guardrail:
  1) find and use the highest-level overview/index pages first,
  2) extract linked article titles from the raw wikitext where possible,
  3) use title guessing or search only as a fallback for gaps in the overview-page link set.

### 81) Global label normalization is not enough when contest-level evidence exists
- Mistake pattern: Trying to map raw historical party labels to curated external labels only at the global label level.
- Impact: Many rows stay blank even though the external source contains enough council/DEA/year candidate context to reconcile them safely.
- Guardrail:
  1) if a curated external source exists for the same contest, match records within the smallest reliable contest key first,
  2) use candidate-level reconciliation inside that contest before falling back to global label heuristics,
  3) only leave rows blank after the context-aware path has failed or remains ambiguous.

### 82) Review exports should not stop at "conservative blanks" when the user expects full coverage
- Mistake pattern: Treating a review/export file as acceptable with residual blank normalization targets after only high-confidence matching, even when a deterministic fallback naming pass can fill the remainder.
- Impact: The file still looked unfinished to the user and required another correction cycle.
- Guardrail:
  1) for review-oriented normalization CSVs, distinguish between "production-safe" mappings and "review-complete" mappings,
  2) if the user explicitly wants all blanks filled, add a final deterministic fallback naming layer rather than leaving empties,
  3) verify the blank-count explicitly before reporting completion.

### 83) Contextual reconciliation must not override semantically obvious labels
- Mistake pattern: Letting contest-level Wikipedia reconciliation outrank an explicit semantic mapping for labels whose meaning is already clear from the label text.
- Impact: Labels like `""" Indp. Party` were misclassified from a nearby contest match even though they should have resolved directly to `Independent (politician)`.
- Guardrail:
  1) reserve context-first precedence only for genuinely opaque abbreviations and fragments,
  2) for semantically interpretable labels, prefer the explicit mapping and use contest context only as fallback,
  3) verify the user's named counterexamples directly before closing a normalization pass.

### 84) Eliminate conflicting duplicate normalization rules before trusting export results
- Mistake pattern: Leaving multiple rules for the same raw-label family in one normalization function, with earlier returns masking later intended canonical mappings.
- Impact: Labels like `Anti-Agreement Northern Ireland Unionist Party` and `Coleraine Unionist` leaked raw/local values into the Wikipedia column even after later corrective rules existed.
- Guardrail:
  1) a normalization function must not contain conflicting duplicate branches for the same label family,
  2) when a user reports a bad normalization, inspect the full rule chain for duplicate earlier returns before assuming a data problem,
  3) verify suspicious self-copy rows after regeneration, not just blank/`Other` counts.

### 85) Discovery logic must match the page-title era, not just the content era
- Mistake pattern: Assuming modern election pages all follow a single `[year] [council] election` title pattern when some transitional 2014 pages still use `[Council] election, [year]`.
- Impact: The first modern scrape pass found only `32/33` pages even though the missing page existed and fit the same election corpus.
- Guardrail:
  1) for any era transition, support both prefix-year and suffix-year title forms,
  2) persist a full expected page matrix so discovery gaps show up as missing rows rather than silently absent manifest entries,
  3) use overview-link discovery first, then exact-title variants, then search fallback.

### 86) Never split Wikipedia template parameters with plain `split("|")`
- Mistake pattern: Declaring a modern Wikipedia STV parser "done" while still splitting template bodies on raw `|`, even though the templates contain nested `[[...|...]]` links and nested `{{...}}` fragments in `title=` and candidate fields.
- Impact: The scrape looked complete at the page level, but DEA names, seat counts, and end-summary fields were corrupted; any workbook built on top of that path would have carried structurally wrong data despite successful fetch coverage.
- Guardrail:
  1) for MediaWiki template parsing, split parameters only at top-level depth across both template and link nesting,
  2) centralize the parser in one shared module and make all scrapers/generators consume that shared path,
  3) after any parser refactor, verify one representative raw block end-to-end against the emitted structured output before trusting corpus-wide generation.

### 87) Count columns alone are not enough; STV exports need an explicit terminal-event model
- Mistake pattern: Treating modern Wikipedia STV count tables as if each `countN -> countN+1` change were sufficient to infer workbook semantics without modeling when a candidate is elected, eliminated, or simply remains unsuccessful at the final count.
- Impact: The first modern workbook generator missed surplus-vs-full deductions, misclassified candidate outcomes, and left `%ElectorateShare` blank even though the raw data was present.
- Guardrail:
  1) before exporting STV count tables, run a district-level analysis that identifies each candidate's exit count and terminal status,
  2) map elected candidates to negative surplus deductions with quota carry-forward, eliminated candidates to negative full deductions with zero carry-forward, and final unsuccessful candidates to `Not Elected` with no fake elimination,
  3) verify one named elected candidate, one eliminated candidate, and one final unsuccessful candidate against the raw count table before calling the export correct.

### 88) "Standing years" logic must respect non-candidate row types in mixed election systems
- Mistake pattern: Deriving a person's election years only from `ResultType = Candidate` rows in a workbook that also encodes valid candidacies as `ListCandidate#` rows for list-PR contests such as the 1996 Forum election.
- Impact: People like `Mervyn Jones` incorrectly showed no standing years even though they clearly existed in the workbook with a valid `PersonID`.
- Guardrail:
  1) when deriving person-level participation from a mixed-system election workbook, identify all row types that represent an actual candidacy,
  2) include `ListCandidate#` rows alongside `Candidate` rows where appropriate,
  3) verify the rule against at least one non-standard row type that the user explicitly names before closing the task.

### 89) Once the user manually approves identity matches, remap from the approved sheet rather than the inferred match logic
- Mistake pattern: Treating a generated person-match workbook as merely diagnostic after the user had added an explicit `approved` adjudication column with `Y` / `N` decisions.
- Impact: Without a dedicated remap pass, the modern local-election workbook would still carry temporary generated `PersonID` values instead of the established IDs from `Full election tables.xlsx`.
- Guardrail:
  1) when a review workbook gains a manual approval column, treat it as the source of truth for downstream reconciliation,
  2) validate that approved mappings are one-to-one before applying them,
  3) update every ID-bearing column in the target workbook, not just the most obvious primary key column.

### 90) Do not trust column names when reconciling IDs; inspect the actual payload
- Mistake pattern: Remapping only columns explicitly named like `PersonID` and `SourcePersonID`, while leaving semantically ID-bearing fields such as `TransferSubject#` untouched because the header sounded descriptive rather than identifier-like.
- Impact: The workbook ended up only partially reconciled, with candidate IDs corrected in some places but stale generated IDs still embedded in transfer-subject columns.
- Guardrail:
  1) after any ID-reconciliation task, inspect all workbook headers and sample payload values for hidden ID-bearing columns,
  2) when fields like `TransferSubject#` hold numeric IDs, include them in the remap path explicitly,
  3) verify at least one representative remapped value in each ID-bearing column family before closing the task.

### 91) Workbook rewrites must validate against a real workbook extension before replacement
- Mistake pattern: Writing a temp workbook to a generic `.tmp` path and then trying to reopen it with `openpyxl` as part of validation.
- Impact: The safe-write flow failed unnecessarily even though the workbook contents were otherwise valid, adding another correction cycle to a sensitive data-migration task.
- Guardrail:
  1) temp workbook paths must still end in a workbook extension that the validator supports (for example `.tmp.xlsx`),
  2) validate the temp output before replacing the source file,
  3) if validation fails, leave the source file untouched and fix the temp-path contract first.

### 92) Data-fix scripts must be rerunnable after a partial migration
- Mistake pattern: Discovering target contexts only from `old_id + split_name` rows, which breaks once part of the migration has already succeeded and the split person is already on the new ID.
- Impact: The rerun path found no contexts and would have skipped the remaining stale references even though split-name rows were still present in the workbook.
- Guardrail:
  1) for split-ID migrations, identify target contexts by the split person and election context, not by the stale ID alone,
  2) rerunability must be an explicit design constraint for any workbook/json migration,
  3) verify the context-discovery phase independently before applying writes.
93. When a user approves a targeted batch of person-ID matches conversationally, do not wait for the review workbook to be updated first. Build a name-driven remap from the live workbook state and rewrite every actual ID-bearing column, otherwise synthetic local IDs can survive indefinitely in downstream artifacts.
94. Do not call a same-name identity merge ‚Äúhigh confidence‚Äù unless you have reviewed the full history on both sides: all parties, all constituencies, and all years. Short plausibility summaries are not enough to approve a merge safely.
95. Same-name identity fixes must support one-to-many splits on both sides of the bridge. A canonical workbook ID can require multiple historical splits, and a synthetic local workbook ID can also need a context split before any canonical remap is safe. Encode those fixes as explicit `date + constituency + party` migrations and verify them separately in the canonical workbook, downstream JSON, and local workbook.
96. Do not schedule a rewrite from an auxiliary match/review artifact alone. Before applying another person-ID merge pass, re-audit the live target workbook and confirm the supposedly stale IDs still exist there. Review workbooks drift; target artifacts decide whether a fix is still needed.
97. When a user approves a batch from an inline review table, verify the live workbook state before and after the remap run, and distinguish between a true rewrite and a no-op confirmation pass. Otherwise you risk reporting a new fix when the real outcome is that the workbook was already canonical.
98. Treat string-cleanup requests the same way as ID-fix requests: verify the live target artifact actually contains the requested bad marker before claiming a cleanup. Older review sheets can preserve stale text artifacts that no longer exist in the real workbook.
99. Grouped election families must be integrated at every layer, not just in the load path. If multiple index bodies represent one logical election family, wire the same grouping through catalogue appearance, filters, election timelines/entity aggregation, and URL restore; otherwise the data can load while the rest of the UI still behaves as if the family is fragmented.
100. URL restore for grouped geographies must search the merged constituency set, not only the seed body. If one grouped election entry can load features from sibling bodies, restoring a deep-linked selected constituency must rebuild the same merged constituency pool before matching the slug.
# 2026-03-01: For grouped local-government elections, normalize constituency names before every join and every previous-election lookup

- Symptom: `2019` local-election DEAs like `Dungannon ‚Äì 6 seats` failed to match the `DEAs_2012.fgb` `FinalR_DEA` names, which broke map joins, hid `Mid Ulster`, and polluted local-election `+/-` comparisons.
- Rule: whenever local-election result rows are joined to geometry names or compared to a previous election, always route both sides through a single `_normaliseConstituencyName(...)` helper first.
- Guardrail:
  - keep one normalization helper in `js/election-controller.js`
  - key local party comparison rows with the normalized constituency name, not the raw results name
  - use normalized result lookup maps for current and previous local-election payloads

# 2026-03-01: Never blank post-election count cells if the source data still contains later counts

- Symptom: DEA transfer tables showed only the first-round count for elected candidates while unsuccessful candidates still displayed full count progressions.
- Rule: if the count source contains later rows for an elected candidate, render them; do not apply a blanket UI truncation after `electedAt`.
- Guardrail:
  - the count-table renderer may infer status timing, but it must not discard real `countGroup` totals that exist in the payload
  - status logic and cell-visibility logic must stay separate

# 2026-03-01: Defer `Not Elected` status until the final STV round

- Symptom: transfer animation rows were marked `Not Elected` from the start and dropped prematurely to the bottom before the final count.
- Rule: `not_elected` is a final-state label, not an initial-state label. Do not surface it before the final round.
- Guardrail:
  - in `election-viewer-package/js/stages2.js`, `enforceStatusTiming(...)` must suppress `not_elected` until the last count
  - ordering logic must rely on the deferred display status rather than the final status



### 75) Election geography/result joins must be normalized for case as well as suffix cleanup
- Mistake pattern: Fixing local-election naming quirks but leaving constituency matching case-sensitive.
- Impact: Non-local election geometries can silently stop matching results, which removes colouring and seat overlays even though the data itself is still loaded correctly.
- Guardrail:
  1) keep all constituency/council join keys lower-cased in the shared normalizer,
  2) normalize punctuation and `- 6 seats`-style suffixes in the same helper,
  3) when map colouring disappears, verify name matching before touching result parsing or overlay rendering.

### 101) Restoring a large shared controller file is an integration event, not a file-recovery event
- Mistake pattern: Restoring `js/election-controller.js` from an older revision after corruption, but not immediately auditing it against the current `js/app.js`, `js/ui-controller.js`, and grouped local-government contract.
- Impact: The file looked superficially healthy, but missing helper methods and delegated pane actions broke election polygon styling, click handling, council-mode toggling, and the results-pane close button across both local and non-local elections.
- Guardrail:
  1) after restoring any large shared controller, compare its public entry points against the current callers before treating the restore as complete,
  2) verify every helper invoked by `loadElection()` and every split-pane action used by the current UI exists in the restored file,
  3) when grouped election families are involved, explicitly verify alias rebuilding, council aggregation, and mode-switch behavior before moving on.
# Local Election UI Guardrail
- When fixing a live UI regression in elections, read the exact current implementation of the active controller branches before editing.
- In this codebase, the relevant live branches for local-election display are often:
  - `buildCatalogueCards()`
  - `_rebuildCouncilAggregates()`
  - `_extractElected()`
  - `_seatPositions()`
  - `_buildCountTable()`
- Do not assume earlier experimental geometry or grouping code is still present.
- For local STV data, do not trust `Number_Of_Seats` blindly; prefer parsing the seat count from the constituency name when the source files encode `- 5 seats`, `- 6 seats`, etc.
- For repeated status rows in local STV `countGroup`, infer terminal redistribution from the vote series itself and show only one terminal quota/zero cell before blanking the rest.

### 102) PersonID canonicalization must not override row-level party affiliation
- Mistake pattern: applying a global per-PersonID canonical party label from historical workbook data while building local-election outputs.
- Impact: candidates can be shown under the wrong party in specific elections (for example where a person changed party over time).
- Guardrail:
  1) use PersonID canonicalization for name normalization only,
  2) always source `Party Name` / `Deduplicated Party Name` / `Wikipedia Party Name` from the current election row,
  3) verify at least one known correction case in generated JSON after each build.

### 103) Affiliation correctness and label-format correctness are separate contracts
- Mistake pattern: fixing wrong-party assignment but leaving party labels in long-form source names.
- Impact: users still see incorrect presentation (`Democratic Unionist Party` instead of `DUP`, `Alliance Party of Northern Ireland` instead of `Alliance`) even when affiliation is right.
- Guardrail:
  1) first enforce row-level affiliation correctness,
  2) then apply explicit label normalization for UI-facing party fields,
  3) verify both with targeted case checks and a repository-wide scan for disallowed long-form labels.

### 104) When one fix corrupts display labels, use dual-source reconciliation keyed by identity context
- Mistake pattern: using a single source for both STV mechanics and display labels when those concerns were stabilized in different workbook revisions.
- Impact: either redistribution correctness regresses (if rolling back) or name/party labels regress (if staying on the new source).
- Guardrail:
  1) separate source-of-truth contracts: mechanics from fixed workbook, labels from curated workbook,
  2) reconcile labels only by strict key `(date, constituency, canonical PersonID)`,
  3) verify both contracts in one pass: label spot-checks + global label scan + surplus-stage guard check.

### 105) By-count ranking must have an explicit same-count elected tie-break
- Mistake pattern: sorting elected rows only by `electedAt`, which leaves ties in payload insertion order.
- Impact: candidates elected on the same count can appear in an order that contradicts expected electoral logic.
- Guardrail:
  1) when `electedAt` ties, rank by vote at the count immediately before that candidate's redistribution,
  2) if no redistribution occurred (late/final count), rank by final-count votes,
  3) keep deterministic fallbacks (first prefs, then name) to avoid unstable rendering.

### 106) `By Count` detailed `¬±%` must represent redistribution-share, not candidate-relative change
- Mistake pattern: computing count `¬±%` as `transfer / previous candidate total`.
- Impact: row percentages do not reconcile to conservation totals for a count and mislead users reading transfer flows.
- Guardrail:
  1) compute per-count negative and positive transfer pools,
  2) render negative rows as share of negative pool (sum `-100%`),
  3) render positive rows (including non-transferable) as share of positive pool (sum `+100%`).

### 107) Post-aggregation row transforms must re-canonicalize non-target rows
- Mistake pattern: applying a local-election history collapse transform without a final canonicalization pass for rows outside the target scope.
- Impact: non-local rows can inherit or retain local-style labels in party electoral-history tables.
- Guardrail:
  1) after collapsing/grouping local rows, iterate all history rows and rehydrate non-local rows from canonical election metadata (`body`, `bodyLabel`, `displayName`),
  2) keep local-only display strings (`local elections`) constrained to rows where `_isLocalGovernmentBody(row.body)` is true and `!row.isByElection`,
  3) verify with one party that spans local + Assembly/Westminster elections.

### 108) Classification helpers used for cross-election aggregation must not depend on active controller state
- Mistake pattern: using `this.bodyGroup` as an implicit default in `_isLocalGovernmentBody()` during history-row aggregation.
- Impact: when a local election is currently loaded, unrelated Assembly/Westminster rows can be misclassified as local and mislabeled in party history.
- Guardrail:
  1) row/body classifiers must default from the row being processed, not the currently loaded election,
  2) add a post-transform canonicalization pass for non-target rows,
  3) verify party history with a mixed-body party before closing.

### 109) Party history naming/date/type is a UI contract and must be centralized
- Mistake pattern: mixing generic election display names with per-view custom strings.
- Impact: inconsistent naming across rows and mismatched user-facing semantics.
- Guardrail:
  1) build party-history labels in one explicit post-processing pass,
  2) enforce format: `[Prefix] [Year|Mon YYYY]` for non-by-elections,
  3) keep date/type as dedicated columns rather than embedding everything in one label.

### 110) Table-column wording changes must be applied at schema level, not ad-hoc render spots
- Mistake pattern: partial label changes left legacy header text mixed with updated contract.
- Impact: user-facing election-history tables drift from agreed terminology.
- Guardrail:
  1) update label contracts in the single column-schema definition (`partyHistoryColumns`),
  2) verify exact header strings after each schema change,
  3) keep semantic synonyms out of adjacent labels (`Seats won` vs `Candidates elected`).

### 111) By-election/recall deltas need explicit nulling rules for non-comparable totals
- Mistake pattern: total-seat deltas computed generically for all rows.
- Impact: misleading `Total seats ±` values for by-elections/recall contests.
- Guardrail:
  1) null total-seat deltas on `row.isByElection`,
  2) render null as `ó`,
  3) keep baseline comparison buckets type-scoped for all other rows.

### 112) By-election labels should be geography-first, not body-first
- Mistake pattern: using elected-body labels in generic by-election naming.
- Impact: local by-elections display as council-wide events instead of DEA-specific events.
- Guardrail:
  1) when `isByElection` and contest geography is present, use constituency/DEA name in title,
  2) reserve body labels for general elections.

### 113) Special event labels must be template-driven
- Mistake pattern: hardcoding event strings with fixed wording/date order.
- Impact: label contract changes require manual one-off edits and drift.
- Guardrail:
  1) derive special labels from structured fields (`year`, `constituency`, `event type`),
  2) keep display-name formats centralized and explicit.

### 114) Seat suffix parsers must accept Unicode dash variants
- Mistake pattern: parsing constituency titles with only ASCII hyphen (`-`) for seat suffix extraction.
- Impact: DEAs using en dash/em dash (`ñ`/`ó`) lose seat metadata, causing downstream seat undercounts.
- Guardrail:
  1) accept `[-ñó]` in seat suffix regexes,
  2) add a regression check using at least one en-dash DEA title.

### 115) Rebuild outputs must clear stale generated files first
- Mistake pattern: regenerating JSON without cleaning old files in date folders.
- Impact: stale constituency/date outputs can survive and pollute totals/UI behavior.
- Guardrail:
  1) remove existing per-date `*.json` files before writing regenerated outputs,
  2) verify expected file counts per date after each rebuild.

### 116) Aggregated-row display labels must not be used as action keys
- Mistake pattern: using synthetic display body (`Local Government Districts`) as the load key for election links.
- Impact: clicking history links does not load the selected election because the body key is not present in index.
- Guardrail:
  1) carry an explicit canonical action key (e.g., `electionBodyForOpen`) on aggregated rows,
  2) keep display labels (`body`, `bodyLabel`) purely presentational,
  3) render link `data-election-body` from canonical key only.

### 117) Shared detail templates need explicit per-entity subtitle/eyebrow rules
- Mistake pattern: rendering both header subtitle and standalone description from a shared template without entity-specific suppression.
- Impact: redundant labels on party pages (same concept shown twice).
- Guardrail:
  1) define subtitle by entity kind (`party/candidate/area`) in one branch,
  2) conditionally render standalone description only where needed,
  3) verify one sample page per entity kind after template edits.

### 118) Special-event rows require both model-level and render-level isolation
- Mistake pattern: only styling recall rows without removing them from delta baseline chains.
- Impact: recall rows can distort adjacent election deltas or show misleading non-blank metrics.
- Guardrail:
  1) tag special events in row model (`isRecallPetition`),
  2) skip baseline accumulation for special rows,
  3) enforce explicit blank rendering for all non-applicable columns.

### 119) Column label/ordering requests should be treated as schema migrations
- Mistake pattern: incremental edits leave old labels/order in place.
- Impact: UI still diverges from agreed table contract.
- Guardrail:
  1) make header and order changes in the single table-schema source,
  2) verify final displayed sequence against spec,
  3) keep delta labels consistent (`±`) once standardized.

## 2026-03-05: Election-history baseline chain guardrail
- User correction pattern: general-election deltas must never baseline against by-elections; by-elections must baseline on prior results for the same constituency set.
- Rule: keep separate prior-row chains per comparison bucket (`allRows` and `generalRows`).
- Implementation guardrail:
  1) general rows baseline only from `generalRows`.
  2) by-elections baseline from nearest prior row containing the same constituency set; fallback to nearest prior general row containing that set.
  3) recall petitions excluded from both baseline chains.
- Verification requirement for future edits:
  - add a targeted check on a party with both by-elections and general elections to confirm general `±` values do not change when by-election rows are present.

## 2026-03-05: Prototype table headers before rewiring live sortable tables
- User correction pattern: when a table header redesign is structurally complex, build and iterate a standalone mock first, then port the approved structure into the live renderer.
- Rule: for multi-row grouped-header changes, do not patch the live table blind.
- Guardrail:
  1) create a reviewable mock with the exact requested merge/colspan structure,
  2) only after approval, map live columns explicitly to grouped leaf-header indices,
  3) keep grouped mode opt-in per table to avoid broad regressions.

## 2026-03-05: Do not skip single-constituency `Northern Ireland` election files
- User correction pattern: history regressions can come from loader assumptions, not the visible table code.
- Rule: the generic election-results loader must not discard `Northern Ireland` constituency files, because some bodies use that as their only real constituency payload.
- Guardrail:
  1) when a constituency list contains `Northern Ireland`, attempt the fetch and let missing files fail naturally,
  2) verify entity-history aggregation on at least one European Parliament election after loader changes.

## 2026-03-05: Verify by-election labels and grouped headers at the rendered leaf level
- User correction pattern: grouped headers and by-election naming can look correct in config but still render incorrectly once leaf labels, sticky behavior, and event-specific naming are applied.
- Rule: after any grouped-table or by-election display change, verify the rendered leaf cells and the final visible row labels, not just the schema object.
- Guardrail:
  1) if grouped headers are used, confirm the bottom sortable/filterable leaf cells show the intended labels,
  2) if by-election naming is changed, verify both single-constituency and plural multi-constituency paths,
  3) if by-election deltas are blanked, enforce the blank in the renderer, not only in the data model.

## 2026-03-06: Grouped-header sticky fixes must be applied generically, not just on one table variant
- User correction pattern: grouped header fixes were applied only to history tables, leaving candidate tables with the same sticky-row defect.
- Rule: when a renderer feature (grouped headers) is shared, sticky-position overrides must be scoped to the shared grouped-table class, not one specific table subtype.
- Guardrail:
  1) place grouped header sticky overrides on .catalogue-detail__entity-table--grouped,
  2) explicitly neutralize left: 0 on lower grouped header rows so only the true first top-row header cell remains horizontally sticky,
  3) verify both the history table and candidate table after grouped-header CSS edits.

## 2026-03-06: Canonicalize constituency display labels before deduping candidate summary lists
- User correction pattern: the same DEA surfaced twice because one source used the clean DEA name and another used the same name with a seat-count suffix.
- Rule: when building candidate constituency summary lists, dedupe on a canonicalized display label, not the raw source string.
- Guardrail:
  1) strip seat-count suffixes like ñ 7 seats / (7 seats) before keying constituency summary entries,
  2) preserve only the canonical label in the rendered list,
  3) verify against at least one live JSON file that still contains seat-suffixed constituency names.

## 2026-03-06: Same-name identity merges must be constrained by party-history context, not bulk-applied blindly
- User correction pattern: some same-name candidates who look mergeable at a glance are actually distinct people (for example Trevor Clarke: DUP Coleraine local, DUP South Antrim, TUV West Tyrone).
- Rule: before approving a same-name merge, inspect the full party/constituency/year history across both local and non-local datasets.
- Guardrail:
  1) if the same name spans different parties or incompatible geography histories, treat it as a split candidate until explicitly approved,
  2) only bulk-remap names that have user approval or unambiguous same-party continuity,
  3) verify one preserved split case after every merge batch so a regression is caught immediately.

## 2026-03-06: Once a ZIP is explicitly waived by the user, do not keep surfacing it in the same workstream
- User correction pattern: the mandatory ZIP intake check can identify a ZIP that the user has already handled or explicitly wants ignored.
- Rule: after the user explicitly says to ignore a discovered ZIP, treat it as waived for the current task flow unless they reopen it.
- Guardrail:
  1) keep the ZIP intake tracker up to date,
  2) mention the ZIP once when the policy requires it,
  3) if the user says it is already dealt with, do not keep reintroducing it into subsequent status messages for the same workstream.

## 2026-03-06: Grouped-header visual fixes must include spacing verification at real rendered density
- User correction pattern: the grouped election-history header logic was structurally right, but visible gaps remained between the stacked header rows.
- Rule: after splitting a table header into multiple sticky/grouped rows, verify the rendered row heights and offsets as a visual system, not just the merge structure.
- Guardrail:
  1) tighten top offsets and row heights together,
  2) verify there are no visible seams between grouped header bands,
  3) keep the leaf-row controls intact while adjusting grouped-row spacing.

## 2026-03-06: Results-table header restructures must be designed per table, not generalized across unlike table shapes
- User correction pattern: a grouped-header structure that fit one NI-wide results table was applied to the other two, causing incorrect columns and row alignment.
- Rule: when changing live results-table headers, treat `By Party`, `By Candidate`, and `By Local Party` as separate schemas unless proven otherwise.
- Guardrail:
  1) verify each table's row data maps one-to-one to the proposed header leaf columns,
  2) preserve prior working structure for unaffected tables instead of forcing convergence,
  3) validate each NI-wide table against a screenshot or known-good layout before considering the change complete.

## 2026-03-06: When a grouped-header redesign is reviewed via a mock, implement the approved geometry literally in the live table
- User correction pattern: grouped results-table structures are sensitive to exact column groupings and naming.
- Rule: if a grouped-header design is approved from a static mock, promote that exact schema into the live renderer rather than reinterpreting it during implementation.
- Guardrail:
  1) map every live body column to an approved header leaf before coding,
  2) use the same group names and leaf labels as the reviewed mock,
  3) keep unrelated tables unchanged unless the user explicitly asks for parallel rollout.

## 2026-03-06: Grouped-header/table-schema work needs runtime-path verification, not just syntax checks
- User correction pattern: a live results tab stayed on the previous view because the new renderer threw at runtime even though syntax checks passed.
- Rule: after changing a live table renderer, verify all newly introduced display fields are defined on the runtime path, especially inside per-constituency/per-row loops.
- Guardrail:
  1) check every new interpolated field against its defining scope,
  2) do not rely on `node --check` alone for renderer work,
  3) treat "tab does not switch" as a likely render exception first, not a UI-state bug.

## 2026-03-06: In non-UTF-safe files, use ASCII for visible table header labels
- User correction pattern: literal non-ASCII plus/minus characters in a non-UTF-safe JS file rendered as replacement glyphs in live tables.
- Rule: for visible table header labels in files with known encoding instability, prefer ASCII equivalents like `+/-`.
- Guardrail:
  1) avoid introducing new non-ASCII header labels into js/election-controller.js,
  2) if a glyph matters visually, confirm the file encoding can preserve it before using it,
  3) when rendering corruption appears as `?`, inspect file encoding before debugging UI logic.

## Update 2026-03-06 (Encoding-Safe Label Replacements)
- In legacy/non-UTF-clean JS files, replace visible symbols like ± with ASCII labels such as +/-, then immediately grep for accidental operator corruption (??, ?., comparison chains) before considering the change complete.
- Verification rule: after any broad text replacement in a JS file, run g for both the intended replacement text and the nearby operator forms, then run 
ode --check on every touched JS file.

## 2026-03-06: Replacement-glyph audits must cover every live renderer file, not just the first file that reproduces the symptom
- User correction pattern: fixing one table-renderer file removed some malformed labels, but another live renderer still emitted literal ±, so the symptom persisted.
- Rule: when a text-rendering defect appears across multiple tables, audit all live renderer files that define table headers before declaring the fix complete.
- Guardrail:
  1) grep all live JS/CSS/HTML sources for the bad glyph and the intended replacement,
  2) distinguish live renderers from static mock pages,
  3) only mark the issue resolved after the grep shows no remaining live occurrences and syntax checks pass for all touched JS files.

## 2026-03-06: Shared table-header fixes must be verified across every live table variant that reuses the same label pattern
- User correction pattern: the election-history tables were fixed first, but the NI-wide By Party grouped header still had literal ± labels and continued to surface replacement glyphs.
- Rule: when fixing shared header-label rendering issues, audit By Party, By Candidate, By Local Party, and election-history tables separately even if they look visually similar.
- Guardrail:
  1) grep live renderer files after each fix,
  2) verify no remaining non-ASCII glyphs in js and ssets,
  3) only conclude after syntax checks pass and every affected table family has been re-audited.

## 2026-03-06: Encoding audits for table labels must include helper-built two-line headers, not just direct leaf-header calls
- User correction pattern: the remaining replacement glyph in By Count did not come from _resultsLeafTh(...); it came from _thTwoLine(...) labels built in a different table path.
- Rule: after fixing visible label glyphs in one table family, audit every header helper used by other table families before concluding the issue is closed.
- Guardrail:
  1) grep for malformed glyphs and also for all header helper call sites,
  2) inspect grouped, flat, and two-line header builders separately,
  3) verify no remaining live glyph sources in js and ssets after the final pass.

## 2026-03-06: Verify every tab-specific renderer path after shared table refactors
- Symptom: one results tab stayed blank or kept the previous tab visible after header/column changes.
- Cause: a renderer-specific code path referenced a variable that existed in a sibling loop but not in its own scope.
- Guardrail: after changing shared results-table structure, explicitly sanity-check all three renderers (By Party, By Candidate, By Local Party) for parse success and scope-local derived values before considering the task complete.

## 2026-03-06: Grouped results headers must keep leaf counts aligned and wrappers must not capture vertical sticky
- Symptom: grouped results tables showed unlabeled data bands and sticky headers failed to engage.
- Cause: top-row colspans were not matched by the leaf header row, and wrapper overflow: auto made the wrong element the sticky scroll container.
- Guardrail: whenever changing grouped results headers, count header leaf cells against body columns and keep .election-party-wrapper / .election-count-wrapper as horizontal-scroll containers only.

## 2026-03-06 Results aggregates and identity aliases
- When local-election aggregate percentages look impossible, audit the live JSON denominator before touching display math; Ballyarnett and Magherafelt had negative Valid_Poll, so the correct fix is a shared safe-valid-poll fallback rather than per-table patches.
- Never let NI-wide candidate/local-party aggregate builders ingest Candidate_Id = nontransferable; filter it at row collection time in both current and previous-election paths.
- For surname-change identity fixes, extend the canonical PersonID function at the shared election-entity layer, not a single UI table, so candidate pages and party summaries converge on the same ID.

## 2026-03-06 Candidate-row intake guardrail
- Do not treat every countGroup row with a Candidate_Id as a real candidate. Some local-election files contain placeholder pseudo-candidates named 'Party'. Add and reuse a shared row-validity predicate before candidate aggregation, comparison baselines, council summaries, and entity-index construction.

## 2026-03-07: Grouped-header helpers must not be reused across renderers unless they are in shared scope
- User correction pattern: the District `By Candidate` tab went blank after the grouped-header refactor even though syntax checks passed.
- Rule: when copying grouped-header markup between NI-wide and district renderers, verify every helper used by the template is defined in that renderer scope or moved to a shared controller method.
- Guardrail:
  1) after refactoring any tab renderer, grep its helper calls,
  2) confirm each helper is in scope for that function,
  3) then syntax-check and click-test the affected tab path before closing the task.

## 2026-03-07: District and constituency table fixes must reuse shared helpers instead of ad hoc local variants
- User correction pattern: fixing one District table regression exposed more issues in adjacent DEA/District table paths: undefined helper references, stale delta CSS classes, non-clickable geography cells, and `unknown` type labels from partially populated appearance data.
- Rule: when refactoring District/DEA table renderers, audit helper reuse across both scopes and prefer the controller's shared formatting/link utilities over local copies.
- Guardrail:
  1) grep the touched renderer for nonexistent helper names and obsolete CSS classes,
  2) ensure geography cells use `_renderElectionConstituencyFeatureLink(...)` when they should open feature pages,
  3) ensure candidate appearance records carry `electionType` at construction time,
  4) then run syntax checks before closing the fix.

## 2026-03-07: Local-election district tables must not trust unsuffixed filenames or raw status counts as canonical
- User correction pattern: a district-level table problem that looked like formatting (`N/A` deltas, `1/X` count values) was actually caused by missing previous local files and by preserving placeholder raw status counts over inferred lifecycle counts.
- Rule: when district local-election deltas or count columns look uniformly wrong, verify previous-result file loading and inferred lifecycle counts before touching the table formatter.
- Guardrail:
  1) local-government loaders must try seat-suffixed slug variants for DEA files,
  2) district candidate aggregates must prefer `_inferCandidateLifecycle(...)` results over raw status-derived counts,
  3) then syntax-check and retest district `By Party`, `By Candidate`, and `By Local Party` together.

## 2026-03-07: District local-election baselines must canonicalize constituency labels before aggregation
- User correction pattern: Mid Ulster district +/- values stayed N/A even after seat-suffixed file fallback existed, because the previous local results were still aggregated under suffixed constituency labels that could not match current unsuffixed district rows.
- Rule: when comparing local-election district rows across years, canonicalize constituency labels before any aggregate keying or council lookup, not only when rendering labels.
- Guardrail:
  1) normalize constituency names with _cleanConstituencyDisplayName(...) at the start of district aggregate building,
  2) use the canonical name for council lookup, candidate constituency assignment, local-party keys, and elected-member updates,
  3) verify known mixed-label cases like Mid Ulster 2019/2023 after syntax checks.

## 2026-03-07: District previous-row renderers must use canonical aggregate maps, not display-row scans
- User correction pattern: after canonicalizing local constituency labels in the aggregate, Mid Ulster District By Local Party still failed because the renderer kept matching previous rows by scanning the display array instead of using the already-canonical keyed map.
- Rule: once an aggregate exposes a canonical keyed map (partyMap, candidateMap, localPartyMap), renderer baseline lookups must use that map directly rather than reimplementing equality checks over display rows.
- Guardrail:
  1) prefer aggregate maps for all previous-row matching,
  2) only fall back to array scans when no canonical map exists,
  3) recheck known problem districts like Mid Ulster after any local baseline change.

## 2026-03-07: Constituency By Count must canonicalize previous DEA payload lookup and keep labels ASCII-only
- User correction pattern: the constituency By Count path still had malformed +/- glyphs and zero-baseline summary rows after similar fixes elsewhere, because it had its own header strings and its own direct-key previous payload lookup.
- Rule: when fixing constituency By Count output, patch both the visible header labels and the previous-payload lookup path; local DEA baselines are not safe if the lookup only uses raw constituency keys.
- Guardrail:
  1) keep By Count header labels ASCII-only in source,
  2) make _getPreviousConstituencyPayload(...) fall back through _cleanConstituencyDisplayName(...),
  3) verify a seat-suffixed local DEA like Clogher Valley after syntax checks.

## 2026-03-07: UI renderers must not restyle canonical election-type labels ad hoc
- User correction pattern: person history tables had correct election-type data but the UI lowercased it at render time, degrading Westminster and European into inconsistent labels.
- Rule: when the controller already provides canonical labels, render them directly and avoid cosmetic case transforms in the UI layer.
- Guardrail:
  1) keep election type casing canonical in data,
  2) avoid .toLowerCase() on user-facing election type labels,
  3) syntax-check both controller and UI after label-only changes.

## 2026-03-07: Local DEA label normalization must happen before NI-wide row construction
- User correction pattern: seat-suffixed DEA labels still surfaced in NI-wide local By Candidate rows even after district/local aggregate paths were already canonicalizing those labels.
- Rule: local constituency/DEA names must be normalized before they are assigned to display rows, not only during aggregate keying or later rendering.
- Guardrail:
  1) call _cleanConstituencyDisplayName(...) before assigning local DEA labels to NI-wide or district row objects,
  2) use the cleaned value for both display and council lookup,
  3) syntax-check after any local DEA label normalization change.

### 2026-03-07 Current constituency payload lookups must canonicalize local DEA names, not just previous-election baselines
- Symptom: Mid Ulster disappeared as a blank white area on the 2019 local-election map even though the tables had already been fixed.
- Root cause: current-result runtime paths for map colouring, overlays, and constituency panel access still used direct esultsByConstituency[constName] indexing, while Mid Ulster 2019 DEA payload keys are seat-suffixed but the active 2012 DEA map feature names are not.
- Permanent prevention action: use a shared helper for current constituency payload retrieval with _cleanConstituencyDisplayName(...) fallback, and route map/panel access through that helper instead of raw object indexing.
- Verification evidence: syntax checks passed after replacing the direct current-payload lookups, and the fix specifically covers _colourMap, _addOverlays, and _showConstituencyPanel.

### 2026-03-07 Current constituency payload lookups must canonicalize local DEA names, not just previous-election baselines
- Symptom: Mid Ulster disappeared as a blank white area on the 2019 local-election map even though the tables had already been fixed.
- Root cause: current-result runtime paths for map colouring, overlays, and constituency panel access still used direct esultsByConstituency[constName] indexing, while Mid Ulster 2019 DEA payload keys are seat-suffixed but the active 2012 DEA map feature names are not.
- Permanent prevention action: use a shared helper for current constituency payload retrieval with _cleanConstituencyDisplayName(...) fallback, and route map/panel access through that helper instead of raw object indexing.
- Verification evidence: syntax checks passed after replacing the direct current-payload lookups, and the fix specifically covers _colourMap, _addOverlays, and _showConstituencyPanel.

## 2026-03-07: Recovery plans for critical files must become evidence-constrained before implementation
- User correction pattern: a reconstruction plan that is merely sensible is still too weak when the file to be recovered is large, central, and already lost; the plan must prevent unsupported "reasonable reconstruction" before coding begins.
- Rule: before reconstructing a critical lost file, the plan must include and populate requirement-evidence mapping, superseded-decision tracking, function-level reconstruction mapping, priority tiers, and checkpoint/rollback rules.
- Guardrail:
  1) do not begin implementation until the baseline gap analysis and forensic ledger are populated,
  2) require every P0/P1 behavior to have an evidence row,
  3) record superseded decisions so earlier rejected UI/data choices cannot be reintroduced during recovery.

### 90) When a live browser session yields full source, restore from that artifact before reconstructing from older commits
- Mistake pattern: Treating an older git snapshot as the primary recovery source after a critical file was damaged, even though a newer browser-loaded copy was still available.
- Impact: Recovery planning drifts toward unnecessary reconstruction and higher regression risk.
- Guardrail:
  1) if DevTools yields a complete loaded source file, preserve it verbatim as the highest-priority recovery artifact,
  2) restore the damaged file from that artifact before doing any inferred rebuild work,
  3) syntax-check the restored file immediately to separate restoration defects from later edits.

### 91) Confirm the active local-results mode before diagnosing a map gap
- Mistake pattern: diagnosing a local-election blank area through the District aggregate path when the actual reproduction is in DEA mode.
- Impact: the first root-cause analysis can be directionally related but still miss the live failing path, delaying the real fix.
- Guardrail:
  1) when a screenshot is provided, verify which mode toggle is active before tracing the bug,
  2) separate DEA map-feature matching failures from District aggregate failures,
  3) for local-election geography bugs, cross-check the active FGB label values against the current result-key aliases before concluding.

### 92) Canonical geographic names should live in data; metadata belongs in structured fields
- Mistake pattern: storing seat-count suffixes inside DEA names and depending on UI normalization to recover the actual geography label.
- Impact: map matching, previous-result comparisons, and aggregate keying become fragile and can fail on encoding or dash-variant differences.
- Guardrail:
  1) emit canonical DEA names in generated JSON and elections_index.json,
  2) keep seat counts only in Number_Of_Seats or equivalent structured metadata,
  3) retain a temporary compatibility layer in the app until all generated data is canonical.

### 93) Sticky-table fixes must target the real vertical scroll container
- Mistake pattern: making table headers position: sticky while leaving an inner wrapper as the active vertical scroll container.
- Impact: headers appear non-sticky relative to the results pane even though sticky CSS exists.
- Guardrail:
  1) identify which element actually scrolls vertically before adjusting sticky headers,
  2) if the requirement is sticky relative to the pane, inner wrappers must not own vertical scrolling,
  3) for election tables, keep wrapper vertical overflow visible unless that wrapper is intentionally the scroll container.

### 94) By Count status counters must follow displayed count columns, not raw payload counts
- Mistake pattern: deriving Status denominators from all raw Count_Number values while the UI suppresses non-meaningful terminal counts.
- Impact: users see Count X/Y values that no longer correspond to the columns actually shown.
- Guardrail:
  1) when count columns are filtered, remap raw count numbers to a displayed count sequence,
  2) derive status numerators/denominators from the visible count model,
  3) treat terminal all-zero-transfer counts as display candidates to suppress unless a real event is inferred.

### 95) Do not share sticky-column geometry across results tables with different leading-column schemas
- Mistake pattern: reusing one sticky-column selector set across candidate, party, local-party, and count tables even though their first columns do not line up the same way.
- Impact: wrong columns become horizontally sticky, sticky offsets drift, and sticky body cells can cover grouped header labels.
- Guardrail:
  1) every results table family with a distinct leading-column schema must get its own table class for sticky geometry,
  2) grouped header z-index must always sit above sticky body cells,
  3) whenever adding sticky columns to a grouped table, verify the first two header rows separately from the body column offsets.

### 96) When removing horizontal stickiness from a grouped header cell, preserve its vertical sticky role explicitly
- Mistake pattern: using `position: static` to unstick a grouped header cell horizontally, which also disables the vertical sticky behavior inherited from the grouped header row.
- Impact: a header band can stop sticking entirely, while adjacent grouped cells still stick and create asymmetric scrolling bugs.
- Guardrail:
  1) for grouped results tables, horizontal unstick should be done with `left: auto` rather than removing `position: sticky`,
  2) any top-row grouped cell override must be validated in both axes: vertical pane stickiness and horizontal scroll behavior,
  3) if wrappers must stick relative to the pane, use pane-sticky wrapper variants consistently across all NI-wide grouped tables.

### 97) Adjacent renderer branches with similar grouped-table markup need explicit class-audit verification
- Mistake pattern: applying a sticky-layout class to one district renderer branch and then accidentally leaving or removing it on the neighboring branch with similar markup.
- Impact: one table inherits the other tableís sticky geometry, producing horizontally sticky columns in the wrong group.
- Guardrail:
  1) when two adjacent branches render similar grouped tables, verify the final class list for both branches after every sticky-layout edit,
  2) log the intended class ownership per renderer (`By Party` vs `By Local Party`) before patching,
  3) after edits, inspect both branch outputs side by side rather than assuming the first patch hit the live branch.

### 98) Every table-specific sticky profile must neutralize the next inherited top-row sticky cell when the shared base makes nth-child(4) sticky
- Mistake pattern: adding a custom sticky profile for the intended leading columns but forgetting that the shared count-table rule still makes the fourth top-row header cell horizontally sticky.
- Impact: the next grouped header block (for example `Candidates`) slides over the last intended sticky identity column.
- Guardrail:
  1) when a count-table sticky profile keeps only the first N columns sticky, explicitly override `th:nth-child(N+1)` in the top row,
  2) preserve vertical stickiness with `top: 0` while resetting horizontal position,
  3) verify horizontal scroll overlap on the first non-sticky grouped header immediately after each sticky profile change.

### 99) Table-specific sticky profiles must neutralize both header and body inheritance beyond the intended sticky columns
- Mistake pattern: fixing a shared top-row sticky leak for a table-specific profile but forgetting that the shared body-cell sticky rule still makes the next numeric column sticky.
- Impact: headers appear correct while body values still slide on top of the last intended sticky identity column.
- Guardrail:
  1) when a table-specific sticky profile keeps only the first N columns sticky, explicitly neutralize both `thead` and `tbody` for column `N+1`,
  2) verify horizontal scroll overlap separately for header cells and body cells,
  3) if a row-spanning identity header should be sortable/filterable, make it a leaf header with `data-leaf-col-idx` rather than a plain `<th>`.

### 100) When similar NI-wide renderer branches share geography-link calls, verify the exact active branch before patching
- Mistake pattern: patching the first matching geography-link call found in a neighboring renderer branch instead of the branch backing the reported table.
- Impact: the user-visible bug remains while a different table gets an unintended behavior change.
- Guardrail:
  1) when multiple branches share the same helper call, identify the active branch by nearby table schema or tab label before editing,
  2) after the patch, grep all matching helper calls to confirm only the intended branches changed,
  3) verify neighboring local/district branches still emit their original `level` values where required.

### 101) When fixing broken election geography links, validate the entire open-feature route rather than only the emitting renderer branch.
- Mistake pattern: I previously corrected the emitted `level` for non-local `By Local Party` constituency links, but the shared `openElectionConstituencyFeature(...)` path still depended on exact feature-name matching, so historical alias mismatches like `Belfast West` vs `West Belfast` continued to break the link.
- Guardrail: for any geography-link bug, audit and verify all three layers before closing the task:
  1) emitted link metadata (`body`, `date`, `constituency`, `level`),
  2) delegated click handler routing,
  3) map-feature resolver name matching against historical aliases.
- Permanent prevention: keep constituency-feature matching centralized in the shared resolver with variant-based matching instead of patching individual table branches.
- When `maps-to-be-added` archives are kept in-repo for workflow reasons, verify GitHub's 100 MB hard limit before attempting a push. If an archive has already been extracted and ingested, remove the archive from git tracking and add a narrow ignore rule instead of pushing it as a normal blob.

### 90) Exclusive election mode must suppress whole layers and share the standard load timer
- Mistake pattern: treating election exclusivity as a label-only concern and treating election loads as separate from the standard map-load feedback path.
- Impact: non-election layers can remain visually present under elections, and election load time becomes harder to measure consistently.
- Guardrail:
  1) when an election is visible, enforce exclusivity at full-layer visibility level, not just labels or z-order,
  2) any new election load path must go through the same start/finish load-feedback callbacks as normal map loads,
  3) verify one normal map load and one election load whenever the shared toast/timing path changes.

### 102) Group and member maps must resolve through one shared map-registry path everywhere
- Mistake pattern: some app entry points loaded grouped maps through UI-specific member/variant loops while other paths tried to load a group id directly or looked up feature-card metadata only from the currently loaded map list.
- Impact: visible grouped maps can show `Failed to load`, and feature info cards for child/member maps can fall back to `Unknown Layer` even though the underlying map metadata exists.
- Guardrail:
  1) all app entry points must load maps through one shared `App.loadMap(...)` path,
  2) `dataService.getMapById(...)` must be able to resolve hidden child maps and group members, not just visible top-level maps,
  3) feature-card source labels must fall back to registry lookup when the active loaded-map list does not contain the child map config.

### 103) Large-map LOD optimizations should be opt-in at the map config level, not silently global
- Mistake pattern: applying LOD-first file substitution generically to every FGB-backed map would create unnecessary failed-fetch retries for maps that do not have `-lod0` / `-lod1` siblings.
- Impact: ordinary maps could get slower or noisier while only a small set of historically large maps actually benefit.
- Guardrail:
  1) mark LOD-first maps explicitly in metadata (for example `useLOD: true`),
  2) keep the standard vector load path responsible for the fallback to the original FGB,
  3) verify the target `-lod0` / `-lod1` files exist before enabling the optimization for a map family.

### 104) When fixing map load failures, verify that the referenced assets are actually tracked and published, not just present locally
- Mistake pattern: treating a map-load bug as purely code-side after confirming files exist on disk, without checking whether the referenced asset directory is actually tracked in git and therefore available on the deployed site.
- Impact: a code fix can ship while the website still fails because the underlying FGB assets were never published.
- Guardrail:
  1) for any map-load failure, check both local existence and `git ls-files` / tracked publication state of the referenced files,
  2) do not close a map-load bug until the referenced asset paths are either tracked and pushed or intentionally redirected to tracked assets,
  3) distinguish clearly between local working-tree availability and deployed-site availability when diagnosing map-load problems.

### 105) Large chunked maps can still behave like full loads if the initial viewport already spans the whole dataset
- Mistake pattern: assuming chunked loading is sufficient by itself, even when the first viewport plus preload buffer intersects nearly every chunk in the index.
- Impact: users still see 100+ second first loads because the initial chunk pass degenerates into an all-at-once load.
- Guardrail:
  1) inspect chunk-count intersection at the real initial map extent before trusting a chunked design,
  2) for all-island low-zoom opens, prefer an overview LOD source over chunked detail,
  3) keep first detailed chunk preloads map-specific and small on very large datasets instead of reusing a generic large preload buffer.
