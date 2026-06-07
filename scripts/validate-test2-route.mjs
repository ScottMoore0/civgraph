#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const failures = [];
const index = readFileSync('test2/index.html', 'utf8');
const appSource = readFileSync('test2/src/app.js', 'utf8');
const adapterSource = readFileSync('test2/src/maplibre-main-adapter.js', 'utf8');
const electionManagerSource = readFileSync('test2/src/election-manager.js', 'utf8');
const electionPaneContractSource = readFileSync('test2/src/election-pane-main-contract.js', 'utf8');
const test2ServiceWorkerSource = readFileSync('test2/sw.js', 'utf8');
const rootServiceWorkerSource = readFileSync('sw.js', 'utf8');
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
const mapsDb = JSON.parse(readFileSync('data/database/maps.json', 'utf8'));
const test2BundleVersion = index.match(/\/test2\/build\/test2\.bundle\.js\?v=([0-9a-f]{12})/)?.[1] || '';

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function findMap(id) {
  const direct = mapsDb.maps?.find((map) => map.id === id);
  if (direct) return direct;
  for (const map of mapsDb.maps || []) {
    const variant = map.variants?.find((item) => item.id === id);
    if (variant) return { ...map, ...variant, parentId: map.id };
  }
  return null;
}

function assertCatalogueMetadata() {
  const chainClassIds = new Set();
  for (const chain of mapsDb.timeSeriesChains || []) {
    for (const segment of chain.segments || []) {
      for (const classId of segment.classIds || []) chainClassIds.add(classId);
    }
    for (const column of chain.columns || []) {
      for (const classId of column.classIds || []) chainClassIds.add(classId);
    }
  }

  const classById = new Map((mapsDb.classes || []).map((item) => [item.id, item]));
  assert(chainClassIds.has('ni-counties'), 'Counties class must be attached to a time-series chain');
  assert(chainClassIds.has('ireland-provinces'), 'Provinces class must be attached to a time-series chain');
  assert((classById.get('ni-counties')?.maps || []).includes('counties-ireland-1955'), 'Counties class must include historical county variants instead of unrelated ED maps');
  assert((classById.get('ireland-provinces')?.maps || []).includes('provinces-1899'), 'Provinces class must exist and include historical province maps');

  for (const id of ['eds-2019', 'eds-1997', 'eds-1994', 'eds-1986']) {
    const map = findMap(id);
    assert(map?.isGroup === true && Array.isArray(map.variants) && map.variants.length >= 4, `${id} parent map must remain a grouped all-ROI load across all provincial variants`);
  }

  assert(findMap('tailte-built-up-1m')?.labelProperty === 'F_CODE', 'TÉ Built-Up Areas polygon map must label with F_CODE');
  assert(findMap('tailte-built-up-points-250k')?.labelProperty === 'NAMN1', 'TÉ Built-Up Areas point map must label with NAMN1');
  assert(findMap('cso-urban-areas-2022')?.date === 2022, 'CSO Urban Areas 2022 must have date metadata so catalogue display derives 2022');
  assert(uiControllerSource.includes("name: 'TÉ Built-Up Areas'"), 'Catalogue must title Tailte built-up areas as TÉ Built-Up Areas');
  assert(uiControllerSource.includes("name: 'Heritage Sites'"), 'Catalogue must title NI HED heritage card as Heritage Sites');
  assert(uiControllerSource.includes("map.id === 'cso-urban-areas-2022'") && uiControllerSource.includes("displayName = '2022'"), 'Catalogue must display CSO Urban Areas 2022 using derived name 2022');

  const thumbnailIds = new Set(JSON.parse(readFileSync('assets/thumbnails/manifest.json', 'utf8')));
  for (const id of [
    'hed-listed-buildings',
    'hed-sites-and-monuments',
    'hed-scheduled-monument-areas',
    'hed-defence-heritage',
    'hed-industrial-heritage',
    'ni-listed-buildings',
    'ni-scheduled-monument-areas',
    'ni-defence-heritage',
    'ni-industrial-heritage',
    'glpr-2020-03',
    'glpr-2021-03',
    'roi-national-planning-applications'
  ]) {
    assert(thumbnailIds.has(id), `${id} must be present in the catalogue thumbnail manifest`);
  }

  for (const id of ['glpr-2020-03', 'glpr-2021-03', 'glpr-2021-08', 'glpr-2021-09', 'glpr-2022-04', 'glpr-2023-04']) {
    assert(findMap(id)?.labelProperty === 'Address', `${id} must label GLPR features by Address`);
  }
  assert(findMap('roi-national-planning-applications')?.labelProperty === 'Development Address', 'ROI National Planning Applications must label features by Development Address');
}

function mainSelectedPaneStatusKind(status) {
  const text = String(status || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('not elected')) return 'not_elected';
  if (text.includes('excluded')) return 'excluded';
  if (text.includes('elected') || text.includes('made quota') || text.includes('counted as elected') || text.includes('deemed elected')) return 'elected';
  return 'unknown';
}

assert(index.includes('<base href="/">'), '/test2 must keep root-relative production assets via <base href="/">');
assert(existsSync('docs/test2-general-parity-matrix.json'), '/test2 general parity matrix is missing');
assert(existsSync('scripts/audit-test2-general-parity.mjs'), '/test2 general parity audit script is missing');
assert(packageJsonSource.includes('"audit:test2:parity"'), '/test2 general parity audit must be exposed through package scripts');
assert(index.includes('/test2/build/test2.bundle.js'), '/test2 must load its own MapLibre bundle');
assert(index.includes('/test2/build/test2.bundle.css'), '/test2 must load its own MapLibre CSS bundle');
assert(Boolean(test2BundleVersion), '/test2 bundle script must include a content-hash cache key');
assert(test2ServiceWorkerSource.includes(`const VERSION = 'test2-sw-${test2BundleVersion}';`), '/test2 scoped service-worker cache version must match the current bundle hash so phones cannot retain stale gesture code');
assert(index.includes('href="/build/main.css'), '/test2 must load shared main CSS from the site root, not route-relative /test2/build/main.css');
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
assert(mapControllerSource.includes('installMobileGestureGuards') && mapControllerSource.includes('installDirectPanGestureFallback') && mapControllerSource.includes('installDirectWheelGestureFallback') && mapControllerSource.includes('installMobileGestureResizeObserver') && mapControllerSource.includes('ResizeObserver') && mapControllerSource.includes('applyMobileTouchContract') && mapControllerSource.includes('getMobileGestureDiagnostics') && adapterSource.includes('getMobileGestureDiagnostics') && adapterSource.includes('applyMobileTouchContract'), '/test2 MapLibre controller and adapter must runtime-enforce the mobile touch contract, direct pan/wheel fallbacks, and gesture diagnostics');
assert(mapControllerSource.includes('touchstart') && mapControllerSource.includes('guardTargetCount') && mapControllerSource.includes('scrollZoomEnabled'), '/test2 gesture guards must refresh the touch contract at touch gesture start and expose target diagnostics');
assert(!mapControllerSource.includes("addEventListener('pointerdown', refreshTouchContract") && !mapControllerSource.includes("addEventListener('pointermove', refreshTouchContract") && !mapControllerSource.includes("addEventListener('touchmove', refreshTouchContract"), '/test2 touch contract must not be re-applied on desktop pointerdown or every pointer/touch move because that can freeze drag gestures');
assert(mapControllerSource.includes('directPanGestureInstalled') && mapControllerSource.includes('directPanFrame') && mapControllerSource.includes('schedulePan(nextCenter)') && mapControllerSource.includes('directGestureActive') && mapControllerSource.includes('resetDirectPanGestureState(root)'), '/test2 must keep a frame-coalesced direct MapLibre pan fallback and reset stale pan state around pinch gestures so desktop/mobile drag gestures do not depend solely on the native handler path or per-move URL updates');
assert(mapControllerSource.includes('directWheelGestureInstalled') && mapControllerSource.includes("root.addEventListener('wheel'") && mapControllerSource.includes('directWheelPendingZoom'), '/test2 must keep a frame-coalesced direct MapLibre wheel fallback so desktop scroll zoom does not depend solely on the native handler path');
assert(mapControllerSource.includes('mobileGestureResizeSize') && mapControllerSource.includes('sizeChanged') && mapControllerSource.includes('resizeObserverTargets') && !mapControllerSource.includes('observe(canvasContainer)'), '/test2 map resize observer must be size-change guarded and must not observe the MapLibre canvas container in a resize loop');
assert(!mapControllerSource.includes('dragPan?.disable'), '/test2 direct touch fallback must not disable dragPan because interrupted touch sequences can freeze subsequent pan/drag gestures');
assert(rootServiceWorkerSource.includes("const CACHE_VERSION = 'v8'") && rootServiceWorkerSource.includes("url.pathname.startsWith('/test2/')") && rootServiceWorkerSource.includes("url.pathname.startsWith('/test2/pmtiles/')") && rootServiceWorkerSource.includes('networkOnly(req)') && rootServiceWorkerSource.includes('networkFirst(req, RUNTIME_CACHE)'), 'root service worker must explicitly route /test2 entry assets network-first and avoid caching /test2 PMTiles');
assert(test2Css.includes('#map .maplibregl-map') && test2Css.includes('overscroll-behavior: contain') && test2Css.includes('-webkit-touch-callout: none'), '/test2 route CSS must apply a full mobile touch contract to the map container and canvas');
assert(appSource.includes('relocateMobileCatalogueToggle') && appSource.includes('mobile-toggle--navbar'), '/test2 must move the mobile catalogue toggle into the navbar instead of leaving it as a floating map overlay');
assert(test2Css.includes('.app-header #mobileToggle.mobile-toggle.mobile-toggle--navbar') && test2Css.includes('position: static !important'), '/test2 mobile catalogue toggle must be styled as a navbar control on mobile');
assert(!test2Css.includes('bottom: 14px !important'), '/test2 mobile catalogue toggle must not be restored to the bottom-right map overlay position');
assert(index.indexOf('id="timelineSlider"') > index.indexOf('</div><!-- end #map -->'), '/test2 timeline slider must be a separate row below #map, not a DOM overlay inside the map');
assert(!test2Css.includes('#map .timeline-slider'), '/test2 route CSS must not style the timeline as map-overlay chrome');
assert(test2Css.includes('.pane--map > #timelineSlider.timeline-slider') && test2Css.includes('position: static') && test2Css.includes('min-height: var(--timeline-row-height)'), '/test2 timeline slider must be styled as an in-flow rectangular pane below the interactive map');
assert(test2Css.includes('#map .map-controls') && test2Css.includes('bottom: 14px'), '/test2 map controls should sit inside the map now that the timeline is an in-flow row');
assert(appSource.includes('const variantIds = mapConfig.variants') && appSource.includes('fitToLayers(variantIds)'), '/test2 parent maps with variants must load every child variant as one grouped layer instead of only the first variant');
assertCatalogueMetadata();
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
assert(appSource.includes('onBuildElectionCatalogueCards') && appSource.includes('this.elections.buildCatalogueCards()'), '/test2 catalogue must expose generated election entries');
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
assert(appSource.includes('unloadActiveElectionForLayer(mapId)') && appSource.includes('isActiveElectionLayerId(mapId)') && (appSource.includes('this.elections.unloadElection()') || appSource.includes('this.elections.unloadElection({ unloadBackingLayer: false })')), '/test2 active-layer removal must route active election source/canonical IDs through the election manager so DOM seat-circle markers are removed');
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
assert(mainElectionPaneContractSource.includes("this.rendererId = host?.paneRendererId || 'test2-main-pane-contract'") && !mainElectionPaneContractSource.includes('test2-election-panel--main-parity'), '/test2 main election pane contract must not add a test2-only wrapper around visible main-pane output');
assert(electionManagerSource.includes('this.mainPaneContract = new MainElectionPaneContract(this)') && electionManagerSource.includes('this.mainPaneContract.renderHeaderRight(selectedResult, nextView)') && electionManagerSource.includes('this.mainPaneContract.renderPanelContent(selectedResult, nextView)'), '/test2 visible election pane header/content must enter through the shared main-pane contract');
assert(/renderOverallResults\(view = 'party'\)\s*{\s*return this\.mainPaneContract\.renderOverallResults\(view\);/.test(electionManagerSource) && /renderConstituencyResults\(result, view = 'party'\)\s*{\s*return this\.mainPaneContract\.renderConstituencyResults\(result, view\);/.test(electionManagerSource), '/test2 visible election pane helpers must delegate to the main-pane contract, not bypass it with route-specific branches');
assert(electionManagerSource.includes('renderMainCompatibleOverallResults') && electionManagerSource.includes('renderMainCompatibleConstituencyResults') && electionManagerSource.includes('return this.mainPaneContract.renderOverallResults(view);') && electionManagerSource.includes('return this.mainPaneContract.renderConstituencyResults(result, view);'), '/test2 must expose main-compatible shared-renderer host adapters backed by the main-pane contract');
assert(electionManagerSource.includes('renderMainParityPartyTable') && electionManagerSource.includes('election-party-table election-party-table--grouped') && electionManagerSource.includes('Candidates') && electionManagerSource.includes('1st preferences'), '/test2 visible election pane must follow the main grouped party-table contract');
const overallPartyStart = electionManagerSource.indexOf('renderMainParityPartyTable(rowsWithDeltas = [], results = [])');
const overallPartyEnd = electionManagerSource.indexOf('renderConstituencyCandidateTable', overallPartyStart);
const overallPartySource = overallPartyStart >= 0 && overallPartyEnd > overallPartyStart
  ? electionManagerSource.slice(overallPartyStart, overallPartyEnd)
  : '';
assert(overallPartySource.includes('<table class="election-party-table election-party-table--grouped">') && !overallPartySource.includes('election-results-table--fixed'), '/test2 overall party pane must use the same non-fixed grouped party-table class as main');
assert(overallPartySource.includes('data-election-entity-kind="${safeKind}"') || electionManagerSource.includes('data-election-entity-kind="${safeKind}"'), '/test2 election entity buttons must expose the main data-election-entity-kind contract');
assert(electionManagerSource.includes('dataset.tableControlsReady') && !electionManagerSource.includes('test2TableControlsReady'), '/test2 election table controls must use the main data-table-controls-ready marker, not a test2-only marker');
assert(electionManagerSource.includes('ROI_MAIN_PARTY_COLOURS') && electionManagerSource.includes('mainPanePartyColour') && electionManagerSource.includes("'fine gael', '#6699FF'"), '/test2 Dail/election pane colours must route through the Wikipedia-aligned ROI party palette');
assert(electionManagerSource.includes("ELECTION_MANIFEST_URL = '/test/metadata/elections-test2.json?v=test-021'"), '/test2 election metadata cache key must be bumped when generated election bundle contracts change');
assert(electionManagerSource.includes('`${entry.resultUrl}?v=test-021`'), '/test2 election result bundle cache key must be bumped when generated constituency result JSON changes');
assert(electionManagerSource.includes('election-delta--pos') && electionManagerSource.includes('election-delta--neg') && !electionManagerSource.includes('election-delta--up') && !electionManagerSource.includes('election-delta--down'), '/test2 election pane deltas must use the same pos/neg classes as main');
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
assert(selectedPaneStatusSource.includes("text.includes('not elected')") && selectedPaneStatusSource.includes("text.includes('excluded')") && selectedPaneStatusSource.includes("text.includes('elected')") && selectedPaneStatusSource.includes('made quota'), '/test2 selected-pane status helper must treat Dail scraper Made Quota statuses as elected after guarding against Not Elected');
assert(electionManagerSource.includes('buildMainStyleConstituencyPartyRows') && electionManagerSource.includes('result?.countGroup') && electionManagerSource.includes('findPreviousSelectedResult'), '/test2 selected constituency/DEA party panes must derive rows from the main-shaped countGroup payload and previous-election result');
assert(electionManagerSource.includes('numberOrZero(countInfo.Valid_Poll) || numberOrZero(result?.validPoll)') && !electionManagerSource.includes('countInfo.Valid_Poll ?? result?.validPoll'), '/test2 selected constituency party panes must treat blank countInfo Valid_Poll as missing and fall back to result.validPoll');
assert(electionManagerSource.includes('renderConstituencyCandidateTable') && electionManagerSource.includes('election-party-table--candidate-sticky3'), '/test2 candidate panes must use the main grouped candidate-table contract');
assert(electionManagerSource.includes('renderLocalPartySummaryTable') && electionManagerSource.includes('election-party-table--district-local-party-sticky4'), '/test2 local-party panes must use the main grouped local-party table contract');
const resultHasAnimationStart = electionManagerSource.indexOf('resultHasAnimation(result = null)');
const resultHasAnimationEnd = electionManagerSource.indexOf('\n  currentResults()', resultHasAnimationStart);
const resultHasAnimationSource = resultHasAnimationStart >= 0 && resultHasAnimationEnd > resultHasAnimationStart
  ? electionManagerSource.slice(resultHasAnimationStart, resultHasAnimationEnd)
  : '';
assert(resultHasAnimationSource.includes('animationRows') && resultHasAnimationSource.includes('Number(row.Count_Number) > 1') && !resultHasAnimationSource.includes('if (result.animationPayload) return true'), '/test2 selected result Transfers tab must require real multi-count animation rows, not any synthetic scraper animation payload');
assert(electionManagerSource.includes('renderCountTable') && electionManagerSource.includes('election-count-row') && electionManagerSource.includes('election-count-wrapper--pane-sticky') && electionManagerSource.includes('visibleCounts'), '/test2 count panes must use the main visible-count table contract');
assert(electionDomainSource.includes('__syntheticCountGroup: true') && electionDomainSource.includes('syntheticCountGroup') && electionManagerSource.includes('result.syntheticCountGroup ? [1]') && electionManagerSource.includes('Not Elected<br>Count 1/1'), '/test2 scraper-style election results must use synthetic count payloads for animation without exposing synthetic multi-count columns in the visible Count pane');
assert(electionManagerSource.includes('renderPartyEntity') && electionManagerSource.includes('renderCandidateEntity') && electionManagerSource.includes('election-entity-page__hero'), '/test2 entity panes must use main-style entity page structure');
assert(appSource.includes('setupElectionPaneResize()') && appSource.includes('[data-election-pane-resize]') && appSource.includes('--test2-election-pane-height'), '/test2 must wire a draggable horizontal splitter for the bottom election pane');
assert(electionManagerSource.includes('data-election-pane-resize') && electionManagerSource.includes('aria-orientation="horizontal"'), '/test2 election pane must render an accessible horizontal resize handle between the map/catalogue area and results pane');
assert(test2Css.includes('.test2-election-pane-resizer') && test2Css.includes('cursor: row-resize') && test2Css.includes('grid-template-rows') && test2Css.includes('var(--test2-election-pane-height)'), '/test2 CSS must expose the election-pane row-resize handle and use its height variable in the open-pane grid');
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
assert(electionManifestBuilderSource.includes('isSyntheticNonGeographicResult') && electionManifestBuilderSource.includes('syntheticNonGeographicMatch') && electionManifestBuilderSource.includes('synthetic-northeast-non-geographic'), '/test2 election manifest builder must synthesize safe northeast anchors for non-geographical election rows');
assert(electionManagerSource.includes('test2-election-synthetic-label') && electionManagerSource.includes('result.syntheticNonGeographic') && test2Css.includes('.test2-election-synthetic-label'), '/test2 election overlays must render clickable labels for synthetic non-geographical constituency entries');
assert(electionManagerSource.includes('syntheticDelta') && electionManagerSource.includes('syntheticNonGeographic'), '/test2 election overlay collision must prioritize synthetic non-geographical markers so they do not disappear behind real constituencies');

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
  const dail2024ByParty = new Map(dail2024Rows.map((row) => [row.party, row]));
  const assertDail2024Party = (party, expected) => {
    const row = dail2024ByParty.get(party);
    assert(row?.stood === expected.stood && row?.seats === expected.seats && row?.votes === expected.votes, `/test2 Dail 2024 ${party} summary must use ElectionsIreland first preferences and explicit elected statuses`);
  };
  assertDail2024Party('Fianna F\u00e1il', { stood: 82, seats: 48, votes: 481414 });
  assertDail2024Party('Sinn F\u00e9in', { stood: 71, seats: 39, votes: 418627 });
  assertDail2024Party('Fine Gael', { stood: 80, seats: 38, votes: 458134 });
  assertDail2024Party('Independent', { stood: 171, seats: 16, votes: 290748 });
  assert(!dail2024ByParty.has('Ceann Comhairle (Speaker)'), '/test2 Dail 2024 bundle must count the automatically returned Ceann Comhairle under party affiliation, not as a standalone contested party row');
  assert(dail2024Bundle.mainLikeTotals?.validPoll === 2202453, '/test2 Dail 2024 bundle must exclude the Ceann Comhairle placeholder from the first-preference valid-poll denominator');
  assert(dail2024Bundle.mainLikeTotals?.totalSeats === 174, '/test2 Dail 2024 bundle must include the automatically returned Ceann Comhairle seat');
  const dail2024IndependentRows = new Map((dail2024Bundle.partySummary || []).map((row) => [row.party, row]));
  for (const [party, row] of dail2024ByParty) {
    const independent = dail2024IndependentRows.get(party);
    assert(!independent || (row.stood === independent.stood && row.seats === independent.seats && row.votes === independent.votes), `/test2 Dail 2024 ${party} main-like summary must match the independent source-shaped summary`);
  }
  for (const filename of readdirSync('test/metadata/elections-test2').filter((name) => /^dail-eireann__20\d\d-\d\d-\d\d\.json$/.test(name))) {
    const bundle = JSON.parse(readFileSync(`test/metadata/elections-test2/${filename}`, 'utf8'));
    const partyRows = new Map((bundle.partySummary || []).map((row) => [row.party, row]));
    for (const row of bundle.mainLikePartySummary || []) {
      const sourceRow = partyRows.get(row.party);
      assert(sourceRow && row.stood === sourceRow.stood && row.seats === sourceRow.seats && row.votes === sourceRow.votes, `/test2 ${filename} ${row.party} main-like summary must not drift from source-shaped partySummary`);
    }
  }
  const dail2024Mayo = (dail2024Bundle.results || []).find((result) => String(result.constituency || '').toLowerCase() === 'mayo');
  const dail2024MayoAnimationRows = dail2024Mayo?.animationPayload?.Constituency?.countGroup || [];
  assert(dail2024MayoAnimationRows.length > 0 && dail2024MayoAnimationRows.every((row) => Number(row.Count_Number) === 1), '/test2 Dail 2024 Mayo synthetic scraper rows must stay first-count-only and must not fabricate transfer stages');
  assert(dail2024Mayo?.syntheticCountGroup === true, '/test2 Dail 2024 Mayo must mark scraper-derived count rows as synthetic so Count pane output stays main-compatible');
  const dail2024RoscommonGalway = (dail2024Bundle.results || []).find((result) => String(result.constituency || '').toLowerCase() === 'roscommon galway');
  const roscommonGalwayCountRows = dail2024RoscommonGalway?.countGroup || [];
  const roscommonGalwayMadeQuotaRows = roscommonGalwayCountRows.filter((row) => /quota/i.test(String(row.Status || '')));
  assert(roscommonGalwayMadeQuotaRows.length >= 2, '/test2 Dail 2024 Roscommon Galway must retain the quota-status rows used by the screenshot parity guard');
  assert(roscommonGalwayMadeQuotaRows.every((row) => mainSelectedPaneStatusKind(row.Status) === 'elected'), '/test2 selected-pane status guard must treat Dail 2024 Roscommon Galway Made Quota rows as explicit elected statuses');
  assert(roscommonGalwayCountRows.some((row) => String(row.Party_Name || '') === 'Independent Ireland' && Number(row.Count_Number) === 1 && Number(row.Total_Votes) === 12002), '/test2 Dail 2024 Roscommon Galway must retain main-compatible first-count Independent Ireland row data');
  assert(roscommonGalwayCountRows.some((row) => String(row.Party_Name || '') === 'Sinn F\u00e9in' && Number(row.Count_Number) === 1 && Number(row.Total_Votes) === 8039), '/test2 Dail 2024 Roscommon Galway must keep synthetic Sinn Fein quota row data in a first-count-only scraper row');
  const dail2024CorkNorthCentral = (dail2024Bundle.results || []).find((result) => String(result.constituency || '').toLowerCase() === 'cork north central');
  const corkNorthCentralRows = dail2024CorkNorthCentral?.countGroup || [];
  assert(dail2024CorkNorthCentral?.hasCountDetail === false, '/test2 Dail 2024 Cork North-Central scraper result must not expose a fake Transfers tab');
  assert(corkNorthCentralRows.length > 0 && corkNorthCentralRows.every((row) => Number(row.Count_Number) === 1), '/test2 Dail 2024 Cork North-Central synthetic rows must all remain first-count rows');
  const corkByName = new Map(corkNorthCentralRows.map((row) => [String(row.candidateName || ''), row]));
  const assertCorkCandidate = (name, party, votes, status, colour) => {
    const row = corkByName.get(name);
    assert(row && String(row.Party_Name || '') === party && Number(row.Candidate_First_Pref_Votes) === votes && mainSelectedPaneStatusKind(row.Status) === status && String(row.Party_Colour || '').toLowerCase() === colour.toLowerCase(), `/test2 Dail 2024 Cork North-Central ${name} must match Wikipedia constituency first preferences/status/colour`);
  };
  assertCorkCandidate("P\u00e1draig O'Sullivan", 'Fianna F\u00e1il', 7708, 'elected', '#66bb66');
  assertCorkCandidate('Thomas Gould', 'Sinn F\u00e9in', 7399, 'elected', '#326760');
  assertCorkCandidate('Colm Burke', 'Fine Gael', 5736, 'elected', '#6699ff');
  assertCorkCandidate("Kenneth O'Flynn", 'Independent Ireland', 5733, 'elected', '#3bee56');
  assertCorkCandidate('Eoghan Kenny', 'Irish Labour', 3329, 'elected', '#cc0000');
  const dail2024BadSyntheticRows = [];
  const dail2024FakeTransferResults = [];
  const dail2024BlankValidPollResults = [];
  const dail2024ZeroPercentRows = [];
  for (const result of dail2024Bundle.results || []) {
    const rows = Array.isArray(result.countGroup) ? result.countGroup : [];
    const syntheticRows = rows.filter((row) => String(row.Synthetic_Scraper_Row || '') === '1');
    if (!syntheticRows.length) continue;
    const validPoll = Number(result.countInfo?.Valid_Poll || result.validPoll || 0);
    if (!validPoll) {
      dail2024BlankValidPollResults.push(result.constituency || 'Unknown');
    }
    for (const row of syntheticRows) {
      if (Number(row.Count_Number) !== 1) {
        dail2024BadSyntheticRows.push(`${result.constituency || 'Unknown'}:${row.candidateName || row.Candidate || 'Unknown'}`);
      }
      const firstPrefs = Number(row.Candidate_First_Pref_Votes || row.Total_Votes || 0);
      const firstPrefPct = validPoll > 0 ? firstPrefs / validPoll * 100 : 0;
      if (firstPrefs > 0 && firstPrefPct <= 0) {
        dail2024ZeroPercentRows.push(`${result.constituency || 'Unknown'}:${row.candidateName || row.Candidate || 'Unknown'}`);
      }
    }
    const countNumbers = Array.isArray(result.countNumbers) ? result.countNumbers : [];
    if (result.hasCountDetail === true || countNumbers.some((count) => Number(count) > 1)) {
      dail2024FakeTransferResults.push(result.constituency || 'Unknown');
    }
  }
  assert(dail2024BlankValidPollResults.length === 0, `/test2 Dail 2024 all synthetic scraper constituencies must expose a non-blank Valid_Poll denominator: ${dail2024BlankValidPollResults.slice(0, 5).join(', ')}`);
  assert(dail2024ZeroPercentRows.length === 0, `/test2 Dail 2024 selected constituency rows with votes must compute non-zero first-preference percentages: ${dail2024ZeroPercentRows.slice(0, 5).join(', ')}`);
  assert(dail2024BadSyntheticRows.length === 0, `/test2 Dail 2024 all synthetic scraper rows must stay first-count-only: ${dail2024BadSyntheticRows.slice(0, 5).join(', ')}`);
  assert(dail2024FakeTransferResults.length === 0, `/test2 Dail 2024 scraper-only results must not expose fake count detail: ${dail2024FakeTransferResults.slice(0, 5).join(', ')}`);
  const forumEntry = (electionManifest.elections || []).find((entry) => entry.body === 'Northern Ireland Forum for Political Dialogue' && entry.date === '1996-05-30');
  assert(forumEntry?.matchedCount === forumEntry?.totalConstituencies, '/test2 1996 Forum election must include the NI-wide regional-list result via a synthetic anchor');
  const forum1996Bundle = JSON.parse(readFileSync('test/metadata/elections-test2/northern-ireland-forum-for-political-dialogue__1996-05-30.json', 'utf8'));
  const forumRegionalList = (forum1996Bundle.results || []).find((result) => result.syntheticNonGeographic && result.featureName === 'Regional List');
  assert(forumRegionalList?.matched === true && Array.isArray(forumRegionalList.anchor?.center), '/test2 1996 Forum Regional List must be a clickable synthetic non-geographical result with a map anchor');
  assert(forumRegionalList?.anchor?.method === 'synthetic-northeast-non-geographic', '/test2 1996 Forum Regional List synthetic anchor must stay on the northeast side of the election geography');
  const stormont1921Bundle = JSON.parse(readFileSync('test/metadata/elections-test2/parliament-of-northern-ireland__1921-05-24.json', 'utf8'));
  const queensUniversity = (stormont1921Bundle.results || []).find((result) => result.syntheticNonGeographic && /Queen's University/.test(result.constituency || ''));
  assert(queensUniversity?.matched === true && Array.isArray(queensUniversity.anchor?.center), '/test2 Queen\'s University Stormont rows must be clickable synthetic non-geographical results with map anchors');
  assert(queensUniversity?.anchor?.method === 'synthetic-northeast-non-geographic', '/test2 Queen\'s University synthetic anchor must stay on the northeast side of the election geography');
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
  assert(!electionReport.residualSummary?.['university-seat-no-polygon'], '/test2 university-seat rows should be represented by synthetic non-geographical anchors, not left as unmatched polygon gaps');
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
