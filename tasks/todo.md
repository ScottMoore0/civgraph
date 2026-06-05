# Maximize Browse item detail and thumbnails
- [x] Record scope
  - User requested richer Browse pages so all available information is exposed for each item, and each item thumbnail is provided, including actual-size thumbnail display on item pages.
- [x] Inspect data and thumbnails
  - Locate thumbnail manifest/assets and identify where generated Browse records currently drop source fields.
- [x] Enrich generated data
  - Preserve raw/source metadata and add thumbnail metadata without bloating list indexes unnecessarily.
- [x] Improve Browse rendering
  - Add actual-size thumbnail panels, richer structured detail panels, and collapsible raw metadata for each item.
- [x] Verify
  - Run generation/build checks and inspect representative map/election/source detail output.
- [x] Review
  - Document implemented behavior and any remaining constraints.
  - Implemented manifest-backed thumbnails for maps/elections/features/sources, safe generated placeholders where no image asset exists, actual-size thumbnail panels, all-field tables, raw source metadata panels, richer source-file extraction, and person detail availability without adding thousands of static detail files.
  - Verification evidence: `node --check browse/browse.js`, `node --check scripts/build-browse-indexes.mjs`, `npm run build`, generated JSON spot checks for `deas-1972`, `data-2021-population-lgd`, `book-dea-prov-1992`, `dail-eireann__2024-11-29`, and browser smoke checks for `/browse/#/maps/deas-1972` and `/browse/#/persons/name-yes`.

# Normalize derived map-layer display titles
- [x] Record scope
  - User requested map layers whose names are derived values, usually dates, to display as `[catalogue card title] - [derived name]` in the active layers panel and Browse section.
- [x] Identify metadata paths
  - Locate where derived layer names and parent catalogue card titles are stored/generated, plus where active-layer and Browse titles are rendered.
- [x] Implement title rule
  - Apply the rule centrally enough that derived layer titles are consistent without changing non-derived map names.
- [x] Verify
  - Verified: `node --check js\data-service.js`, `node --check js\ui-controller.js`, and `node --check scripts\build-browse-indexes.mjs` passed. `npm run build` passed with approved escalation. Representative generated Browse titles after `node scripts\build-browse-indexes.mjs`: `deas-1972` -> `District Electoral Areas - 1972`, `wards-1972` -> `Wards - 1972`, `eds-roi-1921-05-03` -> `District Electoral Divisions - 03 May 1921`, `roi-local-authorities-1930` -> `Local Authorities - 1930`.
- [x] Review
  - Active-layer display now uses `dataService.getMapDisplayTitle()`; Browse generation mirrors the same card-plus-derived-name rule. Build-generated `data/browse` timestamp churn was reverted after verification because deployment regenerates those files from the updated script.

# Implement portal-style Browse landing page
- [x] Record scope
  - User requested the main pane of `/browse/` be structured more like Wikipedia's Contents/Portals page: compact directory landing, top-level portal sections, grouped link lists, and dense browsing rather than a card-heavy default page.
- [x] Add portal landing renderer
  - Completed: changed the empty `/browse/` route to render a Civgraph data directory landing page with counts, section jump links, and grouped portal sections for maps, elections, features, parties/labels, persons, and sources. Existing `#/maps`, `#/elections`, detail pages, and action links remain unchanged.
- [x] Add portal styling
  - Completed: added compact stats, jump links, section headers, three-column grouped link lists, and responsive one-column mobile layout.
- [x] Verify
  - Verified: `node --check browse\browse.js` passed; `npm run build` passed with the approved escalation needed for the local esbuild spawn. Browser smoke opened `http://127.0.0.1:8765/browse/` and confirmed the portal landing renders with totals and sections; opened `#/maps` and confirmed existing section routing still renders the Browse list flow.
- [x] Review
  - The landing page intentionally uses the manifest counts and curated section links instead of eagerly loading every Browse index, keeping the home route light. Build-generated `data/browse` JSON churn was reverted after verification so this change remains scoped to the Browse portal UI and task log.

# Implement Browse navigation on test2
- [x] Record scope
  - User clarified that the Browse/login entry point also needs to be exposed from `/test2`, not only the main shell.
- [x] Wire test2 navigation
  - Completed: added absolute `/browse/` links to the `/test2` desktop navbar and mobile menu so the route resolves to the site-wide Browse section rather than `/test2/browse/`.
- [x] Verify
  - Verified by checking `test2/index.html` for the desktop and mobile Browse links and running a syntax/build validation.
- [x] Review
  - Scope is intentionally limited to exposing the existing site-wide `/browse/` feature from `/test2`; no duplicate `/test2/browse/` app was created.

# Implement contributor login and Browse submissions
- [x] Record scope
  - User requested implementation of the login feature after the public read-only Browse section. Scope: authenticated contributor status, login/logout affordances, contributor-only edit/map-submission UI in `/browse/`, and a guarded review-queue submission endpoint. Public Browse remains read-only for unauthenticated users.
- [x] Add auth/status API
  - Implement Cloudflare Access-backed contributor detection via Pages Functions, with optional email allowlist env vars and login/logout URLs.
  - Completed: added `/_api/auth/status` plus shared Function auth helper using Cloudflare Access email/JWT headers, optional contributor/admin allowlists, local dev email overrides, and Access login/logout URLs.
- [x] Add submission API
  - Implement authenticated JSON proposal submission for metadata edits and map-upload requests. Store durably when a KV/R2/D1 binding is configured; otherwise fail explicitly rather than pretending to persist data.
  - Completed: added `POST /_api/contributions/submit` for authenticated `metadata-edit` and `map-submission` JSON proposals. It persists to configured KV/R2 bindings and returns an explicit `503` if no durable queue is configured.
- [x] Add Browse contributor UI
  - Show login/logout/status controls; reveal edit and map-submission controls only for allowed authenticated contributors.
  - Completed: added contributor panel, Cloudflare Access login/logout links, contributor-only propose-edit controls on detail pages, and a map submission form in `/browse/`.
- [x] Document deployment setup
  - Document Cloudflare Access policy, contributor allowlist env vars, and required review-queue binding.
  - Completed: added `docs/contributor-auth-and-browse-submissions.md` covering routes, Access setup, env vars, queue bindings, review workflow, and current upload limits.
- [x] Verify
  - Run syntax checks, Browse generation/build checks, and targeted browser smoke checks.
- [x] Review
  - Verified: `node --check functions/_api/_auth.js`, `node --check functions/_api/auth/status.js`, `node --check functions/_api/contributions/submit.js`, `node --check browse/browse.js`, `npm run build`, and `npm run check` all passed.
  - Browser smoke: opened local `/browse/` and `#/maps/east-west-bann`; confirmed the unauthenticated contributor panel shows a Cloudflare Access login link, Browse data still loads, and contributor-only edit controls stay hidden when unauthenticated. The local static server cannot exercise Cloudflare Access headers; production verification requires Access policy and queue binding configuration.

# Implement read-only Browse section
- [x] Record scope
  - User requested implementation of the agreed Browse section: maps, elections, features, parties/labels, persons, and books/tables/sources, with public browse pages and buttons back to the interactive map/election layer.
- [x] Build data indexes
  - Generate compact Browse indexes and detail JSON from existing map database, election manifests/results, party IDs, person IDs, and books/source metadata.
  - Completed: added `scripts/build-browse-indexes.mjs`, generating `data/browse/index.json` plus maps, elections, features, parties, persons, and sources indexes. Output currently covers 821 map/data entries, 268 elections, 94 feature groups / 63,874 feature records, 759 parties/labels, 13,892 persons, and 1,019 sources.
  - Deployment guardrail: person browsing uses the compact `persons.json` index instead of per-person files, keeping Browse output to 2,874 files rather than 16,764.
- [x] Build Browse UI
  - Add `/browse/` shell and client app with category lists, search, detail views, and open-in-map/open-election links.
  - Completed: added `browse/index.html`, `browse/browse.css`, and `browse/browse.js`. The UI supports the six agreed entity groups, search, list/detail views, lazy feature-map loading from spatial-index sidecars, and action links back to the main interactive map.
- [x] Wire navigation/build
  - Add Browse navbar link and integrate Browse generation into build scripts where sensible.
  - Completed: added Browse links to the main desktop and mobile nav and the About page nav. Added `build:browse` and made `npm run build` generate Browse data before bundling.
- [x] Verify
  - Run syntax checks, Browse index generation, site build checks, and focused smoke tests.
- [x] Review
  - Verified: `node --check scripts/build-browse-indexes.mjs`, `node --check browse/browse.js`, `node scripts/build-browse-indexes.mjs`, `npm run build` (rerun with approved escalation for esbuild spawn), and `npm run check` all passed.
  - Browser smoke: opened `http://127.0.0.1:8765/browse/`, `#/elections/dail-eireann__2024-11-29`, `#/maps/east-west-bann`, and `#/features/east-west-bann`; verified generated counts, detail rendering, mobile layout, unique generated slugs, and main-route action URLs such as `/#layers=election-dail-eireann-2024-11-29`.

# Feasibility review: login/logout and Browse static data section
- [x] Scope
  - User asked for feasibility of user login/logout and a navbar Browse link for static browsing of election, party, person, map, and related data.
  - Clarification: login is intended for selected users to edit Browse entries and submit maps for upload.
- [x] Review current site/data structure
  - Inspected the main shell/navbar, `js/data-service.js`, map database manifests, election package data, `/test2` election manifests, and Cloudflare Pages Functions.
- [x] Explain feasibility
  - Conclusion: a generated static Browse section is highly feasible and fits the current architecture; login/logout is feasible through Cloudflare Pages Functions plus an identity provider, but should be deferred until there is a concrete account-backed feature.
  - Revised conclusion after clarification: authenticated contributor workflows are feasible and justified, but should use a review queue rather than letting users directly mutate production static data or upload live map assets.

# Implementation plan: Browse plus authenticated contribution workflow
- [x] Scope
  - User requested a maximally detailed, fully derisked implementation plan for read-only Browse, login/logout, contributor edits, and map submissions.
- [x] Plan
  - Provide architecture, phases, data model, workflows, validation, security controls, deployment strategy, risks, and acceptance criteria.

# Wire /test2 election pane through main-pane contract
- [x] Record scope
  - User request: proceed as far as sensible and feasible after repeated election-pane parity drift, preserving MapLibre in `/test2`.
  - Scope: amend `/test2` so visible election pane rendering enters through a main-like pane contract; keep MapLibre-specific map styling, labels, hover/selection, seat circles, and overlays in `/test2` map/election code.
- [x] Inspect current drift
  - Completed: `/test2` had a shared renderer, but `Test2ElectionManager` still duplicated the visible header, overall pane, selected-area pane, and entity-pane entrypoints. This allowed candidate/count/entity fixes to keep diverging from the main pane contract.
- [x] Wire main-pane contract
  - Added `test2/src/election-pane-main-contract.js` and made `Test2ElectionManager` delegate visible election pane header, overall, selected-area, and entity rendering through that contract.
- [x] Add guardrails
  - Updated static `/test2` route validation and browser tests so visible election panes must expose the main-pane contract marker and use the contract entrypoints.
- [x] Verify
  - Passed syntax checks for the changed modules, `npm run check:test2`, `npm run build:test2`, focused Playwright election-pane checks, and the full `/test2` browser suite: 27 passed.
- [x] Review
  - MapLibre remains preserved in `/test2`; map drawing, hover/selection, labels, and seat-circle placement remain in the MapLibre adapter/election manager boundary. Remaining parity work should now happen by tightening the contract, not by adding independent pane branches.
  - Document what was completed and any remaining sensible limits.

# Feasibility of copying main election pane into /test2
- [x] Record scope
  - User request: explain whether the main site's election pane functionality can be copied and slotted into `/test2` as-is after remaining parity discrepancies.
- [x] Inspect relevant code structure
  - Completed: main election logic is concentrated in `js/election-controller.js` at about 6998 lines and still mixes pane rendering, domain transformations, URL/entity state, Leaflet layers, Leaflet bounds, and DOM overlays. `/test2` uses a separate `Test2ElectionManager` at about 2892 lines plus a 462-line shared renderer, so current parity drift is caused by duplicated pane contracts.
- [x] Review
  - Completed: direct copy-as-is is not feasible because the main controller depends on Leaflet and main app globals, but copying/extracting the pane half behind a small host adapter is feasible and is the right route for exact parity.

# Implement full election pane parity extraction for /test2
- [x] Record scope
  - User request: do the proposed steps 1-4 now: extract/mirror main election pane rendering, make `/test2` render from that normalized pane contract, keep MapLibre-specific behaviour at the final map layer, and expand parity tests.
  - Scope: main remains the fixed reference; implementation should amend `/test2`/shared/test paths, not change main's visible behaviour except for safe shared code additions if unavoidable.
- [x] Inspect current render paths
  - Completed: confirmed `/test2` still had candidate/count panes driven by route-specific normalized data rather than the same main-like pane contract. The Dail 2024 candidate pane was the clearest failing state because main's legacy scraper/pseudo-count semantics produced different visible first-row values.
- [x] Implement fuller renderer alignment
  - Completed: added shared election-domain generation for main-like candidate summaries, carried those sidecars into `/test2` election bundles, and made `/test2` candidate/count panes render from those main-like view models where available.
- [x] Isolate MapLibre-specific controls
  - Completed: moved MapLibre map display controls outside the canonical main-like results section, keeping the election pane surface focused on the main-compatible result/table contract while preserving MapLibre-only drawing/selection code at the map boundary.
- [x] Add tests/guardrails
  - Completed: expanded static validation and browser coverage so `/test2` Dail candidate rows are compared against the public main-site DOM, and so count pane markup uses the main-like detail-toggle/table contract rather than the old `/test2` toolbar.
- [x] Verify
  - Completed: `node --check js/election-domain.mjs`, `node --check scripts/build-test2-election-manifest.mjs`, `node --check test2/src/election-manager.js`, `node --check tests/browser/test2-app.spec.js`, `node --check scripts/validate-test2-route.mjs`, `npm run check:test2`, `npm run build:test2`, `npx playwright test tests/browser/test2-app.spec.js --grep candidate`, and `npx playwright test tests/browser/test2-app.spec.js --grep "local-government aggregates"` all passed. Build and browser runs required approved escalation for local binary/browser spawning.
- [x] Review
  - Completed: `/test2` now has generated main-like candidate sidecars and stricter pane parity tests for candidate/count states. Remaining parity work, if any, should be found by adding more public-DOM comparisons for additional election types rather than by inspecting private main controller internals.

# Investigate remaining main vs /test2 election pane differences
- [x] Record scope
  - User request: investigate why visible differences remain between the election pane on main and `/test2`.
  - Scope: compare multiple election-pane states beyond the existing Dáil 2024 overall party-table guardrail, identify remaining differences, classify root causes, and report findings. No fix requested yet.
- [x] Compare representative pane states
  - Completed: inspected main candidate, local-party, selected constituency, count, recall, entity, and animation render branches against `/test2` and the shared renderer. The current browser parity coverage is narrow: it covers the Dáil 2024 overall party table state, not the broader pane family.
- [x] Identify differences
  - Completed: remaining differences are mostly pane-rendering/template/domain differences, not MapLibre map-engine differences. Candidate, local-party, selected-area, count, recall/entity, local-government, and animation branches still contain `/test2`-specific markup or simplified domain logic.
- [x] Review
  - Completed: investigation shows the previous shared-renderer refactor created a shared entrypoint and main-compatible adapters for key visible paths, but it did not extract the full canonical main election pane renderer. Full parity requires moving the remaining main branches into an engine-neutral renderer and expanding DOM parity tests across all pane states.

# Shared election pane renderer refactor for /test2 parity
- [x] Record scope
  - User request: implement the structural alignment plan so `/test2` uses the same election pane contract as the main site, while keeping MapLibre-specific behaviour confined to map drawing and selection.
  - Scope: inspect existing main/shared election render paths, extract or reuse engine-neutral pane rendering where feasible, wire `/test2` toward that renderer, add parity guardrails, and verify. Main remains the fixed reference.
- [x] Inspect current shared/main/test2 election render paths
  - Identify current shared modules and remaining `/test2`-specific render branches.
  - Completed: main uses `js/election-controller.js` as the canonical live pane, while `/test2` had a mix of shared-renderer fallback and route-specific visible pane branches. The best safe extraction point was the shared renderer entrypoint plus explicit main-compatible host adapters.
- [x] Implement shared pane alignment
  - Move reachable `/test2` pane rendering toward the main-compatible renderer/view-model instead of route-specific markup.
  - Completed: `SharedElectionRenderer` now supports `renderMainCompatibleOverallResults` and `renderMainCompatibleConstituencyResults` host adapters; `/test2` visible overall/selected election pane rendering now enters through the shared renderer and delegates to those main-compatible adapters.
- [x] Preserve MapLibre-only responsibilities
  - Keep polygon styling, labels, hover/selection, seat circles, and viewport logic in `/test2` map/election manager code.
  - Completed: MapLibre-specific drawing, style, overlay, seat-circle, feature matching, and viewport logic remain in `/test2` manager/adapter code; the change only affects pane-rendering entrypoints and renderer validation.
- [x] Add guardrails
  - Add tests/static validation proving `/test2` uses main-compatible pane classes/structure for representative election views.
  - Completed: `scripts/validate-test2-route.mjs` now asserts that shared renderer supports the main-compatible host adapters and that `/test2` visible overall/selected pane rendering enters through `this.sharedRenderer`.
- [x] Verify
  - Run syntax checks and focused `/test2` validation/tests.
  - Completed: `node --check js/election-renderer.mjs`, `node --check test2/src/election-manager.js`, `node --check scripts/validate-test2-route.mjs`, `npm run check:test2`, `npm run build:test2`, focused Playwright parity test `npx playwright test tests/browser/test2-app.spec.js --grep "Dail 2024 election pane"`, and full `npm run test:browser:test2` all passed. Build and Playwright needed approved escalation for local process/browser spawning.
- [x] Review
  - Summarize what changed, what remains, and verification evidence.
  - Completed: `/test2` is now structurally closer to using the same election pane contract: shared renderer entrypoints own the visible overall/selected pane flow, while route-specific main-compatible host adapters provide the current main-parity table markup. Remaining full parity work is further extraction of every main special-case branch into true engine-neutral renderer modules, not more map-engine work.

# Election pane main vs /test2 parity review
- [x] Record scope
  - User request: review the election pane for the main site versus `/test2`, and explain how to maximally align the `/test2` election pane to the main site.
  - Scope: compare current main election pane rendering/domain logic with `/test2` election pane rendering, identify remaining parity gaps, and recommend feasible/sensible alignment steps. No code changes requested in this task.
- [x] Inspect main election pane
  - Review main election controller/domain/renderer/style paths.
  - Completed: main still renders the canonical pane through `js/election-controller.js`, including bespoke overall, selected constituency, council/district, count, recall-petition, entity, sort/filter, and animation branches.
- [x] Inspect `/test2` election pane
  - Review `/test2` election manager, adapter, tests, and relevant styles.
  - Completed: `/test2` uses `test2/src/election-manager.js` plus shared helpers, but still has route-specific pane renderers, `test2-*` wrapper classes, local mode controls, map-display controls, and generated bundle assumptions.
- [x] Compare parity
  - Compare pane structure, tables, tabs, controls, selected-feature state, timeline, URL state, and data assumptions.
  - Completed: the remaining drift is caused by duplicated/adapted pane rendering rather than a single engine-neutral renderer shared by main and `/test2`.
- [x] Review
  - Summarize findings and alignment plan.
  - Completed: maximal alignment requires extracting/mirroring the main election pane view-model and renderer, then keeping MapLibre-specific logic only at the final map drawing/selection layer.

# /test2 compass control and timeline date parity
- [x] Record scope
  - User request: restore the compass button by the zoom buttons on the interactive map, and change the timeline slider date format to `DD MMM YYYY`.
  - Scope: `/test2` map controls, timeline display formatting, rebuilt `/test2` output if needed, and focused verification. Main remains the fixed reference.
- [x] Inspect map-control and timeline code
  - Locate where `/test2` replaces MapLibre controls with main-style controls and where the timeline date label is rendered.
  - Completed: `/test2` creates custom main-style controls in `test2/src/maplibre-main-adapter.js`, and timeline labels are rendered through `test2/src/app.js`.
- [x] Restore compass control
  - Add a main-style compass/reset-bearing button beside the custom zoom controls without reintroducing control overlap.
  - Completed: added a `leaflet-control-compass` button to the custom control with reset-north/reset-pitch behaviour and route-scoped styling.
- [x] Change timeline format
  - Render timeline labels as `DD MMM YYYY`.
  - Completed: timeline items now pass through a central formatter that handles timestamps, years, ISO dates, election dates, and labels as `DD MMM YYYY`.
- [x] Verify
  - Run syntax checks, `/test2` validation/build, and focused browser/static checks where practical.
  - Completed: `node --check test2/src/app.js`, `node --check test2/src/maplibre-main-adapter.js`, `node --check tests/browser/test2-app.spec.js`, `node --check scripts/validate-test2-route.mjs`, `npm run check:test2`, `npm run build:test2`, focused Playwright checks for map controls and election timeline, and the full `npm run test:browser:test2` suite all passed. Build/browser runs required approved escalation for local binary/browser spawning.
- [x] Review
  - Summarize behaviour and residual limits.
  - Completed: `/test2` now has a visible compass/reset-north button in the main-style zoom control, and timeline labels render as `DD MMM YYYY`.

# /test2 election layer feature-label suppression
- [x] Record scope
  - User request: make feature labels for an election layer not show when the election layer is loaded.
  - Scope: `/test2` election layer label handling, route validation/browser guardrails, rebuilt `/test2` output if needed, and verification. Main remains the fixed reference.
- [x] Inspect label/election paths
  - Check where `/test2` applies election styles and where ordinary MapLibre/DOM feature labels are controlled.
  - Completed: `/test2` election loading applies a `labelMinZoomOverride` through the MapLibre adapter, allowing ordinary feature labels to appear on active election layers.
- [x] Implement suppression
  - Suppress ordinary feature labels while an election layer is loaded, without affecting election-specific seat circles, vote bars, recall labels, or the results pane.
  - Completed: election styling now passes `hideLabels: true` through the `/test2` MapLibre adapter, which stores/restores the layer's previous label-enabled state and hides ordinary feature labels for the active election geography.
- [x] Add guardrails
  - Add static/browser coverage proving ordinary feature labels remain hidden for loaded election layers.
  - Completed: route validation now requires the election label suppression path, and the representative election browser test expects zero visible `.maplibre-dom-label` elements while still selecting a feature from geometry.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and focused browser tests.
  - Completed: `node --check test2/src/election-manager.js`, `node --check test2/src/maplibre-main-adapter.js`, `node --check tests/browser/test2-app.spec.js`, `node --check scripts/validate-test2-route.mjs`, `npm run check:test2`, `npm run build:test2`, focused representative election Playwright coverage, and the full `npm run test:browser:test2` suite all passed. Build/browser runs required approved escalation for local binary/browser spawning.
- [x] Review
  - Summarize behaviour and residual limits.
  - Completed: active `/test2` election layers now suppress ordinary geography feature labels while preserving election-specific overlays and geometry-based feature selection. The adapter restores the previous label-enabled state when election styling is cleared.

# /test2 election sort/filter menu viewport containment
- [x] Record scope
  - User request: make `/test2` election results sort/filter panes stay wholly within the browser window where possible when a sort/filter button is clicked.
  - Scope: `/test2` election filter menu positioning, max-height/overflow behaviour, browser/static guardrails, rebuilt `/test2` output if needed, task notes, and verification. Main remains the fixed reference.
- [x] Inspect current positioning
  - Check current menu left/top calculation and CSS constraints to identify why the menu can spill out of the viewport.
  - Completed: the menu is fixed-position but the old placement mixed in `scrollX`/`scrollY`, measured before values rendered, and had no viewport-aware menu/value-list height cap.
- [x] Implement containment
  - Clamp menu left/top against viewport edges, constrain width/height on small screens, and make value lists scroll when the available viewport space is tight.
  - Completed: `/test2` now positions filter menus with viewport coordinates, clamps width/height, makes the values list internally scrollable, and repositions on resize/scroll plus value-search rerenders.
- [x] Add guardrails
  - Add browser coverage that opens the menu near constrained viewport edges and asserts it remains inside the viewport.
  - Completed: browser tests now assert `.election-filter-menu` bounds against the viewport in normal and constrained mobile-sized viewports, and static validation requires the viewport-clamping path.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and focused browser tests.
  - Completed: `node --check test2/src/election-manager.js`, `node --check tests/browser/test2-app.spec.js`, `node --check scripts/validate-test2-route.mjs`, `npm run check:test2`, `npm run build:test2`, and `npm run test:browser:test2` all passed. Build/browser verification required approved escalation for local binary/browser spawning.
- [x] Review
  - Summarize containment behaviour and remaining edge-case limits.
  - Completed: sort/filter panes now remain within the viewport where possible, with internal value-list scrolling on constrained screens. Remaining limit: extremely tiny browser windows can force the menu to use the minimum viable height/width, but it still clamps to the visible viewport.

# /test2 election results sort/filter parity
- [x] Record scope
  - User request: change `/test2` election results pane sort buttons so they have the same functionality as the sort/filter buttons in the main election results pane.
  - Scope: `/test2` election party/count table controls, menu/filter/sort behaviour, active state, guardrails/tests, verification, and review. Main remains the fixed reference and must not be edited.
- [x] Compare main and `/test2` controls
  - Inspect main `js/election-controller.js` table controls and current `/test2` `test2/src/election-manager.js` controls.
  - Completed: main has full menu-based sort/filter controls with value search, select all/deselect all, clear/apply filter, reset sort, active state, and asc/desc/default arrows; `/test2` only cycles sort direction on direct button clicks and has no filter menu.
- [x] Implement main-parity controls
  - Replace the simplified `/test2` table-control implementation with the main-style menu/filter/sort behaviour, adapted only where MapLibre/test2 table markup requires it.
  - Completed: `/test2` now builds each election party/count table header into the main-style `.election-th-controls` structure, opens `.election-filter-menu`, supports numeric/ordinal/text sort labels, reset sort, value search, select all, deselect all, clear filter, apply filter, active/open button states, and outside/Escape dismissal.
- [x] Add guardrails
  - Tighten static validation and browser coverage so `/test2` cannot regress to sort-only table buttons.
  - Completed: static validation now requires menu/filter primitives, and the `/test2` browser test opens a numeric sort menu, applies descending sort, opens a party filter menu, filters to Sinn Féin, and clears the filter.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and focused browser tests.
  - Completed: `node --check test2/src/election-manager.js`, `node --check tests/browser/test2-app.spec.js`, `node --check scripts/validate-test2-route.mjs`, `npm run check:test2`, `npm run build:test2`, and `npm run test:browser:test2` all passed. Build/browser runs required approved escalation for local binary/browser spawning.
- [x] Review
  - Summarize implemented parity, verification evidence, and any residual limits.
  - Completed: `/test2` now mirrors the main election results table sort/filter control contract while keeping the MapLibre-specific map implementation untouched.
- [x] Recurring issue prevention
  - Symptom: `/test2` table buttons visually resembled main but did not expose the main sort/filter menu.
  - Root cause: parity work previously checked button presence and sort behaviour, not the complete interaction contract.
  - Permanent prevention action: route validation asserts the menu/filter primitives, and browser coverage exercises numeric sort plus text filtering.
  - Verification evidence: full `/test2` Playwright suite passed with the new menu/filter assertions.

# /test2 live seat-circle pan anchoring
- [x] Record scope
  - User request: fix `/test2` so election seat-circle DOM overlays remain positioned over their respective features while the user pans the MapLibre map, matching the main site's Leaflet marker behaviour.
  - Scope: live overlay positioning during `move`/`zoom`/`render`, retaining expensive collision rebuilds on `moveend`/`zoomend`, tests/guardrails, rebuilt `/test2` output if needed, and lesson/task notes. Main remains the fixed reference and must not be changed.
- [x] Inspect current overlay behaviour
  - Confirm whether `/test2` stores map anchors per DOM group and whether camera movement updates positions before `moveend`.
  - Completed: `/test2` wrote one-time `left/top` pixel positions into an absolute overlay and only rebuilt on `moveend`/`zoomend`, so active panning moved the MapLibre map while the seat-circle DOM stayed behind.
- [x] Implement live anchoring
  - Store each seat-circle group's longitude/latitude anchor in DOM/state and update existing DOM group `left/top` positions through a requestAnimationFrame-throttled live-position pass on MapLibre camera movement.
  - Keep full collision/group rebuilds on final movement events only.
  - Completed: replaced the fixed overlay positioning with MapLibre-managed DOM `Marker` instances using the same main-style `.election-seat-circle`, `.seat-group`, and `.seat-dot` markup. Collision/group rebuilds still happen on movement end; MapLibre now keeps the DOM groups anchored continuously during pan/zoom.
- [x] Add guardrails
  - Add static and browser coverage proving `/test2` has a live positioning path and that DOM seat circles move when the map centre changes.
  - Completed: route validation now requires map-anchored DOM markers, geographic anchors, marker cleanup, and no MapLibre circle paint fallback. Browser coverage now checks that a seat-circle group's DOM centre stays within 3px of its projected anchor before, during, and after an animated pan.
- [x] Verify
  - Run syntax checks, `/test2` route validation, build, and focused browser tests.
  - Completed: `node --check test2/src/election-manager.js`, `node --check tests/browser/test2-app.spec.js`, `npm run check:test2`, `npm run build:test2`, focused pan test, and the full `npm run test:browser -- tests/browser/test2-app.spec.js` suite all passed. Build/browser runs required approved sandbox escalation for local binary execution.
- [x] Review
  - Summarize what now matches main and any remaining MapLibre/anchor-sidecar limits.
  - Completed: `/test2` now has main-like pan behaviour because seat-circle DOM groups are anchored by the map engine rather than manually positioned in a static overlay. Remaining possible differences are only anchor-source/collision differences, not pan drift.

# /test2 seat-circle zoom behaviour parity
- [x] Record scope
  - User request: align `/test2` election seat-circle zoom behaviour to the main site insofar as feasible and sensible.
  - Scope: `/test2` seat-circle extent hiding, projected bounds, greedy collision ordering, rebuild timing, guardrails, rebuilt `/test2` output if needed, and task notes. Main remains the fixed reference.
- [x] Inspect current algorithms
  - Compare main Leaflet `_renderOverlays()` with `/test2` `renderSeatCircles()` and `filterOverlayGroupsByCollision()`.
  - Completed: main uses a 120px total-extent cutoff, largest-first projected-area ordering, and 4px greedy collision spacing after projecting live Leaflet bounds. `/test2` was close but used a looser bounding-box collision helper and different projected-corner handling.
- [x] Implement algorithm parity
  - Mirror main's total-extent hide rule, largest-first pixel-area ordering, 4px greedy collision margin, and fixed-size DOM dot rendering.
  - Keep MapLibre-specific projection/rendering isolated to the final `/test2` DOM overlay step.
  - Completed: `/test2` now uses named main-style constants, NE/SW projected bounds, largest-first sorting, and center-distance greedy collision math. Seat dots remain fixed DOM dots with the main black inner stroke plus white halo.
- [x] Implement rebuild timing parity
  - Rebuild after final map camera events and prevent duplicate overlapping rebuilds from paired `zoomend`/`moveend` events.
  - Completed: overlay refreshes are now coalesced through `scheduleElectionOverlayRefresh()` so paired MapLibre camera events do not create overlapping DOM rebuilds.
- [x] Update guardrails
  - Add or tighten static/browser checks for main-style collision constants, projected bound logic, and zoom-level DOM overlay behaviour.
  - Completed: `/test2` route validation now checks the seat-circle constants, coalesced refresh path, NE/SW projection, and main-style collision math. Browser coverage samples election seat-circle DOM overlays across several zoom levels.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and focused browser tests.
  - Completed: `node --check test2/src/election-manager.js`, `node --check tests/browser/test2-app.spec.js`, `node --check scripts/validate-test2-route.mjs`, `npm run check:test2`, `npm run build:test2`, and `npm run test:browser -- tests/browser/test2-app.spec.js` all passed. Build and browser tests required approved sandbox escalation for local binary execution.
- [x] Review
  - Summarize what now matches main and what remains limited by MapLibre projection/generated anchors.
  - Completed: behaviour is now aligned on the feasible mechanics: fixed DOM dots, black-plus-white halo, 120px extent cutoff, 4px greedy collision margin, largest-first ordering, and coalesced rebuild timing. Remaining possible differences are exact anchor positions where `/test2` uses generated sidecar anchors/MapLibre projection rather than main's live Leaflet geometry path.

# /test2 seat-circle black stroke plus white halo
- [x] Record scope
  - User request: update `/test2` election seat circles so each dot has a black outline with a white outline around it, matching the main site, and compare zoom behaviour on main versus `/test2`.
  - Scope: `/test2` DOM seat-dot CSS, static/browser guardrails, rebuilt `/test2` output if needed, zoom-behaviour review, and task notes. Main site remains the fixed reference.
- [x] Inspect current styling and main reference
  - Compare current `/test2` DOM seat-dot styling with the main site's `.seat-dot` CSS.
  - Completed: main uses `.seat-dot { border: 1px solid rgba(0, 0, 0, 0.6); box-shadow: 0 0 0 1px #fff, 0 0.5px 2px rgba(0, 0, 0, 0.15); }`; `/test2` had a black-only outline/shadow from the previous change.
- [x] Implement visual parity
  - Apply main-style black inner stroke plus white outer halo to `/test2` DOM seat dots.
  - Update validation and browser tests so future changes cannot regress back to a black-only halo.
  - Completed: `/test2` DOM seat dots now use the main black inner stroke plus white outer halo; static and browser tests assert both the black border and the white halo.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and focused browser tests.
  - Completed: `node --check tests/browser/test2-app.spec.js` passed; `npm run check:test2` passed; `npm run build:test2` passed after approved esbuild escalation; `npm run test:browser -- tests/browser/test2-app.spec.js` passed 24/24 after approved Playwright escalation.
- [x] Compare zoom behaviour
  - Review main Leaflet DOM marker rebuild mechanics and `/test2` MapLibre-plus-DOM overlay rebuild mechanics while zooming.
  - Completed: main rebuilds Leaflet `L.divIcon` markers on `zoomend`; `/test2` rebuilds an absolute DOM overlay on `zoomend` and `moveend`. The new browser guardrail samples `/test2` at zooms 5.5, 6.5, 7, 8.4, and 9.5 and confirms countable DOM groups, fixed 12px dots, black stroke, and white halo.
- [x] Review
  - Summarize implementation, verification, and remaining zoom/engine differences.
  - Completed: ready to report that the visible dot outline styling now matches main, while exact placement/count transitions can still vary slightly because main computes live Leaflet bounds/centroids and `/test2` uses MapLibre projection plus generated anchor sidecars.

# /test2 DOM election seat-circle overlays
- [x] Record scope
  - User request: implement DOM overlays for `/test2` election seat circles so they match main Leaflet seat-circle mechanics more closely while preserving MapLibre as the map engine.
  - Scope: `/test2` election overlay rendering, DOM/CSS parity, browser/static guardrails, rebuilt `/test2` output if needed, and task notes. Main site remains read-only reference.
- [x] Inspect current `/test2` rendering
  - Locate MapLibre circle-layer seat-circle code, tests, and validation checks that assume `test2-election-seat-layer`.
  - Completed: `/test2` previously rendered election seat circles through `test2-election-seat-source`, `test2-election-seat-halo-layer`, and `test2-election-seat-layer`; browser/static checks asserted those MapLibre layers.
- [x] Implement DOM overlay
  - Replace MapLibre seat-circle source/layers with an absolute DOM overlay using `.election-seat-circle`, `.seat-group`, and `.seat-dot` markup.
  - Recompute on election overlay render, `zoomend`, and `moveend`; support click/keyboard behavior for constituency and local aggregate groups.
  - Completed: `test2/src/election-manager.js` now projects seat-circle group anchors into an absolute `#test2-election-seat-overlay`, renders main-style DOM groups/dots, keeps click and keyboard activation, exposes deterministic overlay state for tests, and removes legacy MapLibre circle layers.
- [x] Update guardrails
  - Change route validation and browser tests to assert DOM seat groups, dot counts, black outline styling, and removal when switching to bar overlays.
  - Completed: `scripts/validate-test2-route.mjs` and `tests/browser/test2-app.spec.js` now assert DOM overlay markup, dot counts, black outline styling, no legacy MapLibre seat-circle layers, and cleanup when switching overlays.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and focused browser tests.
  - Completed: `node --check` passed for changed JS/test files; `npm run check:test2` passed; `npm run build:test2` passed after approved esbuild escalation; `npm run test:browser -- tests/browser/test2-app.spec.js` passed 23/23.
- [x] Review
  - Summarize implemented DOM-overlay behavior and any remaining MapLibre-specific limits.
  - Completed: `/test2` now keeps MapLibre for the map engine but uses DOM seat-circle overlays closer to the main site's Leaflet/CSS mechanics. Remaining possible differences are anchor-source differences and WebGL polygon/label rendering, not seat-circle paint-layer mechanics.

# Main vs /test2 seat-circle zoom comparison
- [x] Record scope
  - User request: compare how election seat circles display while zooming on the main site versus `/test2`.
  - Scope: analysis only unless a later fix is requested; inspect main Leaflet logic, `/test2` MapLibre logic, and runtime behaviour if feasible.
- [x] Inspect implementation
  - Compare main Leaflet DOM marker seat-circle rendering with `/test2` MapLibre source/layer rendering.
  - Identify whether zoom changes recompute seat-circle anchors, offsets, visibility, and collision handling.
  - Completed: main uses Leaflet `L.divIcon` marker groups rebuilt on `zoomend`; `/test2` uses MapLibre GeoJSON point features with circle layers rebuilt on `zoomend` and `moveend`. Both use 12px seats, 13px spacing, shared/identical seat layout math, 120px total-extent hiding, and greedy collision filtering, but they render through different engines.
- [x] Runtime probe
  - If feasible, run a focused local/browser probe at representative zoom levels for the same election URL.
  - Completed: `/test2` Playwright probe succeeded for Dáil 2024 at zooms 5.5, 6.5, 7.0, 8.4, and 9.5. Seat cluster spacing stayed stable at about 26px x 13px for a five-seat group, while source counts increased as zoom/collision allowed more groups. Main runtime probe through the bare harness did not reliably drive the full catalogue election load, so main behavior was verified from production source.
- [x] Review
  - Summarize visible differences, root causes, and whether `/test2` can be aligned further.
  - Completed: ready to explain that remaining differences are DOM-marker-vs-WebGL rendering, viewport/rendered-feature counting, anchoring data, halo/stroke styling, and exact timing of recomputation during zoom gestures.

# /test2 black seat-circle outline
- [x] Record scope
  - User request: change election seat circles so their outline is black, not white.
  - Scope: `/test2` election seat-circle paint, validation/browser guardrails, rebuilt `/test2` bundle, and task/lesson notes.
- [x] Implement
  - Change both the seat-circle halo and inner stroke away from white so the visible outline is black.
  - Update browser/static checks that previously expected a white seat-circle stroke.
  - Completed: `/test2` now paints the seat-circle halo and inner stroke black, and the static/browser guardrails assert the black paint.
- [x] Verify
  - Run syntax checks, `/test2` route validation, rebuild, and focused browser checks for election seat circles.
  - Completed: `node --check` passed for changed JS/test files; `npm run check:test2` passed; `npm run build:test2` passed after approved esbuild escalation; `npm run test:browser -- tests/browser/test2-app.spec.js` passed 23/23.
- [x] Review
  - Summarize changed files and remaining status.
  - Completed: ready to report the black seat-circle outline change.

# /test2 remaining parity fixes after continuing analysis
- [x] Record scope
  - User request: fix the remaining main-vs-`/test2` differences identified in the continuing analysis.
  - Main remains the fixed reference; changes should be scoped to `/test2`, tests/validation, generated `/test2` build output if rebuilt, and task notes.
  - Target gaps: short election catalogue labels, active election row/class parity, election pane sort/close/back micro-markup, viewport/fit ordering, native MapLibre control artifacts, and label/seat-circle visual tuning where feasible.
  - Completed: scope recorded before implementation.
- [x] Implement parity fixes
  - Make `/test2` election catalogue display labels match main short labels and subtitles.
  - Make `/test2` election pane controls/classes/symbols match main where possible.
  - Align election URL restore/fit behaviour to main's visible election-load behaviour unless an explicit URL viewport must be preserved.
  - Remove native MapLibre control artifacts and keep custom main-style controls.
  - Tune map label and seat-circle defaults closer to main.
  - Completed: `/test2` election catalogue rows now derive main-style short provider labels/subtitles, the election pane uses main-style close and sort-button markup/classes, and native visible MapLibre controls are removed after custom main-style controls are installed.
- [x] Verify
  - Completed: `node --check` passed for `test2/src/election-manager.js`, `test2/src/maplibre-main-adapter.js`, and `tests/browser/test2-app.spec.js`; `npm run check:test2` passed; `npm run build:test2` passed after approved esbuild escalation; `npm run test:browser -- tests/browser/test2-app.spec.js` passed 23/23 tests.
  - Run `/test2` static checks, build, and focused browser comparison for Dáil 2024 and mobile shell.
- [x] Review
  - Completed: ready to report the implemented `/test2` parity fixes and the remaining MapLibre-vs-Leaflet limits.
  - Summarize changed files, verification, and any remaining engine-specific limits.

# Main vs /test2 continuing parity analysis
- [x] Record scope
  - User request: continue analysing differences between main and `/test2` after the latest election paint/mobile-navbar fix.
  - Treat main as the fixed reference; this pass should identify remaining differences before further implementation.
  - Completed: scope recorded before analysis.
- [x] Compare representative runtime states
  - Compare main and `/test2` for active Dáil 2024 election state, ordinary catalogue map state, and mobile shell state.
  - Capture DOM/style/state differences where possible, not just source-level guesses.
  - Completed: used local Chromium snapshots for main and `/test2` Dáil 2024, ordinary townlands shell, and mobile election shell. The Dáil 2024 election table row values now match for the first rows, but catalogue entry text, active-state restoration, viewport restoration, MapLibre control DOM/placement, and several pane-control microclasses still differ.
- [x] Classify differences
  - Separate feasible/sensible parity bugs from intentional MapLibre differences and data-blocked gaps.
  - Completed: feasible/sensible fixes remain for catalogue display labels, active-election class parity, election pane control markup, viewport/fit ordering, custom control replacement, and label/seat-circle visual tuning. Leaflet-vs-MapLibre canvas/DOM internals and exact projection/rendering differences are engine-specific and should be treated as acceptable unless they affect visible behaviour.
- [x] Review
  - Report high-confidence findings and recommended next fixes.
  - Completed: findings are ready to report inline.

# /test2 election colour and mobile menu parity correction
- [x] Record scope
  - User correction: election entry fill/stroke colours on `/test2` still differ from main, suggesting other parity drift; mobile menu/catalogue button should live on the navbar instead of floating out of sight or colliding with map controls.
  - Main remains the fixed reference. Runtime changes should be scoped to `/test2`, generated `/test2` build output, tests/validation, and task notes.
  - Completed: task scope recorded before implementation.
- [x] Inspect current divergence
  - Compare main election paint constants with `/test2` MapLibre election expressions.
  - Inspect mobile catalogue/menu toggle placement and collision tests.
  - Completed: main uses unmatched `#dfe4ec` fill at `0.42`, matched winner fill at `0.6`, fixed `#333` matched stroke, `#a1aab8` unmatched stroke, fixed `1.5` weight, and `0.8` opacity; `/test2` was using `0.28` fill, `#31546a` stroke, and zoom-varying stroke width. The mobile catalogue toggle was still styled as a floating map overlay.
- [x] Implement `/test2` parity fixes
  - Mirror main election polygon paint contract for matched and unmatched election geography: fill colour, fill opacity, stroke colour, stroke opacity, and stroke width.
  - Keep MapLibre-only interaction layers separate so hover/selected orange feedback is not regressed.
  - Move the mobile catalogue/menu toggle into the navbar on `/test2` and style it as a navbar control on mobile.
  - Completed: `/test2` election base styling now uses a named main-style paint contract with MapLibre match expressions for matched/unmatched fill and stroke, while the adapter accepts expression-based opacity. The mobile catalogue toggle is moved into `.app-header` and styled as a navbar button on mobile.
- [x] Add guardrails
  - Add or update static/browser checks proving `/test2` uses main election paint values and the mobile toggle sits in the navbar without colliding with map controls.
  - Completed: route validation now requires the main-style election paint contract and navbar relocation hook; browser checks assert the mobile toggle is inside the header and election fill/stroke/opacity/width paint values match the main contract.
- [x] Verify
  - Run `/test2` validation, rebuild, and focused browser checks.
  - Completed: `node --check` passed for changed `/test2` sources and validation script; `npm run check:test2` passed; `npm run build:test2` passed after approved esbuild escalation; focused Playwright checks for mobile controls and election styling passed; full `npm run test:browser:test2` passed with 23/23 tests.
- [x] Review
  - Summarize implemented changes and remaining sensible MapLibre differences, if any.
  - Completed: ready to report the implemented `/test2` election paint parity and mobile navbar-toggle fix.

# /test2 remaining main-visible election parity gaps
- [x] Record scope
  - User request: fix active election catalogue restore, Dáil 2024 table ordering/aggregation, URL viewport restore, low-zoom label density, election fill/stroke style, seat-circle placement/collision, and MapLibre controls so `/test2` aligns with main where feasible.
  - Main remains read-only reference; changes should be scoped to `/test2`, tests/validation, build outputs, and task notes.
  - Completed: task scope recorded before implementation.
- [x] Inspect current divergence
  - Compare main URL semantics, catalogue row focus, election party table sorting/aggregation, label thresholds, election style expressions, seat overlay placement, and control DOM/CSS.
  - Completed: found `/test2` was only best-effort scrolling active election rows, wrote `z` instead of main-style `zoom`, lacked active election table sort controls, used dense low-zoom DOM labels, used party-coloured polygon strokes, rendered seat overlays without explicit draw order, and still exposed native MapLibre zoom controls.
- [x] Implement `/test2` parity fixes
  - Force active election URL restores to open/focus the same decade catalogue row as main.
  - Preserve `zoom` and `z` URL semantics and avoid later election fitting overwriting restored viewport.
  - Align Dáil 2024 party table ordering/aggregation and default election pane state to main.
  - Reduce low-zoom labels and tune election fill/stroke to match main visually.
  - Tighten seat-circle ordering, anchors, offsets, and collision thresholds.
  - Replace/restyle MapLibre controls with main-style custom controls where sensible.
  - Completed: `/test2` now forces active election restores back to the main catalogue list state, writes main-style `zoom` while still reading legacy `z`, orders overall party tables by main-style seats/votes, enables table sort buttons, suppresses election labels below zoom 7.35, uses lower-opacity election fills and muted strokes, gives seat circles deterministic draw order, and installs custom Leaflet-like zoom controls over MapLibre.
- [x] Add guardrails
  - Extend `/test2` static/browser checks for catalogue focus, URL viewport restore, table order, labels, seat overlay, and controls.
  - Completed: route validation now checks custom controls, catalogue/zoom restore, election label threshold hooks, table controls, and seat-circle draw order; browser coverage now verifies Dáil 2024 active restore/table/viewport/label behavior.
- [x] Verify
  - Run `/test2` validation, rebuild, and browser tests.
  - Completed: `npm run check:test2`, `npm run build:test2`, and `npm run test:browser -- tests/browser/test2-app.spec.js` all pass.
- [x] Review
  - Summarize implemented changes and remaining Leaflet/MapLibre-specific limits.
  - Completed: no code-blocking limit remains for this request; remaining visual differences would require another screenshot-led tuning pass rather than a known failing guardrail.

# Shared election rendering/domain extraction
- [x] Record scope
  - Implement the 1-10 extraction sequence: shared view-model shape, shared domain helpers, shared renderer, main/test2 wiring, map-adapter boundary, parity tests, and visual/overlay guardrails.
  - Preserve main-site behaviour while allowing `/test2` to use the same election view-model and renderer where sensible.
  - Avoid porting Leaflet objects into `/test2`; only domain/view rendering should be shared.
- [x] Inspect current main/test2 election render and domain seams
  - Confirmed `js/election-domain.mjs` already holds core summary/elected/entity helpers.
  - Confirmed `/test2/src/election-manager.js` still owned a separate election pane renderer, while main `js/election-controller.js` owned the richer production pane rendering and Leaflet overlays.
- [x] Add shared ElectionViewModel/domain helpers
  - Added `js/election-view-model.mjs` with `buildElectionViewModel`, `buildElectionViewModelFromTest2Manager`, `buildElectionViewModelFromMainController`, local-party/council summaries, and shared totals helpers.
- [x] Add shared election renderer and wire main/test2
  - Added `js/election-renderer.mjs` with `SharedElectionRenderer`, `createElectionRenderer`, `renderElectionSummaryFromViewModel`, shared numeric colour ramps, overall/constituency/local/recall/count/entity rendering, and shared renderer markers.
  - Wired `/test2` election pane methods to delegate to `this.sharedRenderer`.
  - Wired the main election controller to mirror shared view-model/renderer output through `_mirrorSharedElectionRenderer` while preserving its existing visible production rendering.
- [x] Keep map-specific overlays in main/test2 adapters only
  - No Leaflet overlay objects were ported to `/test2`.
  - Map-specific drawing remains in `js/election-controller.js`, `test2/src/election-manager.js`, and `test2/src/maplibre-main-adapter.js`; the new shared modules only build data/view HTML.
- [x] Add parity and visual/overlay guardrails
  - Extended `scripts/validate-test2-route.mjs` to require shared view-model and shared renderer usage from both main and `/test2`.
  - Extended `/test2` browser coverage to assert loaded election panes render through `[data-election-renderer="shared"]` and include production-style election table classes.
- [x] Verify with static checks, builds, and test suites
  - `node --check js/election-view-model.mjs`, `node --check js/election-renderer.mjs`, `node --check test2/src/election-manager.js`, and `node --check js/election-controller.js` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved escalation for esbuild process spawning.
  - `npm run test:browser:test2` passed after approved escalation for Playwright/browser worker spawning: 21/21 tests.
  - `npm run build` passed after approved escalation for esbuild process spawning.
  - `npm run check` passed.

# Main vs /test2 exhaustive discrepancy audit
- [x] Record scope
  - Compare the current main site and `/test2` across shell, catalogue, map engine, feature labels/interactions, election overlays, election panes, URL/timeline state, mobile behaviour, data coverage, and guardrails.
  - Classify discrepancies as sensible MapLibre differences, feasible non-data-blocked parity work, data-blocked parity work, or not sensible to copy.
  - Report findings without changing runtime behaviour unless needed to complete the audit.
- [x] Inspect current shell/catalogue/map architecture
  - Main still loads the production Leaflet bundle and `data/database/maps.json` directly; `/test2` preserves the production shell but runs `test2/src/app.js` with `Test2MapLibreMainAdapter`, `TestMetadataService`, and generated PMTiles/MVT/raster metadata.
  - `/test2` metadata currently contains 674 loadable layers: 601 PMTiles, 1 directory MVT, 22 raster-tile layers, 50 image layers, and 59 converted aliases.
  - Direct ID comparison against 751 main map rows found 139 main rows not directly represented in `/test2` metadata; the sample rows largely have no direct `files` entries, so they need alias/source/placeholder review rather than blind conversion.
- [x] Inspect current election overlay/pane/data coverage
  - `/test2` election metadata currently contains 268 election entries, 239 loadable entries, and 29 placeholders.
  - The generated report records 3,959 matched constituency/result links and 725 unmatched links, all classified as blocked on source data or aggregation rather than feasible implementation work.
  - Main election logic remains substantially richer in `js/election-controller.js`; `/test2` shares election-domain helpers but renders through a MapLibre-native manager and generated sidecars.
- [x] Inspect validation and browser coverage
  - `npm run check:test2` passed during this audit.
  - Existing `/test2` browser coverage includes shell boot, Ireland default viewport, control collision checks, mobile catalogue controls, converted layer loading, Settlements 2015 labels/interactions, duplicate-ID cross-highlight prevention, no-ID layer interactions, election load/styling/seat circles/vote bars, representative election bundle coverage, local-government aggregate/count views, URL restore, source panel, active layer controls, mobile feature taps, mobile shell/accessibility smoke, and service-worker isolation.
  - Remaining proof gaps are visual-regression/pixel comparison, real-device mobile stress, exhaustive all-layer interaction checks, and exact election-pane microinteraction comparison.
- [x] Report findings and remaining work
  - Findings reported in chat with discrepancies classified as deliberate MapLibre differences, feasible non-data-blocked parity work, data-blocked parity work, and not-sensible-to-copy differences.

# /test2 feasible election parity implementation pass
- [x] Record scope
  - Improve `/test2` election seat-circle parity where MapLibre-native implementation can sensibly match main-site Leaflet behaviour.
  - Improve `/test2` election pane parity where shared/election-domain rendering can sensibly match main-site behaviour.
  - Improve mobile `+` election-entry load responsiveness with parallel loading, busy/cancel state, and progressive rendering where feasible.
  - Preserve the main site and avoid porting Leaflet-only layer objects into `/test2`.
- [x] Inspect current election overlay, pane, catalogue click, and generated bundle paths
  - Reviewed `test2/src/election-manager.js`, `js/ui-controller.js`, `test2/src/app.js`, `test2/src/maplibre-main-adapter.js`, `/test2` CSS, and the existing browser election tests.
- [x] Implement feasible MapLibre-native parity improvements
  - Added a progressive election-loading pane before heavy work completes.
  - Parallelised election map loading, result bundle loading, previous-result loading, and feature-index prefetching.
  - Added catalogue-row/button busy state with duplicate-tap blocking for mobile `+` loads.
  - Added local-government council/district aggregate seat-circle groups when the election pane is in aggregate mode.
  - Added recall-petition map labels where recall data is available.
  - Aligned the `/test2` pane close/back ids and behaviour closer to the production election pane.
- [x] Add or tighten automated guardrails
  - Extended `scripts/validate-test2-route.mjs` to require the progressive/parallel election load path, local aggregate overlays, recall labels, and mobile busy state.
  - Extended browser coverage for the loading skeleton and aggregate seat-circle overlay mode.
- [x] Verify and document remaining data/architecture limits
  - `node --check test2/src/election-manager.js`, `node --check js/ui-controller.js`, and `node --check scripts/validate-test2-route.mjs` passed.
  - `npm run build:test2` passed after approved escalation for esbuild process spawning.
  - `npm run check:test2` passed.
  - `npm run test:browser:test2` passed after approved escalation for Playwright process spawning: 21/21 tests.
  - `npm run build` passed after approved escalation for esbuild process spawning.
  - `npm run check` passed.
  - Remaining exact-parity limits are data/architecture constraints: unconverted/unmatched election geographies, MapLibre-vs-Leaflet rendering differences, and any exact count/entity detail that the generated bundles still do not carry.

# Main vs /test2 election seat-circle and pane parity audit
- [x] Record scope
  - Compare main-site Leaflet election seat-circle overlays against `/test2` MapLibre election overlays.
  - Compare main-site election pane behaviour against `/test2` election pane behaviour.
  - Identify remaining differences exhaustively and classify feasibility.
  - Explain feasibility of making mobile `+` election-entry loads maximally fast, stable, and responsive.
- [x] Inspect main-site election overlay and pane logic
  - Reviewed `js/election-controller.js` seat overlays, selected-constituency pane, overall pane, count table, animation, entity detail, and recall-special paths.
- [x] Inspect `/test2` MapLibre election overlay and pane logic
  - Reviewed `test2/src/election-manager.js`, shared `js/election-domain.mjs`, URL state, catalogue load hooks, and browser/performance test coverage.
- [x] Compare generated data/anchor model and mobile load path
  - Checked generated `/test2` election metadata/report coverage, loadable/placeholders/unmatched counts, representative bundles, anchor availability, and current mobile performance coverage.
- [x] Report findings and feasibility
  - Findings: seat-circle layout algorithm is now largely shared, but rendering technology, anchor provenance, elected-candidate extraction fidelity, recall overlay handling, local/council aggregate overlay mode, and pane markup/table richness still differ.
  - Mobile `+` load feasibility: strong; best next step is a dedicated two-phase election-load fast path with parallel bundle/map/index fetch, busy/cancel state, skeleton pane, cached/precomputed overlay inputs, deferred heavy tables, and a Pixel/mobile election-load performance test.

# /test2 election parity final gap closure
- [x] Record scope
  - Target gaps: local-government DEA/district/council mode parity, richer count-table parity, previous-election deltas, recall-petition UI parity, overlay placement/collision parity, richer entity pages, election-specific URL substate, unmatched/unconverted geography handling, and split-pane/tab micro-interactions.
  - Constraint: preserve the main site and keep `/test2` MapLibre-native; do not port Leaflet layer objects literally.
- [x] Implement non-data-blocked parity work
  - Fixed shared elected-status detection so `Not Elected` is not counted as elected, capped explicit elected candidates to the declared seat count, and preserved non-transferable count rows in generated bundles.
  - Added richer previous-election deltas for constituencies and candidates, district/council aggregate result mode for local-government bundles, recall overview/incumbent UI hooks, richer entity metrics, count event hints, non-transferable count display, and election-specific URL state.
  - Added MapLibre-native overlay collision suppression and kept vote-bar/seat-circle overlay source diagnostics available for regression checks.
- [x] Rebuild generated `/test2` election bundles where shared election-domain logic changes
  - Regenerated `test/metadata/elections-test2.json`, `test/metadata/elections-test2-report.json`, per-election result bundles, and `/test2` build artifacts through `npm run build:test2`.
- [x] Add/tighten regression guardrails
  - Extended `scripts/validate-test2-route.mjs` to require election URL restore, DEA/district switching, recall overview/incumbent hooks, non-transferable count preservation, count events, safe elected-status matching, and overlay collision suppression.
- [x] Verify with static checks, `/test2` build, and browser coverage where available
  - `node --check js/election-domain.mjs`, `node --check test2/src/election-manager.js`, and `node --check test2/src/app.js` passed.
  - `npm run build:test2` passed after approved sandbox escalation for esbuild process spawning.
  - `npm run check:test2` passed.
  - `npm run test:browser:test2` passed after approved sandbox escalation for Playwright worker/browser spawning: 20/20 tests passed.
  - `npm run build` passed after approved sandbox escalation for esbuild process spawning.
  - `npm run check` passed.
- [x] Document remaining data-blocked limitations, if any
  - Remaining unmatched geography rows in `elections-test2-report.json` are still classified as blocked on source data/aggregation/data cleanup rather than silent feasible implementation work. The non-data-blocked `Not Elected`/seat-count correctness bug was fixed and regenerated.

# /test2 remaining election parity gap closure
- [x] Record scope
  - Target gaps: local-government council/district aggregate views, vote-bar overlay mode, recall-petition rendering where data exists, detailed count-table parity, and explicit reporting for data-blocked election coverage.
  - Constraint: keep MapLibre source/layer handling native to `/test2`; do not port Leaflet layer objects or overlay groups literally.
- [x] Audit current generated election bundle shape for local-government, recall, and count data
  - Local-government bundles already carry candidate, party, DEA, seat, vote, and entity-index fields, so the council/district aggregate view can be computed in the `/test2` election manager.
  - Count bundles already carry count numbers and per-candidate count rows for representative NI Assembly examples; detailed count display can be expanded without new source data.
  - Recall-petition source data is not currently present in the generated loadable examples, but the shared summary now preserves `recallPetition` if/when it appears.
- [x] Implement feasible MapLibre-native parity work
  - Added a MapLibre-native overlay selector for seat circles versus vote bars.
  - Added vote-bar GeoJSON/line rendering with click-through to the election pane.
  - Added local-government “By Local Party” aggregate tables and DEA-aware labels.
  - Added visible data-coverage notices for unmatched result rows.
  - Added recall-petition result rendering for future bundles that carry petition data.
  - Expanded count tables with a detailed toggle, transfer/status notes, and summary rows.
- [x] Add/tighten regression coverage
  - Static `/test2` validation now requires vote bars, local-party aggregates, recall preservation/rendering, and detailed count-table support.
  - Browser coverage now exercises vote-bar overlay switching, local-government aggregate rendering, and detailed count toggle rendering.
- [x] Rebuild and verify
  - `node scripts/validate-test2-route.mjs` passed.
  - `npm run build:test2` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - `npm run check:test2` passed.
  - `npm run build` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - `npm run test:browser:test2` passed after approved sandbox escalation because Playwright worker spawning was blocked by `EPERM`: 20/20 tests passed.
- [x] Commit and push
  - Committed and pushed the `/test2` election parity closure work on `main`.

# /test2 election-layer parity audit and catalogue TOC correction
- [x] Record the correction and scope
  - Symptom: individual election entries should not be listed directly in the catalogue table of contents.
  - Required behaviour: keep by-decade election TOC entries, and keep individual elections inside their decade sections/cards.
  - Audit scope: compare main-site election layer logic against `/test2`, then align `/test2` where feasible and sensible for MapLibre.
- [x] Audit main-site election-layer logic
  - Main `ElectionController` resolves body/date through a large geography matrix, loads result JSON plus FGB geometry, builds lookups and previous-election data, styles Leaflet geographies, adds seat-circle/vote-bar overlays, opens the below-map election pane, drives URL/timeline state, and builds catalogue cards grouped by decade.
  - The main catalogue table of contents exposes Elections as decade jump buttons only. Individual election entries appear inside the decade cards, not as separate TOC rows.
- [x] Audit `/test2` election-layer logic
  - `/test2` uses `Test2ElectionManager` with a generated election manifest, lazy result bundles, MapLibre style expressions, generated anchor sidecars for seat circles, feature-result enrichment, the production below-map election pane, and the production timeline controls.
  - `/test2` had drifted from main by adding individual top-table election rows through `includeElectionTocRows`, while also keeping the decade card entries.
- [x] Compare gaps and classify feasible/sensible parity work
  - Feasible and sensible now: main-style decade-only election TOC; generated election entries remain inside decade sections; MapLibre election styling and seat circles remain engine-specific; result/feature enrichment remains shared-domain based.
  - Not sensible to copy literally: Leaflet FGB layer objects, Leaflet overlay groups, and main-controller layer visibility internals. `/test2` should keep MapLibre source/layer handling for those.
  - Remaining parity gaps outside this correction are data/coverage and deeper local-government/election-pane exactness, not blockers for the requested TOC correction.
- [x] Remove individual election rows from the catalogue TOC while preserving decade navigation
  - Removed `/test2`'s `includeElectionTocRows` opt-in.
  - Removed the shared renderer's individual election TOC row generation and event wiring.
  - Removed the CSS that existed only for those individual TOC rows.
- [x] Implement feasible election parity fixes discovered in the audit
  - Kept `includeMobileElectionCatalogue = true` so individual elections remain accessible inside decade cards on `/test2`, including mobile, while the TOC itself matches the main site.
- [x] Add/tighten regression coverage
  - Static route validation now fails if `/test2` reintroduces `includeElectionTocRows` or individual election TOC row classes.
  - Browser coverage now asserts more than 10 decade TOC buttons, more than 10 election entries inside cards, and zero individual election TOC links.
- [x] Rebuild and verify
  - `node scripts/validate-test2-route.mjs` passed.
  - `npm run build:test2` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - `npm run build` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - `npm run check:test2` passed.
  - `npm run test:browser:test2` passed after approved sandbox escalation because Playwright worker spawning was blocked by `EPERM`: 19/19 tests passed.
- [x] Summarize implemented alignment and remaining gaps
  - Implemented alignment: `/test2` now matches the main catalogue contract for elections: decade buttons in the TOC, individual entries inside decade sections, and MapLibre-specific load/render logic underneath.
  - Remaining gaps: exact main-site local-government council/DEA aggregate display, vote-bar overlay mode, recall-petition special rendering, detailed count-event table parity, and data coverage for entries whose geographies are not yet converted.

# /test2 election catalogue recurrence fix
- [x] Record recurrence
  - Symptom: election entries still do not appear in the `/test2` map catalogue after the previous mobile catalogue opt-in fix.
  - Root cause: election entries were generated and visible in lower decade cards, but the default top catalogue table only exposed decade jump buttons. The prior test counted buried card entries rather than rows visible in the primary catalogue surface.
  - Permanent prevention action: add top-table election rows plus a regression check against visible top catalogue rows, not just hidden/lower card DOM.
  - Verification evidence: headless render check found 519 top-table pickable election rows; first row was `29 Nov 2024 Dáil Éireann` at `top=283.21875`.
- [x] Inspect the production catalogue render path used by `/test2`
  - Confirmed `onBuildElectionCatalogueCards` returned 548 entries and 519 loadable entries, but the top table rendered only decade links while real entry rows began around 5,296px down the scroll surface.
- [x] Fix election entry visibility in the default `/test2` catalogue
  - Added route-gated top-table election rows under the Elections heading, with no thumbnails/network churn and with placeholders marked disabled.
  - Kept the existing decade card sections below for browsing by decade.
- [x] Add or tighten static/browser guardrails for visible election catalogue rows
  - Added `/test2` static route checks for `includeElectionTocRows`, `flat-election-toc-link`, and `catalogue-flat__toc-election-row`.
  - Updated browser boot coverage to require more than 10 loadable election rows in the top catalogue table and to assert the first visible election row appears near the top of the viewport.
- [x] Rebuild and verify `/test2`
  - `node scripts/validate-test2-route.mjs` passed.
  - `npm run build:test2` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - `npm run build` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - Render inspection passed: 519 top-table election rows and 548 lower decade-card election rows.
  - `npm run check:test2` passed.
  - `npm run test:browser:test2` passed after approved sandbox escalation because Playwright spawning was blocked by `EPERM`: 19/19 tests passed.

## Review
- The catalogue now exposes elections in the immediately visible top-table surface, so users do not need to infer that decade buttons hide real entries thousands of pixels lower in the pane.
- The fix is route-gated for `/test2` via `includeElectionTocRows`/`includeMobileElectionCatalogue`, avoiding an unintended main-site catalogue reshuffle.
- Superseded by the correction above: individual election TOC rows were removed because the main-site navigation contract is decade TOC buttons plus individual elections inside decade cards.

# /test2 mobile/control/election regression fixes
- [x] Record the recurring regression report
  - Active-layers collapse/expand button still overlaps zoom controls.
  - Mobile double-tapping a feature zooms instead of opening the feature card.
  - Settings/accessibility button still overlaps the scale control.
  - Mobile catalogue show/hide button obscures catalogue history/top controls.
  - Polygon hover/click still shows horizontal/vertical internal seam lines.
  - Election entries are not visible in the catalogue pane.
- [x] Inspect current `/test2` control layout, touch interaction, polygon interaction layers, and catalogue election rendering
  - Reviewed `/test2` shell CSS, MapLibre control placement, geometry click/double-click wiring, polygon hover/selection rendering, timeline pointer handling, and the main catalogue bounded-mobile election filter.
- [x] Fix desktop and mobile map control collisions permanently
  - Moved MapLibre zoom controls below the active-layers toggle, kept active layers at the top-right, moved scale to bottom-right, moved the settings/accessibility controls above the scale area, and moved the mobile catalogue show/hide button away from catalogue history/home controls.
- [x] Fix mobile feature double-tap/tap feature selection without requiring label taps
  - Disabled MapLibre double-click zoom on `/test2` and wired ordinary feature geometry click/double-click selection so the feature card opens from the geometry itself, not only from DOM labels.
- [x] Remove polygon internal hover/click seam lines
  - Disabled polygon fill antialiasing and stopped using clipped fallback polygon interaction overlays for ordinary polygon features; duplicate-ID/generated-ID fallbacks remain available only where required.
- [x] Restore visible election entries in the catalogue pane
  - Added a `/test2` opt-in so the production catalogue can show election entries on mobile while preserving the main site's bounded mobile shortcut elsewhere.
- [x] Add or tighten browser/static regression coverage for each reported recurrence
  - Added static `/test2` route guard checks for double-click zoom disabling, geometry selection wiring, control placement CSS, timeline pointer pass-through, polygon antialiasing, and election catalogue opt-in.
  - Added browser checks for visible election rows, mobile control non-overlap, MapLibre interaction-layer seam prevention, and mobile-sized geometry double-click selection.
- [x] Update lessons/guardrails for the recurring failures
  - Added guardrails for route-scoped control placement, vector-tile seam prevention, mobile geometry selection, and route-specific election catalogue parity opt-ins.
- [x] Verify with `/test2` route checks, build, and browser tests
  - `node scripts/validate-test2-route.mjs` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved sandbox escalation because esbuild process spawning was blocked by `EPERM`.
  - `npm run test:browser:test2` passed after approved sandbox escalation because Playwright browser spawning was blocked by `EPERM`: 19/19 tests passed.

## Review
- The reported `/test2` regressions now have code fixes plus guardrails: control collisions are checked by browser bounding boxes, mobile geometry selection no longer depends on label taps, ordinary polygon hover/selection avoids tile-fragment seam overlays, and election catalogue rows are asserted visible.
- Remaining unrelated untracked local scratch/generated files were not staged or modified as part of this task.

# /test2 full election-domain parity implementation
- [x] Record the requested full election parity scope
  - Extract shared election-domain logic from `js/election-controller.js`.
  - Extend `scripts/build-test2-election-manifest.mjs` so generated bundles carry fields needed by main-style panes, count views, entity pages, and animation views.
  - Generate election anchor sidecars for seat circles from source geometry.
  - Replace simplified `/test2` election rendering with engine-neutral main-style rendering.
  - Keep MapLibre-specific drawing isolated in `/test2` MapLibre adapter/manager.
  - Systematically close unmatched geography report where feasible.
  - Add parity tests for Dail, Westminster, NI Assembly, 1972 DEAs, local government, referendum, and recall petition examples.
- [x] Audit current election data/model/rendering seams before editing
  - Reviewed main-site election logic in `js/election-controller.js`, the existing `/test2` MapLibre election manager, generated election metadata, feature indexes, and election-viewer animation hooks.
- [x] Extract shared election-domain helpers
  - Added `js/election-domain.mjs` for result normalisation, elected-candidate extraction, winner/leading-party summaries, party/candidate/entity aggregate builders, previous-election comparisons, and seat-circle positioning.
- [x] Extend generated election bundles and anchor sidecars
  - Extended `scripts/build-test2-election-manifest.mjs` so bundles now include party summaries, entity indexes, count metadata, count rows, forum rows, animation payloads, previous-election links, and source-geometry anchors.
  - Added generated sidecars under `test/metadata/election-anchors-test2/`.
- [x] Upgrade `/test2` election result rendering
  - Replaced the simplified result pane with engine-neutral main-style overall, constituency/DEA, candidate, party/entity, count-table, and transfer-animation entry views.
  - Added a thin `/test2` adapter that invokes the existing main-site animation engine when count animation payloads are available.
- [x] Close feasible unmatched geography cases
  - Regenerated the election report with a closure summary. Feasible unmatched cases are now classified as zero; the remaining unmatched rows are data/source-coverage residuals rather than unreviewed alias work.
- [x] Add parity tests for representative election types
  - Added browser coverage for Dail, Westminster, NI Assembly, 1972 DEA/local-government, referendum, and recall/placeholder catalogue examples.
- [x] Verify with route checks, generated metadata checks, build, and browser tests
  - `npm run build:test2:elections` passed: 548 elections, 519 loadable, 29 placeholders, 3,957 matched constituencies, 727 unmatched.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved sandbox escalation because esbuild process spawning was blocked by `EPERM`.
  - `npm run test:browser:test2` passed after approved sandbox escalation because Playwright browser spawning was blocked by `EPERM`: 17/17 tests passed.

## Review
- The election-domain/data/rendering path is now substantially engine-neutral, with MapLibre drawing still isolated in `/test2` code.
- Remaining unmatched election rows are documented in `test/metadata/elections-test2-report.json`; the build now reports no feasible alias/source-name closure work left in the generated report.

# Main-site election layer parity feasibility audit for /test2
- [x] Record the audit request
  - Examine the main-site election layers functionality in maximum detail.
  - Explain the feasibility of implementing election layers functionality on par with the main site on `/test2`.
- [x] Inspect main-site election layer architecture, data loading, map styling, overlays, panes, and timeline integration
  - Main-site election functionality is concentrated in `js/election-controller.js`, with catalogue hooks in `js/ui-controller.js`, timeline election mode in `js/time-slider-controller.js`, and production CSS for the split election pane in `assets/css/main.css`.
  - It includes geography resolution, FlatGeobuf loading, result payload loading, winner/party colouring, seat-circle overlays, recall/referendum special cases, local-government aggregation, split-pane results, table controls, entity detail pages, count views, and STV animation hooks.
- [x] Inspect current `/test2` election layer architecture and generated election metadata
  - `/test2` has a separate `Test2ElectionManager` using generated metadata under `test/metadata/elections-test2*.json`.
  - It already supports generated election catalogue entries, MapLibre style modes, feature-result enrichment, simplified overall and constituency panes, basic seat-circle overlays, and election timeline switching.
- [x] Compare parity gaps and classify feasibility
  - Straightforward parity remains feasible for map styling, URL/timeline state, split-pane placement, seat-circle visibility, and selected-feature result routing.
  - Full main-site parity requires porting substantial engine-neutral election-domain logic from the Leaflet controller: result tables, count views, entity pages, local-government council modes, previous-election deltas, and animation data plumbing.
  - Data-dependent gaps remain where generated bundles cannot match every constituency to a converted MapLibre layer, where exact split/merge aggregation is needed, or where exact overlay anchors need richer geometry-derived sidecars.
- [x] Document findings and provide an implementation feasibility answer
  - Review: implementing election layers on `/test2` to user-visible parity with the main site is feasible, but not by copying the Leaflet layer code verbatim. The sensible route is to extract/port the main election data and rendering model into engine-neutral modules, then keep MapLibre-specific map drawing in `/test2`.

# /test2 production map control, timeline, and election pane parity
- [x] Record the user report
  - Active-layers button still overlaps the zoom controls on `/test2`.
  - The bottom-left settings button overlaps the map scale.
  - `/test2` lacks the main-site timeline slider.
  - Election entries do not match main-site parity: seat circles are missing for ordinary elections, the election pane should appear below the map, and it should show overall results by default plus constituency/DEA-specific results after selection.
- [x] Inspect production shell, timeline, and election UI contracts
  - Confirmed `/test2` already contained the main shell controls: `#activeLayersToggle`, `#mapControlsToggle`, `#timelineSlider`, and `#electionResultsPane`.
  - Confirmed the regression was architectural: `/test2` still rendered a floating `test2ElectionPanel` instead of using the production below-map election pane.
- [x] Implement a permanent control-placement fix
  - Moved MapLibre scale control to bottom-right so it no longer shares the bottom-left settings/timeline corner.
  - Added `/test2` control-placement CSS for top-left/top-right/bottom-left/bottom-right MapLibre controls.
  - Scoped `.map-controls` pointer events so the container cannot block map/label clicks; only the actual controls remain clickable.
- [x] Implement timeline slider parity where the selected map/election has a time-series chain
  - Added `/test2` timeline controller wiring for the existing production `#timelineSlider` controls.
  - Map chains now use `dataService` chain/date equivalents, and election entries expose a date timeline for the active election body.
- [x] Implement election seat-circle and below-map election pane parity
  - Election entries now render into `#electionResultsPane` below the map and resize the production shell while open.
  - Overall results render by default with matched/unmatched/seat/vote summaries and party/result tables.
  - Clicking a selected constituency/DEA feature renders constituency-specific candidate/results details in the election pane.
  - Ordinary elections render MapLibre seat-circle overlays from generated feature-index centres; referendums/recall-style entries are excluded.
- [x] Add regression coverage and verify
  - Added static route guardrails for scale-control placement, timeline wiring, seat-circle rendering, and below-map election pane usage.
  - Expanded browser coverage for active-layers vs zoom overlap, settings vs scale overlap, election pane visibility, timeline visibility, seat-circle layer rendering, and enriched election feature details.
  - `node --check` passed for `test2/src/app.js`, `test2/src/election-manager.js`, `test/src/map-controller.js`, `tests/browser/test2-app.spec.js`, and `scripts/validate-test2-route.mjs`.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - `npm run test:browser:test2` passed after approved sandbox escalation because Playwright browser spawning was blocked by `EPERM`: 16/16 tests passed.

# /test2 active-layer control overlap and duplicate hover highlight
- [x] Record the user report
  - The `/test2` active-layers expand/collapse button overlaps the MapLibre zoom controls.
  - On `deas-1972`, hovering `Down Area C` can also highlight `Belfast Area H`, which is distant and unrelated.
  - Additional report: polygon hover/click highlighting can show horizontal and vertical lines inside features.
- [x] Inspect the map-control layout and MapLibre interaction-state path
  - Initial finding: `/test2` uses the production active-layers button at top right while MapLibre navigation controls were also mounted top right.
  - Initial finding: `test/metadata/feature-indexes/deas-1972-vector-test.json` confirms `DOWN AREA C` and `BELFAST AREA H` both have id `28`.
  - Additional finding: polygon interaction stroke layers are drawn from vector-tile fragments, so tile clipping can appear as internal horizontal/vertical highlight seams.
- [x] Implement a permanent fix
  - Move MapLibre zoom/navigation controls out of the active-layers button corner.
  - Detect duplicate promoted feature IDs from layer feature indexes and use a generated per-geometry interaction key plus the existing single-feature overlay instead of shared MapLibre feature-state for those duplicates.
  - Disable polygon interaction stroke overlays; retain transparent base fills, orange hover/selected fills, and orange DOM label hover/selection. Line and point maps keep stroke-style interaction.
- [x] Add regression coverage
  - Browser coverage should prove active-layers and zoom controls do not overlap.
  - Browser coverage should prove duplicate promoted IDs such as `deas-1972` id `28` do not produce shared hover feature-state.
  - Browser coverage should prove polygon interaction line layers are absent for civil parishes, preventing tile-seam highlight artifacts from returning.
- [x] Verify and document results
  - Run `/test2` route checks and targeted browser tests.
  - `node --check test\src\map-controller.js`, `node --check tests\browser\test2-app.spec.js`, and `node --check scripts\validate-test2-route.mjs` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved sandbox escalation because esbuild spawning was blocked by `EPERM`.
  - `npm run test:browser:test2` passed after approved sandbox escalation because Playwright browser spawning was blocked by `EPERM`: 16/16 tests passed.

# /test2 deas-1972 unnamed feature review
- [x] Record the user report that Armagh Area D, Dungannon Area C, and Limavady Area C appear as unnamed features on `/test2`
  - User correctly identified that the features were present on the map but had broken labels, so the earlier “absent from source” classification needed review.
- [x] Inspect the `deas-1972` source/index/tile metadata to confirm whether the geometries exist with blank or missing label fields
  - `DEAs_1972.fgb` has 98 features. The previous feature index had 96 entries and 95 unique labels.
  - Source rows confirmed: rowid 15 has null `NAME` and area 13.1719213882566 sq km, rowid 80 has null `NAME` and area 8.44105398081151 sq km, and OBJECTID 1624 was labelled `DUNGANNON AREA D` despite representing the missing small Dungannon feature.
- [x] Trace the `/test2` label/name extraction and election geography matching path for `deas-1972`
  - `/test2` DOM labels, selection details, feature-search sidecar indexes, and election styling all rely on the same name/label properties, so a metadata-only election alias would not fix map labels or click details.
- [x] Implement a source-specific repair only if the unnamed features can be identified safely and deterministically
  - Added a central `deas-1972` repair hook for `ARMAGH AREA D`, `DUNGANNON AREA C`, and `LIMAVADY AREA C`.
  - Wired it into label expressions, DOM label text, selected-feature properties, MapLibre normalized features, election feature matching, and election style expressions.
- [x] Regenerate affected metadata and verify the election residual report improves without speculative aliases
  - Regenerated `test/metadata/feature-indexes/deas-1972-vector-test.json`: now 98 searchable features, including all three repaired names with no duplicate DEA labels.
  - Regenerated `/test2` election metadata: matched constituencies improved from 3,948 to 3,957; unmatched dropped from 736 to 727; `historic-dea-not-in-source` is now 0.
- [x] Run relevant `/test2` checks and document the result
  - Review: the three DEAs were not absent; they were source-data labelling defects. The generated report no longer has any historic DEA residuals.
- [x] Check for repeat unnamed-feature cases before committing
  - Audited 525 generated feature-index files: no `Unnamed Feature` labels remained after the DEA repair, but three indexes contained whitespace-only names (`dlr-bicycle-parking-stands`, `osni-coverage-grid-10k`, and `translink-rail-bridges`).
  - Audited 538 local source-backed converted layers against their generated indexes: 17 layers have source rows that do not produce searchable labels, mostly because the source label field is blank for some rows or because the configured label is ID-only.
- [x] Add recurrence guardrails for blank feature-index labels
  - Tightened `scripts/build-test-feature-indexes.mjs` so feature-index names/aliases/ids are trimmed and blank labels fall back to a stable feature name instead of indexing whitespace.
  - Tightened `scripts/validate-test2-route.mjs` so `/test2` validation fails if any generated feature index contains a blank or `Unnamed Feature` label.

# /test2 election residual parity classification against main site
- [x] Record the parity-classification request
  - User asked whether main-site election functionality should be achievable on `/test2`; treated this as a parity audit plus safe residual mapping pass.
- [x] Inspect remaining unmatched `/test2` election rows and group by source map/body/year/name pattern
  - Reviewed the generated unmatched report after the previous mapping pass and grouped residuals by body, source map, and recurring name pattern.
- [x] Compare each residual class against `js/election-controller.js` main-site geography rules and available converted feature indexes
  - Confirmed which rows have no main-site source map, which need synthetic/aggregate layers, and which are absent from the selected converted source feature indexes.
- [x] Add only safe remaining crosswalks where the main site has equivalent geometry and the mapping is one-to-one or explicitly documented
  - Added the remaining safe `deas-1993` aliases: `KNOCKIVEAGH -> Knockveagh` and `DUNMURRY CROSS -> Dunmurray Cross`.
- [x] Add residual classification to the generated `/test2` election report so blocked cases are explainable
  - Added per-row `unmatchedDetails` and summarized residual classifications to `test/metadata/elections-test2-report.json`.
- [x] Regenerate election metadata and verify improved or justified residual coverage
  - Regenerated `/test2` election metadata: 548 elections, 519 loadable, 29 placeholders, 3,948 matched constituencies, 736 unmatched constituencies.
  - Residual classes are now fully classified: 620 main-geography-unsourced, 59 referendum-boundary-split-merge, 31 university-seat-no-polygon, 15 stormont-seat-not-in-source, 9 historic-dea-not-in-source, 1 regional-list-seat-no-layer, 1 source-result-name-error.
- [x] Run syntax, `/test2` route, build, and browser checks
  - `node --check scripts/build-test2-election-manifest.mjs` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved rerun outside the sandbox because esbuild spawning was blocked by `EPERM`.
  - `npm run test:browser:test2` passed after approved rerun outside the sandbox because Playwright browser spawning was blocked by `EPERM`: 14/14 tests passed.
- [x] Document final parity status and blockers
  - Review: all remaining election geography gaps are now either safe one-to-one mappings already applied or explicitly classified as data/aggregation/synthetic-layer/source-cleanup work. No unclassified residual class remains in the generated report.

# Follow-up /test2 election name/geography/data mapping
- [x] Record the follow-up request and preserve the already-pushed election integration commit
  - Previous `/test2` election integration was committed as `997b7f197 Add test2 election catalogue integration` and pushed to `main`.
- [x] Inspect the generated unmatched election report and the main-site election/geography data sources
  - Compared `test/metadata/elections-test2-report.json` against `js/election-controller.js` geography rules, aliases, and `_aliasVariants`.
- [x] Identify recurring unmatched geography/name patterns by election body, year, and source map
  - Found repeatable gaps around national referendum/president geography, 2009 Irish EP source selection, Dáil alias carry-over, Unicode dash handling, ROI local-authority labels, and NI local-government code prefixes.
- [x] Patch deterministic manifest-builder normalisation/crosswalk rules rather than editing generated bundles by hand
  - Patched `scripts/build-test2-election-manifest.mjs` with source-specific aliases, stronger name-key compaction, Unicode dash normalisation, national aggregate geography rules, ROI local-authority referendum routing, 2009 EP reuse of 2004 boundaries, and local-government body/code variants.
- [x] Regenerate `/test2` election metadata and report improved matched/unmatched coverage
  - Regenerated `test/metadata/elections-test2.json`, `test/metadata/elections-test2-report.json`, and affected per-election bundles.
  - Coverage improved from the pre-follow-up baseline of 489 loadable / 59 placeholders / 3,467 matched / 1,217 unmatched to 519 loadable / 29 placeholders / 3,946 matched / 738 unmatched.
- [x] Verify with syntax checks, `/test2` validation/build/checks, and targeted browser coverage where affected
  - `node --check scripts/build-test2-election-manifest.mjs` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved rerun outside the sandbox because esbuild spawning was blocked by `EPERM`.
  - `npm run test:browser:test2` passed after approved rerun outside the sandbox because Playwright browser spawning was blocked by `EPERM`: 14/14 tests passed.
- [x] Document residual blockers with exact evidence
  - Residual unmatched rows are dominated by intentionally unmapped pre-1974 Dáil elections (`sourceMapId: null`, 620 unmatched) because the main-site controller also records those eras as deferred until the relevant FGB sources are available.
  - Remaining non-null mismatches are mostly not safe one-to-one aliases: university seats without polygons, Stormont by-elections without matching boundaries, referendum result names reported on older/newer constituency schemes, and split/merged seats such as Dublin Fingal East/West or Tipperary North/South.

Bounded /test2 UI parity slice for URL/state/search/detail/source/active panel behavior
- [x] Record the implementation request and owned-file scope
  - Scope is limited to `test2/src/app.js`, `test2/src/test2.css`, `tests/browser/test2-app.spec.js`, `scripts/validate-test2-route.mjs`, plus this task tracker.
- [x] Inspect production `uiController` state/search/detail/source/active-panel behavior and compare it with `/test2`
  - Production already owns catalogue detail rendering, map action strips, source download/reference surfaces, feature detail links, and active layer controls.
  - `/test2` currently restores only layers, search text, camera, active panel, and controls, with no detail/source/hidden-layer state and panel restore implemented through click side effects.
- [x] Implement the smallest `/test2` state bridge that restores and persists search, catalogue detail, source panel, active layers panel, controls panel, and layer visibility without changing the production shell or MapLibre adapter architecture
  - Added URL persistence/restoration for `q`, `detail`, `source`, `hidden`, `activePanel`, `controls`, `base`, `lng`, `lat`, and `z`.
  - Wrapped production catalogue detail/list methods so `/test2` detail navigation updates URL state while still using the production shell renderer.
  - Added a scoped fixed-position source panel fed from converted metadata/main map metadata, plus source buttons on active layer rows.
  - Fixed restore ordering so `base=` waits for MapLibre style readiness before changing the base map.
  - Kept generated bundles untouched; temporary verification bundles were written only to `C:\tmp`.
- [x] Add browser/static guardrails for restored URL state, source/detail behavior, active panel persistence, and path preservation
  - Added browser coverage for restored hidden layer, search text, catalogue detail, source panel, active layers panel, controls panel, base map, camera, URL path, and closing state.
  - Added static validation for hidden/detail/source URL state, catalogue bridge, hash restore listener, direct panel setters, style-ready base-map restore, and source-panel stacking.
- [x] Verify with syntax checks, `/test2` route validation, build/check commands, and browser tests
  - `node --check test2/src/app.js` passed.
  - `node --check tests/browser/test2-app.spec.js` passed.
  - `node --check scripts/validate-test2-route.mjs` passed.
  - `npm run check:test2` passed.
  - Temporary esbuild verification to `C:\tmp\test2-parity.bundle.js` and `C:\tmp\test2-parity.bundle.css` passed after approved reruns outside the sandbox due esbuild `spawn EPERM`.
  - Targeted local Playwright smoke with route interception to the temporary bundle passed for restored URL/detail/source/active-panel behavior.
  - Full `npm run test:browser:test2` was not run because the normal test route would load the existing generated bundle, and this slice explicitly avoids modifying generated bundles.
- [x] Document review results and any remaining limits
  - Review:
    - `/test2` now restores and persists the non-data state surface needed for URL/search/detail/source/active-panel parity without changing the production shell markup or generated bundles.
    - The source panel is intentionally `/test2`-scoped and fixed-position because `test2/index.html` does not include the separate `/test` source-panel markup.
    - Remaining deeper parity work stays outside this slice: generated bundle refresh/deployment, election/data-entry workflows, and any broader adapter work already tracked separately.

Bounded non-data /test2 adapter parity slice
- [x] Record the implementation request and ownership scope
  - Scope is `test2/src/maplibre-main-adapter.js`, with tests/validator edits only if behavior changes need guardrails.
  - Do not touch generated bundles or unrelated dirty/untracked worktree files.
- [x] Inspect current adapter stubs and main-shell contracts for partial features, overlay toggles, and feature queries
  - Found adapter stubs for overlay toggles, partial feature toggle/unload/load checks, point lookup, and flat loaded-feature/query payloads.
  - `/test2/src/app.js` still owns some UI callback stubs, but that file is outside this slice's ownership, so this pass keeps behavior in the adapter and guardrails.
- [x] Implement feasible adapter-only parity without new data or Leaflet paths
  - Replace partial-feature load/visibility stubs with MapLibre feature-state/filter behavior where possible.
  - Add overlay toggles using existing raster tile overlay sources.
  - Return richer, de-duplicated loaded/query feature payloads with nested `properties` and `geometry`.
- [x] Add/adjust guardrail tests and static validation for changed behavior
  - Added browser guardrails for adapter overlay toggles, partial feature visibility/unload/expand, and richer loaded-feature payload shape.
  - Added static route checks to prevent overlay/partial stubs and require rich feature normalization.
- [x] Run focused verification and record results
  - `node --check test2/src/maplibre-main-adapter.js` passed.
  - `node --check tests/browser/test2-app.spec.js` passed.
  - `node --check scripts/validate-test2-route.mjs` passed.
  - `node scripts/validate-test2-route.mjs` passed.
  - `npm run check:test2` passed.
  - In-memory adapter harness passed for overlay show/hide, partial filter hide/show/unload, group visibility, and loaded-feature deduplication/payload shape.
  - `npm run build:test2` was attempted for browser verification but failed in the sandbox with esbuild `spawn EPERM`; escalation was rejected because it would modify generated bundles, so browser tests were not run in this no-generated-bundle slice.

Implement full main-to-/test2 feasible parity and data completion
- [x] Record the implementation request
- [x] Rebuild the implementation backlog from the prior parity review into concrete tracks: UI shell/workflow parity, MapLibre adapter parity, URL/state/search/details parity, data acquisition/conversion, and verification/deployment guardrails
  - Covered by the subagent/UI-adapter slices plus the data conversion pass below.
- [x] Implement non-data-blocked UI and adapter parity work
  - Added `/test2` URL persistence/restoration for catalogue detail, source panel, hidden layers, active panels, base map, and viewport.
  - Added source-panel affordances, richer active-layer source links, overlay toggles, partial-feature load/hide/show/unload, richer feature payloads, and property-based partial-feature filters.
- [x] Obtain or locate missing source data for blocked maps where possible without deleting existing data
  - Downloaded cached source data for `ni-townlands-1844` and `wards-2012-full`.
  - Located a repo-local fallback for `wards-1993-50k` at `data/maps/local-government/Wards_1993.fgb`.
  - Added SRS overrides for `pc-1995`, `ni-townlands-1844`, and the RWQ water-quality series so existing sources convert correctly.
- [x] Convert/register newly obtained data into `/test2` metadata, PMTiles/MVT/raster assets, and search indexes
  - Converted/promoted ten newly available MVT layers: `ni-townlands-1844`, `pc-1995`, `wards-1993-50k`, `wards-2012-full`, and six RWQ water-quality layers.
  - Refreshed feature-search indexes for the ten new layers and refreshed CDN/range metadata for the 544 existing PMTiles layers.
  - New converted inventory is 659 loadable `/test`/`/test2` layers: 544 CDN-backed PMTiles layers, 10 directory-MVT layers from this pass, and 105 raster/image layers.
- [x] Add/extend regression checks for newly aligned behavior and data coverage
  - Extended `/test2` browser coverage for URL/source/detail restore, overlay toggles, partial-feature state, rich loaded-feature payloads, and main-shell path preservation.
  - Kept `/test` validation over metadata, CDN manifest, tile budgets, security, production-route readiness, visual parity, mobile performance, and browser smoke.
- [x] Run verification and record remaining blockers with evidence
  - Verification passed: `npm run build:test`, `npm run build:test2`, `npm run check:test`, `npm run check:test2`, `npm run check`, `npm run test:browser:test`, `npm run test:browser:test2`, `npm run test:visual:test`, `npm run test:visual:test2`, `npm run test:performance:test`, `npm run test:performance:test2`, and `npm run verify:test:pmtiles-cdn`.
  - Remaining blockers:
    - The ten newly promoted layers are directory MVT rather than PMTiles because this local GDAL install lacks a PMTiles driver. Existing 544 PMTiles layers remain CDN-backed and byte-range verified.
    - `habitat-deciduous-woodland` still needs retile/generalisation work; brute-force GDAL MVT conversion timed out.
    - Twenty-two warning-level tile budget findings remain, including `ni-townlands-1844`; they pass hard budgets but should be retiled/generalised before production promotion.
    - `habitat-wetland-grouped-vector-test` still lacks a feature-search index.
  - Recurring issue prevention:
    - Symptom: partial-feature adapter state could say a feature was loaded while MapLibre rendered none, or a hidden partial feature could be queried before the render cycle caught up.
    - Root cause: the adapter used fragile feature-id assumptions and tests queried immediately after `setFilter`.
    - Permanent prevention action: property/name-based filters and browser guardrails now exercise partial load/hide/show/unload with render-cycle waits.
    - Verification evidence: `/test2` adapter browser coverage passes and `tasks/lessons.md` lesson 118 records the guardrail.

Resolve remaining /test2 data and performance limits
- [x] Record the follow-up request
- [x] Build PMTiles archives for the ten newly promoted directory-MVT layers and switch verified archives to CDN URLs
  - Built PMTiles for the ten newly promoted layers and updated metadata to prefer CDN-hosted PMTiles after successful upload and byte-range verification.
  - Added source-SRS handling for the 1995 postcodes, NI 1844 townlands, and WQ RWQ layers so PMTiles generation does not silently misproject or fail.
- [x] Generate the missing `habitat-wetland-grouped-vector-test` feature-search index or record the exact metadata/source blocker
  - Rebuilt feature-search indexes with elevated access after the sandboxed GDAL field inspection produced no indexes. `habitat-wetland-grouped-vector-test` now has 32,885 searchable features.
- [x] Retile or generalize `habitat-deciduous-woodland` so it can be promoted without timing out
  - Promoted `habitat-deciduous-woodland-vector-test` using the bounded LOD0 FGB source so conversion completes and the layer remains mobile-safe. The generated index contains 553 searchable features.
- [x] Reduce the 22 warning-level tile-budget findings where feasible without losing map correctness
  - Retuned habitat and NI townlands profiles, converted production layers to CDN PMTiles, and changed the budget validator to suppress directory-MVT fallback warnings only for CDN-backed PMTiles where the runtime disables local fallback on production Pages.
- [x] Rebuild metadata/bundles and rerun `/test`, `/test2`, CDN, tile-budget, browser, visual, and mobile checks
  - `npm run verify:test:pmtiles-cdn` passed: 555 assets checked, 555 OK, 0 failed.
  - `npm run check:test` passed with 0 warnings and 0 errors; 17 development-only fallback warnings were suppressed for CDN PMTiles.
  - `npm run build:test`, `npm run build:test2`, `npm run check:test2`, and `npm run check` passed.
  - `npm run test:browser:test`, `npm run test:browser:test2`, `npm run test:visual:test`, `npm run test:visual:test2`, `npm run test:performance:test`, `npm run test:performance:test2`, and `npm run smoke:test:mobile` passed.
- [x] Document any residual blockers with evidence
  - No known warning-level limits remain from this list. The broader data-coverage gap remains separate: 188 main-site entries are still not directly converted/loadable in `/test2`, and `habitat-deciduous-woodland` intentionally uses the coarser LOD0 source for mobile safety until a multi-zoom LOD packaging workflow is added.

Fix remaining /test2 data coverage and deciduous woodland LOD limits
- [x] Commit and push the previously completed resolved-limits work
  - Committed `0b102501f` (`Resolve test2 PMTiles coverage limits`) and pushed it to `main`.
- [x] Re-inventory `/test2` direct-load coverage against the main-site catalogue and port plan
  - Current port-plan status after the first conversion pass: 733 converted rows, 16 still marked `needsVectorTileConversion`, and 152 metadata-only rows.
  - The 16 remaining vector rows are: `britain-ireland-seas`, `ireland-island`, `all-ireland-townlands`, `roi-counties-2011`, `ni-1921`, `roi-1938`, eight historic-point layers, `transport-lines-road-rail`, and `dcc-dcc-public-cycle-parking-stands`.
- [x] Determine which remaining entries are already covered by composite/variant/metadata-only logic versus still needing real data conversion
  - `all-ireland-townlands` is already loadable in `/test2` through converted `ni-townlands` and `roi-townlands` composite children, so the direct monolithic source should not be promoted just to satisfy a naive direct-row count.
  - `ireland-island`, `ni-1921`, `roi-1938`, the historic point layers, and `transport-lines-road-rail` have valid lon/lat extents in their source FGBs but missing source SRS metadata, causing generated MVT bounds near 0,0.
  - `britain-ireland-seas` generated correctly but falls outside the current Ireland-only promotion bounds gate.
  - `dcc-dcc-public-cycle-parking-stands` has malformed stored geometry but usable latitude/longitude attribute fields that can be used to build corrected point geometry.
  - `roi-counties-2011` remains suspect: the local GeoJSON itself has coordinates outside Ireland, so it should not be promoted until the source CRS/data issue is resolved or a better source is selected.
- [x] Implement feasible metadata/conversion fixes for directly loadable entries without deleting or replacing existing source data
  - Added WGS84 assignment for cached lon/lat FGBs with missing SRS metadata.
  - Added a corrected DCC public-cycle-parking point build path using the source coordinate fields instead of the malformed stored geometry.
  - Widened the promotion bounds gate only for `britain-ireland-seas`, while retaining the Null Island and Ireland-bounds guards for ordinary layers.
  - Left `roi-counties-2011` unpromoted because the local source coordinates are already outside Ireland before conversion.
- [x] Add or constrain a multi-zoom LOD PMTiles packaging path for `habitat-deciduous-woodland`, or document the exact blocker if GDAL cannot safely merge zoom tiers
  - Added a constrained low/high zoom path: directory MVT uses LOD0 for z0-z7 and LOD1 for z8-z12; PMTiles packaging builds separate MBTiles tiers, merges their tile rows, then converts the merged archive to PMTiles.
- [x] Regenerate affected metadata, indexes, reports, and bundles
  - Regenerated 14 corrected MVT outputs, promoted 15 PMTiles-backed layers including `britain-ireland-seas`, rebuilt the CDN manifest, uploaded the 15 regenerated archives to R2 after retrying transient DNS failures, verified CDN byte-range support for the 15 regenerated archives, switched those layers to CDN URLs, and rebuilt targeted feature indexes.
- [x] Verify `/test2` coverage, mobile smoke, tile budgets, CDN PMTiles, browser tests, and main build checks
  - `npm run check:test` passed after the second pass: 799 loadable layers, 588 PMTiles layers, 40 CDN-PMTiles development fallback warnings suppressed, 0 warnings, 0 errors.
  - `npm run verify:test:pmtiles-cdn` passed for all 588 active PMTiles layers after the targeted CDN range report was expanded back to a full report.
  - `npm run check:test2`, `npm run check`, `npm run build:test`, and `npm run build:test2` passed; the two builds required approved non-sandbox execution because esbuild is blocked by sandbox `spawn EPERM`.
  - Targeted mobile smoke for the corrected heavy layers and `habitat-deciduous-woodland-vector-test` passed after runtime min-zoom gates were added for dense transport/risk/habitat layers.
- [x] Document residual data blockers with evidence
  - Current `/test`/`/test2` metadata has 799 loadable layers and 154 unconverted catalogue entries.
  - The only deliberately unpromoted vector row from the direct-fix set remains `roi-counties-2011`; the local source coordinates are outside Ireland before conversion, so promoting it would reintroduce invalid bounds.
  - Dense transport/risk/habitat layers now use higher runtime min-zooms to avoid rendering hundreds of thousands of features at the default Ireland viewport on mobile.
  - ROI national planning PMTiles could not be built directly from FGB with GDAL; the successful path is FGB -> retuned MBTiles -> PMTiles, producing a 273,203,738-byte archive that is under Wrangler's upload limit and byte-range verified on the CDN.

Review main site versus /test2 parity
- [x] Record the review request
- [x] Inventory main and `/test2` shell, catalogue, map-engine, URL, interaction, and data paths
  - `index.html` and `test2/index.html` expose the same 90 DOM ids and the same production shell containers; `/test2` replaces Leaflet assets with its MapLibre bundle and CSS.
  - `/test2` reuses production `dataService`, `featureLoader`, and `uiController`, then wires the UI contract to `Test2MapLibreMainAdapter`.
- [x] Compare runtime behavior and existing parity guardrails
  - `node scripts/validate-test2-route.mjs` passes, covering shell preservation, route isolation, hash preservation, MapLibre-only engine, DOM label dedupe, orange hover/selection styling, transparent polygon fills, and composite fallback checks.
  - Existing browser coverage exercises boot, Ireland default camera, converted layer loading, URL restore, townlands/1926 composite children, hash preservation, labels, selected feature cards, support/theme/mobile shell, and no production service worker.
- [x] Separate differences into feasible/sensible alignment, MapLibre-specific intentional divergence, and data-blocked gaps
  - Main callbacks still have real election, data-entry, co-load, partial-feature, chunk-download, time-slider, conditional-styling, runtime-debug, and production service-worker paths; `/test2` implements the same surface where currently practical and stubs or approximates the Leaflet-specific paths.
  - Current metadata inventory: 901 port-plan rows; 702 converted, 47 still needing vector-tile conversion, 152 metadata-only. Visible main catalogue count found 751 entries; 555 directly loadable in `/test2`, 14 covered through converted composite/variant children, and 182 not directly loadable yet.
- [x] Report findings inline in chat

Make /test2 polygon fills transparent by default like main
- [x] Record the implementation request
- [x] Inspect main-site style defaults and `/test2` MapLibre fill defaults
  - Main Leaflet styling defaults ordinary polygon `fillOpacity` to `0`; `/test2` was still using a MapLibre fallback of `0.18`.
- [x] Patch `/test2` style transfer so ordinary boundary fills default transparent while explicit fill settings are preserved
  - Added a shared transparent vector fill fallback while keeping explicit per-map `style.fillOpacity` values and raster opacity handling intact.
- [x] Add regression coverage for transparent defaults and explicit fill preservation
  - Added route validation to forbid the old `0.18` fallback and browser coverage proving the representative civil-parishes fill starts transparent while real explicit main-site fill opacity remains preserved.
- [x] Verify with `/test2` checks/build/browser tests
  - `node --check` passed for the edited `/test`, `/test2`, test, and validation modules.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after rerunning outside the sandbox because esbuild hit the known `spawn EPERM`.
  - `npm run test:browser:test2` passed all 9 tests, including the new transparent-fill assertion.
  - Because the shared MapLibre controller changed, `npm run build:test`, `npm run check:test`, `npm run test:browser:test`, and `npm run check` also passed. Known `/test` tile-budget/CDN warnings remain warning-only.
- [x] Commit and push
  - Committed the transparent-fill parity fix, guardrails, tests, and rebuilt `/test`/`/test2` bundles for deployment.

Fix /test2 composite parent loading gaps
- [x] Record the implementation request
- [x] Inventory parent catalogue maps whose direct parent layer is not converted but whose child variants/composite sources are converted
  - Found 13 parent entries with no direct converted parent layer and converted children. Most were already explicit `isGroup` entries; the visible non-group availability gaps are `all-ireland-townlands` and `eds-1926`.
- [x] Implement generic `/test2` composite fallback loading for those parents
  - `/test2` now checks whether the parent layer is directly loadable. If not, it loads converted `compositeSources` or converted non-group variants as child layers, marks the parent as a logical group, fits to the parent bounds, and includes the parent in loaded/visible state.
- [x] Add regression coverage for townlands and other affected parents
  - Added browser coverage proving `all-ireland-townlands` loads `ni-townlands` + `roi-townlands`, and `eds-1926` loads its converted regional children.
  - Added route validation requiring the composite fallback path.
- [x] Verify with `/test2` checks/build/browser tests
  - `node --check test2/src/app.js`, `node --check test2/src/maplibre-main-adapter.js`, and `node --check tests/browser/test2-app.spec.js` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after rerunning outside the sandbox because esbuild hit the known `spawn EPERM`.
  - `npm run test:browser:test2` passed all 9 tests.
- [x] Commit and push
  - Included the composite-parent fallback and rebuilt `/test2` bundle in the deployment commit.

Review why townlands is unavailable on /test2
- [x] Record the question and inspect the metadata path
- [x] Compare main catalogue townlands ids with converted MapLibre metadata
- [x] Explain the cause and feasible fix
  - Finding:
    - The main catalogue's visible Townlands card is `all-ireland-townlands`, whose source is the all-island FGB and whose variants are `ni-townlands` and `roi-townlands`.
    - `/test2` has converted PMTiles for `ni-townlands` and `roi-townlands`, plus the 1844 county variants, but it does not have a converted layer registered directly as `all-ireland-townlands`.
    - `/test2` currently only expands `members`/`variants` automatically when the map object is marked `isGroup`. `all-ireland-townlands` has variants but is not marked `isGroup`, so `/test2` tries to resolve the parent id directly and reports it unavailable.
  - Feasible fix:
    - Treat main-site maps with `compositeSources` or variants as MapLibre composite loads when their converted child layers exist, so clicking the visible Townlands parent loads `ni-townlands` and `roi-townlands` together instead of requiring a parent PMTiles archive.

Test2 full data migration pass
- [x] Refresh the main-site port inventory and vector intake manifest without deleting or modifying source data.
- [x] Convert all locally available vector candidates to generated MVT outputs.
- [x] Promote verified generated vector/raster outputs into `test/metadata/maps-test.json`.
- [x] Generate or refresh PMTiles archives for all promoted vector layers.
- [x] Generate feature-search indexes for promoted vector layers.
- [x] Generate/update CDN upload manifests and, where credentials permit, upload PMTiles to R2/CDN.
- [x] Verify PMTiles byte-range support and switch metadata to authoritative CDN URLs where valid.
- [x] Tune/validate heavy layers, raster/image entries, metadata-only entries, time-series chains, and election-data readiness reports.
- [x] Run route, tile-budget, CDN-manifest, browser, visual, mobile-performance, and production checks.
- [x] Record completed data work, unrecoverable blockers, and next required source/auth inputs.
  - What I changed:
    - Added a resumable vector-source downloader and cached remote vector sources under `test/source-cache/vector-intake` without modifying or deleting original source data.
    - Extended the batch vector builder to use cached remote sources, support zip inputs, resume verified existing outputs, force rebuilds when needed, and write progress reports incrementally.
    - Promoted verified conversions into `/test` metadata, generated PMTiles archives, uploaded active PMTiles to R2, verified byte-range serving through `https://data.civgraph.net`, and switched active metadata to CDN PMTiles URLs.
    - Rebuilt feature-search indexes and fixed index generation for source fields with characters such as `name:en` and `name:ga`.
    - Added URL alias lookup for `sourceMapId` and `port-*` ids so saved catalogue-detail URLs survive when a map becomes converted.
    - Quarantined generated-but-invalid or over-budget output instead of deleting it: `test/tiles/generated/roi-counties-2011` was moved to `test/tiles/quarantine/roi-counties-2011`, and four over-budget PMTiles archives were moved to `test/pmtiles/quarantine`.
  - Results:
    - Main-site port plan: 901 rows; 702 converted, 47 still need vector-tile conversion, 152 metadata-only.
    - Vector conversion report: 625 selected local/cached candidates; 617 converted, 8 failed, 124 skipped.
    - Active `/test` metadata: 649 active MapLibre entries, including 544 PMTiles-backed layers and 105 raster/image entries. The runtime still shows 199 not-yet-converted catalogue entries via the port-plan merge.
    - CDN manifest/range verification: 544 active PMTiles assets, 544 passed byte-range checks, 0 failed.
    - Feature indexes: 493 index files generated; 492 active metadata entries currently reference feature indexes after demoting over-budget layers.
  - Remaining blockers:
    - Eight vector conversions still need data/build follow-up: `pc-1995`, six RWQ water-quality layers with missing MVT `vector_layers[0].id` metadata, and `habitat-deciduous-woodland`.
    - Four converted datasets were deliberately not promoted because their generated tiles exceed hard mobile budgets and need retile/generalisation work: `wq-agricultural-critical-risk-vector-test`, `transport-carriageway-defects-2021-vector-test`, `dcc-dublin-metropolitan-area-existing-protected-cycle-infrastructure-2025-vector-test`, and `dfi-surface-defects-2017-vector-test`.
    - Nineteen active layers remain warning-level large-tile/large-directory cases; they pass hard budgets but should be retiled/generalised before production promotion.
  - Verification:
    - `npm run build:test` passed.
    - `npm run build:test2` passed.
    - `npm run check:test` passed with warning-only large-tile/local-fallback findings.
    - `npm run check:test2` passed.
    - `npm run verify:test:pmtiles-cdn` passed: 544/544 byte-range checks.
    - `npm run test:browser:test` passed all 15 tests.
    - `npm run test:browser:test2` passed all 6 tests.
    - `npm run test:visual:test` passed: main/test header 64px and catalogue width 683px.
    - `npm run test:visual:test2` passed: header 64px and catalogue width 683px.
    - `npm run test:performance:test` passed: boot 412ms; representative layers loaded within the smoke budget.
    - `npm run test:performance:test2` passed: boot 387ms, layer 1171ms, 4,882 rendered features, 64 MB heap.
    - `npm run check` passed production chunked-map guardrails.
  - No-data-loss note:
    - No source datasets were deleted. Failed, invalid, or over-budget generated outputs were retained in cache/quarantine locations where they can be inspected or regenerated later.

Test2 hash route preservation bug
- [x] Preserve `/test2/` in the browser URL when loading layers or clicking catalogue hash links.
- [x] Add regression coverage proving hash-only URL updates cannot strip `/test2/`.
- [x] Rebuild `/test2` and run focused checks.
  - Symptom:
    - Loading a layer on `/test2/` can change the URL to `https://civgraph.net/#...`, dropping `/test2/`.
  - Root cause:
    - `/test2/index.html` keeps `<base href="/">` so root-relative production assets resolve correctly, but hash-only URLs such as `#layers=...` are resolved against the document base URL by some legacy shell/catalogue paths.
  - Permanent prevention action:
    - Add a `/test2` route guard that preserves the current pathname for hash-only `history.pushState`/`replaceState` calls and hash-only catalogue anchors.
  - What I changed:
    - Added `Test2App.installRouteGuard()` before shell boot so hash-only history writes are rewritten to the current `/test2/` pathname and catalogue anchors are handled without letting `<base href="/">` resolve them at the site root.
    - Bumped `/test2` bundle cache keys from `test2-001` to `test2-002` so the live route requests the rebuilt bundle.
    - Added static route validation and Playwright coverage for layer-load URL state, catalogue hash-anchor navigation, and legacy hash-only `history.replaceState`/`pushState`.
  - Verification:
    - `npm run build:test2` passed.
    - `npm run check:test2` passed.
    - `npm run test:browser:test2` passed all 7 tests.

Test2 default camera bug
- [x] Preserve the Ireland default camera when `/test2/` loads without URL coordinates.
- [x] Add regression coverage proving empty URL state does not jump to 0N 0W.
- [x] Rebuild `/test2`, run focused tests, commit, and push.
  - Symptom:
    - Opening `/test2/` with no layer/viewport hash can centre the map near 0N 0W instead of Ireland.
  - Root cause:
    - URL restore used `Number(params.get('lng'))` and `Number(params.get('lat'))`; when params were missing, `Number(null)` became `0`, so the empty URL was interpreted as a valid `[0, 0]` camera.
  - Permanent prevention action:
    - Restore viewport only when both `lng` and `lat` params are explicitly present, and cover this with a browser regression.
  - What I changed:
    - Updated `/test2` URL restore so it only parses and applies a viewport when both `lng` and `lat` are present in the URL state.
    - Added route validation that fails if the explicit viewport-param guard is removed.
    - Added a browser regression proving an empty `/test2/` URL boots with a centre inside Ireland and a normal zoom level.
    - Bumped `/test2` bundle cache keys from `test2-002` to `test2-003` so live clients fetch the rebuilt bundle.
  - Verification:
    - `npm run build:test2` passed.
    - `npm run check:test2` passed.
    - `npm run test:browser:test2` passed all 8 tests.

Test2 feature label and hover parity bugs
- [x] Ensure `/test2` renders no more than one visible label per visible feature.
- [x] Match main-site hover semantics: light orange fill, deeper orange outline/label treatment, underlined hover label.
- [x] Match main-site feature-card triggers where practical: label single-click and feature double-click open the top-right map-pane info card.
- [x] Review nearby interaction discrepancies and add regression coverage.
  - Symptom:
    - `/test2` could show repeated labels for the same vector-tile feature, lacked main-site orange hover styling, and did not match the main site’s label-click/feature-card interaction.
  - Root cause:
    - `/test2` relied on native MapLibre symbol labels. Polygon features split across vector tiles can produce repeated symbol placements, and MapLibre text layers do not support the same DOM hover/click/underline behaviour as the Leaflet label markers on the main site.
  - Permanent prevention action:
    - Keep native MapLibre symbol labels visually hidden, render a deduplicated DOM label overlay for interactive labels, collision-suppress overlapping labels, and cover label count, hover state, label click, feature double-click, and map-pane card placement in browser tests.
  - What I changed:
    - Added deduplicated MapLibre DOM labels with one visible label per feature id and viewport collision suppression.
    - Added orange feature hover layers: light orange polygon fill and deeper orange stroke/label treatment.
    - Wired DOM label hover/click and geometry double-click into the same feature selection/info-card path as the main shell.
    - Added route validation guardrails for DOM labels, hidden native symbols, and double-click selection wiring.
    - Bumped `/test2` bundle cache keys from `test2-003` to `test2-004`.
  - Verification:
    - `npm run build:test2` passed.
    - `npm run check:test2` passed.
    - `npm run test:browser:test2` passed all 8 tests.

Test2 selected feature orange parity regression
- [x] Record the regression and scope
  - Symptom:
    - Selecting a feature in `/test2` showed a thick black outline, even though hover parity expects light orange fill, deeper orange stroke, and orange label styling.
  - Root cause:
    - The shared MapLibre selected layer used `#111827` for selected outlines/points, and selected labels defaulted to a dark colour instead of the orange hover colour.
  - Permanent prevention action:
    - Make selected MapLibre states reuse the main-style orange hover treatment and add route/browser checks for selected fill/stroke/label colours.
- [x] Patch the shared MapLibre selected feature and label styling
  - Added shared orange interaction constants, replaced the old black selected stroke/point colour, added selected polygon fill layers, and made selected labels use the same orange text/underline treatment as hover.
- [x] Add/extend regression tests for selected styling
  - Added static `/test2` route checks rejecting the old black selected styling and requiring selected fill/stroke/label support.
  - Extended the `/test2` browser interaction test to assert selected label class, orange label text, selected fill colour, selected stroke colour, selected stroke width, and selected feature-state.
- [x] Verify with focused `/test2` build/check/browser coverage
  - `node --check test/src/map-controller.js`, `node --check test/src/labels.js`, `node --check tests/browser/test2-app.spec.js`, and `node scripts/validate-test2-route.mjs` passed.
  - `npm run build:test2` passed after rerunning outside the sandbox because esbuild hit the known `spawn EPERM`.
  - `npm run check:test2` passed.
  - `npm run test:browser:test2` passed all 8 tests.
  - `npm run check:test` passed with existing warning-only tile/CDN findings.
- [x] Commit and push
  - Included this selected-state parity fix in the follow-up `/test2` commit for deployment.

Test2 label colour and unnamed feature regression
- [x] Make `/test2` hovered labels change text colour directly instead of looking orange-masked.
- [x] Ensure `/test2` feature info cards receive nested `properties` so names resolve correctly.
- [x] Add browser/static coverage for label colour and non-unnamed feature cards.
  - Symptom:
    - Hovered `/test2` labels looked like the original label had an orange mask/outline applied, and selecting a feature could show `Unnamed Feature` in the top-right card.
  - Root cause:
    - The `/test2` hover CSS used orange text-shadow rather than the main site’s orange text with white halo. The MapLibre adapter flattened feature properties onto the selected feature object, while the main feature-info renderer reads `feature.properties`.
  - Permanent prevention action:
    - Keep hovered label colour as direct `#ff7a1a` text with white halo, and require nested `properties`/`geometry` in the `/test2` selection adapter. Browser tests now assert named feature cards and direct orange text colour.
  - What I changed:
    - Updated `/test2` label hover CSS to use orange text and white halo, removing the orange mask effect.
    - Updated `Test2MapLibreMainAdapter.handleSelection()` to pass `properties` and `geometry` in the shape expected by the main info-card renderer.
    - Added route validation for direct label colour and nested selection payloads.
  - Verification:
    - `npm run build:test2` passed.
    - `npm run check:test2` passed.
    - `npm run test:browser:test2` passed all 8 tests.

Test2 parity completion pass for non-data-blocked work
- [x] Implement MapLibre equivalents for Leaflet-only actions that are feasible without new data: opacity, label toggles, feature query, feature details, URL restore, group/variant load handling, fit/highlight, address marker, and unsupported-workflow warnings.
- [x] Add `/test2` route validation so it cannot regress to loading Leaflet, the production bundle, or the production service worker.
- [x] Add visual, mobile/performance, deployment-readiness, and service-worker/cache guardrails for `/test2`.
- [x] Expand browser coverage for catalogue detail, URL restore, controls, feature detail, mobile shell, support/theme, unsupported map warnings, and accessibility smoke.
- [x] Run build/check/browser/performance verification and record remaining limits.
  - What I changed:
    - Extended the `/test2` MapLibre adapter to cover the feasible main-site action surface: layer/group loading, local MVT fallback for PMTiles during local testing, opacity/fill/raster controls, label toggles, text scaling, base-map switching, feature queries, feature details/highlighting, address markers, and group loaded-state aliases for main catalogue ids.
    - Preserved `/test2` URL/share state for layers, search, viewport, active-layers panel, and map-controls panel. Fixed a route bug caused by `<base href="/">` so hashes now stay under `/test2/`, and fixed the boot race that could overwrite saved layer state before restore.
    - Added `/test2` route isolation validation, visual shell regression, mobile performance smoke, production-readiness documentation, and browser coverage for catalogue detail, URL restore, controls, selected features, support/theme, accessibility smoke, unsupported-map notices, and service-worker isolation.
    - Added scoped `/test2` CSS for MapLibre attribution accessibility and route status messages.
  - Verification:
    - `npm run build:test2` passed.
    - `npm run check:test2` passed.
    - `npm run test:browser:test2` passed all 6 tests.
    - `npm run test:visual:test2` passed: header 64px, catalogue pane 683px.
    - `npm run test:performance:test2` passed: mobile boot 370ms, civil-parishes layer 1084ms, 4882 rendered features, 64 MB heap.
    - `npm run check` passed production chunked-map guardrails.
  - Remaining limits:
    - Data-blocked parity remains for unconverted maps, election workflows needing vector-tile geographies, full time-series chains that lack converted layers, and authoritative CDN/R2 byte-range monitoring until production PMTiles URLs are deployed.
    - Leaflet-only internals that do not sensibly translate to MapLibre are represented through adapter equivalents or unsupported-workflow warnings rather than copied literally.

Test2 verbatim main shell with MapLibre map engine
- [x] Keep `/test2` isolated from the production root route while using the production shell markup and CSS contract.
- [x] Boot `/test2` with the main catalogue/data controllers, but route map actions through a MapLibre adapter instead of Leaflet.
- [x] Preserve converted and unconverted catalogue entries in the main catalogue hierarchy.
- [x] Add a build path and focused browser checks proving the shell loads and a converted MapLibre layer can render.
- [x] Run verification and document remaining parity/data limitations.
  - What I changed:
    - Created `/test2` from the production `index.html`, keeping the production shell, navbar, split panes, catalogue containers, support modal, and main CSS contract.
    - Replaced only the engine boot path: `/test2` loads `/test2/build/test2.bundle.js` and does not load Leaflet or register the production service worker.
    - Added `test2/src/maplibre-main-adapter.js`, which exposes a main-catalogue callback surface backed by the existing MapLibre vector-tile renderer.
    - Added `test2/src/app.js`, which initializes production `dataService` and `uiController`, renders the main catalogue hierarchy, and wires load/unload/toggle/fit/search/detail callbacks to MapLibre where feasible.
    - Added `scripts/build-test2-app.mjs`, `npm run build:test2`, `npm run test:browser:test2`, and browser tests proving shell boot and a real converted vector-layer render.
  - Verification:
    - `npm run build:test2` passed after esbuild spawn required approved escalation.
    - `npm run test:browser:test2` passed: production shell visible, no global Leaflet present, MapLibre adapter initialized, catalogue rows rendered, and Civil Parishes rendered as a MapLibre vector layer.
    - `npm run check` passed the production chunked-map guardrails.
  - Remaining limits:
    - `/test2` is now the cleaner feasibility path for exact shell parity, but only maps with converted `/test` MapLibre metadata can render through MapLibre.
    - Leaflet-specific advanced behaviours such as per-feature partial loading, election-map loading, and some active-layer opacity internals are stubbed or simplified until equivalent MapLibre data/control paths are built.

Structural main-shell refactor for `/test`
- [x] Load the same main shell CSS and visible shell markup on `/test`
- [x] Introduce a MapLibre shell engine bridge so catalogue actions target MapLibre behind a main-style interface
- [x] Remove remaining default-visible `/test` UI identity from navbar/catalogue/map controls
- [x] Keep `/test`-only diagnostics/preferences available as advanced map-panel content, not as shell structure
- [x] Strengthen parity guardrails for exact shell classes, main CSS loading, and real MapLibre layer loading
- [x] Build and run `/test` static, browser, visual, and main guardrails
- [x] Record verification and remaining limits
  - What I changed:
    - `/test` now links the production shell CSS (`/build/main.critical.css` and `/build/main.css`) before the scoped test bundle.
    - Reworked the visible `/test` DOM toward the production shell contract: active Home nav state, direct main pane structure, production catalogue sticky shell/list/detail IDs, hidden legacy pane placeholders, and the production `mapControlPanel` map-control ID.
    - Added `test/src/map-engine.js` as a MapLibre shell-engine bridge; the catalogue now calls `load`, `fit`, `unload`, and share-copy methods through that boundary instead of talking directly to MapLibre controller internals.
    - Kept test-only diagnostics, source panels, feature panels, and preferences inside the advanced map settings panel rather than the default catalogue surface.
    - Bumped `/test` bundle and service-worker cache versions to `test-020`/`test-v20`.
    - Tightened the shell parity guardrail to assert production shell CSS loading and the main shell/control contract.
  - Verification:
    - `npm run build:test` passed.
    - `npm run check:test` passed with only the known warning-only large-tile/local-fallback findings.
    - `npm run test:browser:test` passed all 15 tests, including a real MapLibre vector-layer render.
    - `npm run test:visual:test` passed: main/test header height 64px, catalogue width 683px, map visible, main pane structure detected, no `/test` product header, and compact table catalogue detected.
    - `npm run check` passed the production chunked-map guardrails.
  - Remaining limits:
    - This is now a structural shell refactor with a MapLibre engine boundary, but full data parity is still limited by maps that are not converted to MapLibre-compatible sources.
    - Advanced MapLibre diagnostics/preferences are intentionally not identical to the main Leaflet control panel because those are renderer-specific operational tools.

Full main shell replacement for `/test`
- [x] Replace the remaining `/test`-specific map tools shell with the main map-pane control shell
- [x] Keep MapLibre mounted in the main map container and keep test diagnostics/source/preferences accessible as advanced controls
- [x] Update browser/static/visual guardrails so `/test` cannot drift back to a separate shell
- [x] Run build, `/test` checks, browser checks, visual checks, and production guardrails
- [x] Record final remaining limits
  - What I changed:
    - Removed the visible `/test`-specific "Map Tools" disclosure pattern from the default map surface.
    - Added the main map-pane shell controls: `activeLayersToggle`, `mapControlsToggle`, and a `map-control-panel` advanced drawer.
    - Kept MapLibre mounted in `#map`; diagnostics, active layers, feature details, source panels, time series, and preferences now live in the advanced map-control panel.
    - Added pointer-event scoping so the new map controls do not block the mobile catalogue toggle or map interaction.
    - Updated browser/static guardrails to assert the main map-control shell, not the old `/test` details element.
  - Verification:
    - `npm run build:test` passed.
    - `npm run check:test` passed with only the known warning-only large-tile/local-fallback findings.
    - `npm run test:browser:test` passed all 15 tests after the hit-target fix.
    - `npm run test:visual:test` passed with main/test header height `64px`, catalogue width `683px`, and main pane structure detected.
    - `npm run check` passed production chunked-map guardrails.
  - Remaining limit:
    - The shell and catalogue DOM contract are now main-style with MapLibre wired in. Literal shared production controller code still requires a future extraction of `js/ui-controller.js` into engine-neutral catalogue rendering plus Leaflet/MapLibre engine adapters.

Main catalogue contract reuse for `/test`
- [x] Inspect production catalogue controller boundaries and identify reusable contracts
- [x] Reduce `/test` catalogue divergence without importing Leaflet-specific production wiring
- [x] Route load/detail/fit/share actions through the existing MapLibre controller adapter
- [x] Preserve production root behaviour
- [x] Run `/test` build, static checks, browser checks, and visual checks
- [x] Record results and any remaining adapter work
  - What I changed:
    - Moved `/test` onto the production catalogue DOM contract: `searchInput`, `searchClear`, `filterStats`, `categoryPills`, `providerPills`, `catalogueListView`, `catalogueFlatView`, and `catalogueDetailView`.
    - Updated `/test` DOM lookup code to resolve production IDs first while retaining fallback aliases for older test-only IDs.
    - Updated the `/test` catalogue controller to toggle the main list/detail containers and render category/provider filters into the main pill containers.
    - Kept load/detail/fit/share/unload actions routed through the existing MapLibre controller, not production Leaflet objects.
    - Tightened the shell parity validation and browser tests to assert the main catalogue IDs.
  - Verification:
    - `npm run build:test` passed.
    - `npm run check:test` passed with only the known warning-only large-tile/local-fallback findings.
    - `npm run test:browser:test` passed all 15 tests, including real MapLibre vector-layer rendering.
    - `npm run test:visual:test` passed with main/test header height `64px` and catalogue width `683px`.
    - `npm run check` passed production chunked-map guardrails.
  - Remaining adapter work:
    - Literal shared production catalogue code still requires splitting `js/ui-controller.js` into engine-neutral catalogue rendering and Leaflet-specific action wiring. That is larger and should be done as a careful extraction, not by importing the current controller wholesale.

Main shell with MapLibre engine for `/test`
- [x] Inventory the main shell/catalogue DOM and `/test` MapLibre mount points
- [x] Rework `/test` to use the main site shell as the primary DOM contract
- [x] Keep MapLibre mounted in the map pane and route catalogue map actions to it
- [x] Preserve `/test` isolation so production Leaflet remains untouched
- [x] Build and run focused `/test` browser/visual checks
- [x] Record verification and remaining gaps
  - What I changed:
    - Moved `/test` onto the same top-level shell contract as the main site: `body.app-shell`, direct `header.app-header`, direct `main.app-main`, `.pane--info`, split bar, and `.pane--map`.
    - Removed the extra nested `/test` app-shell wrapper while keeping MapLibre mounted in the map pane at `#map`.
    - Kept MapLibre-specific diagnostics, preferences, source panels, active layers, and feature details inside the map-side tools area rather than making them the catalogue shell.
    - Bumped `/test` assets and scoped service-worker cache from `test-018`/`test-v18` to `test-019`/`test-v19`.
    - Updated the shell-parity guardrail to require the direct main-shell structure rather than the old `/test`-specific catalogue-shell class.
  - Verification:
    - `npm run build:test` passed after esbuild required escalated spawn permission.
    - `npm run check:test` passed with only the known warning-only large-tile/local-fallback findings.
    - `npm run test:browser:test` passed all 15 tests, including the real MapLibre vector-layer rendering regression.
    - `npm run test:visual:test` passed: main/test header height 64px, catalogue width 683px, main pane structure detected, no `/test` product header, and compact table catalogue detected.
  - Remaining gap:
    - This is now the same top-level shell pattern with MapLibre wired into the map pane, but the catalogue internals still use the `/test` metadata/controller renderer rather than literally importing `js/ui-controller.js`. A deeper adapter refactor can make the production catalogue controller engine-agnostic later.

Test shell alignment review
- [x] Compare the current `/test` navbar and catalogue pane against the main site
- [x] Identify structural, visual, and workflow differences that still prevent alignment
- [x] Propose a rectification plan focused on shared shell/catalogue contracts rather than incremental CSS tweaks
  - What I reviewed:
    - Current main and `/test` shell markup/classes in `index.html`, `test/index.html`, and `test/src`.
    - Existing visual regression report and snapshots under `test/metadata/visual-snapshots`.
  - Findings:
    - Header height and brand geometry now match, but the catalogue pane still uses a separate `/test` shell, sidebar, header, filters, default card layout, and secondary MapLibre panels.
    - Main uses the split `.app-main` / `.pane pane--info` shell with a catalogue-first table/list view; `/test` still uses `.test-shell` / `.test-sidebar` and a MapLibre-specific panel stack.
  - Result:
    - Proposed a rectification plan to replace approximation with main-shell parity, then route the interactive map area through MapLibre.

Test shell main-site rectification implementation
- [x] Replace `/test` shell/sidebar with the main `.app-shell` / `.app-main` / `.pane` structure
- [x] Remove the visible `/test` catalogue header and use the main catalogue sticky shell/filters layout
- [x] Make the default catalogue view the main compact table/list hierarchy while preserving converted and unconverted entries
- [x] Move MapLibre tools out of the default catalogue flow into a secondary advanced/map-side drawer
- [x] Strengthen shell visual tests so structural catalogue drift fails
- [x] Run `/test` validation, build, browser, and visual checks
  - What I changed:
    - Rebuilt `test/index.html` around the main shell contract: `.app-shell`, `.app-main`, `.pane pane--info`, `.pane pane--map`, split drag handle, and a catalogue-first left pane.
    - Removed the visible `/test`/MapLibre product header from the browsing surface and kept MapLibre status/tooling in the map-side Advanced drawer.
    - Made compact main-style catalogue rows the default using `catalogue-flat__toc-table`, with converted and unconverted maps rendered in the same hierarchy and unconverted maps marked with a subtle badge.
    - Reworked category/provider filters into the main sticky search shell and hid the old `/test` view/sort toolbar from the default UI.
    - Updated visual/static/browser tests to fail if `/test` drifts back to a separate product shell, visible product header, non-main pane structure, or non-table catalogue default.
  - Verification:
    - `npm run check:test` passed with the existing warning-only findings for large `roi-small-areas-2011-vector-test` and `roi-townlands-vector-test` tiles plus local-only PMTiles fallbacks.
    - Approved `npm run build:test` passed after sandboxed esbuild spawning required escalation.
    - Approved `npm run test:visual:test` passed: main/test header 64px, main/test catalogue width 683px, no `/test` product header, app/pane structure present, and 140 compact catalogue rows detected.
    - `npm run check` passed the main chunked-map guardrails.
    - Approved `npm run test:browser:test` passed all 14 browser tests after updating the catalogue test to assert the hidden-toolbar compact-table contract.

Repair /test shell regression after user report
- [x] Record the correction and update lessons
- [x] Reproduce the broken MapLibre interactive map with browser console/network evidence
- [x] Restore MapLibre map functionality with a minimal fix
- [x] Reassess main/test navbar and catalogue pane alignment against actual rendered UI
- [x] Replace weak shell parity checks with workflow checks that load a real layer
- [x] Run validation, build, browser, and visual checks
- [x] Commit and push the repair
  - What I changed:
    - Fixed the default `/test/` map jump to West Africa by parsing missing `lng`, `lat`, and `z` URL params as absent instead of `0`.
    - Bumped `/test` asset and service-worker cache versions from `test-017`/`test-v17` to `test-018`/`test-v18`, preventing mixed new-HTML/old-bundle cache states.
    - Added a browser regression that loads `civil-parishes-vector-test` through local MVT tiles and asserts rendered MapLibre features, real canvas dimensions, and Ireland-centered map state.
    - Moved `/test` category/provider filters out of the default catalogue surface and added the main-like Elections/Maps/Books/Tables top-link and decade rhythm to the compact catalogue.
    - Regenerated the `/test` bundle, visual snapshots, and validation reports.
  - Verification:
    - Approved `npm run build:test` passed.
    - Approved `npm run check:test` passed with the known warning-only large-tile/local-fallback findings.
    - Approved `npm run test:visual:test` passed and the screenshot now opens on Ireland, not `[0,0]`.
    - Approved `npm run test:browser:test` passed all 15 tests, including the new real MapLibre layer-rendering workflow.
    - Approved `npm run check` passed the main-site chunked-map guardrails.

Election party aliases and party IDs
- [x] Correct PUP aliasing to Progressive Unionist Party in the audit logic
- [x] Normalise Workers Party / Republican Clubs by date, DUP, PBP, and Alliance labels
- [x] Define stable Party IDs grouping aliases such as Ecology/Green and Republican Clubs/Workers Party
- [x] Rerun audit and provide the next 10 party/ticket names
  - What I changed:
    - Added an Ireland/NI audit alias so `PUP` resolves to `Progressive Unionist Party`, not the unrelated global abbreviation match.
    - Extended `scripts/normalize-election-party-names.py` for `DUP`, `PBP`, `Alliance`, and date-sensitive `Workers Party`/`Republican Clubs` labels.
    - The date rule treats exact-1977 `Workers Party / Republican Clubs` labels as `Republican Clubs`; post-1977 rows are `Workers Party`.
    - Added `scripts/build-election-party-ids.py` and generated `election-viewer-package/data/party-ids.json` plus `tasks/ireland_election_party_ids.csv`.
    - Updated bundle/aggregate composite keys so stale names are not left in generated election data.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\audit-ireland-election-party-colours.py scripts\build-election-party-ids.py`
    - `python scripts\normalize-election-party-names.py`
    - `python scripts\build-election-party-ids.py` wrote `850` party IDs and `1089` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1173` audit rows: `71` match, `142` colour mismatch, `910` no election colour, `50` no Wikipedia match.
    - `rg` found no remaining `Workers Party / Republican Clubs`, `Democratic Unionist Party`, `People Before Profit Alliance`, `People Before Profit`, `Alliance Party of Northern Ireland`, `Alliance Party`, or `Green / Ecology` strings under `election-viewer-package/data/elections`.
    - Parsed `7344` election JSON files successfully.

Election party aliases follow-up: DUP punctuation and Conservative plural
- [x] Normalise `D.U.P.` to `DUP`
- [x] Normalise `Democratic Unionist - DUP` to `DUP`
- [x] Normalise `Conservatives` to `Conservative`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for exact `D.U.P.`, `Democratic Unionist - DUP`, and `Conservatives` labels.
    - Added cleanup for generated DUP duplicates such as `DUP DUP`, `DUP-DUP`, `DUP - DUP`, and `DUP (DUP)`.
    - Preserved distinct `U.D.U.P.` labels instead of folding them into `DUP`.
    - Added `Conservatives` as an alias of `party:conservative` in the Party ID registry.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `827` party IDs and `1042` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1124` audit rows after duplicate labels collapsed.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `D.U.P.`, `Democratic Unionist - DUP`, or `Conservatives`.

Election party aliases follow-up: Workers, Nationalist, and A.P.
- [x] Normalise `Workers' Party (Ireland)`, `Workers Party`, and `Workers'` to `Workers' Party`
- [x] Resolve `Nationalist Party` to `Nationalist Party (Northern Ireland)` in the colour audit
- [x] Normalise `A.P.` to `Alliance`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `Workers' Party (Ireland)`, `Workers Party`, `Workers'`, and related `Workers Party Rep. C` variants.
    - Normalised `A.P.` and `A.P..` to `Alliance`.
    - Added an audit alias so `Nationalist Party` resolves to `Nationalist Party (Northern Ireland)`.
    - Updated Party ID aliases so Workers and Alliance aliases remain grouped under stable IDs.
  - Verification:
    - `python scripts\normalize-election-party-names.py` completed the final pass with the related Workers variants collapsed.
    - `python scripts\build-election-party-ids.py` wrote `821` party IDs and `1037` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1117` audit rows: `71` match, `141` colour mismatch, `855` no election colour, `50` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `Workers' Party (Ireland)`, `Workers Party`, `Workers'`, or `A.P.`.
    - `Nationalist Party` now matches `Nationalist Party (Northern Ireland)` with `#32CD32`, producing a colour match.

Election party aliases follow-up: NI Women's Coalition
- [x] Normalise all Northern Ireland Women's Coalition variants to `NI Women's Coalition`
- [x] Resolve `NI Women's Coalition` to the Wikipedia Northern Ireland Women's Coalition colour entry
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Normalised `Northern Ireland Women's Coalition`, `N.I. Women's Coalition`, `N.I. Womens Coalition`, `N I Women's Coalition`, `N.Ireland Women's Coalition`, `Northern Ireland Women's Coalition - NIWC`, `Northern Ireland Womens Coalition`, `NR. Ireland Women's Coalition`, and `Womens Coalition` to `NI Women's Coalition`.
    - Added `NI Women's Coalition` to the runtime fallback colour map with `#00FFFF`.
    - Added Party ID aliases for the old variants under `party:ni-womens-coalition`.
    - Added audit aliases so `NI Women's Coalition` resolves to Wikipedia's `Northern Ireland Women's Coalition` entry.
  - Verification:
    - `python scripts\normalize-election-party-names.py`
    - `python scripts\build-election-party-ids.py` wrote `812` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1107` audit rows: `71` match, `141` colour mismatch, `845` no election colour, `50` no Wikipedia match.
    - `node --check election-viewer-package\js\stages2.js`
    - A targeted scan found no old Women's Coalition variant values and `156` `NI Women's Coalition` values.
    - Audit rows for `NI Women's Coalition`: `109` explicit `#00FFFF` matches, `21` runtime fallback `#00FFFF` matches, and `26` no-colour source rows that still resolve to the correct Wikipedia party.

Election party aliases follow-up: Official Unionist and Independent abbreviations
- [x] Normalise `O. Un.` to `UUP`
- [x] Normalise `Off. Un.` to `UUP`
- [x] Normalise `Indp.` to `Independent`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `O. Un.`, `Off. Un.`, and `Indp.`.
    - Added Party ID aliases so the old labels remain grouped under `party:uup` and `party:independent`.
    - The substring pass also expanded `Indp.` inside longer labels to `Independent ...` without assigning those longer descriptors to a new party.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `810` party IDs and `1037` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1103` audit rows: `71` match, `141` colour mismatch, `841` no election colour, `50` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `O. Un.`, `Off. Un.`, or `Indp.`.

Election party aliases follow-up: O.Un., Irish Unionist, Non Party, and Comhar
- [x] Normalise `O.Un.` to `UUP`
- [x] Normalise `Irish Unionist` to `Irish Unionist Alliance`
- [x] Normalise `Non Party` to `Independent`
- [x] Normalise `Comhar Criostai/Christian Solidarity` to `Comhar Criostai / Christian Solidarity`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `O.Un.`, `Irish Unionist`, `Non Party`, and `Comhar Criostai/Christian Solidarity`.
    - Added Party ID aliases for the old labels under `party:uup`, `party:irish-unionist-alliance`, `party:independent`, and `party:comhar-criostai-christian-solidarity`.
    - Fixed the Irish Unionist rule to be idempotent after verification caught `Irish Unionist Alliance Alliance` on rerun.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `811` party IDs and `1039` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1101` audit rows: `71` match, `141` colour mismatch, `839` no election colour, `50` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `O.Un.`, `Irish Unionist`, `Irish Unionist Alliance Alliance`, `Non Party`, or `Comhar Criostai/Christian Solidarity`.

Election party aliases follow-up: United UUP, A.P, Indp, DU UUUC, and Renua Ireland
- [x] Normalise `United UUP` to `UUUP`
- [x] Normalise `A.P` to `Alliance Party`
- [x] Normalise `Indp` to `Independent`
- [x] Normalise `DU UUUC` to `DUP`
- [x] Normalise `Renua Ireland` to `Renua`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `United UUP`, `A.P`, `Indp`, `DU UUUC`, and `Renua Ireland`.
    - Kept `A.P` literal as `Alliance Party` by removing the previous `Alliance Party` to `Alliance` normalizer pass.
    - Added Party ID aliases for `UUUP`, `Alliance Party`, and `Renua`.
    - Added an audit alias so `UUUP` resolves to `United Ulster Unionist Party`.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `808` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1098` audit rows: `71` match, `142` colour mismatch, `836` no election colour, `49` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `United UUP`, `A.P`, `Indp`, `DU UUUC`, or `Renua Ireland`.

Election party aliases follow-up: A. and Progressive Unionist Party
- [x] Normalise `A.` to `Alliance`
- [x] Normalise `Progressive Unionist Party` to `PUP`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for exact `A.` and `Progressive Unionist Party`.
    - Tightened the rules after the first pass exposed over-broad replacements such as `Alliancep` and `PUP PUP`.
    - Collapsed related PUP variants such as `Progressive Unionist Party of Northern Ireland`, `Progressive Unionist Party (PUP)`, and malformed `Progressive Unionist Party of Northen Ireland` to `PUP`.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `802` party IDs and `1029` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1087` audit rows: `71` match, `142` colour mismatch, `825` no election colour, `49` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `A.`, `Progressive Unionist Party`, `PUP PUP`, `PUP - PUP`, or `Alliancep`.

Election party-name normalisation batch
- [x] Locate all party/ticket name fields in election JSON entries
- [x] Apply requested normalisations for Fianna Fail, Sinn Fein, Non party/Independent, Labour, Ulster Unionist Party, Green / Ecology, and S.D.L.P variants
- [x] Rerun the colour audit after normalisation
- [x] Report the next 10 most frequent party/ticket names after the requested changes
  - What I did:
    - added `scripts/normalize-election-party-names.py`
    - normalised party-like JSON fields: `Party_Name`, `Party`, `party`, `Wikipedia Party Name`, and `Deduplicated Party Name`
    - changed `Fianna Fail`/embedded `Fianna Fail` to `Fianna Fáil`
    - changed `Sinn Fein` and misspelled/accent variants such as `Sinn Fèin`, `Sinn Fién`, and `Sinn Feinn` to `Sinn Féin`
    - changed exact and embedded `Non party/Independent` to `Independent`
    - changed exact `Labour` to `Irish Labour`
    - changed exact and embedded `Ulster Unionist Party` to `UUP`
    - changed `Green / Ecology` to `Ecology` for 1982-1984 and `Green` for 1987 onward; no exact 1985 cases existed
    - changed exact and embedded `S.D.L.P` / `S.D.L.P.` to `SDLP`
  - Verification:
    - `python scripts/normalize-election-party-names.py`
    - JSON parse scan over all election files
    - verified no requested exact/substrings remain except `Labour` inside longer names such as `Northern Ireland Labour Party`, which was intentionally not globally rewritten
    - verified `Ecology` appears only in 1982-1984 occurrences and `Green` appears only in 1987 onward occurrences for the old `Green / Ecology` label
    - `python scripts/audit-ireland-election-party-colours.py`
    - `python -m py_compile scripts/normalize-election-party-names.py scripts/audit-ireland-election-party-colours.py scripts/extract-wikipedia-party-colours.py`

Ireland election party colour audit against Wikipedia
- [x] Locate election entry colour definitions for island-of-Ireland parties and tickets
- [x] Match election party/ticket names to the Wikipedia political-party colour extraction
- [x] Identify exact matches, likely alias matches, missing Wikipedia matches, and colour mismatches
- [x] Produce a review report with recommended fixes
  - What I did:
    - added `scripts/audit-ireland-election-party-colours.py`
    - scanned 7,254 election JSON files under `election-viewer-package/data/elections`
    - compared explicit `Party_Name`/`Party_Colour`, lower-case `party` entries, and runtime fallback colours against the Wikipedia colour extraction
    - matched Wikipedia by party name, abbreviation, shortname, and Ireland/NI-specific aliases for common forms such as `DUP`, `UUP`, `SDLP`, `TUV`, `Fianna Fail`, `Sinn Fein`, `Green/Comhaontas Glas`, and `People Before Profit Alliance`
    - wrote the full audit to `tasks/ireland_election_party_colour_wikipedia_audit.csv`
    - wrote high-confidence mismatches to `tasks/ireland_election_party_colour_wikipedia_high_confidence_mismatches.csv`
    - wrote the markdown review to `tasks/ireland_election_party_colour_wikipedia_audit.md`
  - Findings:
    - 1,184 unique election party/ticket colour observations
    - 72 observations correspond to Wikipedia colours
    - 139 observations have a Wikipedia match but a different colour
    - 71 of those mismatches are high-confidence exact-name or Ireland/NI-alias matches
    - 921 observations have no explicit election colour in the source and therefore use default/fallback behaviour
    - 52 coloured observations have no Wikipedia match
  - Verification:
    - `python scripts/audit-ireland-election-party-colours.py`
    - `python -m py_compile scripts/audit-ireland-election-party-colours.py scripts/extract-wikipedia-party-colours.py`

Wikipedia political party colour extraction
- [x] Inspect the Wikipedia module page/raw format for `Module:Political_party/1` and `A`-`Z`
- [x] Fetch all requested pages and extract party name, color, abbrev, shortname, validity, and contrast details
- [x] Write the extracted data to a structured local file
- [x] Verify parse coverage, row counts, and malformed values
  - What I did:
    - scraped the rendered "Color values" tables from all 27 requested English Wikipedia module pages using `scripts/extract-wikipedia-party-colours.py`
    - wrote `tasks/wikipedia_political_party_colours.csv` with source URL/module plus the requested fields
    - wrote `tasks/wikipedia_political_party_colours_requested_columns.csv` with exactly the eight requested fields
    - wrote `tasks/wikipedia_political_party_colours.xlsx` and `tasks/wikipedia_political_party_colours_metadata.json`
  - Verification:
    - fetched all 27 pages: `/1` and `/A` through `/Z`
    - extracted 14,871 rows
    - verified the requested-columns CSV has exactly: `Political party name`, `color`, `abbrev`, `shortname`, `Is color valid?`, `Contrast normal text`, `Contrast unvisited link`, `Contrast visited link`
    - verified the XLSX also has 14,871 rows
    - found 7 rows where Wikipedia marks `Is color valid?` as `False`
    - found 2 source rows with blank party names on `/N`, preserved as source data

Boundary update recovery from session ses_20bb
- [x] Restore unrelated tracked changes from the stalled session
- [x] Re-audit the collaborator's Drive boundary files against current `maps.json` and local/R2 asset state
- [x] Prepare and upload only verified `.fgb`, `.fgb.gz`, and LOD assets needed by changed metadata
- [x] Update `data/database/maps.json` only for verified live assets
- [x] Verify JSON syntax, asset URLs, and targeted map metadata/load paths
  - What I did:
    - restored unrelated tracked changes from the stalled session before making scoped metadata edits
    - verified source/R2 state for the collaborator boundary files, including the available Ulster 1921 file in place of the referenced but absent 1919 file
    - uploaded verified raw and gzip FGB assets for Counties 1957, ROI Local Authorities 1965/1966/1977/1980/1985/1986/1994, and the Connacht 1986, Munster 1980, and Ulster 1921 ED files
    - generated and uploaded LOD0/LOD1 assets for Counties 1957 and the ROI Local Authority files that use LOD loading
    - updated `data/database/maps.json` for only the verified live assets
  - Verification:
    - `node -e "JSON.parse(...)"` parsed `data/database/maps.json`
    - raw public URLs for 27 uploaded `.fgb` assets returned 200 and matched local MD5 via ETag
    - direct `.fgb.gz` public URLs for the same 27 assets returned 200 with non-zero content length
    - metadata checks confirmed target IDs, label properties, and derived LOD URLs
    - FlatGeobuf reads confirmed configured label properties exist in the first feature of each changed dataset

Repo instruction change: remove ZIP intake check requirement
- [x] Amend `AGENTS.md` to suspend the ZIP intake check requirement
  - [x] Remove the mandatory ZIP intake check instructions
  - [x] Verify the updated `AGENTS.md` content
  - What I did:
    - removed the entire `## Mandatory ZIP Intake Check` section from `AGENTS.md`
  - Verification:
    - confirmed `AGENTS.md` no longer contains `Mandatory ZIP Intake Check`, `zip-intake-check`, or `maps-to-be-added`

Bugs in demo bullet list extraction
- [x] Review the original transcript and extract the latest revised demo list without conditional styling
  - [x] Re-open the original transcript and locate the latest revised `KEEP as standalone beats` list
  - [x] Remove `Conditional Styling` from that list
  - [x] Provide the revised list inline in chat
  - Verification:
    - extracted from `2026-04-14-181430-image-1-in-dark-mode-when-i-hover-my-mouse-ov.txt`
    - based on the final `KEEP as standalone beats` section near the end of the transcript

ZIP Intake Check (2026-04-14)
- [x] Check maps-to-be-added for qualifying ZIP files
  - Checked at `2026-04-14T18:08:34.6491951Z`
  - No ZIP files found; only `maps-to-be-added/.gitkeep` was present
- [x] Update `.zip-intake-check.json` with the new check time

Bugs in duplicate feature-detail back history
- [x] Fix duplicate feature-detail history entries from double-click opens
  - [x] Confirm whether the same feature detail can be pushed twice in succession
  - [x] Prevent duplicate consecutive history entries for the same detail view
  - [x] Verify that one Back click returns to the previous page after a double-click open
  - Root cause:
    - the feature-detail open path accepted repeated consecutive pushes for the same `detailId`, so a double-click on the feature name could append identical `feature-detail` history entries and force two Back clicks to reach the actual previous page.
  - What I did:
    - added a duplicate-consecutive-entry guard in `showFeatureDetailInCatalogue(...)`
    - added the same guard in `showElectionEntityDetailInCatalogue(...)` so adjacent entity-detail navigation cannot regress the same way
    - rebuilt the shipped bundle with `node scripts/bundle.mjs`
  - Verification:
    - `node --check js/ui-controller.js`
    - `node scripts/bundle.mjs`
    - Playwright in-browser evaluation confirmed:
      - two consecutive opens of the same feature detail leave history as `['list', 'feature-detail']`
      - one `catalogueGoBack()` returns immediately to the list view and hides the detail view

Bugs in catalogue back navigation from feature detail
- [x] Fix the catalogue back button so feature detail returns to the previous page/state
  - [x] Record the task and confirm ZIP intake timing
  - [x] Inspect catalogue/history navigation and feature-detail entry paths
  - [x] Implement the minimal fix in the shared catalogue detail flow
  - [x] Verify the exact back-navigation behavior and record the outcome
  - Root cause:
    - `showFeatureDetailInCatalogue(...)` pushed a feature-detail history entry but did not refresh the catalogue nav buttons afterward, so opening feature detail directly from the main catalogue could leave the Back button stale/disabled.
    - when feature detail was opened while another top-level pane was active, the previous tab state was not preserved in the catalogue history stack, so Back had no way to return to that prior pane.
  - What I did:
    - added `_getActivePaneTabId()` and `_pushCatalogueTabHistoryIfNeeded(...)` in `js/ui-controller.js`
    - taught `catalogueGoBack()` / `catalogueGoForward()` to restore saved tab entries
    - updated `showFeatureDetailInCatalogue(...)` and `showElectionEntityDetailInCatalogue(...)` to:
      - preserve the current non-catalogue tab in history before opening detail
      - switch explicitly to the catalogue tab for the detail view
      - refresh the catalogue nav button state after rendering
    - rebuilt the shipped bundle with `node scripts/bundle.mjs`
  - Verification:
    - `node --check js/ui-controller.js`
    - `node scripts/bundle.mjs`
    - Playwright in-browser evaluation against `window.uiController` confirmed:
      - `list -> feature detail -> Back` returns to the catalogue list and re-hides the detail view
      - `explore -> feature detail -> Back` returns to the `explore` tab
      - Back is enabled immediately after opening feature detail in both cases

Bugs in NUTS region thumbnails
- [x] Regenerate the NUTS Regions thumbnails
  - [x] Locate the thumbnail generation workflow and the NUTS map ids/assets
  - [x] Regenerate the affected thumbnail files
  - [x] Verify the regenerated thumbnails exist and reflect the updated NUTS geometry
  - What I did:
    - confirmed the affected map ids in `data/database/maps.json` are `nuts-2-all-ireland` and `nuts-2-roi`
    - used `python scripts/regen-thumbnails.py --map-id ...` for each target so the thumbnails were regenerated through the repo's land-context thumbnail pipeline rather than the missing-file-only generator
  - Verification:
    - `python scripts/regen-thumbnails.py --map-id nuts-2-all-ireland`
    - `python scripts/regen-thumbnails.py --map-id nuts-2-roi`
    - regenerated files:
      - `assets/thumbnails/nuts-2-all-ireland.png` (`8000` bytes, updated `2026-04-14 18:30:01`)
      - `assets/thumbnails/nuts-2-roi.png` (`7676` bytes, updated `2026-04-14 18:30:02`)
    - `git status --short` shows both thumbnail files modified, confirming fresh outputs were written

Bugs in demo review note and local dev server restart
- [x] Review `2026-04-14-181430-image-1-in-dark-mode-when-i-hover-my-mouse-ov.txt`
  - [x] Read the transcript/review note and extract the concrete findings or status
  - [x] Present the review findings in code-review style
- [x] Restart the local dev server
  - [x] Identify the current local dev server process/command
  - [x] Restart it cleanly
  - [x] Verify the server is listening and serving the site
  - Review findings:
    - The transcript shows repeated CSS edits against `assets/css/main.css` while the running site was still serving `build/main.css`; the fix was only made effective after several failed rounds and a later rebuild, so verification was too weak and happened too late.
    - The NUTS2 repair was done as an ad hoc manual data replacement from a temp extraction path, with no reproducible repo-local script or post-change validation captured beyond extent inspection; that is risky for future regeneration or audit.
    - The answer that identified `scripts/demo/guide-overlay.js` as the human-readable recording script was incomplete at best: it is an overlay generator, not a plain text instructions file, and the actual human-readable text had to be derived afterward.
  - What I did:
    - reviewed the transcript and extracted the main process/quality issues with line-referenced evidence for the final response
    - confirmed the local dev server was not previously verifiable on the expected port, then preserved the newly started background instance after the aborted command
  - Verification:
    - server stdout log shows `Dev server running at http://localhost:3000`
    - `netstat -ano` shows PID `18112` listening on `0.0.0.0:3000` and `[::]:3000`
    - `Invoke-WebRequest http://localhost:3000` returned HTTP `200`

Bugs in flat catalogue header height
- [x] Reduce the height of flat catalogue card headers without breaking sticky alignment
  - [x] Identify which flat-view-specific header sizing rules are making the headers too tall
  - [x] Tighten only the flat-view header padding/type sizing
  - [x] Rebuild and verify the flatter header height in-browser
  - What I did:
    - reduced flat-view header vertical padding from `12px` to `8px`
    - reduced flat-view title size to `16px` and subtitle size to `11px`
    - tightened the flat-view placeholder toggle vertical padding to match the shorter header
  - Verification:
    - rebuilt successfully with `node scripts/bundle.mjs`
    - browser checks on `1990s` and `1980s` showed header height reduced from `64.57px` to `49.5px`
    - sticky offset remained `24px`, so the flush-under-shell behavior was preserved

Bugs in flat catalogue sticky header seam
- [x] Remove the transparent seam between the catalogue sticky shell and sticky flat-card headers while scrolling
  - [x] Identify which sticky/layout rules leave the pane visible between the shell and card header
  - [x] Apply the smallest CSS fix that preserves existing sticky behavior
  - [x] Verify in-browser that the seam is no longer visible
  - Root cause:
    - the catalogue pane itself was transparent, and the flat-card sticky header stopped short of the search shell by roughly `16px`, so that overlap zone showed the pane through during scroll.
  - What I did:
    - set the catalogue pane background explicitly to `var(--color-surface)`
    - added a flat-view-only `::before` strip on `.c1-card__header` that extends the header gradient upward by `var(--space-4)` to cover local overlap
    - reverted the shell `::after` cover strip after the user requested the original shell behavior back
    - changed `#catalogueFlatView .c1-card__header` sticky offset from `54px` to `24px` so the active card header sits flush against the bottom of the search shell inside the padded catalogue pane
    - rebuilt assets and bumped cache-busters in `index.html`
  - Verification:
    - rebuilt successfully with `node scripts/bundle.mjs`
    - browser check confirmed `getComputedStyle(header).top === "24px"` for the `1990s` card and `getComputedStyle(shell, '::after').content === "none"`
    - geometry check on the `1990s` card showed the sticky header top stays within `0.49px` of the shell bottom across multiple scroll positions, effectively flush
    - viewport screenshot after scrolling the `1990s` election card into the reported state showed the header directly against the search shell with no shell overlay

Bugs in flat catalogue placeholder toggles
- [x] Restore `Show/Hide to be added` buttons on flat catalogue cards with placeholder maps
  - [x] Verify whether flat cards like `District Electoral Divisions` and `Administrative Areas` compute non-zero placeholder counts
  - [x] Fix the render/visibility path that suppresses the header toggle on those flat cards
  - [x] Rebuild and verify the affected cards render the toggle and still hide placeholder entries by default
  - Root cause:
    - `js/ui-controller.js` already had the flat-card toggle logic, but `build/app.bundle.js` still contained the older render path without it, so the live app never emitted the button HTML for flat cards.
  - What I did:
    - Rebuilt the shipped assets with `node scripts/bundle.mjs` so the flat-card header now includes the placeholder toggle branch.
    - Bumped `index.html` asset versions to `build/main.css?v=16` and `build/app.bundle.js?v=20` to force browsers onto the rebuilt files.
    - Recorded the required ZIP-intake check result in `.zip-intake-check.json` after confirming `maps-to-be-added` only contains `.gitkeep`.
  - Verification:
    - Browser DOM check after rebuild showed:
      - `District Electoral Divisions` -> `Show 53 to be added`
      - `County Electoral Divisions` -> `Show 54 to be added`
      - `Administrative Areas` -> `Show 53 to be added`
    - Browser interaction check on `Administrative Areas` confirmed:
      - `53` placeholder entries hidden by default
      - toggle label changes to `Hide 53 to be added`
      - all `53` placeholder entries become visible, then hide again when toggled off

Local-election bundled loads and precomputed aggregates
- [x] Add reversible support for optional local-election `_bundle.json` artifacts in the runtime loader.
  - [x] Prefer per-date local bundles for `local-government` only when the bundle validates and contains requested constituencies.
  - [x] Fall back automatically to the existing per-constituency JSON path for any missing or invalid bundle data.
- [x] Add reversible support for optional local-election `_aggregates.json` artifacts in the runtime loader.
  - [x] Prefer precomputed current/previous council aggregates only when the aggregate artifact validates.
  - [x] Fall back automatically to the existing runtime aggregate builder for any missing or invalid aggregate data.
- [x] Extend the local-election build script to emit additive `_bundle.json` and `_aggregates.json` files without removing existing constituency JSON outputs.
- [x] Regenerate local-election artifacts and verify:
  - [x] runtime syntax checks
  - [x] build-script syntax
  - [x] expected additive files exist
  - [x] existing local-election views still have fallback-safe inputs
- [x] Record the overdue ZIP-intake check result in `.zip-intake-check.json`.
  - Runtime now checks for `_bundle.json` and `_aggregates.json` only for `local-government`, caches them separately, validates shape, and falls back automatically to the existing constituency JSON and aggregate builder when anything is missing or invalid.
  - The builder now writes additive per-date `_bundle.json` and `_aggregates.json` files alongside the existing constituency JSON outputs. Existing constituency files were preserved and regenerated in place.
  - Verification:
    - `node --check js/election-controller.js`
    - Python AST parse of `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py`
    - Builder rerun completed successfully and wrote `249` JSON files
    - Sample verification confirmed `election-viewer-package/data/elections/local-government/2023-05-18/_bundle.json` and `_aggregates.json` exist alongside `airport.json`
  - Rollback:
    - runtime rollback is metadata-free; simply remove or ignore `_bundle.json` / `_aggregates.json` and the loader falls back automatically
    - data rollback is additive-only; constituency JSON primitives remain the authoritative fallback path

Catalogue books and TOC top links
- [x] Add legislation-book thumbnails and top-level TOC links; review 2023 local-election load bottlenecks
  - [x] Add visible thumbnail fallback treatment for legislation books so they render like other book cards
  - [x] Add clickable top-level TOC links for Elections, Maps, and Books
  - [x] Verify UI changes with syntax checks
  - [x] Report ranked 2023 local-election load bottlenecks and safest speed improvements
  - Added a generated thumbnail fallback for books without `assets/thumbnails/book-<id>.png`, which gives legislation entries visible thumbnail cards instead of blank spaces while preserving existing boundary-report thumbnails.
  - Added top-of-TOC quick links for `Elections`, `Maps`, and `Books`, and inserted matching anchors into the flat catalogue sections so they scroll correctly.
  - Verification: `node --check js/ui-controller.js`; `node --check js/election-controller.js`.

Phase 0 - Map load optimization rollout
- [x] Add observability/timing instrumentation for vector full-load, LOD selection, chunk index load, chunk fetch/decode/render, and viewport updates.
  - Added structured load metrics in `js/map-controller.js` for full-file vector loads, LOD source selection, chunk index load, chunk file fetch/decode/render, and viewport reload paths.
- [x] Add browser-safe baseline tests for one LOD candidate (`eds-ulster-1911`) and one chunk candidate (`oa-2001`).
  - Added/validated `tests/browser/map-loading-pilots.spec.js` and reran it successfully in Playwright.
- [x] Record first pilot candidates and rationale.
  - Chosen pilots:
    - `eds-ulster-1911` for isolated LOD verification
    - `oa-2001` for chunking + bounded concurrency + zoom-variant verification

Phase 1 - LOD framework hardening
- [x] Add runtime guards/fallback logging when `useLOD` is enabled but derived assets are missing.
  - Added LOD selection/fallback metric logging in `js/map-controller.js`.
- [x] Ensure source selection is observable and reversible by metadata only.
  - Verified `useLOD` remains metadata-driven and logs the selected derived/full source at runtime.

Phase 2 - One-map LOD pilot
- [x] Enable/verify `eds-ulster-1911` as the first isolated LOD pilot.
  - Verified via Playwright that low-zoom loads select a derived `lod0/lod1` source for `eds-ulster-1911`.
- [x] Compare baseline vs after timings and validate visual correctness.
  - Browser verification passed for low-zoom derived-source selection without load failure.

Phase 3 - Chunk framework hardening and pilot
- [x] Harden chunk manifest/runtime validation.
  - Added `_validateChunkIndex(...)` and runtime metric logging for missing/invalid chunk manifests.
- [x] Enable/verify `oa-2001` as the first isolated chunking pilot.
  - Verified `oa-2001` chunk index load, visible chunk loading, and chunk zoom-file selection in Playwright.

Phase 4 - Bounded parallel chunk loading
- [x] Refactor chunk loading to a bounded concurrency executor with default concurrency `1`.
  - Added `getChunkLoadConcurrency(...)` and `_mapWithConcurrency(...)` in `js/map-controller.js`.
- [x] Enable safe bounded parallelism for the pilot and verify.
  - Enabled `chunkLoadConcurrency: 4` for `oa-2001` in `data/database/maps.json` and verified the pilot stays correct in Playwright.

Phase 5 - Zoom-variant chunk framework
- [x] Harden zoom-variant chunk selection/validation.
  - Verified runtime selection through the existing chunk `zoomFiles` path and added browser assertions for low/high zoom variant use on the pilot.
- [x] Select a first chunked pilot for broader zoom-file support after prior phases pass.
  - `oa-2001` remains the first verified zoom-variant chunk pilot.

Review
- [x] Capture timing results, regression results, rollback points, and next rollout candidates.
  - Regression evidence:
    - `npm run test:browser -- --grep "eds-ulster-1911|oa-2001 uses chunk index" --workers 1`
    - `2 passed`
  - Rollback points:
    - disable `useLOD` per map in `data/database/maps.json`
    - disable `chunked` and/or `chunkLoadConcurrency` per map in `data/database/maps.json`
  - Next safe rollout candidates:
    - more medium/large maps for metadata-only LOD enablement
    - one additional large chunk candidate after asset audit

Book catalogue search fix
- [x] Fix missing legislation/statutory books when searching `book` in the catalogue.
  - Root cause: the catalogue book filter only matched book title/author/keywords, so generic searches like `book` did not match legislation entries whose titles lacked that word.
  - Fix: added `_bookMatchesSearch(...)` in `js/ui-controller.js` and used it in both catalogue book-render paths so search also matches book-category metadata and the generic `book/books/document/documents` labels.
  - Verification: `node --check js/ui-controller.js`
## LOD rollout for existing assets
- [x] Inventory maps that already have `lod0/lod1` assets and no chunked loader
- [x] Enable `useLOD` only for the safe existing-asset set
- [x] Add representative browser verification across map families
- [x] Run full verification and record outcomes

Review:
- Identified `114` maps that already had matching `-lod0.fgb` and `-lod1.fgb` assets on disk and were not using the chunked loader.
- Enabled `useLOD: true` only for that existing-asset safe set in `data/database/maps.json`, with no new runtime dependency on missing files.
- Added representative browser coverage in `tests/browser/map-loading-pilots.spec.js` for:
  - `lgd-2012`
  - `pc-2023`
  - `river-basin-districts`
  - `dail-2023`
- Verified:
  - `maps.json` parses
  - targeted LOD/chunk pilot suite passes
  - full Playwright suite passes (`12 passed`)

ZIP Intake Check (2026-03-17)
- [x] Check maps-to-be-added for qualifying ZIP files
  - No ZIP files found.
- [x] Update .zip-intake-check.json with new check time

NI SPN gap-closure collection run
- [x] Execute the three highest-yield acquisition lanes in parallel:
  - historic non-local election discovery/capture via BNA
  - old-26 council archive recovery for local-election SPNs and election-agent notices
  - focused Lisburn & Castlereagh 2019 SPN discovery
- [x] Validate new artifacts and manifests
- [x] Review and record:
  - newly collected source documents
  - elections/constituencies/DEAs materially improved
  - remaining hard gaps and blockers
  - Actions run:
    - `python scripts/download_council_spns_v4.py`
    - `python scripts/parse_eoni_pdfs.py`
    - `python scripts/convert_old26_to_markdown.py`
    - `python scripts/scrape_26_councils.py` (timed out after ~20 minutes; no new manifest evidence beyond prior old-26 recovery state)
    - `python scripts/scrape_bna.py 1979` (failed immediately; script filtered to zero elections for `1979` and Playwright persistent-context launch then exited)
  - New collection yield from the targeted council downloader:
    - `58` successful downloads, `16` failed
    - major additions landed for `2023_local_ards-north-down`, `2023_local_mid-east-antrim`, `2023_local_belfast`, `2023_local_antrim-newtownabbey`, `2023_local_derry-strabane`, `2023_local_mid-ulster`, `2023_local_armagh-banbridge-craigavon`
    - major additions landed for `2019_local_antrim-newtownabbey`, `2019_local_causeway-coast-glens`, `2019_local_newry-mourne-down`, and `2019_local_mid-east-antrim`
    - election-agent additions landed for `2019_local_newry-mourne-down`
  - Verification outputs:
    - `_tmp_eoni_pdf_analysis.json` regenerated from `540` PDFs
    - `_tmp_gazette_markdown/old26_councils/index.json` regenerated with `146` files processed, `124` extracted, `22` flagged as manual-conversion DOC failures
  - Hard blockers:
    - BNA automation is currently blocked by the Playwright browser launch failure in `scripts/scrape_bna.py`
    - many legacy `.doc` files still require a separate converter/OCR path before text can be mined
    - some recovered PDFs are image-only or otherwise text-extraction-hostile (for example Lisburn & Castlereagh samples returned zero text from both PyPDF2 and PyMuPDF)

NI SPN follow-up: BNA runner hardening and local-year correction
- [x] Fix `scripts/scrape_bna.py` election selection and non-interactive login handling
  - Added explicit `1979`/`1983`/`1938` election entries that were missing from the configured search list.
  - Replaced the year-only assumption with `select_elections(...)`, so `python scripts/scrape_bna.py 1987` now filters correctly to one configured election instead of zero.
  - Added `launch_bna_context(...)` fallback from persistent profile to a fresh browser context with optional saved storage state.
  - Added non-interactive detection via `BNA_NONINTERACTIVE=1` or non-TTY stdin and converted the login prompt into a clean `SystemExit` instead of an `EOFError`.
- [x] Verify the BNA runner behavior after the fix
  - `python -m py_compile scripts\scrape_bna.py scripts\validate_local_spn_years.py`
  - `$env:BNA_NONINTERACTIVE='1'; python scripts\scrape_bna.py 1987`
  - Verified result: the script now reports `Filtering to year 1987: 1 elections`, falls back cleanly when the persistent Chromium profile crashes, and exits with `No reusable BNA login is available in this environment` rather than crashing on `input()`.
  - Remaining blocker: no reusable subscribed BNA session is available in this environment, so no historic article capture was completed.
- [x] Add and run a year-validation pass for mislabeled local SPN files
  - Added `scripts/validate_local_spn_years.py` to inspect `2019_local_*` and `2023_local_*` SPN files, infer poll year from extracted text, and move mismatches into the correct year directory.
  - Ran `python scripts\validate_local_spn_years.py`, which wrote `_tmp_spn_year_validation.json`.
  - Verification/result:
    - `207` files scanned
    - `35` mislabeled files moved
    - detected years: `31` as `2019`, `112` as `2023`
    - confirmed corrections include cross-year duplicates in Belfast, Mid and East Antrim, Mid Ulster, Derry and Strabane, Causeway Coast and Glens, and Armagh Banbridge Craigavon
- [x] Review recurring defects and prevention
  - Symptom: BNA automation failed before scraping because configured year filters returned zero elections and the login fallback crashed on `input()`.
  - Root cause: the election list omitted some targeted years, and the script assumed an interactive terminal even in automated runs.
  - Permanent prevention action: year/name election selection is now centralized in `select_elections(...)`, and non-interactive runs fail fast with an explicit login error path.
  - Verification evidence: the `1987` rerun reached the intended clean blocker message after matching the year correctly.

BNA secure local-session setup
- [x] Verify local auth artifacts remain untracked and open a manual-login browser session
- [ ] Capture a local reusable authenticated session without storing raw credentials in the repo
- [x] Verify the saved session can be reused for BNA scraping

Conversation log export
- [x] Write a markdown file with the full details of this conversation, excluding any credentials or session tokens
- [x] Confirm the output path and what was included
  - Wrote `tasks/conversation-log-2026-03-20.md`
  - Included: user requests, repo-review findings, gap analysis, acquisition actions, code changes, commands run, verification outcomes, blockers, and the secure BNA-login workflow
  - Excluded: raw credentials, cookies, tokens, and storage-state contents

Performance improvement handoff package
- [x] Create a repo-local handoff folder with the full implementation and testing plan for performance items `1` through `13`
  - Added `docs/performance-improvement-handoff/README.md`
  - Added `docs/performance-improvement-handoff/00-execution-protocol.md`
  - Added `docs/performance-improvement-handoff/01-metrics-and-thresholds.md`
  - Added per-item execution sheets in `docs/performance-improvement-handoff/items/`
  - Structured the package for one-item-at-a-time delivery with:
    - atomic steps
    - automated non-browser checks first
    - manual user checks second
    - rollback and acceptance gates
  - Notes:
    - the package explicitly assumes no browser automation is required for the first verification layer
    - later agents should extend existing repo mechanisms additively instead of replacing them wholesale
  - Review:
    - the handoff package now gives Claude or another later agent a direct execution path without re-deriving ordering, test scope, or rollback criteria
    - every numbered improvement from `1` to `13` has a dedicated file and atom sequence
- [x] Add supplemental execution aids to make the handoff package more actionable for later agents
  - Added `docs/performance-improvement-handoff/02-repo-hotspots.md`
  - Added `docs/performance-improvement-handoff/03-command-catalog.md`
  - Added `docs/performance-improvement-handoff/04-atom-worksheet-template.md`
  - Added `docs/performance-improvement-handoff/05-decision-log-template.md`
  - Added `docs/performance-improvement-handoff/06-risk-register-template.md`
  - Added `docs/performance-improvement-handoff/07-manual-test-report-template.md`
  - Updated the package `README.md` to point at the new files and explain their purpose
  - Review:
    - later agents now have a repo-specific orientation map, reusable execution templates, and a consistent place to record tradeoff decisions and manual results
- [x] Add final execution-readiness aids to reduce startup ambiguity for later agents
  - Added `docs/performance-improvement-handoff/08-recommended-execution-order.md`
  - Added `docs/performance-improvement-handoff/09-file-touch-matrix.md`
  - Added `docs/performance-improvement-handoff/10-non-browser-test-script-specs.md`
  - Added `docs/performance-improvement-handoff/11-glossary.md`
  - Updated the package `README.md` again so the index is complete
  - Review:
    - later agents now have a recommended sequencing model, likely file-entry points, explicit non-browser script targets, and shared terminology
- [x] Add first-wave execution and acceptance aids so later agents can start immediately
  - Added `docs/performance-improvement-handoff/12-first-wave-starter-pack.md`
  - Added `docs/performance-improvement-handoff/13-acceptance-criteria-matrix.md`
  - Added `docs/performance-improvement-handoff/14-known-constraints-and-non-goals.md`
  - Added `docs/performance-improvement-handoff/15-script-backlog-checklist.md`
  - Updated `docs/performance-improvement-handoff/README.md` to index the new files
  - Review:
    - later agents now have a clear first wave, a fast accept/reject matrix, explicit boundaries, and a concrete script backlog to begin the non-browser automation layer
- [x] Add runnable handoff-local scripts for the first non-browser verification wave
  - Added `docs/performance-improvement-handoff/scripts/README.md`
  - Added shared helpers in `docs/performance-improvement-handoff/scripts/_shared.mjs`
  - Added runnable report scripts:
    - `report-bundle-sizes.mjs`
    - `report-startup-imports.mjs`
    - `report-first-load-assets.mjs`
    - `report-font-usage.mjs`
    - `report-map-performance-metadata.mjs`
    - `report-dependency-usage.mjs`
  - Updated the handoff `README.md` to index the scripts
  - Review:
    - later agents can now run the first reporting wave directly from the handoff package instead of creating the scripts from scratch
  - Verification:
    - `node docs\performance-improvement-handoff\scripts\report-bundle-sizes.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-startup-imports.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-first-load-assets.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-font-usage.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-map-performance-metadata.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-dependency-usage.mjs`
    - All six scripts executed successfully and produced repo-specific reports
- [x] Add current baseline report artifacts to the handoff package
  - Added `docs/performance-improvement-handoff/reports/current-state-summary.md`
  - Added current text outputs for:
    - bundle sizes
    - startup imports
    - first-load assets
    - font usage
    - map performance metadata
    - dependency usage
  - Updated the handoff `README.md` to index the `reports/` folder
  - Review:
    - later agents now have immediate repo-specific baseline evidence inside the handoff folder, even before rerunning the scripts
- [x] Add a single start-here entrypoint for later agents
  - Added `docs/performance-improvement-handoff/START-HERE.md`
  - Updated `docs/performance-improvement-handoff/README.md` to index it
  - Review:
    - later agents now have one short file that tells them what to read first, what to run first, and which atom to start with
- [x] Add machine-readable handoff artifacts for later agents
  - Added `docs/performance-improvement-handoff/manifest.json`
  - Added `docs/performance-improvement-handoff/state/current-status.json`
  - Added `docs/performance-improvement-handoff/items/index.json`
  - Added JSON versions of the current baseline reports under `docs/performance-improvement-handoff/reports/`
  - Updated the handoff `README.md` to index the machine-readable files
  - Review:
    - later agents can now consume the handoff package programmatically instead of parsing only prose and plain-text reports
- [x] Add final execution helpers beyond documentation
  - Added `docs/performance-improvement-handoff/state/next-actions.json`
  - Added `docs/performance-improvement-handoff/scripts/run-first-wave.mjs`
  - Added starter templates:
    - `docs/performance-improvement-handoff/scripts/templates/benchmark-template.mjs`
    - `docs/performance-improvement-handoff/scripts/templates/validator-template.mjs`
  - Updated `manifest.json`, `state/current-status.json`, and the handoff `README.md` to reference the new helpers
  - Review:
    - later agents can now refresh the first-wave reports with one command, consume an ordered next-action queue, and start benchmark or validator work from working templates

ZIP Intake Check (2026-03-24)
- [x] Check maps-to-be-added for qualifying ZIP files
  - Checked at `2026-03-24T15:46:29Z`
  - No ZIP files found; only `maps-to-be-added/.gitkeep` was present
- [x] Update `.zip-intake-check.json` with the new check time

ZIP Intake Check (2026-04-12)
- [x] Check maps-to-be-added for qualifying ZIP files
  - Checked at `2026-04-12T17:06:43.7627163Z`
  - No ZIP files found; only `maps-to-be-added/.gitkeep` was present
- [x] Update `.zip-intake-check.json` with the new check time

Civgraph social profile PNG exports
- [ ] Create high-quality PNG versions of the Civgraph logo for Facebook and Twitter/X profile pictures
  - [ ] Confirm the correct source artwork and export approach
  - [ ] Render square PNG outputs with profile-safe padding
  - [x] Verify dimensions and visual quality
  - [ ] Record output paths and review notes
  - Review note: temporary HTML export scaffold was removed on user request before PNG outputs were finalized

Representative LOD-only map verification
- [x] Pick a high-risk LOD-only map based on metadata and asset sizes
- [x] Run a browser-level test that proves the selected map loads from an LOD source at low zoom
- [x] Record fetch/source evidence and final result
  - Picked `roi-garda-sub-districts` because it is the largest local non-chunked `useLOD` map with complete LOD assets found in the inventory:
    - raw: `data/maps/local-government/ROI_Garda_Sub_Districts.fgb`, about `44.7 MB`
    - `lod0`: about `0.4 MB`
    - `lod1`: about `1.7 MB`
  - What I did:
    - added a focused browser regression for `roi-garda-sub-districts`
    - asserted that the live bundled app loads an `ROI_Garda_Sub_Districts-lod0/lod1.fgb` source at low zoom
    - asserted that the raw `ROI_Garda_Sub_Districts.fgb` file is not requested
    - updated the map-loading pilot harness to use the bundled runtime globals instead of dynamically importing a second source app instance
    - kept the chunk zoom-variant pilot controlled through `mapController.loadLayer(...)` so app-level auto-fit does not mask the zoom-band transition
  - Verification:
    - `npm run test:browser -- --grep "largest local LOD-only" --workers 1` passed
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js --workers 1` passed with `4 passed`

Mobile map-load lag review
- [x] Review the live mobile map-load path and identify likely lag sources
- [x] Run a mobile-shaped browser measurement for representative map loading
- [x] Explain whether the lag is network/geometry load, catalogue/UI rerender, or another main-thread bottleneck
- [x] Record evidence and recommendations
  - What I reviewed:
    - `uiController.onMapLoad(...)` calls `App.loadMap(...)`, then `updateMapList()` and `updateActiveLayers()`.
    - `App.loadMap(...)` calls `mapController.loadLayer(...)`, then auto-fits the map and updates the URL.
    - `uiController.renderMapList(...)` invalidates and rerenders the flat catalogue through `renderFlatView(...)`.
  - Measurement:
    - Ran a temporary mobile-shaped Playwright measurement against `roi-garda-sub-districts`, with default layers suppressed via `#layers=__none`.
    - Direct map-layer load selected `ROI_Garda_Sub_Districts-lod0.fgb`, loaded `563` features, and completed in about `39 ms`; the FGB request was about `426 KB`, and the raw `44.7 MB` file was not requested.
    - Full `uiController.onMapLoad(...)` path completed in about `484 ms` on desktop Chromium/mobile viewport, with the map layer itself only about `25 ms`.
    - A standalone flat-catalogue rerender took about `131 ms` and left about `36,486` flat-catalogue DOM descendants.
    - The browser recorded multiple long tasks between about `130 ms` and `287 ms`, and the initial flat catalogue issued many thumbnail requests, including repeated 404s for missing thumbnail paths.
  - Conclusion:
    - For this representative LOD map, the remaining perceived lag is not the raw FGB; it is mainly app/UI work around the layer load, especially full catalogue rerendering, thumbnail churn, missing-thumbnail retries, and long main-thread tasks.
    - On real mobile CPU/network, those desktop-subsecond tasks can plausibly stretch into multi-second stalls, especially on first load or while default layers/catalogue thumbnails are still settling.

Collaborator map metadata review: Counties and Provinces 1955
- [x] Inspect current Counties/Provinces 1955 map metadata and catalogue grouping
- [x] Determine why the counties map is missing and why monolingual Provinces 1955 remains separate
- [x] Determine whether OSI/Tailte credit is preserved
- [x] Apply a safe metadata fix if supported by existing assets
- [x] Verify metadata parses and affected catalogue entries behave as intended
  - Findings:
    - `counties-ireland-1955` existed and the local/R2 asset path was configured, but the flat Counties card only listed the parent `counties-ireland` entry, so the 1955 counties map was buried as a variant rather than directly visible.
    - The monolingual `provinces` entry pointed at the 2019 OSI/Tailte source but was dated `1955`, which made it appear as a separate 1955 provinces map beside the bilingual `provinces-1955` entry.
    - Both 1955 contributor-derived entries credited only `Phelim Birch`, dropping OSI credit.
  - What I changed:
    - added `counties-ireland-1955` directly to the flat Counties card map list
    - changed `provinces` to `Provinces of Ireland 2019` with date `2019`
    - added `OSI` provider credit to `provinces-1955` and `counties-ireland-1955`
    - bumped the app bundle cache-buster in `index.html` to `v=110`
    - added a browser regression covering the affected catalogue rows
    - recorded the source-agency-credit lesson in `tasks/lessons.md`
  - Verification:
    - `npm run build` succeeded
    - `node --check js/ui-controller.js`
    - `node -e "JSON.parse(...)"` confirmed `provinces`, `provinces-1955`, and `counties-ireland-1955` metadata
    - `npm run test:browser -- tests/browser/catalogue-metadata.spec.js --workers 1` passed
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js tests/browser/catalogue-metadata.spec.js --workers 1` passed with `5 passed`

Mobile catalogue render and thumbnail churn fix
- [x] Stop map load/unload/toggle actions from forcing full flat-catalogue rerenders
- [x] Add targeted catalogue state patching for loaded/visible button state
- [x] Add a build-generated thumbnail manifest and suppress missing-thumbnail `<img>` output
- [x] Lazy-hydrate present thumbnails so catalogue rendering does not start every image request at once
- [x] Progressively render the flat catalogue on mobile to break up long main-thread work
- [x] Keep map geometry loading on the LOD/chunk path and avoid adding new synchronous map-load work
- [x] Add browser regressions for rerender avoidance, missing-thumbnail request churn, and representative map loading
- [x] Build, test, and record evidence
  - Plan:
    - Replace state-only `updateMapList()` calls after layer load/unload/visibility changes with a small `syncMapCatalogueState(...)` path.
    - Keep full catalogue rerenders only for real catalogue content changes such as search/filter/category changes.
    - Generate `assets/thumbnails/manifest.json` from the real thumbnail directory during `npm run build`.
    - Render thumbnail `<img>` tags only when the manifest confirms an asset exists; otherwise render a local CSS fallback with no network request.
    - Use `data-thumbnail-src` plus `IntersectionObserver` so available thumbnails load as they enter view, and load large TOC zoom thumbnails only on hover.
    - Add a mobile/progressive render yield during flat catalogue construction so first interaction is not blocked by a single large DOM task.
  - Recurring issue prevention:
    - Symptom: loading a map on mobile can feel blocked by catalogue rebuilding and waves of missing thumbnail requests.
    - Root cause: state-only layer changes reused the full `updateMapList()`/`renderFlatView()` path, and thumbnail markup assumed every map/book/election thumbnail existed.
    - Permanent prevention action: `uiController.syncMapCatalogueState(...)` now patches loaded/visible row state in place, while build-generated `assets/thumbnails/manifest.json` gates every catalogue thumbnail render.
    - Verification evidence: new browser tests assert that representative map load causes `0` `renderFlatView()` calls, missing thumbnail IDs emit no request, and mobile-shaped catalogue rendering hydrates thumbnails lazily.
  - What I changed:
    - Added `syncMapCatalogueState(...)` in `js/ui-controller.js` and routed map load/unload/toggle/default-layer state updates through `App.syncCatalogueMapState()` instead of full catalogue rerenders.
    - Added manifest-backed thumbnail helpers in `js/ui-controller.js` for book, TOC, class member, grid, map-card, and variant thumbnails.
    - Added `IntersectionObserver` hydration for present thumbnails and hover-only loading for large TOC/variant previews.
    - Added render cancellation/yielding so mobile flat-catalogue construction is progressive rather than one uninterrupted task.
    - Added a short mobile idle delay before loading default layers when there is no URL state.
    - Updated `scripts/bundle.mjs` to regenerate `assets/thumbnails/manifest.json` during `npm run build`.
    - Bumped the app bundle cache-buster in `index.html` to `v=111`.
    - Added `tests/browser/mobile-catalogue-performance.spec.js`.
  - Verification:
    - `node --check js/ui-controller.js`
    - `node --check js/app.js`
    - `node --check scripts/bundle.mjs`
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.
    - `npm run test:browser -- tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `3 passed` after rerunning outside the sandbox because Chromium process spawning hit `EPERM`.
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js tests/browser/catalogue-metadata.spec.js tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `8 passed`.
    - `git diff --check` reported only existing line-ending warnings and no whitespace errors.
    - In-app browser smoke check loaded `http://127.0.0.1:5050/#layers=__none` at a mobile viewport. Console output showed only expected local static-server POST `501` errors for debug/RUM endpoints, a deprecated Apple mobile meta warning, and existing unused preload warnings.

Mobile browser crash recurrence: remove startup catalogue pressure
- [x] Reproduce/measure mobile startup and map-load pressure after the first performance fix
- [x] Prevent mobile startup from building the full flat catalogue while the map pane is active
- [x] Render a lightweight mobile catalogue shell first, then hydrate bounded batches only when catalogue is opened
- [x] Add tests proving mobile map startup/map load does not create the full catalogue DOM
- [x] Build and run browser regressions
- [x] Update lessons and record verification evidence
  - Recurrence:
    - Symptom: user still reports severe mobile lag and mobile browser crashes after commit `6636800`.
    - Root cause: the previous fix stopped state-only rerenders, but initial mobile startup could still render the full catalogue DOM from the flat-list setup path while the map pane was active. That hidden render could create enough card/table structure and thumbnail observation work to exceed real phone CPU/memory limits.
    - Permanent prevention action: mobile must be map-first. No full catalogue DOM should be built until the user opens the catalogue, and even then the first render must be bounded.
  - What I did:
    - added a mobile-only deferred catalogue shell so `#catalogueFlatView` is empty while the app is in map-first mobile state
    - hydrate the mobile catalogue only when the catalogue tab/pane is actually opened
    - limited the first mobile catalogue render to the first 24 map cards and skipped election/book catalogue cards until the user taps `Show more`
    - kept full catalogue access available through explicit expansion or TOC navigation to a deferred section
    - bumped the app bundle cachebuster to `v=112`
    - added Lesson 108 covering this recurring mobile performance failure mode
  - Verification:
    - `node --check js/ui-controller.js`
    - `node --check js/app.js`
    - `node --check scripts/bundle.mjs`
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.
    - `npm run test:browser -- tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `6 passed` after rerunning outside the sandbox because Chromium process spawning hit `EPERM`.
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js tests/browser/catalogue-metadata.spec.js tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `11 passed`.
    - New mobile assertions prove startup leaves the app in `map-full`, `#catalogueFlatView.dataset.rendered === 'deferred'`, and `0` catalogue descendants.
    - New mobile map-load assertion proves loading `roi-garda-sub-districts` does not call `renderFlatView`, keeps the hidden catalogue deferred, and leaves `0` catalogue descendants.
    - New mobile first-open assertion proves only a bounded catalogue subset renders: `<= 24` map cards, `0` election rows, `0` book cards, and a `Show more` control.
    - In-app browser smoke at `390x844` loaded `http://127.0.0.1:5051/#layers=__none`: `data-split-state="map-full"`, `data-rendered="deferred"`, `data-mobile-deferred="true"`, `0` catalogue descendants, map visible, and no console error logs.
    - `git diff --check` reported only line-ending warnings and no whitespace errors.

Election entry polygon, colour, and party-label audit
- [ ] Inventory all website election entries and the polygons/geographies they require
- [ ] Identify missing polygon links or missing polygon assets for those entries
- [ ] Inventory party labels and independent descriptors across election result files
- [ ] Compare configured party colours to Wikipedia-style party colours where a reliable party identity exists
- [ ] Report duplicate/inconsistent party labels and recommended normalisations
  - Scope:
    - Read the local website election data as source of truth for what appears on the site.
    - Use external references only for party colour comparison, not for rewriting the data in this task.

Election party aliases and party IDs
- [ ] Correct PUP aliasing to Progressive Unionist Party in the audit logic
- [ ] Normalise Workers Party / Republican Clubs by date, DUP, PBP, and Alliance labels
- [ ] Define stable Party IDs grouping aliases such as Ecology/Green and Republican Clubs/Workers Party
- [ ] Rerun audit and provide the next 10 party/ticket names

Election party aliases follow-up: Green, Alliance, independents, Solidarity-PBP, UUP
- [x] Normalise `Green/Comhaontas Glas` to `Green`
- [x] Normalise exact `A` to `Alliance`
- [x] Normalise `Independent Lozenge` to `Independent`
- [x] Normalise `Solidarity PBP` to `Solidarity-PBP`
- [x] Normalise `Of. Un.` to `UUP`
- [x] Rebuild party IDs/audit outputs and provide the top 100 party/ticket labels inline
  - What I changed:
    - Added the requested labels to `scripts/normalize-election-party-names.py`, including leading-space European-election `Lozenge` forms for Green, Independent, and Solidarity-PBP.
    - Added the same aliases to `scripts/build-election-party-ids.py` so generated Party IDs keep those historical labels grouped with their canonical party.
    - Added audit aliases for exact `A`, `Of. Un.`, and `Green`.
    - Added a lesson to prevent repeated ranked-table variant cleanup misses.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `886` election files on the first run and `0` on the second run.
    - Normalisation counts included `695` `Green/Comhaontas Glas -> Green`, `212` `A -> Alliance`, `140` leading-space `Independent Lozenge -> Independent`, `129` `Solidarity PBP -> Solidarity-PBP`, `115` `Of. Un. -> UUP`, `24` leading-space `Green/Comhaontas Glas Lozenge -> Green`, and `7` leading-space `Solidarity PBP Lozenge -> Solidarity-PBP`.
    - Structured party-field scan found no remaining stripped values of `Green/Comhaontas Glas`, `Green/Comhaontas Glas Lozenge`, `A`, `Independent Lozenge`, `Solidarity PBP`, `Solidarity PBP Lozenge`, or `Of. Un.`.
    - `python scripts\build-election-party-ids.py` wrote `800` party IDs and `1033` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1084` audit rows with counts `{no_election_colour: 823, colour_mismatch: 141, match: 71, no_wikipedia_match: 49}`.

Election party aliases follow-up: top-100 residual variants
- [x] Normalise `Rep. Clubs` to `Republican Clubs`
- [x] Normalise listed Conservative, BNP, Socialist Party, Nationalist, Alliance, Labour, IIP, Sinn Féin, UUP, Green, Independent, and Ulster Liberal variants
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact source normalisations for the requested residual labels in `scripts/normalize-election-party-names.py`.
    - Added `Labour Lozenge -> Irish Labour` after a stripped/Lozenge scan showed this was the remaining source of the ranked `Labour` label.
    - Updated `scripts/build-election-party-ids.py` with the matching alias groups for Republican Clubs, Conservative, BNP, Socialist Party, Nationalist Party, Alliance, Irish Labour, NI Labour Party, IIP, Sinn Féin, UUP, Green, Independent, Independent Nationalist, and Ulster Liberal.
    - Updated `scripts/audit-ireland-election-party-colours.py` with corresponding Wikipedia colour aliases where reliable rows exist.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `554` election files on the main pass and `53` more after adding `Labour Lozenge`; a final run reported `changed_files=0`.
    - Main-pass counts included `163` `Northern Ireland Labour Party -> NI Labour Party`, `143` `Socialist Party (Ireland) -> Socialist Party`, `139` `British National Party -> BNP`, `92` `Rep. Clubs -> Republican Clubs`, `85` `Irish Conservative -> Conservative`, `61` `Nationalist -> Nationalist Party`, `55` `Alliance Party -> Alliance`, `42` `N.I.L.P. -> NI Labour Party`, `39` `I.I.P. -> IIP`, `38` `S.F. -> Sinn Féin`, `37` `Off. Un -> UUP`, `35` `Ind. Nationalist -> Independent Nationalist`, `35` `Green Party -> Green`, `34` `Ulster Liberal Party -> Ulster Liberal`, `32` `O. Un -> UUP`, `27` `Non-Party -> Independent`, `27` `O.Un -> UUP`, `19` `N.I.L.P -> NI Labour Party`, and `6` `Irish Independence Party -> IIP`.
    - Follow-up counts included `45` leading-space `Labour Lozenge -> Irish Labour` and `38` remaining `Sinn FÃ©in -> Sinn Féin` repairs.
    - Structured party-field scan found no remaining stripped values for the requested old labels, including Lozenge-normalized `Labour`.
    - `python scripts\build-election-party-ids.py` wrote `789` party IDs and `1035` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1070` audit rows with counts `{no_election_colour: 812, colour_mismatch: 135, match: 74, no_wikipedia_match: 49}`.

Election party aliases follow-up: top-100 tail variants
- [x] Normalise Republican Labour, Newtownabbey Labour, UPUP, NI Unionist, Independent Alliance, SDLP long-form, and Democratic Left variants
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact source normalisations for `Republican Labour Party -> Republican Labour`, `Newtownabbey Labour Party -> Newtownabbey Labour`, `U.P.U.P. -> Ulster Popular Unionist Party`, `Northern Ireland Unionist Party -> NI Unionist Party`, `Independent Alliance (Non party) -> Independent Alliance`, `SDLP (Social Democratic and Labour Party) -> SDLP`, and `Democratic Left / New Agenda -> Democratic Left`.
    - Updated Party ID aliases for the same labels.
    - Added reliable Wikipedia colour-audit aliases for Republican Labour, UPUP, NI Unionist, SDLP long-form, and Democratic Left.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `94` election files, then a final run reported `changed_files=0`.
    - Counts were `25` `SDLP (Social Democratic and Labour Party) -> SDLP`, `21` `Independent Alliance (Non party) -> Independent Alliance`, `21` `Democratic Left / New Agenda -> Democratic Left`, `21` `Northern Ireland Unionist Party -> NI Unionist Party`, `21` `U.P.U.P. -> Ulster Popular Unionist Party`, `20` `Newtownabbey Labour Party -> Newtownabbey Labour`, and `18` `Republican Labour Party -> Republican Labour`.
    - Structured party-field scan found no remaining stripped values for the old labels.
    - `python scripts\build-election-party-ids.py` wrote `785` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1066` audit rows with counts `{no_election_colour: 809, colour_mismatch: 136, match: 74, no_wikipedia_match: 47}`.

Election party aliases follow-up: top-120 residual variants
- [x] Normalise UUP, Alliance, Independent, UPNI, Republican Clubs/Workers' Party, Ulster Liberal, Conservative, and Official Unionist variants from the top-120 table
- [x] Handle `Rep Clubs` conditionally as `Workers' Party` when Workers' Party candidates stood in the same election, otherwise `Republican Clubs`
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact normalisations for `O.U.`, `UU`, `AP`, `Of.Un.`, `O Un`, `O Un.`, `Independent Un.`, `IND`, `U.P.N.I.`, `INDP`, `Ind. Unionist`, `Lib`, `Conservative and Unionist`, `Official Unionist`, and `Non. Party`.
    - Added an election-context normalisation path for `Rep Clubs`; it becomes `Workers' Party` only when the same election directory already contains `Workers' Party`, otherwise `Republican Clubs`.
    - Updated Party ID aliases and colour-audit aliases for the same canonical labels.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `147` election files, then a final run reported `changed_files=0`.
    - Counts included `17` `Non. Party -> Independent`, `17` `O Un. -> UUP`, `16` `Lib -> Ulster Liberal`, `16` `Official Unionist -> UUP`, `16` `Conservative and Unionist -> Conservative`, `15` `Ind. Unionist -> Independent Unionist`, `15` `INDP -> Independent`, `15` `Rep Clubs -> Republican Clubs`, `15` `U.P.N.I. -> Unionist Party of Northern Ireland`, `14` `Independent Un. -> Independent Unionist`, `14` `O Un -> UUP`, `14` `Of.Un. -> UUP`, `14` `IND -> Independent`, `14` `UU -> UUP`, `13` `AP -> Alliance`, and `13` `O.U. -> UUP`.
    - No `Rep Clubs` files were in an election directory containing `Workers' Party`, so the conditional branch correctly produced `Republican Clubs` for all current `Rep Clubs` instances.
    - Structured party-field scan found no remaining stripped values for the requested old labels.
    - `python scripts\build-election-party-ids.py` wrote `775` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1052` audit rows with counts `{no_election_colour: 795, colour_mismatch: 136, match: 74, no_wikipedia_match: 47}`.

Election party aliases follow-up: top-150 residual variants
- [x] Normalise NI Labour, Unionist, IIP, DUP, SDLP, UUP, Vanguard, Green, Independent, Workers' Party, and related residual variants
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact normalisations for `NI Labour Party -> NI Labour`, `Un.`/`Un -> Unionist`, `I.I.P. Nationalist -> IIP`, `D.U U.U.U.C -> DUP`, `U.D.U.P. -> DUP`, SDLP long-form variants, `O. Ul. Un. -> UUP`, `DUP - Leader Ian Paisley -> DUP`, `Van. Un. -> Vanguard Unionist Progressive Party`, `Ulster Unionist U.U.P` variants to `UUP`, `The Green Party -> Green`, `Loy. D.U. -> DUP`, `Independant -> Independent`, `Ulster DUP -> DUP`, `Democratic Unionist - -> DUP`, bare `Workers'`/`Workers' Lozenge -> Workers' Party`, and `UUP U.U.U.C` variants to `UUP`.
    - Updated Party ID and colour-audit aliases for the same canonical labels.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `330` election files on the first pass and `7` files on the follow-up `Ulster Unionist U.U.P` pass; a final run reported `changed_files=0`.
    - First-pass counts included `224` `NI Labour Party -> NI Labour`, `112` `Un. -> Unionist`, `32` `Un -> Unionist`, `13` leading-space `Workers' Lozenge -> Workers' Party`, `13` `UUP U.U.U.C. -> UUP`, `12` `SDLP-Social Democratic and Labour Party -> SDLP`, `11` `Ulster DUP -> DUP`, `10` `Van. Un. -> Vanguard Unionist Progressive Party`, `10` `Loy. D.U. -> DUP`, `10` `Democratic Unionist - -> DUP`, `10` `Independant -> Independent`, `10` `The Green Party -> Green`, `10` `Social Democratic and Labour Party (SDLP) -> SDLP`, `8` `O. Ul. Un. -> UUP`, `8` `U.D.U.P. -> DUP`, `8` `DUP - Leader Ian Paisley -> DUP`, `8` malformed `SDLP (Social Democratic and Labour Party -> SDLP`, `7` `D.U U.U.U.C -> DUP`, and `7` `I.I.P. Nationalist -> IIP`.
    - Follow-up counts included `10` `Ulster Unionist U.U.P. -> UUP` and `7` `Ulster Unionist U.U.P -> UUP`.
    - Structured party-field scan found no remaining stripped values for the requested old labels or the obvious SDLP/UUP/Workers variants handled in this batch.
    - `python scripts\build-election-party-ids.py` wrote `759` party IDs and `1040` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1032` audit rows with counts `{no_election_colour: 777, colour_mismatch: 135, match: 73, no_wikipedia_match: 47}`.

Review IDB zip: counties and local-authority maps
- [x] Extract relevant FGBs to a repo-local temp folder
- [x] Confirm the 1922/1927 counties files and the 1930/1931/1941/1942/1944/1950 local-authority files are present and readable
- [x] Compare them against current site map entries and existing local data files
- [x] Explain feasibility of adding/replacing them on the site
  - What I checked:
    - Extracted the eight relevant files from `C:\Users\scomo\Downloads\Irish Digitised Boundaries-20260525T185841Z-3-001.zip` into `tasks\idb-review-temp`.
    - Confirmed `1922 Counties.fgb`, `1927 Counties.fgb`, and local-authority `1930`, `1931`, `1941`, `1942`, `1944`, `1950` FGBs are present and readable with GDAL.
    - Confirmed `1927 Counties.fgb` has the same SHA256 as the current `data\maps\baronies-parishes\Counties_Ireland_1922.fgb`, so the old on-site 1922 counties asset is exactly the proposed 1927 counties asset.
    - Confirmed new `1922 Counties.fgb` is a distinct file and should replace the current 1922 counties asset if implemented.
    - Confirmed all six new ROI local-authority FGBs use the same schema as current ROI local-authority files: `ENGLISH`, `GAEILGE`, `COUNTYNAME`.
    - Confirmed the current ROI local-authority catalogue stops at 1953, so `1930`, `1931`, `1941`, `1942`, `1944`, and `1950` are feasible new entries.
  - Verification evidence:
    - Counties: 32 features, WGS84, fields `CONTAE`, `COUNTY`, `PROVINCE`.
    - Local authorities: 31 features each, WGS84, fields `ENGLISH`, `GAEILGE`, `COUNTYNAME`.
    - `1927 Counties.fgb` SHA256: `BB8DE5CEB19EF709ADC334B64A83AA29EA332297D95C137DB2C76E9FC54839D1`.
    - Current `Counties_Ireland_1922.fgb` SHA256: `BB8DE5CEB19EF709ADC334B64A83AA29EA332297D95C137DB2C76E9FC54839D1`.
    - New `1922 Counties.fgb` SHA256: `58A87E20977F0D97DB058A2E514C9613C14B15371B3903A186661B57C35248BF`.

Investigate production map-file deployment path
- [x] Determine whether production serves map FGBs from Pages static files or R2/data.civgraph.net
- [x] Determine what this means for adding the new IDB county and local-authority maps
- [x] Record the required deployment steps
  - What I found:
    - `.cfignore` excludes `data/maps/**/*.fgb`, `data/maps/**/*.fgb.gz`, and map chunk JSON files from the Cloudflare Pages artifact.
    - `functions/data/maps/[[path]].js` serves `/data/maps/*` from the `MAPS_BUCKET` R2 binding when that binding exists.
    - `data/database/maps.json` overwhelmingly points FGB files at `https://data.civgraph.net/data/maps/...`: 602 of 621 FGB references use that external data host; 19 legacy/relative references remain.
    - The relevant county/local-authority catalogue patterns already use `https://data.civgraph.net/...`.
    - `https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1953.fgb` returns `200 OK`, `application/octet-stream`, and byte length `2903744`, confirming the data host is live for production map bytes.
    - A small GET against `https://civgraph.net/data/maps/local-government/ROI_Local_Authorities_1953.fgb` also returns `application/octet-stream` via the Pages Function/R2 path; a HEAD request to that same-origin path is misleading because only GET is implemented by the function.
    - `https://civgraph.net/data/database/maps.json` returns `Cache-Control: public, max-age=0, must-revalidate`, so catalogue metadata deploys through the site origin and revalidates.
  - Required deployment consequence:
    - Adding these maps requires both repo/catalogue changes and R2 object uploads.
    - For each new or replaced FGB key, upload the base `.fgb` and compressed `.fgb.gz`; `.br` is desirable for consistency with the generic R2 tooling, though the current worker explicitly tries `.gz` before raw.
    - Generate and upload `-lod0.fgb` and `-lod1.fgb` plus their compressed variants before setting or keeping `useLOD: true`.

Add 2026-05-25 IDB county and ROI local-authority maps
- [x] Preserve current 1922 counties bytes as the new 1927 counties asset
- [x] Replace 1922 counties with the newly supplied Tirconaill/Donegal-aware file
- [x] Add ROI local-authority FGBs for 1930, 1931, 1941, 1942, 1944, and 1950
- [x] Update `data/database/maps.json` class ordering and map/variant metadata
- [x] Generate `-lod0` and `-lod1` FGBs for all new/replaced assets
- [x] Create compressed `.gz` and `.br` variants for upload consistency
- [x] Upload the base, LOD, and compressed map objects to R2
- [x] Verify public URLs, JSON validity, and representative map metadata
  - What I changed:
    - Copied the previous `Counties_Ireland_1922.fgb` bytes to `Counties_Ireland_1927.fgb`.
    - Replaced `Counties_Ireland_1922.fgb` with the new zip-supplied 1922 counties file.
    - Added local source files for `ROI_Local_Authorities_1930`, `1931`, `1941`, `1942`, `1944`, and `1950`.
    - Added `counties-ireland-1927` as a variant under `counties-ireland` and updated the 1922 label to identify the Tirconaill version.
    - Added the six new ROI local-authority map entries and appended them to the `roi-local-authorities` class after 1953.
    - Added one-off scripts for the structured metadata update and LOD/compression generation.
  - R2 upload:
    - The first Wrangler upload ran against local R2 because `--remote` was omitted; public URL checks caught this immediately.
    - Reran the upload with `--remote`.
    - Uploaded 72 production R2 objects: 8 base maps plus `-lod0`, `-lod1`, `.gz`, and `.br` variants.
    - Retried three transient Wrangler failures successfully: `Counties_Ireland_1922.fgb.br`, `ROI_Local_Authorities_1931-lod1.fgb.br`, and `ROI_Local_Authorities_1941.fgb`.
  - Verification:
    - Public `https://data.civgraph.net/...` HEAD checks verified all 72 objects returned `200` and matched local `Content-Length`.
    - `node --check scripts\add-idb-20260525-maps.mjs`
    - `node --check scripts\build-idb-20260525-lods.mjs`
    - Parsed `data/database/maps.json` and confirmed all expected new IDs are present.
    - `ogrinfo -so` opened representative 1922, 1927, and 1930 FGBs successfully.
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.

Commit election party-normalisation data changes
- [x] Verify the normalization scripts and generated election data are internally consistent
- [x] Stage only election-related files, leaving unrelated dirty worktree files untouched
- [x] Commit the staged election data changes
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\audit-ireland-election-party-colours.py scripts\build-election-party-ids.py scripts\extract-wikipedia-party-colours.py`
    - `node --check election-viewer-package\js\stages2.js`
    - `python scripts\normalize-election-party-names.py` reported `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `759` party IDs and `1040` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1032` audit rows with counts `{no_election_colour: 777, colour_mismatch: 135, match: 73, no_wikipedia_match: 47}`.
    - Parsed `7344` election JSON files successfully.
    - `git diff --check` reported only line-ending warnings for `stages2.js` and `tasks/todo.md`.
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.

Fix county catalogue entries and reassess mobile civil-parishes performance
- [x] Move the newly added county maps out of the 1977 county variants and into direct County catalogue-card entries
- [x] Verify `maps.json`, catalogue membership, and build output
- [x] Replace Civil Parishes group loading with a single unified all-Ireland civil-parishes layer backed by LOD/chunk assets
- [x] Review the civil-parishes mobile load path and identify remaining high-impact optimisations versus a MapLibre GL migration
  - Recurring issue:
    - Symptom: Mobile browsers lagged for 10+ seconds or crashed when loading Civil Parishes.
    - Root cause: the catalogue entry loaded multiple province-level layers and allowed fallback to a very large full-resolution FGB; early regenerated chunks also duplicated boundary-crossing features across multiple chunk files.
    - Permanent prevention action: use a single all-Ireland Civil Parishes entry backed by LOD overview files, viewport chunks, mobile LOD caps, chunk-only fallback behavior, representative-point chunk assignment, and versioned generated asset names to avoid stale CDN chunk files.
    - Verification evidence: metadata check confirms `civil-parishes-by-province` is no longer a group, points to `Civil_Parishes_Ireland_v2.fgb`, has `chunkOnly: true`, `chunkOverviewMaxZoom: 13`, `mobileMaxLODLevel: 1`, and the generated chunk index has `64` chunks with `2448` feature refs for `2448` source features.
  - Review:
    - County catalogue: `ni-counties` now includes `counties-ireland`, `counties-ireland-1927`, and `counties-ireland-1922` as direct catalogue-card maps.
    - Civil Parishes data: generated unified base FGB, LOD0/LOD1/LOD2 files, and versioned chunk files with `scripts/build-unified-civil-parishes.py`.
    - Data host: uploaded the versioned v2 Civil Parishes assets with `scripts/upload-unified-civil-parishes.mjs`.
    - Public asset verification: range-GET checked `159/159` v2 public objects on `data.civgraph.net` with matching object sizes.
    - Browser-cache hardening: bumped app bundle query string to `v113`, moved dynamic build chunks under `build/chunks/v113/`, and bumped the service-worker cache version to `v3` so existing phones do not reuse stale map-controller chunks.
    - Code checks: `python -m py_compile scripts\build-unified-civil-parishes.py`, `node --check scripts\upload-unified-civil-parishes.mjs`, `node --check js\app.js`, and `node --check js\map-controller.js` all passed.
    - Build: `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox; after cache-busting changes, `node --check scripts\bundle.mjs` and `node --check sw.js` also passed.

Fix Civil Parishes initial map fit
- [x] Reproduce/identify why selecting Civil Parishes zooms to a random part of Ireland
- [x] Make chunked-layer fitting prefer configured full-map bounds over currently rendered chunk bounds
- [x] Add explicit all-Ireland bounds to the Civil Parishes metadata
- [x] Verify metadata, build output, and production behaviour
- [x] Commit and push the focused fix
  - Review:
    - Root cause: `fitToLayer()` fitted chunked/spatial layers to the currently rendered Leaflet group before checking configured bounds; for chunked maps that group can be only the current viewport subset.
    - Fix: chunked/spatial layers now prefer configured full-map bounds in `fitToLayer()` and `fitToLayers()`, and Civil Parishes has explicit all-Ireland bounds `[[51.35,-10.75],[55.55,-5.35]]`.
    - Browser-cache prevention: bumped the app entry to `app.bundle.js?v=114`, dynamic chunks to `build/chunks/v114/`, and service worker cache to `v4`.
    - Verification: `node --check js\map-controller.js`, `node --check scripts\bundle.mjs`, `node --check sw.js`, Civil Parishes metadata validation, `npm run build`, and local cache-busting output checks passed. Production poll confirmed `app.bundle.js?v=114`, service worker `v4`, and the new bounds are live. Playwright production smoke from a deliberately high zoom loaded Civil Parishes at zoom `6`, centered around `53.5020,-8.0500`, with configured bounds present and no load error.

Audit maps for chunked-layer random-fit risk
- [x] Define static failure signature for the Civil Parishes random-fit bug
- [x] Scan `data/database/maps.json` for chunked/spatial catalogue maps without configured full-map bounds
- [x] Cross-check chunk indexes and generated data extents where available
- [x] Classify affected maps by severity and provide findings
  - Review:
    - Failure signature: a loadable map entry has `chunked: true` / spatial loading, has a working chunk index, and lacks configured `bounds`, so `fitToLayer()` / `fitToLayers()` can still fit to the currently rendered chunk subset rather than the full geography.
    - CLI audit covered 901 loadable map/variant entries from `maps.json`, including variants resolved the same way as `dataService.getMapById()`.
    - 71 loadable entries are marked chunked; 34 currently have working chunk indexes locally or on production; 33 of those 34 lack full-map bounds and retain the same class of fit risk.
    - Civil Parishes is the only working chunked entry protected by configured bounds.
    - No `isGroup` entry directly loads a risky chunked child, so no additional group-only risk was found.

Implement chunked-map fit bounds fix
- [x] Derive full-map bounds for currently indexed chunked maps
- [x] Add explicit bounds to affected chunked map metadata
- [x] Add a controller fallback that can use loaded chunk-index bounds if metadata bounds are missing
- [x] Verify metadata coverage, syntax, and production build
- [x] Commit and push the fix
  - Review:
    - Added explicit bounds to the 33 indexed chunked entries that previously lacked them, using chunk-index extents from local files or production/R2 indexes.
    - Added a map-controller fallback that stores `_chunkIndexBounds` on loaded chunked layers and lets `fitToLayer()` / `fitToLayers()` use those bounds if future metadata is missing `bounds`.
    - Bumped app cache keys to `app.bundle.js?v=115`, dynamic chunks under `build/chunks/v115/`, and service worker cache `v5`.
    - Verification: maps JSON parses, `node --check js\map-controller.js`, `node --check scripts\bundle.mjs`, `node --check sw.js`, indexed-chunked coverage audit now reports `chunkedWithIndex: 34` and `missingBounds: []`, `npm run build` passes, cache-busting output checks pass, and production now serves `app.bundle.js?v=115`, service worker `v5`, and representative new bounds metadata.

Harden chunked-map fit regression prevention
- [x] Add a static validator for chunked map bounds and chunk-index extent validity
- [x] Add an optional auto-fix path that derives missing bounds from local chunk indexes
- [x] Wire the validator into npm checks/build safety
- [x] Harden runtime fitting so chunked layers without full bounds do not auto-fit to partial rendered chunks
- [x] Add headless regression coverage for chunked fit decisions
- [x] Verify, commit, push, and confirm production deployment if runtime cache keys change
  - Recurring issue:
    - Symptom: chunked maps can fit to a random/current viewport subset when their loaded Leaflet group only contains visible chunks.
    - Root cause: bounds fitting had a rendered-group fallback path that was valid for normal GeoJSON layers but unsafe for chunked/spatial layers without full-map bounds.
    - Permanent prevention action: static validation now blocks chunked maps unless they have explicit metadata bounds or a local chunk-index extent fallback; runtime fitting now skips chunked/spatial auto-fit when full bounds are missing; a headless regression test locks in that control flow.
    - Verification evidence: `npm run check` passed with `71` chunked entries and `71` explicit bounds; `npm run build` passed outside the sandbox after the expected esbuild spawn `EPERM`; cache-key check confirmed `app.bundle.js?v=116`, dynamic chunks under `chunks/v116/`, and service worker `v6`; production poll confirmed `https://civgraph.net/` serves `app.bundle.js?v=116` and `https://civgraph.net/sw.js` serves service worker `v6`.
  - Review:
    - Added `scripts/validate-chunked-map-bounds.mjs` with offline validation and `--fix` support.
    - Added `scripts/test-chunked-fit-bounds.mjs` for headless regression coverage.
    - Added `check`, `check:chunked-bounds`, `fix:chunked-bounds`, and `test:chunked-fit` npm scripts; build now runs the chunked-bounds validator before bundling.
    - Updated `fitToLayer()` and `fitToLayers()` so chunked/spatial layers require full-map bounds and never fall through to rendered group bounds.
    - Bumped browser cache keys to `app.bundle.js?v=116`, `build/chunks/v116/`, and service worker `v6`.

Rewrite site under /test with MapLibre GL and vector tiles
- [x] Create an isolated `/test` app shell with its own bundle path and scoped service worker
- [x] Add a MapLibre GL + PMTiles rendering controller that can load vector-tile layers from metadata
- [x] Add a test metadata contract and validation for PMTiles/vector-tile layer entries
- [x] Add build scripts for `/test` that do not affect the root production bundle
- [x] Add first pilot-map wiring and clear missing-tile reporting
- [x] Verify root-site isolation, test build output, service-worker scope, and syntax
- [x] Commit and push the completed safe slice
  - Review:
    - Built an isolated `/test` MapLibre app with a separate `/test/build/test.bundle.js`, `/test/metadata/maps-test.json`, and `/test/sw.js` scoped to `/test/`.
    - Added MapLibre GL and PMTiles dependencies for the test app only; the root production app still builds from `js/app.js` and does not import them.
    - Generated a real Civil Parishes vector-tile pilot from `Civil_Parishes_Ireland_v2.fgb` into `/test/tiles/civil-parishes-v1` with GDAL MVT output: `3924` files, about `59.4 MB`.
    - Added `build:test`, `check:test`, and `build:test:tiles` scripts plus validation for MapLibre/vector-tile metadata and local tile assets.
    - Verification: `node --check` passed for new scripts and `/test` app files; `npm run check:test` passed; existing `npm run check` passed; `npm run build:test` passed outside the sandbox after the expected esbuild spawn `EPERM`; local headless smoke loaded `/test/`, rendered a MapLibre canvas, and loaded `civil-parishes-vector-test` in `645 ms`, with a known headless WebGL shader console error from the browser environment; production checks confirmed `/test/`, `/test/build/test.bundle.js`, `/test/metadata/maps-test.json`, and representative tile `/test/tiles/civil-parishes-v1/0/0/0.pbf` are live.
  - Remaining for full replacement:
    - This is the first safe execution slice, not full feature parity. The remaining rewrite still needs full catalogue compatibility, migrated tile packages for the heavy map set, URL state, feature search, time slider, data-entry overlays, election subsystem integration, mobile performance budget tests, and promotion/fallback work.

Fix /test Civil Parishes low-zoom feature loss
- [x] Identify why most Civil Parishes features disappear when zoomed out
- [x] Regenerate the Civil Parishes vector-tile package with low-zoom feature dropping disabled
- [x] Point `/test` metadata and the tile build script at the corrected versioned tile package
- [x] Verify representative low/mid-zoom tile feature counts and metadata validity
- [x] Commit, push, and confirm the deployed `/test` assets reference the corrected tile package
  - Recurring issue:
    - Symptom: the `/test` Civil Parishes map shows many missing polygons when zoomed out, while zoomed-in tiles show all visible-screen features.
    - Root cause: the first GDAL MVT export used defaults that warned about oversized tiles and encoded affected low/mid-zoom tiles at lower resolution, causing heavy feature loss.
    - Permanent prevention action: the tile build script now uses explicit correctness-first MVT generation options and the deployed metadata uses a versioned `civil-parishes-v2` tile directory.
    - Verification evidence: `node --check scripts\build-test-civil-parishes-tiles.mjs` passed; `npm run check:test` passed; representative v2 feature counts are `2423` at z3, `2435` at z4, and `2442` at z5; local HTTP checks returned `200` for `/test/metadata/maps-test.json`, `/test/tiles/civil-parishes-v2/4/7/5.pbf`, and `/test/tiles/civil-parishes-v2/5/15/10.pbf`; commit `64b779e6` was pushed to `main`; production polling confirmed `https://civgraph.net/test/metadata/maps-test.json` references `civil-parishes-v2` and `https://civgraph.net/test/tiles/civil-parishes-v2/5/15/10.pbf` returns `200`.

Fix /test Civil Parishes interaction lag
- [x] Quantify whether lag comes from oversized v2 tiles, per-mousemove feature querying, or both
- [x] Regenerate a smaller complete tile pyramid if representative v2 tiles are too large for smooth interaction
- [x] Throttle/defer hover hit-testing and make click selection responsive under load
- [x] Verify metadata, representative tile counts/sizes, and local `/test` behaviour
- [x] Commit, push, and confirm production serves the optimized assets
  - Recurring issue:
    - Symptom: features load slowly, hover highlighting lags behind the cursor, and click selection appears delayed.
    - Root cause: the correctness-first `civil-parishes-v2` tiles reduced feature loss by keeping unsimplified geometry, but that left mid-zoom tiles as large as `1.77 MB`; the controller also used layer-bound mousemove events and `setFilter()` on every hovered-feature change, forcing repeated hit-testing and style/filter recalculation while the pointer moved.
    - Permanent prevention action: use a versioned `civil-parishes-v3` tile pyramid with moderate low-zoom simplification and high tile limits, throttle hover hit-testing, suppress hover while the source is still loading or the map is moving, and use feature-state for hover/selected highlighting instead of filter mutation.
    - Verification evidence: `node --check test\src\app.js`, `node --check scripts\build-test-civil-parishes-tiles.mjs`, `npm run check:test`, and `npm run build:test` passed; v3 package size is `34.8 MB` versus v2 `76.4 MB`; worst sampled tile is `508 KB` versus v2 `1.77 MB`; representative local v3 feature counts are z3 `2421`, z4 `2433`, and z5 `2441`; local browser smoke loaded `/test`, loaded Civil Parishes, and clicked a feature successfully after the rebuilt bundle; commit `ac2209ca` was pushed to `main`; production polling confirmed `/test` serves `test-003`, metadata references `civil-parishes-v3`, and `/test/tiles/civil-parishes-v3/5/15/10.pbf` returns `200`.

Balance /test MapLibre label parity with performance
- [x] Precompute canonical label text, rank, and minimum zoom into the Civil Parishes vector tiles
- [x] Keep labels as MapLibre symbol layers with renderer-managed collision
- [x] Add metadata-driven label fallbacks, cleanup compatibility, priority ordering, and density rules
- [x] Add label visibility and text-scale controls without DOM label markers
- [x] Add click and throttled hover hit-testing across fill and label layers
- [x] Verify the tile metadata, representative tile label attributes, test app validation, and bundle build
- [x] Document review evidence and any remaining risks
  - Review:
    - Added GDAL SQLite label enrichment to the Civil Parishes tile build so tiles carry `label_name`, `label_rank`, and `label_minzoom`.
    - Label density is now rank/size based: 12 labels at z8, 57 at z9, 438 at z10, and all 2448 from z11 upward.
    - `/test` labels remain MapLibre `symbol` layers with renderer collision, `symbol-sort-key` priority, metadata-driven text fallbacks, configurable text colour, label visibility, and text scale controls.
    - Fill and label layers are both included in throttled hover/click hit-testing; no DOM label markers were added.
    - Verification evidence: `node --check test\src\app.js`, `node --check scripts\build-test-civil-parishes-tiles.mjs`, `node --check scripts\validate-test-app.mjs`, `npm run check:test`, `npm run build:test:tiles`, and `npm run build:test` passed. Representative MVT inspection confirmed `label_name`, `label_rank`, and `label_minzoom` in `test\tiles\civil-parishes-v3\9\244\165.pbf`; MapLibre style-spec validation accepted the generated label layer expression; browser smoke loaded `/test/index.html`, loaded Civil Parishes in 144 ms locally, confirmed the label controls, toggled labels, changed text scale to 150, and clicked a rendered feature successfully.

Style /test MapLibre labels like main-site feature labels
- [x] Add a metadata-driven label style contract for colour, halo, size, weight, wrapping, and hover state
- [x] Make Civil Parishes labels use the main-site label colour and white halo approximation
- [x] Preserve MapLibre symbol rendering and renderer collision
- [x] Add hover-aware label paint without DOM labels or CSS text overlays
- [x] Verify style expressions, /test metadata, bundle build, and a browser smoke check
- [x] Document review evidence and remaining differences from exact CSS parity
  - Review:
    - Added `labelStyle` metadata for main-site-like Civil Parishes labels: `#9932CC` text, white halo, 12px base size, bold font stack, centred wrapping, orange hover, and dark selected text.
    - Updated the MapLibre label layer to read style metadata for font stack, max width, line height, halo, text size, and hover/selected `feature-state` paint expressions.
    - Preserved MapLibre `symbol` rendering, renderer collision, ranked density, label toggling, and text scaling; no DOM label markers or CSS overlays were added.
    - Remaining difference: MapLibre halo and glyph rendering approximate the main site's CSS `text-shadow`/HTML text; underline-on-hover is not available for symbol text.
    - Verification evidence: `node --check test\src\app.js`, `node --check scripts\validate-test-app.mjs`, `npm run check:test`, representative MapLibre style-spec validation, and `npm run build:test` passed. Browser smoke loaded `/test/index.html`, loaded Civil Parishes, reached z9.631 where labels are active, found no relevant label/glyph runtime errors, toggled labels off/on, changed text scale to 150, and selected a rendered feature successfully.

Compare current main-site and /test feature labels
- [x] Inspect the main Leaflet label creation and CSS
- [x] Inspect the /test MapLibre label layer and metadata
- [x] Report the current parity, intentional differences, and remaining gaps
  - Review:
    - Main site labels are Leaflet DOM `DivIcon` markers created from `labelEntries`, placed manually with viewport collision checks, styled inline, and enhanced by CSS hover underline.
    - `/test` labels are MapLibre GL symbol-layer glyphs sourced from vector-tile label attributes, filtered by ranked minimum zoom, styled through `labelStyle`, and collision-managed by the renderer.
    - Current parity is close for Civil Parishes colour, white outline, bold 12px baseline, centering, clickability, hover colour, label toggling, and text scaling. Remaining differences are DOM/CSS underline and wrapping exactness on main versus GPU glyph halo/collision/density on `/test`.

Fix /test label styling not appearing on mobile
- [x] Identify why the latest label styling may not appear on the deployed test site
- [x] Bump /test bundle, metadata, and service-worker cache versions
- [x] Rebuild the test bundle and verify the versioned styling code is present
- [x] Report what changed and what the user should retest
  - Review:
    - Root cause: `/test` still requested `test.bundle.js?v=test-003` and used the `test-v3` service-worker cache after label-style behavior changed, so mobile browsers could keep running a stale bundle.
    - Bumped JS/CSS bundle URLs to `test-004`, bumped the scoped `/test` service worker cache to `test-v4`, and made the app fetch `/test/metadata/maps-test.json?v=test-004`.
    - Added `assetVersion` to the diagnostics panel so stale mobile bundles are visible.
    - Added validator coverage so `npm run check:test` fails if the `/test` index, app asset version, and service-worker cache version drift apart.
    - Verification evidence: `node --check test\src\app.js`, `node --check scripts\validate-test-app.mjs`, `npm run check:test`, and `npm run build:test` passed; local headless browser smoke loaded `/test`, requested `test.bundle.css?v=test-004`, `test.bundle.js?v=test-004`, and `maps-test.json?v=test-004`, then loaded `civil-parishes-vector-test` with diagnostics showing `assetVersion: test-004`.

Show /test feature labels at every zoom and compare architecture
- [x] Remove hard label zoom gates from the /test MapLibre symbol layer
- [x] Preserve renderer collision, ranked sort priority, hover/click, label toggles, and text scaling
- [x] Bump /test asset and service-worker versions for the deployed behavior change
- [x] Rebuild and smoke-check labels at low zoom
- [x] Compare main-site and /test functionality and appearance in detail
- [x] Commit and push the verified change
  - Review:
    - Removed the per-feature `label_minzoom` filter, set Civil Parishes `labelMinZoom` to `0`, and removed the label max-zoom cap by allowing `labelMaxZoom: null`.
    - Kept MapLibre symbol collision, `symbol-sort-key` rank priority, hover/selected feature-state styling, label toggles, and text-scale controls.
    - Bumped `/test` assets to `test-005` and the scoped service worker to `test-v5`; diagnostics now report label layer zoom bounds and rendered label feature count.
    - Updated `scripts/validate-test-app.mjs` so null/omitted `labelMaxZoom` is a valid intentional uncapped state while invalid numeric caps still fail validation.
    - Verification evidence: `node --check test\src\app.js`, `node --check scripts\validate-test-app.mjs`, `npm run check:test`, and approved `npm run build:test` passed; headless mobile smoke loaded `/test`, requested `test.bundle.css?v=test-005`, `test.bundle.js?v=test-005`, and `maps-test.json?v=test-005`, then loaded Civil Parishes at z5.372 with label diagnostics showing `minzoom: 0`, `maxzoom: null`, and `renderedLabelFeatures: 46`.

Plan main-site functionality transfer into /test
- [x] Review main-site controllers, metadata, catalogue, labels, search, elections, time slider, styling, and /test rewrite structure
- [x] Produce an implementation-grade plan for what to port, what to redesign, and what to leave behind
  - Review:
    - Plan should favour capability parity on MapLibre/vector tiles rather than copying Leaflet/FGB/DOM implementations.
    - High-ROI transferable areas are metadata normalization, catalogue/detail UX, layer controls, feature details, search, URL state, source/download references, time-series workflows, and election data contracts.
    - Low-ROI or harmful transfers are Leaflet layer objects, DOM `DivIcon` labels, eager catalogue rendering, FGB chunk/LOD loading as the primary architecture, and Leaflet-specific election rendering.

Execute /test main-site capability transfer phases 1-12
- [x] Phase 1: split `/test` app into MapLibre-native modules
- [x] Phase 2: add normalized `/test` metadata v2 foundation and conversion/validation contract
- [x] Phase 3: add vector-tile manifest/source validation
- [x] Phase 4: improve catalogue parity without eager DOM churn
- [x] Phase 5: improve map/layer controls and renderer-agnostic state
- [x] Phase 6: keep generalized MapLibre labels with diagnostics
- [x] Phase 7: add feature detail/search contracts
- [x] Phase 8: add URL/share state
- [x] Phase 9: add time-series workflow scaffold
- [x] Phase 10: add election workflow scaffold
- [x] Phase 11: expand production hardening validators
- [x] Phase 12: add migration readiness gates and smoke verification
  - Review:
    - Replaced the monolithic `/test` app entrypoint with dedicated modules for config, DOM wiring, utilities, metadata normalization, MapLibre layer control, catalogue rendering, active-layer controls, labels, feature details, diagnostics, URL state, feature search, time-series scaffolding, election scaffolding, conditional styling, and migration readiness.
    - Upgraded `/test` metadata to schema v2 with categories, capabilities, readiness notes, source downloads, provider/search metadata, geometry type, and continued Civil Parishes vector-tile configuration.
    - Added `npm run build:test:metadata` to produce `test/metadata/main-site-port-plan.json`, a deterministic migration inventory of the main catalogue: 901 rows including variants, 1 converted layer, 628 vector-tile candidates, 120 raster-strategy candidates, and 152 metadata-only entries.
    - Expanded validation so `/test` now checks module presence, metadata schema, vector-tile source directories, uncapped label rules, source/download/reference shapes, asset/cache version alignment, and that converted `/test` layers appear in the main-site port plan.
    - Preserved the MapLibre label/hover/click behaviour, added URL hash state for active layers and viewport, exposed `window.__civgraphTest` for debugging, and surfaced migration readiness in diagnostics.
    - Scope note: this executes the architecture and migration-management phases in full for the `/test` pilot. It does not mean all 901 main-site map/variant entries have been converted to live vector tiles; the port plan now makes that remaining data production work explicit and gated.
    - Verification evidence: `node --check` passed for every `test/src/*.js` file and the new metadata-plan script; `npm run build:test:metadata`, `npm run check:test`, and approved `npm run build:test` passed; headless mobile smoke loaded `/test`, loaded Civil Parishes, reported `assetVersion: test-006`, one normalized category, one active layer, no console errors, URL hash state for the active layer, and 46 rendered low-zoom label features.

Implement remaining feasible /test main-site parity items
- [x] Full catalogue metadata display from main-site port plan, including unconverted entries
- [x] Source/reference/download panels and richer feature detail content
- [x] Layer style controls, opacity/label/text URL state, and selected-feature URL state
- [x] Feature search index generation for converted tile pilots
- [x] Conditional styling controls using MapLibre expressions
- [x] Time-series switching for converted chains
- [x] Raster source support for tile/image-capable layers
- [x] Basic election choropleth support for converted vector geographies
- [x] Batch vector conversion tooling/reporting for feasible GDAL conversions
- [x] Rebuild, smoke-test, commit, and push
  - Review:
    - `/test` now loads `main-site-port-plan.json` at runtime and merges converted layers with unconverted main-site catalogue rows, so the catalogue represents all 901 main-site map/variant entries while marking non-converted rows as `not yet converted`.
    - Catalogue cards now surface category/group/date/provider/source credit/reference/download/variant/conversion details without making unconverted entries loadable.
    - Active layer controls now include opacity, line/fill colour controls, label toggles, text scale, and MapLibre expression-based attribute gradient styling.
    - URL hash state now records active layers, viewport, opacity, label visibility, text scale, and selected feature ID; selected feature state can be restored by ID after layer load.
    - Added a generated Civil Parishes feature-search sidecar with 2,448 indexed features and centroid coordinates; search results can load the layer, fly to the feature, and select it.
    - Feature details now include richer layer context, source/reference/download links, and source credits.
    - Raster source support is implemented in the MapLibre controller and validator for future raster tile/image metadata entries.
    - Time-series and election choropleth work remains data-gated: switching and election catalogue scaffolds exist, conditional styling is available for converted vector layers, but no converted election/time-chain layers exist yet.
    - Added `scripts/build-test-vector-batch.mjs` and `npm run build:test:batch-vectors`. The dry report found 18 locally available vector candidates and 610 skipped vector rows whose source files are external or ignored local-only assets; the script deliberately does not promote generated tiles without per-layer metadata/source-layer verification.
    - Bumped `/test` assets and service worker to `test-008`.
  - Verification:
    - `node --check` passed for all `test/src/*.js` files and the changed scripts.
    - `npm run build:test:metadata` regenerated 901 port-plan rows: 1 converted, 628 vector candidates, 120 raster-strategy candidates, 152 metadata-only.
    - Approved `npm run build:test:feature-indexes` generated 2,448 Civil Parishes feature-search rows.
    - `npm run build:test:batch-vectors` wrote `test/metadata/vector-conversion-report.json` in dry-run mode.
    - `npm run check:test`, approved `npm run build:test`, and `npm run check` passed.
    - Local mobile-size smoke on `/test/index.html` confirmed `assetVersion: test-008`, 901 metadata layers, 33 categories, 80 rendered catalogue cards with 79 unconverted cards, feature search results for `St. Margaret`, Civil Parishes load/selection, style controls, conditional styling, and URL hash state for layer/opacity/labels/text/selected feature.

Implement /test conversion and advanced parity follow-up
- [x] Convert the 18 locally available vector candidates into verified MVT outputs
- [x] Promote only verified converted layers into `test/metadata/maps-test.json`
- [x] Add an intake/report step for skipped vector candidates that need source download/location/upload work
- [x] Generate feature-search indexes for every converted layer with a local vector source
- [x] Add time-series UI that activates when converted chains exist
- [x] Add suitable raster tile entries for already-georeferenced raster datasets
- [x] Add richer style controls: stroke width, fill opacity, ramps, categorical/party-colour controls
- [x] Add a dedicated source/reference/download panel
- [x] Add a constrained practical PMTiles build/support path
- [x] Verify, commit, and push
  - Review:
    - Converted all 18 locally available vector candidates with GDAL MVT. The generated `/test/tiles/generated` output contains 44,739 files and about 247.0 MB of tile data.
    - Promoted 17 of those candidate conversions into `maps-test.json`; `roi-counties-2011` was not promoted because the generated tile metadata reported invalid geographic bounds outside the Ireland validation envelope.
    - `/test` now has 123 explicit loadable layers: 18 MVT layers including Civil Parishes and 105 georeferenced raster image overlays. Runtime catalogue merging brings total visible metadata to 886 layers: 123 loadable and 763 unconverted.
    - Generated feature-search indexes for all 18 promoted MVT layers, including townlands, EDs, Garda geographies, NUTS, settlements, wards, and Catholic Dublin parishes.
    - Added `npm run build:test:intake-vectors`, which writes `test/metadata/vector-intake-report.json` with 610 remaining vector-intake rows and per-row actions for downloading remote sources, locating ignored local sources, or adding missing source metadata before conversion.
    - Added `npm run build:test:promote` to regenerate promoted vector/raster metadata from verified conversion output and main-site metadata.
    - Added `npm run build:test:pmtiles`, which records the constrained PMTiles build path. The current environment reports `missing-tools` because neither `pmtiles` CLI nor `tippecanoe` is installed, while the runtime remains ready for `sourceType: "pmtiles"` entries.
    - Added source/reference/download and time-series panels to the sidebar. Time-series UI remains inactive until converted chains exist.
    - Expanded style controls with stroke width, categorical styling, colour ramps, and party-colour mode in addition to existing opacity, fill/line colour, labels, and text scale.
    - Bumped `/test` assets and service worker to `test-009`.
  - Verification:
    - `npm run build:test:batch-vectors -- --execute` converted 18/18 local candidates with 0 failures.
    - `npm run build:test:promote` promoted 17 vector layers and 105 raster image layers.
    - `npm run build:test:feature-indexes` built 18 feature indexes with 0 skipped layers.
    - `npm run build:test:intake-vectors` wrote a 610-row intake report.
    - `npm run build:test:pmtiles` wrote a PMTiles tool report showing the missing local PMTiles/tippecanoe tools.
    - `npm run check:test`, approved `npm run build:test`, and `npm run check` passed.
    - Local mobile-size smoke loaded `/test/index.html`, confirmed `assetVersion: test-009`, loaded `roi-garda-regions-vector-test`, applied categorical styling on `REGION`, loaded `wards-1993-wards92-antrim-raster-image-test`, verified source-panel content, and confirmed feature search results.

Implement /test non-data-blocked hardening and PMTiles pass
- [x] Constrain or install a PMTiles build path and convert existing generated MVT layers where possible
- [x] Prefer PMTiles metadata once archives exist
- [x] Improve style controls, legends, reset actions, and URL style state
- [x] Improve source/reference/download panel layout and filtering
- [x] Add diagnostics for oversized tiles, slow layers, missing indexes, and load timing
- [x] Add automated checks for generated tile budgets and invalid bounds
- [x] Add mobile performance smoke coverage for converted layers
- [x] Improve feature-search grouping, badges, keyboard behaviour, and result limits
- [x] Add warning badges for large/expensive layers
- [x] Add PMTiles/CDN deployment documentation/scripts
- [x] Clean up or quarantine invalid generated output such as `roi-counties-2011`
- [x] Verify, commit, and push
  - Review:
    - `npm run build:test:pmtiles -- --force` now uses GDAL's PMTiles driver as the constrained build path. It generated 18 PMTiles archives in `test/pmtiles/generated`; all were below the 95 MB metadata preference budget, largest being `roi-townlands-vector-test.pmtiles` at about 66.1 MB.
    - `maps-test.json` now prefers `sourceType: "pmtiles"` for all 18 converted vector layers while retaining `tilesFallback` and `metadataUrl` for the directory MVT outputs.
    - Added PMTiles/CDN deployment documentation, a CDN upload manifest script, and a hard serving requirement for HTTP byte ranges.
    - Style controls now include presets, reset buttons, legends for gradient/categorical/party-colour modes, stroke state, and URL state for mode, attribute, ramp, and stroke width.
    - Source/reference/download UI now has filtering and separates facts, credits, references, downloads, and tile links.
    - Diagnostics now report PMTiles/directory-MVT counts, slow loads, large layers, oversized tiles, and missing feature indexes.
    - Feature search now returns more results, groups by layer, shows badges/context, supports Arrow key navigation, and still caps results to avoid excessive DOM.
    - Added warning badges for PMTiles, large layers, large tiles, and heavy layers such as townlands.
    - Added `scripts/validate-test-tile-budgets.mjs`; `npm run check:test` now fails on invalid bounds, missing PMTiles archives, hard tile-size budget breaches, and reappearance of the invalid `roi-counties-2011` generated directory.
    - Removed the invalid `test/tiles/generated/roi-counties-2011` tile directory and added `test/metadata/quarantine/roi-counties-2011.json` as the audit trail.
    - Added `npm run smoke:test:mobile`, including a range-capable local static server because PMTiles requires HTTP byte serving.
    - Bumped `/test` assets and scoped service worker to `test-010`.
  - Verification:
    - `node --check` passed for the changed scripts and every `test/src/*.js` module.
    - Approved `npm run build:test:pmtiles -- --force` generated 18/18 PMTiles archives with 0 failures.
    - Approved `npm run build:test:feature-indexes` rebuilt 18/18 feature-search indexes with 0 skipped layers.
    - `npm run build:test:metadata` regenerated the main-site port plan.
    - `npm run build:test:cdn-manifest` wrote `test/metadata/cdn-upload-manifest.json`.
    - `npm run check:test` passed; it reports warning-only budget findings for `roi-small-areas-2011` and `roi-townlands`.
    - Approved `npm run build:test` passed and rebuilt the `/test` bundle.
    - Approved `npm run smoke:test:mobile` passed on six PMTiles layers at a 390px mobile viewport; the tested loads completed in roughly 1.5-1.6 seconds each with no console errors.
    - `npm run check` passed the existing chunked-map bounds and fit regression checks.

Implement /test CDN and UX hardening follow-up
- [x] Upload PMTiles archives to CDN/R2 and switch metadata to CDN URLs once verified
- [x] Verify CDN byte-range support for PMTiles
- [x] Remove large PMTiles from Git or put them under Git LFS once CDN is authoritative
- [x] Expand mobile smoke coverage to all 18 PMTiles layers
- [x] Add stricter performance budgets
- [x] Replace raw diagnostics JSON with readable diagnostics panels
- [x] Persist additional style details in URL state
- [x] Improve style presets and legends
- [x] Improve source/reference/download panel UX
- [x] Add automated CDN manifest validation
- [x] Add service-worker cache limits for PMTiles
- [x] Add PMTiles fallback recovery to directory MVT
- [x] Improve feature-search UX and ranking
- [x] Add stronger quarantine validation for `roi-counties-2011`
- [x] Verify, commit, and push
  - Review:
    - Uploaded all 18 `/test` PMTiles archives to Cloudflare R2 under `data/maps/test/pmtiles/generated/` and switched `maps-test.json` so the runtime PMTiles URLs now use `https://data.civgraph.net/data/maps/test/...`.
    - Applied R2 CORS for `civgraph.net`, Pages, and local test origins, exposing `Accept-Ranges`, `Content-Length`, `Content-Range`, and `ETag` for browser-side PMTiles range reads.
    - Verified all 18 public PMTiles URLs return `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Length: 16`, and valid `Content-Range` for `Range: bytes=0-15`.
    - Removed generated PMTiles archives from Git tracking with `git rm --cached` and added `test/pmtiles/generated/*.pmtiles` to `.gitignore`; the local archives remain on disk and R2 is now authoritative.
    - Added retryable PMTiles upload support via `npm run deploy:test:pmtiles -- --ids <layer-id>`, CDN range verification, metadata switching, and CDN manifest validation scripts.
    - Added PMTiles fallback recovery: if a PMTiles source errors due to range/fetch/content-length failures, `/test` unloads it and retries the layer from directory MVT using `tilesFallback`.
    - Added scoped `/test` service-worker cache limits for PMTiles entries.
    - Replaced diagnostics raw JSON with readable panels for counts, warnings, slow loads, large layers/tiles, missing indexes, recent loads, and expandable raw data.
    - Improved style persistence with line/fill colours and extra ramps, compact legends, better source/reference/download badges and grouped link sections, and better feature-search scoring/highlighting.
    - Expanded the mobile smoke from 6 representative layers to all 18 PMTiles/MVT layers, added per-layer and total timing budgets, progress output, and deterministic per-layer timeout handling.
    - Fixed a MapLibre controller readiness bug found by the expanded smoke: `waitForMap()` no longer waits for the one-time `load` event after `map.loaded()` temporarily becomes false during tile activity; it now waits for style readiness with a bounded fallback.
    - Recurring issue guardrail:
      - Symptom: sequential MapLibre layer loads could hang or appear very slow after one layer was already active.
      - Root cause: the controller treated `map.loaded() === false` as a need to wait for the one-time initial `load` event, which never fires again after startup.
      - Permanent prevention action: `waitForMap()` now gates source/layer mutation on `isStyleLoaded()` and the all-18 mobile smoke has per-layer timeout reporting.
      - Verification evidence: all 18 CDN PMTiles layers loaded and rendered in the mobile smoke, with the slowest layer under the 5000 ms budget.
    - Bumped `/test` assets and service worker to `test-011`.
  - Verification:
    - `node --check` passed for changed scripts and every `test/src/*.js` module.
    - `npm run deploy:test:r2-cors` applied the R2 CORS policy.
    - `npm run deploy:test:pmtiles -- --ids roi-townlands-vector-test` retried the one failed large upload successfully after the other 17 had uploaded.
    - `npm run verify:test:pmtiles-cdn` passed for all 18 public PMTiles URLs and wrote `test/metadata/cdn-range-report.json`.
    - `npm run switch:test:pmtiles-cdn` switched all 18 PMTiles layer URLs to CDN URLs.
    - `npm run build:test:cdn-manifest` regenerated the CDN upload manifest with repo-local archive paths and CDN target URLs.
    - `npm run check:test` passed; warning-only budget findings remain for `roi-small-areas-2011` and `roi-townlands`.
    - Approved `npm run build:test` passed and rebuilt the `/test` bundle.
    - Approved `npm run smoke:test:mobile` passed on all 18 PMTiles layers at a 390px mobile viewport; slowest was `roi-townlands-vector-test` at 2607 ms, all layers rendered features, and there were no console errors.
    - `npm run check` passed the existing chunked-map bounds and fit regression checks.
    - Approved `npm run build` passed for the main site bundle.

Implement /test production-readiness and main-shell parity pass
- [x] Add CI/scheduled monitor scaffolding for `/test` checks and CDN PMTiles byte ranges
- [x] Add visible PMTiles fallback warnings and richer runtime telemetry
- [x] Improve diagnostics UI with sorting, severity filters, copy report, and grouped warnings
- [x] Improve style UI, legends, feature search, and source/reference/download UX
- [x] Add more Playwright coverage for `/test` URL/style/fallback/diagnostics/source behaviours
- [x] Harden service-worker cache eviction with quota-aware cleanup
- [x] Add deployment documentation, production readiness checklist, and CDN/cache versioning discipline
- [x] Improve accessibility and mobile ergonomics
- [x] Port practical main-site top-navbar and catalogue-shell parity into `/test`
- [x] Retune current tile-budget warning layers if feasible without new data
- [x] Verify, commit, and push
  - Review:
    - Added `.github/workflows/test-readiness.yml` with pull-request/push validation and scheduled/manual CDN byte-range monitoring.
    - Added `npm run check:test:ci` and `npm run test:browser:test`.
    - Added main-style Civgraph top navigation to `/test`, kept the left catalogue-first workflow, added catalogue stats, and added a mobile catalogue toggle.
    - Added visible PMTiles fallback alerts, fallback metrics, PMTiles/CDN timing telemetry, and `/test` RUM beacons on Civgraph hosts only.
    - Diagnostics now support severity filtering, sorting, grouped warnings, PMTiles network timing, fallback/CDN failure counts, and copy-report.
    - Style controls now support saved per-layer presets, legend click-to-filter, URL persistence for legend filters, and reset clearing both style and filters.
    - Source/reference/download rows now include copy-link actions and fallback badges.
    - The `/test` service worker now trims caches more aggressively under storage pressure and can report cache status to clients.
    - Added `test/metadata/production-readiness.md` and linked it from PMTiles/CDN deployment docs.
    - Added `scripts/test-tile-profiles.mjs` and wired profiles into directory MVT and PMTiles generation. The two budget-warning layers were regenerated, PMTiles were rebuilt, uploaded to R2, CDN range-verified, and metadata was switched back to CDN URLs.
    - Tuning reduced `roi-townlands-vector-test` PMTiles from about 66.1 MB to 52.6 MB and lowered the fallback tile directory from about 102.6 MB to 84.3 MB. It did not fully clear all warning thresholds, so the hard validation still reports warning-only findings rather than hiding them.
    - Restored the full 18 converted vector-layer metadata after a narrowed tuning report exposed a promotion hazard; `build-test-vector-batch` now includes already-converted rows when regenerating the full report.
    - Bumped `/test` assets and scoped service worker to `test-012`.
  - Verification:
    - `node --check` passed for changed `/test` modules, scripts, and the RUM function.
    - Approved `npm run build:test:batch-vectors -- --execute` regenerated all 18 converted vector outputs.
    - `npm run build:test:promote` restored 17 promoted vector layers and 105 raster image layers.
    - Approved `npm run build:test:pmtiles` restored 18 PMTiles metadata entries.
    - Approved `npm run deploy:test:pmtiles -- --ids roi-small-areas-2011-vector-test,roi-townlands-vector-test` uploaded the retuned PMTiles archives.
    - Approved `npm run verify:test:pmtiles-cdn` verified all 18 CDN PMTiles URLs.
    - `npm run switch:test:pmtiles-cdn` switched all 18 PMTiles layer URLs to CDN URLs.
    - `npm run check:test`, approved `npm run build:test`, `npm run test:browser:test`, approved `npm run smoke:test:mobile`, `npm run check`, approved `npm run build`, `npm run check:test:ci`, and final CDN manifest validation passed.
    - The all-layer mobile smoke loaded all 18 PMTiles layers; slowest was `roi-townlands-vector-test` at 2484ms, under the 5000ms budget.

Fix Cloudflare Pages 20,000-file deployment failure
- [x] Inspect deployment log, Pages cleanup script, tracked tile file counts, and `/test` metadata references
- [x] Decide and implement the minimal production-safe fix
- [x] Add/verify a guardrail so generated tile directories cannot silently push Pages over the file cap again
- [x] Verify locally, commit, and push
  - Findings so far:
    - Cloudflare Pages failed after `npm run build && bash scripts/clean-for-pages.sh` with the 20,000-file deployment cap.
    - `scripts/clean-for-pages.sh` currently deletes files over 25 MB only; it does not remove high-file-count tile pyramids.
    - The tracked repo contains 61,970 files; 45,897 tracked files are under `test/tiles`.
    - `test/tiles/generated` alone contains 41,973 tracked files.
    - `test/tiles/civil-parishes-v3` contains another 3,924 tracked files.
    - Removing only `test/tiles/generated` would leave about 19,997 tracked files before build output, so the safer fix also needs to handle the legacy civil-parishes directory tiles or add a stronger deployment-file-count guard.
    - All 18 PMTiles layers in `/test` point at `https://data.civgraph.net/...` CDN/R2 URLs, but 17 directory-MVT fallbacks still point at local `/test/tiles/...` paths.
  - Implementation:
    - Removed `test/tiles/generated/` and `test/tiles/civil-parishes-v3/` from Git tracking with `git rm --cached`, leaving local developer copies available but keeping them out of future Cloudflare clones/deploys.
    - Added `test/tiles/generated/`, `test/tiles/civil-parishes-v3/`, `test/tiles/`, `test/pmtiles/generated/`, and `node_modules/` deployment/source-control guardrails through `.gitignore`, `.cfignore`, and `scripts/clean-for-pages.sh`.
    - Hardened `scripts/clean-for-pages.sh` so Pages build output removes local tile pyramids and fails early if the remaining asset output still exceeds Cloudflare's 20,000-file cap.
    - Updated `/test` PMTiles fallback handling so production does not attempt to use local directory-MVT fallbacks that are intentionally not deployed; local development hosts can still use them.
    - Updated `/test` production-readiness documentation and `tasks/lessons.md` with the Pages/R2 split and file-count guardrail.
  - Verification:
    - `git ls-files | Measure-Object` now reports 16,073 tracked files.
    - `git ls-files test/tiles` now reports 0 tracked files.
    - `bash -n scripts/clean-for-pages.sh` passed.
    - `node --check` passed for changed `/test` runtime modules.
    - `npm run check:test` passed; existing warning-only tile budget findings remain for `roi-small-areas-2011` and `roi-townlands`.
    - Approved `npm run build` passed after the sandboxed run hit an esbuild spawn `EPERM`.
    - Approved `npm run build:test` passed after the sandboxed run hit an esbuild spawn `EPERM`.
    - `npm run check` passed.
    - Approved `npm run test:browser:test` passed all 4 tests after the sandboxed run hit a browser spawn `EPERM`.

Review remaining /test MapLibre parity and feasibility
- [x] Record the review request
- [x] Inspect the main-site shell/catalogue behavior and the current `/test` equivalents
- [x] Identify remaining feasible work, MapLibre-inappropriate work, and data-blocked work
- [x] Report findings inline in chat
  - Review:
    - `/test` currently has a main-style top nav, a left catalogue pane, source panel, feature details, active layer controls, diagnostics, feature search, URL state, PMTiles support, and not-yet-converted catalogue rows.
    - `/test` metadata exposes 123 loadable layers: 18 PMTiles vector layers and 105 image overlays. The port plan still lists 763 non-converted or metadata-only main-site rows.
    - The remaining non-data-blocked parity work is mostly UI structure and workflow parity: exact top-nav/mobile menu behavior, C1/C2 catalogue hierarchy, catalogue detail/history views, richer source panels, feature detail polish, URL/copy affordances, and accessibility/mobile refinements.
    - The remaining data-blocked parity work is chiefly full map coverage, time-series chains, election choropleths/results integration, feature search for every converted layer, and production fallbacks for generated tiles.
    - Work that should not be ported literally includes Leaflet layer internals, FGB/chunk/LOD client loaders, DOM-based feature labels, and thumbnail request patterns that caused old mobile churn.

Implement /test main-shell parity improvements
- [x] Record the implementation request
- [x] Make `/test` top navbar match the main site more closely, including responsive mobile menu behavior and active state
- [x] Make the `/test` catalogue closer to the main catalogue: hierarchy, collapsible groups, history, home/back/forward, detail view
- [x] Add richer catalogue cards/details for converted and unconverted maps
- [x] Add copy/share affordances for layers and selected features
- [x] Improve source/reference/download panel and feature details
- [x] Improve layer controls, style UI, feature search, diagnostics, accessibility, and mobile ergonomics
- [x] Add production-readiness checklist automation for main-shell parity
- [x] Add/update browser coverage
- [x] Verify and report what remains
  - Review:
    - Ported the `/test` header closer to the main shell: Civgraph branding, Home/About/MapLibre Test links, active state, support/mode controls, skip links, and a responsive mobile menu.
    - Reworked the `/test` catalogue into a main-site-like catalogue-first flow with group/category hierarchy, collapsible C1/C2-style sections, back/forward/home navigation, rich detail views, and first-class not-yet-converted entries from the main-site port plan.
    - Expanded converted and unconverted catalogue details with status, descriptions, dates, provider/credit metadata, source files, references, downloads, variants, and copy/share URLs.
    - Added layer-level copy/fit/unload actions in active layer controls and feature-level copy/share in selected feature details.
    - Improved source/reference/download presentation with grouped sections, sorting, copy buttons, and missing-source badges.
    - Reworked feature details to highlight label/name fields, group source context, and hide noisy technical properties behind a disclosure.
    - Added production-readiness diagnostics for shell parity, converted coverage, CDN/PMTiles health, runtime performance, and fallback state.
    - Added `scripts/validate-test-shell-parity.mjs` and wired it into `check:test` and `check:test:ci`.
    - Bumped `/test` assets and scoped service-worker cache to `test-013`.
  - Verification:
    - `node --check` passed for changed `/test` modules and `scripts/validate-test-shell-parity.mjs`.
    - `npm run check:test` passed; it reports 123 loadable `/test` layers and 763 unconverted runtime catalogue entries from the main-site port plan. Existing warning-only tile-budget findings remain for `roi-small-areas-2011-vector-test` and `roi-townlands-vector-test`.
    - Approved `npm run build:test` passed after the sandboxed run hit the known esbuild `spawn EPERM`.
    - Approved `npm run test:browser:test` passed all 7 `/test` browser regression tests after tightening the Home-link locator.
    - `npm run check` passed the existing main-site chunked-map bounds and fit checks.

Review remaining /test parity after main-shell pass
- [x] Record the review request
- [x] Re-check current `/test` metadata, port-plan counts, and shell/catalogue markers
- [x] Separate remaining feasible work into data-blocked and non-data-blocked categories
- [x] Identify MapLibre-inappropriate main-site behaviours that should not be ported literally
  - Review:
    - Current `/test` state: 123 loadable layers, 18 PMTiles vector layers, 105 image overlays, and 763 unconverted runtime catalogue entries from `test/metadata/main-site-port-plan.json`.
    - The main-site-shaped shell is now present in `/test`, but exact top-nav behaviours such as the support modal and theme toggle are still only visual/partial in the test shell.
    - Remaining non-data-blocked parity is mostly shell polish, catalogue UX fidelity, URL/state completeness, accessibility, tests, and deployment hardening.
    - Remaining data-blocked parity is chiefly converting the 763 unconverted rows, producing feature indexes for those converted layers, and wiring time-series/election experiences once their geographies exist as vector/raster test layers.

Implement expanded /test shell and catalogue parity
- [x] Record the expanded implementation request
- [x] Wire `/test` support button to the same modal behaviour as the main site
- [x] Wire `/test` theme/mode button to the main light/dark theme system
- [x] Match mobile menu behaviour more closely: icon, outside-click close, support wiring, active route state
- [x] Refine left catalogue C1/C2 hierarchy, spacing, filters, history dropdown, detail metadata, and URL semantics
- [x] Improve selected-feature details, accessibility, diagnostics/readiness guardrails, and CI checks
- [x] Add/update browser coverage
- [x] Verify and report what remains
  - Review:
    - Added a `/test` support modal wired from the desktop support button, mobile support button, and mobile-menu support action, with Escape/backdrop/close-button dismissal and focus handling.
    - Connected the `/test` mode button to the persisted light/dark theme state through `localStorage.theme`, `data-theme`, and `aria-pressed`, with dark-mode surface coverage for the MapLibre test shell.
    - Reworked the mobile menu behaviour with an icon button, outside-click close, support action wiring, route-active state, Escape handling, and basic focus trapping while overlays are open.
    - Expanded the left catalogue toward the main site's C1/C2 feel with deeper group spacing, provider/category filter pills, active-filter visibility, a catalogue history dropdown, restored search/detail/sidebar hash state, and richer detail metadata.
    - Improved catalogue detail parity with keyword/status badges, source-file formatting, reference notes/accessed dates, richer link rows, and first-class unconverted entries.
    - Preserved more URL semantics by keeping catalogue detail, search query, provider/category filters, sidebar state, map state, labels, opacity, styles, and selected-feature state in the hash without the map-state writer erasing catalogue state.
    - Improved selected-feature details with table-like grouped fields, source context, and copy/share actions for both selected features and their layers.
    - Extended diagnostics/readiness guardrails to report CI readiness, converted/unconverted catalogue coverage, and the expected `/test` parity markers.
    - Bumped `/test` assets and scoped service-worker cache to `test-014`.
  - Verification:
    - `node --check` passed for changed `/test` modules and `scripts/validate-test-shell-parity.mjs`.
    - `npm run check:test` passed. Existing warning-only tile-budget findings remain for `roi-small-areas-2011-vector-test` and `roi-townlands-vector-test`.
    - Approved `npm run build:test` passed after the sandboxed run hit the known esbuild `spawn EPERM`.
    - Approved `npm run test:browser:test` passed all 9 `/test` browser regression tests, covering support modal, theme toggle, URL restore, catalogue history, mobile menu close behaviour, source panels, feature details, and active layer controls.
    - `npm run check` passed the main-site chunked-map bounds and fit checks.

Review remaining /test parity after expanded shell pass
- [x] Record the review request
- [x] Inspect current `/test` shell, catalogue, metadata, and parity guardrails
- [x] Separate remaining feasible work into blocked-on-data and not-blocked-on-data
- [x] Identify main-site behaviours that should not be ported literally to MapLibre
- [x] Report findings inline in chat
  - Review:
    - Current `/test` runtime metadata has 123 loadable layers: 18 PMTiles vector layers and 105 image overlays.
    - The main-site port plan has 901 source rows: 138 marked converted in the plan, 611 needing vector-tile conversion, and 152 metadata-only rows. Runtime normalization still exposes 763 unconverted catalogue entries.
    - Current `/test` shell parity now includes main-style top navigation, support modal, theme toggle, mobile menu, left catalogue pane, catalogue filters/history/detail URLs, source panel, feature details, diagnostics, PMTiles fallback warnings, and browser guardrails.
    - Remaining non-data-blocked work is polish and hardening: exact visual parity, deeper URL/history semantics, mobile/accessibility refinement, diagnostics/readiness reporting, CI/deployment guardrails, and MapLibre-specific control refinements.
    - Remaining blocked-on-data work is full converted map coverage, complete feature search indexes, time-series switching, election map workflows, and any feature-detail fields that require richer vector-tile attributes.
    - Work that should not be ported literally includes Leaflet layer objects/control APIs, FGB/chunked client loaders, DOM-marker label mechanics, thumbnail-heavy browse behavior, and browser-memory assumptions from the old renderer.

Implement remaining non-data-blocked /test parity and hardening
- [x] Record the implementation request and scope
- [x] Refine navbar, spacing, typography, panel rhythm, button states, and catalogue card visual parity
- [x] Improve catalogue hierarchy, dense/list modes, sorting, history UX, and saved view preferences
- [x] Preserve fuller URL state for panels, catalogue groups, tabs, and detail/source/diagnostics state
- [x] Improve source/reference/download grouping, citations, badges, copy links, and missing-source explanations
- [x] Improve selected-feature details with field grouping, preferred labels, aliases, and hidden technical fields
- [x] Improve MapLibre-native layer controls, ordering, presets, defaults, and saved per-layer state
- [x] Improve mobile ergonomics, gestures, focus trapping, touch targets, landscape layout, and reduced motion
- [x] Improve accessibility labels, keyboard order, focus return, visible focus states, and touch-target guardrails
- [x] Improve diagnostics/readiness panels, CDN/tile summaries, copyable reports, and deployment discipline guardrails
- [x] Expand tests and verify
  - Review:
    - Bumped `/test` to `test-015`.
    - Added catalogue view/sort controls with saved preferences, hash restoration, dense card mode, table mode, sortable catalogue rows, and collapsed-group hash state.
    - Preserved more shell URL state: selected panel, source filter, diagnostics severity/sort, catalogue view/sort, and collapsed catalogue groups.
    - Added mobile menu theme wiring, focus-return handling for the support modal, active panel marking, mobile sidebar swipe-down close, larger mobile touch targets, landscape sidebar layout, and stronger visible focus styles.
    - Added MapLibre layer order controls and saved per-layer control defaults for opacity, stroke width, colours, labels, and text scale.
    - Improved source/reference/download rows with citation notes, accessed dates, source-type badges, copy actions, and missing-source explanations.
    - Improved selected feature detail labels with field aliases and friendlier generated labels while keeping technical fields hidden by default.
    - Expanded diagnostics with load timing summaries, deployment discipline guidance, CDN/local-fallback status, and service-worker/cache readiness.
    - Tightened guardrails: `validate-test-app` now checks service-worker cache discipline; CDN manifest validation now checks PMTiles path/key/byte consistency and reports local-only fallbacks as an aggregate warning; shell parity validation now checks the new controls and deployment/cache markers.
  - Verification:
    - `node --check` passed for changed `/test` modules and validation scripts.
    - `npm run check:test` passed. It reports the existing warning-only tile-budget findings for `roi-small-areas-2011-vector-test` and `roi-townlands-vector-test`, plus one aggregate warning that 18 PMTiles layers retain local-only directory fallbacks which runtime keeps disabled off localhost.
    - Approved `npm run build:test` passed after the sandboxed run hit the known esbuild `spawn EPERM`.
    - Approved `npm run test:browser:test` passed all 9 `/test` browser regression tests.
    - `npm run check` passed the main-site chunked-map bounds and fit checks.

Review remaining /test parity after non-data-blocked hardening
- [x] Record the review request
- [x] Inspect current `/test` metadata, shell, catalogue, and guardrail state
- [x] Separate remaining feasible work into blocked-on-data and not-blocked-on-data
- [x] Identify main-site behaviours that are not appropriate to port literally to MapLibre
- [x] Report findings inline in chat
  - Review:
    - Current `/test` runtime metadata has 123 loadable layers: 18 PMTiles vector layers and 105 image overlays. All 18 vector layers have feature indexes. There are no converted time-series chains or election catalogues yet.
    - The main-site port plan still has 901 source rows: 138 marked converted in the plan, 611 needing vector-tile conversion, and 152 metadata-only rows. Runtime normalization still exposes 763 unconverted catalogue entries.
    - Current `/test` shell parity includes the main-style top navigation, support modal, theme toggle, mobile menu, left catalogue pane, filters, history, detail URL state, dense/table catalogue modes, source panels, feature details, diagnostics, PMTiles fallback warnings, and CI/browser guardrails.
    - Remaining non-data-blocked work is now mostly exact visual polish, accessibility depth, richer saved preferences, advanced diagnostics, and production promotion documentation/checklists.
    - Remaining blocked-on-data work is full map conversion, complete time-series/election workflows, richer per-layer field aliases where source attributes are missing, and performance tuning that depends on regenerating tiles.
    - Work that should not be ported literally includes Leaflet layer/control internals, FGB/chunked client loaders, DOM label overlays, thumbnail-heavy browse flows, and old mobile request patterns.
  - Verification:
    - `npm run check:test` passed. Existing warning-only findings remain: two large tile-budget layers plus one aggregate warning that 18 PMTiles layers retain local-only directory fallbacks disabled off localhost.

Implement final non-data-blocked /test parity polish
- [x] Record the implementation request and scope
- [x] Refine visual parity for navbar, spacing, typography, panel rhythm, menu styling, and catalogue cards
- [x] Add accessibility depth: ARIA relationships, focus return, keyboard shortcuts, touch target guardrails, and reduced-motion refinements
- [x] Add saved preferences for expanded panels, catalogue defaults, diagnostics settings, and layer controls
- [x] Improve diagnostics with readiness score, grouped deployment checks, tile-budget explanations, and memory/storage reporting
- [x] Expand browser coverage for accessibility smoke, keyboard catalogue flow, copy actions, layer order persistence, and mobile landscape sidebar
- [x] Add promotion checklist documentation for moving `/test` to the main route
- [x] Verify and report outcome
  - Review:
    - Bumped `/test` to `test-016`.
    - Tightened the shell visuals with shared sizing variables, denser panel rhythm, refined catalogue card spacing, stronger focus styling, and main-site-like catalogue control treatment.
    - Added ARIA panel labels, shortcut metadata, keyboard shortcuts (`/`, `C`, `S`, `D`, `T`, `?`), focus return for the mobile menu/support modal, and mobile landscape sidebar behaviour.
    - Added saved panel-collapse preferences, saved diagnostics preferences, and persisted MapLibre layer ordering alongside existing catalogue and layer-control preferences.
    - Diagnostics now show a readiness score/meter, grouped deployment discipline checks, browser resource/storage reporting where supported, and friendlier tile-budget notes.
    - Added `test/metadata/test-to-main-promotion-checklist.md` covering architecture, non-data gates, data gates, cutover steps, and rollback conditions.
    - Expanded shell parity guardrails to require the new shortcuts, panel preferences, diagnostics, cache, layer-order, and promotion checklist markers.
    - Expanded browser tests to 11 cases covering accessibility smoke/keyboard flow, panel-collapse persistence, source copy action, layer-order persistence, and mobile landscape sidebar.
  - Verification:
    - `node --check` passed for changed `/test` modules, validation scripts, and browser tests.
    - `npm run check:test` passed. Existing warning-only findings remain: two large tile-budget layers plus one aggregate warning that 18 PMTiles layers retain local-only directory fallbacks disabled off localhost.
    - Approved `npm run build:test` passed after the sandboxed run hit the known esbuild `spawn EPERM`.
    - Approved `npm run test:browser:test` passed all 11 `/test` browser regression tests.
    - `npm run check` passed the main-site chunked-map bounds and fit checks.

Review remaining /test parity after final non-data polish
- [x] Record the review request
- [x] Inspect current `/test` metadata counts, guardrails, and implemented parity markers
- [x] Separate remaining feasible work into blocked-on-data and not-blocked-on-data
- [x] Identify main-site behaviours that are not appropriate to port literally to MapLibre
- [x] Report findings inline in chat
  - Review:
    - Current `/test` is on `test-016` and has the practical main-shell parity stack: top navbar, support modal, theme toggle, mobile menu, left catalogue pane, filters, history, dense/table modes, detail URL state, saved preferences, source panels, feature details, diagnostics/readiness, keyboard shortcuts, mobile landscape handling, PMTiles fallback warnings, and browser/CI guardrails.
    - Runtime metadata has 123 loadable layers: 18 PMTiles vector layers and 105 image overlays. All 18 PMTiles layers have labels and feature indexes.
    - There are still 0 converted time-series chains and 0 election catalogues in `/test`.
    - The main-site port plan still has 901 rows: 138 marked converted in the plan, 611 needing vector-tile conversion, 152 metadata-only rows, and 763 runtime catalogue entries that remain unconverted.
    - Remaining non-data-blocked work is now mostly refinement rather than foundational parity: deeper visual matching, more accessibility audit breadth, more browser coverage, stronger production documentation, and optional hardening around preferences/diagnostics/deployment.
    - Remaining blocked-on-data work is the real gap: converting unconverted maps, generating indexes, wiring time-series/election workflows, and retuning heavy layers from regenerated tiles.
    - Leaflet-specific internals, FGB/chunked client loading, DOM label overlays, thumbnail-heavy browse flows, and old Leaflet feature interaction mechanics should not be ported literally.
  - Verification:
    - `npm run check:test` passed. Existing warning-only findings remain: two large tile-budget layers plus one aggregate warning that 18 PMTiles layers retain local-only directory fallbacks disabled off localhost.

Find Pointer postal address coordinate data
- [x] Record the search request
- [x] Search the `boundaries-website` repo for Pointer files and references
- [x] Enumerate local/external drives and search likely external storage locations
- [x] Report candidate paths, confidence, and follow-up steps
  - Review:
    - Repo scripts reference a Pointer/EONI properties source at `D:\eoni\properties.geojson`.
    - Verified `D:\eoni\properties.geojson` exists on the external HDD and is 335,653,079 bytes, last modified 2026-04-27 00:41:42.
    - Light header inspection confirms it is a GeoJSON FeatureCollection of postal address point records with fields including `UPRN`, `Address1`-`Address5`, `POSTCODE`, `X_COR`, `Y_COR`, and lon/lat point geometry.
    - Verified derived postcode district outputs exist in Google Drive at `G:\My Drive\NI Postcode Districts - Polygons.geojson` and `G:\My Drive\NI Postcode Districts - Polygons Map.png`.
  - Verification:
    - `Test-Path D:\eoni\properties.geojson` returned true.
    - `Get-ChildItem D:\eoni` showed `properties.geojson`, `polling_stations.geojson`, and scrape logs.
    - Read only the first 4 KB of `properties.geojson` to confirm schema without loading the full 336 MB file.

Debug GeoDirectory CAPTCHA loading
- [x] Record the browser-debugging request
- [x] Open `https://mapping.geodirectory.ie/` in an automated browser session
- [x] Inspect visible page state, network/script state, frames, and console errors relevant to CAPTCHA loading
- [x] Identify whether this is user-side blocking, third-party CAPTCHA failure, or site-side integration failure
- [x] Report practical fixes and evidence
  - Review:
    - The automated browser reproduced the issue: the CAPTCHA panel appears, but the image at `https://mapping.geodirectory.ie/captcha` is broken.
    - The page uses a custom image CAPTCHA, not Google reCAPTCHA. The relevant DOM is `#captcha-image` with `src="https://mapping.geodirectory.ie/captcha"`.
    - The image element reports `complete: true`, `naturalWidth: 0`, and `naturalHeight: 0`, which means the browser attempted to load it but did not receive a valid image.
    - Opening `https://mapping.geodirectory.ie/captcha` directly in the automated browser returns `504 Gateway Time-out` from `Microsoft-Azure-Application-Gateway/v2`.
    - No reCAPTCHA iframe or `window.grecaptcha` object is present. The only console warning observed was an unrelated Google Maps async-loading warning.
  - Verification:
    - Automated browser screenshot showed the map and CAPTCHA input/Validate button with a broken image icon above the input.
    - Direct `/captcha` endpoint screenshot and DOM showed `504 Gateway Time-out`.

Implement /test visual, accessibility, preference, diagnostics, and production-doc polish
- [x] Record the implementation request and scope
- [x] Inspect current `/test` shell, diagnostics, preferences, docs, and browser tests
  - Reviewed the existing test shell, diagnostics renderer, preference state, service-worker cache flow, and Playwright coverage before editing.
- [x] Improve pixel-level visual matching with the main site
  - Tightened the `/test` header, nav, sidebar, panel, catalogue-card, button, and spacing rhythm to better match the current main shell while keeping MapLibre-specific controls.
- [x] Add accessibility depth, ARIA tuning, and axe-style checks where feasible
  - Added map instructions, menu roles/current states, source filter labelling, dialog/control checks, duplicate-id/button/form-label checks, reduced-motion checks, and mobile-only touch-target smoke warnings.
- [x] Add edge-case browser tests for clipboard failure, collapsed-panel URL restore, reduced motion, and service-worker/cache status
  - Added Playwright coverage for failed clipboard writes, import/export/reset preferences, collapsed panel hash restore, reduced-motion behaviour, service-worker cache reporting, and device defaults.
- [x] Add preference import/export/reset polish, per-device defaults, and clearer reset buttons
  - Added a Preferences panel with export, import, reset, device-default actions, schema metadata, allowed-key filtering, and status messaging.
- [x] Improve diagnostics/readiness/deploy checklist UI and warning explanations
  - Added friendlier readiness text, accessibility smoke status, service-worker cache status, deploy checklist UI, and explicit warning explanations.
- [x] Add production docs for rollback, cutover PR checklist, and CDN cache invalidation
  - Added `test/metadata/rollback-runbook.md`, `test/metadata/cutover-pr-checklist.md`, and `test/metadata/cdn-cache-invalidation-procedure.md`, and linked them from the promotion checklist.
- [x] Verify and report outcome
  - `node --check test/src/app.js`, `node --check test/src/diagnostics.js`, and `node --check tests/browser/test-app.spec.js` passed.
  - `npm run check:test` passed with known warnings for `roi-small-areas-2011-vector-test`, `roi-townlands-vector-test`, and local-only PMTiles fallbacks.
  - `npm run build:test` passed after rerunning outside the sandbox because esbuild hit sandbox `spawn EPERM`.
  - `npm run test:browser:test` passed: 14 tests.
  - `npm run check` passed for main chunked-bound guardrails.

Review remaining /test implementation and parity work after visual/accessibility polish
- [x] Record the review request
- [x] Inspect current `/test` metadata, port-plan counts, diagnostics reports, docs, and guardrails
- [x] Separate feasible remaining work into blocked-on-data and not-blocked-on-data
- [x] Identify work that is not feasible or not sensible to port literally from Leaflet to MapLibre
- [x] Report findings inline in chat
  - Review:
    - Current `/test` metadata has 123 MapLibre-rendered layers: 18 PMTiles vector layers and 105 image layers.
    - The 18 PMTiles layers have feature indexes and label configuration. There are still 0 time-series chains and 0 election catalogues wired as converted MapLibre workflows.
    - The main-site port plan still tracks 901 source rows: 138 converted, 611 needing vector-tile conversion, and 152 metadata-only.
    - Existing reports show no hard errors, but warning-only findings remain for large `roi-small-areas-2011-vector-test` and `roi-townlands-vector-test` tiles, plus local-only PMTiles directory fallbacks disabled off localhost.
    - Remaining non-data-blocked work is mostly incremental polish, stronger automated checks, deployment monitoring, and final shell/catalogue parity refinements.
    - Remaining blocked-on-data work is conversion coverage, generated search/index metadata, time-series/election workflows, richer per-layer field aliases, and heavy-layer tile regeneration.

Execute final non-data-blocked /test hardening pass
- [x] Record the implementation request and scope
- [x] Inspect current `/test` shell, diagnostics, preferences, controls, source UX, CI, docs, and tests
  - Reviewed the current test shell, diagnostics renderer, active-layer controls, source panel, telemetry, workflow, package scripts, and browser tests before editing.
- [x] Add repeatable visual regression, mobile performance, security, production-route, and CDN monitoring guardrails
  - Added `scripts/test-static-server.mjs`, `scripts/visual-regression-test-shell.mjs`, `scripts/validate-test-mobile-performance.mjs`, `scripts/validate-test-security.mjs`, and `scripts/validate-test-production-route.mjs`.
  - Added npm scripts for `test:visual:test`, `test:performance:test`, `monitor:test:cdn`, `check:test:security`-equivalent coverage through `check:test`, and `check:test:ci-safe`.
  - Updated `.github/workflows/test-readiness.yml` to run CI-safe checks, browser tests, visual checks, mobile smoke/performance checks, and scheduled CDN byte-range monitoring.
- [x] Add real axe-core browser coverage plus deeper accessibility/runtime tests
  - Installed `@axe-core/playwright` and `axe-core`.
  - Added an axe-core Playwright scan to the `/test` accessibility smoke test and fixed the issues it exposed: readiness meter ARIA and MapLibre attribution link distinction.
  - Kept screen-reader status announcements and focus trapping in the runtime.
- [x] Improve preference profiles, reset sections, diagnostics filtering/history/export, and source/control UX
  - Added preference profile save/apply controls, section reset controls for shell/catalogue/layers, diagnostics type filtering, diagnostics history, clear-history action, screen-reader status region, and drag/drop active-layer reordering.
  - Routed source-panel and active-layer copy actions through the guarded clipboard helper.
- [x] Strengthen CI/scheduled checks and production-readiness documentation
  - Added `test/metadata/security-dependency-review.md` and `test/metadata/production-observability.md`, and linked them from the promotion checklist.
  - Added generated reports for security, production-route rehearsal, visual shell parity, mobile performance, and mobile smoke.
  - Ran `npm audit --json`; applied a `protocol-buffers-schema` override to clear the moderate transitive advisory. The remaining finding is `xlsx` high severity with no npm-audit fix available, documented for release review rather than auto-fixed.
- [x] Verify with syntax checks, `/test` checks, build, browser suite, and main guardrails
  - `node --check` passed for changed `/test` modules, browser tests, and new validation scripts.
  - `npm run check:test` passed with the known warning-only tile/CDN findings.
  - `npm run build:test` passed after rerunning outside the sandbox because esbuild hit the known `spawn EPERM`.
  - `npm run test:browser:test` passed: 14 tests, including real axe-core coverage.
  - `npm run test:visual:test` passed and wrote shell screenshots/reports.
  - `npm run test:performance:test` passed: mobile boot 274ms; representative layer frame rates 61/43/47fps.
  - `npm run smoke:test:mobile` passed across all 18 PMTiles layers.
  - `npm run check` passed for main chunked-bound guardrails.
- [x] Report what changed and what remains data-blocked

Review remaining /test implementation after final hardening
- [x] Record the review request
- [x] Inspect current `/test` metadata, generated reports, package scripts, and task log
- [x] Separate remaining feasible work into blocked-on-data and not-blocked-on-data
- [x] Identify work that is not feasible or not sensible to port literally from Leaflet to MapLibre
- [x] Report findings inline in chat
  - Review:
    - Current `/test` metadata remains 123 MapLibre-rendered layers: 18 PMTiles vector layers and 105 image layers.
    - All 18 PMTiles layers have feature indexes and label configuration. There are still 0 converted time-series chains and 0 converted election catalogues.
    - The main-site port plan remains 901 rows: 138 converted, 611 needing vector-tile conversion, and 152 metadata-only.
    - Non-data guardrails are now broad: `check:test`, CI-safe checks, CDN monitor command, browser tests with axe-core, visual shell snapshots, mobile performance checks, all-layer mobile smoke, security checks, production-route checks, and promotion/rollback/cache docs.
    - Remaining non-data-blocked work is now small: resolve or replace `xlsx`, run live CDN/production checks after deployment, optionally tune visual/polish details from human review, and decide whether visual snapshot PNG artifacts should be committed or generated-only.
    - Remaining data-blocked work is the main gap: full conversion coverage, generated indexes/aliases, time-series chains, election workflows, raster/georeference decisions, and heavy-layer retile tuning.

Focused /test shell visual parity pass
- [x] Record the implementation request and scope
- [x] Inspect main/test navbar and catalogue-pane styling
- [x] Apply focused `/test` navbar and catalogue visual parity changes
- [x] Verify with `/test` checks, build, browser tests, and visual regression
- [x] Report remaining limits
  - Review:
    - Aligned the `/test` shell header to the main site's 64px header height, teal gradient treatment, brand sizing, nav spacing, button sizing, and mobile-menu placement.
    - Tightened the left catalogue pane's panel padding, group spacing, catalogue-card treatment, dense-mode spacing, status backgrounds, and action button rhythm so it is closer to the main catalogue without changing MapLibre-specific workflows.
    - Kept the `/test` sidebar width at 390px because the MapLibre test shell carries additional controls, diagnostics, source panels, and converted/unconverted entries; forcing the main site's wider split-pane proportions would reduce the map unnecessarily.
  - Verification:
    - `npm run check:test` passed. Known warning-only findings remain for `roi-small-areas-2011-vector-test`, `roi-townlands-vector-test`, and local-only PMTiles fallbacks.
    - Approved `npm run build:test` passed after the sandboxed run hit the known esbuild `spawn EPERM`.
    - Approved `npm run test:browser:test` passed all 14 browser tests.
    - Approved `npm run test:visual:test` passed. The visual report now shows main header 64px and `/test` header 64px, with matching header background and brand geometry.
    - `npm run check` passed the main chunked-map guardrails.

Align /test catalogue shell and pane with main site
- [x] Record the implementation request and scope
- [x] Inspect current `/test` catalogue structure, controller, and styles
- [x] Put search and compact catalogue navigation into one main-style top catalogue shell
- [x] Make the default catalogue hierarchy and cards closer to main C1/C2 browsing while preserving unconverted entries
- [x] Keep thumbnails constrained or absent to avoid mobile request churn
- [x] Keep MapLibre-specific panels visually secondary to the core catalogue flow
- [x] Verify with `/test` checks, build, browser tests, visual regression, and main guardrails
- [x] Report what changed and what remains
  - Review:
    - Moved `/test` search and catalogue history/back/forward/home controls into a single sticky catalogue shell at the top of the left pane, matching the main site's search-plus-compact-nav pattern.
    - Converted the catalogue nav buttons to compact icon buttons with accessible labels, and added a constrained clear-search button inside the search field.
    - Reworked the default catalogue renderer toward main-style C1/C2 grouping: teal group headers, nested category section headers, and row-like catalogue entries using `class-member` naming while preserving converted and not-yet-converted states.
    - Kept thumbnail loading absent in this pass; this avoids reintroducing the main site's old thumbnail request churn until thumbnail loading is manifest-gated and concurrency-limited.
    - Marked active layers, time series, feature details, sources, diagnostics, and preferences as visually secondary panels so the core catalogue remains the primary left-pane workflow.
    - Adjusted the desktop `/test` pane width to `clamp(390px, 32vw, 460px)`, which moves it closer to the main split pane on desktop while preserving more map space than the current main 50/50 split.
  - Verification:
    - `node --check test/src/catalogue-controller.js` and `node --check test/src/dom.js` passed.
    - `npm run check:test` passed. Known warning-only findings remain for `roi-small-areas-2011-vector-test`, `roi-townlands-vector-test`, and local-only PMTiles fallbacks.
    - Approved `npm run build:test` passed after the sandboxed run hit the known esbuild `spawn EPERM`.
    - Approved `npm run test:browser:test` passed all 14 browser tests.
    - Approved `npm run test:visual:test` passed. The visual report shows main header 64px, `/test` header 64px, `/test` catalogue width 437px, and map area 929x704px at 1366x768.
    - `npm run check` passed the main chunked-map guardrails.

Complete remaining /test2 data coverage
- [x] Record the implementation request and scope
- [x] Identify the remaining unconverted/load-blocked catalogue entries and classify by source availability
- [x] Fix `roi-counties-2011` if a valid replacement/source geometry can be found without deleting existing data
- [x] Convert/promote every feasible remaining vector/raster source into the `/test`/`/test2` MapLibre metadata path
- [x] Regenerate feature indexes, CDN manifests, and build outputs
- [x] Upload and byte-range verify PMTiles where CDN deployment is required
- [x] Run `/test` and `/test2` validation, build, and representative/mobile smoke checks
- [ ] Commit and push the completed data-coverage pass
  - Review:
    - Fixed `roi-counties-2011` by preferring the valid local FlatGeobuf source `data/maps/baronies-parishes/ROI_Counties_2011.fgb` over the invalid local GeoJSON source, then regenerated MVT, built PMTiles, uploaded it to R2/CDN, verified byte-range serving, switched metadata to the CDN PMTiles URL, and generated its feature-search index.
    - Promoted hosted raster-tile sources such as `copernicus-dem-30m-ireland` as MapLibre raster layers instead of leaving them as source-mapping blockers.
    - Made promotion idempotent and composite-aware: duplicate generated layer IDs are removed, raster promotions are included in the port-plan sync, and fully converted group/variant parents now count as `convertedComposite`.
    - Updated the stale `roi-counties-2011` quarantine guardrails so they now require the resolved PMTiles/CDN layer from the valid FGB source instead of permanently banning the map.
    - Current port-plan totals: 901 rows; 762 converted/loadable rows; 749 direct conversions; 13 composite parent conversions; 0 vector-conversion blockers; 0 MapLibre source-mapping blockers; 139 metadata-only rows with no direct source file recorded.
    - Remaining metadata-only rows are not code blockers and cannot be honestly converted from the current repository metadata because they have no direct geometry/raster source recorded. They are concentrated in Elections and Government, Built Environment, Physical Geography, and Public Services catalogue placeholders/raw metadata entries.
  - Verification:
    - `npm run build:test:pmtiles -- --ids roi-counties-2011-vector-test --force` passed outside the sandbox using GDAL.
    - `npm run deploy:test:pmtiles -- --ids roi-counties-2011-vector-test` uploaded the new PMTiles archive.
    - `npm run verify:test:pmtiles-cdn` passed for all 588 active PMTiles assets.
    - `npm run switch:test:pmtiles-cdn` switched all active PMTiles metadata to CDN URLs.
    - `npm run build:test:feature-indexes -- --ids roi-counties-2011-vector-test` built 26 searchable features.
    - `npm run check:test`, `npm run check:test2`, and `npm run check` passed.
    - `npm run build:test` and `npm run build:test2` passed outside the sandbox after esbuild hit the known sandbox `spawn EPERM`.
    - `TEST_SMOKE_LAYER_IDS=roi-counties-2011-vector-test npm run smoke:test:mobile` passed: 1244ms, 173 rendered features.
    - `npm run test:browser:test2`, `npm run test:visual:test2`, and `npm run test:performance:test2` passed.

Review remaining metadata-only alias rows
- [x] Record the review request and scope
- [x] Identify metadata-only rows whose descriptions say they reuse another map's boundaries
- [x] Check whether each referenced boundary map is already converted/loadable in `/test` and `/test2`
- [x] Determine where alias wiring should be implemented and which rows should remain true placeholders
- [x] Report findings inline in chat
  - Review:
    - Found 13 remaining metadata-only rows with formal `cloneOf` mappings in `data/database/maps.json`.
    - Every `cloneOf` target already has an active converted PMTiles layer in `/test/metadata/maps-test.json`.
    - These should be wired as converted alias layers during metadata promotion/generation, not by duplicating geometry or hardcoding runtime special cases.
    - The remaining explicit placeholder rows without `cloneOf`, source files, or same-boundary descriptions should stay metadata-only until source geometry or a verified alias target is added to `data/database/maps.json`.

Implement cloneOf alias layer wiring
- [x] Record the implementation request and scope
- [x] Preserve main-site `cloneOf` metadata in the `/test` port plan
- [x] Generate first-class `/test` alias layers for clone rows whose target layer is already converted/loadable
- [x] Regenerate metadata, CDN reports, and build outputs
- [x] Verify `/test` and `/test2` checks still pass
- [x] Commit and push the alias-layer implementation
  - Review:
    - Added deterministic `cloneOf`/`aliasOf` support to the metadata plan and promotion pipeline, so explicit same-boundary catalogue rows become first-class loadable `/test` and `/test2` MapLibre entries without duplicating geometry.
    - Promoted 59 explicit alias layers: 7 devolved-constituency aliases, 1 census/statistical alias, 5 referendum aliases, and 46 historic-boundary/admin-area date aliases.
    - Alias layers reuse the target layer's PMTiles/CDN source, source layer, fallback, bounds, feature schema, and MapLibre source mechanics while keeping the alias row's catalogue name, date, category, provider, credits, references, keywords, and status metadata.
    - Kept physical PMTiles deployment disciplined: alias rows are skipped by PMTiles generation, feature-index generation, and CDN upload-manifest generation because they intentionally reuse target archives.
    - Added validation guardrails requiring alias layers to point at real loadable targets and requiring local duplicate alias archives to remain excluded from the CDN manifest.
    - Current port-plan totals: 901 rows; 774 converted/loadable rows; 702 direct conversions; 13 composite parent conversions; 59 alias conversions; 126 metadata-only rows; 0 MapLibre source-mapping blockers.
    - The one remaining vector-conversion row is the old `civil-parishes` variant source; the active catalogue workflow already uses the converted unified `civil-parishes-by-province` layer.
  - Verification:
    - `npm run build:test:metadata` passed and regenerated the port plan.
    - `npm run build:test:promote` passed: 1 vector layer, 106 raster layers, and 59 alias layers promoted.
    - `npm run build:test:cdn-manifest` passed and generated 542 physical PMTiles upload targets, excluding alias duplicates.
    - `npm run switch:test:pmtiles-cdn` passed and switched 542 physical PMTiles layers to CDN URLs while preserving alias reuse.
    - `npm run verify:test:pmtiles-cdn` passed for all 542 physical PMTiles assets.
    - `npm run check:test` passed. Known warning-only finding remains for the local dev fallback directory for resolved `roi-counties-2011`.
    - `npm run check:test2` passed.
    - `npm run check` passed the main chunked-map guardrails.
    - `npm run build:test` and `npm run build:test2` passed outside the sandbox after the sandboxed esbuild runs hit the known `spawn EPERM`.
    - `npm run test:browser:test2` passed: 11 tests.

Fix Settlements 2015 labels and feature interaction
- [x] Record the bug report and scope
- [x] Inspect Settlements 2015 MapLibre metadata, generated tiles, feature ids, and label fields
- [x] Determine whether the same missing-label/non-interactive pattern affects other converted layers
- [x] Patch metadata generation/runtime guardrails so affected layers become labelable, hoverable, and clickable
- [x] Regenerate metadata/build outputs and verify `/test2`
- [x] Commit and push the fix
  - Symptom:
    - `Settlements 2015` rendered geometry on `/test2`, but feature labels were absent and features could not be hovered or selected.
  - Root cause:
    - The vector-tile metadata had a usable unique `Code` field and `Name` labels, but the promoted `/test` metadata lacked `promoteId`/`idProperty`. The MapLibre interaction path depends on a stable feature id for DOM labels, hover feature-state, and selection.
  - Permanent prevention action:
    - Extended `scripts/promote-test-converted-layers.mjs` to infer stable ids from tile metadata/tilestats for both newly promoted and pre-existing vector layers. The inference prefers explicit id/code/object id fields, then unique label fields, then other unique non-geometry fields.
    - Added a `/test2` browser regression for `Settlements 2015` that checks `Code` promotion, visible DOM labels, hover styling, and non-empty feature details.
  - Broader review:
    - Before the fix, 314 labelable vector layers lacked configured stable ids. Regenerating metadata now enriches affected layers where tile metadata exposes a safe unique field, including `settlements-2015`.
    - 118 labelable vector layers still lack an inferable stable id from local tile metadata. Those remain potential risk only where their tiles also lack embedded feature ids; they need source-specific ids or regenerated tiles with ids if they show the same behaviour.
  - Verification:
    - `npm run build:test:metadata` passed.
    - `npm run build:test:promote` passed and assigned `settlements-2015-vector-test` `promoteId: Code`, `idProperty: Code`, and `labelProperty: Name`.
    - `npm run switch:test:pmtiles-cdn` passed.
    - `npm run check:test` passed with only the existing local dev fallback warning for resolved `roi-counties-2011`.
    - `npm run check:test2` passed.
    - `npm run check` passed.
    - `npm run build:test` passed.
    - `npm run build:test2` passed.
    - `npm run test:browser:test2` passed: 12 tests, including the new `Settlements 2015` label/hover/detail regression.

Review whether Settlements 2015 identity issue affects other maps
- [x] Record the follow-up scope
- [x] Scan converted MapLibre layers for missing stable feature identity
- [x] Sample local vector tiles where available to confirm embedded feature ids or missing ids
- [x] Report confirmed affected maps versus residual risk
  - Review:
    - After the Settlements 2015 fix, 118 labelable MapLibre vector layers still lacked explicit `promoteId`/`idProperty` in `/test/metadata/maps-test.json`.
    - A headless `/test2` probe loaded those 118 at-risk layers. It confirmed 103 rendered visible features with no usable feature ids and no DOM labels, so they would have the same label/hover/click failure mode.
    - 15 at-risk layers rendered no sampled features in the probe, so they remain inconclusive rather than confirmed working or confirmed broken.
    - The fix class should be generalized further by assigning source-specific ids where available or regenerating those MVT/PMTiles outputs with stable generated feature ids.


Continue fixing missing labels/hover/click on no-id MapLibre layers
- [x] Record the implementation scope
- [x] Inspect current MapLibre identity, hover, select, and label implementation
- [x] Implement stable fallback feature keys for layers without embedded or promoted ids
- [x] Add browser regression for a confirmed affected non-Settlements layer
- [x] Run builds/checks/browser verification
- [x] Commit and push the scoped fix
  - Symptom:
    - Converted `/test2` MapLibre layers whose vector tiles had no embedded feature ids and whose metadata had no safe `promoteId` could render geometry but fail DOM labels, hover feedback, and feature-card selection.
  - Root cause:
    - The shared MapLibre interaction path used feature ids as the key for labels, hover state, and selection. When neither MapLibre feature ids nor promoted property ids existed, those runtime paths had no stable key to attach to.
  - Permanent prevention action:
    - Added runtime-generated feature identities based on label properties, selected stable properties, and a rounded geometry signature.
    - Added GeoJSON hover/selected overlay sources for every vector layer, so generated-id features can still receive Leaflet-like orange hover/selection highlighting even when MapLibre feature-state is unavailable.
    - Preserved the existing feature-state path for layers with real/promoted ids, so id-backed layers keep the lower-cost native interaction behavior.
    - Added a `/test2` browser regression for `place-names-gazetteer`, a confirmed no-id layer, checking labels, hover overlay, and non-empty feature details.
  - Verification:
    - `node --check test/src/map-controller.js` passed.
    - `node --check tests/browser/test2-app.spec.js` passed.
    - `npm run build:test2` passed.
    - `npm run build:test` passed.
    - `npm run check:test` passed with only the existing warning-class local fallback finding.
    - `npm run check:test2` passed.
    - `npm run check` passed.
    - `npm run test:browser:test2` passed: 13 tests, including the new no-id layer regression.
    - A broad custom all-layer probe was attempted, but the full sweep exceeded the practical browser-probe timeout; the maintained browser regression now verifies the generalized public interaction path against a representative confirmed affected layer.

Add election entries to /test2
- [x] Record the implementation request and scope
- [x] Generate a /test2 election catalogue manifest from `election-viewer-package/data/elections`
- [x] Generate a geography crosswalk from election entry names to converted MapLibre layers
- [x] Report unmatched election entries before promotion
- [x] Add /test2 election browsing in the left catalogue
- [x] Add MapLibre election styling modes for winner, leading party, vote share, turnout, majority, seats, and quota where data supports them
- [x] Merge election result JSON into selected feature details
- [x] Keep election result JSON lazy-loaded or bundled per election date
- [x] Run verification and document residual unmatched/data limitations
  - Implemented:
    - Added `scripts/build-test2-election-manifest.mjs` to generate `test/metadata/elections-test2.json`, per-election lazy bundles in `test/metadata/elections-test2/`, and `test/metadata/elections-test2-report.json`.
    - Added geography mapping from election bodies/dates to converted MapLibre layers, including Westminster, Assembly aliases, Stormont, Dail, Irish presidential/referendum/European Parliament, and NI local-government DEA layers.
    - Wired `/test2` election catalogue callbacks through `Test2ElectionManager`, so generated election rows appear in the existing left catalogue and load via the main shell.
    - Added MapLibre election styling for winner, leading party, vote share, turnout, majority, seats, and quota where each bundle has supporting data.
    - Added selected-feature enrichment so the main feature card shows active election fields such as Election, Winning party, Leading party, Vote share, Turnout, Majority, Seats, Quota, and Valid poll.
    - Kept the top-level manifest small and lazy-loads only the selected election's bundle.
  - Generated coverage:
    - 548 election catalogue entries.
    - 489 loadable entries.
    - 59 placeholder entries where geography/result matching is not sufficient yet.
    - 3,467 matched constituency results.
    - 1,217 unmatched constituency results listed in `test/metadata/elections-test2-report.json`.
  - Verification:
    - `node --check scripts/build-test2-election-manifest.mjs` passed.
    - `node --check test2/src/election-manager.js` passed.
    - `node --check test2/src/app.js` passed.
    - `node --check test2/src/maplibre-main-adapter.js` passed.
    - `node --check scripts/validate-test2-route.mjs` passed.
    - `node --check tests/browser/test2-app.spec.js` passed.
    - `npm run build:test2` passed after sandbox escalation for esbuild spawn.
    - `npm run check:test2` passed.
    - `npm run test:browser:test2` passed after sandbox escalation for Chromium/server spawn: 14 tests.
    - `npm run check` passed.


# /test2 election-layer parity review and local-election grouping
- [x] Record scope and relevant guardrails
  - Exhaustively compare main-site and `/test2` election layers around seat circles, feature labels, map interaction, and election pane structure.
  - Implement local-election catalogue grouping so all-NI and all-ROI local elections appear as one election event rather than one row per council.
  - Preserve main-site catalogue contract and keep MapLibre drawing in `/test2` engine-specific code.
- [x] Audit main-site election implementation
  - Review election geometry matching, labels, seat circles/vote overlays, result pane structure, local-government grouping, URL/timeline behaviour, and entity/count views.
- [x] Audit `/test2` election implementation
  - Review generated manifest/bundles, MapLibre election manager, seat-circle anchors, DOM labels, feature result selection, and election pane rendering.
- [x] Implement grouped local-election catalogue events
  - Generate grouped parent local-election events for NI/ROI-wide local elections and keep council-level bundles as child/selectable detail data where needed.
  - Ensure catalogue browsing lists one event per jurisdiction/date while preserving per-council results and map interaction.
- [x] Add guardrails and verification
  - Add static checks or browser checks preventing council-level local elections from reappearing as separate catalogue events for the same jurisdiction/date.
  - Rebuild `/test2` metadata and app bundles, then run route checks and relevant tests.
- [x] Review
  - Summarize implemented grouping and remaining parity gaps, distinguishing code-feasible work from data-blocked work.

## Review
- Main-site finding:
  - The Leaflet election controller groups ordinary NI local-government elections by date into one "Northern Ireland local election" catalogue entry, then loads all council DEA result files through the shared `local-government` source path.
  - Main uses Leaflet vector layers for election geography, suppresses labels underneath the election layer, adds seat-circle/vote-bar overlays through a Leaflet overlay group, and renders the production below-map `#electionResultsPane` with overall, council, DEA, party, candidate, count, entity, and animation views.
- `/test2` finding:
  - `/test2` already used the production shell and below-map pane, shared election-domain summary helpers, MapLibre style expressions, generated anchor sidecars, DOM labels, MapLibre feature enrichment, seat circles, vote bars, local-party views, count views, entity pages, URL election substate, and timeline wiring.
  - The main parity drift fixed here was catalogue/data shape: generated `/test2` entries listed NI local elections once per council/date, so the catalogue and timeline treated one all-NI election as many council elections.
- Implemented:
  - `scripts/build-test2-election-manifest.mjs` now groups multi-council local-government dates into one synthetic `Local Government Districts` entry, while preserving a per-constituency council lookup for matching old DEA source names.
  - General local-election entries now carry `displayTitle`, `displayProvider`, `localBodies`, and per-result `localBody` metadata.
  - `/test2` election rendering now uses the grouped title and exposes a council-level view for grouped local elections.
  - Single-council local by-elections remain separate entries.
  - Generated manifest changed from 548 total elections / 294 local-government entries to 268 total elections / 14 local-government entries, while matched/unmatched constituency totals stayed stable at 3,957 matched and 727 unmatched.
- Verification:
  - `node --check scripts/build-test2-election-manifest.mjs` passed.
  - `node --check test2/src/election-manager.js` passed.
  - `node --check tests/browser/test2-app.spec.js` passed.
  - `npm run build:test2:elections` passed.
  - `npm run build:test2` passed after approved sandbox escalation for esbuild spawning.
  - `npm run check:test2` passed.
  - `npm run test:browser:test2` passed after approved sandbox escalation: 20/20 tests.
  - `npm run build` passed after approved sandbox escalation for esbuild spawning.
  - `npm run check` passed.

# /test2 election remaining parity gap closure
- [x] Record scope and implementation plan
  - Close remaining non-data election-layer parity gaps after the grouped local-election commit/push.
  - Keep data-blocked unmatched geography work reported rather than hiding it.
  - Preserve MapLibre-specific drawing boundaries while improving user-facing parity.
- [x] Improve election URL/substate parity
  - Preserve and restore entity pages, selected result, local mode, count detail, style mode, and overlay mode.
- [x] Improve local-government pane parity
  - Show grouped local-election council context clearly in selected DEA titles and tables.
  - Add previous-election deltas to council/local-government summaries where prior grouped local data exists.
- [x] Add guardrails
  - Extend static and browser checks for entity URL state, local/council deltas, and grouped local state.
- [x] Verify and document result

## Review
- Implemented:
  - `/test2` election URL state now includes entity-page state (`electionEntityKind`, `electionEntityKey`, `electionEntityReturnView`) and restores entity pages after reload/share.
  - Grouped NI local-election selected DEA titles and stats now include council context.
  - Grouped local council summaries now include seat, valid-vote, and turnout deltas where a previous grouped local-election bundle exists.
  - Local-party tables now include seat, first-preference, and share deltas where the prior result has a matching party/DEA row.
  - Added static and browser guardrails covering URL entity state and local-government delta columns.
- Verification:
  - `node --check test2/src/election-manager.js` passed.
  - `node --check test2/src/app.js` passed.
  - `node --check scripts/validate-test2-route.mjs` passed.
  - `node --check tests/browser/test2-app.spec.js` passed.
  - `npm run build:test2` passed after approved sandbox escalation for esbuild spawning.
  - `npm run check:test2` passed.
  - `npm run check` passed.
  - `npm run test:browser:test2` passed after approved sandbox escalation: 20/20 tests.
  - `npm run build` passed after approved sandbox escalation for esbuild spawning.
- Remaining gaps:
  - The generated unmatched report still classifies all remaining unmatched election rows as blocked on data, blocked on boundary aggregation, or source-data cleanup; no currently feasible unmatched geography remains unclassified.
  - Exact Leaflet overlay pixel placement is intentionally not copied; `/test2` uses MapLibre-native seat/vote overlays with collision suppression and verified click/feature integration.

# /test2 election state, catalogue, map, and pane parity pass
- [x] Record scope
  - User request: amend `/test2` so election URL IDs, catalogue state, election pane state/aggregation/order, map labels/hover/seat circles, and map controls align with main as far as feasible and sensible.
  - Main runtime files remain read-only reference for this pass; implement alignment in `/test2`, generated `/test2` assets, validation, and tests only.
- [x] Inspect current divergence
  - Compare canonical election IDs, catalogue active state, result-pane selected/overall state, party sorting/aggregation, label layers, seat-circle placement, and controls.
- [x] Implement `/test2` parity fixes
  - Fix main election ID aliases and URL state.
  - Open the catalogue in the same active election state as main.
  - Align result-pane overall/selected feature state and party ordering/aggregation where data permits.
  - Tighten table CSS/template parity.
  - Align MapLibre labels, hover/selection style, seat-circle offsets/collision, and controls with main where sensible.
- [x] Add guardrails
  - Extend static/browser checks for URL/state mapping, catalogue active state, pane table ordering, controls, labels, and overlays.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and browser tests.
- [x] Review
  - Summarize implemented fixes and remaining data/MapLibre-specific limits.
  - Result: `/test2` now writes main-style canonical `election-...` layer IDs into URL state, restores elections from those IDs, focuses the active decade catalogue row, keeps selected-area “By Party” in a main-style party table, uses white-stroked seat circles, and restyles MapLibre zoom controls to read closer to Leaflet controls.
  - Verification: `npm run check:test2`, `npm run build:test2`, and `npm run test:browser -- tests/browser/test2-app.spec.js` all passed after the changes.
  - Remaining limits: exact Leaflet DOM overlay placement cannot be copied directly because `/test2` is MapLibre; current seat-circle placement remains MapLibre-native with generated anchors and collision suppression.

# /test2 mobile hover cleanup and seat-circle parity
- [x] Record scope and recurring defect
  - Mobile transient hover/label/feature UI must clear when the user taps empty map space rather than only when another feature/entry is tapped.
  - Seat-circle placement/count visibility must follow the main site's election overlay logic more closely.
  - Add a guardrail so the same interaction and overlay drift does not recur.
- [x] Inspect main/test2 implementations
  - Compare main Leaflet click/hover cleanup and election seat-circle rendering to `/test2` MapLibre logic.
- [x] Implement fixes
  - Add centralized mobile empty-tap cleanup for stuck thumbnail previews and transient MapLibre hover state.
  - Align `/test2` seat-circle grouping/placement with the main election overlay semantics as far as feasible in MapLibre.
- [x] Verify
  - Run syntax checks, `/test2` route checks, browser tests, and relevant build checks.
- [x] Review
  - Added shared thumbnail outside-tap cleanup for mobile/stuck synthetic hover previews.
  - Added empty-map click hover cleanup to the MapLibre controller.
  - Changed `/test2` election seat circles to use the shared main-style seat-position algorithm, fixed 12px-equivalent MapLibre dots, white halo, black outline, and pixel-offset placement instead of geographic-degree offsets and zoom-scaled radii.
  - Added route/static checks and browser coverage for mobile thumbnail dismissal and seat-circle paint/halo/source generation.
  - Verification passed: `node --check` on edited JS files, `node scripts/validate-test2-route.mjs`, `npm run build:test2`, `npm run check:test2`, `npm run test:browser:test2` (21/21), `npm run build`, and `npm run check`.

# /test2 remaining feasible parity gap resolution
- [x] Record scope and recurring defect
  - Resolve remaining non-data `/test2` parity gaps where they are feasible and sensible.
  - Focus on election overlay/data parity where the report still marks an implementation-blocked residual.
  - Do not fabricate unavailable boundary data; keep genuinely data-blocked rows classified in the generated report.
- [x] Resolve implementation-blocked Forum regional-list gap
  - Add a synthetic Northern Ireland-wide anchor for the 1996 Forum regional/list result so it contributes to `/test2` election overlays and panes.
  - Remove the `blocked-on-implementation` residual from the generated unmatched report.
- [x] Improve election overlay placement parity
  - Preserve generated anchor bounds in election anchor sidecars.
  - Use anchor bounds for MapLibre overlay total-extent and greedy collision sorting, mirroring the main Leaflet bounds-based overlay logic more closely.
- [x] Add guardrails and regenerate outputs
  - Extend `/test2` route validation and browser tests to prevent regressions in synthetic regional result handling and bounds-aware overlay placement.
  - Regenerate `/test2` election metadata and build output.
- [x] Verify
  - Run syntax checks, route validation, `/test2` build/check/browser tests, and full build/check where needed.
- [x] Review
  - Summarize what was resolved and list only remaining data/architecture-blocked gaps.

## Review
- Implemented:
  - Generated election anchor sidecars now carry bounds as well as centres.
  - `/test2` election overlay collision now uses projected anchor bounds for the overall map extent and greedy placement order, instead of relying only on centre-point spread.
  - The 1996 Northern Ireland Forum regional/list row for `Northern Ireland` now gets a synthetic NI-wide anchor derived from the selected Forum/PC1995 layer bounds.
  - The `Wicklow Wexford3` source-result typo now maps safely to the `Wicklow-Wexford (3)` Dáil 2023 feature.
  - The generated report changed from 3,957 matched / 727 unmatched with one `blocked-on-implementation` residual to 3,959 matched / 725 unmatched and no implementation/data-cleanup residuals.
  - Added static route validation and browser coverage for synthetic regional results, bounded anchors, and zero feasible election residuals.
- Verification:
  - `node --check scripts/build-test2-election-manifest.mjs` passed.
  - `node --check test2/src/election-manager.js` passed.
  - `node --check scripts/validate-test2-route.mjs` passed.
  - `node --check tests/browser/test2-app.spec.js` passed.
  - `npm run build:test2:elections` passed.
  - `npm run build:test2` passed after approved sandbox escalation for esbuild spawning.
  - `npm run check:test2` passed.
  - `npm run test:browser:test2` passed after approved sandbox escalation: 21/21 tests.
  - `npm run build` passed after approved sandbox escalation for esbuild spawning.
  - `npm run check` passed.
- Remaining gaps:
  - 725 unmatched election rows remain classified as `blocked-on-data` or `blocked-on-aggregation`.
  - No `blocked-on-implementation`, `blocked-on-data-cleanup`, or unclassified feasible unmatched election geography remains in `test/metadata/elections-test2-report.json`.
  - Exact renderer identity with Leaflet remains intentionally impossible/senseless because `/test2` uses MapLibre vector/canvas rendering, but the overlay semantics now use the same seat positioning and bounds-aware placement concepts.

# /test2 election pane must align to main without editing main
- [x] Record scope
  - User correction: main must not be amended for parity work; `/test2` must align to the existing main site while continuing to use MapLibre instead of Leaflet.
  - Treat `js/election-controller.js` and other main runtime files as read-only reference for this pass.
  - Amend only `/test2`, generated `/test2` build artifacts, tests/validation, and task notes unless explicitly asked otherwise.
- [x] Inspect main election pane contract read-only
  - Compare title, tabs, party table grouping, summary rows, style controls, map controls, and catalogue state against `/test2`.
- [x] Patch `/test2` visible election pane toward main
  - Make `/test2` default pane use the main dense grouped table shape and title/tabs/order where data permits.
  - Move or de-emphasise MapLibre style controls so they do not replace the main pane contract.
- [x] Patch guardrails
  - Add tests/static checks that `/test2` uses main-style election table headers/classes and avoids simplified summary-first pane drift.
- [x] Verify
  - Run `/test2` static checks, bundle build, and browser smoke where available.
  - `node --check test2/src/election-manager.js` passed.
  - `node --check scripts/validate-test2-route.mjs` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved sandbox escalation for esbuild helper spawning.
  - `npm run test:browser:test2` passed after approved sandbox escalation for Playwright/browser worker spawning: 21/21 tests.
- [x] Review remaining gaps
  - Record exact remaining gaps as data-blocked, MapLibre-engine-specific, or still feasible.
  - Remaining gaps: candidate/local-party/count/entity panes are closer but not exhaustively cloned from main; exact pixel placement of MapLibre seat circles/labels still differs from Leaflet; data-blocked unmatched election geographies remain as reported in `test/metadata/elections-test2-report.json`.


# /test2 secondary election panes must align to main without editing main
- [x] Record scope
  - User request: candidate, local-party, count, and entity panes in `/test2` should match the main site as far as feasible and sensible.
  - Main remains read-only reference; do not amend production main runtime files.
  - Keep MapLibre drawing separate from election pane rendering.
- [x] Inspect current `/test2` secondary pane renderers
  - Identify where candidate, local-party, count, party entity, and candidate entity views still use simplified `/test2` tables.
- [x] Patch `/test2` secondary pane renderers
  - Use main-style classes, grouped headers, sticky-compatible wrappers, rank columns, delta formatting, summary/event rows, and entity-page structure where data permits.
- [x] Add guardrails
  - Static and browser tests should assert main-style classes/headers for secondary panes and no regression to simplified tables.
- [x] Verify
  - Run syntax checks, `/test2` validation, `/test2` build, and browser suite.
  - `node --check test2/src/election-manager.js` passed.
  - `node --check scripts/validate-test2-route.mjs` passed.
  - `node --check tests/browser/test2-app.spec.js` passed.
  - `npm run check:test2` passed.
  - `npm run build:test2` passed after approved sandbox escalation for esbuild helper spawning.
  - `npm run test:browser:test2` passed after approved sandbox escalation for Playwright/browser worker spawning: 21/21 tests.
- [x] Review remaining limits
  - Document any data-blocked or MapLibre-specific limits left after implementation.
  - Remaining limits: exact count/entity data completeness is constrained by what the generated `/test2` election bundles carry; MapLibre overlay placement remains renderer-specific rather than a Leaflet DOM clone.

# /test2 election parity contract refactor
- [x] Record scope
  - Treat main as the fixed reference implementation.
  - Mirror or reuse main election view-model generation in `/test2` to eliminate screenshot-visible drift.
  - Keep MapLibre-specific differences restricted to final drawing: polygons, DOM labels, hover/selection, and seat circles.
- [x] Inspect main/test2 contracts
  - Compare main election controller view-model construction, URL restore, catalogue active state, party table ordering/aggregation, feature label thresholds, and seat-circle placement against `/test2`.
- [x] Implement contract-level fixes
  - Make `/test2` use main-style normalized election pane data and table ordering/values for the active election.
  - Restore URL/catalogue/election state before any map fitting or MapLibre-specific framing.
  - Keep final MapLibre drawing as an adapter around the normalized election state.
- [x] Add side-by-side parity guardrails
  - Add tests for the exact Dáil 2024 comparison URL/state: active catalogue row, viewport/zoom, pane title, first rows/values, labels, and overlay presence.
  - Add assertions that `/test2` has not drifted into separate simplified election rendering for this path.
- [x] Verify
  - Run syntax checks, `/test2` validation, build, and browser tests.
  - `npm run build:test2:elections` passed.
  - `npm run build:test2` passed after approved sandbox escalation for esbuild helper spawning.
  - `npm run check:test2` passed.
  - Focused side-by-side Dail 2024 tests passed: `npm run test:browser -- tests/browser/test2-app.spec.js -g "Dail 2024 election pane matches|restores active Dail"`.
  - Full `/test2` browser suite passed after approved sandbox escalation: `npm run test:browser:test2` passed, 23/23 tests.
  - `npm run build` passed after approved sandbox escalation for esbuild helper spawning.
  - `npm run check` passed.
- [x] Review
  - Document what was aligned, what remains impossible/senseless because of MapLibre-vs-Leaflet rendering, and any genuinely data-blocked gaps.
  - Aligned: main-like Dail 2024 party order, candidate/seat/vote values, visible percentage/delta cells, active catalogue restore, and exact DOM rows for the screenshot state.
  - Remaining engine-specific limits: pixel-perfect Leaflet tile/DOM rendering cannot be identical in MapLibre, but the election pane contract now has a side-by-side regression test.
  - Remaining data-blocked limits: unmatched election geographies remain in `test/metadata/elections-test2-report.json` and are separate from this Dail 2024 view-model parity fix.
- [x] Recurring issue prevention
  - Symptom: `/test2` repeatedly looked close but still differed from main in election rows, percentages, catalogue restore, and screenshot comparisons.
  - Root cause: `/test2` used an independently cleaned-up election view-model instead of main's raw-controller election table contract; visual tweaks could not fix data-contract drift.
  - Permanent prevention action: generated `/test2` election bundles now carry `mainLikePartySummary` and `mainLikeTotals`; `/test2` renders the main-like table from those fields; validation asserts the Dail 2024 contract; browser tests compare main and `/test2` side by side for the exact Dail 2024 state.
  - Verification evidence: focused side-by-side Dail 2024 DOM parity test passed, full `/test2` browser suite passed 23/23, and production build/check passed.

# Improve Browse map detail layout and thumbnail quality
- [x] Record scope
  - User requested cleaner overview/metadata presentation on Browse map pages and proper-looking thumbnails for every map, with non-distorted cartographic projection and grey land context for Ireland/Britain/outlying areas/Europe.
- [x] Inspect current Browse and thumbnail pipeline
  - Review existing Browse renderer, generated map detail metadata, thumbnail manifest, and generation script.
- [x] Improve map detail presentation
  - Make map pages show a cleaner summary, status/metadata grid, grouped source/reference/downloads, and keep raw metadata secondary.
- [x] Improve thumbnail coverage and quality
  - Ensure every map Browse page renders a proper-looking map thumbnail: real manifest asset where available, upgraded generated asset pipeline where local geometry is available, and a cartographic fallback where geometry/assets are unavailable.
- [x] Verify
  - Run syntax checks, Browse generation, build, thumbnail coverage checks, and representative browser smoke tests.
- [x] Review
  - Document completed changes, verification evidence, and any remaining data/source limits.
  - Completed: Browse map pages now use a map-specific lead panel, compact definition-grid metadata, grouped source/reference/download sections, and secondary raw metadata.
  - Completed: map thumbnails now prefer real generated WebP assets; maps without a local/generated asset render a cartographic fallback SVG with grey land context and feature-like overlays instead of a text placeholder.
  - Completed: `scripts/regen-thumbnails.py` now resolves local data-host mirrors, compressed `.fgb.gz` sources, and LOD fallbacks before considering downloads.
  - Verification evidence: `node --check browse/browse.js` passed; `python -m py_compile scripts/regen-thumbnails.py` passed; `npm run build` passed after approved sandbox escalation for esbuild helper spawning; thumbnail manifest has 1,182 entries; Browse map coverage is 656 asset thumbnails and 165 runtime cartographic fallbacks.
  - Browser smoke note: the local static server returned HTTP 200 from the workspace shell, but the in-app browser loopback navigation stayed blocked/refused, so final visual verification used build/static checks rather than a browser screenshot.

# Correct Browse map thumbnails and map metadata presentation
- [x] Record correction
  - User showed that the Browse map thumbnail still appears sparse/transparent and the Overview/Metadata boxes still look raw and poorly spaced.
  - Correction goal: use a proper map-thumbnail projection with visible grey land context and clean up map Overview/Metadata presentation.
- [x] Fix thumbnail projection and underlay
  - Switched generated thumbnails to Web Mercator for a familiar web-map appearance.
  - Added minimum context spans so small/high-level maps do not crop grey land into misshapen fragments.
  - Made generated assets opaque and rerendered transparent/generated thumbnail assets where local geometry was available.
  - Added `assets/thumbnails/excluded-transparent.json` and manifest filtering so source-unavailable transparent assets use the Browse cartographic fallback instead of stale transparent WebPs.
- [x] Fix Browse map detail layout
  - Collapse thumbnail/overview/metadata into cleaner map-specific panels and avoid field grids that look like unstyled raw metadata.
  - Improve thumbnail sizing/caption treatment on map detail pages.
- [x] Verify
  - Run syntax checks, thumbnail generation for representative maps, Browse index/build checks, and thumbnail coverage checks.
- [x] Review
  - Document exactly what changed and any remaining limits.
  - Visual check: `assets/thumbnails/admin-areas-1924-04-01.webp` now shows the 1924 map over a broader recognizable grey Ireland/Britain land context rather than a cropped/misshapen underlay.
  - Manifest check: `assets/thumbnails/manifest.json` has 854 WebP entries and zero transparent non-60 thumbnails in the manifest; 168 source-unavailable transparent thumbnails are excluded and use runtime cartographic fallback.
  - Browse check: `admin-areas-1924-04-01` now references its own thumbnail asset, not the 1936 clone asset.
  - Verification evidence: `node --check browse/browse.js` passed; `node --check scripts/build-browse-indexes.mjs` passed; `python -m py_compile scripts/regen-thumbnails.py` passed; `npm run build` passed after approved esbuild spawn escalation; `npm run check` passed.

# Tighten Browse thumbnail framing and map info cards
- [x] Record correction
  - User showed that the corrected grey land underlay is now too zoomed out, leaving too much empty space around the map features.
  - User also challenged the sparse Overview and Metadata cards, which read as awkward raw fields rather than polished Browse information.
- [x] Fix thumbnail framing
  - Replace the hard 820 km context floor with adaptive context framing that retains grey land context without shrinking the target features excessively.
  - Regenerate representative affected thumbnails and update the manifest/Browse data as needed.
- [x] Fix Browse map information presentation
  - Make the map detail layout denser and clearer, with compact overview facts and metadata rows instead of sparse cards.
- [x] Verify
  - Run syntax checks, representative thumbnail inspection, Browse generation/build checks, and production build/check.
- [x] Review
  - Document changed files, verification evidence, and any remaining limits.
  - Completed: thumbnail framing now uses adaptive feature-footprint context instead of the previous hard 820 km context floor.
  - Completed: representative thumbnails were regenerated and visually inspected: `admin-areas-1924-04-01.webp` now has tighter NI feature framing with grey Britain/Ireland context; `counties-ireland-1927.webp` remains an all-island map with visible grey coastline context.
  - Completed: Browse map detail pages now use a compact map overview block and table-like metadata groups instead of sparse mini-cards.
  - Verification evidence: `node --check browse/browse.js` passed; `python -m py_compile scripts/regen-thumbnails.py` passed; `npm run build:browse` passed; `npm run build` passed after approved esbuild spawn escalation; `npm run check` passed; local static HTTP check returned 200.

# Fix residual empty space in Browse thumbnails
- [x] Record correction
  - User showed that `admin-areas-1924-04-01` still has too much empty land/sea around the actual features despite the adaptive context fix.
  - Correction goal: keep grey land context visible while making the target map features visually dominant at the displayed thumbnail size.
- [x] Implement feature-footprint framing
  - Add a tighter context profile for regional/historic administrative maps and an explicit minimum feature-footprint target.
- [x] Regenerate and inspect representative thumbnails
  - Regenerate `admin-areas-1924-04-01` and related thumbnail outputs, then inspect the actual image.
- [x] Verify
  - Run syntax checks and Browse/build checks that cover thumbnail generation.
- [x] Review
  - Document changed files, verification evidence, and any remaining limits.
  - Completed: `scripts/regen-thumbnails.py` now applies a specific regional administrative thumbnail profile with an explicit feature-footprint cap, reducing the representative viewport from about 619 km to about 439 km.
  - Completed: regenerated `assets/thumbnails/admin-areas-1924-04-01.png`, `.webp`, and `-60.webp`; visual inspection shows the NI boundaries now dominate the thumbnail while retaining grey Ireland/Britain context.
  - Verification evidence: `python -m py_compile scripts/regen-thumbnails.py` passed; `npm run build:browse` passed; generated Browse JSON churn was reverted; `npm run check` passed.

# Explain election-data corroboration sources
- [x] Record scope
  - User asked what the site's election data is corroborated against, including whether Wikipedia, ARK Elections on CAIN, or other sources are used.
- [x] Inspect source metadata
  - Review election manifests, generated Browse election/source records, raw result files, and scripts for source/corroboration references.
- [x] Summarize findings
  - Explain confirmed sources, likely source roles, and any limits in the current metadata.
  - Completed: confirmed source/corroboration evidence in `election-viewer-package`, Browse/test2 manifests, representative result JSON, and scripts including ARK/CAIN converters/comparators, Wikipedia scrapers/comparators, ElectionsIreland/Wayback scrapers, EONI archive/PDF scripts, and BKNI workbook comparison scripts.
  - Completed: final answer distinguishes embedded final `source_url` values from build/audit-only corroboration tooling, and notes that final result rows do not yet have uniform per-fact provenance.

# Check Browse election reference exposure
- [x] Record scope
  - User asked whether election entries and sub-entries have references indicating their sources in the same way many map Browse entries do.
- [x] Inspect generated Browse/source records
  - Checked `data/browse/elections.json`, `data/browse/details/elections/*.json`, `data/browse/sources.json`, `scripts/build-browse-indexes.mjs`, and representative `/test2` election bundles.
- [x] Summarize finding
  - Completed: election Browse entries generally expose generated result bundle URLs and anchor sidecar downloads, while map-style `references` arrays/public source citations are not currently propagated onto election entries or result sub-entries.
  - Completed: some raw/test2 election bundles contain `source_url` fields, but this is uneven and not surfaced consistently as Browse references.

# Explain feasibility of election entry references
- [x] Record scope
  - User asked whether specific references can be added for each election entry and sub-entry, including Wikipedia, ARK Elections/CAIN, and other source pages, with multiple sources where possible.
- [x] Assess reference model
  - Explain feasible data model, generation pipeline, source coverage, and limits.
- [x] Summarize implementation approach
  - Distinguish straightforward reference propagation from harder source-matching/corroboration work.
  - Completed: assessed that election references are feasible via a normalized source registry plus per-election/per-result `references` arrays, with automatic extraction from existing `source_url` fields and targeted generated links for Wikipedia, ElectionsIreland, ARK/CAIN, EONI, BKNI, and related audit sources.
  - Completed: noted that multiple-source citation is feasible for many NI and major election entries, but complete per-sub-entry coverage requires source matching and manual review for older or unevenly sourced datasets.

# Implement election entry and result references
- [x] Record scope
  - User asked to implement election references in full after the feasibility assessment.
- [x] Add election reference generation
  - Added generated parent-election references for Wikipedia overview pages, corpus/source sites such as ElectionsIreland, ARK Elections/CAIN, and EONI, and summaries for per-result source pages.
  - Added result-level references for overall results and constituency/DEA result sub-entries, extracting existing raw `source_url` values where present and adding corroborating overview/source-corpus links.
- [x] Propagate references through Browse records
  - Parent election records, result sub-entry records, detail files, and generated election source records now carry `references` arrays.
  - Normalized reference metadata now preserves `source`, `role`, `scope`, and `type` so Browse can distinguish overview, primary-result, corpus, and corroboration links.
- [x] Regenerate Browse data
  - Ran `npm run build:browse` to regenerate `data/browse` with election references.
- [x] Verify
  - Verification evidence: `node --check scripts/build-browse-indexes.mjs` passed; `npm run build:browse` passed; `npm run check` passed.
  - Verification evidence: generated `data/browse/elections.json` contains references on all 5,220 election records, including all 268 parent election records; representative checks confirmed Dáil 2024 parent, overall result, Dublin Central result, NI Assembly 2022 parent, and Belfast East result references.
  - Verification evidence: generated `data/browse/sources.json` election-source records also carry the propagated election references.
- [x] Review
  - Completed: election Browse entries now expose explicit source/corroboration references rather than only generated bundle/anchor downloads.
  - Remaining note: some constituency/DEA sub-entry references are generated/inferred corroboration links where the raw result file does not carry a direct source URL; those records are labelled with source/role/scope metadata so they can be refined later if a stricter hand-reviewed citation pass is required.

# Fix live Browse election names and deployment size
- [x] Record correction
  - Symptom: production `/browse/#/elections` still showed old election names such as `Dáil Éireann`, `House of Commons of the United Kingdom`, and `European Parliament (Ireland)` after canonical naming work was committed.
  - Root cause: the generated data had the corrected names locally, but the previous implementation also committed thousands of per-result election detail JSON files, pushing the tracked repository to 24,806 files, above Cloudflare Pages' 20,000-file deployment limit. Browse JSON fetches were also unversioned, so stale `data/browse/*.json` could remain cached after deployment.
  - Permanent prevention action: keep election result subentries in the compact election index, write detail files only for parent election records, prune stale generated election-result detail files, and version Browse JSON fetches.
  - Verification evidence: pending.
- [x] Update Browse data generation
  - Stop emitting static detail JSON files for election overall/constituency/DEA subentries while preserving those subentries in `data/browse/elections.json`.
- [x] Update Browse runtime
  - Add cache-busting/no-store fetch behaviour for Browse JSON and allow election subentry detail routes to render from the index record.
- [x] Regenerate and verify
  - Regenerate Browse indexes, confirm file count is below the Pages deployment cap, and run project checks.
- [x] Commit and push
  - Commit the scoped generator/runtime/data fix and push to `main`.
  - Completed: `npm run build:browse` regenerated `data/browse/elections.json` with 5,220 records and pruned `data/browse/details/elections` to 268 parent election detail files.
  - Completed: projected tracked repository file count after staged deletions is 19,854, under the 20,000-file Cloudflare Pages deployment cap.
  - Completed: local browser smoke for `http://127.0.0.1:8765/browse/#/elections` showed `5,220` election records and canonical titles including `2024 Irish general election`, `2024 general election in Northern Ireland`, and `2024 European Parliament election (ROI)`.
  - Verification evidence: `node --check browse/browse.js` passed; `node --check scripts/build-browse-indexes.mjs` passed; `npm run check` passed; `npm run check:test2` passed; `npm run build` passed after approved esbuild spawn escalation.

# Force tight Browse thumbnail framing and bypass stale thumbnail cache
- [x] Record recurrence
  - Symptom: User still sees the old-looking `admin-areas-1924-04-01` thumbnail after the first framing fix was committed and pushed.
  - Root cause: the previous crop was improved but still not aggressively feature-fitted enough, and the asset URL stayed unchanged so browser/CDN cache could continue serving the old image.
  - Permanent prevention action: tighten the regional admin feature-footprint target further and make Browse asset thumbnail URLs versioned.
  - Verification evidence: pending.
- [x] Tighten crop again
  - Increase the feature-footprint requirement for regional administrative thumbnails so the features occupy the frame rather than just a locator context.
- [x] Add cache-busting for thumbnail asset URLs
  - Version Browse thumbnail `src`, `srcset`, and actual-size links so same-name regenerated assets are not silently cached.
- [x] Regenerate and verify
  - Regenerate the representative thumbnail and inspect it at source/display size.
- [x] Commit and push
  - Run checks, commit, and push to production branch.
  - Completed: regional admin footprint target increased from 0.78 to 0.92 and context multiplier reduced from 1.24 to 1.08.
  - Completed: `admin-areas-1924-04-01` now computes a representative feature ratio of about 0.926 rather than about 0.806.
  - Completed: Browse thumbnail asset URLs now append `?v=20260604-tight-admin-frame` in `src`, `srcset`, and actual-size links.
  - Completed: regenerated `assets/thumbnails/admin-areas-1924-04-01.png`, `.webp`, and `-60.webp`; visual inspection shows a much tighter feature-fitted frame.
  - Verification evidence: `node --check browse/browse.js` passed; `python -m py_compile scripts/regen-thumbnails.py` passed; `npm run build:browse` passed; `npm run check` passed; `npm run build` passed after approved esbuild spawn escalation.

# Split Browse detail data into general-interest and technical tiers
- [x] Record scope
  - User requested that Browse pages distinguish general-interest data from technical data.
  - Goal: show public-facing descriptions, dates, providers, status, source/reference/download information, election/person/party facts, and useful thumbnails prominently, while hiding generated IDs, raw JSON, internal map wiring, URLs, geometry/index sidecars, and similar implementation fields under an expandable technical section.
- [x] Inspect current Browse detail renderer
  - Review `browse/browse.js` detail rendering and existing panel styles.
- [x] Implement public/technical classification
  - Replace the always-visible all-fields table with a collapsed technical panel.
  - Keep source/reference/download information visible.
  - Keep raw source metadata available, but closed by default.
- [x] Verify
  - Run syntax checks and project checks.
- [x] Review
  - Document changed files, verification evidence, and remaining limits.
  - Completed: Browse detail pages now render public-facing Overview/Details/Sources/Related sections first and put internal IDs, generated URLs, spatial indexes, layer wiring, and raw metadata into a collapsed `Technical data` section.
  - Completed: the old always-visible `All Browse Fields` table and separate raw metadata panel were removed from the primary detail flow.
  - Completed: generated election JSON and seat-anchor URLs are no longer primary action buttons; they remain accessible in the technical panel.
  - Verification evidence: `node --check browse/browse.js` passed; `npm run check` passed; local browser smoke for `#/maps/admin-areas-1924-04-01` confirmed Overview/Metadata/Sources visible, `Technical data` closed, and `All Browse Fields` absent; local browser smoke for `#/elections/dail-eireann-2024-11-29` confirmed Overview/Details visible, `Technical data` closed, and seat-anchor action hidden; `npm run build` passed after approved esbuild spawn escalation.
  - Remaining note: `data/browse` generated JSON files were already dirty before this task and remain dirty; this task intentionally changed the renderer rather than regenerating or reverting those datasets.

# Fix live Browse technical-detail leakage
- [x] Record correction
  - User reviewed `https://civgraph.net/browse/#/maps/admin-areas-1924-04-01` and found the live page still showed technical details as general information.
  - Symptom: production still displayed `All Browse Fields`, a top-level raw metadata panel, map IDs, label property/loadable/featured technical fields, and runtime badges in public panels.
  - Root cause: the renderer split was local/unpushed at first; after push, production served the fixed `browse.js` only on a cache-busted URL because the unversioned Browse script can remain cached for 4 hours.
  - Permanent prevention action: deploy the Browse renderer split, remove `Featured`/`Loadable` from public badges, and version Browse CSS/JS includes; keep runtime/catalogue flags in collapsed technical data.
- [x] Tighten public Browse badges
  - Removed runtime/catalogue `Featured` and `Loadable` flags from public detail badges.
- [x] Bust Browse asset cache
  - Versioned the standalone Browse CSS and JS includes so production users do not keep loading the old renderer from cache.
- [x] Verify
  - Run syntax/project checks and local browser smoke for the exact map route.
  - Verification evidence: `node --check browse/browse.js` passed; `npm run check` passed; exact local route smoke for `#/maps/admin-areas-1924-04-01` confirmed no public `All Browse Fields`, no top-level raw metadata panel, no public `Map ID`, `Label property`, `Loadable`, or `Featured`, and a closed `Technical data` section; `npm run build` passed after approved esbuild spawn escalation.
- [x] Commit and push
  - Commit only renderer/style/task-log/lesson changes, leaving pre-existing generated `data/browse` churn unstaged.
- [x] Review
  - Document verification evidence and remaining notes.
  - Completed: committed `44ce80e79 Hide technical Browse fields by default` and pushed `main` to GitHub.
  - Follow-up: direct production fetch confirmed `browse.js?v=82b9865bc` contained the fix, while the live hash route still used cached unversioned `browse.js`; added versioned Browse asset URLs in `browse/index.html`.

# Canonical election names and Browse election result sub-entries
- [x] Record scope
  - User requested canonical public election names in active layer cards and Browse, covering Dail, European ROI/NI, NI Assembly, UK Parliament NI, NI Forum, Constitutional Convention, Parliament of NI, by-elections, recall petitions, and ROI/NI local elections.
  - User also requested sub-entries for each election's overall result and each constituency/DEA result, including the NI Forum Regional List.
- [x] Inspect current election naming and Browse generation
  - Identify every path that produces active layer titles, `/test2` election manifest labels, and Browse election records.
- [x] Implement shared canonical election naming
  - Add one pure naming utility used by the main controller and generated `/test2`/Browse manifest data.
- [x] Generate Browse election result sub-entries
  - Add overall-result and constituency/DEA result records under each parent election without hiding the parent election.
- [x] Verify
  - Regenerate affected manifests/Browse indexes, run syntax/project checks, and spot-check representative records.
- [x] Review
  - Document files changed, verification evidence, and any remaining naming/data limits.
  - Completed: added `js/election-names.mjs` and wired it into the main election controller, `/test2` election manifest generation, and Browse generation.
  - Completed: the active layer card name now uses the same canonical title builder rather than short-body/date labels.
  - Completed: `/test2` manifest display titles now include requested forms such as `2024 Irish general election`, `2024 European Parliament election (ROI)`, `2019 European Parliament election (NI)`, `2024 general election in Northern Ireland`, `2018 North Antrim recall petition`, `1975 Northern Ireland Constitutional convention`, `16 Apr 1970 Northern Ireland by-elections`, and `2023 Northern Ireland local election`.
  - Completed: Browse elections now include 268 parent election records plus 4,952 child result records, for 5,220 election Browse entries total.
  - Completed: each parent Browse election now carries `resultEntries`; child records include an overall-results entry plus constituency/DEA entries, including `Regional List - 1996 Northern Ireland Forum election`.
  - Verification evidence: `node --check` passed for `js/election-names.mjs`, `js/election-controller.js`, `scripts/build-test2-election-manifest.mjs`, `scripts/build-browse-indexes.mjs`, and `browse/browse.js`; `npm run build:test2:elections` passed; `npm run build:browse` passed; representative Node spot-checks passed; `npm run check` passed; `npm run check:test2` passed; `npm run build` passed after approved esbuild spawn escalation.
# Break down Browse parent election entries
- [x] Record scope
  - User asked what the 268 parent election entries consist of.
- [x] Inspect generated election index
  - Break parent entries down by body, geography, decade, and status.
- [x] Summarize inline
  - Provide concise breakdown in chat.
  - Completed: inspected `data/browse/elections.json`; confirmed 268 parent election records, with 178 Northern Ireland and 90 Republic of Ireland records, and broke them down by body, public contest type, decade, and conversion status.
# Compare main and test2 election panes
- [x] Record scope
  - User asked for a maximum-detail comparison of main vs test2 election panes and feasibility of taking the main election pane logic into test2 as-is, with only MapLibre wiring changes.
- [x] Inspect main election pane code paths
  - Review main election controller/template/rendering logic and where it depends on Leaflet or main app state.
- [x] Inspect test2 election pane code paths
  - Review test2 election manager/pane rendering and adapter boundaries.
- [x] Compare behavior
  - Compare screenshots and code mechanics for title/state, tabs, tables, sort/filter, constituency selection, count/detail/transfer views, and map coupling.
- [x] Summarize feasibility
  - Explain what can be mirrored directly, what needs an adapter, and what cannot be literally copied without creating regressions.
  - Completed: compared main `js/election-controller.js` pane/table/filter/animation logic with test2 `test2/src/election-manager.js` and `test2/src/election-pane-main-contract.js`.
  - Completed: concluded that exact "as-is" reuse is feasible only after isolating the main pane as an engine-neutral module or feeding test2 an exact main-controller-shaped state; MapLibre-specific drawing can remain separate, but current test2's separate renderer will continue to drift.
# Share main election pane logic with test2
- [x] Record scope
  - User asked to execute the structural refactor so test2 uses main election pane logic as far as feasible while preserving MapLibre.
- [x] Inspect boundaries
  - Identify main election pane methods that can be extracted or mirrored without dragging Leaflet drawing into test2.
- [x] Implement shared pane module
  - Move/copy the main pane rendering and table-control logic behind an engine-neutral host contract.
- [x] Wire test2
  - Replace test2's separate pane renderer path with the shared main-compatible renderer where feasible.
- [x] Verify
  - Run syntax checks, build/check scripts, and spot-check representative election pane outputs.
- [x] Review
  - Document what was implemented and any remaining constraints.
  - Completed: added `js/election-main-pane-contract.mjs` as the shared engine-neutral election pane contract and changed `/test2` to instantiate it directly.
  - Completed: reduced `test2/src/election-pane-main-contract.js` to a compatibility re-export so the old local wrapper no longer owns the visible pane contract.
  - Completed: changed selected-result pane titles to use the main-style area title rather than appending the election title, and removed the test2-only selected-result stats strip before the table.
  - Completed: updated `scripts/validate-test2-route.mjs` so `check:test2` enforces the shared contract path instead of checking stale local-wrapper strings.
  - Verification evidence: `node --check js/election-main-pane-contract.mjs`, `node --check test2/src/election-manager.js`, `node --check test2/src/election-pane-main-contract.js`, and `node --check scripts/validate-test2-route.mjs` passed; `npm run check:test2` passed; `npm run check` passed; `npm run build:test2` passed after approved esbuild spawn escalation.
  - Remaining constraint: this is a structural shared-contract step, not a literal wholesale extraction of every private method from `js/election-controller.js`; MapLibre selection/drawing remains in `/test2`, and exact transfer-animation/count-data parity still depends on the available generated election sidecars.

# Restore test2 election transfer animation parity
- [x] Record correction
  - Symptom: The main site shows a Transfers pane for Dáil 2024 Mayo, but `/test2` shows `No transfer animation data is available for this entry.`
  - Root cause: `/test2` still returned the simplified shared animation notice before its real animation branch could run, and the generated summary treated ElectionsIreland-style scraper payloads as candidate-only data instead of normalising them into the main controller's synthetic count payload.
  - Permanent prevention action: normalise generated election results through the same main-shaped animation payload contract and add a `check:test2` assertion for the exact Dáil 2024 Mayo transfer case.
- [x] Mirror main synthetic transfer payloads
  - Ensure scraper-style result JSON is converted into `{ Constituency: { countInfo, countGroup } }` for animation use, including synthetic count stages from `final_count`.
- [x] Wire test2 Transfers tab to the main animation scaffold
  - Remove the early no-data fallback and auto-run `stages2.js` when the Transfers tab is rendered.
- [x] Verify and document
  - Rebuild election bundles, rebuild `/test2`, run route checks, and smoke-test the Mayo Transfers tab.
  - Completed: changed `summarizeResult()` so scraper-style election result files are normalized through the same main-shaped synthetic count payload used by the production election controller.
  - Completed: removed the `/test2` Transfers-tab early fallback and made the tab auto-run `stages2.js` against the generated animation payload.
  - Completed: added a `check:test2` guardrail asserting Dáil 2024 Mayo carries a multi-stage animation payload.
  - Verification evidence: `node --check js/election-domain.mjs`, `node --check test2/src/election-manager.js`, and `node --check scripts/validate-test2-route.mjs` passed; `npm run build:test2:elections` passed; generated Dáil 2024 Mayo has `hasCountDetail: true`, count stages `1-5`, and 16 animation rows; `npm run check:test2` passed; local Playwright smoke for explicit Dáil 2024 Mayo `/test2` election state showed active tab `Transfers`, no no-data fallback, visible animation container, stage numbers `12345`, and 59 animation children; `npm run check` passed; `npm run build:test2` and `npm run build` passed after approved esbuild spawn escalation.
