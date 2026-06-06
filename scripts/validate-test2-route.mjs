#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const failures = [];
const index = readFileSync('test2/index.html', 'utf8');
const appSource = readFileSync('test2/src/app.js', 'utf8');
const adapterSource = readFileSync('test2/src/maplibre-main-adapter.js', 'utf8');
const electionManagerSource = readFileSync('test2/src/election-manager.js', 'utf8');
const electionPaneContractSource = readFileSync('test2/src/election-pane-main-contract.js', 'utf8');
const mainElectionPaneContractSource = readFileSync('js/election-main-pane-contract.mjs', 'utf8');
const electionDomainSource = readFileSync('js/election-domain.mjs', 'utf8');
const electionViewModelSource = readFileSync('js/election-view-model.mjs', 'utf8');
const electionRendererSource = readFileSync('js/election-renderer.mjs', 'utf8');
const electionControllerSource = readFileSync('js/election-controller.js', 'utf8');
const electionManifestBuilderSource = readFileSync('scripts/build-test2-election-manifest.mjs', 'utf8');
const uiControllerSource = readFileSync('js/ui-controller.js', 'utf8');
const mapControllerSource = readFileSync('test/src/map-controller.js', 'utf8');
const labelsSource = readFileSync('test/src/labels.js', 'utf8');
const featureRepairsSource = readFileSync('test/src/feature-property-repairs.js', 'utf8');
const test2Css = readFileSync('test2/src/test2.css', 'utf8');
const packageJsonSource = readFileSync('package.json', 'utf8');
const portPlan = JSON.parse(readFileSync('test/metadata/main-site-port-plan.json', 'utf8'));
const testMetadata = JSON.parse(readFileSync('test/metadata/maps-test.json', 'utf8'));

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function mainSelectedPaneStatusKind(status) {
  const text = String(status || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('not elected')) return 'not_elected';
  if (text.includes('excluded')) return 'excluded';
  if (text.includes('elected')) return 'elected';
  return 'unknown';
}

assert(index.includes('<base href="/">'), '/test2 must keep root-relative production assets via <base href="/">');
assert(existsSync('docs/test2-general-parity-matrix.json'), '/test2 general parity matrix is missing');
assert(existsSync('scripts/audit-test2-general-parity.mjs'), '/test2 general parity audit script is missing');
assert(packageJsonSource.includes('"audit:test2:parity"'), '/test2 general parity audit must be exposed through package scripts');
assert(index.includes('/test2/build/test2.bundle.js'), '/test2 must load its own MapLibre bundle');
assert(index.includes('/test2/build/test2.bundle.css'), '/test2 must load its own MapLibre CSS bundle');
assert(!index.includes('leaflet-1.9.4'), '/test2 must not load Leaflet assets');
assert(!index.includes('build/app.bundle.js'), '/test2 must not load the production app bundle');
assert(!index.includes("register('/sw.js'"), '/test2 must not register the production service worker');
assert(index.includes('class="app-header"'), '/test2 must preserve the production header shell');
assert(index.includes('class="pane pane--info"'), '/test2 must preserve the production catalogue pane');
assert(index.includes('class="pane pane--map"'), '/test2 must preserve the production map pane');
assert(index.includes('id="catalogueFlatView"'), '/test2 must preserve production catalogue containers');
assert(appSource.includes('installRouteGuard()'), '/test2 must install the hash route guard before shell boot');
assert(appSource.includes('preserveCurrentPath'), '/test2 hash-only URL updates must preserve the current path');
assert(appSource.includes("a[href^=\"#\"]"), '/test2 must intercept hash-only catalogue anchors under <base href="/">');
assert(appSource.includes("params.has('lng') && params.has('lat')"), '/test2 must not treat missing viewport URL params as 0,0');
assert(appSource.includes("params.set('hidden', hidden.join(','))"), '/test2 URL state must preserve loaded-but-hidden layers');
assert(appSource.includes("params.set('detail', this.currentDetailMapId)"), '/test2 URL state must preserve catalogue detail views');
assert(appSource.includes("params.set('source', this.currentSourceMapId)"), '/test2 URL state must preserve source panel views');
assert(appSource.includes("params.set('electionBody', electionState.body)") && appSource.includes('restoreURLState?.(params)'), '/test2 URL state must preserve and restore active election body/date/substate');
assert(appSource.includes('installCatalogueStateBridge'), '/test2 must bridge production catalogue detail navigation into URL state');
assert(appSource.includes('setupURLStateListener'), '/test2 must restore state on hash navigation, not only first boot');
assert(appSource.includes('setActiveLayersPanelOpen') && appSource.includes('setMapControlsOpen'), '/test2 panel restore must set panel state directly instead of click-toggling');
assert(appSource.includes('applyBaseMap') && appSource.includes('isStyleLoaded'), '/test2 restored base-map state must wait for the MapLibre style to load');
assert(appSource.includes('setupSourcePanel') && appSource.includes('renderSourcePanel'), '/test2 must expose source metadata for active/restored layers');
assert(test2Css.includes('.test2-source-panel'), '/test2 source panel must have scoped route CSS');
assert(test2Css.includes('position: fixed') && test2Css.includes('z-index: 520'), '/test2 source panel must sit above restored map overlay panels');
assert(appSource.includes('getConvertedCompositeChildIds'), '/test2 must expand converted child sources when a main catalogue parent lacks a direct converted layer');
assert(appSource.includes('compositeSources') && appSource.includes('mapConfig.variants.map'), '/test2 composite fallback must cover main composite sources and non-group variant parents');
assert(buildPlanSourceIncludesCompositeCoverage(), '/test2 port-plan generation must classify converted composite/alias rows without reintroducing false conversion gaps');
assertPoint2Coverage();
assert(mapControllerSource.includes('maplibre-dom-label'), '/test2 must use deduplicated DOM labels for main-site label interaction parity');
assert(mapControllerSource.includes("'text-opacity': 0"), '/test2 native MapLibre symbol labels must stay visually hidden to avoid duplicate labels');
assert(adapterSource.includes('installMainStyleMapControls') && test2Css.includes('.test2-main-zoom-control'), '/test2 must replace visible MapLibre zoom controls with main-style custom controls');
assert(adapterSource.includes('leaflet-control-compass') && adapterSource.includes("map.easeTo({ bearing: 0, pitch: 0") && test2Css.includes('.test2-main-zoom-control__compass'), '/test2 custom main-style map controls must include a compass/reset-north button beside zoom');
assert(adapterSource.includes('.maplibregl-ctrl-scale') && adapterSource.includes('element.remove()'), '/test2 must remove native MapLibre controls after boot so only main-style map controls remain visible');
assert(test2Css.includes('#map .maplibregl-ctrl-top-left') && test2Css.includes('display: none') && test2Css.includes('#map .maplibregl-ctrl-bottom-right'), '/test2 route CSS must hide native MapLibre control containers while custom main-style controls are installed');
assert(mapControllerSource.includes("this.map.on('dblclick', onDoubleClick)"), '/test2 feature geometry selection must be wired to double-click');
assert(mapControllerSource.includes('this.map.doubleClickZoom?.disable()'), '/test2 must disable MapLibre double-tap zoom so mobile feature taps can open details');
assert(mapControllerSource.includes("this.map.on('click', onClick)"), '/test2 feature geometry selection must be wired to ordinary tap/click as well as double-click');
assert(appSource.includes('relocateMobileCatalogueToggle') && appSource.includes('mobile-toggle--navbar'), '/test2 must move the mobile catalogue toggle into the navbar instead of leaving it as a floating map overlay');
assert(test2Css.includes('.app-header #mobileToggle.mobile-toggle.mobile-toggle--navbar') && test2Css.includes('position: static !important'), '/test2 mobile catalogue toggle must be styled as a navbar control on mobile');
assert(!test2Css.includes('bottom: 14px !important'), '/test2 mobile catalogue toggle must not be restored to the bottom-right map overlay position');
assert(test2Css.includes('#map .timeline-slider') && test2Css.includes('pointer-events: none'), '/test2 timeline chrome must not block feature labels except on real timeline controls');
assert(test2Css.includes('.maplibre-dom-label.map-label--hover'), '/test2 DOM labels must expose hover styling');
assert(test2Css.includes('.maplibre-dom-label.map-label--selected'), '/test2 selected DOM labels must keep the same orange styling as hover labels');
assert(test2Css.includes('color: #ff7a1a !important'), '/test2 hovered labels must change text colour directly like the main site');
assert(mapControllerSource.includes("const INTERACTION_FILL_COLOR = '#FDBA74'"), '/test2 selected and hover fills must share the main-style light orange colour');
assert(mapControllerSource.includes("const INTERACTION_STROKE_COLOR = '#FF7A1A'"), '/test2 selected and hover strokes must share the main-style deep orange colour');
assert(mapControllerSource.includes('selectedFillId') && mapControllerSource.includes("['feature-state', 'selected']"), '/test2 polygon selections must include a selected fill, not only an outline');
assert(mapControllerSource.includes('Polygon vector-tile features are clipped at tile boundaries'), '/test2 polygon interaction strokes must stay disabled to avoid tile-seam highlight artifacts');
assert(mapControllerSource.includes("'fill-antialias': false"), '/test2 polygon interaction fills must disable antialiasing to avoid tile-fragment seam lines');
assert(!mapControllerSource.includes("'line-color': '#111827'") && !mapControllerSource.includes("'circle-color': '#111827'"), '/test2 selections must not use the old thick black selected styling');
assert(mapControllerSource.includes('loadDuplicateFeatureIds') && mapControllerSource.includes('duplicateIds?.has(String(id))'), '/test2 must avoid MapLibre feature-state cross-highlighting when a source has duplicate promoted feature IDs');
assert(adapterSource.includes('normalizeRenderedFeature(selection.feature') && adapterSource.includes('this.options.enrichFeature'), '/test2 feature selections must pass normalized nested properties/geometry to main feature-info rendering');
assert(adapterSource.includes('const OVERLAY_LAYERS') && adapterSource.includes('showOverlay(overlayId)') && adapterSource.includes('hideOverlay(overlayId)'), '/test2 adapter must support existing raster overlay toggles');
assert(!adapterSource.includes('toggleOverlay() {\n    return false;\n  }'), '/test2 overlay toggles must not remain stubbed');
assert(adapterSource.includes('applyPartialFeatureFilter') && adapterSource.includes('buildFeatureFilter'), '/test2 adapter must implement partial feature visibility with MapLibre filters');
assert(!adapterSource.includes('togglePartialFeature() {}') && !adapterSource.includes('unloadPartialFeature() {}'), '/test2 partial feature load/visibility methods must not remain empty stubs');
assert(adapterSource.includes('normalizeRenderedFeature') && adapterSource.includes('featureName') && adapterSource.includes('properties,'), '/test2 loaded/query feature results must include rich normalized feature payloads');
assert(mapControllerSource.includes('const DEFAULT_VECTOR_FILL_OPACITY = 0'), '/test2 ordinary MapLibre polygon fills must default transparent like the main Leaflet site');
assert(mapControllerSource.includes("'fill-opacity': resolveFillOpacity(layer)"), '/test2 fill layers must resolve opacity from explicit map style before falling back to transparent');
assert(adapterSource.includes('_fillOpacity: resolveFillOpacity(layer)'), '/test2 main-shell layer state must preserve explicit fill opacity and default ordinary fills to transparent');
assert(appSource.includes('getMainMap: (mapId) => dataService.getMapById(mapId)'), '/test2 adapter must receive main-site map config so style parity is based on the source catalogue');
assert(adapterSource.includes('applyMainStyle(layer, mainConfig') && adapterSource.includes('delete style.fillOpacity'), '/test2 must discard converted-metadata fill opacity when the main catalogue has no explicit fill opacity');
assert(!mapControllerSource.includes('fillOpacity ?? 0.18') && !adapterSource.includes('fillOpacity ?? 0.18'), '/test2 must not reintroduce the old semi-opaque vector fill fallback');
assert(mapControllerSource.includes('if (!feature)') && mapControllerSource.includes('this.clearHover();'), '/test2 map interactions must clear transient hover state on empty map taps/clicks');
assert(appSource.includes('Test2ElectionManager'), '/test2 must wire the election manager into the main shell route');
assert(!appSource.includes('Election map workflows are not converted for /test2 yet'), '/test2 election callbacks must not remain disabled stubs');
assert(appSource.includes('onBuildElectionCatalogueCards') && appSource.includes('this.elections?.buildCatalogueCards'), '/test2 catalogue must expose generated election entries');
assert(appSource.includes('includeMobileElectionCatalogue = true'), '/test2 must opt in to visible election catalogue entries on mobile');
assert(!appSource.includes('includeElectionTocRows = true'), '/test2 must not opt in to individual election rows in the top catalogue table');
assert(uiControllerSource.includes('catalogue-flat__toc-decade-btn') && uiControllerSource.includes('flat-election-entry'), '/test2 catalogue must keep main-style decade TOC buttons with election entries inside decade cards');
assert(!uiControllerSource.includes('flat-election-toc-link') && !uiControllerSource.includes('catalogue-flat__toc-election-row'), '/test2 must not render individual election entries directly in the catalogue table of contents');
assert(appSource.includes('enrichFeature: (feature, selection) => this.elections?.enrichFeature'), '/test2 selected feature details must merge election results where active');
assert(appSource.includes('setupTimelineControls') && appSource.includes('setTimelineItems'), '/test2 must wire the production timeline slider for map chains and elections');
assert(appSource.includes('formatTimelineItemLabel') && appSource.includes("day: '2-digit'") && appSource.includes("month: 'short'") && appSource.includes("year: 'numeric'"), '/test2 timeline labels must render as DD MMM YYYY');
assert(adapterSource.includes('applyElectionStyle') && adapterSource.includes('clearElectionStyle'), '/test2 adapter must support MapLibre election styling expressions');
assert(adapterSource.includes('fillOpacityExpression') && adapterSource.includes('lineOpacityExpression'), '/test2 adapter must accept expression-based election opacity so main matched/unmatched paint can be mirrored');
assert(electionManagerSource.includes('ELECTION_MANIFEST_URL') && electionManagerSource.includes('loadElection(body, date)'), '/test2 election manager must lazy-load generated election result bundles');
assert(electionManagerSource.includes('renderLoadingPanel') && electionManagerSource.includes('Promise.all') && electionManagerSource.includes('loadFeatureIndexForBundle'), '/test2 election loads must use a progressive pane and parallel map/result/index fetch path');
assert(electionManagerSource.includes('voteShare') && electionManagerSource.includes('turnout') && electionManagerSource.includes('quota'), '/test2 election manager must expose requested election styling modes');
assert(electionManagerSource.includes('renderSeatCircles') && electionManagerSource.includes('new maplibregl.Marker') && electionManagerSource.includes('seatCircleMarkers'), '/test2 election manager must render map-anchored DOM seat-circle markers for ordinary elections');
assert(electionManagerSource.includes('ensureSeatCircleOverlay') && electionManagerSource.includes('election-seat-circle') && electionManagerSource.includes('seat-dot'), '/test2 seat circles must use main-style DOM marker structure instead of MapLibre circle paint');
assert(test2Css.includes('.test2-election-seat-dot') && test2Css.includes('rgba(0, 0, 0, .6)') && test2Css.includes('box-shadow: 0 0 0 1px #fff'), '/test2 election seat-circle DOM dots must use the main-style black stroke plus white outer halo');
assert(electionManagerSource.includes('SEAT_CIRCLE_COLLISION_MARGIN = 4') && electionManagerSource.includes('SEAT_CIRCLE_MIN_TOTAL_EXTENT = 120'), '/test2 seat-circle zoom collision constants must match the main Leaflet overlay rules');
assert(electionManagerSource.includes('scheduleElectionOverlayRefresh') && electionManagerSource.includes('overlayRefreshPending'), '/test2 seat-circle overlays must coalesce zoomend/moveend refreshes instead of running overlapping rebuilds');
assert(electionManagerSource.includes('Math.abs(group.point.x - existing.point.x)') && electionManagerSource.includes('Math.abs(group.point.y - existing.point.y)'), '/test2 seat-circle collision must use main-style centre distance and half-extent checks');
assert(electionManagerSource.includes('const ne = map.project([east, north])') && electionManagerSource.includes('const sw = map.project([west, south])'), '/test2 seat-circle projected bounds must mirror main NE/SW extent projection');
assert(!electionManagerSource.includes('* 0.002'), '/test2 seat circles must not use old geographic-degree offsets for pixel seat layouts');
assert(electionManagerSource.includes('getCanonicalLayerId') && electionManagerSource.includes('mainElectionSlug') && appSource.includes('isCanonicalElectionLayerId'), '/test2 election URL state must use main-style canonical election layer IDs instead of raw geography IDs');
assert(electionManagerSource.includes("const explicitSelected = params.has('electionSelected')") && electionManagerSource.includes("const view = validSelected") && electionManagerSource.includes("requestedView && requestedView !== 'counts' && requestedView !== 'animation' ? requestedView : 'party'"), '/test2 layer-only election URLs must restore the main-style overall party pane instead of inheriting selected/count state');
assert(appSource.includes('focusActiveElectionCatalogueEntry') && appSource.includes('flat-election-entry'), '/test2 active election URL/catalogue restore must focus the same election catalogue state as main');
assert(appSource.includes('flat-election-entry--active') && appSource.includes('restoreCatalogueListState') && appSource.includes("params.set('zoom'"), '/test2 must restore active election catalogue state and use main-style zoom URL state');
assert(mapControllerSource.includes('test2LabelMinZoomOverride') && adapterSource.includes('labelMinZoomOverride'), '/test2 election label density must remain tunable through the MapLibre adapter for non-hidden label modes');
assert(electionManagerSource.includes('hideLabels: true') && adapterSource.includes('style.hideLabels === true') && adapterSource.includes('labelsEnabled'), '/test2 election layers must suppress ordinary feature labels while election styling is active');
assert(electionManagerSource.includes('renderVoteBars') && electionManagerSource.includes('test2-election-vote-bar-layer'), '/test2 election manager must render vote-bar overlays for ordinary elections');
assert(electionManagerSource.includes('renderLocalPartySummaryTable') && electionManagerSource.includes('By Local Party'), '/test2 local-government elections must expose local party/district aggregate views');
assert(electionManagerSource.includes('activeLocalMode') && electionManagerSource.includes('renderDistrictResults') && electionManagerSource.includes('data-election-local-mode'), '/test2 local-government elections must expose DEA/district mode switching');
assert(electionManagerSource.includes('renderRecallPetitionResult') && electionDomainSource.includes('recallPetition'), '/test2 recall-petition data must be preserved and rendered when available');
assert(electionManagerSource.includes('renderRecallPetitionOverview') && electionManagerSource.includes('Incumbent'), '/test2 recall-petition UI must include overview and incumbent detail support where data exists');
assert(electionManagerSource.includes('renderRecallLabels') && electionManagerSource.includes('Petition not successful'), '/test2 recall petitions must expose main-style map labels where recall data is available');
assert(mainElectionPaneContractSource.includes('test2ElectionCountDetail') && mainElectionPaneContractSource.includes('election-detail-toggle-btn--header') && mainElectionPaneContractSource.includes('Detailed View: On'), '/test2 count tables must expose the main-style detailed count toggle in the pane header');
assert(electionManagerSource.includes('nonTransferable') && electionManagerSource.includes('inferCountEvents') && electionDomainSource.includes('isNonTransferableRow'), '/test2 count parity must preserve non-transferable rows and count event hints');
assert(electionDomainSource.includes('not elected') && electionDomainSource.indexOf('not elected') < electionDomainSource.indexOf('/elected|made quota'), '/test2 election domain must not classify "Not Elected" as elected');
assert(electionManagerSource.includes('electionResultsPane') && electionManagerSource.includes('election-results-pane--open'), '/test2 election results must render in the production below-map election pane');
assert(electionDomainSource.includes('summarizeResult') && electionDomainSource.includes('extractElected') && electionDomainSource.includes('buildEntityIndex'), '/test2 must use shared election-domain logic for result summaries, elected extraction, and entity indexes');
assert(electionManagerSource.includes("from '../../js/election-domain.mjs'") && electionManagerSource.includes('renderCountTable') && electionManagerSource.includes('renderEntityPanel'), '/test2 election rendering must consume shared domain logic and expose count/entity views');
assert(electionViewModelSource.includes('buildElectionViewModel') && electionViewModelSource.includes('buildElectionViewModelFromMainController') && electionViewModelSource.includes('buildElectionViewModelFromTest2Manager'), 'main and /test2 must share an engine-neutral election view-model contract');
assert(electionRendererSource.includes('class SharedElectionRenderer') && electionRendererSource.includes('data-election-renderer="shared"') && electionRendererSource.includes('renderElectionSummaryFromViewModel'), 'main and /test2 must share an engine-neutral election renderer/mirror');
assert(electionRendererSource.includes('renderMainCompatibleOverallResults') && electionRendererSource.includes('renderMainCompatibleConstituencyResults'), 'shared election renderer must support main-compatible host adapters for visible pane parity');
assert(electionManagerSource.includes('createElectionRenderer(this)') && electionManagerSource.includes('this.sharedRenderer'), '/test2 must keep shared election renderer available for secondary fallback views');
assert(mainElectionPaneContractSource.includes('class MainElectionPaneContract') && mainElectionPaneContractSource.includes('renderHeaderRight') && mainElectionPaneContractSource.includes('renderPanelContent'), '/test2 must expose an explicit shared main election pane contract for visible pane parity');
assert(electionPaneContractSource.includes('MainElectionPaneContract as Test2MainElectionPaneContract') && electionPaneContractSource.includes('../../js/election-main-pane-contract.mjs'), '/test2 local election pane contract must re-export the shared main election pane contract');
assert(mainElectionPaneContractSource.includes("this.rendererId = host?.paneRendererId || 'test2-main-pane-contract'") && mainElectionPaneContractSource.includes('data-election-renderer="${escapeHtml(this.rendererId)}"'), '/test2 main election pane contract must stamp visible pane output with the test2 parity renderer id');
assert(electionManagerSource.includes('this.mainPaneContract = new MainElectionPaneContract(this)') && electionManagerSource.includes('this.mainPaneContract.renderHeaderRight(selectedResult, nextView)') && electionManagerSource.includes('this.mainPaneContract.renderPanelContent(selectedResult, nextView)'), '/test2 visible election pane header/content must enter through the shared main-pane contract');
assert(electionManagerSource.includes("renderOverallResults(view = 'party') {\n    return this.mainPaneContract.renderOverallResults(view);") && electionManagerSource.includes("renderConstituencyResults(result, view = 'party') {\n    return this.mainPaneContract.renderConstituencyResults(result, view);"), '/test2 visible election pane helpers must delegate to the main-pane contract, not bypass it with route-specific branches');
assert(electionManagerSource.includes('renderMainCompatibleOverallResults') && electionManagerSource.includes('renderMainCompatibleConstituencyResults') && electionManagerSource.includes('return this.mainPaneContract.renderOverallResults(view);') && electionManagerSource.includes('return this.mainPaneContract.renderConstituencyResults(result, view);'), '/test2 must expose main-compatible shared-renderer host adapters backed by the main-pane contract');
assert(mainElectionPaneContractSource.includes('test2-election-panel--main-parity') && electionManagerSource.includes('renderMainParityPartyTable') && electionManagerSource.includes('Candidates') && electionManagerSource.includes('1st preferences'), '/test2 visible election pane must follow the main grouped party-table contract');
const selectedPartyStart = electionManagerSource.indexOf('renderConstituencyPartyTable(candidates = [], result = {})');
const selectedPartyEnd = electionManagerSource.indexOf('renderMainParityLeafTh', selectedPartyStart);
const selectedPartySource = selectedPartyStart >= 0 && selectedPartyEnd > selectedPartyStart
  ? electionManagerSource.slice(selectedPartyStart, selectedPartyEnd)
  : '';
assert(selectedPartySource.includes('election-results-table--constituency-party') && selectedPartySource.includes('data-sort-key="stood"') && selectedPartySource.includes('data-sort-key="elected"') && selectedPartySource.includes('data-sort-key="firstPrefs"') && selectedPartySource.includes('No change in party control'), '/test2 selected constituency/DEA party panes must use the main flat selected-party table contract');
assert(!selectedPartySource.includes('<th colspan="2">Candidates</th>') && !selectedPartySource.includes('<th colspan="2">Seats</th>') && !selectedPartySource.includes('<th colspan="4">1st preferences</th>'), '/test2 selected constituency/DEA party panes must not reuse the overall grouped party table headers');
assert(selectedPartySource.includes('selectedPaneStatusKind(row.Status)') && !selectedPartySource.includes("status.includes('quota')") && !selectedPartySource.includes('status.includes("quota")'), '/test2 selected constituency/DEA party panes must use main selected-pane status semantics and must not count quota-only statuses as directly elected');
assert(electionManagerSource.includes('mainStyleCandidateDisplayName(row)') && electionManagerSource.includes('row.candidateName') && electionManagerSource.includes('row.Firstname') && electionManagerSource.includes('row.Surname'), '/test2 selected constituency/DEA party panes must mirror main _isValidCandidateRow candidate-name admissibility');
assert(electionManagerSource.includes('formatMainSelectedPercentDelta(row.pctDelta)') && electionManagerSource.includes('function formatMainSelectedPercentDelta') && !selectedPartySource.includes('formatMainPercentDelta(row.pctDelta)'), '/test2 selected constituency/DEA party panes must mirror main selected-pane percent-delta formatting without appending a percent sign');
const selectedPaneStatusStart = electionManagerSource.indexOf('function selectedPaneStatusKind(status)');
const selectedPaneStatusEnd = electionManagerSource.indexOf('\nfunction sumNumbers', selectedPaneStatusStart);
const selectedPaneStatusSource = selectedPaneStatusStart >= 0 && selectedPaneStatusEnd > selectedPaneStatusStart
  ? electionManagerSource.slice(selectedPaneStatusStart, selectedPaneStatusEnd)
  : '';
assert(selectedPaneStatusSource.includes("text.includes('not elected')") && selectedPaneStatusSource.includes("text.includes('excluded')") && selectedPaneStatusSource.includes("text.includes('elected')") && !selectedPaneStatusSource.includes('quota'), '/test2 selected-pane status helper must mirror main _statusKind ordering without broad quota normalization');
assert(electionManagerSource.includes('buildMainStyleConstituencyPartyRows') && electionManagerSource.includes('result?.countGroup') && electionManagerSource.includes('findPreviousSelectedResult'), '/test2 selected constituency/DEA party panes must derive rows from the main-shaped countGroup payload and previous-election result');
assert(electionManagerSource.includes('renderConstituencyCandidateTable') && electionManagerSource.includes('election-party-table--candidate-sticky3'), '/test2 candidate panes must use the main grouped candidate-table contract');
assert(electionManagerSource.includes('renderLocalPartySummaryTable') && electionManagerSource.includes('election-party-table--district-local-party-sticky4'), '/test2 local-party panes must use the main grouped local-party table contract');
assert(electionManagerSource.includes('renderCountTable') && electionManagerSource.includes('election-count-row') && electionManagerSource.includes('election-count-wrapper--pane-sticky') && electionManagerSource.includes('visibleCounts'), '/test2 count panes must use the main visible-count table contract');
assert(electionDomainSource.includes('__syntheticCountGroup: true') && electionDomainSource.includes('syntheticCountGroup') && electionManagerSource.includes('result.syntheticCountGroup ? [1]') && electionManagerSource.includes('Not Elected<br>Count 1/1'), '/test2 scraper-style election results must use synthetic count payloads for animation without exposing synthetic multi-count columns in the visible Count pane');
assert(electionManagerSource.includes('renderPartyEntity') && electionManagerSource.includes('renderCandidateEntity') && electionManagerSource.includes('election-entity-page__hero'), '/test2 entity panes must use main-style entity page structure');
assert(!/headerRight\.innerHTML = `[\s\S]{0,700}<span>Style<\/span>/.test(electionManagerSource), '/test2 must not put MapLibre style controls in the main election pane header');
assert(electionControllerSource.includes('buildElectionViewModelFromMainController') && electionControllerSource.includes('renderElectionSummaryFromViewModel') && electionControllerSource.includes('_mirrorSharedElectionRenderer'), 'main election controller must mirror the shared view-model/renderer path for parity checks');
assert(electionManifestBuilderSource.includes('OUT_ANCHOR_DIR') && electionManifestBuilderSource.includes('geometryAnchor') && electionManifestBuilderSource.includes('anchorUrl'), '/test2 election manifest build must generate geometry-derived election anchor sidecars');
assert(electionManifestBuilderSource.includes('previousKey') && electionManifestBuilderSource.includes('partySummary') && electionManifestBuilderSource.includes('entityIndex'), '/test2 election bundles must include previous-election linkage and rich pane data');
assert(electionManifestBuilderSource.includes('localByDate') && electionManifestBuilderSource.includes('Local Government Districts'), '/test2 election manifest builder must group general local elections by jurisdiction/date instead of per council');
assert(electionManifestBuilderSource.includes('matchEntryForConstituency') && electionManifestBuilderSource.includes('localBodyByConstituency'), '/test2 grouped local-election entries must preserve council-specific matching context');
assert(electionManagerSource.includes('filterOverlayGroupsByCollision') && electionManagerSource.includes('SEAT_CIRCLE_COLLISION_MARGIN'), '/test2 election overlays must have main-style MapLibre-native collision suppression');
assert(electionManagerSource.includes('projectAnchorBounds') && electionManagerSource.includes('pixelArea'), '/test2 election overlay collision must use generated anchor bounds, not only centre-point spacing');
assert(
  electionManagerSource.includes('orderPartyRowsLikeMain')
    && electionManagerSource.includes('setupResultsTableControls')
    && electionManagerSource.includes('election-filter-menu')
    && electionManagerSource.includes('filterState')
    && electionManagerSource.includes('data-action="sort-asc"')
    && electionManagerSource.includes('data-action="deselect-all"')
    && electionManagerSource.includes('data-action="clear-filter"')
    && electionManagerSource.includes('election-th-btn--open')
    && electionManagerSource.includes('positionElectionFilterMenu')
    && electionManagerSource.includes('clampToViewport')
    && electionManagerSource.includes("window.addEventListener('resize', activeMenuPositioner)")
    && electionManagerSource.includes("window.addEventListener('scroll', activeMenuPositioner, true)"),
  '/test2 election tables must preserve main-style party ordering, full menu-based sort/filter controls, and viewport-contained filter menus'
);
assert(electionManagerSource.includes('MAIN_ELECTION_GEOGRAPHY_STYLE') && electionManagerSource.includes("unmatchedFillColor: '#dfe4ec'") && electionManagerSource.includes('matchedFillOpacity: 0.6') && electionManagerSource.includes("matchedStrokeColor: '#333'"), '/test2 election geography styling must mirror main fill/stroke constants');
assert(electionManagerSource.includes('buildElectionMatchExpression') && electionManagerSource.includes('fillOpacityExpression'), '/test2 election geography styling must distinguish matched and unmatched features with MapLibre expressions');
assert(electionDomainSource.includes('buildMainLikePartySummaryFromRawResults') && electionManifestBuilderSource.includes('mainLikePartySummary'), '/test2 election bundles must carry main-controller-compatible party summaries, not only independent test2 summaries');
assert(mainElectionPaneContractSource.includes('this.host.activeBundle.mainLikePartySummary') && electionManagerSource.includes('this.previousBundle?.mainLikePartySummary'), '/test2 election pane must consume main-compatible current and previous party summaries');
assert(electionManagerSource.includes('getSeatCircleOverlayState') && electionManagerSource.includes('seatCircleOverlayState') && electionManagerSource.includes('visibleGroups'), '/test2 seat-circle drawing order/counts must be deterministic and inspectable like the main overlay DOM order');
assert(electionManagerSource.includes('dataset.lng') && electionManagerSource.includes('dataset.lat') && electionManagerSource.includes('marker.setLngLat'), '/test2 DOM seat circles must retain geographic anchors and be pinned by MapLibre during pan/zoom');
assert(electionManagerSource.includes('removeSeatCircleMarkers') && electionManagerSource.includes('marker.remove()'), '/test2 DOM seat-circle markers must be cleaned up when overlays switch or unload');
assert(uiControllerSource.includes('ensureMobileThumbnailDismissal') && uiControllerSource.includes('catalogue-flat__toc-thumbzoom--visible'), '/test2/main catalogue thumbnails must dismiss stuck mobile hover previews on outside touch/click');
assert(electionManagerSource.includes('renderCouncilResults') && electionManagerSource.includes('buildCouncilSummary'), '/test2 grouped local elections must expose a council-level results view');
assert(electionManagerSource.includes('buildLocalAggregateSeatCircleGroups') && electionManagerSource.includes('aggregateType'), '/test2 local-government district/council mode must aggregate seat-circle overlays instead of always drawing DEA-level groups');
assert(electionManagerSource.includes('activeEntityKind') && appSource.includes('electionEntityKind') && electionManagerSource.includes('electionEntityReturnView'), '/test2 election entity pages must round-trip through URL state');
assert(electionManagerSource.includes('withCouncilDeltas') && electionManagerSource.includes('Seat change') && electionManagerSource.includes('Turnout change'), '/test2 grouped local council summaries must expose previous-election deltas where available');
assert(electionManagerSource.includes('withLocalPartyDeltas') && electionManagerSource.includes('row.deltas?.share') && electionManagerSource.includes('formatMainPercentDelta'), '/test2 local-party summaries must expose previous-election deltas where available');
assert(test2Css.includes('body.app-shell.test2-election-open'), '/test2 must resize the production shell when the election pane opens below the map');
assert(uiControllerSource.includes('flat-election-entry--loading') && uiControllerSource.includes("aria-busy', 'true'"), '/test2 election catalogue entries must show a busy state and block duplicate mobile taps while loading');
assert(featureRepairsSource.includes('ARMAGH AREA D') && featureRepairsSource.includes('DUNGANNON AREA C') && featureRepairsSource.includes('LIMAVADY AREA C'), '/test2 must repair known unnamed/misnamed deas-1972 feature labels');
assert(labelsSource.includes('buildRepairedLabelValueExpression') && labelsSource.includes('repairFeatureProperties'), '/test2 label rendering must use repaired feature properties for known source-data label defects');
assert(mapControllerSource.includes('repairFeatureProperties(layer, feature.properties || {})'), '/test2 feature selection payloads must include repaired source-data labels');
assert(adapterSource.includes('repairFeatureProperties(layerConfig'), '/test2 normalized MapLibre features must include repaired source-data labels');
assert(electionManagerSource.includes('buildRepairedLabelValueExpression') && electionManagerSource.includes('repairFeatureProperties'), '/test2 election matching/styling must use repaired source-data labels');
assert(electionManifestBuilderSource.includes('syntheticRegionMatch') && electionManifestBuilderSource.includes('synthetic-region-bounds-center'), '/test2 election manifest builder must synthesize safe regional anchors for non-feature regional-list rows');

for (const path of [
  'test2/build/test2.bundle.js',
  'test2/build/test2.bundle.css',
  'test2/src/app.js',
  'test2/src/maplibre-main-adapter.js',
  'test2/src/election-manager.js',
  'test2/src/election-pane-main-contract.js',
  'js/election-main-pane-contract.mjs',
  'js/election-domain.mjs',
  'js/election-view-model.mjs',
  'js/election-renderer.mjs',
  'test/src/feature-property-repairs.js',
  'test/metadata/elections-test2.json',
  'test/metadata/elections-test2-report.json',
  'test/metadata/election-anchors-test2'
]) {
  assert(existsSync(path), `${path} is missing`);
}

if (existsSync('test/metadata/elections-test2.json')) {
  const electionManifest = JSON.parse(readFileSync('test/metadata/elections-test2.json', 'utf8'));
  assert((electionManifest.elections || []).length > 100, '/test2 election manifest is unexpectedly small');
  assert((electionManifest.totals?.loadable || 0) > 100, '/test2 election manifest has too few loadable entries');
  assert((electionManifest.elections || []).some((entry) => entry.resultUrl && entry.stylingModes?.includes('winner')), '/test2 election manifest must include lazy result URLs and winner styling');
  assert((electionManifest.elections || []).some((entry) => entry.anchorUrl && entry.previousKey), '/test2 election manifest must include anchor sidecars and previous-election links where available');
  const dail2024Bundle = JSON.parse(readFileSync('test/metadata/elections-test2/dail-eireann__2024-11-29.json', 'utf8'));
  const dail2024Rows = dail2024Bundle.mainLikePartySummary || [];
  assert(dail2024Rows[0]?.party === 'Fine Gael' && dail2024Rows[0]?.stood === 11 && dail2024Rows[0]?.seats === 42 && dail2024Rows[0]?.votes === 108352, '/test2 Dail 2024 bundle must preserve the main-controller party summary contract for the screenshot parity state');
  assert(dail2024Bundle.mainLikeTotals?.validPoll === 412346, '/test2 Dail 2024 bundle must preserve the main-controller valid-poll denominator for the screenshot parity state');
  assert(dail2024Bundle.mainLikeTotals?.totalSeats === 0, '/test2 Dail 2024 bundle must preserve the main-controller seat-total denominator for the screenshot parity state');
  const dail2024Mayo = (dail2024Bundle.results || []).find((result) => String(result.constituency || '').toLowerCase() === 'mayo');
  const dail2024MayoAnimationRows = dail2024Mayo?.animationPayload?.Constituency?.countGroup || [];
  assert(dail2024MayoAnimationRows.some((row) => Number(row.Count_Number) > 1), '/test2 Dail 2024 Mayo must carry the main-style synthetic transfer animation payload');
  assert(dail2024Mayo?.syntheticCountGroup === true, '/test2 Dail 2024 Mayo must mark scraper-derived count rows as synthetic so Count pane output stays main-compatible');
  const dail2024RoscommonGalway = (dail2024Bundle.results || []).find((result) => String(result.constituency || '').toLowerCase() === 'roscommon galway');
  const roscommonGalwayCountRows = dail2024RoscommonGalway?.countGroup || [];
  const roscommonGalwayMadeQuotaRows = roscommonGalwayCountRows.filter((row) => /quota/i.test(String(row.Status || '')));
  assert(roscommonGalwayMadeQuotaRows.length >= 2, '/test2 Dail 2024 Roscommon Galway must retain the quota-status rows used by the screenshot parity guard');
  assert(roscommonGalwayMadeQuotaRows.every((row) => mainSelectedPaneStatusKind(row.Status) !== 'elected'), '/test2 selected-pane status guard must keep Dail 2024 Roscommon Galway Made Quota rows out of the direct elected set');
  assert(roscommonGalwayCountRows.some((row) => String(row.Party_Name || '') === 'Independent Ireland' && Number(row.Count_Number) === 1 && Number(row.Total_Votes) === 12002), '/test2 Dail 2024 Roscommon Galway must retain main-compatible first-count Independent Ireland row data');
  assert(roscommonGalwayCountRows.some((row) => String(row.Party_Name || '') === 'Sinn Féin' && Number(row.Count_Number) > 1 && Number(row.Total_Votes) === 8039), '/test2 Dail 2024 Roscommon Galway must retain later-count Sinn Fein quota row data without turning it into first preferences');
  const forumEntry = (electionManifest.elections || []).find((entry) => entry.body === 'Northern Ireland Forum for Political Dialogue' && entry.date === '1996-05-30');
  assert(forumEntry?.matchedCount === forumEntry?.totalConstituencies, '/test2 1996 Forum election must include the NI-wide regional-list result via a synthetic anchor');
  const localEntries = (electionManifest.elections || []).filter((entry) => entry.bodyGroup === 'local-government');
  const generalLocalEntries = localEntries.filter((entry) => (entry.localBodies || []).length > 1);
  const generalLocalDates = new Map();
  for (const entry of generalLocalEntries) {
    const key = `${entry.displayProvider || ''}|${entry.date}`;
    generalLocalDates.set(key, (generalLocalDates.get(key) || 0) + 1);
    assert(entry.body === 'Local Government Districts', `/test2 grouped local election ${entry.date} must use the synthetic all-district body`);
    assert(/Northern Ireland local election/.test(entry.displayTitle || ''), `/test2 grouped local election ${entry.date} must carry an all-NI title`);
  }
  assert(generalLocalEntries.length >= 10, '/test2 should expose historical NI general local elections as grouped date entries');
  assert([...generalLocalDates.values()].every((count) => count === 1), '/test2 must not expose multiple council rows for the same grouped local-election date');
  assert(localEntries.some((entry) => (entry.localBodies || []).length === 1 && entry.body !== 'Local Government Districts'), '/test2 must preserve single-council local by-elections as their own entries');
}

if (existsSync('test/metadata/elections-test2-report.json')) {
  const electionReport = JSON.parse(readFileSync('test/metadata/elections-test2-report.json', 'utf8'));
  assert(!electionReport.residualSummary?.['historic-dea-not-in-source'], '/test2 deas-1972 election residuals should be resolved by source-data label repairs');
  assert(!electionReport.closureSummary?.byStatus?.['blocked-on-implementation'], '/test2 must not leave feasible implementation-blocked election geography gaps in the generated report');
  assert(!electionReport.closureSummary?.byStatus?.['blocked-on-data-cleanup'], '/test2 must not leave deterministic source-name typo fixes in the generated election gap report');
  assert(electionReport.closureSummary?.feasibleUnmatchedRemaining === 0, '/test2 election unmatched report must classify all remaining gaps as blocked, not silently feasible');
}

if (existsSync('test/metadata/feature-indexes')) {
  for (const filename of readdirSync('test/metadata/feature-indexes').filter((name) => name.endsWith('.json'))) {
    const featureIndex = JSON.parse(readFileSync(`test/metadata/feature-indexes/${filename}`, 'utf8'));
    const items = featureIndex.items || featureIndex.features || (Array.isArray(featureIndex) ? featureIndex : []);
    const badItem = items.find((item) => !String(item.name || item.label || item.title || '').trim()
      || /unnamed feature/i.test(String(item.name || item.label || item.title || '')));
    assert(!badItem, `/test2 feature index ${filename} contains a blank or unnamed feature label`);
  }
}

const bundleBytes = existsSync('test2/build/test2.bundle.js') ? statSync('test2/build/test2.bundle.js').size : 0;
assert(bundleBytes > 100_000, '/test2 bundle is unexpectedly small');
assert(bundleBytes < 2_500_000, `/test2 bundle is too large for the route budget: ${bundleBytes} bytes`);

if (failures.length) {
  console.error('Test2 Route Validation');
  failures.forEach((failure) => console.error(`- FAIL: ${failure}`));
  process.exit(1);
}

console.log('PASS: /test2 route shell and engine isolation checks passed.');

function buildPlanSourceIncludesCompositeCoverage() {
  const source = readFileSync('scripts/build-test-metadata-plan.mjs', 'utf8');
  return source.includes('MANUAL_ALIAS_TARGETS')
    && source.includes('convertedCompositeChildIds')
    && source.includes('convertedSourceIds');
}

function assertPoint2Coverage() {
  const actionableStatuses = new Set(['needsVectorTileConversion', 'needsRasterStrategy', 'needsMapLibreSourceMapping']);
  const actionableRows = (portPlan.rows || []).filter((row) => actionableStatuses.has(row.conversionStatus));
  assert(actionableRows.length === 0, `/test2 point-2 data coverage has ${actionableRows.length} actionable unconverted row(s): ${actionableRows.slice(0, 5).map((row) => row.sourceMapId).join(', ')}`);

  const townlands = (portPlan.rows || []).find((row) => row.sourceMapId === 'all-ireland-townlands');
  assert(townlands?.conversionStatus === 'convertedComposite' && /ni-townlands/.test(townlands.testLayerId || '') && /roi-townlands/.test(townlands.testLayerId || ''), '/test2 all-Ireland Townlands must resolve through converted NI and ROI Townlands child layers');

  const civilPlan = (portPlan.rows || []).find((row) => row.sourceMapId === 'civil-parishes');
  const civilAlias = (testMetadata.layers || []).find((layer) => layer.sourceMapId === 'civil-parishes' && layer.aliasTargetLayerId === 'civil-parishes-vector-test');
  assert(civilPlan?.conversionStatus === 'convertedAlias', '/test2 Civil Parishes legacy catalogue row must be recorded as a converted alias');
  assert(Boolean(civilAlias), '/test2 maps-test metadata must include a loadable Civil Parishes alias to the unified converted layer');
}
