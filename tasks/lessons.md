# Lessons Log

### 152) Selected constituency fixes must verify final rendered percentages, not only normalized rows
- Mistake pattern: The Dail 2024 scraper-row fix verified that synthetic rows stayed first-count-only, but did not assert that selected constituency party panes received a non-zero valid-poll denominator and rendered non-zero first-preference percentages.
- Impact: `/test2` could still show constituency first-preference vote totals with every `1st prefs %` cell at `0.00%`, leaving the election pane materially wrong even after the scraper normalization commit.
- Guardrail:
  1) selected election pane validation must inspect computed table rows for every 2024 Dail constituency, not only representative raw bundle rows,
  2) any row with first-preference votes and a constituency valid poll must have a positive first-preference percentage unless the votes are zero,
  3) browser smoke for a reported constituency must assert visible percentage text and summary rows, not just row names/votes/status.

### 151) Route-specific built CSS must be browser-checked after shared layout changes
- Mistake pattern: Moving the shared timeline markup outside `#map` and verifying a desktop route without fully accounting for `/test2` route-specific CSS and generated bundle output that can keep the control visually behaving like map chrome.
- Impact: The user still saw the timeline slider over the `/test2` interactive map instead of as a separate below-map rectangular pane.
- Guardrail:
  1) any map/timeline layout fix must inspect both source and generated CSS for route-specific selectors,
  2) browser smoke must target the exact route the user names, including `/test2`, and record geometry from the rendered route,
  3) static validation should fail if `.timeline-slider` is positioned, sized, or scoped as a `#map` overlay in either source or built route CSS.

### 150) Immutable split-bundle entry URLs must be content-versioned automatically
- Mistake pattern: Treating `build/app.bundle.js?v=116` as a safe immutable asset even though `app.bundle.js` has a stable filename and imports content-hashed dynamic chunks that change across builds.
- Impact: Cloudflare/browser/service-worker caches can keep an old app bundle that imports deleted chunk files. Missing chunk URLs can be served as HTML by the static fallback, and browsers then reject the module graph with a script-load/MIME failure that leaves the static shell blank.
- Guardrail:
  1) the build script must derive entry asset query versions from generated file content, not hand-maintained counters,
  2) non-fingerprinted entry assets such as `app.bundle.js` and generated CSS should revalidate even when chunks remain immutable,
  3) HAR reviews for blank startup must check imported module chunks and MIME types, not only the top-level bundle status.

### 148) Election pane visual parity requires the same DOM contract, not a main-like renderer
- Mistake pattern: Treating `/test2` election pane output as aligned because it uses many main class names while it still has `/test2` wrapper classes, extra fixed-table classes, different entity-button markup, different delta class names, and a separate party-colour source.
- Impact: Screenshots remain visibly different even when the high-level table headings and values look similar, because CSS selectors, table layout, inline wrapping, sticky sizing, and colour tokens are not receiving the exact same DOM/class contract as the main site.
- Guardrail:
  1) election pane parity checks must diff representative rendered DOM, not only screenshots or row values,
  2) `/test2` should render the exact main election pane markup for shared pane modes or use a single shared renderer,
  3) `/test2`-specific CSS may position the pane container but must not override inner election table sizing, entity links, party dots, or delta classes unless the override is intentionally documented and tested.

### 147) Directional synthetic map placement must be encoded and validated literally
- Mistake pattern: Implementing synthetic non-geographical election anchors near the northwest side when the intended placement was northeast.
- Impact: `/test2` could render the new non-geographical entries and pass broad clickability checks while still placing them in the wrong part of the map.
- Guardrail:
  1) directional placement requirements must be reflected in function names and generated method strings,
  2) route validation must assert the exact generated method string,
  3) metadata checks should inspect representative synthetic rows after regeneration, not only runtime rendering.

### 146) Same selected election pane still needs same selected table contract
- Mistake pattern: Fixing parent-vs-selected election state and then assuming the remaining selected-result pane is visually aligned because both sides show the same constituency/DEA title.
- Impact: Main and `/test2` can both show `Roscommon Galway`, but still diverge because main's selected `By Party` table uses the constituency party contract (`Stood`, `Elected`, `1st prefs`) while `/test2` may use a broader grouped overall-election table contract (`Candidates`, `Seats`, grouped first preferences).
- Guardrail: Parity tests for selected election panes must assert table headers, first five row labels, first-preference values, elected/seat values, summary rows, and active tab for a known constituency such as Roscommon Galway 2024.

### 145) Layer-level election parity is not enough when selected substate is serialized
- Mistake pattern: Verifying a layer-only election URL while `/test2` can still write and restore selected constituency/DEA substate such as `electionSelected`, `electionView`, and `electionCountDetail`.
- Impact: The active election layer matches main, but the visible pane can still diverge badly because main is showing the parent election and `/test2` is showing a selected constituency result.
- Guardrail: Any election pane parity check must inspect the full final hash after restore and assert whether selected substate is present. If main does not expose that substate for the same workflow, `/test2` must not serialize or restore it for that workflow.

### 144) Election pane parity screenshots must compare identical URL and pane state
- Mistake pattern: Treating a screenshot mismatch as purely a renderer/CSS issue while the main site and `/test2` are actually in different election pane states, such as main showing overall `By Party` and `/test2` showing a selected constituency `By Count`.
- Impact: Fixes can improve one pane mode while the user still sees large residual differences because route restoration, selected feature state, active tab, detailed toggle, and viewport state are not first normalized before comparison.
- Guardrail:
  1) every parity comparison must first print and compare canonical state: active layer, selected constituency/DEA, election view tab, detailed toggle, timeline date, viewport, and URL hash,
  2) screenshots must be taken from the same canonical state on both main and `/test2`,
  3) if the states differ, fix state restoration before touching table markup,
  4) browser smoke should fail when `/test2` loads a selected-area pane from a URL that should restore the main overall pane.

### 143) Selected election pane parity must use the same default table mode
- Mistake pattern: Treating a shared election pane shell as enough while `/test2` selected-result count panes still default to a detailed generated count matrix that main does not show by default.
- Impact: The tab labels look close, but the table columns, widths, status text, and perceived result ordering visibly diverge from main in the exact screenshot workflow the user is using.
- Guardrail:
  1) selected constituency/DEA `By Count` views must default to the same compact first-preference table as main,
  2) wide per-count matrices must only appear behind the explicit detailed/count-animation path that main exposes,
  3) transfer animation scaffolds must auto-start when rendered and must not require a separate "run" button,
  4) `check:test2` or a browser smoke must cover the exact Dail 2024 selected-constituency count and transfer workflow.

### 139) Generated Browse data must stay within Pages limits and use versioned fetches
- Mistake pattern: Canonical Browse election names were generated correctly, but the fix also committed thousands of per-result detail JSON files and left Browse data fetches unversioned.
- Impact: The production site could continue showing old names because deployment may fail above Cloudflare Pages' 20,000-file limit, and stale `data/browse/*.json` can be served even when the Browse script is updated.
- Guardrail:
  1) generated Browse subentries should live in compact indexes unless their detail pages genuinely need separate static files,
  2) Browse generators must prune stale generated detail files for categories where static detail output has been intentionally reduced,
  3) Browse runtime JSON fetches should include an explicit data version and no-store cache mode whenever generated data shape changes.

### 138) Site-wide navigation changes must check main, test, and test2 shells
- Mistake pattern: The Browse/login entry point was added to the main shell and About page, but `/test2` was left without the Browse link even though it is an active user-facing shell.
- Impact: Users viewing `/test2` could not reach the new Browse/contributor workflow from the navbar, creating an avoidable parity gap.
- Guardrail:
  1) any navbar or top-level route change must grep `index.html`, `pages/about.html`, `test/index.html`, and `test2/index.html`,
  2) route links under `/test2` must use absolute URLs for site-wide pages unless a scoped `/test2` page exists,
  3) task reviews should explicitly state whether the main shell, `/test`, and `/test2` were changed or intentionally left unchanged.

### 137) Election pane parity must test every pane mode, not only the overall party table
- Mistake pattern: `/test2` was repeatedly aligned against the visible Dáil 2024 overall party table while candidate, local-party, selected constituency/DEA, count, recall, entity, local-government, and animation panes were still rendered through separate or simplified branches.
- Impact: A focused parity test could pass while screenshots still showed real differences, because the test covered only one pane state and the shared renderer still delegated many secondary states to `/test2`-specific markup.
- Guardrail:
  1) parity tests must cover representative overall, candidate, local-party, selected-area party, selected-area count, entity, recall, and local-government states,
  2) main election pane rendering should be extracted/mirrored as an engine-neutral module before adding more visual fixes,
  3) `/test2` should keep MapLibre-specific code only at map drawing/selection boundaries, not in election pane HTML/view-model generation.

### 136) Election pane parity needs a shared entrypoint, not separate route render branches
- Mistake pattern: `/test2` kept improving visible election pane parity through route-specific rendering branches while the main site retained the canonical election pane logic elsewhere.
- Impact: Each screenshot-driven fix could close one discrepancy while leaving other modes free to drift, because overall, selected-area, count, local-party, entity, and special-case panes did not all enter through one shared contract.
- Guardrail:
  1) `/test2` visible election pane rendering must enter through `SharedElectionRenderer`,
  2) main-compatible host adapters should be explicitly named and validated,
  3) browser tests should compare representative main and `/test2` election pane DOM for canonical URLs.

### 135) Custom MapLibre controls must preserve the full main control set and visible date contract
- Mistake pattern: `/test2` replaced native MapLibre controls with a custom main-style zoom control, but only recreated zoom in/out and omitted the compass/reset-north control; timeline labels also relied on caller-supplied labels instead of a fixed visible date format.
- Impact: The map pane looked and behaved differently from the main interactive map, and timeline labels could appear as raw ISO dates or unpadded dates instead of the requested `DD MMM YYYY` presentation.
- Guardrail:
  1) route validation should assert the custom compass/reset-north control exists when native controls are hidden,
  2) browser tests should verify the compass resets bearing/pitch,
  3) timeline labels should pass through one central formatter and browser tests should assert a representative election label uses `DD MMM YYYY`.

### 134) Election overlays should suppress ordinary geography labels
- Mistake pattern: `/test2` election styling tuned feature-label zoom density instead of explicitly hiding ordinary constituency/geography labels once an election layer was active.
- Impact: Election maps could show normal feature labels on top of election styling and seat-circle overlays, diverging from the intended election-layer presentation.
- Guardrail:
  1) election style application should carry an explicit `hideLabels` contract,
  2) the adapter must preserve and restore the previous label-enabled state when election styling is cleared,
  3) browser tests should assert zero visible `.maplibre-dom-label` elements while an election layer is active and confirm feature details still work through geometry selection.

### 133) Fixed overlay menus need viewport containment tests, not only interaction tests
- Mistake pattern: `/test2` election table sort/filter menus gained main-style functionality, but the overlay placement still used scroll-adjusted coordinates for a fixed-position element and did not constrain menu height.
- Impact: A sort/filter pane could spill out of the browser window, especially near viewport edges or on short/mobile screens.
- Guardrail:
  1) fixed-position overlays must be positioned using viewport-relative `getBoundingClientRect()` values, not page scroll offsets,
  2) large overlay content should cap height and scroll internally,
  3) browser tests must assert overlay bounds against `window.innerWidth`/`window.innerHeight` in at least one constrained viewport.

### 132) Visual parity controls must share behaviour, not just icons
- Mistake pattern: `/test2` rendered election table header sort buttons that looked like the main site's sort/filter buttons, but implemented only direct click-to-sort behaviour.
- Impact: The visible table controls suggested main-site parity while missing the actual main workflow: per-column menu, value search, select/deselect all, clear/apply filter, reset sort, active-state arrows, and outside/Escape dismissal.
- Guardrail:
  1) when a control is ported for parity, compare the interaction contract as well as the markup/CSS,
  2) `/test2` route validation must assert menu/filter primitives, not just button presence,
  3) browser tests must exercise at least one numeric sort menu action and one text-column filter apply/clear flow.

### 131) DOM map overlays must be map-anchored, not fixed-position reprojected only at movement end
- Mistake pattern: Replacing MapLibre paint-layer seat circles with a fixed absolute DOM overlay, then trying to approximate Leaflet marker behaviour by recalculating `left/top` after `moveend`/`zoomend`.
- Impact: During active pan gestures, MapLibre moved the map while `/test2` seat-circle DOM groups stayed at stale pixel positions, visibly detaching from their constituencies.
- Guardrail:
  1) use MapLibre-managed DOM `Marker` instances for seat-circle groups so the engine keeps DOM overlays anchored during pan/zoom,
  2) keep collision/group rebuilds on final camera events instead of rebuilding expensive layout mid-gesture,
  3) browser tests must sample seat-circle DOM centres against `map.project(lng, lat)` before, during, and after an animated pan.

### 130) Seat-circle parity must cover zoom algorithms, not only dot styling
- Mistake pattern: Closing visible seat-circle requests by changing stroke/halo styling while leaving collision, projected bounds, and rebuild timing close-but-not-identical to the main Leaflet implementation.
- Impact: `/test2` could look acceptable at one zoom but still diverge from main when zooming because group visibility and collision decisions were produced by slightly different mechanics.
- Guardrail:
  1) route validation must assert the main-style constants and collision math directly,
  2) browser tests must sample election DOM seat circles across multiple zoom levels,
  3) MapLibre-specific code should be isolated to projection and final overlay positioning while the seat-circle domain/layout rules mirror main.

### 129) Seat-circle outline colour is a visible contract, not an incidental default
- Mistake pattern: Preserving the earlier white MapLibre seat-circle halo/stroke while the user expected black outlines for election seat circles.
- Impact: `/test2` seat circles could pass broad election-rendering tests while still visibly diverging from the requested map styling.
- Guardrail:
  1) browser tests must assert the exact `test2-election-seat-layer` stroke colour,
  2) route validation should check the seat-circle paint constants directly,
  3) when changing visual parity details, update both the visible paint and any lower/halo layer that creates the apparent outline.

### 128) Test2 election parity needs restore-state guardrails, not only visual tuning
- Mistake pattern: Treating active election parity as a visual issue while `/test2` could restore the map layer without restoring the main catalogue state, main-style `zoom` URL key, low-zoom label density, and table interaction model.
- Impact: `/test2` could show the correct election layer but still look unlike main: catalogue scrolled elsewhere, labels over-dense at low zoom, native MapLibre controls visible, and election tables unable to reproduce main-style sorting.
- Guardrail:
  1) browser tests must restore a canonical election URL and assert active catalogue row focus, viewport, low-zoom label suppression, and expected party table order,
  2) `/test2` route validation must check main-style zoom URL writing, custom controls, election label threshold hooks, table sort controls, and deterministic seat-circle draw order,
  3) MapLibre-specific controls and styling should sit behind the test2 adapter while preserving the production shell’s visible contract.

### 127) General local elections are jurisdiction-wide catalogue events, not council-row events
- Mistake pattern: Generating `/test2` election catalogue entries directly from council-specific local-government bodies, so one NI-wide local election appeared as one election per council.
- Impact: `/test2` diverged from the main site's election catalogue contract and made local-election timelines/results feel fragmented.
- Guardrail:
  1) generated election manifests must collapse multi-council local-government dates into one jurisdiction/date entry,
  2) preserve per-council context as metadata for result matching and council-mode panes rather than as separate top-level catalogue events,
  3) route validation and browser tests must fail if grouped local-election dates produce more than one catalogue entry.

### 126) Catalogue parity means matching the main navigation contract, not adding shortcut rows
- Mistake pattern: Fixing election discoverability by adding individual election rows to the top catalogue table of contents.
- Impact: `/test2` diverged from the main site, where the TOC exposes decade jump buttons and individual elections live inside their decade sections/cards.
- Guardrail:
  1) before adding route-specific shortcuts, compare the main interaction contract,
  2) `/test2` tests should assert decade TOC buttons remain and individual election TOC rows are absent,
  3) discoverability fixes should keep entries in the same hierarchy as the main site unless there is a documented MapLibre-specific reason to differ.

### 125) Catalogue visibility tests must target the visible browsing surface
- Mistake pattern: Treating hidden or far-below-the-fold catalogue card DOM as proof that entries are available in the map catalogue.
- Impact: `/test2` had 548 election card entries, but the primary top catalogue table only showed decade jump buttons, so users saw no election entries available to pick.
- Guardrail:
  1) catalogue parity tests must assert visible rows in the default top catalogue surface,
  2) buried detail/card DOM counts are supporting evidence only,
  3) route-specific catalogue additions should avoid thumbnail/network churn and be gated explicitly when they would alter the main site.

### 124) Route-specific catalogue shortcuts need explicit parity opt-ins
- Mistake pattern: Reusing the main site's bounded mobile catalogue shortcut on `/test2` without checking whether the route needs broader catalogue visibility for parity testing.
- Impact: Election entries could be hidden from the `/test2` catalogue pane even though the MapLibre election implementation was present.
- Guardrail:
  1) route-specific catalogue shortcuts must be controlled by named opt-ins,
  2) `/test2` browser boot checks must assert election rows are visible,
  3) performance shortcuts should hide expensive browsing aids only when the route has an equivalent accessible entry point.

### 123) Mobile feature selection must be geometry-driven, not label-only
- Mistake pattern: Treating DOM-label taps as sufficient parity for feature selection while leaving mobile double-tap gestures controlled by the map zoom handler.
- Impact: On mobile, users had to tap small labels to open feature cards; double-tapping feature geometry zoomed instead of selecting.
- Guardrail:
  1) `/test2` disables MapLibre double-click zoom where main-site feature double-click/tap selection is required,
  2) geometry click/double-click handlers must query rendered features with tolerance and open the main feature card,
  3) browser tests must assert mobile-sized geometry double-click selection does not materially change zoom.

### 122) Map control parity must be tested against production overlay positions
- Mistake pattern: Moving MapLibre controls to another default slot and declaring overlap fixed without checking every production overlay in the real `/test2` shell.
- Impact: The active-layers button could still overlap zoom controls, and the settings button could overlap the scale control, because production shell overlays and MapLibre controls were not laid out as one control system.
- Guardrail:
  1) place MapLibre controls under route-scoped CSS that accounts for production overlay buttons,
  2) browser tests must check active-layers, zoom, settings, and scale bounding boxes together,
  3) parity work must include the visible production workflows, not only the map canvas.

### 121) Polygon hover strokes on vector-tile fragments can draw tile seams
- Mistake pattern: Using thick MapLibre line layers or GeoJSON fallback line overlays for polygon hover/selection on MVT features.
- Impact: Tile-clipped polygon fragments can show horizontal or vertical internal highlight lines when a feature is hovered or selected.
- Guardrail:
  1) `/test2` polygon interaction should use fill plus DOM-label state unless an unclipped full-geometry outline source is available,
  2) duplicate promoted IDs must use generated interaction keys and avoid shared feature-state,
  3) browser/static checks should assert polygon interaction line layers are absent or disabled for polygon sources.

### 119) Treat “absent from source” as unproven until unnamed and duplicate-labelled geometries are checked
- Mistake pattern: Classifying election geographies as absent from a converted boundary source based only on the feature-search index and matched-name report.
- Impact: `Armagh Area D`, `Dungannon Area C`, and `Limavady Area C` were reported as missing from `deas-1972` even though the geometries existed; two had null `NAME` values and one was mislabelled as a duplicate `DUNGANNON AREA D`.
- Guardrail:
  1) before reporting a residual as data-absent, inspect the underlying source feature count, blank label rows, duplicate labels, and nearby same-council geometry,
  2) source-specific repairs must feed all consumers: rendered labels, selected-feature details, feature indexes, and election styling/matching,
  3) route validation should fail if a known repaired residual reappears in the generated election report.

### 120) Feature indexes must not preserve whitespace-only labels
- Mistake pattern: Treating any non-null configured label value as usable for `/test2` feature search and detail names.
- Impact: Some converted layers could carry whitespace-only labels in their feature-search sidecar files, which makes unnamed/empty feature display defects more likely even when the source geometry is present.
- Guardrail:
  1) trim label, alias, and id values before indexing,
  2) if a configured label is blank after trimming, generate a stable fallback feature name,
  3) fail `/test2` route validation if any generated feature index contains a blank or `Unnamed Feature` label.

### 118) MapLibre partial-feature filters need property-based IDs and render-cycle tests
- Mistake pattern: Assuming MapLibre filter expressions using `['id']` behave like promoted feature IDs in every runtime path, then querying rendered features immediately after `setFilter`.
- Impact: A partial feature could be marked loaded in adapter state while no feature rendered, or a hidden partial feature could appear in stale query results during the same render cycle.
- Guardrail:
  1) build partial-feature filters from stable source properties such as `promoteId`, `id`, and label/name fields,
  2) fall back from missing promoted IDs to feature labels where source data does not expose a usable feature id,
  3) browser tests that assert MapLibre filter effects must wait for the next rendered state, not immediate post-`setFilter` query results.

### 117) Preserve the main feature-info payload shape when adapting MapLibre selections
- Mistake pattern: Flattening MapLibre feature properties onto the top-level selected-feature object while the main feature-info renderer expects `feature.properties`.
- Impact: The top-right feature card can render `Unnamed Feature` even when the selected vector feature has a valid name/label property.
- Guardrail:
  1) engine adapters must preserve the main-site selection contract: `{ mapId, id, properties, geometry }`,
  2) browser tests must assert selected feature cards do not contain `Unnamed Feature`,
  3) static route validation should check the adapter passes nested `properties` and `geometry`.

### 116) Label hover parity means direct text colour changes, not orange shadow masks
- Mistake pattern: Implementing the requested orange label outline with an orange text-shadow that visually looked like a mask over the original label colour.
- Impact: `/test2` label hover looked materially different from the main Leaflet label hover, where the text itself changes to orange and keeps a white halo.
- Guardrail:
  1) hovered map labels should use direct `#ff7a1a` text colour,
  2) keep the text halo white unless the product explicitly asks for a different halo,
  3) browser tests should assert computed label colour and that the hover shadow is not orange.

### 115) MapLibre label parity needs a DOM interaction layer, not only symbol-layer styling
- Mistake pattern: Treating MapLibre symbol labels as equivalent to the main Leaflet label markers.
- Impact: Vector-tile polygon fragments can create repeated labels, and native symbol labels cannot provide the same clickable, underlined, hover-synchronised label behaviour as the main site.
- Guardrail:
  1) for main-site label parity, hide native MapLibre symbol text and render a deduplicated DOM label overlay keyed by feature id,
  2) collision-suppress DOM labels so one label cannot intercept another label's pointer interaction,
  3) browser tests must prove label uniqueness, label hover styling, label click selection, feature double-click selection, and feature-card placement in one interaction pass.

### 114) When shell parity is exact, create a true main-shell clone route before further visual tweaks
- Mistake pattern: Continuing to incrementally reshape `/test` after the user wanted the main site shell preserved verbatim with only the map engine swapped.
- Impact: The result could satisfy local guardrails while still looking unlike the main site to the user, because the route still owned too much shell/catalogue structure.
- Guardrail:
  1) for exact shell parity, start from the production `index.html` and remove/replace only engine-specific boot assets,
  2) wire MapLibre behind the main catalogue callback surface rather than rebuilding the catalogue as a separate product,
  3) keep the clone isolated under a new route until browser tests prove both catalogue rendering and one real MapLibre layer load.

### 113) Shell parity means shared shell assets and an engine boundary, not only similar markup
- Mistake pattern: Repeated `/test` shell passes kept approximating the main navbar/catalogue with test-owned HTML/CSS/controllers, so visual and behavioural drift persisted even when structural checks passed.
- Impact: The user still saw obvious differences and had to restate that `/test` should be the main site shell with only the map engine swapped.
- Guardrail:
  1) `/test` must load the production shell CSS and use the production visible shell contract for navbar, catalogue, split panes, and map controls,
  2) MapLibre-specific behaviour must sit behind a shell engine adapter instead of changing the catalogue's public workflow,
  3) parity checks must assert production CSS loading, main shell IDs/classes, and a real MapLibre layer load in the same verification pass.

### 112) Shell parity tests must prove the real map workflow, not only structural proxies
- Mistake pattern: I changed `/test` to satisfy newly added shell/parity assertions while the assertions only checked DOM classes, widths, and screenshots, not that the MapLibre map could still initialize, load a layer, render tiles, and accept interaction in the changed shell.
- Impact: The UI could pass visual/static/browser guardrails while still being visibly misaligned with the main site and while the interactive map regressed for the user.
- Guardrail:
  1) after shell/layout changes, run a browser test that loads a real converted layer and proves MapLibre has rendered source/layer content, not just that `#map` is visible,
  2) compare against real main-site DOM and screenshots rather than self-authored parity proxies,
  3) do not ship a shell-alignment pass unless the default browsing workflow and one map-load workflow both pass in the browser.

### 111) Label parity includes zoom availability, not only visual styling
- Mistake pattern: Matching the main site's label colours and halo while leaving `/test` MapLibre `labelMinZoom`, `labelMaxZoom`, and per-feature `label_minzoom` gates in place.
- Impact: labels can look correct once zoomed in, but still fail the main-site behaviour where labels are available throughout the map interaction.
- Guardrail:
  1) when comparing label parity, check low, middle, and high zoom availability explicitly,
  2) avoid hard symbol-layer zoom gates unless they are deliberately product-specified,
  3) expose label layer zoom bounds in diagnostics so mobile/browser smoke tests can prove the deployed style contract.

### 110) Bump /test asset and service-worker cache versions with every deployed bundle behavior change
- Mistake pattern: Shipping `/test` MapLibre label styling changes while leaving `test.bundle.js?v=test-003` and the `test-v3` service-worker cache unchanged.
- Impact: phones can keep running an older cached test bundle, so new metadata such as `labelStyle` is fetched but ignored or rendered with old styling mechanics.
- Guardrail:
  1) for every `/test` app-code or style change, bump the bundle query string in `test/index.html`,
  2) bump `TEST_CACHE_VERSION` in `test/sw.js` at the same time,
  3) version metadata fetches from the app when metadata shape changes, and verify the built bundle contains the new style contract before asking for mobile testing.

### 109) Ambiguous party abbreviations need island-specific aliases before reporting mismatches
- Mistake pattern: Reporting an abbreviation match from the global Wikipedia party table without first applying obvious Ireland/NI political aliases.
- Impact: `PUP` was incorrectly reported against People's Unification Party instead of Progressive Unionist Party.
- Guardrail:
  1) add domain-specific alias mappings before abbreviation matching for Ireland/NI party audits,
  2) treat global abbreviation-only matches as low confidence unless an Ireland/NI canonical party is selected,
  3) include the alias basis in reports so incorrect matches are visible.

### 108) Mobile map-load fixes must prove the hidden catalogue stays empty
- Mistake pattern: Treating reduced catalogue rerenders and thumbnail churn as sufficient while the hidden mobile catalogue pane can still build the full flat catalogue during startup or map load.
- Impact: Desktop and emulated timing can look acceptable, but real phone browsers can still stall or crash from hidden DOM, card, table, and thumbnail pressure.
- Guardrail:
  1) mobile performance fixes must assert that map-first startup leaves `#catalogueFlatView` deferred with zero descendants,
  2) map-load tests must prove hidden catalogue hydration is not triggered,
  3) first mobile catalogue open must be bounded unless the user explicitly expands the full catalogue.

### 107) Preserve source-agency credit when adding contributor-derived map vintages
- Mistake pattern: Treating a contributor who prepared a corrected or bilingual vintage boundary as the sole provider and dropping the underlying source-agency credit.
- Impact: Catalogue metadata can under-credit OSI/Tailte/OSNI even when the collaborator's work is derived from or intended to preserve that source.
- Guardrail:
  1) distinguish source agency from contributor/digitizer in `provider`,
  2) when adding historical variants from collaborator files, preserve existing source-agency credit unless the source is demonstrably unrelated,
  3) verify the affected catalogue row shows both credits before closing the task.

### 91) Reproduce sticky seam bugs on the exact card family before fixing the cover layer
- Mistake pattern: Fixing a sticky seam based on one flat-card family (`map` cards) without validating the same scroll state on the `election` decade cards that use the same shell but different natural spacing.
- Impact: The first fix removed transparency for one path but left a visible gap in the user’s actual screenshot scenario.
- Guardrail:
  1) when a sticky overlap bug is reported with a screenshot, reproduce on the exact card title/family shown before patching,
  2) measure both the shell and target header geometry in-browser,
  3) prefer covering the seam at the highest shared sticky layer when multiple card families can pass underneath it.

### 92) Prefer fixing sticky geometry over adding visual cover layers when the user wants true header-shell contact
- Mistake pattern: Using overlay strips on the shell/header to hide a gap before correcting the sticky offset that actually defines where the header rests.
- Impact: The UI could look better in one state but still violate the requested behavior and require a follow-up revert.
- Guardrail:
  1) when the requirement is “header stays flush to shell,” measure the sticky offset against the scroll container’s padding box first,
  2) only use cover layers as a fallback, not the primary fix,
  3) if a user asks to revert a masking layer, replace it with the underlying geometry fix in the same pass.

### 90) Performance data rollouts must be additive and validator-gated
- Mistake pattern: Treating performance-oriented data shape changes as replacements for the existing source files instead of optional accelerators.
- Impact: A bad bundle or aggregate artifact could have broken local-election loading or hidden regressions behind a new fast path.
- Guardrail:
  1) emit bundle/aggregate artifacts additively beside the existing constituency JSON primitives,
  2) validate artifact shape before use and fall back automatically when invalid or missing,
  3) verify one real date directory contains both the additive files and the unchanged constituency JSON fallback inputs after each regeneration.

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
- Impact: stale artifacts or alternate render paths can still surface `‡` in tables/animations.
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
  1) if the chamber must have a flat bottom, generate each ring on the full upper semicircle (`0..π`),
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
94. Do not call a same-name identity merge “high confidence” unless you have reviewed the full history on both sides: all parties, all constituencies, and all years. Short plausibility summaries are not enough to approve a merge safely.
95. Same-name identity fixes must support one-to-many splits on both sides of the bridge. A canonical workbook ID can require multiple historical splits, and a synthetic local workbook ID can also need a context split before any canonical remap is safe. Encode those fixes as explicit `date + constituency + party` migrations and verify them separately in the canonical workbook, downstream JSON, and local workbook.
96. Do not schedule a rewrite from an auxiliary match/review artifact alone. Before applying another person-ID merge pass, re-audit the live target workbook and confirm the supposedly stale IDs still exist there. Review workbooks drift; target artifacts decide whether a fix is still needed.
97. When a user approves a batch from an inline review table, verify the live workbook state before and after the remap run, and distinguish between a true rewrite and a no-op confirmation pass. Otherwise you risk reporting a new fix when the real outcome is that the workbook was already canonical.
98. Treat string-cleanup requests the same way as ID-fix requests: verify the live target artifact actually contains the requested bad marker before claiming a cleanup. Older review sheets can preserve stale text artifacts that no longer exist in the real workbook.
99. Grouped election families must be integrated at every layer, not just in the load path. If multiple index bodies represent one logical election family, wire the same grouping through catalogue appearance, filters, election timelines/entity aggregation, and URL restore; otherwise the data can load while the rest of the UI still behaves as if the family is fragmented.
100. URL restore for grouped geographies must search the merged constituency set, not only the seed body. If one grouped election entry can load features from sibling bodies, restoring a deep-linked selected constituency must rebuild the same merged constituency pool before matching the slug.
# 2026-03-01: For grouped local-government elections, normalize constituency names before every join and every previous-election lookup

- Symptom: `2019` local-election DEAs like `Dungannon – 6 seats` failed to match the `DEAs_2012.fgb` `FinalR_DEA` names, which broke map joins, hid `Mid Ulster`, and polluted local-election `+/-` comparisons.
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

### 106) `By Count` detailed `±%` must represent redistribution-share, not candidate-relative change
- Mistake pattern: computing count `±%` as `transfer / previous candidate total`.
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
- Impact: misleading `Total seats �` values for by-elections/recall contests.
- Guardrail:
  1) null total-seat deltas on `row.isByElection`,
  2) render null as `�`,
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
- Impact: DEAs using en dash/em dash (`�`/`�`) lose seat metadata, causing downstream seat undercounts.
- Guardrail:
  1) accept `[-��]` in seat suffix regexes,
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
  3) keep delta labels consistent (`�`) once standardized.

## 2026-03-05: Election-history baseline chain guardrail
- User correction pattern: general-election deltas must never baseline against by-elections; by-elections must baseline on prior results for the same constituency set.
- Rule: keep separate prior-row chains per comparison bucket (`allRows` and `generalRows`).
- Implementation guardrail:
  1) general rows baseline only from `generalRows`.
  2) by-elections baseline from nearest prior row containing the same constituency set; fallback to nearest prior general row containing that set.
  3) recall petitions excluded from both baseline chains.
- Verification requirement for future edits:
  - add a targeted check on a party with both by-elections and general elections to confirm general `�` values do not change when by-election rows are present.

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
  1) strip seat-count suffixes like � 7 seats / (7 seats) before keying constituency summary entries,
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
- In legacy/non-UTF-clean JS files, replace visible symbols like � with ASCII labels such as +/-, then immediately grep for accidental operator corruption (??, ?., comparison chains) before considering the change complete.
- Verification rule: after any broad text replacement in a JS file, run g for both the intended replacement text and the nearby operator forms, then run 
ode --check on every touched JS file.

## 2026-03-06: Replacement-glyph audits must cover every live renderer file, not just the first file that reproduces the symptom
- User correction pattern: fixing one table-renderer file removed some malformed labels, but another live renderer still emitted literal �, so the symptom persisted.
- Rule: when a text-rendering defect appears across multiple tables, audit all live renderer files that define table headers before declaring the fix complete.
- Guardrail:
  1) grep all live JS/CSS/HTML sources for the bad glyph and the intended replacement,
  2) distinguish live renderers from static mock pages,
  3) only mark the issue resolved after the grep shows no remaining live occurrences and syntax checks pass for all touched JS files.

## 2026-03-06: Shared table-header fixes must be verified across every live table variant that reuses the same label pattern
- User correction pattern: the election-history tables were fixed first, but the NI-wide By Party grouped header still had literal � labels and continued to surface replacement glyphs.
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
- Impact: one table inherits the other table�s sticky geometry, producing horizontally sticky columns in the wrong group.
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

### 106) When introducing map-specific overview/detail thresholds, keep the reload-band logic aligned with the file-selection logic
- Mistake pattern: changing the source-selection thresholds without updating the zoom-band change detector.
- Impact: the map can stay on the previous geometry tier even after zooming because the refresh logic does not believe the detail band changed.
- Guardrail:
  1) any map-specific threshold change must update both source selection and zoom-band transition logic,
  2) for chunked maps, verify the same map id is threaded through both `_resolveChunkFile(...)` and `_zoomBandChanged(...)`,
  3) after threshold changes, test one zoom-in across each boundary and one zoom-out back across the same boundary.

- 2026-03-08: When the user specifies an exact subgroup position in the flat catalogue TOC, do not stop at nearby ordering changes in the card list. Check the subgroup membership logic in js/ui-controller.js and make sure the item is explicitly attached to the requested heading, not merely placed adjacent to it in the master list.

- Result-table width tuning guardrail (2026-03-08): do not reuse one generic compact-width class for semantically different numeric columns. Size small integers, status counts, vote totals, percentages, and deltas separately, then bind each leaf/header/body column to the correct width class.

- Results-pane width tuning follow-up (2026-03-08): when grouped numeric columns still look too wide after assigning semantic width classes, re-check the full rendered footprint including cell padding and sort/filter button size. Tighten compact-cell padding and compact header controls, not just the declared column widths.

- Results-table sizing recurrence (2026-03-08): do not treat column width tuning as just swapping width variables. Check the combined effect of declared widths, cell padding, compact header button footprint, grouped-header colspan behavior, and sticky/flex wrappers before changing values again.

- Grouped results-table sizing fix (2026-03-08): when grouped result tables contain mixed numeric types, enforce width at the leaf-column track level with <colgroup> plus fixed layout. Per-cell width hints under 	able-layout: auto are too weak and lead to simultaneous over-wide and over-narrow columns.

- Fixed-layout results-table guardrail (2026-03-08): once grouped tables move to <colgroup> + 	able-layout: fixed, remove any inherited width/min-width: max-content and neutralize cell-level width declarations for those tables. Otherwise the browser still mixes intrinsic sizing with explicit tracks and the layout remains unstable.
- Results-table track-width guardrail (2026-03-08): once grouped results tables are truly running on fixed <colgroup> tracks, stop blaming the layout model for every remaining defect. If screenshots still show crowding or spill, measure the real value ranges and retune the track variables themselves, especially for local/district vote deltas and percentage-delta columns.
- Results-table family-width guardrail (2026-03-08): after moving grouped tables onto fixed <colgroup> tracks, do not assume one local/district width preset fits every renderer. Candidate tables and local-party tables have different numeric distributions, so tune track variables per table family rather than broadening the whole variant.
- Results-table CSS-order guardrail (2026-03-08): when replacing a legacy width system with fixed <colgroup> tracks, verify the neutralizing rule comes after the old generic cell-width rules in the stylesheet. If it appears earlier, the browser will keep using the legacy widths and the new track model will appear to have no effect.
- Results-table sizing guardrail (2026-03-08): when grouped fixed-layout results tables still require repeated manual width retuning, stop guessing CSS track values. Measure the rendered numeric content and set the <colgroup> track widths programmatically for those roles instead.
- Results-table autosizing guardrail (2026-03-08): for grouped fixed-layout tables, do not estimate compact numeric widths from text metrics plus guessed button allowances. Measure the rendered header controls and body cells from the DOM after layout instead.
- Results-table width-enforcement guardrail (2026-03-08): if grouped fixed-layout columns still do not visually adopt measured widths after sizing the <colgroup>, enforce the final width on the leaf header and body cells too. In these tables, the browser can still widen narrow numeric columns through cell layout even when the column track width is set.
- JavaScript edit guardrail (2026-03-08): after any non-trivial JS patch, do not trust a silent check result. Run 
ode --check ... 2>&1 on every startup-critical module and inspect the edited block itself for duplicate block-scoped declarations before assuming the browser failure is unrelated.
- Results-table compact-header guardrail (2026-03-08): in narrow numeric columns, do not lay out the sort/filter button as a normal flex child beside the label. Overlay it with reserved padding instead, or the button chrome will dominate the measured width and keep columns visually too wide.

- When a grouped-table width bug recurs, inspect the live sizing path for the table element itself before changing any more leaf-column widths. A fixed-layout column model cannot win while the table still has intrinsic width rules like width/min-width: max-content.


- When autosizing grouped table columns, never measure getBoundingClientRect() or wrapper scrollWidth from elements like .election-cell-wrap or .election-th-controls--compact after layout. Those wrappers can already be stretched by the table, which bakes the bad width back into the autosizer. Measure intrinsic text and button content directly instead.


97. When the user corrects disclaimer wording, use the exact requested phrasing everywhere in metadata, generated files, and UI copy. For derived/OCR text formats in this repo, the warning should read that they may contain inaccuracies and errors unless the user explicitly asks for different wording.

- Grouped results tables: if a width fix is not taking effect, inspect the sticky-column CSS layer before tuning column tracks again. Generic nth-child width/min-width rules can override measured colgroup sizing even after autosizer changes, especially on fixed grouped count tables.

- Slider-driven heavy loads: For discrete election dates, do not trigger loadElection(...) from slider input. Use input for preview-only state and commit the actual load on change/release so drag interactions do not fire intermediate destructive loads.

- When fixing time-slider/date-switch bugs, do not rely only on source reasoning. Add or update a browser regression that exercises the exact drag/selection path and a placeholder-only target date before declaring the issue fixed.


- When changing slider or async load UX, require a browser regression that forces out-of-order completions. A source-level token guard is not complete until a real browser test proves an older request cannot overwrite the latest selection.

- When changing slider or async load UX, require a browser regression that forces out-of-order completions. A source-level token guard is not complete until a real browser test proves an older request cannot overwrite the latest selection.

- When fixing shared/deep-link URL bugs, verify both URL generation and URL restoration. Add a browser regression that proves a copied URL is syntactically clean and that an already-malformed legacy URL still restores the intended state.
- For non-election timeline swaps, do not run pplyDateChange() as overlapping independent operations. Use a queued runner with latest-request-wins semantics so stale committed changes cannot overwrite the newest user selection.
- In Playwright for this repo, avoid page.waitForFunction(async ...) with dynamic imports / async polling. Use explicit page.evaluate(async () => { ...poll... }) so browser tests do not fail for harness reasons unrelated to product behavior.

- When fixing results-table text truncation, inspect both the wrapper class and the autosizer cap for that role. If the wrapper still clamps or the autosizer refuses to grow the track past its current computed width, widening the column will not stop ellipsis.

- When catalogue items appear "missing" under search, inspect the search predicate before assuming data failed to load. In this repo, books are rendered through separate catalogue paths, so search matching must include category metadata and generic labels like `book` / `document`, not just title/author/keywords.

- Broader performance rollouts must be existing-asset-only and representative-tested. Do not enable `useLOD` broadly on assumption; first inventory the exact safe set with matching `-lod0/-lod1` files on disk, enable only that set, and verify across representative map families in the browser before calling the rollout safe.

- Asset-export workflow guardrail (2026-04-12): when a user asks for final image assets, avoid leaving repo-local temporary export scaffolds behind unless they are explicitly wanted as deliverables. Prefer ephemeral tooling or remove any helper files before closing the task.

- Catalogue detail history guardrail (2026-04-14): when a detail view can be opened from a `click` handler on an element users may naturally double-click, do not rely on the event layer to deduplicate opens. Guard the history write path itself so repeated consecutive opens of the same `detailId` collapse to one entry, then verify Back returns to the previous page with a single click.

- Party-label audit guardrail (2026-05-19): when a ranked election-label table surfaces obvious presentation variants such as `Green/Comhaontas Glas`, `Independent Lozenge`, or punctuation-only unionist abbreviations, add the alias to both the source normalizer and the derived party-ID/audit helpers before presenting the next ranking. Otherwise the same variants keep reappearing in larger top-N tables.

- Party-label normalization guardrail (2026-05-19): for ambiguous short labels in ranked tables, prefer exact-label rules unless the user explicitly requests substring cleanup. Examples: `Nationalist -> Nationalist Party` must not rewrite `Independent Nationalist`, and `Labour -> Irish Labour` must not rewrite Northern Ireland Labour labels.

- Party-label tail cleanup guardrail (2026-05-19): when the top-N table is expanded repeatedly, keep adding exact long-form aliases to the normalizer and Party ID groups in the same turn. Long-form suffix variants like `SDLP (Social Democratic and Labour Party)` and coalition display names like `Democratic Left / New Agenda` should not be left for a separate cleanup pass once identified.

- Party-label context guardrail (2026-05-19): when a user gives a conditional party normalization, do not force it into a static global alias. Add the minimum election-context signal to the normalizer, then verify both branches. Example: `Rep Clubs` can mean `Workers' Party` only where Workers' Party candidates stood in the same election; otherwise keep it with `Republican Clubs`.

- Party-label variant guardrail (2026-05-25): when a user names a long-form party label that has already partly appeared in the ranked table, scan for close punctuation/order variants in the same batch. Examples: SDLP long-form labels can appear as `SDLP (...)`, `Social Democratic and Labour Party (SDLP)`, a hyphenated form, or with a missing parenthesis; Workers' Party can appear as a bare possessive plus `Lozenge`.

- Zip/map review temp-space guardrail (2026-05-25): when reviewing external archives in this repo, use a repo-local scratch folder such as `tasks/idb-review-temp` unless the user explicitly asks for a system temp path. Do not depend on `C:\tmp` being usable just because it appears in writable roots.

- County catalogue ingestion guardrail (2026-05-26): when adding historically distinct county datasets, do not hide them solely as variants of the modern all-island county map. Add them as direct members of the County catalogue class when the user expects separate catalogue entries, then verify the class `maps` array and rendered card membership rather than only checking `getMapById()` resolution.
- Heavy map asset cache guardrail (2026-05-26): when regenerating chunked/LOD assets that are already public behind Cloudflare/R2, use versioned filenames for the regenerated base, LOD, and chunk files or explicitly purge the CDN. Verify public range GET sizes, not only R2 HEAD or local file existence, before asking for production/mobile testing.

- MapLibre tile-template guardrail (2026-05-26): do not pass `{z}/{x}/{y}` tile URL templates through `new URL(...).toString()`, because it percent-encodes braces and MapLibre then requests literal `%7Bz%7D/%7Bx%7D/%7By%7D` paths. Preserve the template placeholders when making relative tile URLs absolute, and verify live network requests contain real z/x/y tile coordinates before saying a vector-tile layer renders.

- GDAL MVT low-zoom completeness guardrail (2026-05-26): when generating boundary vector tiles from dense polygon datasets, do not accept GDAL MVT defaults without checking low-zoom feature counts. The default maximum tile size/resolution fallback can silently encode low-zoom tiles with missing or over-reduced features. For correctness-first pilot tiles, set explicit `MAX_SIZE`, `MAX_FEATURES`, and simplification options, then compare representative low/mid-zoom tile feature counts against the source coverage before deployment.

- Vector-tile correctness/performance guardrail (2026-05-26): after fixing missing features by raising MVT tile limits, also verify representative tile byte sizes and pointer interaction latency. Completeness checks alone can produce oversized tiles that render correctly but make mobile/desktop hover and click feedback lag. For interactive boundary layers, preserve feature counts while using zoom-appropriate geometry simplification and avoid per-mousemove filter updates unless throttled.

- Cloudflare Pages file-cap guardrail (2026-05-27): when a deploy fails on the 20,000-file limit, verify tracked file counts by directory before asserting the fix. Removing one generated tile directory may leave the repo/output just under or still over the cap after build output; check all tile pyramids, metadata fallback references, and the configured Pages output directory before recommending cleanup or R2 migration.

- MapLibre rewrite shell-parity guardrail (2026-05-29): for the `/test` rewrite, stop treating the main navbar/catalogue as a visual reference to approximate. The target architecture should reuse the main shell/catalogue contract and mount MapLibre behind a map-engine adapter, so only Leaflet-specific map operations are replaced.

- Test2 selected-feature parity guardrail (2026-05-29): when adapting Leaflet feature interactions to MapLibre, do not invent a separate selected outline style. If the main site uses orange fill/stroke/label treatment for interactive feedback, selected MapLibre state should persist that same treatment with `feature-state: selected`, including polygon fill, stroke, and DOM label classes. Add static and browser checks for selected state, not just hover.

- Test2 fill-opacity parity guardrail (2026-05-29): ordinary MapLibre vector polygon fills must default to transparent to match the main Leaflet site. Preserve explicit per-map `style.fillOpacity` values, but never add a generic semi-opaque fallback such as `0.18`; guard this with static validation and a browser check on a representative boundary layer.

- PMTiles render-validation guardrail (2026-05-30): do not treat a generated PMTiles archive as production-ready merely because `ogrinfo`, byte-range checks, or metadata validation pass. A PMTiles archive can validate structurally and still fail to render in MapLibre at the representative mobile viewport. For every new or retuned PMTiles build path, run a browser/mobile smoke that proves visible feature rendering for at least one relevant viewport before switching metadata to prefer the archive.

- Feature-index rebuild guardrail (2026-05-30): when rebuilding `/test` feature-search indexes, verify the number of indexes written and the expected layer-specific index counts before accepting the run. If a sandboxed run deletes old indexes and rebuilds zero because GDAL field inspection is blocked, rerun with the correct permissions and do not leave metadata pointing at missing indexes.

- All-layer mobile-smoke guardrail (2026-05-30): total smoke-test budgets must scale with the number of converted layers. A fixed total timeout that was reasonable for 18 PMTiles layers becomes obsolete after hundreds of layers are converted; keep strict per-layer budgets, but compute the total budget from the candidate layer count unless an explicit override is supplied.

- PMTiles deployment-order guardrail (2026-05-30): after regenerating PMTiles, follow the full sequence `build archives -> build CDN manifest -> upload -> byte-range verify -> switch metadata to CDN`. PMTiles metadata can revert to local repo paths during rebuilds, so do not call CDN deployment complete until `maps-test.json` contains CDN URLs for all expected PMTiles layers and no local PMTiles URLs remain.

- Test2 election parity guardrail (2026-05-31): when the user asks to close remaining election parity gaps, do not stop at broad workflow parity. Inspect generated bundle correctness as well as UI code; repeated source statuses such as `Not Elected` can be misclassified by loose `/elected/` matching and then corrupt seat counts, overlays, winners, and entity pages across `/test2`.
- Test2 mobile hover cleanup guardrail (2026-05-31): mobile browsers may keep synthetic hover UI alive after taps because `mouseleave` is not a reliable cleanup signal. Any catalogue thumbnail or map-hover UI that can be shown by hover must also have a document-level outside tap/pointer cleanup path and a browser/static guardrail.
- Test2 seat-circle parity guardrail (2026-05-31): when matching main-site election overlays in MapLibre, copy the Leaflet overlay semantics, not just the visible idea. Seat dots should use the shared main seat-position algorithm, fixed pixel sizing, pixel offsets around the anchor, and main-style halo/border treatment; degree-based offsets and zoom-scaled circle radii drift from the main site.
- Test2 election residual guardrail (2026-05-31): do not leave a generated election unmatched row classified as `blocked-on-implementation` if a faithful synthetic map artefact can represent it without inventing source boundaries. For regional/top-up results with no per-feature polygon, derive a bounded synthetic anchor from the selected source layer and add validation that the generated report has no implementation-blocked residuals.

### 128) Main parity work must not mutate main unless explicitly requested
- Mistake pattern: Trying to close `/test2` parity gaps by introducing shared renderer/domain wiring into main runtime files.
- Impact: The user wants main as the fixed reference implementation; changing it undermines parity comparison and risks production behaviour.
- Guardrail:
  1) for `/test2` parity requests, treat main runtime files as read-only reference unless the user explicitly asks to change main,
  2) implement alignment in `/test2` adapters/renderers and `/test2` generated artifacts,
  3) tests should compare `/test2` against main contracts without requiring main code changes.

### 129) Screenshot parity gaps require contract reuse, not visual approximation
- Mistake pattern: Repeatedly responding to main-vs-`/test2` screenshots with isolated CSS/data tweaks instead of treating the screenshot as evidence that `/test2` is still running a different catalogue/election/map contract.
- Impact: The page can pass local guardrail tests while still looking and behaving differently in the exact user-visible comparison, especially for viewport restore, map framing, election table values/order, label density, and seat-circle placement.
- Guardrail:
  1) before claiming parity, reproduce the same URL/state on main and `/test2` in side-by-side screenshots,
  2) identify every visible difference as either intentional MapLibre architecture or a failing parity item,
  3) fix parity by reusing or mirroring the main shell/election view-model contracts in `/test2`, not by hand-tuning symptoms,
  4) add visual/DOM assertions for the exact compared state, including map center/zoom, catalogue active row position, election pane first rows/values, and overlay counts/positions.

### 130) Test2 election paint parity must mirror main constants
- Mistake pattern: Treating `/test2` election polygon styling as an independent MapLibre design surface, using approximate fill opacity, stroke colour, and zoom-varying stroke width instead of the main election layer paint contract.
- Impact: Election entries can load and function correctly but still visibly disagree with main in the screenshots the user is using as the acceptance criterion.
- Guardrail:
  1) read main `ElectionController` paint constants before adjusting `/test2` election style,
  2) encode those constants in `/test2` as a named contract rather than scattered literals,
  3) keep hover/selected orange interaction styling separate from base election styling,
  4) add static/browser checks for fill colour fallback, matched fill opacity, unmatched fill opacity, stroke colour, stroke opacity, and stroke width.

### 131) Test2 election pane parity must compare public DOM contracts
- Mistake pattern: Trying to prove `/test2` election pane parity by inspecting private main controller internals or by using cleaner normalized election data than the main site visibly renders.
- Impact: Tests can either fail for harness reasons or pass while `/test2` still disagrees with main's legacy scraper/pseudo-count candidate and count pane semantics.
- Guardrail:
  1) treat the main page's public DOM and public UI methods as the parity oracle,
  2) generate explicit main-like sidecars for `/test2` whenever main's visible pane uses legacy or synthetic data semantics,
  3) keep MapLibre-specific code at the drawing/selection boundary only,
  4) add focused public-DOM comparisons for each representative election pane state before claiming parity.

### 132) For exact election pane parity, stop hand-porting render branches
- Mistake pattern: Continuing to patch individual `/test2` election pane differences branch by branch after the user has shown repeated visible discrepancies.
- Impact: Each patch can fix one table or mode while another main-specific branch remains different, because `/test2` still owns a separate election pane implementation.
- Guardrail:
  1) make the main election pane renderer/view-model the source contract for `/test2`,
  2) extract or mirror main pane methods behind a host adapter instead of reimplementing them in `Test2ElectionManager`,
  3) keep only map-engine operations, feature selection, and overlay drawing in the `/test2` MapLibre adapter,
  4) reject "as-is" copying only where the code calls Leaflet/main globals directly, and wrap those calls with explicit adapter methods.

### 133) Login feasibility means contribution governance, not just account UI
- Mistake pattern: Treating user login/logout as optional cosmetic account infrastructure before checking whether the user intends authenticated editing or uploads.
- Impact: The architecture recommendation can understate the need for roles, audit logs, review queues, upload validation, and protection against direct production data mutation.
- Guardrail:
  1) when login is proposed for Civgraph, ask or infer whether authenticated users will edit data, submit corrections, upload maps, or access admin workflows,
  2) if edits/uploads are involved, recommend staged submissions plus approval/publish pipelines,
  3) keep production static data immutable from ordinary user sessions,
  4) separate contributor permissions from admin publish permissions.

### 134) Browse thumbnail quality requires visual cartographic checks, not asset existence
- Mistake pattern: Counting generated thumbnail assets as coverage while the rendered asset still has a transparent/checkerboard background, weak or invisible land context, or a projection/crop that does not read as a proper map.
- Impact: Browse map pages can technically have thumbnails but still look unfinished or distorted, especially for historic boundary maps where the user expects grey Ireland/Britain/island/Europe underlay context.
- Guardrail:
  1) thumbnail generation must use an explicit cartographic projection appropriate to the visible geographic scope,
  2) rendered thumbnail images must have an opaque light basemap background and grey land underlay, not depend on page CSS checkerboards,
  3) detail-page smoke checks must inspect representative thumbnail pixels or screenshots for visible land/background, not only manifest presence,
  4) map Browse detail layout should be reviewed visually as an information page, not accepted because raw fields are technically present.

### 135) Thumbnail land underlays need context-frame verification
- Mistake pattern: Fixing thumbnail transparency by drawing land underlay, but framing the thumbnail so tightly to the feature bounds that the land appears as cropped, misshapen grey fragments.
- Impact: The generated thumbnail is technically opaque and has land pixels, but visually looks wrong and undermines Browse page quality.
- Guardrail:
  1) use a familiar web-map projection for thumbnails unless a specific dataset requires otherwise,
  2) apply a minimum context span around small/high-level maps so Britain/Ireland/islands/coastline read as land context rather than blobs,
  3) visually inspect the representative asset after generation, not just alpha/colour histograms,
  4) stop any broad thumbnail regeneration immediately if the first representative thumbnail fails the visual check.

### 136) Thumbnail context floors must be adaptive
- Mistake pattern: Fixing a cropped/misshapen land underlay with a single large minimum context span for every non-local map.
- Impact: Small or regional boundary maps become tiny within the thumbnail, with excessive empty sea/land around the actual features.
- Guardrail:
  1) use an adaptive context span based on feature extent and catalogue scope rather than one global floor,
  2) cap all-island/regional locator context so the feature footprint remains visually dominant,
  3) visually inspect both the grey underlay shape and the feature-to-canvas ratio before committing,
  4) do not regenerate the full thumbnail set from a representative fix until the representative thumbnail passes both checks.

### 137) Thumbnail framing needs an explicit feature-footprint target
- Mistake pattern: Treating adaptive regional context as sufficient when the rendered thumbnail still leaves too much empty canvas around the actual boundary features.
- Impact: The land underlay is recognizable, but the item being browsed is visually secondary and the thumbnail still looks poorly framed at catalogue size.
- Guardrail:
  1) add a measurable feature pixel-footprint target for representative thumbnails, not only a context-span heuristic,
  2) regional maps such as NI-only administrative areas should use a tighter locator frame than all-island maps,
  3) validate generated thumbnails at their displayed Browse size as well as at source asset size,
  4) if a feature occupies too little of the square canvas, reduce context or shift to a tighter crop before broad regeneration.

### 138) Regenerated thumbnails need URL invalidation
- Mistake pattern: Regenerating same-name thumbnail assets and assuming production users will see the new pixels immediately.
- Impact: Browser/CDN cache can keep showing the old asset, making a real generated fix appear unchanged on the live site.
- Guardrail:
  1) whenever a same-path thumbnail asset is materially changed, also advance the Browse thumbnail URL version or use a fingerprinted asset path,
  2) apply versioning to `src`, `srcset`, and "open actual size" links,
  3) verify the rendered HTML requests the versioned asset, not just that the local file changed,
  4) prefer runtime asset URL versioning over broad generated Browse JSON rewrites unless the data contract itself changed.

### 139) Browse public pages must not expose generated record internals as primary content
- Mistake pattern: Treating a locally verified Browse renderer change as sufficient when production still served the old renderer, and leaving runtime/catalogue flags such as `Featured` and `Loadable` visible in public map overview badges.
- Impact: The live Browse page still looked like a generated technical record, with internal IDs, JSON-ish fields, and runtime flags shown as ordinary user-facing information.
- Guardrail:
  1) for Browse information-architecture fixes, verify the exact production URL as well as the local route before saying the issue is fixed,
  2) keep `All Browse Fields`, raw source metadata, IDs, generated URLs, label properties, spatial indexes, `featured`, and `loadable` under a collapsed technical details section,
  3) public Browse panels should prioritize description, date, category/group, provider/credits, status, sources/references/downloads, variants, and related entries,
  4) if production differs from local, identify whether the change is uncommitted/unpushed, cached, or served from a different asset path before making further visual claims,
  5) when changing standalone Browse assets, version the `browse.js`/`browse.css` includes as well as any thumbnails because Cloudflare can cache those files independently of the hash-route HTML.

### 140) Test2 election pane parity needs shared-source enforcement
- Mistake pattern: Leaving `/test2` with a local election-pane wrapper after deciding the main election pane is the parity reference.
- Impact: Even if individual table methods are copied from main, the wrapper can keep adding route-specific title text, stats strips, attributes, or tab behaviour that visibly diverges from the main site.
- Guardrail:
  1) put engine-neutral election pane contracts in `js/`, not only under `test2/src/`,
  2) make `/test2` instantiate the shared contract directly and keep the local file as a compatibility re-export only,
  3) make `check:test2` inspect the shared source and the test2 instantiation path,
  4) remove route-specific selected-result chrome unless it is explicitly present in main's public pane.

### 142) Commit and push should be the default completion step
- Mistake pattern: Waiting for a separate explicit commit/push request after completing and verifying non-sensitive site changes.
- Impact: The user sees local fixes described as complete but not live, adding avoidable back-and-forth and delaying production verification.
- Guardrail:
  1) after verified non-sensitive changes, stage the relevant files, commit, and push without waiting for a separate instruction,
  2) do not commit or push private, sensitive, secret, credential, or clearly unrelated local changes,
  3) obey any explicit user instruction not to commit/push for a specific task,
  4) report the commit hash and push result in the final response.

### 141) Election transfer parity requires the main animation payload contract
- Mistake pattern: Treating visible election pane sharing as sufficient while leaving `/test2` with a simplified transfer-animation data path.
- Impact: The tab chrome can look close to main, but the Transfers tab still displays a no-data message because `stages2.js` needs a main-shaped `{ Constituency: { countInfo, countGroup } }` payload.
- Guardrail:
  1) generated `/test2` election bundles must carry the main animation payload shape for every result that main would animate,
  2) scraper-style result files must be normalised into the same synthetic count payload main uses, not passed through raw,
  3) `/test2` must auto-run the persistent animation scaffold when the Transfers tab is selected,
  4) `check:test2` must assert a known screenshot case, Dáil 2024 Mayo, has a multi-stage animation payload.
### 143) Pushed fixes must verify the deploy command, not only the edited route
- Mistake pattern: Passing the route-specific check/build for `/test2` and pushing, while the actual deployment/run can execute a broader or different command path.
- Impact: A local fix can be correct for the edited bundle but still trigger a failed run notification after push.
- Guardrail:
  1) when a pushed site change affects bundled assets, run both the route-specific check and the production deploy command path where feasible,
  2) if a sandbox blocks the production command, rerun with approved escalation rather than treating the route-specific build as sufficient,
  3) inspect the exact failed run/deploy log before assuming the failure is unrelated,
  4) browser smoke tests must exercise production-deployable PMTiles/CDN sources, not force local directory-MVT fallbacks that are removed by Pages cleanup,
  5) mobile/browser smoke defaults must be CI-bounded, with exhaustive all-layer runs behind an explicit opt-in env var,
  6) add a validation check for the failing command path before committing the fix.

### 144) Test builds must produce every asset their smoke page references
- Mistake pattern: Letting `/test/index.html` reference generated production shell CSS while `build:test` only generated the `/test` bundle.
- Impact: Local verification passed because `build/main.critical.css` and `build/main.css` happened to exist from earlier production builds, but a clean CI checkout 404ed those files and failed the mobile smoke job.
- Guardrail:
  1) any route-specific build used by CI must generate every same-origin asset referenced by its smoke-test HTML,
  2) clean-checkout assumptions should be preferred over local worktree assumptions when debugging CI failures,
  3) smoke tests should log failed response URLs and status codes, not only generic browser console text,
  4) if a route intentionally shares main-shell assets, its route build should either generate those assets or the CI workflow should explicitly run the shared asset build first.

### 145) Representative mobile smoke budgets must account for CI runner variance
- Mistake pattern: Treating a locally passing `5000ms` layer-load cap as stable for a huge representative PMTiles layer on GitHub-hosted runners.
- Impact: The mobile smoke script loaded and rendered every representative layer, with no console or network errors, but still failed because `roi-townlands-vector-test` exceeded the local-tuned cap by 159ms in CI.
- Guardrail:
  1) keep exhaustive or stricter performance checks available through explicit environment overrides,
  2) set the default representative smoke threshold from observed CI behaviour, not only local workstation timings,
  3) when a smoke failure reports successful render plus a small timing overrun, distinguish performance-budget tuning from functional layer failure,
  4) keep the large-layer representative in the suite, but give it a budget that avoids flaky failures on slower hosted runners.

### 146) Test2 election pane parity must use main pane semantics, not generally better normalized semantics
- Mistake pattern: Using a shared helper that normalizes election status values more broadly than the main selected election pane does.
- Impact: `/test2` can show internally sensible results, but still diverge from main visually and numerically for the same selected constituency, such as treating `Made Quota` rows as elected in a selected party table when main does not.
- Guardrail:
  1) selected election pane rendering should use main-pane-specific status rules, even where MapLibre overlays use richer election-domain extraction,
  2) validation must include named screenshot cases, not only generic table class/header checks,
  3) when a user reports visual parity drift, inspect row-level data and rendered DOM before making further CSS changes,
  4) keep MapLibre-specific differences confined to map drawing and feature selection, not the election pane's view-model semantics.

### 147) Selected election pane parity requires exact main row admissibility
- Mistake pattern: Treating a generated `/test2` count row as valid because it has a candidate id and party, while main's election controller also requires a displayable candidate name.
- Impact: `/test2` can show more complete or sensible selected-constituency party rows than main, but that is still a parity failure when the goal is exact main behaviour with only the map engine swapped.
- Guardrail:
  1) selected-result row filtering must mirror main `_isValidCandidateRow`, including candidate-display-name requirements,
  2) parity tests must compare selected-result table DOM against main for named screenshot cases, not just overall election tables,
  3) do not claim full parity from source-shape checks alone; require runtime DOM comparison for the specific panes the user is comparing,
  4) any `/test2` election improvement that changes visible pane data must first prove it matches main or be deliberately scoped as a MapLibre-only/map-only difference.

### 148) General /test2 parity claims need a matrix and runtime audit
- Mistake pattern: Answering a general parity question from the strength of a narrow election-pane regression suite.
- Impact: The user can reasonably infer that all main-vs-`/test2` behaviours are proven when only one repeated failure class has strong evidence.
- Guardrail:
  1) separate narrow pane parity from general site parity in all explanations,
  2) keep a committed parity matrix that classifies must-match, MapLibre-equivalent, acceptable engine difference, and blocked-on-data areas,
  3) run a representative browser audit before saying general parity is achieved,
  4) report any untested area as unproven rather than implicitly covered by adjacent tests.

### 149) Election pane parity must not preserve source-data errors
- Mistake pattern: Treating `mainLikePartySummary` as the visible truth for `/test2` Dail elections because it matched the main pane contract, even when the helper was deriving totals incorrectly from ElectionsIreland scraper-shaped records.
- Impact: `/test2` can faithfully reproduce a main-compatible table while showing wrong party stood/vote/seat totals for Irish general elections, especially where scraper records use `final_count` as a terminal status/count indicator rather than a full transfer-table count number.
- Guardrail:
  1) for generated election bundles, validate visible summaries against source-shape-aware totals before parity checks,
  2) scraper-shaped records with `meta` + `candidates` need their own summary path based on contested `first_pref`, explicit candidate status, and automatic Ceann Comhairle return handling,
  3) transfer-table semantics should only be applied to true `Constituency.countGroup` payloads,
  4) route validation must include known Dail 2024 aggregate totals and a cross-election drift audit for ElectionsIreland-derived entries.

### 150) Election parity tests must assert known external truth
- Mistake pattern: A browser regression compared main and `/test2` election panes without asserting the actual 2024 Dáil values from Wikipedia/Oireachtas-style summaries, so equal-but-wrong panes were treated as passing.
- Impact: A user could still see impossible rows such as Fine Gael `42` seats from `11` candidates even though the parity test was green.
- Guardrail: for high-value election fixtures, browser tests must assert at least the top headline rows and totals from an external reference in addition to cross-route parity; use Unicode escapes for party names with accents in test literals to avoid mojibake.

### 151) Fixes are not delivered until commit and push are verified
- Mistake pattern: Completing implementation and validation locally, then discussing the fix as if it were delivered while it still exists only in the dirty working tree.
- Impact: The user cannot see the correction on the remote site or branch, and follow-up work risks mixing intended fixes with unrelated dirty/generated files.
- Guardrail: after any user asks whether a fix is committed or requests delivery, immediately check `git log`, `git status --branch --short`, and `git diff --cached --name-only`; stage only the intended files, commit, push, and report the commit hash plus remote branch.
