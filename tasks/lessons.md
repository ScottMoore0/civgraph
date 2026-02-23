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
