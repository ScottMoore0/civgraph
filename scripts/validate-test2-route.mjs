#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const failures = [];
const index = readFileSync('test2/index.html', 'utf8');
const appSource = readFileSync('test2/src/app.js', 'utf8');
const adapterSource = readFileSync('test2/src/maplibre-main-adapter.js', 'utf8');
const electionManagerSource = readFileSync('test2/src/election-manager.js', 'utf8');
const electionDomainSource = readFileSync('js/election-domain.mjs', 'utf8');
const electionManifestBuilderSource = readFileSync('scripts/build-test2-election-manifest.mjs', 'utf8');
const mapControllerSource = readFileSync('test/src/map-controller.js', 'utf8');
const labelsSource = readFileSync('test/src/labels.js', 'utf8');
const featureRepairsSource = readFileSync('test/src/feature-property-repairs.js', 'utf8');
const test2Css = readFileSync('test2/src/test2.css', 'utf8');

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(index.includes('<base href="/">'), '/test2 must keep root-relative production assets via <base href="/">');
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
assert(appSource.includes('installCatalogueStateBridge'), '/test2 must bridge production catalogue detail navigation into URL state');
assert(appSource.includes('setupURLStateListener'), '/test2 must restore state on hash navigation, not only first boot');
assert(appSource.includes('setActiveLayersPanelOpen') && appSource.includes('setMapControlsOpen'), '/test2 panel restore must set panel state directly instead of click-toggling');
assert(appSource.includes('applyBaseMap') && appSource.includes('isStyleLoaded'), '/test2 restored base-map state must wait for the MapLibre style to load');
assert(appSource.includes('setupSourcePanel') && appSource.includes('renderSourcePanel'), '/test2 must expose source metadata for active/restored layers');
assert(test2Css.includes('.test2-source-panel'), '/test2 source panel must have scoped route CSS');
assert(test2Css.includes('position: fixed') && test2Css.includes('z-index: 520'), '/test2 source panel must sit above restored map overlay panels');
assert(appSource.includes('getConvertedCompositeChildIds'), '/test2 must expand converted child sources when a main catalogue parent lacks a direct converted layer');
assert(appSource.includes('compositeSources') && appSource.includes('mapConfig.variants.map'), '/test2 composite fallback must cover main composite sources and non-group variant parents');
assert(mapControllerSource.includes('maplibre-dom-label'), '/test2 must use deduplicated DOM labels for main-site label interaction parity');
assert(mapControllerSource.includes("'text-opacity': 0"), '/test2 native MapLibre symbol labels must stay visually hidden to avoid duplicate labels');
assert(mapControllerSource.includes("NavigationControl({ visualizePitch: true }), 'top-left'"), '/test2 MapLibre zoom/navigation controls must not share the active-layers top-right corner');
assert(mapControllerSource.includes("ScaleControl({ unit: 'metric' }), 'bottom-right'"), '/test2 MapLibre scale control must not share the bottom-left settings corner');
assert(test2Css.includes('#map .maplibregl-ctrl-top-left') && test2Css.includes('#map .maplibregl-ctrl-bottom-right'), '/test2 route CSS must explicitly place MapLibre controls away from production shell overlays');
assert(mapControllerSource.includes("this.map.on('dblclick', onDoubleClick)"), '/test2 feature geometry selection must be wired to double-click');
assert(test2Css.includes('.maplibre-dom-label.map-label--hover'), '/test2 DOM labels must expose hover styling');
assert(test2Css.includes('.maplibre-dom-label.map-label--selected'), '/test2 selected DOM labels must keep the same orange styling as hover labels');
assert(test2Css.includes('color: #ff7a1a !important'), '/test2 hovered labels must change text colour directly like the main site');
assert(mapControllerSource.includes("const INTERACTION_FILL_COLOR = '#FDBA74'"), '/test2 selected and hover fills must share the main-style light orange colour');
assert(mapControllerSource.includes("const INTERACTION_STROKE_COLOR = '#FF7A1A'"), '/test2 selected and hover strokes must share the main-style deep orange colour');
assert(mapControllerSource.includes('selectedFillId') && mapControllerSource.includes("['feature-state', 'selected']"), '/test2 polygon selections must include a selected fill, not only an outline');
assert(mapControllerSource.includes('Polygon vector-tile features are clipped at tile boundaries'), '/test2 polygon interaction strokes must stay disabled to avoid tile-seam highlight artifacts');
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
assert(appSource.includes('Test2ElectionManager'), '/test2 must wire the election manager into the main shell route');
assert(!appSource.includes('Election map workflows are not converted for /test2 yet'), '/test2 election callbacks must not remain disabled stubs');
assert(appSource.includes('onBuildElectionCatalogueCards') && appSource.includes('this.elections?.buildCatalogueCards'), '/test2 catalogue must expose generated election entries');
assert(appSource.includes('enrichFeature: (feature, selection) => this.elections?.enrichFeature'), '/test2 selected feature details must merge election results where active');
assert(appSource.includes('setupTimelineControls') && appSource.includes('setTimelineItems'), '/test2 must wire the production timeline slider for map chains and elections');
assert(adapterSource.includes('applyElectionStyle') && adapterSource.includes('clearElectionStyle'), '/test2 adapter must support MapLibre election styling expressions');
assert(electionManagerSource.includes('ELECTION_MANIFEST_URL') && electionManagerSource.includes('loadElection(body, date)'), '/test2 election manager must lazy-load generated election result bundles');
assert(electionManagerSource.includes('voteShare') && electionManagerSource.includes('turnout') && electionManagerSource.includes('quota'), '/test2 election manager must expose requested election styling modes');
assert(electionManagerSource.includes('renderSeatCircles') && electionManagerSource.includes('test2-election-seat-layer'), '/test2 election manager must render seat circles for ordinary elections');
assert(electionManagerSource.includes('electionResultsPane') && electionManagerSource.includes('election-results-pane--open'), '/test2 election results must render in the production below-map election pane');
assert(electionDomainSource.includes('summarizeResult') && electionDomainSource.includes('extractElected') && electionDomainSource.includes('buildEntityIndex'), '/test2 must use shared election-domain logic for result summaries, elected extraction, and entity indexes');
assert(electionManagerSource.includes("from '../../js/election-domain.mjs'") && electionManagerSource.includes('renderCountTable') && electionManagerSource.includes('renderEntityPanel'), '/test2 election rendering must consume shared domain logic and expose count/entity views');
assert(electionManifestBuilderSource.includes('OUT_ANCHOR_DIR') && electionManifestBuilderSource.includes('geometryAnchor') && electionManifestBuilderSource.includes('anchorUrl'), '/test2 election manifest build must generate geometry-derived election anchor sidecars');
assert(electionManifestBuilderSource.includes('previousKey') && electionManifestBuilderSource.includes('partySummary') && electionManifestBuilderSource.includes('entityIndex'), '/test2 election bundles must include previous-election linkage and rich pane data');
assert(test2Css.includes('body.app-shell.test2-election-open'), '/test2 must resize the production shell when the election pane opens below the map');
assert(featureRepairsSource.includes('ARMAGH AREA D') && featureRepairsSource.includes('DUNGANNON AREA C') && featureRepairsSource.includes('LIMAVADY AREA C'), '/test2 must repair known unnamed/misnamed deas-1972 feature labels');
assert(labelsSource.includes('buildRepairedLabelValueExpression') && labelsSource.includes('repairFeatureProperties'), '/test2 label rendering must use repaired feature properties for known source-data label defects');
assert(mapControllerSource.includes('repairFeatureProperties(layer, feature.properties || {})'), '/test2 feature selection payloads must include repaired source-data labels');
assert(adapterSource.includes('repairFeatureProperties(layerConfig'), '/test2 normalized MapLibre features must include repaired source-data labels');
assert(electionManagerSource.includes('buildRepairedLabelValueExpression') && electionManagerSource.includes('repairFeatureProperties'), '/test2 election matching/styling must use repaired source-data labels');

for (const path of [
  'test2/build/test2.bundle.js',
  'test2/build/test2.bundle.css',
  'test2/src/app.js',
  'test2/src/maplibre-main-adapter.js',
  'test2/src/election-manager.js',
  'js/election-domain.mjs',
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
}

if (existsSync('test/metadata/elections-test2-report.json')) {
  const electionReport = JSON.parse(readFileSync('test/metadata/elections-test2-report.json', 'utf8'));
  assert(!electionReport.residualSummary?.['historic-dea-not-in-source'], '/test2 deas-1972 election residuals should be resolved by source-data label repairs');
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
