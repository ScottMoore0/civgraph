import {
  buildRepairedLabelValueExpression,
  repairFeatureProperties
} from '../../test/src/feature-property-repairs.js';
import {
  createElectionRenderer,
  numericColour as sharedNumericColour
} from '../../js/election-renderer.mjs';
import {
  buildCandidateSummary,
  buildEntityIndex,
  buildPartySummary,
  compareResults,
  extractElected,
  partyColour as electionPartyColour,
  seatPositions
} from '../../js/election-domain.mjs';

const ELECTION_MANIFEST_URL = '/test/metadata/elections-test2.json?v=test-020';
const DEFAULT_MODE_ORDER = ['winner', 'leadingParty', 'voteShare', 'turnout', 'majority', 'seats', 'quota'];
const SEAT_SOURCE_ID = 'test2-election-seat-source';
const SEAT_HALO_LAYER_ID = 'test2-election-seat-halo-layer';
const SEAT_LAYER_ID = 'test2-election-seat-layer';
const VOTE_BAR_SOURCE_ID = 'test2-election-vote-bar-source';
const VOTE_BAR_LAYER_ID = 'test2-election-vote-bar-layer';
const RECALL_LABEL_SOURCE_ID = 'test2-election-recall-label-source';
const RECALL_LABEL_LAYER_ID = 'test2-election-recall-label-layer';
const SEAT_CIRCLE_SIZE = 12;
const SEAT_CIRCLE_SPACING = SEAT_CIRCLE_SIZE + 1;

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
  ['green', '#8dc63f'],
  ['independent', '#b8b8b8'],
  ['irish labour', '#cc0000'],
  ['labour', '#cc0000'],
  ['pbp', '#e91d50'],
  ['sdlp', '#2aa82c'],
  ['sinn fein', '#326760'],
  ['social democrats', '#752f8a'],
  ['solidarity pbp', '#e91d50'],
  ['solidarity-pbp', '#e91d50'],
  ['tuv', '#0c3a6a'],
  ['uup', '#48a5ee'],
  ['yes', '#2aa82c'],
  ['no', '#d46a4c']
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
    this.voteBarClickBound = false;
    this.recallLabelClickBound = false;
    this.overlayRefreshBound = false;
    this.loadSerial = 0;
    this.sharedRenderer = createElectionRenderer(this);
  }

  async load() {
    const response = await fetch(ELECTION_MANIFEST_URL, { cache: 'no-cache' });
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
    this.applyActiveStyle();
    this.renderPanel();
    await nextFrame();
    await this.renderElectionOverlay();
    this.updateElectionTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    this.app.focusActiveElectionCatalogueEntry?.(entry, { scroll: true });
    this.app.updateURLState();
  }

  unloadElection() {
    if (this.activeEntry?.sourceMapId) this.mapController.clearElectionStyle?.(this.activeEntry.sourceMapId);
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
    this.app.updateTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    this.app.updateURLState();
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
    this.countDetailedView = params.get('electionCountDetail') === '1';
    const selected = params.get('electionSelected');
    const view = params.get('electionView') || this.activePanelView || 'party';
    const selectedResult = selected ? this.findResultByKey(selected) : null;
    await this.renderElectionOverlay();
    this.renderPanel(selectedResult, view);
    const entityKind = params.get('electionEntityKind');
    const entityKey = params.get('electionEntityKey');
    if (entityKind && entityKey) {
      this.activeEntityReturnView = params.get('electionEntityReturnView') || view || 'party';
      this.renderEntityPanel(entityKind, entityKey, { updateURL: false });
    }
    this.app.focusActiveElectionCatalogueEntry?.(this.activeEntry, { scroll: true });
  }

  async loadBundle(entry) {
    if (this.bundleCache.has(entry.key)) return this.bundleCache.get(entry.key);
    const response = await fetch(`${entry.resultUrl}?v=test-020`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Failed to load election results for ${entry.body} ${entry.date}: ${response.status}`);
    const bundle = await response.json();
    this.bundleCache.set(entry.key, bundle);
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
    const fillColorExpression = this.buildColourExpression(
      this.activeMode,
      MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedFillColor
    );
    const isPointGeometry = this.activeBundle.geometryType === 'point';
    this.mapController.applyElectionStyle?.(this.activeEntry.sourceMapId, {
      mode: this.activeMode,
      fillColorExpression,
      lineColorExpression: isPointGeometry
        ? fillColorExpression
        : this.buildElectionMatchExpression(
          () => MAIN_ELECTION_GEOGRAPHY_STYLE.matchedStrokeColor,
          MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedStrokeColor
        ),
      fillOpacityExpression: isPointGeometry
        ? undefined
        : this.buildElectionMatchExpression(
          () => MAIN_ELECTION_GEOGRAPHY_STYLE.matchedFillOpacity,
          MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedFillOpacity
        ),
      lineOpacity: isPointGeometry ? undefined : MAIN_ELECTION_GEOGRAPHY_STYLE.strokeOpacity,
      lineWidth: isPointGeometry ? undefined : MAIN_ELECTION_GEOGRAPHY_STYLE.strokeWidth,
      labelMinZoomOverride: 7.35
    });
    this.renderLegend();
  }

  buildElectionMatchInput() {
    return buildRepairedLabelValueExpression({
      id: this.activeBundle.layerId,
      sourceMapId: this.activeBundle.sourceMapId,
      labelProperty: this.activeBundle.labelProperty
    }, ['to-string', ['get', this.activeBundle.labelProperty || 'name']]);
  }

  buildElectionMatchExpression(valueForResult, fallback) {
    const labels = [];
    const seen = new Set();
    for (const result of this.activeBundle.results || []) {
      if (!result.matched || !result.matchName) continue;
      const label = String(result.matchName);
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label, valueForResult(result));
    }
    if (!labels.length) return fallback;
    return ['match', ['to-string', this.buildElectionMatchInput()], ...labels, fallback];
  }

  buildColourExpression(mode, fallback = MAIN_ELECTION_GEOGRAPHY_STYLE.unmatchedFillColor) {
    return this.buildElectionMatchExpression(
      (result) => this.colourForMode(mode, result),
      fallback
    );
  }

  colourForMode(mode, result) {
    if (mode === 'winner') return partyColour(result.winnerParty) || result.colour || '#6b7280';
    if (mode === 'leadingParty') return partyColour(result.leadingParty) || result.leadingColour || '#6b7280';
    if (mode === 'turnout') return sharedNumericColour(result.turnoutPct, 35, 80);
    if (mode === 'voteShare') return sharedNumericColour(result.leadingPct, 10, 70);
    if (mode === 'majority') return sharedNumericColour(result.majorityPct, 0, 45);
    if (mode === 'seats') return sharedNumericColour(result.seatsWon ?? result.seatsTotal, 1, 6);
    if (mode === 'quota') return sharedNumericColour(result.quota, 1_000, 120_000);
    return '#6b7280';
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
    const electionTitle = this.formatPaneElectionTitle();
    title.textContent = selectedResult?.constituency
      ? `${selectedResult.constituency}${selectedResult.localBody ? ` (${selectedResult.localBody})` : ''} - ${electionTitle}`
      : electionTitle;
    back?.classList.toggle('hidden', !selectedResult);
    const headerRight = pane.querySelector('.election-pane__header-right');
    if (headerRight) {
      const localModeControl = !selectedResult && this.isLocalGovernmentElection() ? `
        <div class="test2-election-local-mode" role="group" aria-label="Local government result level">
          <button type="button" class="${this.activeLocalMode === 'dea' ? 'is-active' : ''}" data-election-local-mode="dea">DEA</button>
          <button type="button" class="${this.activeLocalMode === 'district' ? 'is-active' : ''}" data-election-local-mode="district">${this.localBodyCount() > 1 ? 'Council' : 'District'}</button>
        </div>
      ` : '';
      const headerTabs = selectedResult
        ? [
          ['party', 'By Party'],
          ['counts', 'By Count'],
          ['animation', 'Transfers']
        ]
        : [
          ['party', 'By Party'],
          ['candidate', 'By Candidate'],
          ['local-party', 'By Local Party']
        ];
      headerRight.innerHTML = `
        ${localModeControl}
        ${headerTabs.map(([id, label]) => `<button type="button" class="election-view-tab${id === nextView ? ' election-view-tab--active' : ''}" data-election-view="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}
        <button type="button" id="electionCloseBtn" class="election-pane__close" aria-label="Unload election">&#10005;</button>
      `;
    }
    content.innerHTML = selectedResult
      ? this.renderConstituencyResults(selectedResult, nextView)
      : this.renderOverallResults(nextView);
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
      button.addEventListener('click', () => {
        this.activeLocalMode = button.dataset.electionLocalMode === 'district' ? 'district' : 'dea';
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
      button.addEventListener('click', () => {
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
    this.renderLegend();
    this.setupResultsTableControls(pane);
  }

  renderOverallResults(view = 'party') {
    const results = this.currentResults();
    if (results.some((result) => result.recallPetition)) return this.renderRecallPetitionOverview(results);
    if (this.isLocalGovernmentElection() && this.activeLocalMode === 'district') {
      return this.renderDistrictResults(view);
    }
    const rows = this.activeBundle.mainLikePartySummary?.length
      ? this.activeBundle.mainLikePartySummary
      : (this.activeBundle.partySummary?.length ? this.activeBundle.partySummary : buildPartySummary(results));
    const rowsWithDeltas = this.withPartyDeltas(rows, { mainLike: Boolean(this.activeBundle.mainLikePartySummary?.length) });
    const candidates = buildCandidateSummary(results);
    return `
      <section class="test2-election-panel test2-election-panel--main-parity" aria-label="Election results summary" data-election-renderer="test2-main-parity">
        ${this.renderDataCoverageNotice()}
        ${view === 'candidate' ? this.renderCandidateSummaryTable(candidates) : view === 'local-party' ? this.renderLocalPartySummaryTable(results) : this.renderMainParityPartyTable(rowsWithDeltas, results)}
        ${this.renderMapDisplayControls()}
      </section>
    `;
  }

  renderConstituencyResults(result, view = 'party') {
    if (result.recallPetition) return this.renderRecallPetitionResult(result);
    const candidates = [...(result.candidates || [])].sort((a, b) => {
      const elected = Number(Boolean(b.elected)) - Number(Boolean(a.elected));
      if (elected) return elected;
      return Number(b.finalVotes ?? b.firstPrefs ?? b.votes ?? 0) - Number(a.finalVotes ?? a.firstPrefs ?? a.votes ?? 0);
    });
    const areaLabel = this.isLocalGovernmentElection() ? 'DEA' : 'Constituency';
    return `
      <section class="test2-election-panel" aria-label="${escapeHtml(result.constituency)} results">
        <dl class="test2-election-panel__stats">
          <div><dt>${areaLabel}</dt><dd>${escapeHtml(result.constituency || '')}</dd></div>
          ${this.isLocalGovernmentElection() && result.localBody ? `<div><dt>Council</dt><dd>${escapeHtml(result.localBody)}</dd></div>` : ''}
          ${result.seatsTotal ? `<div><dt>Seats</dt><dd>${formatNumber(result.seatsTotal)}</dd></div>` : ''}
          ${result.validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(result.validPoll)}</dd></div>` : ''}
          ${result.turnoutPct ? `<div><dt>Turnout</dt><dd>${formatPercent(result.turnoutPct)}</dd></div>` : ''}
          ${result.quota ? `<div><dt>Quota</dt><dd>${formatNumber(result.quota)}</dd></div>` : ''}
          ${result.previous ? `<div><dt>Previous winner</dt><dd>${escapeHtml(result.previous.winnerParty || result.previous.leadingParty || '')}</dd></div>` : ''}
          ${result.deltas?.turnoutPct !== null && result.deltas?.turnoutPct !== undefined ? `<div><dt>Turnout change</dt><dd>${formatSignedPercent(result.deltas.turnoutPct)}</dd></div>` : ''}
        </dl>
        ${view === 'counts' ? this.renderCountTable(result, candidates) : view === 'animation' ? this.renderAnimationNotice(result) : view === 'party' ? this.renderConstituencyPartyTable(candidates, result) : this.renderConstituencyCandidateTable(candidates, result)}
      </section>
    `;
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
          <table class="election-party-table election-party-table--grouped election-results-table--fixed">
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
                    <td><button type="button" class="election-entity-link election-cell-wrap" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="election-party-dot" style="background:${escapeHtml(row.colour || partyColour(row.party))}"></span>${escapeHtml(row.party)}</button></td>
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
                  <td>${this.renderElectionEntityButton('party', normalizeName(candidate.party), `<span class="election-party-dot" style="background:${escapeHtml(candidate.colour || electionPartyColour(candidate.party) || partyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}`, 'election-cell-wrap')}</td>
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
    const validPoll = numberOrZero(result.validPoll) || candidates.reduce((sum, candidate) => sum + numberOrZero(candidate.firstPrefs ?? candidate.votes), 0);
    const byParty = new Map();
    for (const candidate of candidates) {
      const party = candidate.party || 'Independent/Other';
      const key = normalizeName(party) || party;
      if (!byParty.has(key)) {
        byParty.set(key, {
          party,
          colour: candidate.colour || electionPartyColour(party) || partyColour(party),
          stood: 0,
          seats: 0,
          firstPrefs: 0
        });
      }
      const row = byParty.get(key);
      row.stood += 1;
      row.seats += candidate.elected ? 1 : 0;
      row.firstPrefs += numberOrZero(candidate.firstPrefs ?? candidate.votes);
    }
    const rows = [...byParty.values()].sort((a, b) => {
      if (b.seats !== a.seats) return b.seats - a.seats;
      if (b.firstPrefs !== a.firstPrefs) return b.firstPrefs - a.firstPrefs;
      return a.party.localeCompare(b.party);
    });
    return `
      <div class="election-party-wrapper election-party-wrapper--pane-sticky">
        <table class="election-party-table election-party-table--grouped election-results-table--fixed election-results-table--constituency-party">
          <thead>
            <tr>
              <th rowspan="2" data-leaf-col-idx="0">#</th>
              <th rowspan="2" data-leaf-col-idx="1">Party</th>
              <th colspan="2">Candidates</th>
              <th colspan="2">Seats</th>
              <th colspan="4">1st preferences</th>
            </tr>
            <tr>
              ${this.renderMainParityLeafTh('No.', 2)}
              ${this.renderMainParityLeafTh('+/-', 3)}
              ${this.renderMainParityLeafTh('No.', 4)}
              ${this.renderMainParityLeafTh('+/-', 5)}
              ${this.renderMainParityLeafTh('No.', 6)}
              ${this.renderMainParityLeafTh('+/-', 7)}
              ${this.renderMainParityLeafTh('%', 8)}
              ${this.renderMainParityLeafTh('+/-', 9)}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => {
              const share = validPoll ? row.firstPrefs / validPoll * 100 : null;
              return `
                <tr>
                  <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                  <td>${this.renderElectionEntityButton('party', normalizeName(row.party), `<span class="election-party-dot" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}`, 'election-cell-wrap')}</td>
                  <td class="election-num">${formatNumber(row.stood)}</td>
                  <td class="election-num">-</td>
                  <td class="election-num">${formatNumber(row.seats)}</td>
                  <td class="election-num">-</td>
                  <td class="election-num">${formatNumber(row.firstPrefs)}</td>
                  <td class="election-num">-</td>
                  <td class="election-num">${share === null ? '-' : formatFixedPercent(share)}</td>
                  <td class="election-num">-</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderMainParityLeafTh(label, index) {
    return `<th class="election-num" data-leaf-col-idx="${index}"><span>${escapeHtml(label)}</span><button type="button" class="election-th-btn" data-table-filter-sort-btn="1" tabindex="-1" aria-hidden="true" aria-label="Sort and Filter" title="Sort and Filter">&#8645;</button></th>`;
  }

  renderElectionEntityButton(kind, key, labelHtml, extraClass = '') {
    return `<button type="button" class="election-entity-link ${extraClass}" data-election-entity="${escapeHtml(kind)}" data-election-entity-key="${escapeHtml(key || '')}">${labelHtml}</button>`;
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
    if (!table || table.dataset.test2TableControlsReady === '1') return;
    const tbody = table.querySelector('tbody');
    const headers = [...table.querySelectorAll('thead th[data-leaf-col-idx]')];
    if (!tbody || headers.length === 0) return;
    table.dataset.test2TableControlsReady = '1';
    const original = [...tbody.querySelectorAll('tr')].map((row, index) => ({ row, index }));
    const isFixed = (row) => row.classList.contains('election-table-summary-row') || row.classList.contains('election-table-note-row');
    const sortable = original.filter(({ row }) => !isFixed(row));
    const fixed = original.filter(({ row }) => isFixed(row));
    const parseNumeric = (text) => {
      const cleaned = String(text || '')
        .replace(/,/g, '')
        .replace(/%/g, '')
        .replace(/\+/g, '')
        .replace(/\u2212/g, '-')
        .trim();
      if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return null;
      const value = Number(cleaned);
      return Number.isFinite(value) ? value : null;
    };
    const parseOrdinal = (text) => {
      const match = String(text || '').trim().toLowerCase().match(/^(\d+)(st|nd|rd|th)?$/);
      return match ? Number(match[1]) : null;
    };
    const cellText = (row, index) => row.children[index]?.textContent?.trim() || '';
    const inferKind = (index) => {
      const sample = sortable.slice(0, 40).map(({ row }) => cellText(row, index)).filter(Boolean);
      if (!sample.length) return 'text';
      if (sample.filter((value) => parseOrdinal(value) !== null).length / sample.length >= 0.8) return 'ordinal';
      if (sample.filter((value) => parseNumeric(value) !== null).length / sample.length >= 0.8) return 'numeric';
      return 'text';
    };
    const applySort = (column, direction) => {
      const kind = inferKind(column);
      const rows = direction === 'default'
        ? [...sortable].sort((a, b) => a.index - b.index)
        : [...sortable].sort((a, b) => {
          const av = cellText(a.row, column);
          const bv = cellText(b.row, column);
          let comparison = 0;
          if (kind === 'ordinal') {
            const ao = parseOrdinal(av);
            const bo = parseOrdinal(bv);
            comparison = ao !== null && bo !== null ? ao - bo : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
          } else if (kind === 'numeric') {
            const an = parseNumeric(av);
            const bn = parseNumeric(bv);
            if (an !== null && bn !== null) comparison = an - bn;
            else if (an !== null) comparison = 1;
            else if (bn !== null) comparison = -1;
            else comparison = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
          } else {
            comparison = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
          }
          return direction === 'asc' ? comparison : -comparison;
        });
      tbody.innerHTML = '';
      rows.forEach(({ row }, index) => {
        const rankCell = row.querySelector('.election-rank-col');
        if (rankCell) rankCell.textContent = rankLabel(index);
        tbody.appendChild(row);
      });
      fixed.forEach(({ row }) => tbody.appendChild(row));
      headers.forEach((header) => {
        const button = header.querySelector('.election-th-btn, .election-results-sort');
        if (!button) return;
        const active = Number(header.dataset.leafColIdx) === column && direction !== 'default';
        button.innerHTML = active ? (direction === 'asc' ? '\u2191' : '\u2193') : '&#8645;';
        button.classList.toggle('election-th-btn--active', active);
        button.classList.toggle('election-results-sort--active', active);
      });
    };
    headers.forEach((header) => {
      const button = header.querySelector('.election-th-btn, .election-results-sort');
      if (!button) return;
      button.tabIndex = 0;
      button.removeAttribute('aria-hidden');
      button.setAttribute('aria-label', 'Sort column');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const column = Number(header.dataset.leafColIdx);
        const current = table.dataset.test2SortColumn === String(column) ? (table.dataset.test2SortDirection || 'default') : 'default';
        const next = current === 'default' ? 'desc' : (current === 'desc' ? 'asc' : 'default');
        table.dataset.test2SortColumn = String(column);
        table.dataset.test2SortDirection = next;
        applySort(column, next);
      });
    });
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

  currentResults() {
    const current = this.activeBundle?.results || [];
    const previous = this.previousBundle?.results || [];
    return previous.length ? compareResults(current, previous) : current;
  }

  withPartyDeltas(rows = [], options = {}) {
    const previousRows = options.mainLike && this.previousBundle?.mainLikePartySummary?.length
      ? this.previousBundle.mainLikePartySummary
      : (this.previousBundle?.results?.length ? buildPartySummary(this.previousBundle.results) : []);
    const previousByParty = new Map(previousRows.map((row) => [normalizeName(row.party), row]));
    return rows.map((row) => {
      const previous = previousByParty.get(normalizeName(row.party));
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
    return rows.map((row) => {
      const previous = previousByPartyAndArea.get(`${normalizeName(row.party)}|${normalizeName(row.constituency)}`);
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
    return this.sharedRenderer.renderDistrictResults(view);
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
    return this.sharedRenderer.renderCouncilResults(view);
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
    return this.sharedRenderer.renderCouncilSummaryTable(rows);
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead><tr><th>Council</th><th>DEAs</th><th>Leading party</th><th>Seats</th><th>Seat change</th><th>Valid votes</th><th>Vote change</th><th>Turnout</th><th>Turnout change</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.council)}</td>
                <td>${formatNumber(row.deas)}</td>
                <td><span class="test2-party-swatch" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.leadingParty || '')}</td>
                <td>${formatNumber(row.seats)}</td>
                <td>${row.deltas ? formatSigned(row.deltas.seats) : ''}</td>
                <td>${formatNumber(row.validPoll)}</td>
                <td>${row.deltas ? formatSigned(row.deltas.validPoll) : ''}</td>
                <td>${formatPercent(row.turnoutPct)}</td>
                <td>${row.deltas?.turnoutPct !== null && row.deltas?.turnoutPct !== undefined ? formatSignedPercent(row.deltas.turnoutPct) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderDistrictPartyTable(rows = []) {
    return this.sharedRenderer.renderDistrictPartyTable(rows);
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
    return `
      <div class="election-party-wrapper election-party-wrapper--pane-sticky">
        <table class="election-party-table election-party-table--grouped election-party-table--candidate-sticky3 election-results-table--fixed election-results-table--nonlocal">
          <thead>
            <tr>
              <th rowspan="2" data-leaf-col-idx="0">#</th>
              <th rowspan="2" data-leaf-col-idx="1">Candidate</th>
              <th rowspan="2" data-leaf-col-idx="2">Party</th>
              <th rowspan="2" data-leaf-col-idx="3">Constituency / DEA</th>
              <th colspan="4">1st preferences</th>
              <th rowspan="2" data-leaf-col-idx="8">Status</th>
            </tr>
            <tr>
              ${this.renderMainParityLeafTh('No.', 4)}
              ${this.renderMainParityLeafTh('+/-', 5)}
              ${this.renderMainParityLeafTh('%', 6)}
              ${this.renderMainParityLeafTh('+/-', 7)}
            </tr>
          </thead>
          <tbody>
            ${candidates.map((candidate, index) => `
              <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
                <td class="election-rank-col">${escapeHtml(rankLabel(index))}</td>
                <td>${this.renderElectionEntityButton('candidate', candidate.id || `${candidate.name}|${candidate.party}`, escapeHtml(candidate.name || ''), 'election-cell-wrap')}</td>
                <td>${this.renderElectionEntityButton('party', normalizeName(candidate.party), `<span class="election-party-dot" style="background:${escapeHtml(candidate.colour || electionPartyColour(candidate.party) || partyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}`, 'election-cell-wrap')}</td>
                <td><button type="button" class="election-entity-link election-cell-wrap" data-election-result-key="${escapeHtml(normalizeName(candidate.constituency || ''))}">${escapeHtml(candidate.constituency || '')}</button></td>
                <td class="election-num">${formatNumber(candidate.firstPrefs)}</td>
                <td class="election-num">${candidate.deltas ? formatMainDelta(candidate.deltas.firstPrefs) : ''}</td>
                <td class="election-num">${formatPercent(candidate.firstPrefPct)}</td>
                <td class="election-num">${candidate.deltas?.firstPrefPct !== null && candidate.deltas?.firstPrefPct !== undefined ? formatMainPercentDelta(candidate.deltas.firstPrefPct) : ''}</td>
                <td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}</td>
              </tr>
            `).join('')}
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
    return `
      <div class="election-party-wrapper election-party-wrapper--pane-sticky">
        <table class="election-party-table election-party-table--grouped election-party-table--district-sticky3 election-party-table--district-local-party-sticky4 election-results-table--fixed election-results-table--district">
          <thead>
            <tr>
              <th rowspan="2" data-leaf-col-idx="0">#</th>
              <th rowspan="2" data-leaf-col-idx="1">Party</th>
              <th rowspan="2" data-leaf-col-idx="2">DEA</th>
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
                <td>${this.renderElectionEntityButton('party', normalizeName(row.party), `<span class="election-party-dot" style="background:${escapeHtml(row.colour || partyColour(row.party))}"></span>${escapeHtml(row.party)}`, 'election-cell-wrap')}</td>
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
    const countNumbers = result.countNumbers?.length
      ? result.countNumbers
      : [...new Set(candidates.flatMap((candidate) => (candidate.counts || []).map((count) => count.count)))].sort((a, b) => a - b);
    if (!countNumbers.length) return '<p class="election-no-data">No count-by-count data is available for this entry.</p>';
    const summaryRows = [
      ['Quota', result.quota],
      ['Valid poll', result.validPoll],
      ['Total poll', result.totalPoll],
      ['Spoiled', result.spoiled],
      ['Electorate', result.electorate],
      ['Turnout', result.turnoutPct, true]
    ].filter(([, value]) => value !== null && value !== undefined && value !== '');
    const countEvents = inferCountEvents(candidates, countNumbers);
    const nonTransferable = new Map((result.nonTransferable || []).map((row) => [Number(row.count), row]));
    return `
      <div class="test2-election-count-toolbar">
        <button type="button" id="test2ElectionCountDetail" class="btn btn-secondary btn-sm" aria-pressed="${this.countDetailedView ? 'true' : 'false'}">
          ${this.countDetailedView ? 'Hide detailed count values' : 'Show detailed count values'}
        </button>
      </div>
      <div class="election-count-wrapper election-count-wrapper--pane-sticky">
        <table class="election-count-table election-count-table--grouped election-count-table--candidate-sticky3 election-results-table--fixed${this.isLocalGovernmentElection() ? ' election-results-table--local' : ' election-results-table--nonlocal'}">
          <thead>
            <tr>
              <th rowspan="2" data-leaf-col-idx="0">Candidate</th>
              <th rowspan="2" data-leaf-col-idx="1">Party</th>
              <th colspan="${countNumbers.length}">Counts</th>
              <th rowspan="2" data-leaf-col-idx="${countNumbers.length + 2}">Status</th>
            </tr>
            <tr>${countNumbers.map((count, index) => `<th class="election-num" data-leaf-col-idx="${index + 2}">Count ${formatNumber(count)}</th>`).join('')}</tr>
            ${countEvents.length ? `<tr class="election-count-event-row test2-election-table__event-row"><th colspan="2">Count event</th>${countNumbers.map((count) => `<th>${escapeHtml(countEvents.find((event) => event.count === count)?.label || '')}</th>`).join('')}<th></th></tr>` : ''}
          </thead>
          <tbody>
            ${candidates.map((candidate) => {
              const counts = new Map((candidate.counts || []).map((count) => [Number(count.count), count]));
              return `
                <tr class="${candidate.elected ? 'election-row--elected test2-election-table__elected' : ''}">
                  <td>${this.renderElectionEntityButton('candidate', candidate.id || `${candidate.name}|${candidate.party}`, escapeHtml(candidate.name || ''), 'election-cell-wrap')}</td>
                  <td>${this.renderElectionEntityButton('party', normalizeName(candidate.party), `<span class="election-party-dot" style="background:${escapeHtml(candidate.colour || electionPartyColour(candidate.party) || partyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}`, 'election-cell-wrap')}</td>
                  ${countNumbers.map((count) => {
                    const row = counts.get(Number(count));
                    if (!row) return '<td></td>';
                    const value = row.total ?? row.firstPrefs;
                    const transfer = Number(row.transfers);
                    const detail = this.countDetailedView ? [
                      result.validPoll && Number.isFinite(Number(value)) ? `<small>${formatPercent(Number(value) / Number(result.validPoll) * 100)} of valid poll</small>` : '',
                      Number.isFinite(transfer) && transfer ? `<small>${formatSigned(transfer)} transfer</small>` : '',
                      row.status ? `<small>${escapeHtml(row.status)}</small>` : ''
                    ].filter(Boolean).join('') : '';
                    return `<td class="election-num"><span>${formatNumber(value)}${!this.countDetailedView && transfer ? ` (${formatSigned(transfer)})` : ''}</span>${detail ? `<div class="test2-election-count-detail">${detail}</div>` : ''}</td>`;
                  }).join('')}
                  <td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}${candidate.previous ? `<div class="test2-election-count-detail">Previous: ${escapeHtml(candidate.previous.status || '')}</div>` : ''}</td>
                </tr>
              `;
            }).join('')}
            ${nonTransferable.size ? `
              <tr class="election-table-summary-row test2-election-table__summary">
                <th>Non-transferable</th>
                <td></td>
                ${countNumbers.map((count) => {
                  const row = nonTransferable.get(Number(count));
                  if (!row) return '<td></td>';
                  return `<td class="election-num"><span>${formatNumber(row.total)}</span>${this.countDetailedView && Number.isFinite(Number(row.transfers)) ? `<div class="test2-election-count-detail"><small>${formatSigned(row.transfers)} transfer</small></div>` : ''}</td>`;
                }).join('')}
                <td></td>
              </tr>
            ` : ''}
            ${summaryRows.length ? `
              <tr class="election-table-summary-row test2-election-table__summary"><th colspan="2">Summary</th>${countNumbers.map((_, index) => index === 0 ? `<td>${summaryRows.map(([label, value, pct]) => `<div><strong>${escapeHtml(label)}:</strong> ${pct ? formatPercent(value) : formatNumber(value)}</div>`).join('')}</td>` : '<td></td>').join('')}<td></td></tr>
            ` : ''}
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
    return this.sharedRenderer.renderAnimationNotice(result);
    if (result.hasCountDetail && result.animationPayload) {
      const key = normalizeName(result.matchName || result.constituency || '');
      return `
        <div class="test2-election-animation-ready">
          <div class="election-animation-actions">
            <button type="button" class="btn btn-primary" data-election-animation="${escapeHtml(key)}">Run transfer animation</button>
          </div>
          <div id="test2ElectionAnimationStatus" class="election-no-data" aria-live="polite"></div>
          <div id="electionAnimationContainer" class="election-animation-container" style="display:none;">
            <div id="menuBar">
              <div id="controls">
                <a href="#" id="again" title="Restart"><i class="fa fa-backward"></i></a>
                <a href="#" id="pause-replay" class="fa fa-pause" title="Play/Pause"></a>
                <a href="#" id="step" title="Step"><i class="fa fa-forward"></i></a>
              </div>
              <div id="stageNumbers"></div>
              <div id="quota"></div>
              <div style="clear:both;"></div>
              <div style="float:right; font-size:14px; color:#888;">Seats: <span id="seats-span"></span></div>
            </div>
            <div id="animation"></div>
            <div id="count_matrix"></div>
            <div id="transfers"></div>
            <div id="transfers_constituency"></div>
          </div>
        </div>
      `;
    }
    return '<p class="election-no-data">No transfer animation data is available for this entry.</p>';
  }

  runAnimation(result) {
    const container = document.getElementById('electionAnimationContainer');
    const status = document.getElementById('test2ElectionAnimationStatus');
    if (!container || !result?.animationPayload) return;
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
    content.innerHTML = kind === 'candidate' ? this.renderCandidateEntity(entity) : this.renderPartyEntity(entity);
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
    return `
      <section class="election-entity-page">
        <div class="election-entity-page__hero">
          <span class="election-party-dot election-party-dot--hero" style="background:${escapeHtml(entity.colour || electionPartyColour(entity.name))}"></span>
          <div>
            <div class="election-entity-page__eyebrow">Party Information</div>
            <h3 class="election-entity-page__title">${escapeHtml(entity.name || '')}</h3>
            <p class="election-entity-page__subtitle">${escapeHtml(this.activeBundle.displayTitle || this.activeBundle.body)} - ${escapeHtml(this.activeBundle.date)}</p>
          </div>
        </div>
        <div class="election-entity-metrics">
          <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates stood</span><strong>${formatNumber(entity.stood)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates elected</span><strong>${formatNumber(entity.elected)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">First prefs</span><strong>${formatNumber(entity.firstPrefs)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Final votes</span><strong>${formatNumber(entity.finalVotes)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Constituencies/DEAs</span><strong>${formatNumber(entity.constituencies?.length || 0)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Share</span><strong>${formatPercent(entity.shareOfTotal)}</strong></div>
        </div>
        ${this.renderCandidateSummaryTable((entity.candidates || []).map((candidate) => ({ ...candidate, party: entity.name, colour: entity.colour, firstPrefs: candidate.firstPref })))}
      </section>
    `;
  }

  renderCandidateEntity(entity) {
    return `
      <section class="election-entity-page">
        <div class="election-entity-page__hero">
          <span class="election-party-dot election-party-dot--hero" style="background:${escapeHtml(entity.colour || electionPartyColour(entity.party))}"></span>
          <div>
            <div class="election-entity-page__eyebrow">Candidate Information</div>
            <h3 class="election-entity-page__title">${escapeHtml(entity.name || '')}</h3>
            <p class="election-entity-page__subtitle">${escapeHtml(entity.party || '')}</p>
          </div>
        </div>
        <div class="election-entity-metrics">
          <div class="election-entity-metric"><span class="election-entity-metric__label">Appearances</span><strong>${formatNumber(entity.appearances?.length || 0)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Elected</span><strong>${formatNumber(entity.electedCount)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">First prefs</span><strong>${formatNumber(entity.firstPrefs)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Final votes</span><strong>${formatNumber(entity.finalVotes)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Constituencies/DEAs</span><strong>${formatNumber(entity.constituencies?.length || 0)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Share</span><strong>${formatPercent(entity.shareOfTotal)}</strong></div>
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
    if (!feature?.electionResult || !this.activeBundle) return;
    this.renderPanel(feature.electionResult);
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
        parties.set(party, partyColour(party));
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
    if (!this.activeBundle || !this.shouldRenderElectionOverlays()) return;
    const index = await this.loadFeatureIndex();
    const centres = this.buildFeatureCentreLookup(index?.items || []);
    const map = this.mapController.map;
    const groups = this.buildSeatCircleGroups(centres);
    const visibleGroups = this.filterOverlayGroupsByCollision(groups);
    const features = [];
    let seatOrder = 0;
    for (const group of visibleGroups) {
      const { result, center, seats, positions, groupWidth, groupHeight } = group;
      const minX = Math.min(...positions.map((point) => point.x));
      const minY = Math.min(...positions.map((point) => point.y));
      seats.forEach((seat, indexWithinResult) => {
        const position = positions[indexWithinResult];
        const pixelOffset = {
          x: position.x - minX + (SEAT_CIRCLE_SIZE / 2) - (groupWidth / 2),
          y: position.y - minY + (SEAT_CIRCLE_SIZE / 2) - (groupHeight / 2)
        };
        const [lng, lat] = offsetSeatByPixels(map, center, pixelOffset);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: {
            constituency: result.constituency || result.matchName || '',
            candidate: seat.name || '',
            party: seat.party || result.winnerParty || result.leadingParty || '',
            colour: seat.colour || partyColour(seat.party || result.winnerParty || result.leadingParty),
            resultKey: normalizeName(result.matchName || result.constituency || ''),
            aggregateType: result.aggregateType || '',
            seatOrder: seatOrder++
          }
        });
      });
    }
    if (!features.length) return;
    const data = { type: 'FeatureCollection', features };
    if (map.getSource(SEAT_SOURCE_ID)) {
      map.getSource(SEAT_SOURCE_ID).setData(data);
    } else {
      map.addSource(SEAT_SOURCE_ID, { type: 'geojson', data });
    }
    map.getSource(SEAT_SOURCE_ID)._data = data;
    if (!map.getLayer(SEAT_HALO_LAYER_ID)) {
      map.addLayer({
        id: SEAT_HALO_LAYER_ID,
        type: 'circle',
        source: SEAT_SOURCE_ID,
        layout: {
          'circle-sort-key': ['coalesce', ['get', 'seatOrder'], 0]
        },
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 7,
          'circle-opacity': 0.98
        }
      });
    }
    if (!map.getLayer(SEAT_LAYER_ID)) {
      map.addLayer({
        id: SEAT_LAYER_ID,
        type: 'circle',
        source: SEAT_SOURCE_ID,
        layout: {
          'circle-sort-key': ['coalesce', ['get', 'seatOrder'], 0]
        },
        paint: {
          'circle-color': ['coalesce', ['get', 'colour'], '#6b7280'],
          'circle-radius': 6,
          'circle-stroke-color': 'rgba(255,255,255,0.95)',
          'circle-stroke-width': 1,
          'circle-opacity': 0.95
        }
      });
    }
    if (!this.seatCircleClickBound) {
      this.seatCircleClickBound = true;
      map.on('click', SEAT_LAYER_ID, (event) => {
        const key = event.features?.[0]?.properties?.resultKey;
        const aggregateType = event.features?.[0]?.properties?.aggregateType;
        if (aggregateType === 'council' || aggregateType === 'district') {
          this.activeLocalMode = 'district';
          this.renderPanel(null, aggregateType === 'council' ? 'council' : 'party');
          this.app.updateURLState();
          return;
        }
        const result = (this.activeBundle?.results || []).find((item) => normalizeName(item.matchName || item.constituency) === key);
        if (result) this.renderPanel(result);
      });
      map.on('mouseenter', SEAT_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', SEAT_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
    }
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
          colour: partyColour(result.leadingParty || result.winnerParty),
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
      map.on('mouseenter', VOTE_BAR_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', VOTE_BAR_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
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
    const groupWidth = Math.max(...positions.map((point) => point.x)) - Math.min(...positions.map((point) => point.x)) + SEAT_CIRCLE_SIZE;
    const groupHeight = Math.max(...positions.map((point) => point.y)) - Math.min(...positions.map((point) => point.y)) + SEAT_CIRCLE_SIZE;
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
    const refresh = () => {
      if (this.activeBundle && this.shouldRenderElectionOverlays()) {
        this.renderElectionOverlay().catch((error) => console.warn('[test2 elections] Overlay refresh failed', error));
      }
    };
    map.on('zoomend', refresh);
    map.on('moveend', refresh);
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
    if (!totalBounds || (totalBounds.maxX - totalBounds.minX) < 120 || (totalBounds.maxY - totalBounds.minY) < 120) return [];
    const boxes = [];
    const visible = [];
    for (const group of projected.sort((a, b) => b.pixelArea - a.pixelArea || b.area - a.area || b.seats.length - a.seats.length)) {
      const box = {
        minX: group.point.x - group.width / 2,
        maxX: group.point.x + group.width / 2,
        minY: group.point.y - group.height / 2,
        maxY: group.point.y + group.height / 2
      };
      if (boxes.some((existing) => boxesOverlap(existing, box))) continue;
      boxes.push(box);
      visible.push(group);
    }
    return visible;
  }

  removeSeatCircles() {
    const map = this.mapController?.map;
    if (!map) return;
    if (map.getLayer(SEAT_LAYER_ID)) map.removeLayer(SEAT_LAYER_ID);
    if (map.getLayer(SEAT_HALO_LAYER_ID)) map.removeLayer(SEAT_HALO_LAYER_ID);
    if (map.getSource(SEAT_SOURCE_ID)) map.removeSource(SEAT_SOURCE_ID);
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
      map.on('mouseenter', RECALL_LABEL_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', RECALL_LABEL_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
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
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return null;
    const raw = await response.json();
    const index = {
      ...raw,
      items: raw.items || raw.features || (Array.isArray(raw) ? raw : [])
    };
    this.featureIndexCache.set(url, index);
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
        colour: partyColour(result.winnerParty || winner?.party || result.leadingParty)
      }];
    }
    const seatCount = Math.max(0, Number(result.seatsWon || result.seatsTotal || 0));
    return Array.from({ length: seatCount }, (_, index) => ({
      name: index === 0 ? (result.winnerName || result.leadingName || '') : '',
      party: result.winnerParty || result.leadingParty || '',
      colour: partyColour(result.winnerParty || result.leadingParty)
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
    ...(result.featureAliases || [])
  ].map(normalizeName).filter(Boolean);
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
    String(a.party).localeCompare(String(b.party))
    || String(a.constituency).localeCompare(String(b.constituency))
    || b.firstPrefs - a.firstPrefs
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
        partyVotes: new Map()
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
      colour: partyColour(leading[0]),
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
  const nw = map.project([west, north]);
  const se = map.project([east, south]);
  return {
    minX: Math.min(nw.x, se.x),
    maxX: Math.max(nw.x, se.x),
    minY: Math.min(nw.y, se.y),
    maxY: Math.max(nw.y, se.y)
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

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
  const className = number > 0 ? 'election-delta election-delta--up' : number < 0 ? 'election-delta election-delta--down' : 'election-delta';
  return `<span class="${className}">${number > 0 ? '+' : ''}${number.toLocaleString('en-GB')}</span>`;
}

function formatMainPercentDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const className = number > 0 ? 'election-delta election-delta--up' : number < 0 ? 'election-delta election-delta--down' : 'election-delta';
  return `<span class="${className}">${number > 0 ? '+' : ''}${number.toFixed(2)}%</span>`;
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

function boxesOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
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
