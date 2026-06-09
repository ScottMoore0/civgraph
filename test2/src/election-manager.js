import {
  buildRepairedLabelValueExpression,
  repairFeatureProperties
} from '../../test/src/feature-property-repairs.js';
import maplibregl from 'maplibre-gl';
import {
  createElectionRenderer,
  numericColour as sharedNumericColour
} from '../../js/election-renderer.mjs';
import { MainElectionPaneContract } from '../../js/election-main-pane-contract.mjs';
import {
  buildCandidateSummary,
  buildEntityIndex,
  buildPartySummary,
  compareResults,
  extractElected,
  normalizeParty,
  partyColour as electionPartyColour,
  seatPositions
} from '../../js/election-domain.mjs';

const ELECTION_MANIFEST_URL = '/test/metadata/elections-test2.json?v=test-021';
const DEFAULT_MODE_ORDER = ['winner', 'leadingParty', 'voteShare', 'turnout', 'majority', 'seats', 'quota'];
const SEAT_SOURCE_ID = 'test2-election-seat-source';
const SEAT_HALO_LAYER_ID = 'test2-election-seat-halo-layer';
const SEAT_LAYER_ID = 'test2-election-seat-layer';
const SEAT_OVERLAY_ID = 'test2-election-seat-overlay';
const VOTE_BAR_SOURCE_ID = 'test2-election-vote-bar-source';
const VOTE_BAR_LAYER_ID = 'test2-election-vote-bar-layer';
const RECALL_LABEL_SOURCE_ID = 'test2-election-recall-label-source';
const RECALL_LABEL_LAYER_ID = 'test2-election-recall-label-layer';
const SEAT_CIRCLE_SIZE = 12;
const SEAT_CIRCLE_SPACING = SEAT_CIRCLE_SIZE + 1;
const SEAT_CIRCLE_COLLISION_MARGIN = 4;
const SEAT_CIRCLE_MIN_TOTAL_EXTENT = 120;
const SYNTHETIC_ELECTION_LABEL_HEIGHT = 18;
const ELECTION_BUNDLE_CACHE_LIMIT = 4;
const ELECTION_FEATURE_INDEX_CACHE_LIMIT = 3;
const SEAT_CIRCLE_GROUP_LIMIT_DESKTOP = 260;
const SEAT_CIRCLE_GROUP_LIMIT_TABLET = 160;
const SEAT_CIRCLE_GROUP_LIMIT_MOBILE = 90;

let electionAnimationRuntimePromise = null;

const MAIN_ELECTION_GEOGRAPHY_STYLE = Object.freeze({
  unmatchedFillColor: '#dfe4ec',
  unmatchedFillOpacity: 0.42,
  unmatchedStrokeColor: '#a1aab8',
  matchedFillOpacity: 0.6,
  matchedStrokeColor: '#333',
  strokeOpacity: 0.8,
  strokeWidth: 1.5
});

const MODE_LABELS = {
  winner: 'Winner',
  leadingParty: 'Leading party',
  voteShare: 'Vote share',
  turnout: 'Turnout',
  majority: 'Majority',
  seats: 'Seats',
  quota: 'Quota'
};

const PARTY_COLOURS = new Map([
  ['alliance', '#f6cb2f'],
  ['aontu', '#44532a'],
  ['conservative', '#0087dc'],
  ['dup', '#d46a4c'],
  ['fianna fail', '#66bb66'],
  ['fine gael', '#6699ff'],
  ['green', '#22ac6f'],
  ['green party', '#22ac6f'],
  ['independent', '#b8b8b8'],
  ['independent ireland', '#3bee56'],
  ['independent unionist', '#aadfff'],
  ['independent labour', '#ff9999'],
  ['independent nationalist', '#cdffab'],
  ['irish labour', '#cc0000'],
  ['labour', '#cc0000'],
  ['nationalist party', '#32cd32'],
  ['northern ireland labour party', '#dc241f'],
  ['pbp', '#ff0090'],
  ['people\'s democracy', '#ff0000'],
  ['republican clubs', '#930c1a'],
  ['republican labour party', '#85de59'],
  ['sdlp', '#2aa82c'],
  ['sinn fein', '#326760'],
  ['social democrats', '#752f8b'],
  ['solidarity pbp', '#8e2420'],
  ['solidarity-pbp', '#8e2420'],
  ['tuv', '#0c3a6a'],
  ['unionist party of northern ireland', '#ffa07a'],
  ['uup', '#48a5ee'],
  ['yes', '#2aa82c'],
  ['no', '#d46a4c']
]);

const ROI_MAIN_PARTY_COLOURS = new Map([
  ['fianna fail', '#66BB66'],
  ['fine gael', '#6699FF'],
  ['sinn fein', '#326760'],
  ['labour', '#CC0000'],
  ['irish labour', '#CC0000'],
  ['the labour party', '#CC0000'],
  ['green comhaontas glas', '#22AC6F'],
  ['green party', '#22AC6F'],
  ['green', '#22AC6F'],
  ['social democrats', '#752F8B'],
  ['people before profit solidarity', '#FF0090'],
  ['pbp solidarity', '#FF0090'],
  ['solidarity people before profit', '#8E2420'],
  ['solidarity pbp', '#8E2420'],
  ['people before profit', '#FF0090'],
  ['aontu', '#44532A'],
  ['independent ireland', '#3BEE56'],
  ['progressive democrats', '#1251A2'],
  ['workers party republican clubs', '#930C1A'],
  ['independents 4 change', '#FFC0CB'],
  ['renua', '#FFA500'],
  ['independent', '#DCDCDC'],
  ['non party independent', '#DCDCDC'],
  ['yes', '#43A047'],
  ['no', '#E53935']
]);

export class Test2ElectionManager {
  constructor({ app, mapController, onError } = {}) {
    this.app = app;
    this.mapController = mapController;
    this.onError = onError;
    this.catalogue = null;
    this.activeEntry = null;
    this.activeBundle = null;
    this.previousBundle = null;
    this.activeMode = 'winner';
    this.overlayMode = 'circles';
    this.activePanelView = 'party';
    this.activeSelectedResultKey = null;
    this.activeEntityKind = null;
    this.activeEntityKey = null;
    this.activeEntityReturnView = 'party';
    this.activeLocalMode = 'dea';
    this.countDetailedView = false;
    this.bundleCache = new Map();
    this.featureIndexCache = new Map();
    this.resultsByLayer = new Map();
    this.seatCircleClickBound = false;
    this.seatCircleOverlay = null;
    this.seatCircleOverlayState = { groups: [], dotCount: 0 };
    this.seatCircleMarkers = [];
    this.lastSeatCircleRenderMs = 0;
    this.overlayRefreshPending = false;
    this.seatCirclePositionUpdatePending = false;
    this.overlayWorker = null;
    this.overlayWorkerSeq = 0;
    this.overlayWorkerCallbacks = new Map();
    this.voteBarClickBound = false;
    this.recallLabelClickBound = false;
    this.overlayRefreshBound = false;
    this.loadSerial = 0;
    this.sharedRenderer = createElectionRenderer(this);
    this.mainPaneContract = new MainElectionPaneContract(this);
  }

  async load() {
    const response = await fetch(ELECTION_MANIFEST_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Failed to load /test2 election catalogue: ${response.status}`);
    this.catalogue = await response.json();
    return this.catalogue;
  }

  buildCatalogueCards() {
    return (this.catalogue?.elections || []).map((entry) => ({
      ...entry,
      canonicalLayerId: this.getCanonicalLayerId(entry),
      placeholder: !entry.loadable,
      displaySubtitle: this.getMainCatalogueSubtitle(entry),
      displayProvider: this.getMainCatalogueProvider(entry),
      displayTitle: entry.displayTitle || entry.body
    }));
  }

  getMainCatalogueProvider(entry) {
    if (!entry) return '';
    if (entry.displayProvider && entry.displayProvider !== entry.body) return entry.displayProvider;
    if (entry.bodyGroup === 'local-government') return 'Local Government Districts';
    return shortElectionBody(entry.body);
  }

  getMainCatalogueSubtitle(entry) {
    if (!entry) return '';
    if (entry.displaySubtitle) return entry.displaySubtitle;
    const constituencies = Array.isArray(entry.constituencies) ? entry.constituencies : [];
    if (entry.isByElection && constituencies.length) return constituencies.join(', ');
    if (entry.body === 'European Parliament' && constituencies.filter((value) => value !== 'Northern Ireland').length === 0) {
      return 'Northern Ireland';
    }
    if (entry.bodyGroup === 'local-government') {
      const total = Number(entry.totalConstituencies ?? constituencies.length);
      return `${Number.isFinite(total) ? total : 0} DEAs`;
    }
    const total = Number(entry.totalConstituencies ?? constituencies.filter((value) => value !== 'Northern Ireland').length);
    return `${Number.isFinite(total) ? total : 0} constituencies`;
  }

  async loadElection(body, date) {
    const requestId = ++this.loadSerial;
    const entry = this.findEntry(body, date);
    if (!entry) throw new Error(`Election not found: ${body} ${date}`);
    if (!entry.loadable) {
      throw new Error(`${body} ${date} is in the election catalogue, but its geography is not converted for /test2 yet.`);
    }

    if (this.activeEntry && (this.activeEntry.body !== body || this.activeEntry.date !== date)) {
      this.unloadElection();
    }

    this.renderLoadingPanel(entry);
    const mapPromise = this.app.loadMap(entry.sourceMapId);
    const bundlePromise = this.loadBundle(entry);
    const previousBundlePromise = this.loadPreviousBundle(entry);
    const featureIndexPromise = bundlePromise
      .then((loadedBundle) => this.loadFeatureIndexForBundle(loadedBundle))
      .catch(() => null);
    const [bundle, previousBundle] = await Promise.all([
      bundlePromise,
      previousBundlePromise,
      mapPromise,
      featureIndexPromise
    ]).then(([loadedBundle, loadedPreviousBundle]) => [loadedBundle, loadedPreviousBundle]);
    if (requestId !== this.loadSerial) return;
    this.activeEntry = entry;
    this.activeBundle = bundle;
    this.previousBundle = previousBundle;
    this.activeMode = entry.stylingModes?.includes(this.activeMode)
      ? this.activeMode
      : (entry.stylingModes?.find((mode) => DEFAULT_MODE_ORDER.includes(mode)) || 'winner');
    if (!this.shouldRenderElectionOverlays()) this.overlayMode = 'circles';
    this.activePanelView = 'party';
    this.activeSelectedResultKey = null;
    this.activeEntityKind = null;
    this.activeEntityKey = null;
    this.activeEntityReturnView = 'party';
    this.activeLocalMode = entry.bodyGroup === 'local-government' ? 'dea' : 'constituency';
    this.countDetailedView = false;
    this.indexBundle(bundle);
    await this.syncLocalGovernmentBackingLayers();
    this.applyActiveStyle();
    this.renderPanel();
    await nextFrame();
    await this.renderElectionOverlay();
    this.updateElectionTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    this.app.focusActiveElectionCatalogueEntry?.(entry, { scroll: false });
    this.app.updateURLState();
  }

  unloadElection(options = {}) {
    const { unloadBackingLayer = true } = options || {};
    const sourceMapId = this.activeEntry?.sourceMapId;
    const backingLayerIds = unloadBackingLayer ? this.getActiveElectionBackingLayerIds() : [];
    if (sourceMapId) this.mapController.clearElectionStyle?.(sourceMapId);
    if (this.activeBundle?.councilSourceMapId) this.mapController.clearElectionStyle?.(this.activeBundle.councilSourceMapId);
    this.removeElectionOverlays();
    this.resultsByLayer.clear();
    this.activeEntry = null;
    this.activeBundle = null;
    this.previousBundle = null;
    this.activeSelectedResultKey = null;
    this.activeEntityKind = null;
    this.activeEntityKey = null;
    this.activeEntityReturnView = 'party';
    this.removePanel();
    this.unloadElectionBackingLayers(backingLayerIds);
    this.app.updateTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    this.app.updateMapList?.();
    this.app.updateURLState();
  }

  getActiveElectionBackingLayerIds(entry = this.activeEntry, bundle = this.activeBundle) {
    return [...new Set([
      entry?.sourceMapId,
      bundle?.sourceMapId,
      bundle?.layerId,
      bundle?.councilSourceMapId,
      bundle?.councilLayerId
    ].filter(Boolean))];
  }

  unloadElectionBackingLayers(layerIds = []) {
    for (const layerId of layerIds) {
      if (
        this.mapController.getLayerState?.(layerId)
        || this.mapController.groupStates?.has(layerId)
        || this.mapController.isLayerLoaded?.(layerId)
      ) {
        this.mapController.unloadLayer(layerId);
      }
    }
  }

  async syncLocalGovernmentBackingLayers() {
    if (!this.isLocalGovernmentElection()) return;
    const deaId = this.activeEntry?.sourceMapId || this.activeBundle?.sourceMapId;
    const councilId = this.activeBundle?.councilSourceMapId || this.activeEntry?.councilSourceMapId;
    if (this.activeLocalMode === 'district' && councilId) {
      if (!this.mapController.isLayerLoaded?.(councilId)) {
        await this.mapController.loadLayer(councilId, { fit: false });
      }
      if (deaId && this.mapController.isLayerLoaded?.(deaId)) {
        this.mapController.clearElectionStyle?.(deaId);
        this.mapController.hideLayer?.(deaId);
      }
      this.mapController.showLayer?.(councilId);
      return;
    }
    if (councilId && this.mapController.isLayerLoaded?.(councilId)) {
      this.mapController.clearElectionStyle?.(councilId);
      this.mapController.hideLayer?.(councilId);
    }
    if (deaId && this.mapController.isLayerLoaded?.(deaId)) {
      this.mapController.showLayer?.(deaId);
    }
  }

  isElectionLoaded(body, date) {
    return this.activeEntry?.body === body && this.activeEntry?.date === date;
  }

  getURLState() {
    if (!this.activeEntry) return null;
    return {
      layerId: this.getCanonicalLayerId(this.activeEntry),
      body: this.activeEntry.body,
      date: this.activeEntry.date,
      mode: this.activeMode,
      overlay: this.overlayMode,
      view: this.activePanelView,
      localMode: this.activeLocalMode,
      selected: this.activeSelectedResultKey,
      countDetail: this.countDetailedView,
      entityKind: this.activeEntityKind,
      entityKey: this.activeEntityKey,
      entityReturnView: this.activeEntityReturnView
    };
  }

  async restoreURLState(params) {
    let body = params.get('electionBody');
    let date = params.get('electionDate');
    const mainElectionParam = params.get('election');
    let mainElectionSelected = null;
    if (mainElectionParam && !body && !date) {
      const parts = mainElectionParam.split(':');
      if (parts.length >= 2) {
        const bodySlug = parts[0];
        date = parts[1];
        mainElectionSelected = parts.length > 2 ? parts[2] : null;
        const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');
        const mainEntry = (this.catalogue?.elections || []).find((entry) => slugify(entry.body) === bodySlug && entry.date === date);
        if (mainEntry) body = mainEntry.body;
      }
    }
    if (!body || !date) {
      const layerIds = (params.get('layers') || '').split(',').map((id) => id.trim()).filter(Boolean);
      const canonicalEntry = layerIds.map((id) => this.findEntryByCanonicalLayerId(id)).find(Boolean);
      if (canonicalEntry) {
        body = canonicalEntry.body;
        date = canonicalEntry.date;
      }
    }
    if (!body || !date) return;
    await this.loadElection(body, date);
    const mode = params.get('electionMode');
    if (mode && this.activeEntry?.stylingModes?.includes(mode)) {
      this.activeMode = mode;
      this.applyActiveStyle();
    }
    this.overlayMode = params.get('electionOverlay') === 'bars' ? 'bars' : this.overlayMode;
    this.activeLocalMode = params.get('electionLocalMode') === 'district' ? 'district' : this.activeLocalMode;
    await this.syncLocalGovernmentBackingLayers();
    this.applyActiveStyle();
    const explicitSelected = params.has('electionSelected') || Boolean(mainElectionSelected);
    const selected = params.get('electionSelected') || mainElectionSelected || '';
    const selectedResult = explicitSelected ? this.findResultByKey(selected) : null;
    const validSelected = Boolean(selectedResult);
    const explicitView = params.has('electionView');
    const requestedView = explicitView ? params.get('electionView') : null;
    const view = validSelected
      ? (requestedView || 'party')
      : (requestedView && requestedView !== 'counts' && requestedView !== 'animation' ? requestedView : 'party');
    this.countDetailedView = validSelected && params.get('electionCountDetail') === '1';
    if (!validSelected) {
      this.activeSelectedResultKey = null;
      this.activeEntityKind = null;
      this.activeEntityKey = null;
      this.activeEntityReturnView = null;
    }
    await this.renderElectionOverlay();
    this.renderPanel(validSelected ? selectedResult : null, view);
    const entityKind = params.get('electionEntityKind');
    const entityKey = params.get('electionEntityKey');
    if (validSelected && entityKind && entityKey) {
      this.activeEntityReturnView = params.get('electionEntityReturnView') || view || 'party';
      this.renderEntityPanel(entityKind, entityKey, { updateURL: false });
    }
    this.app.focusActiveElectionCatalogueEntry?.(this.activeEntry, { scroll: false });
  }

  async loadBundle(entry) {
    if (this.bundleCache.has(entry.key)) return this.bundleCache.get(entry.key);
    const response = await fetch(`${entry.resultUrl}?v=test-021`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Failed to load election results for ${entry.body} ${entry.date}: ${response.status}`);
    const bundle = await response.json();
    rememberLimitedCache(this.bundleCache, entry.key, bundle, ELECTION_BUNDLE_CACHE_LIMIT);
    return bundle;
  }

  async loadPreviousBundle(entry) {
    if (!entry?.previousKey) return null;
    const previousEntry = (this.catalogue?.elections || []).find((item) => item.key === entry.previousKey);
    if (!previousEntry?.resultUrl) return null;
    try {
      return await this.loadBundle(previousEntry);
    } catch (error) {
      console.warn('[test2 elections] Previous bundle unavailable', entry.previousKey, error);
      return null;
    }
  }

  indexBundle(bundle) {
    const layerResults = new Map();
    for (const result of bundle.results || []) {
      for (const key of resultKeys(result)) {
        if (!layerResults.has(key)) layerResults.set(key, result);
      }
    }
    if (bundle.layerId) this.resultsByLayer.set(bundle.layerId, layerResults);
    if (bundle.sourceMapId) this.resultsByLayer.set(bundle.sourceMapId, layerResults);
  }

  enrichFeature(feature) {
    if (!this.activeBundle || !feature) return feature;
    const layerResults = this.resultsByLayer.get(feature.mapId)
      || this.resultsByLayer.get(this.activeBundle.layerId)
      || this.resultsByLayer.get(this.activeBundle.sourceMapId);
    const result = this.findResultForFeature(layerResults, feature);
    if (!result) return feature;
    const properties = {
      ...(feature.properties || {}),
      Election: `${this.activeBundle.body} (${this.activeBundle.date})`,
      Constituency: result.constituency,
      'Winning party': result.winnerParty || '',
      Winner: result.winnerName || '',
      'Leading party': result.leadingParty || '',
      'Leading candidate': result.leadingName || '',
      'Leading votes': formatNumber(result.leadingVotes),
      'Vote share': formatPercent(result.leadingPct),
      Turnout: formatPercent(result.turnoutPct),
      Majority: formatNumber(result.majority),
      'Majority share': formatPercent(result.majorityPct),
      'Seats won': formatNumber(result.seatsWon),
      Seats: formatNumber(result.seatsTotal),
      Quota: formatNumber(result.quota),
      Electorate: formatNumber(result.electorate),
      'Valid poll': formatNumber(result.validPoll)
    };
    return {
      ...feature,
      featureName: feature.featureName || result.constituency,
      name: feature.name || result.constituency,
      electionResult: result,
      properties
    };
  }

  findResultForFeature(layerResults, feature) {
    if (!layerResults) return null;
    const repairedProperties = repairFeatureProperties({
      id: this.activeBundle.layerId,
      sourceMapId: this.activeBundle.sourceMapId,
      labelProperty: this.activeBundle.labelProperty
    }, feature.properties || {});
    const candidates = [
      feature.featureName,
      feature.name,
      repairedProperties?.[this.activeBundle.labelProperty],
      repairedProperties?.name,
      repairedProperties?.Name,
      repairedProperties?.NAME,
      feature.id
    ];
    for (const value of candidates) {
      const result = layerResults.get(normalizeName(value));
      if (result) return result;
    }
    return null;
  }

  applyActiveStyle() {
    if (!this.activeEntry || !this.activeBundle) return;
    const styleLayer = this.getActiveElectionStyleLayer();
    const styleSourceMapId = styleLayer?.sourceMapId || this.getActiveElectionStyleSourceMapId();
    if (!styleSourceMapId) return;
    const fillColorExpression = this.buildColourExpression(
      this.activeMode,
      MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedFillColor,
      styleLayer
    );
    const isPointGeometry = styleLayer?.geometryType === 'point';
    this.mapController.applyElectionStyle?.(styleSourceMapId, {
      mode: this.activeMode,
      fillColorExpression,
      lineColorExpression: isPointGeometry
        ? fillColorExpression
        : this.buildElectionMatchExpression(
          () => MAIN_ELECTION_GEOGRAPHY_STYLE.matchedStrokeColor,
          MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedStrokeColor,
          styleLayer
        ),
      fillOpacityExpression: isPointGeometry
        ? undefined
        : this.buildElectionMatchExpression(
          () => MAIN_ELECTION_GEOGRAPHY_STYLE.matchedFillOpacity,
          MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedFillOpacity,
          styleLayer
        ),
      lineOpacity: isPointGeometry ? undefined : MAIN_ELECTION_GEOGRAPHY_STYLE.strokeOpacity,
      lineWidth: isPointGeometry ? undefined : MAIN_ELECTION_GEOGRAPHY_STYLE.strokeWidth,
      hideLabels: true
    });
    this.renderLegend();
  }

  getActiveElectionStyleSourceMapId() {
    if (this.isLocalGovernmentElection() && this.activeLocalMode === 'district') {
      return this.activeBundle?.councilSourceMapId || this.activeEntry?.councilSourceMapId || this.activeEntry?.sourceMapId;
    }
    return this.activeEntry?.sourceMapId || this.activeBundle?.sourceMapId;
  }

  getActiveElectionStyleLayer() {
    const sourceMapId = this.getActiveElectionStyleSourceMapId();
    if (!sourceMapId) return this.activeBundle;
    const layer = this.mapController?.resolveLayer?.(sourceMapId)
      || this.app?.metadataService?.getLayer?.(sourceMapId)
      || null;
    return layer || {
      id: this.isLocalGovernmentElection() && this.activeLocalMode === 'district'
        ? this.activeBundle?.councilLayerId
        : this.activeBundle?.layerId,
      sourceMapId,
      labelProperty: this.isLocalGovernmentElection() && this.activeLocalMode === 'district'
        ? this.activeBundle?.councilLabelProperty
        : this.activeBundle?.labelProperty,
      geometryType: this.isLocalGovernmentElection() && this.activeLocalMode === 'district'
        ? this.activeBundle?.councilGeometryType
        : this.activeBundle?.geometryType
    };
  }

  buildElectionMatchInput(layer = this.activeBundle) {
    const labelProperty = layer?.labelProperty || 'name';
    return buildRepairedLabelValueExpression({
      id: layer?.id || this.activeBundle?.layerId,
      sourceMapId: layer?.sourceMapId || this.activeBundle?.sourceMapId,
      labelProperty
    }, ['to-string', ['get', labelProperty]]);
  }

  buildElectionMatchExpression(valueForResult, fallback, layer = this.activeBundle, results = this.activeBundle?.results || []) {
    const labels = [];
    const seen = new Set();
    for (const result of results || []) {
      if (!result.matched && !(this.isLocalGovernmentElection() && this.activeLocalMode === 'district')) continue;
      for (const label of resultFeatureLabels(result)) {
        if (seen.has(label)) continue;
        seen.add(label);
        labels.push(label, valueForResult(result));
      }
    }
    if (!labels.length) return fallback;
    return ['match', ['to-string', this.buildElectionMatchInput(layer)], ...labels, fallback];
  }

  buildColourExpression(mode, fallback = MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedFillColor, layer = this.activeBundle) {
    if (this.isLocalGovernmentElection() && this.activeLocalMode === 'district') {
      return this.buildCouncilColourExpression(mode, fallback, layer);
    }
    return this.buildElectionMatchExpression(
      (result) => this.colourForMode(mode, result),
      fallback,
      layer
    );
  }

  buildCouncilColourExpression(mode, fallback, layer = this.activeBundle) {
    const rows = buildCouncilSummary(this.currentResults());
    const resultRows = rows.map((row) => ({
      constituency: row.council,
      matchName: row.council,
      matched: true,
      winnerParty: row.leadingParty,
      leadingParty: row.leadingParty,
      leadingColour: this.mainPanePartyColour(row.leadingParty, row.colour),
      colour: this.mainPanePartyColour(row.leadingParty, row.colour),
      leadingPct: row.share,
      seatsWon: row.seats,
      seatsTotal: row.seats,
      turnoutPct: row.turnoutPct
    }));
    return this.buildElectionMatchExpression(
      (result) => this.colourForMode(mode, result),
      fallback,
      layer,
      resultRows
    );
  }

  colourForMode(mode, result) {
    if (mode === 'winner') return this.partyColourForResult(result, result.winnerParty, result.colour, { preferElected: true }) || '#6b7280';
    if (mode === 'leadingParty') return this.partyColourForResult(result, result.leadingParty, result.leadingColour) || '#6b7280';
    if (mode === 'turnout') return sharedNumericColour(result.turnoutPct, 35, 80);
    if (mode === 'voteShare') return sharedNumericColour(result.leadingPct, 10, 70);
    if (mode === 'majority') return sharedNumericColour(result.majorityPct, 0, 45);
    if (mode === 'seats') return sharedNumericColour(result.seatsWon ?? result.seatsTotal, 1, 6);
    if (mode === 'quota') return sharedNumericColour(result.quota, 1_000, 120_000);
    return '#6b7280';
  }

  usesMainRoiPartyPalette() {
    const values = [
      this.activeBundle?.body,
      this.activeEntry?.body,
      this.activeBundle?.bodyGroup,
      this.activeEntry?.bodyGroup,
      this.activeBundle?.jurisdiction,
      this.activeEntry?.jurisdiction,
      this.activeBundle?.region,
      this.activeEntry?.region,
      this.activeBundle?.id,
      this.activeEntry?.id,
      this.activeEntry?.key
    ].map((value) => normalizeName(value));
    const joined = values.join(' ');
    if (joined.includes('dail')) return true;
    if (joined.includes('president of ireland')) return true;
    if (joined.includes('referendum ireland')) return true;
    if (joined.includes('european parliament ireland')) return true;
    if (joined.includes('republic of ireland') && joined.includes('european parliament')) return true;
    if (joined.includes('irish local')) return true;
    return false;
  }

  getElectionWidePercentLabel() {
    return `% of ${this.usesMainRoiPartyPalette() ? 'ROI' : 'NI'}`;
  }

  mainPanePartyColour(party, explicit = '') {
    const explicitColour = String(explicit || '').trim();
    if (explicitColour) return explicitColour;
    const normalizedParty = normalizeName(party);
    if (!normalizedParty) return '#6b7280';
    const routePalette = this.usesMainRoiPartyPalette() ? ROI_MAIN_PARTY_COLOURS : PARTY_COLOURS;
    const routeColour = routePalette.get(normalizedParty);
    const sharedColour = electionPartyColour(party, '');
    const localColour = PARTY_COLOURS.get(normalizedParty);
    if (routeColour || sharedColour || localColour) return routeColour || sharedColour || localColour;
    if (this.usesMainRoiPartyPalette()) {
      return ROI_MAIN_PARTY_COLOURS.get(normalizedParty) || electionPartyColour(party) || partyColour(party) || '#b0bec5';
    }
    return electionPartyColour(party) || partyColour(party) || '#6b7280';
  }

  partyColourForResult(result = {}, party = '', explicit = '', options = {}) {
    const normalizedParty = normalizeName(party);
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    const byParty = candidates.filter((candidate) => normalizeName(candidate.party) === normalizedParty);
    const preferredCandidate = options.preferElected
      ? byParty.find((candidate) => candidate.elected && candidate.colour)
      : null;
    const colourCandidate = preferredCandidate
      || byParty.find((candidate) => candidate.name === result.leadingName && candidate.colour)
      || byParty.find((candidate) => candidate.name === result.winnerName && candidate.colour)
      || byParty.find((candidate) => candidate.colour);
    return this.mainPanePartyColour(party, colourCandidate?.colour || explicit);
  }

  renderPanel(selectedResult = null, view = null) {
    const pane = this.ensurePanel();
    const content = document.getElementById('electionPaneContent');
    const title = document.getElementById('electionPaneTitle');
    const back = document.getElementById('electionPaneBack');
    if (!pane || !content || !title || !this.activeEntry || !this.activeBundle) return;
    const nextView = view || this.activePanelView || 'party';
    this.activePanelView = nextView;
    this.activeSelectedResultKey = selectedResult ? normalizeName(selectedResult.matchName || selectedResult.constituency || '') : null;
    this.activeEntityKind = null;
    this.activeEntityKey = null;
    title.textContent = this.mainPaneContract.renderTitle(selectedResult);
    back?.classList.toggle('hidden', !selectedResult);
    const headerRight = pane.querySelector('.election-pane__header-right');
    if (headerRight) {
      headerRight.innerHTML = this.mainPaneContract.renderHeaderRight(selectedResult, nextView);
    }
    content.innerHTML = this.mainPaneContract.renderPanelContent(selectedResult, nextView);
    pane.classList.add('election-results-pane--open');
    document.body.classList.add('test2-election-open');
    back?.addEventListener('click', () => this.renderPanel(null, 'party'));
    pane.querySelector('#electionCloseBtn, #test2ElectionClose')?.addEventListener('click', () => this.unloadElection());
    pane.querySelector('#test2ElectionMode')?.addEventListener('change', (event) => {
      this.activeMode = event.target.value;
      this.applyActiveStyle();
    });
    pane.querySelector('#test2ElectionOverlay')?.addEventListener('change', async (event) => {
      this.overlayMode = event.target.value === 'bars' ? 'bars' : 'circles';
      await this.renderElectionOverlay();
      this.app.updateURLState();
    });
    pane.querySelectorAll('[data-election-local-mode]').forEach((button) => {
      button.addEventListener('click', async () => {
        this.activeLocalMode = button.dataset.electionLocalMode === 'district' ? 'district' : 'dea';
        await this.syncLocalGovernmentBackingLayers();
        this.applyActiveStyle();
        this.renderPanel(null, this.activeLocalMode === 'district' ? 'party' : this.activePanelView);
        this.renderElectionOverlay().catch((error) => console.warn('[test2 elections] Overlay refresh failed', error));
        this.app.updateURLState();
      });
    });
    pane.querySelector('#test2ElectionCountDetail')?.addEventListener('click', () => {
      this.countDetailedView = !this.countDetailedView;
      this.renderPanel(selectedResult, 'counts');
      this.app.updateURLState();
    });
    pane.querySelectorAll('[data-election-view]').forEach((button) => {
      button.addEventListener('click', () => {
        this.renderPanel(selectedResult, button.dataset.electionView || 'party');
        this.app.updateURLState();
      });
    });
    pane.querySelectorAll('[data-election-result-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const result = this.findResultByKey(button.dataset.electionResultKey);
        if (result) {
          this.renderPanel(result, 'party');
          this.app.updateURLState();
        }
      });
    });
    pane.querySelectorAll('[data-election-entity]').forEach((button) => {
      button.addEventListener('click', async () => {
        const handled = await this.app.openElectionEntityDetailInCatalogue?.(
          button.dataset.electionEntity,
          button.dataset.electionEntityKey
        );
        if (handled) {
          this.app.updateURLState();
          return;
        }
        this.renderEntityPanel(button.dataset.electionEntity, button.dataset.electionEntityKey);
        this.app.updateURLState();
      });
    });
    pane.querySelectorAll('[data-election-animation]').forEach((button) => {
      button.addEventListener('click', () => {
        const result = this.findResultByKey(button.dataset.electionAnimation);
        if (result) this.runAnimation(result);
      });
    });
    if (selectedResult && nextView === 'animation' && this.resultHasAnimation(selectedResult)) {
      window.requestAnimationFrame(() => this.runAnimation(selectedResult));
    }
    this.renderLegend();
    this.setupResultsTableControls(pane);
  }

  renderOverallResults(view = 'party') {
    return this.mainPaneContract.renderOverallResults(view);
  }

  renderMainCompatibleOverallResults(view = 'party') {
    return this.mainPaneContract.renderOverallResults(view);
  }

  renderConstituencyResults(result, view = 'party') {
    return this.mainPaneContract.renderConstituencyResults(result, view);
  }

  renderMainCompatibleConstituencyResults(result, view = 'party') {
    return this.mainPaneContract.renderConstituencyResults(result, view);
  }

  renderMainParityPartyTable(rowsWithDeltas = [], results = []) {
    if (!rowsWithDeltas.length) return '<div class="election-no-data">No results data available.</div>';
    const orderedRows = this.orderPartyRowsLikeMain(rowsWithDeltas);
    const mainLikeTotals = this.activeBundle?.mainLikeTotals || null;
    const totalSeats = Number.isFinite(Number(mainLikeTotals?.totalSeats))
      ? Number(mainLikeTotals.totalSeats)
      : rowsWithDeltas.reduce((sum, row) => sum + numberOrZero(row.seats), 0);
    const totalValid = Number.isFinite(Number(mainLikeTotals?.validPoll))
      ? Number(mainLikeTotals.validPoll)
      : (sumNumbers(results, 'validPoll') || rowsWithDeltas.reduce((sum, row) => sum + numberOrZero(row.votes), 0));
    const totalPoll = Number.isFinite(Number(mainLikeTotals?.totalPoll))
      ? Number(mainLikeTotals.totalPoll)
      : (sumNumbers(results, 'totalPoll') || totalValid + sumNumbers(results, 'spoiled'));
    const totalElectorate = Number.isFinite(Number(mainLikeTotals?.totalElectorate))
      ? Number(mainLikeTotals.totalElectorate)
      : sumNumbers(results, 'electorate');
    const totalSpoiled = Number.isFinite(Number(mainLikeTotals?.totalSpoiled))
      ? Number(mainLikeTotals.totalSpoiled)
      : sumNumbers(results, 'spoiled');
    const didNotVote = totalElectorate ? Math.max(0, totalElectorate - totalPoll) : 0;
    const prevRows = this.previousBundle?.mainLikePartySummary?.length
      ? this.previousBundle.mainLikePartySummary
      : this.previousBundle?.partySummary?.length
      ? this.previousBundle.partySummary
      : (this.previousBundle?.results?.length ? buildPartySummary(this.previousBundle.results) : []);
    const prevMainLikeTotals = this.previousBundle?.mainLikeTotals || null;
    const prevRowSeatTotal = prevRows.reduce((sum, row) => sum + numberOrZero(row.seats), 0);
    const prevTotalSeats = Number.isFinite(Number(prevMainLikeTotals?.totalSeats)) && Number(prevMainLikeTotals.totalSeats) > 0
      ? Number(prevMainLikeTotals.totalSeats)
      : prevRowSeatTotal;
    const prevTotalValid = Number.isFinite(Number(prevMainLikeTotals?.validPoll))
      ? Number(prevMainLikeTotals.validPoll)
      : this.previousBundle?.results?.length
      ? (sumNumbers(this.previousBundle.results, 'validPoll') || prevRows.reduce((sum, row) => sum + numberOrZero(row.votes), 0))
      : 0;
    const prevTotalPoll = Number.isFinite(Number(prevMainLikeTotals?.totalPoll))
      ? Number(prevMainLikeTotals.totalPoll)
      : (this.previousBundle?.results?.length ? (sumNumbers(this.previousBundle.results, 'totalPoll') || prevTotalValid + sumNumbers(this.previousBundle.results, 'spoiled')) : 0);
    const prevTotalElectorate = Number.isFinite(Number(prevMainLikeTotals?.totalElectorate))
      ? Number(prevMainLikeTotals.totalElectorate)
      : (this.previousBundle?.results?.length ? sumNumbers(this.previousBundle.results, 'electorate') : 0);
    const prevTotalSpoiled = Number.isFinite(Number(prevMainLikeTotals?.totalSpoiled))
      ? Number(prevMainLikeTotals.totalSpoiled)
      : (this.previousBundle?.results?.length ? sumNumbers(this.previousBundle.results, 'spoiled') : 0);
    const prevDidNotVote = prevTotalElectorate ? Math.max(0, prevTotalElectorate - prevTotalPoll) : 0;
    const pct = (value, denominator) => denominator ? (value / denominator * 100) : 0;
    const turnoutPct = pct(totalPoll, totalElectorate);
    const validPct = pct(totalValid, totalElectorate);
    const spoiledPct = pct(totalSpoiled, totalElectorate);
    const didNotVotePct = pct(didNotVote, totalElectorate);
    const prevTurnoutPct = pct(prevTotalPoll, prevTotalElectorate);
    const prevValidPct = pct(prevTotalValid, prevTotalElectorate);
    const prevSpoiledPct = pct(prevTotalSpoiled, prevTotalElectorate);
    const prevDidNotVotePct = pct(prevDidNotVote, prevTotalElectorate);
    const constituencyCount = Number(this.activeBundle?.matchedCount || results.length || 0);
    return `
      <div class="election-summary election-summary--niwide">
        <div class="election-party-wrapper election-party-wrapper--pane-sticky">
          <table class="election-party-table election-party-table--grouped">
            <thead>
              <tr>
                <th rowspan="2" data-leaf-col-idx="0">#</th>
                <th rowspan="2" data-leaf-col-idx="1">Party</th>
                <th colspan="2">Candidates</th>
                <th colspan="4">Seats</th>
                <th colspan="4">1st preferences</th>
              </tr>
              <tr>
                ${this.renderMainParityLeafTh('No.', 2)}
                ${this.renderMainParityLeafTh('+/-', 3)}
                ${this.renderMainParityLeafTh('No.', 4)}
                ${this.renderMainParityLeafTh('+/-', 5)}
                ${this.renderMainParityLeafTh('%', 6)}
                ${this.renderMainParityLeafTh('+/-', 7)}
                ${this.renderMainParityLeafTh('No.', 8)}
                ${this.renderMainParityLeafTh('+/-', 9)}
                ${this.renderMainParityLeafTh('%', 10)}
                ${this.renderMainParityLeafTh('+/-', 11)}
              </tr>
            </thead>
            <tbody>
              ${orderedRows.map((row, index) => {
                const seatPct = pct(numberOrZero(row.seats), totalSeats);
                const prevSeatPct = row.previous ? pct(numberOrZero(row.previous.seats), prevTotalSeats) : null;
                const votePct = Number.isFinite(Number(row.share)) ? Number(row.share) : pct(numberOrZero(row.votes), totalValid);
                const prevVotePct = row.previous ? pct(numberOrZero(row.previous.votes), prevTotalValid) : null;
                return `
                  <tr>
                    <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                    <td><span class="election-party-dot" style="background:${escapeHtml(this.mainPanePartyColour(row.party, row.colour))}"></span>${this.renderElectionEntityButton('party', row.party, escapeHtml(row.party), 'election-cell-wrap')}</td>
                    <td class="election-num">${formatNumber(row.stood)}</td>
                    <td class="election-num">${formatMainDelta(row.deltas?.stood)}</td>
                    <td class="election-num">${formatNumber(row.seats)}</td>
                    <td class="election-num">${formatMainDelta(row.deltas?.seats)}</td>
                    <td class="election-num">${formatFixedPercent(seatPct)}</td>
                    <td class="election-num">${formatMainPercentDelta(prevSeatPct === null ? null : seatPct - prevSeatPct)}</td>
                    <td class="election-num">${formatNumber(row.votes)}</td>
                    <td class="election-num">${formatMainDelta(row.deltas?.votes)}</td>
                    <td class="election-num">${formatFixedPercent(votePct)}</td>
                    <td class="election-num">${formatMainPercentDelta(prevVotePct === null ? row.deltas?.share : votePct - prevVotePct)}</td>
                  </tr>
                `;
              }).join('')}
              ${this.renderMainParitySummaryRow('Valid votes', constituencyCount, totalSeats, '100.00%', 0, totalValid, totalValid - prevTotalValid, validPct, validPct - prevValidPct)}
              ${this.renderMainParitySummaryRow('Turnout', null, null, null, null, totalPoll, totalPoll - prevTotalPoll, turnoutPct, turnoutPct - prevTurnoutPct)}
              ${this.renderMainParitySummaryRow('Spoiled', null, null, null, null, totalSpoiled, totalSpoiled - prevTotalSpoiled, spoiledPct, spoiledPct - prevSpoiledPct)}
              ${this.renderMainParitySummaryRow('Did not vote', null, null, null, null, didNotVote, didNotVote - prevDidNotVote, didNotVotePct, didNotVotePct - prevDidNotVotePct)}
              ${this.renderMainParitySummaryRow('Electorate', null, null, null, null, totalElectorate, totalElectorate - prevTotalElectorate, 100, 0)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderConstituencyCandidateTable(candidates = [], result = {}) {
    if (!candidates.length) return '<p class="election-no-data">No candidate-level result table is available for this entry.</p>';
    const validPoll = numberOrZero(result.validPoll) || candidates.reduce((sum, candidate) => sum + numberOrZero(candidate.firstPrefs ?? candidate.votes), 0);
    return `
      <div class="election-party-wrapper election-party-wrapper--pane-sticky">
        <table class="election-party-table election-party-table--grouped election-party-table--candidate-sticky3 election-results-table--fixed election-results-table--nonlocal">
          <thead>
            <tr>
              <th rowspan="2" data-leaf-col-idx="0">#</th>
              <th rowspan="2" data-leaf-col-idx="1">Candidate</th>
              <th rowspan="2" data-leaf-col-idx="2">Party</th>
              <th colspan="4">1st preferences</th>
              <th colspan="2">Final count</th>
            </tr>
            <tr>
              ${this.renderMainParityLeafTh('No.', 3)}
              ${this.renderMainParityLeafTh('+/-', 4)}
              ${this.renderMainParityLeafTh('%', 5)}
              ${this.renderMainParityLeafTh('+/-', 6)}
              ${this.renderMainParityLeafTh('No.', 7)}
              ${this.renderMainParityLeafTh('Status', 8)}
            </tr>
          </thead>
          <tbody>
            ${candidates.map((candidate, index) => {
              const firstPrefs = numberOrZero(candidate.firstPrefs ?? candidate.votes);
              const firstPrefPct = Number.isFinite(Number(candidate.firstPrefPct)) ? Number(candidate.firstPrefPct) : (validPoll ? firstPrefs / validPoll * 100 : null);
              const finalVotes = candidate.finalVotes ?? candidate.total ?? candidate.firstPrefs ?? candidate.votes;
              return `
                <tr class="${candidate.elected ? 'election-row--elected test2-election-table__elected' : ''}">
                  <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                  <td>${this.renderElectionEntityButton('candidate', candidate.id || `${candidate.name}|${candidate.party}`, candidate.name || candidate.candidate || '', 'election-cell-wrap')}</td>
                  <td>${this.renderElectionEntityButton('party', candidate.party, `<span class="election-party-dot" style="background:${escapeHtml(this.mainPanePartyColour(candidate.party, candidate.colour))}"></span>${escapeHtml(candidate.party || '')}`, 'election-cell-wrap')}</td>
                  <td class="election-num">${formatNumber(firstPrefs)}</td>
                  <td class="election-num">${candidate.deltas ? formatMainDelta(candidate.deltas.firstPrefs) : ''}</td>
                  <td class="election-num">${firstPrefPct === null ? '' : formatFixedPercent(firstPrefPct)}</td>
                  <td class="election-num">${candidate.deltas?.firstPrefPct !== null && candidate.deltas?.firstPrefPct !== undefined ? formatMainPercentDelta(candidate.deltas.firstPrefPct) : ''}</td>
                  <td class="election-num">${formatNumber(finalVotes)}</td>
                  <td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderConstituencyPartyTable(candidates = [], result = {}) {
    if (!candidates.length) return '<p class="election-no-data">No party-level result table is available for this entry.</p>';
    const current = this.buildMainStyleConstituencyPartyRows(result, candidates);
    const previousResult = this.findPreviousSelectedResult(result);
    const previous = this.buildMainStyleConstituencyPartyRows(previousResult, previousResult?.candidates || []);
    const previousByParty = new Map(previous.rows.map((row) => [normalizeName(row.party), row]));
    const rows = current.rows.map((row) => {
      const previousRow = previousByParty.get(normalizeName(row.party)) || { stood: 0, seats: 0, firstPrefs: 0, pct: 0 };
      return {
        ...row,
        stoodDelta: row.stood - numberOrZero(previousRow.stood),
        electedDelta: row.seats - numberOrZero(previousRow.seats),
        firstPrefsDelta: row.firstPrefs - numberOrZero(previousRow.firstPrefs),
        pctDelta: row.pct - numberOrZero(previousRow.pct)
      };
    }).sort((a, b) => {
      if (numberOrZero(b.seats) !== numberOrZero(a.seats)) return numberOrZero(b.seats) - numberOrZero(a.seats);
      if (numberOrZero(b.firstPrefs) !== numberOrZero(a.firstPrefs)) return numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs);
      return String(a.party || '').localeCompare(String(b.party || ''));
    });
    const maxSeats = Math.max(0, ...rows.map((row) => numberOrZero(row.seats)));
    const maxFirstPrefs = Math.max(0, ...rows.map((row) => numberOrZero(row.firstPrefs)));
    const knownDelta = (currentValue, previousValue) => currentValue !== null && previousValue !== null ? currentValue - previousValue : null;
    const validDelta = knownDelta(current.validPoll, previous.validPoll);
    const turnoutDelta = knownDelta(current.totalPoll, previous.totalPoll);
    const spoiledDelta = knownDelta(current.spoiled, previous.spoiled);
    const didNotVoteDelta = knownDelta(current.didNotVote, previous.didNotVote);
    const electorateDelta = knownDelta(current.electorate, previous.electorate);
    const shouldRenderSummary = (currentValue, previousValue) => currentValue !== null || previousValue !== null;
    return `
      <div class="election-party-wrapper election-party-wrapper--pane-sticky">
        <table class="election-party-table election-results-table--constituency-party">
          <thead>
            <tr>
              <th data-sort-key="rank">#</th>
              <th class="election-colour-col"></th>
              <th data-sort-key="party">Party</th>
              <th class="election-num" data-sort-key="stood">Stood</th>
              <th class="election-num" data-sort-key="stoodDelta">+/-</th>
              <th class="election-num" data-sort-key="elected">Elected</th>
              <th class="election-num" data-sort-key="electedDelta">+/-</th>
              <th class="election-num" data-sort-key="firstPrefs">1st prefs</th>
              <th class="election-num" data-sort-key="firstPrefsDelta">+/-</th>
              <th class="election-num" data-sort-key="firstPrefsPct">1st prefs %</th>
              <th class="election-num" data-sort-key="firstPrefsPctDelta">+/-</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => {
              const isSeatWinner = row.seats === maxSeats && maxSeats > 0;
              const isFirstPrefWinner = row.firstPrefs === maxFirstPrefs && maxFirstPrefs > 0;
              return `
                <tr class="election-party-row"
                  data-rank="${index + 1}"
                  data-party="${escapeHtml(row.party)}"
                  data-stood="${row.stood}"
                  data-stooddelta="${row.stoodDelta}"
                  data-elected="${row.seats}"
                  data-electeddelta="${row.electedDelta}"
                  data-firstprefs="${row.firstPrefs}"
                  data-firstprefsdelta="${row.firstPrefsDelta}"
                  data-firstprefspct="${row.pct}"
                  data-firstprefspctdelta="${row.pctDelta}">
                  <td class="election-rank-col${isSeatWinner ? ' election-party-emphasis' : ''}">${escapeHtml(rankLabel(index))}</td>
                  <td class="election-colour-col"><span class="election-party-dot" style="background:${escapeHtml(this.mainPanePartyColour(row.party, row.colour))}"></span></td>
                  <td class="${isSeatWinner ? ' election-party-emphasis' : ''}">${this.renderElectionEntityButton('party', row.party, escapeHtml(row.party), 'election-cell-wrap')}</td>
                  <td class="election-num">${formatNumber(row.stood)}</td>
                  <td class="election-num">${formatMainDelta(row.stoodDelta)}</td>
                  <td class="election-num${isSeatWinner ? ' election-party-emphasis' : ''}">${formatNumber(row.seats)}</td>
                  <td class="election-num">${formatMainDelta(row.electedDelta)}</td>
                  <td class="election-num${isFirstPrefWinner ? ' election-party-emphasis' : ''}">${formatNumber(row.firstPrefs)}</td>
                  <td class="election-num">${formatMainDelta(row.firstPrefsDelta)}</td>
                  <td class="election-num${isFirstPrefWinner ? ' election-party-emphasis' : ''}">${formatFixedPercent(row.pct)}</td>
                  <td class="election-num">${formatMainSelectedPercentDelta(row.pctDelta)}</td>
                </tr>
              `;
            }).join('')}
            <tr class="election-table-note-row"><td class="election-rank-col">-</td><td></td><td colspan="9"><strong>No change in party control</strong></td></tr>
            ${this.renderSelectedPartySummaryRow('Valid votes', current.totalStood, current.totalElected, current.validPoll, validDelta, current.validPct, knownDelta(current.validPct, previous.validPct))}
            ${shouldRenderSummary(current.totalPoll, previous.totalPoll) ? this.renderSelectedPartySummaryRow('Turnout', null, null, current.totalPoll, turnoutDelta, current.turnoutPct, knownDelta(current.turnoutPct, previous.turnoutPct)) : ''}
            ${shouldRenderSummary(current.spoiled, previous.spoiled) ? this.renderSelectedPartySummaryRow('Spoiled', null, null, current.spoiled, spoiledDelta, current.spoiledPct, knownDelta(current.spoiledPct, previous.spoiledPct)) : ''}
            ${shouldRenderSummary(current.didNotVote, previous.didNotVote) ? this.renderSelectedPartySummaryRow('Did not vote', null, null, current.didNotVote, didNotVoteDelta, current.didNotVotePct, knownDelta(current.didNotVotePct, previous.didNotVotePct)) : ''}
            ${shouldRenderSummary(current.electorate, previous.electorate) ? this.renderSelectedPartySummaryRow('Electorate', null, null, current.electorate, electorateDelta, 100, 0) : ''}
          </tbody>
        </table>
      </div>
    `;
  }

  buildMainStyleConstituencyPartyRows(result = {}, fallbackCandidates = []) {
    const countGroup = Array.isArray(result?.countGroup) ? result.countGroup : [];
    const countInfo = result?.countInfo || {};
    const validPoll = numberOrZero(countInfo.Valid_Poll) || numberOrZero(result?.validPoll);
    const totalPoll = (numberOrZero(countInfo.Total_Poll) || numberOrZero(result?.totalPoll)) || null;
    const electorate = (numberOrZero(countInfo.Total_Electorate) || numberOrZero(result?.electorate)) || null;
    const spoiled = (numberOrZero(countInfo.Spoiled) || numberOrZero(result?.spoiled)) || null;
    const didNotVote = electorate !== null && totalPoll !== null ? Math.max(0, electorate - totalPoll) : null;
    const partyMap = new Map();
    const seenCandidates = new Set();
    const electedCandidates = new Set();
    const candidateFinalById = new Map();
    const candidateMetaById = new Map();
    const rows = countGroup.length ? countGroup : fallbackCandidates.map((candidate, index) => ({
      Candidate_Id: candidate.id || candidate.candidateId || String(index + 1),
      Count_Number: '1',
      Party_Name: candidate.party || 'Independent/Other',
      Party_Colour: this.mainPanePartyColour(candidate.party, candidate.colour),
      Status: candidate.elected ? 'Elected' : candidate.status || '',
      Total_Votes: candidate.firstPrefs ?? candidate.votes ?? 0
    }));
    for (const row of rows) {
      if (!isMainStyleCandidateRow(row)) continue;
      const party = normalizeParty(row.Party_Name) || 'Independent/Other';
      const candidateId = String(row.Candidate_Id || '');
      const totalVotes = numberOrZero(row.Total_Votes);
      const countNumber = parseInt(row.Count_Number, 10) || 1;
      if (!partyMap.has(party)) {
        partyMap.set(party, {
          party,
          colour: this.mainPanePartyColour(party, row.Party_Colour),
          stood: 0,
          seats: 0,
          firstPrefs: 0,
          pct: 0
        });
      }
      if (!candidateMetaById.has(candidateId)) candidateMetaById.set(candidateId, { party, excluded: false });
      if (countNumber === 1 && !seenCandidates.has(candidateId)) {
        seenCandidates.add(candidateId);
        const totals = partyMap.get(party);
        totals.firstPrefs += totalVotes;
        totals.stood += 1;
      }
      if (!candidateFinalById.has(candidateId) || totalVotes > numberOrZero(candidateFinalById.get(candidateId)?.votes)) {
        candidateFinalById.set(candidateId, { party, votes: totalVotes });
      }
      const status = selectedPaneStatusKind(row.Status);
      if (status === 'excluded') candidateMetaById.get(candidateId).excluded = true;
      if (status === 'elected' && !electedCandidates.has(candidateId)) {
        electedCandidates.add(candidateId);
        partyMap.get(party).seats += 1;
      }
    }
    const seatCount = numberOrZero(countInfo.Number_Of_Seats ?? result?.seatsTotal ?? result?.seatsWon);
    if (seatCount > 0 && electedCandidates.size < seatCount) {
      [...candidateFinalById.entries()]
        .filter(([candidateId]) => !electedCandidates.has(candidateId) && !candidateMetaById.get(candidateId)?.excluded)
        .sort((a, b) => numberOrZero(b[1]?.votes) - numberOrZero(a[1]?.votes))
        .slice(0, seatCount - electedCandidates.size)
        .forEach(([candidateId, data]) => {
          electedCandidates.add(candidateId);
          if (partyMap.has(data.party)) partyMap.get(data.party).seats += 1;
        });
    }
    const outputRows = [...partyMap.values()].map((row) => ({
      ...row,
      pct: validPoll > 0 ? (row.firstPrefs / validPoll * 100) : 0
    }));
    const totalStood = outputRows.reduce((sum, row) => sum + numberOrZero(row.stood), 0);
    const totalElected = outputRows.reduce((sum, row) => sum + numberOrZero(row.seats), 0);
    return {
      rows: outputRows,
      validPoll,
      totalPoll,
      electorate,
      spoiled,
      didNotVote,
      turnoutPct: electorate !== null && totalPoll !== null && electorate > 0 ? (totalPoll / electorate * 100) : null,
      validPct: electorate > 0 ? (validPoll / electorate * 100) : 0,
      spoiledPct: electorate !== null && spoiled !== null && electorate > 0 ? (spoiled / electorate * 100) : null,
      didNotVotePct: electorate !== null && didNotVote !== null && electorate > 0 ? (didNotVote / electorate * 100) : null,
      totalStood,
      totalElected
    };
  }

  findPreviousSelectedResult(result = {}) {
    const keys = new Set(resultKeys(result));
    if (!keys.size) return null;
    return (this.previousBundle?.results || []).find((candidate) => resultKeys(candidate).some((key) => keys.has(key))) || null;
  }

  renderSelectedPartySummaryRow(label, stoodValue, electedValue, voteValue, voteDelta, pctValue, pctDelta) {
    const hasVoteDelta = voteDelta !== null && voteDelta !== undefined;
    const hasPctDelta = pctDelta !== null && pctDelta !== undefined && Number.isFinite(Number(pctDelta));
    return `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td></td><td><strong>${escapeHtml(label)}</strong></td><td class="election-num">${stoodValue === null || stoodValue === undefined ? '-' : formatNumber(stoodValue)}</td><td class="election-num">${stoodValue === null || stoodValue === undefined ? '-' : formatMainDelta(0)}</td><td class="election-num">${electedValue === null || electedValue === undefined ? '-' : formatNumber(electedValue)}</td><td class="election-num">${electedValue === null || electedValue === undefined ? '-' : formatMainDelta(0)}</td><td class="election-num election-cell-strong">${voteValue ? formatNumber(voteValue) : '-'}</td><td class="election-num">${hasVoteDelta ? formatMainDelta(voteDelta) : '-'}</td><td class="election-num election-cell-strong">${Number.isFinite(Number(pctValue)) ? formatFixedPercent(pctValue) : '-'}</td><td class="election-num">${hasPctDelta ? formatMainSelectedPercentDelta(pctDelta) : '-'}</td></tr>`;
  }

  renderMainParityLeafTh(label, index) {
    return `<th class="election-num" data-leaf-col-idx="${index}">${escapeHtml(label)}</th>`;
  }

  renderTwoLineHeader(top, bottom) {
    return `<span class="election-th-two-line"><span>${escapeHtml(top)}</span><span>${escapeHtml(bottom)}</span></span>`;
  }

  renderElectionEntityButton(kind, key, labelHtml, extraClass = '') {
    const safeKind = escapeHtml(kind);
    return `<button type="button" class="election-entity-link ${extraClass}" data-election-entity="${safeKind}" data-election-entity-kind="${safeKind}" data-election-entity-key="${escapeHtml(key || '')}">${labelHtml}</button>`;
  }

  orderPartyRowsLikeMain(rows = []) {
    return [...rows].sort((a, b) => {
      const seatDelta = numberOrZero(b.seats) - numberOrZero(a.seats);
      if (seatDelta) return seatDelta;
      const voteDelta = numberOrZero(b.votes) - numberOrZero(a.votes);
      if (voteDelta) return voteDelta;
      return String(a.party || '').localeCompare(String(b.party || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  setupResultsTableControls(container) {
    const tables = [...(container?.querySelectorAll?.('.election-party-table, .election-count-table') || [])];
    tables.forEach((table) => this.setupSingleResultsTableControls(table));
  }

  setupSingleResultsTableControls(table) {
    if (!table || table.dataset.tableControlsReady === '1') return;
    const tbody = table.querySelector('tbody');
    const leafHeaders = [...table.querySelectorAll('thead th[data-leaf-col-idx]')];
    const headers = leafHeaders.length ? leafHeaders : [...table.querySelectorAll('thead th')];
    if (!tbody || headers.length === 0) return;
    table.dataset.tableControlsReady = '1';

    const sortState = { col: null, dir: 'default' };
    const filterState = new Map();
    const originalRows = [...tbody.querySelectorAll('tr')].map((row, idx) => ({ row, idx }));
    const sortableRows = originalRows.filter(({ row }) => (
      !row.classList.contains('election-table-summary-row') && !row.classList.contains('election-table-note-row')
    ));
    const fixedRows = originalRows.filter(({ row }) => !sortableRows.some((item) => item.row === row));
    let activeMenu = null;
    let activeMenuBtn = null;
    let activeMenuPositioner = null;

    const parseMaybeNumber = (text) => {
      const cleaned = String(text || '')
        .replace(/,/g, '')
        .replace(/%/g, '')
        .replace(/[+\u2212]/g, (match) => (match === '\u2212' ? '-' : '+'))
        .trim();
      if (!cleaned || cleaned === '-' || cleaned === '�' || cleaned.toLowerCase() === 'n/a') return null;
      const value = Number(cleaned);
      return Number.isFinite(value) ? value : null;
    };
    const parseMaybeOrdinal = (text) => {
      const cleaned = String(text || '').trim().toLowerCase();
      if (!cleaned) return null;
      const rank = cleaned.match(/^(\d+)(st|nd|rd|th)?$/);
      if (rank) return Number(rank[1]);
      const count = cleaned.match(/count\s+(\d+)/);
      if (count) return Number(count[1]);
      return null;
    };
    const getCellText = (row, colIdx) => {
      const cell = row.children[colIdx];
      return cell ? cell.textContent.trim() : '';
    };
    const headerColumnIndex = (th, fallbackIdx) => {
      const mapped = Number(th?.dataset?.leafColIdx);
      return Number.isFinite(mapped) ? mapped : fallbackIdx;
    };
    const inferColumnKind = (colIdx, th) => {
      const sample = sortableRows.slice(0, 40).map(({ row }) => getCellText(row, colIdx)).filter(Boolean);
      const numHits = sample.filter((value) => parseMaybeNumber(value) !== null).length;
      const ordHits = sample.filter((value) => parseMaybeOrdinal(value) !== null).length;
      const headerText = (th?.textContent || '').trim().toLowerCase();
      if (headerText.includes('rank')) return 'ordinal';
      if (sample.length > 0 && numHits / sample.length >= 0.8) return 'numeric';
      if (sample.length > 0 && ordHits / sample.length >= 0.8) return 'ordinal';
      return 'text';
    };

    const compareRows = (a, b, colIdx, direction, kind) => {
      if (direction === 'default') return a.idx - b.idx;
      const av = getCellText(a.row, colIdx);
      const bv = getCellText(b.row, colIdx);
      let comparison = 0;
      if (kind === 'numeric') {
        const an = parseMaybeNumber(av);
        const bn = parseMaybeNumber(bv);
        if (an !== null && bn !== null) comparison = an - bn;
        else if (an !== null) comparison = 1;
        else if (bn !== null) comparison = -1;
        else comparison = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      } else if (kind === 'ordinal') {
        const ao = parseMaybeOrdinal(av);
        const bo = parseMaybeOrdinal(bv);
        if (ao !== null && bo !== null) comparison = ao - bo;
        else comparison = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        comparison = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      }
      return direction === 'asc' ? comparison : -comparison;
    };

    const closeMenu = () => {
      if (activeMenu) activeMenu.remove();
      if (activeMenuBtn) activeMenuBtn.classList.remove('election-th-btn--open');
      if (activeMenuPositioner) {
        window.removeEventListener('resize', activeMenuPositioner);
        window.removeEventListener('scroll', activeMenuPositioner, true);
      }
      activeMenu = null;
      activeMenuBtn = null;
      activeMenuPositioner = null;
    };

    const clampToViewport = (value, min, max) => {
      if (max < min) return min;
      return Math.min(Math.max(value, min), max);
    };

    const positionElectionFilterMenu = (menu, anchorBtn) => {
      if (!menu || !anchorBtn) return;
      const margin = 8;
      const gap = 4;
      const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      const viewportMaxWidth = Math.max(160, viewportWidth - (margin * 2));
      const viewportMaxHeight = Math.max(120, viewportHeight - (margin * 2));
      const targetWidth = Math.min(248, viewportMaxWidth);
      const anchorRect = anchorBtn.getBoundingClientRect();

      menu.style.width = `${targetWidth}px`;
      menu.style.maxWidth = `${viewportMaxWidth}px`;
      menu.style.maxHeight = `${viewportMaxHeight}px`;
      menu.style.overflow = 'hidden';

      const valuesHost = menu.querySelector('[data-role="values"]');
      if (valuesHost) valuesHost.style.maxHeight = '';

      const measuredRect = menu.getBoundingClientRect();
      const belowSpace = Math.max(0, viewportHeight - anchorRect.bottom - margin - gap);
      const aboveSpace = Math.max(0, anchorRect.top - margin - gap);
      const measuredHeight = Math.min(measuredRect.height || viewportMaxHeight, viewportMaxHeight);
      const openAbove = measuredHeight > belowSpace && aboveSpace > belowSpace;
      const availableHeight = Math.max(120, Math.min(viewportMaxHeight, openAbove ? aboveSpace : belowSpace));
      menu.style.maxHeight = `${availableHeight}px`;

      if (valuesHost) {
        const children = [...menu.children];
        const nonValuesHeight = children
          .filter((child) => child !== valuesHost)
          .reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
        const gapHeight = Math.max(0, children.length - 1) * 6;
        valuesHost.style.maxHeight = `${Math.max(48, availableHeight - nonValuesHeight - gapHeight - 2)}px`;
      }

      const finalRect = menu.getBoundingClientRect();
      const left = clampToViewport(
        anchorRect.right - finalRect.width,
        margin,
        viewportWidth - finalRect.width - margin
      );
      const preferredTop = openAbove
        ? anchorRect.top - finalRect.height - gap
        : anchorRect.bottom + gap;
      const top = clampToViewport(
        preferredTop,
        margin,
        viewportHeight - finalRect.height - margin
      );
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };

    const getUniqueValues = (colIdx) => {
      const values = new Map();
      sortableRows.forEach(({ row }) => {
        const raw = getCellText(row, colIdx);
        if (!values.has(raw)) values.set(raw, raw);
      });
      return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    };

    const applyState = () => {
      let visibleRows = sortableRows.filter(({ row }) => {
        for (const [colIdx, selected] of filterState.entries()) {
          if (!(selected instanceof Set) || selected.size === 0) continue;
          const value = getCellText(row, colIdx);
          if (!selected.has(value)) return false;
        }
        return true;
      });
      const colIdx = sortState.col ?? headerColumnIndex(headers[0], 0);
      const sortHeader = headers.find((th, idx) => headerColumnIndex(th, idx) === colIdx) || headers[0];
      const kind = inferColumnKind(colIdx, sortHeader);
      visibleRows = [...visibleRows].sort((a, b) => compareRows(a, b, colIdx, sortState.dir, kind));
      tbody.innerHTML = '';
      visibleRows.forEach(({ row }) => tbody.appendChild(row));
      fixedRows.forEach(({ row }) => tbody.appendChild(row));

      headers.forEach((header, idx) => {
        const button = header.querySelector('[data-table-filter-sort-btn]');
        if (!button) return;
        const column = headerColumnIndex(header, idx);
        const filtered = filterState.has(column) && (filterState.get(column)?.size ?? 0) > 0;
        const sorted = sortState.col === column && sortState.dir !== 'default';
        button.classList.toggle('election-th-btn--active', filtered || sorted);
        if (sorted && sortState.dir === 'asc') button.innerHTML = '&#8593;';
        else if (sorted && sortState.dir === 'desc') button.innerHTML = '&#8595;';
        else button.innerHTML = '&#8645;';
      });
    };

    const openMenuForColumn = (idx, anchorBtn) => {
      closeMenu();
      const th = headers[idx];
      const colIdx = headerColumnIndex(th, idx);
      const kind = inferColumnKind(colIdx, th);
      const options = getUniqueValues(colIdx);
      const current = filterState.get(colIdx);
      const selected = new Set(current instanceof Set ? current : options);
      const sortAscLabel = kind === 'numeric'
        ? 'Sort Smallest to Largest'
        : (kind === 'ordinal' ? 'Sort Lowest to Highest' : 'Sort A to Z');
      const sortDescLabel = kind === 'numeric'
        ? 'Sort Largest to Smallest'
        : (kind === 'ordinal' ? 'Sort Highest to Lowest' : 'Sort Z to A');

      const menu = document.createElement('div');
      menu.className = 'election-filter-menu';
      menu.innerHTML = `
        <button type="button" class="election-filter-menu__action" data-action="sort-asc">${sortAscLabel}</button>
        <button type="button" class="election-filter-menu__action" data-action="sort-desc">${sortDescLabel}</button>
        <button type="button" class="election-filter-menu__action" data-action="reset-sort">Reset Sort</button>
        <div class="election-filter-menu__divider"></div>
        <input type="search" class="election-filter-menu__search" placeholder="Search values..." aria-label="Search values">
        <div class="election-filter-menu__row">
          <button type="button" class="election-filter-menu__mini" data-action="select-all">Select All</button>
          <button type="button" class="election-filter-menu__mini" data-action="deselect-all">Deselect All</button>
        </div>
        <div class="election-filter-menu__values" data-role="values"></div>
        <div class="election-filter-menu__row election-filter-menu__row--footer">
          <button type="button" class="election-filter-menu__mini" data-action="clear-filter">Clear Filter</button>
          <button type="button" class="election-filter-menu__mini election-filter-menu__mini--primary" data-action="apply">Apply</button>
        </div>
      `;
      document.body.appendChild(menu);
      activeMenu = menu;
      activeMenuBtn = anchorBtn;
      anchorBtn.classList.add('election-th-btn--open');

      const valuesHost = menu.querySelector('[data-role="values"]');
      const renderValues = (needle = '') => {
        const query = needle.trim().toLowerCase();
        valuesHost.innerHTML = '';
        options
          .filter((raw) => !query || String(raw).toLowerCase().includes(query))
          .forEach((raw) => {
            const item = document.createElement('label');
            item.className = 'election-filter-menu__value';
            item.innerHTML = `<input type="checkbox" value="${escapeHtml(raw)}" ${selected.has(raw) ? 'checked' : ''}><span>${escapeHtml(raw || '(Blank)')}</span>`;
            const checkbox = item.querySelector('input');
            checkbox.addEventListener('change', () => {
              if (checkbox.checked) selected.add(raw);
              else selected.delete(raw);
            });
            valuesHost.appendChild(item);
          });
      };
      renderValues();
      positionElectionFilterMenu(menu, anchorBtn);
      activeMenuPositioner = () => positionElectionFilterMenu(menu, anchorBtn);
      window.addEventListener('resize', activeMenuPositioner);
      window.addEventListener('scroll', activeMenuPositioner, true);

      const search = menu.querySelector('.election-filter-menu__search');
      search?.addEventListener('input', () => {
        renderValues(search.value || '');
        positionElectionFilterMenu(menu, anchorBtn);
      });

      menu.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'sort-asc') {
          sortState.col = colIdx;
          sortState.dir = 'asc';
          applyState();
          closeMenu();
        } else if (action === 'sort-desc') {
          sortState.col = colIdx;
          sortState.dir = 'desc';
          applyState();
          closeMenu();
        } else if (action === 'reset-sort') {
          sortState.col = null;
          sortState.dir = 'default';
          applyState();
          closeMenu();
        } else if (action === 'select-all') {
          options.forEach((value) => selected.add(value));
          renderValues(search?.value || '');
          positionElectionFilterMenu(menu, anchorBtn);
        } else if (action === 'deselect-all') {
          selected.clear();
          renderValues(search?.value || '');
          positionElectionFilterMenu(menu, anchorBtn);
        } else if (action === 'clear-filter') {
          filterState.delete(colIdx);
          applyState();
          closeMenu();
        } else if (action === 'apply') {
          if (selected.size === 0 || selected.size === options.length) filterState.delete(colIdx);
          else filterState.set(colIdx, new Set(selected));
          applyState();
          closeMenu();
        }
      });
    };

    const handleDocumentClick = (event) => {
      if (!activeMenu) return;
      if (activeMenu.contains(event.target)) return;
      if (activeMenuBtn && activeMenuBtn.contains(event.target)) return;
      closeMenu();
    };
    const handleDocumentKeydown = (event) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeydown);

    headers.forEach((header, idx) => {
      const label = header.innerHTML;
      header.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'election-th-controls';
      if (header.classList.contains('election-col-compact')
        || header.classList.contains('election-col-int')
        || header.classList.contains('election-col-delta')
        || header.classList.contains('election-col-delta-small')
        || header.classList.contains('election-col-delta-votes')
        || header.classList.contains('election-col-pct')
        || header.classList.contains('election-col-pct-main')
        || header.classList.contains('election-col-pct-small')
        || header.classList.contains('election-col-pct-delta-main')
        || header.classList.contains('election-col-pct-delta-small')
        || header.classList.contains('election-col-count')
        || header.classList.contains('election-col-status-count')
        || header.classList.contains('election-col-votes')) {
        wrap.classList.add('election-th-controls--compact');
      }

      const labelSpan = document.createElement('span');
      labelSpan.className = 'election-th-label';
      labelSpan.innerHTML = label;
      wrap.appendChild(labelSpan);

      if (!header.classList.contains('election-colour-col')) {
        const actions = document.createElement('span');
        actions.className = 'election-th-actions';
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'election-th-btn';
        menuBtn.setAttribute('data-table-filter-sort-btn', '1');
        menuBtn.setAttribute('aria-label', 'Sort and Filter');
        menuBtn.setAttribute('title', 'Sort and Filter');
        menuBtn.innerHTML = '&#8645;';
        menuBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (activeMenu && activeMenuBtn === menuBtn) closeMenu();
          else openMenuForColumn(idx, menuBtn);
        });
        actions.appendChild(menuBtn);
        wrap.appendChild(actions);
      }

      header.appendChild(wrap);
    });

    table.addEventListener('test2:dispose-table-controls', () => {
      closeMenu();
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeydown);
    }, { once: true });

    applyState();
  }

  renderMainParitySummaryRow(label, candidateValue, seatValue, seatPct, seatPctDelta, voteValue, voteDelta, pctValue, pctDelta) {
    return `<tr class="election-table-summary-row"><td class="election-rank-col">-</td><td><strong>${escapeHtml(label)}</strong></td><td class="election-num">${candidateValue === null || candidateValue === undefined ? '-' : formatNumber(candidateValue)}</td><td class="election-num">-</td><td class="election-num">${seatValue === null || seatValue === undefined ? '-' : formatNumber(seatValue)}</td><td class="election-num">-</td><td class="election-num election-cell-strong">${seatPct || '-'}</td><td class="election-num">${seatPctDelta === null || seatPctDelta === undefined ? '-' : formatMainPercentDelta(seatPctDelta)}</td><td class="election-num election-cell-strong">${voteValue ? formatNumber(voteValue) : '-'}</td><td class="election-num">${voteDelta === null || voteDelta === undefined ? '-' : formatMainDelta(voteDelta)}</td><td class="election-num election-cell-strong">${Number.isFinite(Number(pctValue)) ? formatFixedPercent(pctValue) : '-'}</td><td class="election-num">${pctDelta === null || pctDelta === undefined ? '-' : formatMainPercentDelta(pctDelta)}</td></tr>`;
  }

  renderMapDisplayControls() {
    const modes = this.activeEntry?.stylingModes || [];
    const overlayControl = this.shouldRenderElectionOverlays() ? `
      <label class="test2-election-panel__mode">
        <span>Overlay</span>
        <select id="test2ElectionOverlay">
          <option value="circles" ${this.overlayMode === 'circles' ? 'selected' : ''}>Seat circles</option>
          <option value="bars" ${this.overlayMode === 'bars' ? 'selected' : ''}>Vote bars</option>
        </select>
      </label>
    ` : '';
    if (!modes.length && !overlayControl) return '';
    return `
      <details class="test2-election-map-display">
        <summary>Map display</summary>
        <div class="test2-election-map-display__controls">
          ${modes.length ? `<label class="test2-election-panel__mode"><span>Style</span><select id="test2ElectionMode">${modes.map((mode) => `<option value="${escapeHtml(mode)}" ${mode === this.activeMode ? 'selected' : ''}>${escapeHtml(MODE_LABELS[mode] || mode)}</option>`).join('')}</select></label>` : ''}
          ${overlayControl}
        </div>
      </details>
    `;
  }

  formatPaneElectionTitle() {
    const body = shortElectionBody(this.activeBundle?.body || this.activeEntry?.body || '');
    const date = formatElectionDate(this.activeBundle?.date || this.activeEntry?.date || '');
    return [body, date].filter(Boolean).join(' - ') || (this.activeBundle?.displayTitle || this.activeBundle?.body || '');
  }

  isLocalGovernmentElection() {
    return (this.activeBundle?.bodyGroup || this.activeEntry?.bodyGroup) === 'local-government';
  }

  localBodyCount() {
    return Number(this.activeBundle?.localBodies?.length || this.activeEntry?.localBodies?.length || 0);
  }

  isForumResult(result = null) {
    return Boolean(result?.forum || result?.forumSequence || result?.allocationRounds);
  }

  resultHasAnimation(result = null) {
    if (!result) return false;
    if (this.isForumResult(result)) return true;
    const animationRows = result.animationPayload?.Constituency?.countGroup || [];
    if (result.syntheticCountGroup && Array.isArray(animationRows) && animationRows.length) return true;
    if (Array.isArray(animationRows) && animationRows.some((row) => Number(row.Count_Number) > 1)) return true;
    if (Array.isArray(result.countNumbers) && result.countNumbers.some((count) => Number(count) > 1)) return true;
    return Boolean(result.hasCountDetail && (result.candidates || []).some((candidate) => (candidate.counts || []).some((count) => Number(count.count) > 1)));
  }

  currentResults() {
    const current = this.activeBundle?.results || [];
    const previous = this.previousBundle?.results || [];
    return previous.length ? compareResults(current, previous) : current;
  }

  formatNumberForPane(value) {
    return formatNumber(value);
  }

  formatPercentForPane(value) {
    return formatPercent(value);
  }

  formatSignedPercentForPane(value) {
    return formatSignedPercent(value);
  }

  withPartyDeltas(rows = [], options = {}) {
    const previousRows = options.mainLike && this.previousBundle?.mainLikePartySummary?.length
      ? this.previousBundle.mainLikePartySummary
      : (this.previousBundle?.results?.length ? buildPartySummary(this.previousBundle.results) : []);
    const previousByParty = new Map(previousRows.map((row) => [normalizeName(row.party), row]));
    const hasPreviousElection = previousRows.length > 0;
    return rows.map((row) => {
      const previous = previousByParty.get(normalizeName(row.party)) || (hasPreviousElection
        ? { stood: 0, seats: 0, votes: 0, share: 0 }
        : null);
      return {
        ...row,
        previous,
        deltas: previous ? {
          stood: numberOrZero(row.stood) - numberOrZero(previous.stood),
          seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
          votes: numberOrZero(row.votes) - numberOrZero(previous.votes),
          share: row.share !== null && previous.share !== null ? row.share - previous.share : null
        } : null
      };
    });
  }

  withCandidateDeltas(rows = [], options = {}) {
    const previousRows = options.mainLike && this.previousBundle?.mainLikeCandidateSummary?.length
      ? this.previousBundle.mainLikeCandidateSummary
      : (this.previousBundle?.results?.length ? buildCandidateSummary(this.previousBundle.results) : []);
    const candidateKey = (row) => row.candidateKey || `${String(row.name || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${String(row.party || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const previousByCandidate = new Map(previousRows.map((row) => [candidateKey(row), row]));
    return rows.map((row) => {
      const previous = previousByCandidate.get(candidateKey(row));
      const currentPct = row.firstPrefPct ?? row.constPct;
      const previousPct = previous?.firstPrefPct ?? previous?.constPct;
      return {
        ...row,
        previous,
        deltas: previous ? {
          firstPrefs: numberOrZero(row.firstPrefs ?? row.votes) - numberOrZero(previous.firstPrefs ?? previous.votes),
          firstPrefPct: currentPct !== null && currentPct !== undefined && previousPct !== null && previousPct !== undefined
            ? numberOrZero(currentPct) - numberOrZero(previousPct)
            : null
        } : null
      };
    });
  }

  withCouncilDeltas(rows = []) {
    const previousRows = this.previousBundle?.results?.length ? buildCouncilSummary(this.previousBundle.results) : [];
    const previousByCouncil = new Map(previousRows.map((row) => [normalizeName(row.council), row]));
    return rows.map((row) => {
      const previous = previousByCouncil.get(normalizeName(row.council));
      return {
        ...row,
        previous,
        deltas: previous ? {
          seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
          validPoll: numberOrZero(row.validPoll) - numberOrZero(previous.validPoll),
          turnoutPct: row.turnoutPct !== null && previous.turnoutPct !== null ? row.turnoutPct - previous.turnoutPct : null
        } : null
      };
    });
  }

  withLocalPartyDeltas(rows = []) {
    const previousRows = this.previousBundle?.results?.length ? buildLocalPartySummary(this.previousBundle.results) : [];
    const previousByPartyAndArea = new Map(previousRows.map((row) => [
      `${normalizeName(row.party)}|${normalizeName(row.constituency)}`,
      row
    ]));
    const hasPreviousElection = previousRows.length > 0;
    return rows.map((row) => {
      const previous = previousByPartyAndArea.get(`${normalizeName(row.party)}|${normalizeName(row.constituency)}`) || (hasPreviousElection
        ? { stood: 0, seats: 0, seatShare: 0, firstPrefs: 0, share: 0 }
        : null);
      return {
        ...row,
        previous,
        deltas: previous ? {
          stood: numberOrZero(row.stood) - numberOrZero(previous.stood),
          seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
          seatShare: row.seatShare !== null && previous.seatShare !== null ? row.seatShare - previous.seatShare : null,
          firstPrefs: numberOrZero(row.firstPrefs) - numberOrZero(previous.firstPrefs),
          share: row.share !== null && previous.share !== null ? row.share - previous.share : null
        } : null
      };
    });
  }

  renderDistrictResults(view = 'party') {
    if (this.localBodyCount() > 1) {
      return this.renderCouncilResults(view);
    }
    const results = this.currentResults();
    const councilRows = this.withPartyDeltas(buildPartySummary(results));
    const candidates = buildCandidateSummary(results);
    const localRows = buildLocalPartySummary(results);
    const totalSeats = councilRows.reduce((sum, row) => sum + numberOrZero(row.seats), 0);
    const validPoll = sumNumbers(results, 'validPoll');
    const totalPoll = sumNumbers(results, 'totalPoll');
    const electorate = sumNumbers(results, 'electorate');
    const spoiled = sumNumbers(results, 'spoiled');
    return `
      <section class="test2-election-panel" aria-label="${escapeHtml(this.activeBundle.body)} district results">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['candidate', 'By Candidate'],
          ['local-party', 'By Local Party'],
          ['constituency', 'By DEA']
        ], view)}
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>District</dt><dd>${escapeHtml(this.activeBundle.displayTitle || this.activeBundle.body)}</dd></div>
            <div><dt>DEAs</dt><dd>${formatNumber(results.length)}</dd></div>
            ${totalSeats ? `<div><dt>Seats</dt><dd>${formatNumber(totalSeats)}</dd></div>` : ''}
            ${validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(validPoll)}</dd></div>` : ''}
            ${totalPoll ? `<div><dt>Total poll</dt><dd>${formatNumber(totalPoll)}</dd></div>` : ''}
            ${spoiled ? `<div><dt>Spoiled</dt><dd>${formatNumber(spoiled)}</dd></div>` : ''}
            ${electorate ? `<div><dt>Electorate</dt><dd>${formatNumber(electorate)}</dd></div>` : ''}
            ${electorate && totalPoll ? `<div><dt>Turnout</dt><dd>${formatPercent(totalPoll / electorate * 100)}</dd></div>` : ''}
          </dl>
          <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
        </div>
        ${this.renderDataCoverageNotice()}
        ${view === 'candidate' ? this.renderCandidateSummaryTable(candidates)
          : view === 'local-party' ? this.renderLocalPartySummaryTable(results)
          : view === 'constituency' ? this.renderConstituencySummaryTable(results)
          : this.renderDistrictPartyTable(councilRows)}
      </section>
    `;
  }

  renderCouncilResults(view = 'party') {
    const results = this.currentResults();
    const councilRows = this.withCouncilDeltas(buildCouncilSummary(results));
    const rows = this.withPartyDeltas(buildPartySummary(results));
    const candidates = buildCandidateSummary(results);
    const localRows = buildLocalPartySummary(results);
    const totalSeats = rows.reduce((sum, row) => sum + numberOrZero(row.seats), 0);
    const validPoll = sumNumbers(results, 'validPoll');
    const electorate = sumNumbers(results, 'electorate');
    return `
      <section class="test2-election-panel" aria-label="${escapeHtml(this.activeBundle.displayTitle || this.activeBundle.body)} council results">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['council', 'By Council'],
          ['candidate', 'By Candidate'],
          ['local-party', 'By Local Party'],
          ['constituency', 'By DEA']
        ], view)}
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>Councils</dt><dd>${formatNumber(councilRows.length)}</dd></div>
            <div><dt>DEAs</dt><dd>${formatNumber(results.length)}</dd></div>
            ${totalSeats ? `<div><dt>Seats</dt><dd>${formatNumber(totalSeats)}</dd></div>` : ''}
            ${validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(validPoll)}</dd></div>` : ''}
            ${electorate ? `<div><dt>Electorate</dt><dd>${formatNumber(electorate)}</dd></div>` : ''}
          </dl>
          <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
        </div>
        ${this.renderDataCoverageNotice()}
        ${view === 'council' ? this.renderCouncilSummaryTable(councilRows)
          : view === 'candidate' ? this.renderCandidateSummaryTable(candidates)
          : view === 'local-party' ? this.renderLocalPartySummaryTable(results)
          : view === 'constituency' ? this.renderConstituencySummaryTable(results)
          : this.renderDistrictPartyTable(rows)}
      </section>
    `;
  }

  renderCouncilSummaryTable(rows = []) {
    return `
      <div class="election-party-wrapper election-party-wrapper--pane-sticky">
        <table class="election-party-table election-party-table--grouped election-results-table--fixed" aria-label="Council summary including Seat change and Turnout change">
          <thead>
            <tr>
              <th rowspan="2" data-leaf-col-idx="0">#</th>
              <th rowspan="2" data-leaf-col-idx="1">Council</th>
              <th rowspan="2" data-leaf-col-idx="2">DEAs</th>
              <th rowspan="2" data-leaf-col-idx="3">Leading party</th>
              <th colspan="2">Seats</th>
              <th colspan="2">Valid votes</th>
              <th colspan="2">Turnout</th>
            </tr>
            <tr>
              ${this.renderMainParityLeafTh('No.', 4)}
              ${this.renderMainParityLeafTh('+/-', 5)}
              ${this.renderMainParityLeafTh('No.', 6)}
              ${this.renderMainParityLeafTh('+/-', 7)}
              ${this.renderMainParityLeafTh('%', 8)}
              ${this.renderMainParityLeafTh('+/-', 9)}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => `
              <tr>
                <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                <td><button type="button" class="election-entity-link election-cell-wrap" data-election-result-key="${escapeHtml(normalizeName(row.council))}">${escapeHtml(row.council)}</button></td>
                <td class="election-num">${formatNumber(row.deas)}</td>
                <td>${this.renderElectionEntityButton('party', row.leadingParty, `<span class="election-party-dot" style="background:${escapeHtml(this.mainPanePartyColour(row.leadingParty, row.colour))}"></span>${escapeHtml(row.leadingParty || '')}`, 'election-cell-wrap')}</td>
                <td class="election-num">${formatNumber(row.seats)}</td>
                <td class="election-num">${row.deltas ? formatMainDelta(row.deltas.seats) : ''}</td>
                <td class="election-num">${formatNumber(row.validPoll)}</td>
                <td class="election-num">${row.deltas ? formatMainDelta(row.deltas.validPoll) : ''}</td>
                <td class="election-num">${formatPercent(row.turnoutPct)}</td>
                <td class="election-num">${row.deltas?.turnoutPct !== null && row.deltas?.turnoutPct !== undefined ? formatMainPercentDelta(row.deltas.turnoutPct) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderDistrictPartyTable(rows = []) {
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead><tr><th>Party</th><th>Candidates</th><th>Seats</th><th>Seat change</th><th>First prefs</th><th>Vote share</th><th>Vote change</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}</button></td>
                <td>${formatNumber(row.stood)}</td>
                <td>${formatNumber(row.seats)}</td>
                <td>${row.deltas ? formatSigned(row.deltas.seats) : ''}</td>
                <td>${formatNumber(row.votes)}</td>
                <td>${formatPercent(row.share)}</td>
                <td>${row.deltas ? `${formatSigned(row.deltas.votes)}${row.deltas.share !== null ? ` (${formatSignedPercent(row.deltas.share)})` : ''}` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderRecallPetitionOverview(results = []) {
    return this.sharedRenderer.renderRecallPetitionOverview(results);
    return `
      <section class="test2-election-panel" aria-label="Recall petition overview">
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>Petitions</dt><dd>${formatNumber(results.length)}</dd></div>
            <div><dt>Triggered</dt><dd>${formatNumber(results.filter((result) => recallTriggered(result)).length)}</dd></div>
            <div><dt>Not triggered</dt><dd>${formatNumber(results.filter((result) => result.recallPetition && !recallTriggered(result)).length)}</dd></div>
          </dl>
        </div>
        <div class="test2-election-table-wrap">
          <table class="test2-election-table catalogue-detail__entity-table">
            <thead><tr><th>Constituency</th><th>Signed</th><th>Threshold</th><th>Shortfall/Surplus</th><th>Outcome</th></tr></thead>
            <tbody>
              ${results.map((result) => {
                const petition = result.recallPetition || {};
                const signed = petition.signed ?? petition.signatures ?? result.leadingVotes ?? null;
                const threshold = petition.threshold ?? petition.required ?? null;
                const shortfall = Number.isFinite(Number(signed)) && Number.isFinite(Number(threshold)) ? Number(signed) - Number(threshold) : null;
                return `
                  <tr>
                    <td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(normalizeName(result.matchName || result.constituency || ''))}">${escapeHtml(result.constituency || '')}</button></td>
                    <td>${formatNumber(signed)}</td>
                    <td>${formatNumber(threshold)}</td>
                    <td>${shortfall === null ? '' : formatSigned(shortfall)}</td>
                    <td>${escapeHtml(petition.outcome || (recallTriggered(result) ? 'By-election triggered' : 'Petition not successful'))}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  renderViewTabs(tabs, active) {
    return this.sharedRenderer.renderViewTabs(tabs, active);
    return `
      <div class="election-view-tabs test2-election-tabs" role="tablist">
        ${tabs.map(([id, label]) => `
          <button type="button" role="tab" aria-selected="${id === active ? 'true' : 'false'}" class="election-view-tab${id === active ? ' election-view-tab--active' : ''}" data-election-view="${escapeHtml(id)}">${escapeHtml(label)}</button>
        `).join('')}
      </div>
    `;
  }

  renderCandidateSummaryTable(candidates) {
    if (!candidates.length) return '<p class="election-no-data">No candidate summary is available for this election.</p>';
    const isLocal = this.isLocalGovernmentElection();
    const widePercentLabel = this.getElectionWidePercentLabel();
    const totalValid = sumNumbers(this.currentResults(), 'validPoll') || candidates.reduce((sum, candidate) => sum + numberOrZero(candidate.firstPrefs ?? candidate.votes), 0);
    const previousCandidateTotalValid = sumNumbers(this.previousBundle?.results || [], 'validPoll')
      || (this.previousBundle?.mainLikeCandidateSummary || []).reduce((sum, candidate) => sum + numberOrZero(candidate.firstPrefs ?? candidate.votes), 0);
    const ordered = [...candidates].sort((a, b) => {
      const pctDelta = numberOrZero(b.firstPrefPct) - numberOrZero(a.firstPrefPct);
      if (Math.abs(pctDelta) > 1e-9) return pctDelta;
      return numberOrZero(b.firstPrefs ?? b.votes) - numberOrZero(a.firstPrefs ?? a.votes)
        || String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
    const geographyHeaders = isLocal
      ? '<th colspan="2">Geography</th>'
      : '<th rowspan="3" data-leaf-col-idx="3">Constituency</th>';
    const leafStart = isLocal ? 7 : 6;
    return `
      <div class="election-count-wrapper election-count-wrapper--pane-sticky">
        <table class="election-count-table election-count-table--grouped election-count-table--candidate-sticky3 election-results-table--fixed${isLocal ? ' election-results-table--local' : ' election-results-table--nonlocal'}">
          <thead>
            <tr>
              <th rowspan="3" data-leaf-col-idx="0">#</th>
              <th rowspan="3" data-leaf-col-idx="1">Name</th>
              <th rowspan="3" data-leaf-col-idx="2">Party</th>
              ${geographyHeaders}
              <th colspan="2">Status</th>
              <th colspan="4">1st preferences</th>
              <th colspan="2">${escapeHtml(widePercentLabel)}</th>
            </tr>
            <tr>
              ${isLocal ? `<th rowspan="2" data-leaf-col-idx="3">District</th><th rowspan="2" data-leaf-col-idx="4">DEA</th>` : ''}
              <th rowspan="2" data-leaf-col-idx="${isLocal ? 5 : 4}">Outcome</th>
              <th rowspan="2" class="election-num election-col-status-count" data-leaf-col-idx="${isLocal ? 6 : 5}">Count</th>
              <th colspan="2">No.</th>
              <th colspan="2">%</th>
              <th colspan="2">%</th>
            </tr>
            <tr>
              ${this.renderMainParityLeafTh('No.', leafStart)}
              ${this.renderMainParityLeafTh('+/-', leafStart + 1)}
              ${this.renderMainParityLeafTh('%', leafStart + 2)}
              ${this.renderMainParityLeafTh('+/-', leafStart + 3)}
              ${this.renderMainParityLeafTh('%', leafStart + 4)}
              ${this.renderMainParityLeafTh('+/-', leafStart + 5)}
            </tr>
          </thead>
          <tbody>
            ${ordered.map((candidate, index) => {
              const firstPrefs = numberOrZero(candidate.firstPrefs ?? candidate.votes);
              const niPct = totalValid > 0 ? firstPrefs / totalValid * 100 : 0;
              const previousFirstPrefs = candidate.previous ? numberOrZero(candidate.previous.firstPrefs ?? candidate.previous.votes) : null;
              const previousNiPct = candidate.previous && previousCandidateTotalValid > 0 ? previousFirstPrefs / previousCandidateTotalValid * 100 : null;
              const niPctDelta = candidate.deltas && previousNiPct !== null ? niPct - previousNiPct : null;
              const status = candidate.elected ? 'Elected' : (candidate.excluded ? 'Excluded' : (candidate.status || 'Not Elected'));
              const countValue = candidate.countDisplay
                || (candidate.electedAt || candidate.excludedAt || candidate.finalCount
                  ? `${candidate.electedAt || candidate.excludedAt || candidate.finalCount}/${candidate.countNumbers?.length || candidate.counts?.length || ''}`.replace(/\/$/, '')
                  : '');
              const localBody = candidate.localBody || candidate.council || candidate.district || '';
              return `
                <tr class="${candidate.elected ? 'election-row--elected' : ''}">
                  <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                  <td>${this.renderElectionEntityButton('candidate', candidate.id || `${candidate.name}|${candidate.party}`, escapeHtml(candidate.name || ''), 'election-cell-wrap')}</td>
                  <td>${this.renderElectionEntityButton('party', candidate.party, `<span class="election-party-dot" style="background:${escapeHtml(this.mainPanePartyColour(candidate.party, candidate.colour))}"></span>${escapeHtml(candidate.party || '')}`, 'election-cell-wrap')}</td>
                  ${isLocal ? `<td><span class="election-cell-wrap">${escapeHtml(localBody)}</span></td>` : ''}
                  <td><button type="button" class="election-entity-link election-cell-wrap" data-election-result-key="${escapeHtml(normalizeName(candidate.constituency || ''))}">${escapeHtml(candidate.constituency || '')}</button></td>
                  <td><span class="election-cell-wrap">${status === 'Elected' ? '<strong>Elected</strong>' : escapeHtml(status)}</span></td>
                  <td class="election-num election-col-status-count"><span class="election-cell-wrap">${escapeHtml(countValue)}</span></td>
                  <td class="election-num election-cell-strong election-col-votes">${formatNumber(firstPrefs)}</td>
                  <td class="election-num election-col-delta-votes">${candidate.deltas ? formatMainDelta(candidate.deltas.firstPrefs) : ''}</td>
                  <td class="election-num election-col-pct-main">${formatFixedPercent(candidate.firstPrefPct)}</td>
                  <td class="election-num election-col-pct-delta-main">${candidate.deltas?.firstPrefPct !== null && candidate.deltas?.firstPrefPct !== undefined ? formatMainPercentDelta(candidate.deltas.firstPrefPct) : ''}</td>
                  <td class="election-num election-col-pct-small">${formatFixedPercent(niPct)}</td>
                  <td class="election-num election-col-pct-delta-small">${niPctDelta !== null && niPctDelta !== undefined ? formatMainPercentDelta(niPctDelta) : ''}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderConstituencySummaryTable(results) {
    return this.sharedRenderer.renderConstituencySummaryTable(results);
    return `
      <div class="test2-election-table-wrap test2-election-table-wrap--constituencies">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead><tr><th>Constituency/DEA</th><th>Winner/lead</th><th>Party</th><th>Seats</th><th>Change</th><th>Turnout</th><th>Majority</th></tr></thead>
          <tbody>
            ${results.map((result) => `
              <tr>
                <td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(normalizeName(result.matchName || result.constituency || ''))}">${escapeHtml(result.constituency || result.matchName || '')}</button></td>
                <td>${escapeHtml(result.winnerName || result.leadingName || '')}</td>
                <td><span class="test2-party-swatch" style="background:${escapeHtml(electionPartyColour(result.winnerParty || result.leadingParty))}"></span>${escapeHtml(result.winnerParty || result.leadingParty || '')}</td>
                <td>${formatNumber(result.seatsWon ?? result.seatsTotal ?? '')}</td>
                <td>${result.deltas ? formatSigned(result.deltas.seatsWon) : ''}</td>
                <td>${formatPercent(result.turnoutPct)}</td>
                <td>${formatNumber(result.majority)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderLocalPartySummaryTable(results) {
    const rows = this.withLocalPartyDeltas(buildLocalPartySummary(results));
    if (!rows.length) return '<p class="election-no-data">No local-party summary is available for this election.</p>';
    const areaLabel = this.isLocalGovernmentElection() ? 'DEA' : 'Constituency';
    return `
      <div class="election-party-wrapper election-party-wrapper--pane-sticky">
        <table class="election-party-table election-party-table--grouped election-party-table--district-sticky3 election-party-table--district-local-party-sticky4 election-results-table--fixed election-results-table--district">
          <thead>
            <tr>
              <th rowspan="2" data-leaf-col-idx="0">#</th>
              <th rowspan="2" data-leaf-col-idx="1">Party</th>
              <th rowspan="2" data-leaf-col-idx="2">${escapeHtml(areaLabel)}</th>
              <th colspan="2">Candidates</th>
              <th colspan="4">Seats</th>
              <th colspan="4">1st preferences</th>
            </tr>
            <tr>
              ${this.renderMainParityLeafTh('No.', 3)}
              ${this.renderMainParityLeafTh('+/-', 4)}
              ${this.renderMainParityLeafTh('No.', 5)}
              ${this.renderMainParityLeafTh('+/-', 6)}
              ${this.renderMainParityLeafTh('%', 7)}
              ${this.renderMainParityLeafTh('+/-', 8)}
              ${this.renderMainParityLeafTh('No.', 9)}
              ${this.renderMainParityLeafTh('+/-', 10)}
              ${this.renderMainParityLeafTh('%', 11)}
              ${this.renderMainParityLeafTh('+/-', 12)}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => `
              <tr>
                <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                <td>${this.renderElectionEntityButton('party', row.party, `<span class="election-party-dot" style="background:${escapeHtml(this.mainPanePartyColour(row.party, row.colour))}"></span>${escapeHtml(row.party)}`, 'election-cell-wrap')}</td>
                <td><button type="button" class="election-entity-link election-cell-wrap" data-election-result-key="${escapeHtml(row.resultKey)}">${escapeHtml(row.constituency)}</button></td>
                <td class="election-num">${formatNumber(row.stood)}</td>
                <td class="election-num">${row.deltas ? formatMainDelta(row.deltas.stood) : ''}</td>
                <td class="election-num">${formatNumber(row.seats)}</td>
                <td class="election-num">${row.deltas ? formatMainDelta(row.deltas.seats) : ''}</td>
                <td class="election-num">${formatPercent(row.seatShare)}</td>
                <td class="election-num">${row.deltas?.seatShare !== null && row.deltas?.seatShare !== undefined ? formatMainPercentDelta(row.deltas.seatShare) : ''}</td>
                <td class="election-num">${formatNumber(row.firstPrefs)}</td>
                <td class="election-num">${row.deltas ? formatMainDelta(row.deltas.firstPrefs) : ''}</td>
                <td class="election-num">${formatPercent(row.share)}</td>
                <td class="election-num">${row.deltas?.share !== null && row.deltas?.share !== undefined ? formatMainPercentDelta(row.deltas.share) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderDataCoverageNotice() {
    return this.sharedRenderer.renderDataCoverageNotice();
    const unmatched = Number(this.activeBundle?.unmatchedCount || 0);
    if (!unmatched) return '';
    return `
      <div class="test2-election-coverage-notice" role="note">
        ${formatNumber(unmatched)} result ${unmatched === 1 ? 'row is' : 'rows are'} not styled on the map because no exact converted geography match is available yet.
      </div>
    `;
  }

  renderCountTable(result, candidates) {
    const sourceCountNumbers = result.countNumbers?.length
      ? result.countNumbers
      : [...new Set(candidates.flatMap((candidate) => (candidate.counts || []).map((count) => count.count)))].sort((a, b) => a - b);
    const rawCountNumbers = sourceCountNumbers;
    if (!rawCountNumbers.length) return '<p class="election-no-data">No count-by-count data is available for this entry.</p>';
    const countEvents = inferCountEvents(candidates, rawCountNumbers);
    const stvResult = isStvResult(result);
    const transferContext = stvResult
      ? buildStvTransferContext(result, candidates, rawCountNumbers)
      : {
        nonTransferable: new Map((result.nonTransferable || []).map((row) => [Number(row.count), row])),
        transferDenominators: new Map()
      };
    const nonTransferable = transferContext.nonTransferable;
    const transferDenominators = transferContext.transferDenominators;
    const visibleCounts = rawCountNumbers.filter((count) => {
      const n = Number(count);
      if (n <= 1) return false;
      if (countEvents.some((event) => Number(event.count) === n)) return true;
      const hasCandidateTransfer = candidates.some((candidate) => {
        const row = (candidate.counts || []).find((entry) => Number(entry.count) === n);
        return Math.abs(Number(row?.transfers) || 0) > 0.0001;
      });
      if (hasCandidateTransfer) return true;
      return Math.abs(Number(nonTransferable.get(n)?.transfers) || 0) > 0.0001;
    });
    const totalCountCount = visibleCounts.length + 1;
    const displayCountForRaw = (rawCount) => {
      const raw = Number(rawCount) || 1;
      if (raw <= 1) return 1;
      return 1 + visibleCounts.filter((count) => Number(count) <= raw).length;
    };
    const orderedCandidates = [...candidates].sort((a, b) => {
      if (!result.syntheticCountGroup) {
        const elected = Number(Boolean(b.elected)) - Number(Boolean(a.elected));
        if (elected) return elected;
        const aCount = Number(a.electedAt || a.finalCount || 999);
        const bCount = Number(b.electedAt || b.finalCount || 999);
        if (a.elected && b.elected && aCount !== bCount) return aCount - bCount;
      }
      return numberOrZero(b.finalVotes ?? b.firstPrefs ?? b.votes) - numberOrZero(a.finalVotes ?? a.firstPrefs ?? a.votes)
        || String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
    const validPoll = numberOrZero(result.validPoll);
    const totalPoll = numberOrZero(result.totalPoll);
    const electorate = numberOrZero(result.electorate);
    const spoiled = numberOrZero(result.spoiled);
    const didNotVote = Math.max(0, electorate - totalPoll);
    const prev = result.previous || {};
    const pctOfTurnout = (value) => totalPoll > 0 ? value / totalPoll * 100 : 0;
    const pctOfElectorate = (value) => electorate > 0 ? value / electorate * 100 : 0;
    const appendSummaryRow = (label, value, previousValue, pctValue, previousPctValue) => `
      <tr class="election-table-summary-row">
        <td class="election-rank-col">-</td>
        <td></td>
        <td><strong>${escapeHtml(label)}</strong></td>
        <td>-</td>
        <td>-</td>
        <td class="election-num">${Number.isFinite(Number(previousValue)) ? formatMainDelta(value - previousValue) : '<span class="election-na"><em>N/A</em></span>'}</td>
        <td class="election-num">${formatFixedPercent(pctValue)}</td>
        ${this.countDetailedView ? `<td class="election-num">${Number.isFinite(Number(previousPctValue)) ? formatMainPercentDelta(pctValue - previousPctValue) : '<span class="election-na"><em>N/A</em></span>'}</td>` : ''}
        <td class="election-num election-cell-strong">${formatNumber(value)}</td>
        ${visibleCounts.map(() => this.countDetailedView ? '<td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td><td class="election-num">-</td>' : '<td class="election-num">-</td>').join('')}
      </tr>
    `;
    return `
      <div class="election-count-wrapper election-count-wrapper--pane-sticky">
        <table class="election-count-table election-results-table--fixed${this.isLocalGovernmentElection() ? ' election-results-table--local' : ' election-results-table--nonlocal'}">
          <thead>
            <tr>
              <th data-leaf-col-idx="0">#</th>
              <th class="election-colour-col" data-leaf-col-idx="1"></th>
              <th class="election-col-name" data-leaf-col-idx="2">Name</th>
              <th class="election-col-party" data-leaf-col-idx="3">Party</th>
              <th class="election-col-status" data-leaf-col-idx="4">Status</th>
              <th class="election-num" data-leaf-col-idx="5">${this.renderTwoLineHeader('1st', 'pref +/-')}</th>
              <th class="election-num" data-leaf-col-idx="6">${this.renderTwoLineHeader('1st', 'pref %')}</th>
              ${this.countDetailedView ? `<th class="election-num" data-leaf-col-idx="7">${this.renderTwoLineHeader('1st', 'pref +/- %')}</th>` : ''}
              <th class="election-num" data-leaf-col-idx="${this.countDetailedView ? 8 : 7}">${this.renderTwoLineHeader('1st', 'pref')}</th>
              ${visibleCounts.map((count, index) => {
                const event = countEvents.find((item) => Number(item.count) === Number(count));
                const base = this.countDetailedView ? 9 + (index * 4) : 8 + index;
                return `
                  <th class="election-num election-count-col" data-leaf-col-idx="${base}">${this.renderTwoLineHeader(this.countDetailedView ? `Count ${formatNumber(count)}` : 'Count', this.countDetailedView && event ? event.label : formatNumber(displayCountForRaw(count)))}</th>
                  ${this.countDetailedView ? `<th class="election-num election-count-col" data-leaf-col-idx="${base + 1}">${this.renderTwoLineHeader(`Count ${formatNumber(count)}`, '%')}</th><th class="election-num election-count-col" data-leaf-col-idx="${base + 2}">${this.renderTwoLineHeader(`Count ${formatNumber(count)}`, '+/- %')}</th><th class="election-num election-count-col" data-leaf-col-idx="${base + 3}">${this.renderTwoLineHeader(`Count ${formatNumber(count)}`, '+/-')}</th>` : ''}
                `;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${orderedCandidates.map((candidate, index) => {
              const counts = new Map((candidate.counts || []).map((count) => [Number(count.count), count]));
              const quotaHoldCount = stvResult ? quotaHoldStartCount(candidate, counts, result) : null;
              const syntheticFirstCount = result.syntheticCountGroup ? counts.get(1) : null;
              const firstPrefs = result.syntheticCountGroup
                ? numberOrZero(syntheticFirstCount?.firstPrefs ?? syntheticFirstCount?.total)
                : numberOrZero(candidate.firstPrefs ?? candidate.votes);
              const firstPrefPct = validPoll > 0 ? firstPrefs / validPoll * 100 : 0;
              const terminalCount = candidate.electedAt || candidate.excludedAt || candidate.finalCount || rawCountNumbers[rawCountNumbers.length - 1];
              const statusCount = candidate.elected
                ? `Elected<br>Count ${displayCountForRaw(candidate.electedAt || candidate.finalCount || rawCountNumbers[rawCountNumbers.length - 1])}/${totalCountCount}`
                : candidate.excluded
                ? `Excluded<br>Count ${displayCountForRaw(candidate.excludedAt || candidate.finalCount || rawCountNumbers[rawCountNumbers.length - 1])}/${totalCountCount}`
                : `Not Elected<br>Count ${displayCountForRaw(terminalCount)}/${totalCountCount}`;
              return `
                <tr class="election-count-row${candidate.elected ? ' election-count-row--elected' : ''}">
                  <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                  <td class="election-colour-col"><span class="election-party-dot" style="background:${escapeHtml(this.mainPanePartyColour(candidate.party, candidate.colour))}"></span></td>
                  <td class="election-col-name">${this.renderElectionEntityButton('candidate', candidate.id || `${candidate.name}|${candidate.party}`, escapeHtml(candidate.name || ''), 'election-cell-wrap election-cell-wrap--count-name')}</td>
                  <td class="election-col-party">${this.renderElectionEntityButton('party', candidate.party, escapeHtml(candidate.party || ''), 'election-cell-wrap election-cell-wrap--count-party')}</td>
                  <td class="election-col-status"><span class="election-cell-wrap election-cell-wrap--count-status">${statusCount}</span></td>
                  <td class="election-num">${!result.syntheticCountGroup && candidate.deltas ? formatMainDelta(candidate.deltas.firstPrefs) : '<span class="election-na"><em>N/A</em></span>'}</td>
                  <td class="election-num">${formatFixedPercent(firstPrefPct)}</td>
                  ${this.countDetailedView ? `<td class="election-num">${!result.syntheticCountGroup && candidate.deltas?.firstPrefPct !== null && candidate.deltas?.firstPrefPct !== undefined ? formatMainPercentDelta(candidate.deltas.firstPrefPct) : '<span class="election-na"><em>N/A</em></span>'}</td>` : ''}
                  <td class="election-num">${formatNumber(firstPrefs)}</td>
                  ${visibleCounts.map((count) => {
                    const row = counts.get(Number(count));
                    if (shouldDashQuotaHeldCount(count, quotaHoldCount)) {
                      return this.countDetailedView
                        ? '<td class="election-num election-count-col">-</td><td class="election-num election-count-col">-</td><td class="election-num election-count-col">-</td><td class="election-num election-count-col">-</td>'
                        : '<td class="election-num election-count-col">-</td>';
                    }
                    if (!row) {
                      return this.countDetailedView
                        ? '<td class="election-num election-count-col">&nbsp;</td><td class="election-num election-count-col">-</td><td class="election-num election-count-col">-</td><td class="election-num election-count-col">-</td>'
                        : '<td class="election-num election-count-col">&nbsp;</td>';
                    }
                    const value = row.total ?? row.firstPrefs;
                    const transfer = Number(row.transfers);
                    const votePct = validPoll > 0 ? Number(value) / validPoll * 100 : 0;
                    const transferDenominator = transferDenominators.get(Number(count));
                    if (!this.countDetailedView) return `<td class="election-num election-count-col">${formatNumber(value)}</td>`;
                    return `<td class="election-num election-count-col">${formatNumber(value)}</td><td class="election-num election-count-col">${formatFixedPercent(votePct)}</td><td class="election-num election-count-col">${formatTransferShare(transfer, transferDenominator)}</td><td class="election-num election-count-col">${transfer ? formatMainDelta(transfer) : '-'}</td>`;
                  }).join('')}
                </tr>
              `;
            }).join('')}
            ${(stvResult || nonTransferable.size) ? `
              <tr class="election-table-summary-row">
                <td class="election-rank-col">-</td>
                <td></td>
                <td><strong>Non-transferable</strong></td>
                <td>-</td>
                <td>-</td>
                <td class="election-num">-</td>
                <td class="election-num">-</td>
                ${this.countDetailedView ? '<td class="election-num">-</td>' : ''}
                <td class="election-num">-</td>
                ${visibleCounts.map((count) => {
                  const row = nonTransferable.get(Number(count)) || (stvResult ? { total: 0, transfers: 0 } : null);
                  if (!row) return this.countDetailedView ? '<td class="election-num election-count-col">&nbsp;</td><td class="election-num election-count-col">-</td><td class="election-num election-count-col">-</td><td class="election-num election-count-col">-</td>' : '<td class="election-num election-count-col">&nbsp;</td>';
                  const transferDenominator = transferDenominators.get(Number(count));
                  return this.countDetailedView
                    ? `<td class="election-num election-count-col">${formatNumber(row.total)}</td><td class="election-num election-count-col">${validPoll > 0 ? formatFixedPercent(Number(row.total) / validPoll * 100) : '-'}</td><td class="election-num election-count-col">${formatTransferShare(row.transfers, transferDenominator)}</td><td class="election-num election-count-col">${row.transfers ? formatMainDelta(row.transfers) : '-'}</td>`
                    : `<td class="election-num election-count-col">${formatNumber(row.total)}</td>`;
                }).join('')}
              </tr>
            ` : ''}
            ${appendSummaryRow('Valid votes', validPoll, numberOrZero(prev.validPoll), pctOfTurnout(validPoll), pctOfTurnout(numberOrZero(prev.validPoll)))}
            ${appendSummaryRow('Spoiled', spoiled, numberOrZero(prev.spoiled), pctOfTurnout(spoiled), pctOfTurnout(numberOrZero(prev.spoiled)))}
            ${appendSummaryRow('Turnout', totalPoll, numberOrZero(prev.totalPoll), pctOfElectorate(totalPoll), pctOfElectorate(numberOrZero(prev.totalPoll)))}
            ${appendSummaryRow('Did not vote', didNotVote, Math.max(0, numberOrZero(prev.electorate) - numberOrZero(prev.totalPoll)), pctOfElectorate(didNotVote), pctOfElectorate(Math.max(0, numberOrZero(prev.electorate) - numberOrZero(prev.totalPoll))))}
            ${appendSummaryRow('Electorate', electorate, numberOrZero(prev.electorate), 100, 100)}
          </tbody>
        </table>
      </div>
    `;
  }

  renderRecallPetitionResult(result) {
    return this.sharedRenderer.renderRecallPetitionResult(result);
    const petition = result.recallPetition || {};
    const signed = petition.signed ?? petition.signatures ?? result.leadingVotes ?? null;
    const threshold = petition.threshold ?? petition.required ?? null;
    const electorate = petition.electorate ?? result.electorate ?? null;
    const triggered = petition.triggered ?? (Number.isFinite(Number(signed)) && Number.isFinite(Number(threshold)) ? Number(signed) >= Number(threshold) : null);
    const shortfall = Number.isFinite(Number(signed)) && Number.isFinite(Number(threshold)) ? Number(threshold) - Number(signed) : null;
    return `
      <section class="test2-election-panel" aria-label="${escapeHtml(result.constituency)} recall petition result">
        <dl class="test2-election-panel__stats">
          <div><dt>Constituency</dt><dd>${escapeHtml(result.constituency || '')}</dd></div>
          ${electorate ? `<div><dt>Electorate</dt><dd>${formatNumber(electorate)}</dd></div>` : ''}
          ${threshold ? `<div><dt>Threshold</dt><dd>${formatNumber(threshold)}</dd></div>` : ''}
          ${signed ? `<div><dt>Signed</dt><dd>${formatNumber(signed)}</dd></div>` : ''}
          ${shortfall !== null ? `<div><dt>${shortfall <= 0 ? 'Above threshold' : 'Shortfall'}</dt><dd>${formatNumber(Math.abs(shortfall))}</dd></div>` : ''}
          ${triggered !== null ? `<div><dt>By-election triggered</dt><dd>${triggered ? 'Yes' : 'No'}</dd></div>` : ''}
          ${petition.incumbent ? `<div><dt>Incumbent</dt><dd>${escapeHtml(petition.incumbent)}</dd></div>` : ''}
          ${petition.incumbentParty ? `<div><dt>Incumbent party</dt><dd>${escapeHtml(petition.incumbentParty)}</dd></div>` : ''}
        </dl>
        ${petition.outcome || petition.notes ? `
          <div class="test2-election-coverage-notice">
            ${petition.outcome ? `<strong>${escapeHtml(petition.outcome)}</strong>` : ''}
            ${petition.notes ? `<p>${escapeHtml(petition.notes)}</p>` : ''}
          </div>
        ` : ''}
        ${petition.incumbent || petition.incumbentParty ? `
          <div class="test2-election-table-wrap">
            <table class="test2-election-table catalogue-detail__entity-table">
              <thead><tr><th>Incumbent</th><th>Party</th><th>Outcome</th></tr></thead>
              <tbody><tr><td>${escapeHtml(petition.incumbent || '')}</td><td>${escapeHtml(petition.incumbentParty || '')}</td><td>${triggered ? 'Seat vacated' : 'Seat retained'}</td></tr></tbody>
            </table>
          </div>
        ` : ''}
      </section>
    `;
  }

  renderAnimationNotice(result) {
    if (this.resultHasAnimation(result) && result.animationPayload) {
      return `
        <div class="test2-election-animation-ready">
          <div id="test2ElectionAnimationStatus" class="election-no-data" aria-live="polite">Loading transfer animation...</div>
          <div id="electionAnimationContainer" class="election-animation-container" style="display:none;">
            <div class="ev-animation-top-row">
              <div class="ev-animation-controls">
                <i id="pause-replay" class="fa fa-pause" title="Pause / Replay"></i>
              </div>
              <div id="stageNumbers"></div>
            </div>
            <div id="quota"></div>
            <div id="animation" class="ev-animation-stage"></div>
            <div id="count_matrix"></div>
            <div id="transfers"></div>
          </div>
        </div>
      `;
    }
    return this.sharedRenderer.renderAnimationNotice(result);
  }

  async runAnimation(result) {
    const container = document.getElementById('electionAnimationContainer');
    const status = document.getElementById('test2ElectionAnimationStatus');
    if (!container || !result?.animationPayload) return;
    try {
      await ensureElectionAnimationRuntime();
    } catch (error) {
      if (status) status.textContent = `The election animation engine could not load: ${error.message}`;
      return;
    }
    if (typeof window.$?.preloadElectionData !== 'function' || typeof window.animateStages !== 'function') {
      if (status) status.textContent = 'The election animation engine is not available on this route.';
      return;
    }
    container.style.display = 'block';
    if (status) status.textContent = '';
    try {
      window.$.preloadElectionData(result.animationPayload);
      window.animateStages({
        date: this.activeBundle?.date,
        electedBody: this.activeBundle?.body,
        constituency: result.constituency,
        maxWidth: Math.max(320, (document.getElementById('electionPaneContent')?.clientWidth || 0) - 16)
      });
    } catch (error) {
      console.error('[test2 elections] Animation failed', error);
      if (status) status.textContent = `Animation failed: ${error.message}`;
    } finally {
      window.$?.clearPreloadedData?.();
    }
  }

  renderEntityPanel(kind, key, options = {}) {
    const index = this.activeBundle?.entityIndex || buildEntityIndex(this.currentResults());
    const entity = kind === 'candidate'
      ? (index.candidates || []).find((item) => String(item.personId) === String(key))
      : (index.parties || []).find((item) => normalizeName(item.name) === normalizeName(key));
    if (!entity) return;
    const pane = this.ensurePanel();
    const content = document.getElementById('electionPaneContent');
    const title = document.getElementById('electionPaneTitle');
    const back = document.getElementById('electionPaneBack');
    if (!pane || !content || !title) return;
    this.activeEntityKind = kind;
    this.activeEntityKey = key;
    this.activeEntityReturnView = this.activePanelView || 'party';
    this.activeSelectedResultKey = null;
    title.textContent = entity.name || entity.personId || 'Election entity';
    back?.classList.remove('hidden');
    content.innerHTML = this.mainPaneContract.renderEntityPanel(kind, entity);
    back?.addEventListener('click', () => {
      const returnView = this.activeEntityReturnView || 'party';
      this.activeEntityKind = null;
      this.activeEntityKey = null;
      this.renderPanel(null, returnView);
      this.app.updateURLState();
    });
    content.querySelectorAll('[data-election-result-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const result = this.findResultByKey(button.dataset.electionResultKey);
        if (result) {
          this.renderPanel(result, 'party');
          this.app.updateURLState();
        }
      });
    });
    if (options.updateURL !== false) this.app.updateURLState();
  }

  renderPartyEntity(entity) {
    const widePercentLabel = this.getElectionWidePercentLabel();
    return `
      <section class="election-entity-page">
        <div class="election-entity-page__hero">
          <span class="election-party-dot election-party-dot--hero" style="background:${escapeHtml(entity.colour || electionPartyColour(entity.name))}"></span>
          <div>
            <div class="election-entity-page__eyebrow">Party Information</div>
            <h3 class="election-entity-page__title">${escapeHtml(entity.name || '')}</h3>
            <p class="election-entity-page__subtitle">${escapeHtml(shortElectionBody(this.activeBundle.body || this.activeBundle.displayTitle || ''))} - ${escapeHtml(formatElectionDate(this.activeBundle.date || ''))}</p>
          </div>
        </div>
        <div class="election-entity-metrics">
          <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates stood</span><strong>${formatNumber(entity.stood)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates elected</span><strong>${formatNumber(entity.elected)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">1st prefs</span><strong>${formatNumber(entity.firstPrefs)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">${escapeHtml(widePercentLabel)}</span><strong>${formatPercent(entity.shareOfTotal)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Final-round votes</span><strong>${formatNumber(entity.finalVotes)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Constituencies</span><strong>${formatNumber(entity.constituencies?.length || 0)}</strong></div>
        </div>
        <div class="election-party-wrapper">
          <table class="election-party-table election-entity-table">
            <thead><tr><th>Candidate</th><th>Constituency</th><th class="election-num">1st prefs</th><th class="election-num">1st prefs %</th><th class="election-num">Final votes</th><th>Status</th></tr></thead>
            <tbody>${(entity.candidates || []).map((candidate) => `<tr><td><span class="election-cell-wrap">${escapeHtml(candidate.name || '')}</span></td><td><span class="election-cell-wrap">${escapeHtml(candidate.constituency || '')}</span></td><td class="election-num">${formatNumber(candidate.firstPref)}</td><td class="election-num">${formatPercent(candidate.firstPrefPct)}</td><td class="election-num">${formatNumber(candidate.finalVotes)}</td><td><span class="election-cell-wrap">${escapeHtml(candidate.status || '')}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  renderCandidateEntity(entity) {
    const widePercentLabel = this.getElectionWidePercentLabel();
    return `
      <section class="election-entity-page">
        <div class="election-entity-page__hero">
          <span class="election-party-dot election-party-dot--hero" style="background:${escapeHtml(entity.colour || electionPartyColour(entity.party))}"></span>
          <div>
            <div class="election-entity-page__eyebrow">Candidate Information</div>
            <h3 class="election-entity-page__title">${escapeHtml(entity.name || '')}</h3>
            <p class="election-entity-page__subtitle">${escapeHtml(entity.party || '')} - Person ID ${escapeHtml(entity.personId || '')}</p>
          </div>
        </div>
        <div class="election-entity-metrics">
          <div class="election-entity-metric"><span class="election-entity-metric__label">1st prefs</span><strong>${formatNumber(entity.firstPrefs)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">${escapeHtml(widePercentLabel)}</span><strong>${formatPercent(entity.shareOfTotal)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Final-round votes</span><strong>${formatNumber(entity.finalVotes)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Constituency count</span><strong>${formatNumber(entity.constituencies?.length || 0)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Election wins</span><strong>${formatNumber(entity.electedCount)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Total valid poll</span><strong>${formatNumber(this.activeBundle?.mainLikeTotals?.validPoll || sumNumbers(this.currentResults(), 'validPoll'))}</strong></div>
        </div>
        <div class="election-party-wrapper election-party-wrapper--pane-sticky">
          <table class="election-party-table election-party-table--grouped election-results-table--fixed">
            <thead>
              <tr>
                <th rowspan="2" data-leaf-col-idx="0">Constituency / DEA</th>
                <th colspan="2">1st preferences</th>
                <th colspan="2">Final count</th>
              </tr>
              <tr>
                ${this.renderMainParityLeafTh('No.', 1)}
                ${this.renderMainParityLeafTh('%', 2)}
                ${this.renderMainParityLeafTh('No.', 3)}
                ${this.renderMainParityLeafTh('Status', 4)}
              </tr>
            </thead>
            <tbody>
              ${(entity.appearances || []).map((row) => `
                <tr><td><button type="button" class="election-entity-link election-cell-wrap" data-election-result-key="${escapeHtml(normalizeName(row.constituency || ''))}">${escapeHtml(row.constituency)}</button></td><td class="election-num">${formatNumber(row.firstPref)}</td><td class="election-num">${formatPercent(row.firstPrefPct)}</td><td class="election-num">${formatNumber(row.finalVotes)}</td><td>${escapeHtml(row.status || '')}</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  showFeatureResults(feature) {
    if (!this.activeBundle || !feature) return false;
    if (feature.electionResult) {
      this.renderPanel(feature.electionResult);
      return true;
    }
    if (this.isFeatureFromActiveElection(feature)) {
      this.renderPanel(null, this.activePanelView || 'party');
      return true;
    }
    return false;
  }

  isFeatureFromActiveElection(feature) {
    if (!this.activeBundle || !feature) return false;
    const featureMapId = normalizeName(feature.mapId || feature.sourceMapId || feature.layerId || '');
    if (!featureMapId) return false;
    return [
      this.activeBundle.layerId,
      this.activeBundle.sourceMapId,
      this.activeBundle.councilLayerId,
      this.activeBundle.councilSourceMapId,
      this.activeEntry?.sourceMapId,
      this.activeEntry?.layerId,
      this.activeEntry?.councilSourceMapId,
      this.activeEntry?.councilLayerId
    ].some((value) => normalizeName(value || '') === featureMapId);
  }

  findResultByKey(key) {
    const normalized = normalizeName(key);
    if (!normalized) return null;
    return this.currentResults().find((result) => resultKeys(result).includes(normalized)) || null;
  }

  renderLegend() {
    const target = document.getElementById('test2ElectionLegend');
    if (!target || !this.activeBundle) return;
    const mode = this.activeMode;
    if (['winner', 'leadingParty'].includes(mode)) {
      const parties = new Map();
      for (const result of this.activeBundle.results || []) {
        const party = mode === 'winner' ? result.winnerParty : result.leadingParty;
        if (!party) continue;
        parties.set(party, this.mainPanePartyColour(party));
      }
      target.innerHTML = [...parties.entries()].slice(0, 12).map(([party, colour]) => `
        <span class="test2-election-panel__legend-item"><i style="background:${escapeHtml(colour)}"></i>${escapeHtml(party)}</span>
      `).join('');
      return;
    }
    target.innerHTML = `
      <span class="test2-election-panel__legend-ramp" aria-hidden="true"></span>
      <span>${escapeHtml(MODE_LABELS[mode] || mode)}: low to high</span>
    `;
  }

  ensurePanel() {
    const pane = document.getElementById('electionResultsPane');
    if (!pane) return null;
    if (!pane.querySelector('#electionPaneTitle') || !pane.querySelector('#electionPaneContent') || !pane.querySelector('#electionPaneHeaderRight')) {
      pane.innerHTML = `
        <div class="test2-election-pane-resizer" data-election-pane-resize role="separator" aria-label="Resize election results pane" aria-orientation="horizontal" tabindex="0" title="Drag to resize election results"></div>
        <div class="election-pane__header">
          <button type="button" id="electionPaneBack" class="election-pane__back hidden" aria-label="Back to overall election results">&lt;</button>
          <h3 id="electionPaneTitle" class="election-pane__title">Election results</h3>
          <div class="election-pane__header-right" id="electionPaneHeaderRight"></div>
        </div>
        <div id="electionPaneContent" class="election-pane__content"></div>
      `;
    }
    return pane;
  }

  renderLoadingPanel(entry) {
    const pane = this.ensurePanel();
    const title = document.getElementById('electionPaneTitle');
    const content = document.getElementById('electionPaneContent');
    const back = document.getElementById('electionPaneBack');
    if (!pane || !title || !content) return;
    title.textContent = entry?.displayTitle || entry?.body || 'Election results';
    back?.classList.add('hidden');
    const headerRight = pane.querySelector('.election-pane__header-right');
    if (headerRight) {
      headerRight.innerHTML = '<span class="test2-election-loading-badge" aria-live="polite">Loading election</span>';
    }
    content.innerHTML = `
      <div class="election-loading test2-election-loading" role="status" aria-live="polite">
        <strong>Loading election results</strong>
        <span>Preparing the map layer, result bundle, labels, and seat circles.</span>
      </div>
    `;
    pane.classList.add('election-results-pane--open');
    document.body.classList.add('test2-election-open');
  }

  removePanel() {
    const pane = document.getElementById('electionResultsPane');
    pane?.classList.remove('election-results-pane--open');
    if (pane) pane.innerHTML = '';
    document.body.classList.remove('test2-election-open');
  }

  async renderElectionOverlay() {
    this.removeElectionOverlays();
    if (!this.activeBundle) return;
    if (this.shouldRenderRecallLabels()) {
      await this.renderRecallLabels();
      return;
    }
    if (!this.shouldRenderElectionOverlays()) return;
    this.bindOverlayRefresh();
    if (this.overlayMode === 'bars') {
      await this.renderVoteBars();
      return;
    }
    await this.renderSeatCircles();
  }

  removeElectionOverlays() {
    this.removeSeatCircles();
    this.removeVoteBars();
    this.removeRecallLabels();
  }

  async renderSeatCircles() {
    const started = performance.now();
    this.lastSeatCircleRenderMs = 0;
    if (!this.activeBundle || !this.shouldRenderElectionOverlays()) return;
    const index = await this.loadFeatureIndex();
    const centres = this.buildFeatureCentreLookup(index?.items || []);
    const map = this.mapController.map;
    const groups = this.buildSeatCircleGroups(centres);
    const visibleGroups = await this.filterOverlayGroupsByCollisionAsync(groups);
    const overlay = this.ensureSeatCircleOverlay();
    if (!overlay) return;
    overlay.innerHTML = '';
    this.removeLegacySeatCircleLayers();
    this.removeSeatCircleMarkers();
    this.seatCircleOverlayState = { groups: [], dotCount: 0 };

    for (const group of visibleGroups) {
      const { result, center, seats, positions, groupWidth, groupHeight } = group;
      const projected = map.project(center);
      if (!Number.isFinite(projected?.x) || !Number.isFinite(projected?.y)) continue;
      const minX = Math.min(...positions.map((point) => point.x));
      const minY = Math.min(...positions.map((point) => point.y));
      const maxX = Math.max(...positions.map((point) => point.x));
      const dotWidth = maxX - minX + SEAT_CIRCLE_SIZE;
      const dotOffsetX = Math.max(0, (groupWidth - dotWidth) / 2);
      const dotOffsetY = result.syntheticNonGeographic ? SYNTHETIC_ELECTION_LABEL_HEIGHT + 4 : 0;
      const resultKey = normalizeName(result.matchName || result.constituency || '');
      const aggregateType = result.aggregateType || '';
      const seatGroup = document.createElement('div');
      seatGroup.className = `election-seat-circle test2-election-seat-circle${result.syntheticNonGeographic ? ' test2-election-seat-circle--synthetic' : ''}`;
      seatGroup.tabIndex = 0;
      seatGroup.role = 'button';
      seatGroup.dataset.resultKey = resultKey;
      seatGroup.dataset.aggregateType = aggregateType;
      seatGroup.dataset.constituency = result.constituency || result.matchName || '';
      seatGroup.dataset.lng = String(center[0]);
      seatGroup.dataset.lat = String(center[1]);
      seatGroup.dataset.nonGeographic = result.syntheticNonGeographic ? 'true' : 'false';
      seatGroup.setAttribute('aria-label', `Show election result for ${result.constituency || result.matchName || 'selected constituency'}`);
      seatGroup.style.width = `${groupWidth}px`;
      seatGroup.style.height = `${groupHeight}px`;

      const inner = document.createElement('div');
      inner.className = 'seat-group';
      inner.style.position = 'relative';
      inner.style.width = `${groupWidth}px`;
      inner.style.height = `${groupHeight}px`;

      if (result.syntheticNonGeographic) {
        const label = document.createElement('div');
        label.className = 'test2-election-synthetic-label';
        label.textContent = result.featureName || result.matchName || result.constituency || 'Non-geographical constituency';
        label.title = 'Non-geographical constituency';
        label.style.position = 'absolute';
        label.style.left = '0';
        label.style.top = '0';
        label.style.width = `${groupWidth}px`;
        inner.appendChild(label);
      }

      seats.forEach((seat, indexWithinResult) => {
        const position = positions[indexWithinResult];
        if (!position) return;
        const dot = document.createElement('div');
        dot.className = 'seat-dot test2-election-seat-dot';
        dot.style.position = 'absolute';
        dot.style.left = `${dotOffsetX + position.x - minX}px`;
        dot.style.top = `${dotOffsetY + position.y - minY}px`;
        dot.style.width = `${SEAT_CIRCLE_SIZE}px`;
        dot.style.height = `${SEAT_CIRCLE_SIZE}px`;
        dot.style.background = seat.colour || this.mainPanePartyColour(seat.party || result.winnerParty || result.leadingParty);
        dot.title = `${seat.name || 'Elected candidate'} (${seat.party || result.winnerParty || result.leadingParty || 'Unknown party'})`;
        inner.appendChild(dot);
      });

      seatGroup.appendChild(inner);
      const activate = () => this.handleSeatCircleActivation(resultKey, aggregateType);
      seatGroup.addEventListener('click', activate);
      seatGroup.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });

      const marker = new maplibregl.Marker({ element: seatGroup, anchor: 'center' })
        .setLngLat(center)
        .addTo(map);
      this.seatCircleMarkers.push(marker);
      this.seatCircleOverlayState.groups.push({
        key: resultKey,
        aggregateType,
        constituency: result.constituency || result.matchName || '',
        seats: seats.length,
        lng: Number(center[0]),
        lat: Number(center[1]),
        width: groupWidth,
        height: groupHeight,
        x: projected.x,
        y: projected.y
      });
      this.seatCircleOverlayState.dotCount += seats.length;
    }
    this.lastSeatCircleRenderMs = Math.round(performance.now() - started);
  }

  ensureSeatCircleOverlay() {
    if (this.seatCircleOverlay?.isConnected) return this.seatCircleOverlay;
    const container = this.mapController?.map?.getContainer?.() || document.getElementById('map');
    if (!container) return null;
    const overlay = document.createElement('div');
    overlay.id = SEAT_OVERLAY_ID;
    overlay.className = 'test2-election-seat-overlay';
    overlay.setAttribute('aria-label', 'Election seat circles');
    container.appendChild(overlay);
    this.seatCircleOverlay = overlay;
    return overlay;
  }

  handleSeatCircleActivation(key, aggregateType = '') {
    if (aggregateType === 'council' || aggregateType === 'district') {
      this.activeLocalMode = 'district';
      this.renderPanel(null, aggregateType === 'council' ? 'council' : 'party');
      this.app.updateURLState();
      return;
    }
    const result = (this.activeBundle?.results || []).find((item) => normalizeName(item.matchName || item.constituency) === key);
    if (result) this.renderPanel(result);
  }

  removeLegacySeatCircleLayers() {
    const map = this.mapController?.map;
    if (!map) return;
    if (map.getLayer(SEAT_LAYER_ID)) map.removeLayer(SEAT_LAYER_ID);
    if (map.getLayer(SEAT_HALO_LAYER_ID)) map.removeLayer(SEAT_HALO_LAYER_ID);
    if (map.getSource(SEAT_SOURCE_ID)) map.removeSource(SEAT_SOURCE_ID);
  }

  getSeatCircleOverlayState() {
    return {
      groups: [...(this.seatCircleOverlayState?.groups || [])],
      dotCount: Number(this.seatCircleOverlayState?.dotCount || 0)
    };
  }

  async waitForSeatCircleOverlay() {
    if (this.seatCircleMarkers?.length || this.seatCircleOverlayState?.dotCount) return this.getSeatCircleOverlayState();
    await this.renderSeatCircles();
    return this.getSeatCircleOverlayState();
  }

  removeSeatCircles() {
    this.removeLegacySeatCircleLayers();
    this.removeSeatCircleMarkers();
    if (this.seatCircleOverlay) {
      this.seatCircleOverlay.remove();
      this.seatCircleOverlay = null;
    }
    this.seatCircleOverlayState = { groups: [], dotCount: 0 };
  }

  removeSeatCircleMarkers() {
    for (const marker of this.seatCircleMarkers || []) marker.remove();
    this.seatCircleMarkers = [];
  }

  async renderVoteBars() {
    if (!this.activeBundle || !this.shouldRenderElectionOverlays()) return;
    const index = await this.loadFeatureIndex();
    const centres = this.buildFeatureCentreLookup(index?.items || []);
    const features = [];
    for (const result of this.activeBundle.results || []) {
      const center = result.anchor?.center || this.findCentreForResult(centres, result);
      if (!center) continue;
      const lng = Number(center[0]);
      const lat = Number(center[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const share = Math.max(8, Math.min(80, Number(result.leadingPct || result.majorityPct || 0)));
      const lngScale = Math.max(0.35, Math.cos(lat * Math.PI / 180));
      const halfLength = (0.008 + share * 0.00055) / lngScale;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [lng - halfLength, lat],
            [lng + halfLength, lat]
          ]
        },
        properties: {
          constituency: result.constituency || result.matchName || '',
          party: result.leadingParty || result.winnerParty || '',
          colour: this.mainPanePartyColour(result.leadingParty || result.winnerParty),
          share,
          resultKey: normalizeName(result.matchName || result.constituency || '')
        }
      });
    }
    if (!features.length) return;
    const map = this.mapController.map;
    const data = { type: 'FeatureCollection', features };
    if (map.getSource(VOTE_BAR_SOURCE_ID)) {
      map.getSource(VOTE_BAR_SOURCE_ID).setData(data);
    } else {
      map.addSource(VOTE_BAR_SOURCE_ID, { type: 'geojson', data });
    }
    map.getSource(VOTE_BAR_SOURCE_ID)._data = data;
    if (!map.getLayer(VOTE_BAR_LAYER_ID)) {
      map.addLayer({
        id: VOTE_BAR_LAYER_ID,
        type: 'line',
        source: VOTE_BAR_SOURCE_ID,
        paint: {
          'line-color': ['coalesce', ['get', 'colour'], '#6b7280'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 9, 8, 12, 13],
          'line-opacity': 0.92
        },
        layout: {
          'line-cap': 'round'
        }
      });
    }
    if (!this.voteBarClickBound) {
      this.voteBarClickBound = true;
      map.on('click', VOTE_BAR_LAYER_ID, (event) => {
        const key = event.features?.[0]?.properties?.resultKey;
        const result = (this.activeBundle?.results || []).find((item) => normalizeName(item.matchName || item.constituency) === key);
        if (result) this.renderPanel(result);
      });
      map.on('mouseenter', VOTE_BAR_LAYER_ID, () => { this.mapController?.setMapCursor?.('pointer'); });
      map.on('mouseleave', VOTE_BAR_LAYER_ID, () => { this.mapController?.setMapCursor?.(''); });
    }
  }

  buildSeatCircleGroups(centres) {
    if (this.activeBundle?.bodyGroup === 'local-government' && this.activeLocalMode === 'district') {
      return this.buildLocalAggregateSeatCircleGroups(centres);
    }
    return (this.activeBundle?.results || [])
      .map((result) => this.createSeatCircleGroup(result, this.seatCandidatesForResult(result), result.anchor?.center || this.findCentreForResult(centres, result), result.anchor?.bounds || null, Number(result.anchor?.area || 0)))
      .filter(Boolean);
  }

  buildLocalAggregateSeatCircleGroups(centres) {
    const byBody = new Map();
    for (const result of this.activeBundle?.results || []) {
      const key = this.localBodyCount() > 1 ? (result.localBody || 'Unknown council') : (this.activeBundle.displayTitle || this.activeBundle.body || 'District');
      if (!byBody.has(key)) {
        byBody.set(key, {
          result: {
            constituency: key,
            matchName: key,
            localBody: key,
            aggregateType: this.localBodyCount() > 1 ? 'council' : 'district',
            winnerParty: '',
            leadingParty: ''
          },
          results: [],
          seats: [],
          bounds: null,
          centerAccumulator: { lng: 0, lat: 0, weight: 0 },
          area: 0
        });
      }
      const group = byBody.get(key);
      group.results.push(result);
      group.seats.push(...this.seatCandidatesForResult(result));
      group.bounds = mergeGeoBounds(group.bounds, result.anchor?.bounds || null);
      const center = result.anchor?.center || this.findCentreForResult(centres, result);
      const weight = Math.max(1, Number(result.anchor?.area || 1));
      if (Array.isArray(center) && center.length >= 2 && Number.isFinite(Number(center[0])) && Number.isFinite(Number(center[1]))) {
        group.centerAccumulator.lng += Number(center[0]) * weight;
        group.centerAccumulator.lat += Number(center[1]) * weight;
        group.centerAccumulator.weight += weight;
      }
      group.area += Number(result.anchor?.area || 0);
    }
    return [...byBody.values()].map((group) => {
      const summary = buildPartySummary(group.results)[0] || null;
      group.result.winnerParty = summary?.party || '';
      group.result.leadingParty = summary?.party || '';
      const center = geoBoundsCenter(group.bounds) || (group.centerAccumulator.weight
        ? [group.centerAccumulator.lng / group.centerAccumulator.weight, group.centerAccumulator.lat / group.centerAccumulator.weight]
        : null);
      return this.createSeatCircleGroup(group.result, group.seats, center, group.bounds, group.area);
    }).filter(Boolean);
  }

  createSeatCircleGroup(result, seats, center, bounds, area) {
    if (!center || !seats?.length) return null;
    const positions = seatPositions(seats.length, SEAT_CIRCLE_SPACING);
    const dotWidth = Math.max(...positions.map((point) => point.x)) - Math.min(...positions.map((point) => point.x)) + SEAT_CIRCLE_SIZE;
    const dotHeight = Math.max(...positions.map((point) => point.y)) - Math.min(...positions.map((point) => point.y)) + SEAT_CIRCLE_SIZE;
    const syntheticLabel = result.syntheticNonGeographic ? (result.featureName || result.matchName || result.constituency || '') : '';
    const syntheticLabelWidth = syntheticLabel ? Math.min(180, Math.max(72, syntheticLabel.length * 6.8 + 16)) : 0;
    const groupWidth = Math.max(dotWidth, syntheticLabelWidth);
    const groupHeight = dotHeight + (syntheticLabel ? SYNTHETIC_ELECTION_LABEL_HEIGHT + 4 : 0);
    return {
      result,
      center,
      bounds,
      seats,
      positions,
      groupWidth,
      groupHeight,
      area: Number(area || 0)
    };
  }

  bindOverlayRefresh() {
    const map = this.mapController?.map;
    if (!map || this.overlayRefreshBound) return;
    this.overlayRefreshBound = true;
    const refresh = () => this.scheduleElectionOverlayRefresh();
    const updatePositions = () => this.scheduleSeatCirclePositionUpdate();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('zoomend', refresh);
    map.on('moveend', refresh);
  }

  limitSeatCircleGroups(groups = []) {
    const limit = this.getSeatCircleGroupLimit();
    if (groups.length <= limit) return groups;
    return [...groups]
      .sort((a, b) => {
        const syntheticDelta = Number(Boolean(b.result?.syntheticNonGeographic)) - Number(Boolean(a.result?.syntheticNonGeographic));
        const seatsDelta = (b.seats?.length || 0) - (a.seats?.length || 0);
        return syntheticDelta || seatsDelta || (b.area || 0) - (a.area || 0);
      })
      .slice(0, limit);
  }

  getSeatCircleGroupLimit() {
    const width = Number(window.innerWidth || 1024);
    const memory = Number(navigator.deviceMemory || 4);
    return width < 700 || memory <= 2
      ? SEAT_CIRCLE_GROUP_LIMIT_MOBILE
      : (width < 1100 || memory <= 4 ? SEAT_CIRCLE_GROUP_LIMIT_TABLET : SEAT_CIRCLE_GROUP_LIMIT_DESKTOP);
  }

  scheduleSeatCirclePositionUpdate() {
    if (this.seatCirclePositionUpdatePending || !this.seatCircleMarkers?.length) return;
    this.seatCirclePositionUpdatePending = true;
    requestAnimationFrame(() => {
      this.seatCirclePositionUpdatePending = false;
      this.updateSeatCircleOverlayPositions();
    });
  }

  updateSeatCircleOverlayPositions() {
    const map = this.mapController?.map;
    if (!map || !this.seatCircleMarkers?.length) return this.getSeatCircleOverlayState();
    const stateByKey = new Map((this.seatCircleOverlayState?.groups || []).map((group) => [
      `${group.key || ''}|${group.aggregateType || ''}|${group.constituency || ''}`,
      group
    ]));
    for (const marker of this.seatCircleMarkers) {
      const seatGroup = marker.getElement();
      const lng = Number(seatGroup.dataset.lng);
      const lat = Number(seatGroup.dataset.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const projected = map.project([lng, lat]);
      if (!Number.isFinite(projected?.x) || !Number.isFinite(projected?.y)) continue;
      marker.setLngLat([lng, lat]);
      const key = `${seatGroup.dataset.resultKey || ''}|${seatGroup.dataset.aggregateType || ''}|${seatGroup.dataset.constituency || ''}`;
      const state = stateByKey.get(key);
      if (state) {
        state.x = projected.x;
        state.y = projected.y;
      }
    }
    return this.getSeatCircleOverlayState();
  }

  scheduleElectionOverlayRefresh() {
    if (this.overlayRefreshPending || !this.activeBundle || !this.shouldRenderElectionOverlays()) return;
    this.overlayRefreshPending = true;
    requestAnimationFrame(() => {
      this.overlayRefreshPending = false;
      if (!this.activeBundle || !this.shouldRenderElectionOverlays()) return;
      this.renderElectionOverlay().catch((error) => console.warn('[test2 elections] Overlay refresh failed', error));
    });
  }

  async filterOverlayGroupsByCollisionAsync(groups = []) {
    const fallback = () => this.limitSeatCircleGroups(this.filterOverlayGroupsByCollision(groups));
    const map = this.mapController?.map;
    if (!map || groups.length <= 1) return fallback();
    const worker = this.getOverlayWorker();
    if (!worker) return fallback();
    const projected = groups
      .map((group, index) => {
        const point = map.project(group.center);
        const bounds = projectAnchorBounds(map, group.bounds);
        return {
          index,
          x: point?.x,
          y: point?.y,
          bounds,
          width: group.groupWidth,
          height: group.groupHeight,
          pixelArea: bounds ? Math.abs(bounds.maxX - bounds.minX) * Math.abs(bounds.maxY - bounds.minY) : 0,
          seats: group.seats?.length || 0,
          area: group.area || 0,
          synthetic: Boolean(group.result?.syntheticNonGeographic)
        };
      })
      .filter((group) => Number.isFinite(group.x) && Number.isFinite(group.y));
    if (!projected.length) return [];
    const selectedIndexes = await this.runOverlayWorker(projected, {
      limit: this.getSeatCircleGroupLimit(),
      margin: SEAT_CIRCLE_COLLISION_MARGIN,
      minTotalExtent: SEAT_CIRCLE_MIN_TOTAL_EXTENT
    }).catch(() => null);
    if (!Array.isArray(selectedIndexes)) return fallback();
    return selectedIndexes.map((index) => groups[index]).filter(Boolean);
  }

  getOverlayWorker() {
    if (this.overlayWorker) return this.overlayWorker;
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker('/test2/src/overlay-worker.js', { type: 'module' });
      worker.addEventListener('message', (event) => {
        const { id, selectedIndexes } = event.data || {};
        const callback = this.overlayWorkerCallbacks.get(id);
        if (!callback) return;
        clearTimeout(callback.timer);
        this.overlayWorkerCallbacks.delete(id);
        callback.resolve(selectedIndexes || []);
      });
      worker.addEventListener('error', (event) => {
        for (const [id, callback] of this.overlayWorkerCallbacks) {
          clearTimeout(callback.timer);
          callback.reject(event.error || new Error('Election overlay worker failed'));
          this.overlayWorkerCallbacks.delete(id);
        }
        this.overlayWorker?.terminate?.();
        this.overlayWorker = null;
      });
      this.overlayWorker = worker;
      return worker;
    } catch {
      this.overlayWorker = null;
      return null;
    }
  }

  runOverlayWorker(groups, options) {
    const worker = this.getOverlayWorker();
    if (!worker) return Promise.reject(new Error('Election overlay worker unavailable'));
    const id = ++this.overlayWorkerSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.overlayWorkerCallbacks.delete(id);
        reject(new Error('Election overlay worker timed out'));
      }, 700);
      this.overlayWorkerCallbacks.set(id, { resolve, reject, timer });
      worker.postMessage({
        id,
        type: 'filterSeatCircleGroups',
        groups,
        options
      });
    });
  }

  filterOverlayGroupsByCollision(groups = []) {
    const map = this.mapController?.map;
    if (!map || groups.length <= 1) return groups;
    const projected = groups
      .map((group) => {
        const point = map.project(group.center);
        const bounds = projectAnchorBounds(map, group.bounds);
        return {
          ...group,
          point,
          bounds,
          width: group.groupWidth,
          height: group.groupHeight,
          pixelArea: bounds ? Math.abs(bounds.maxX - bounds.minX) * Math.abs(bounds.maxY - bounds.minY) : 0
        };
      })
      .filter((group) => Number.isFinite(group.point?.x) && Number.isFinite(group.point?.y));
    if (!projected.length) return [];
    const totalBounds = projected.reduce((acc, group) => mergePixelBounds(acc, group.bounds || pointPixelBounds(group.point)), null);
    if (!totalBounds
      || Math.abs(totalBounds.maxX - totalBounds.minX) < SEAT_CIRCLE_MIN_TOTAL_EXTENT
      || Math.abs(totalBounds.maxY - totalBounds.minY) < SEAT_CIRCLE_MIN_TOTAL_EXTENT) {
      return [];
    }
    const placed = [];
    const visible = [];
    for (const group of projected.sort((a, b) => {
      const syntheticDelta = Number(Boolean(b.result?.syntheticNonGeographic)) - Number(Boolean(a.result?.syntheticNonGeographic));
      return syntheticDelta || b.pixelArea - a.pixelArea;
    })) {
      const myHalfW = group.width / 2 + SEAT_CIRCLE_COLLISION_MARGIN;
      const myHalfH = group.height / 2 + SEAT_CIRCLE_COLLISION_MARGIN;
      const overlaps = placed.some((existing) => {
        const otherHalfW = existing.width / 2 + SEAT_CIRCLE_COLLISION_MARGIN;
        const otherHalfH = existing.height / 2 + SEAT_CIRCLE_COLLISION_MARGIN;
        return Math.abs(group.point.x - existing.point.x) < (myHalfW + otherHalfW)
          && Math.abs(group.point.y - existing.point.y) < (myHalfH + otherHalfH);
      });
      if (overlaps) continue;
      placed.push(group);
      visible.push(group);
    }
    return visible;
  }

  removeVoteBars() {
    const map = this.mapController?.map;
    if (!map) return;
    if (map.getLayer(VOTE_BAR_LAYER_ID)) map.removeLayer(VOTE_BAR_LAYER_ID);
    if (map.getSource(VOTE_BAR_SOURCE_ID)) map.removeSource(VOTE_BAR_SOURCE_ID);
  }

  async renderRecallLabels() {
    if (!this.activeBundle || !this.shouldRenderRecallLabels()) return;
    const index = await this.loadFeatureIndex();
    const centres = this.buildFeatureCentreLookup(index?.items || []);
    const features = [];
    for (const result of this.activeBundle.results || []) {
      const center = result.anchor?.center || this.findCentreForResult(centres, result);
      if (!center) continue;
      const triggered = recallTriggered(result);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: center },
        properties: {
          label: result.recallPetition?.outcome || (triggered ? 'By-election triggered' : 'Petition not successful'),
          resultKey: normalizeName(result.matchName || result.constituency || '')
        }
      });
    }
    if (!features.length) return;
    const map = this.mapController.map;
    const data = { type: 'FeatureCollection', features };
    if (map.getSource(RECALL_LABEL_SOURCE_ID)) {
      map.getSource(RECALL_LABEL_SOURCE_ID).setData(data);
    } else {
      map.addSource(RECALL_LABEL_SOURCE_ID, { type: 'geojson', data });
    }
    map.getSource(RECALL_LABEL_SOURCE_ID)._data = data;
    if (!map.getLayer(RECALL_LABEL_LAYER_ID)) {
      map.addLayer({
        id: RECALL_LABEL_LAYER_ID,
        type: 'symbol',
        source: RECALL_LABEL_SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 9, 13, 12, 15],
          'text-anchor': 'center',
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2
        }
      });
    }
    if (!this.recallLabelClickBound) {
      this.recallLabelClickBound = true;
      map.on('click', RECALL_LABEL_LAYER_ID, (event) => {
        const key = event.features?.[0]?.properties?.resultKey;
        const result = (this.activeBundle?.results || []).find((item) => normalizeName(item.matchName || item.constituency) === key);
        if (result) this.renderPanel(result);
      });
      map.on('mouseenter', RECALL_LABEL_LAYER_ID, () => { this.mapController?.setMapCursor?.('pointer'); });
      map.on('mouseleave', RECALL_LABEL_LAYER_ID, () => { this.mapController?.setMapCursor?.(''); });
    }
  }

  removeRecallLabels() {
    const map = this.mapController?.map;
    if (!map) return;
    if (map.getLayer(RECALL_LABEL_LAYER_ID)) map.removeLayer(RECALL_LABEL_LAYER_ID);
    if (map.getSource(RECALL_LABEL_SOURCE_ID)) map.removeSource(RECALL_LABEL_SOURCE_ID);
  }

  shouldRenderElectionOverlays() {
    const body = normalizeName(this.activeBundle?.body || this.activeEntry?.body || '');
    const type = normalizeName(this.activeBundle?.type || this.activeEntry?.type || '');
    return !body.includes('referendum') && !body.includes('recall petition') && !type.includes('referendum') && !type.includes('recall');
  }

  shouldRenderRecallLabels() {
    const body = normalizeName(this.activeBundle?.body || this.activeEntry?.body || '');
    const type = normalizeName(this.activeBundle?.type || this.activeEntry?.type || '');
    return body.includes('recall petition') || type.includes('recall') || Boolean((this.activeBundle?.results || []).some((result) => result.recallPetition));
  }

  shouldRenderSeatCircles() {
    return this.shouldRenderElectionOverlays();
  }

  async loadFeatureIndex() {
    return this.loadFeatureIndexForBundle(this.activeBundle);
  }

  async loadFeatureIndexForBundle(bundle) {
    if (!bundle) return null;
    const layer = this.app.metadataService.getLayer(bundle.layerId)
      || this.app.metadataService.getLayer(bundle.sourceMapId);
    const url = layer?.featureIndexUrl;
    if (!url) return null;
    if (this.featureIndexCache.has(url)) return this.featureIndexCache.get(url);
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) return null;
    const raw = await response.json();
    const index = {
      ...raw,
      items: raw.items || raw.features || (Array.isArray(raw) ? raw : [])
    };
    rememberLimitedCache(this.featureIndexCache, url, index, ELECTION_FEATURE_INDEX_CACHE_LIMIT);
    return index;
  }

  buildFeatureCentreLookup(items) {
    const centres = new Map();
    for (const item of items) {
      const center = Array.isArray(item.center) ? item.center : null;
      if (!center || center.length < 2) continue;
      for (const key of [item.name, item.label, item.title, ...(item.aliases || [])].map(normalizeName).filter(Boolean)) {
        if (!centres.has(key)) centres.set(key, center);
      }
    }
    return centres;
  }

  findCentreForResult(centres, result) {
    for (const key of resultKeys(result)) {
      const center = centres.get(key);
      if (center) return center;
    }
    return null;
  }

  seatCandidatesForResult(result) {
    if (!this.shouldRenderElectionOverlays()) return [];
    const elected = extractElected(result);
    if (elected.length) return elected;
    if (Number(result.seatsTotal) === 1 || Number(result.seatsWon) === 1) {
      const winner = (result.candidates || []).find((candidate) => normalizeName(candidate.name) === normalizeName(result.winnerName))
        || (result.candidates || [])[0];
      return [{
        name: result.winnerName || winner?.name || result.leadingName || '',
        party: result.winnerParty || winner?.party || result.leadingParty || '',
        colour: this.mainPanePartyColour(result.winnerParty || winner?.party || result.leadingParty)
      }];
    }
    const seatCount = Math.max(0, Number(result.seatsWon || result.seatsTotal || 0));
    return Array.from({ length: seatCount }, (_, index) => ({
      name: index === 0 ? (result.winnerName || result.leadingName || '') : '',
      party: result.winnerParty || result.leadingParty || '',
      colour: this.mainPanePartyColour(result.winnerParty || result.leadingParty)
    }));
  }

  updateElectionTimeline() {
    if (!this.activeEntry || !this.catalogue?.elections) return;
    const entries = this.catalogue.elections
      .filter((entry) => entry.loadable && entry.body === this.activeEntry.body)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const activeIndex = entries.findIndex((entry) => entry.body === this.activeEntry.body && entry.date === this.activeEntry.date);
    this.app.setTimelineItems(entries.map((entry) => ({
      label: entry.date,
      body: entry.body,
      date: entry.date
    })), activeIndex >= 0 ? activeIndex : entries.length - 1, async (item) => {
      await this.loadElection(item.body, item.date);
    });
  }

  findEntry(body, date) {
    return (this.catalogue?.elections || []).find((entry) => entry.body === body && entry.date === date) || null;
  }

  getCanonicalLayerId(entry = this.activeEntry) {
    if (!entry?.body || !entry?.date) return '';
    return `election-${mainElectionSlug(entry.body)}-${entry.date}`;
  }

  findEntryByCanonicalLayerId(layerId) {
    if (!layerId) return null;
    return (this.catalogue?.elections || []).find((entry) => this.getCanonicalLayerId(entry) === layerId) || null;
  }

  isCanonicalElectionLayerId(layerId) {
    return Boolean(this.findEntryByCanonicalLayerId(layerId));
  }
}

function mainElectionSlug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-');
}

function resultKeys(result) {
  return [
    result.matchName,
    result.featureName,
    result.constituency,
    ...(result.featureAliases || []),
    ...(result.featureNames || []),
    ...((result.featureMatches || []).flatMap((match) => [
      match?.name,
      ...(match?.aliases || [])
    ]))
  ].map(normalizeName).filter(Boolean);
}

function resultFeatureLabels(result) {
  const labels = [];
  for (const match of result.featureMatches || []) {
    labels.push(match?.name, ...(match?.aliases || []));
  }
  labels.push(result.matchName, result.featureName, ...(result.featureNames || []), ...(result.featureAliases || []));
  const seen = new Set();
  return labels
    .map((label) => String(label || '').trim())
    .filter((label) => {
      const key = normalizeName(label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isMainStyleCandidateRow(row = {}) {
  const candidateId = String(row.Candidate_Id || '').trim();
  if (!candidateId || candidateId.toLowerCase() === 'nontransferable') return false;
  const candidateName = mainStyleCandidateDisplayName(row);
  if (!candidateName) return false;
  if (candidateName.toLowerCase() === 'party') return false;
  const party = String(row.Party_Name || '').trim().toLowerCase();
  if (party === 'party') return false;
  return true;
}

function mainStyleCandidateDisplayName(row = {}) {
  return String(
    row.candidateName
    || `${row.Firstname || ''} ${row.Surname || ''}`.trim()
    || ''
  )
    .replace(/[�]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function selectedPaneStatusKind(status) {
  const text = String(status || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('not elected')) return 'not_elected';
  if (text.includes('excluded')) return 'excluded';
  if (text.includes('elected') || text.includes('made quota') || text.includes('counted as elected') || text.includes('deemed elected')) return 'elected';
  return 'unknown';
}

function sumNumbers(results, key) {
  return results.reduce((sum, result) => {
    const value = Number(result?.[key]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function averageNumbers(results, key) {
  const values = results
    .map((result) => Number(result?.[key]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildLocalPartySummary(results = []) {
  const rows = [];
  for (const result of results) {
    const byParty = new Map();
    const validPoll = Number(result.validPoll || result.totalVotes || 0);
    for (const candidate of result.candidates || []) {
      const party = candidate.party || 'Independent/Other';
      const key = normalizeName(party) || party;
      if (!byParty.has(key)) {
        byParty.set(key, {
          party,
          constituency: result.constituency || result.matchName || '',
          resultKey: normalizeName(result.matchName || result.constituency || ''),
          colour: candidate.colour || electionPartyColour(party) || partyColour(party),
          stood: 0,
          seats: 0,
          firstPrefs: 0,
          seatShare: null,
          share: null
        });
      }
      const row = byParty.get(key);
      row.stood += 1;
      row.firstPrefs += Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0;
      if (candidate.elected) row.seats += 1;
    }
    for (const row of byParty.values()) {
      row.seatShare = Number(result.seatsTotal) ? row.seats / Number(result.seatsTotal) * 100 : null;
      row.share = validPoll ? row.firstPrefs / validPoll * 100 : null;
      rows.push(row);
    }
  }
  return rows.sort((a, b) =>
    numberOrZero(b.share) - numberOrZero(a.share)
    || numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs)
    || String(a.party).localeCompare(String(b.party))
    || String(a.constituency).localeCompare(String(b.constituency))
  );
}

function buildCouncilSummary(results = []) {
  const councils = new Map();
  for (const result of results) {
    const council = result.localBody || 'Unknown council';
    if (!councils.has(council)) {
      councils.set(council, {
        council,
        deas: 0,
        seats: 0,
        validPoll: 0,
        electorate: 0,
        partySeats: new Map(),
        partyVotes: new Map(),
        partyColours: new Map()
      });
    }
    const row = councils.get(council);
    row.deas += 1;
    row.seats += Number(result.seatsWon ?? result.seatsTotal ?? 0) || 0;
    row.validPoll += Number(result.validPoll || result.totalVotes || 0) || 0;
    row.electorate += Number(result.electorate || 0) || 0;
    for (const candidate of result.candidates || []) {
      const party = candidate.party || 'Independent/Other';
      row.partyVotes.set(party, (row.partyVotes.get(party) || 0) + (Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0));
      if (candidate.colour && !row.partyColours.has(party)) row.partyColours.set(party, candidate.colour);
      if (candidate.elected) row.partySeats.set(party, (row.partySeats.get(party) || 0) + 1);
    }
  }
  return [...councils.values()].map((row) => {
    const leading = [...row.partySeats.entries()].sort((a, b) => b[1] - a[1] || (row.partyVotes.get(b[0]) || 0) - (row.partyVotes.get(a[0]) || 0))[0]
      || [...row.partyVotes.entries()].sort((a, b) => b[1] - a[1])[0]
      || ['', 0];
    return {
      ...row,
      leadingParty: leading[0],
      colour: row.partyColours.get(leading[0]) || partyColour(leading[0]),
      share: row.validPoll ? (row.partyVotes.get(leading[0]) || 0) / row.validPoll * 100 : null,
      turnoutPct: row.electorate ? row.validPoll / row.electorate * 100 : null
    };
  }).sort((a, b) => String(a.council).localeCompare(String(b.council)));
}

function offsetSeatByPixels(map, center, pixelOffset) {
  const lng = Number(center?.[0]);
  const lat = Number(center?.[1]);
  if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return [lng, lat];
  const projected = map.project([lng, lat]);
  const unprojected = map.unproject([
    projected.x + Number(pixelOffset?.x || 0),
    projected.y + Number(pixelOffset?.y || 0)
  ]);
  return [unprojected.lng, unprojected.lat];
}

function projectAnchorBounds(map, bounds) {
  const west = Number(bounds?.west);
  const south = Number(bounds?.south);
  const east = Number(bounds?.east);
  const north = Number(bounds?.north);
  if (!map || ![west, south, east, north].every(Number.isFinite)) return null;
  const ne = map.project([east, north]);
  const sw = map.project([west, south]);
  return {
    minX: Math.min(ne.x, sw.x),
    maxX: Math.max(ne.x, sw.x),
    minY: Math.min(ne.y, sw.y),
    maxY: Math.max(ne.y, sw.y)
  };
}

function mergeGeoBounds(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  const west = Math.min(Number(a.west), Number(b.west));
  const south = Math.min(Number(a.south), Number(b.south));
  const east = Math.max(Number(a.east), Number(b.east));
  const north = Math.max(Number(a.north), Number(b.north));
  if (![west, south, east, north].every(Number.isFinite)) return a || b || null;
  return { west, south, east, north };
}

function geoBoundsCenter(bounds) {
  const west = Number(bounds?.west);
  const south = Number(bounds?.south);
  const east = Number(bounds?.east);
  const north = Number(bounds?.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return [(west + east) / 2, (south + north) / 2];
}

function pointPixelBounds(point) {
  return {
    minX: point.x,
    maxX: point.x,
    minY: point.y,
    maxY: point.y
  };
}

function mergePixelBounds(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function ensureElectionAnimationRuntime() {
  if (typeof window.$?.preloadElectionData === 'function' && typeof window.animateStages === 'function') {
    return Promise.resolve();
  }
  if (!electionAnimationRuntimePromise) {
    const scripts = [
      '/test2/js/jquery-shim.js',
      '/test2/election-viewer-package/js/stages2.js?v=2',
      '/test2/election-viewer-package/js/animation_preview.js',
      '/test2/election-viewer-package/js/animation_preview_manager.js',
      '/test2/election-viewer-package/js/election_viewer.js'
    ];
    electionAnimationRuntimePromise = scripts.reduce(
      (promise, src) => promise.then(() => loadScriptOnce(src)),
      Promise.resolve()
    );
  }
  return electionAnimationRuntimePromise;
}

function loadScriptOnce(src) {
  const existing = [...document.querySelectorAll('script[data-test2-runtime-src]')]
    .find((script) => script.dataset.test2RuntimeSrc === src);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.dataset.test2RuntimeSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(src));
    document.head.appendChild(script);
  });
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rememberLimitedCache(cache, key, value, limit) {
  if (!cache || !key) return value;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  return value;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/[-_/.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function partyColour(value) {
  return PARTY_COLOURS.get(normalizeName(value)) || '#6b7280';
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(number) ? number : null;
}

function isStvResult(result = {}) {
  const votingSystem = normalizeName(result.votingSystem || result.electionVotingSystem || result.system || '');
  if (votingSystem.includes('stv')) return true;
  const quota = finiteNumber(result.quota ?? result.Quota ?? result.countInfo?.Quota);
  return quota !== null && Array.isArray(result.countNumbers) && result.countNumbers.some((count) => Number(count) > 1);
}

function buildStvTransferContext(result = {}, candidates = [], countNumbers = []) {
  const explicitNonTransferable = new Map((result.nonTransferable || []).map((row) => [Number(row.count), row]));
  const nonTransferable = new Map();
  const transferDenominators = new Map();
  let runningNonTransferableTotal = 0;
  for (const count of countNumbers.map(Number).filter(Number.isFinite).sort((a, b) => a - b)) {
    const explicitRow = explicitNonTransferable.get(count);
    let candidateTransferSum = 0;
    let positiveRecipientTransfers = 0;
    for (const candidate of candidates || []) {
      const row = (candidate.counts || []).find((entry) => Number(entry.count) === count);
      const transfer = finiteNumber(row?.transfers);
      if (transfer === null) continue;
      candidateTransferSum += transfer;
      if (transfer > 0) positiveRecipientTransfers += transfer;
    }
    let nonTransferableTransfer = finiteNumber(explicitRow?.transfers);
    if (nonTransferableTransfer === null && count > 1) {
      const inferred = -candidateTransferSum;
      nonTransferableTransfer = inferred > 0.0001 ? inferred : 0;
    }
    let nonTransferableTotal = finiteNumber(explicitRow?.total);
    if (nonTransferableTotal === null) {
      nonTransferableTotal = count <= 1
        ? 0
        : runningNonTransferableTotal + Math.max(0, nonTransferableTransfer || 0);
    }
    runningNonTransferableTotal = nonTransferableTotal;
    nonTransferable.set(count, {
      count,
      total: nonTransferableTotal,
      transfers: nonTransferableTransfer || 0,
      inferred: !explicitRow
    });
    transferDenominators.set(count, positiveRecipientTransfers + Math.max(0, nonTransferableTransfer || 0));
  }
  return { nonTransferable, transferDenominators };
}

function formatTransferShare(transfer, denominator) {
  const transferValue = finiteNumber(transfer);
  const denominatorValue = finiteNumber(denominator);
  if (transferValue === null || transferValue <= 0 || denominatorValue === null || denominatorValue <= 0) return '-';
  return formatMainPercentDelta((transferValue / denominatorValue) * 100);
}

function quotaHoldStartCount(candidate = {}, counts = new Map(), result = {}) {
  const quota = finiteNumber(result.quota ?? result.Quota ?? result.countInfo?.Quota ?? candidate.quota);
  if (quota === null || quota <= 0) return null;
  const rows = [...counts.values()]
    .map((row) => ({ ...row, count: Number(row.count) }))
    .filter((row) => Number.isFinite(row.count))
    .sort((a, b) => a.count - b.count);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const total = finiteNumber(row.total ?? row.firstPrefs);
    if (total === null || Math.abs(total - quota) > 0.5) continue;
    if (candidate.electedAt && row.count < Number(candidate.electedAt)) continue;
    const previousTotal = finiteNumber(rows[index - 1]?.total ?? rows[index - 1]?.firstPrefs);
    const wasReducedToQuota = previousTotal !== null && previousTotal > quota + 0.5 && finiteNumber(row.transfers) !== null && finiteNumber(row.transfers) < -0.5;
    const laterHeldAtQuota = rows.some((later) => later.count > row.count && Math.abs((finiteNumber(later.total ?? later.firstPrefs) ?? Number.POSITIVE_INFINITY) - quota) <= 0.5);
    if (wasReducedToQuota || laterHeldAtQuota || candidate.elected) return row.count;
  }
  return null;
}

function shouldDashQuotaHeldCount(count, quotaHoldCount) {
  return quotaHoldCount !== null && quotaHoldCount !== undefined && Number(count) > Number(quotaHoldCount);
}

function numericColour(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '#9ca3af';
  const t = Math.max(0, Math.min(1, (number - min) / (max - min || 1)));
  if (t < 0.2) return '#fef3c7';
  if (t < 0.4) return '#fde68a';
  if (t < 0.6) return '#f59e0b';
  if (t < 0.8) return '#d97706';
  return '#92400e';
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2).replace(/\.00$/, '')}%` : String(value);
}

function formatSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 0 ? '+' : ''}${number.toLocaleString()}`;
}

function formatSignedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 0 ? '+' : ''}${number.toFixed(2).replace(/\.00$/, '')}%`;
}

function formatDeltaPair(primary, secondary) {
  const parts = [];
  const primaryText = formatSigned(primary);
  const secondaryText = formatSigned(secondary);
  if (primaryText) parts.push(primaryText);
  if (secondaryText) parts.push(secondaryText);
  return parts.join(' / ');
}

function formatFixedPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : '';
}

function formatMainDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const className = number > 0 ? 'election-delta election-delta--pos' : number < 0 ? 'election-delta election-delta--neg' : 'election-delta';
  return `<span class="${className}">${number > 0 ? '+' : ''}${number.toLocaleString('en-GB')}</span>`;
}

function formatMainPercentDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const className = number > 0 ? 'election-delta election-delta--pos' : number < 0 ? 'election-delta election-delta--neg' : 'election-delta';
  return `<span class="${className}">${number > 0 ? '+' : ''}${number.toFixed(2)}%</span>`;
}

function formatMainSelectedPercentDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const className = number > 0 ? 'election-delta election-delta--pos' : number < 0 ? 'election-delta election-delta--neg' : 'election-delta';
  return `<span class="${className}">${number > 0 ? '+' : ''}${number.toFixed(2)}</span>`;
}

function rankLabel(index) {
  const n = Number(index) + 1;
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function shortElectionBody(name) {
  const value = String(name || '');
  const map = new Map([
    ['Dáil Éireann', 'Dáil'],
    ['DÃ¡il Ã‰ireann', 'Dáil'],
    ['House of Commons of the United Kingdom', 'Westminster'],
    ['Northern Ireland Assembly', 'Assembly'],
    ['Northern Ireland Constitutional Convention', 'Convention'],
    ['Northern Ireland Forum for Political Dialogue', 'Forum'],
    ['European Parliament (Ireland)', 'European (Republic of Ireland)'],
    ['European Parliament', 'European'],
    ['President of Ireland', 'President'],
    ['Referendum (Ireland)', 'Referendum']
  ]);
  return map.get(value) || value;
}

function formatElectionDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value || '');
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function inferCountEvents(candidates = [], countNumbers = []) {
  const events = [];
  for (const count of countNumbers) {
    const elected = [];
    const excluded = [];
    for (const candidate of candidates) {
      const row = (candidate.counts || []).find((item) => Number(item.count) === Number(count));
      const status = normalizeName(row?.status || '');
      if (/not elected/.test(status)) continue;
      if (/elected|quota/.test(status) && Number(candidate.electedAt) === Number(count)) elected.push(candidate.name);
      if (/excluded|eliminated/.test(status) && Number(candidate.excludedAt) === Number(count)) excluded.push(candidate.name);
    }
    const labels = [];
    if (elected.length) labels.push(`${elected.length === 1 ? elected[0] : `${elected.length} candidates`} elected`);
    if (excluded.length) labels.push(`${excluded.length === 1 ? excluded[0] : `${excluded.length} candidates`} excluded`);
    if (labels.length) events.push({ count: Number(count), label: labels.join('; ') });
  }
  return events;
}

function recallTriggered(result = {}) {
  const petition = result.recallPetition || {};
  if (typeof petition.triggered === 'boolean') return petition.triggered;
  const signed = Number(petition.signed ?? petition.signatures ?? result.leadingVotes);
  const threshold = Number(petition.threshold ?? petition.required);
  return Number.isFinite(signed) && Number.isFinite(threshold) ? signed >= threshold : false;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
