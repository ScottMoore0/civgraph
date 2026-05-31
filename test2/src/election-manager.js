import {
  buildRepairedLabelValueExpression,
  repairFeatureProperties
} from '../../test/src/feature-property-repairs.js';
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
const SEAT_LAYER_ID = 'test2-election-seat-layer';
const VOTE_BAR_SOURCE_ID = 'test2-election-vote-bar-source';
const VOTE_BAR_LAYER_ID = 'test2-election-vote-bar-layer';

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
    this.activeLocalMode = 'dea';
    this.countDetailedView = false;
    this.bundleCache = new Map();
    this.featureIndexCache = new Map();
    this.resultsByLayer = new Map();
    this.seatCircleClickBound = false;
    this.voteBarClickBound = false;
    this.overlayRefreshBound = false;
    this.loadSerial = 0;
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
      placeholder: !entry.loadable,
      displaySubtitle: entry.displaySubtitle || `${entry.totalConstituencies || 0} constituencies`,
      displayProvider: entry.displayProvider || entry.body,
      displayTitle: entry.displayTitle || entry.body
    }));
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

    await this.app.loadMap(entry.sourceMapId);
    const bundle = await this.loadBundle(entry);
    const previousBundle = await this.loadPreviousBundle(entry);
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
    this.activeLocalMode = entry.bodyGroup === 'local-government' ? 'dea' : 'constituency';
    this.countDetailedView = false;
    this.indexBundle(bundle);
    this.applyActiveStyle();
    await this.renderElectionOverlay();
    this.renderPanel();
    this.updateElectionTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
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
      body: this.activeEntry.body,
      date: this.activeEntry.date,
      mode: this.activeMode,
      overlay: this.overlayMode,
      view: this.activePanelView,
      localMode: this.activeLocalMode,
      selected: this.activeSelectedResultKey,
      countDetail: this.countDetailedView
    };
  }

  async restoreURLState(params) {
    const body = params.get('electionBody');
    const date = params.get('electionDate');
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
    const expression = this.buildColourExpression(this.activeMode);
    this.mapController.applyElectionStyle?.(this.activeEntry.sourceMapId, {
      mode: this.activeMode,
      fillColorExpression: expression,
      lineColorExpression: expression,
      fillOpacity: this.activeBundle.geometryType === 'point' ? undefined : 0.38
    });
    this.renderLegend();
  }

  buildColourExpression(mode) {
    const labels = [];
    for (const result of this.activeBundle.results || []) {
      if (!result.matched || !result.matchName) continue;
      labels.push(result.matchName, this.colourForMode(mode, result));
    }
    const matchInput = buildRepairedLabelValueExpression({
      id: this.activeBundle.layerId,
      sourceMapId: this.activeBundle.sourceMapId,
      labelProperty: this.activeBundle.labelProperty
    }, ['to-string', ['get', this.activeBundle.labelProperty || 'name']]);
    return ['match', ['to-string', matchInput], ...labels, '#9ca3af'];
  }

  colourForMode(mode, result) {
    if (mode === 'winner') return partyColour(result.winnerParty) || result.colour || '#6b7280';
    if (mode === 'leadingParty') return partyColour(result.leadingParty) || result.leadingColour || '#6b7280';
    if (mode === 'turnout') return numericColour(result.turnoutPct, 35, 80);
    if (mode === 'voteShare') return numericColour(result.leadingPct, 10, 70);
    if (mode === 'majority') return numericColour(result.majorityPct, 0, 45);
    if (mode === 'seats') return numericColour(result.seatsWon ?? result.seatsTotal, 1, 6);
    if (mode === 'quota') return numericColour(result.quota, 1_000, 120_000);
    return '#6b7280';
  }

  renderPanel(selectedResult = null, view = null) {
    const pane = this.ensurePanel();
    const content = document.getElementById('electionPaneContent');
    const title = document.getElementById('electionPaneTitle');
    const back = document.getElementById('electionPaneBack');
    if (!pane || !content || !title || !this.activeEntry || !this.activeBundle) return;
    const modes = this.activeEntry.stylingModes || [];
    const nextView = view || this.activePanelView || 'party';
    this.activePanelView = nextView;
    this.activeSelectedResultKey = selectedResult ? normalizeName(selectedResult.matchName || selectedResult.constituency || '') : null;
    const electionTitle = this.activeBundle.displayTitle || this.activeBundle.body;
    title.textContent = selectedResult?.constituency
      ? `${selectedResult.constituency} - ${electionTitle}`
      : electionTitle;
    back?.classList.toggle('hidden', !selectedResult);
    const headerRight = pane.querySelector('.election-pane__header-right');
    if (headerRight) {
      const overlayControl = this.shouldRenderElectionOverlays() ? `
        <label class="test2-election-panel__mode test2-election-panel__mode--inline">
          <span>Overlay</span>
          <select id="test2ElectionOverlay">
            <option value="circles" ${this.overlayMode === 'circles' ? 'selected' : ''}>Seat circles</option>
            <option value="bars" ${this.overlayMode === 'bars' ? 'selected' : ''}>Vote bars</option>
          </select>
        </label>
      ` : '';
      const localModeControl = !selectedResult && this.activeBundle.bodyGroup === 'local-government' ? `
        <div class="test2-election-local-mode" role="group" aria-label="Local government result level">
          <button type="button" class="${this.activeLocalMode === 'dea' ? 'is-active' : ''}" data-election-local-mode="dea">DEA</button>
          <button type="button" class="${this.activeLocalMode === 'district' ? 'is-active' : ''}" data-election-local-mode="district">${this.activeBundle.localBodies?.length > 1 ? 'Council' : 'District'}</button>
        </div>
      ` : '';
      headerRight.innerHTML = `
        ${localModeControl}
        <label class="test2-election-panel__mode test2-election-panel__mode--inline">
          <span>Style</span>
          <select id="test2ElectionMode">
            ${modes.map((mode) => `<option value="${escapeHtml(mode)}" ${mode === this.activeMode ? 'selected' : ''}>${escapeHtml(MODE_LABELS[mode] || mode)}</option>`).join('')}
          </select>
        </label>
        ${overlayControl}
        <button type="button" id="test2ElectionClose" class="election-pane__close" aria-label="Unload election">&times;</button>
      `;
    }
    content.innerHTML = selectedResult
      ? this.renderConstituencyResults(selectedResult, nextView)
      : this.renderOverallResults(nextView);
    pane.classList.add('election-results-pane--open');
    document.body.classList.add('test2-election-open');
    back?.addEventListener('click', () => this.renderPanel(null, 'party'));
    pane.querySelector('#test2ElectionClose')?.addEventListener('click', () => this.unloadElection());
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
  }

  renderOverallResults(view = 'party') {
    const results = this.currentResults();
    if (results.some((result) => result.recallPetition)) return this.renderRecallPetitionOverview(results);
    if (this.activeBundle.bodyGroup === 'local-government' && this.activeLocalMode === 'district') {
      return this.renderDistrictResults(view);
    }
    const rows = this.activeBundle.partySummary?.length ? this.activeBundle.partySummary : buildPartySummary(results);
    const rowsWithDeltas = this.withPartyDeltas(rows);
    const candidates = buildCandidateSummary(results);
    const totalSeats = rows.reduce((sum, row) => sum + row.seats, 0);
    const validPoll = sumNumbers(results, 'validPoll');
    const electorate = sumNumbers(results, 'electorate');
    const turnout = electorate ? validPoll / electorate * 100 : averageNumbers(results, 'turnoutPct');
    return `
      <section class="test2-election-panel" aria-label="Election results summary">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['candidate', 'By Candidate'],
          ['constituency', this.activeBundle.bodyGroup === 'local-government' ? 'By DEA' : 'By Constituency'],
          ...(this.activeBundle.bodyGroup === 'local-government' ? [['local-party', 'By Local Party']] : [])
        ], view)}
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>${this.activeBundle.bodyGroup === 'local-government' ? 'DEAs' : 'Constituencies'}</dt><dd>${formatNumber(results.length)}</dd></div>
            <div><dt>Matched</dt><dd>${formatNumber(this.activeBundle.matchedCount)}</dd></div>
            <div><dt>Unmatched</dt><dd>${formatNumber(this.activeBundle.unmatchedCount)}</dd></div>
            ${totalSeats ? `<div><dt>Seats</dt><dd>${formatNumber(totalSeats)}</dd></div>` : ''}
            ${validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(validPoll)}</dd></div>` : ''}
            ${turnout ? `<div><dt>Turnout</dt><dd>${formatPercent(turnout)}</dd></div>` : ''}
          </dl>
          <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
        </div>
        ${this.renderDataCoverageNotice()}
        ${view === 'candidate' ? this.renderCandidateSummaryTable(candidates) : view === 'constituency' ? this.renderConstituencySummaryTable(results) : view === 'local-party' ? this.renderLocalPartySummaryTable(results) : rowsWithDeltas.length ? `
          <div class="test2-election-table-wrap">
            <table class="test2-election-table catalogue-detail__entity-table">
              <thead><tr><th>Party</th><th>Stood</th><th>Seats</th><th>Votes</th><th>Share</th><th>Change</th></tr></thead>
              <tbody>
                ${rowsWithDeltas.map((row) => `
                  <tr>
                    <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}</button></td>
                    <td>${formatNumber(row.stood)}</td>
                    <td>${formatNumber(row.seats)}</td>
                    <td>${formatNumber(row.votes)}</td>
                    <td>${formatPercent(row.share)}</td>
                    <td>${formatDeltaPair(row.deltas?.seats, row.deltas?.votes)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
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
    const areaLabel = this.activeBundle?.bodyGroup === 'local-government' ? 'DEA' : 'Constituency';
    return `
      <section class="test2-election-panel" aria-label="${escapeHtml(result.constituency)} results">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['counts', 'By Count'],
          ['animation', 'Transfers']
        ], view)}
        <dl class="test2-election-panel__stats">
          <div><dt>${areaLabel}</dt><dd>${escapeHtml(result.constituency || '')}</dd></div>
          ${result.seatsTotal ? `<div><dt>Seats</dt><dd>${formatNumber(result.seatsTotal)}</dd></div>` : ''}
          ${result.validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(result.validPoll)}</dd></div>` : ''}
          ${result.turnoutPct ? `<div><dt>Turnout</dt><dd>${formatPercent(result.turnoutPct)}</dd></div>` : ''}
          ${result.quota ? `<div><dt>Quota</dt><dd>${formatNumber(result.quota)}</dd></div>` : ''}
          ${result.previous ? `<div><dt>Previous winner</dt><dd>${escapeHtml(result.previous.winnerParty || result.previous.leadingParty || '')}</dd></div>` : ''}
          ${result.deltas?.turnoutPct !== null && result.deltas?.turnoutPct !== undefined ? `<div><dt>Turnout change</dt><dd>${formatSignedPercent(result.deltas.turnoutPct)}</dd></div>` : ''}
        </dl>
        ${view === 'counts' ? this.renderCountTable(result, candidates) : view === 'animation' ? this.renderAnimationNotice(result) : candidates.length ? `
          <div class="test2-election-table-wrap">
            <table class="test2-election-table catalogue-detail__entity-table">
              <thead><tr><th>Candidate</th><th>Party</th><th>First prefs</th><th>Change</th><th>Final votes</th><th>Status</th></tr></thead>
              <tbody>
                ${candidates.map((candidate) => `
                  <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
                    <td><button type="button" class="test2-election-link" data-election-entity="candidate" data-election-entity-key="${escapeHtml(candidate.id || `${candidate.name}|${candidate.party}`)}">${escapeHtml(candidate.name || candidate.candidate || '')}</button></td>
                    <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(candidate.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(electionPartyColour(candidate.party) || candidate.colour || '#6b7280')}"></span>${escapeHtml(candidate.party || '')}</button></td>
                    <td>${formatNumber(candidate.firstPrefs ?? candidate.votes ?? '')}</td>
                    <td>${candidate.deltas ? formatSigned(candidate.deltas.firstPrefs) : ''}</td>
                    <td>${formatNumber(candidate.finalVotes ?? candidate.firstPrefs ?? candidate.votes ?? '')}</td>
                    <td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="election-no-data">No candidate-level result table is available for this entry.</p>`}
      </section>
    `;
  }

  currentResults() {
    const current = this.activeBundle?.results || [];
    const previous = this.previousBundle?.results || [];
    return previous.length ? compareResults(current, previous) : current;
  }

  withPartyDeltas(rows = []) {
    const previousRows = this.previousBundle?.results?.length ? buildPartySummary(this.previousBundle.results) : [];
    const previousByParty = new Map(previousRows.map((row) => [normalizeName(row.party), row]));
    return rows.map((row) => {
      const previous = previousByParty.get(normalizeName(row.party));
      return {
        ...row,
        previous,
        deltas: previous ? {
          seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
          votes: numberOrZero(row.votes) - numberOrZero(previous.votes),
          share: row.share !== null && previous.share !== null ? row.share - previous.share : null
        } : null
      };
    });
  }

  renderDistrictResults(view = 'party') {
    if (this.activeBundle?.localBodies?.length > 1) {
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
    const councilRows = buildCouncilSummary(results);
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
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead><tr><th>Council</th><th>DEAs</th><th>Leading party</th><th>Seats</th><th>Valid votes</th><th>Turnout</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.council)}</td>
                <td>${formatNumber(row.deas)}</td>
                <td><span class="test2-party-swatch" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.leadingParty || '')}</td>
                <td>${formatNumber(row.seats)}</td>
                <td>${formatNumber(row.validPoll)}</td>
                <td>${formatPercent(row.turnoutPct)}</td>
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
    return `
      <div class="election-view-tabs test2-election-tabs" role="tablist">
        ${tabs.map(([id, label]) => `
          <button type="button" role="tab" aria-selected="${id === active ? 'true' : 'false'}" class="election-view-tab${id === active ? ' election-view-tab--active' : ''}" data-election-view="${escapeHtml(id)}">${escapeHtml(label)}</button>
        `).join('')}
      </div>
    `;
  }

  renderCandidateSummaryTable(candidates) {
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead><tr><th>Candidate</th><th>Party</th><th>Constituency/DEA</th><th>First prefs</th><th>%</th><th>Change</th><th>Status</th></tr></thead>
          <tbody>
            ${candidates.map((candidate) => `
              <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
                <td><button type="button" class="test2-election-link" data-election-entity="candidate" data-election-entity-key="${escapeHtml(candidate.id || `${candidate.name}|${candidate.party}`)}">${escapeHtml(candidate.name || '')}</button></td>
                <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(candidate.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(candidate.colour || electionPartyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}</button></td>
                <td>${escapeHtml(candidate.constituency || '')}</td>
                <td>${formatNumber(candidate.firstPrefs)}</td>
                <td>${formatPercent(candidate.firstPrefPct)}</td>
                <td>${candidate.deltas ? formatSigned(candidate.deltas.firstPrefs) : ''}</td>
                <td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderConstituencySummaryTable(results) {
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
    const rows = buildLocalPartySummary(results);
    if (!rows.length) return '<p class="election-no-data">No local-party summary is available for this election.</p>';
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead><tr><th>Party</th><th>DEA</th><th>Stood</th><th>Seats</th><th>First prefs</th><th>DEA share</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}</button></td>
                <td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(row.resultKey)}">${escapeHtml(row.constituency)}</button></td>
                <td>${formatNumber(row.stood)}</td>
                <td>${formatNumber(row.seats)}</td>
                <td>${formatNumber(row.firstPrefs)}</td>
                <td>${formatPercent(row.share)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderDataCoverageNotice() {
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
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead>
            <tr><th>Candidate</th><th>Party</th>${countNumbers.map((count) => `<th>Count ${formatNumber(count)}</th>`).join('')}<th>Status</th></tr>
            ${countEvents.length ? `<tr class="test2-election-table__event-row"><th colspan="2">Count event</th>${countNumbers.map((count) => `<th>${escapeHtml(countEvents.find((event) => event.count === count)?.label || '')}</th>`).join('')}<th></th></tr>` : ''}
          </thead>
          <tbody>
            ${candidates.map((candidate) => {
              const counts = new Map((candidate.counts || []).map((count) => [Number(count.count), count]));
              return `
                <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
                  <td>${escapeHtml(candidate.name || '')}</td>
                  <td><span class="test2-party-swatch" style="background:${escapeHtml(candidate.colour || electionPartyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}</td>
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
                    return `<td><span>${formatNumber(value)}${!this.countDetailedView && transfer ? ` (${formatSigned(transfer)})` : ''}</span>${detail ? `<div class="test2-election-count-detail">${detail}</div>` : ''}</td>`;
                  }).join('')}
                  <td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}${candidate.previous ? `<div class="test2-election-count-detail">Previous: ${escapeHtml(candidate.previous.status || '')}</div>` : ''}</td>
                </tr>
              `;
            }).join('')}
            ${nonTransferable.size ? `
              <tr class="test2-election-table__summary">
                <th>Non-transferable</th>
                <td></td>
                ${countNumbers.map((count) => {
                  const row = nonTransferable.get(Number(count));
                  if (!row) return '<td></td>';
                  return `<td><span>${formatNumber(row.total)}</span>${this.countDetailedView && Number.isFinite(Number(row.transfers)) ? `<div class="test2-election-count-detail"><small>${formatSigned(row.transfers)} transfer</small></div>` : ''}</td>`;
                }).join('')}
                <td></td>
              </tr>
            ` : ''}
            ${summaryRows.length ? `
              <tr class="test2-election-table__summary"><th colspan="2">Summary</th>${countNumbers.map((_, index) => index === 0 ? `<td>${summaryRows.map(([label, value, pct]) => `<div><strong>${escapeHtml(label)}:</strong> ${pct ? formatPercent(value) : formatNumber(value)}</div>`).join('')}</td>` : '<td></td>').join('')}<td></td></tr>
            ` : ''}
          </tbody>
        </table>
      </div>
    `;
  }

  renderRecallPetitionResult(result) {
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

  renderEntityPanel(kind, key) {
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
    title.textContent = entity.name || entity.personId || 'Election entity';
    back?.classList.remove('hidden');
    content.innerHTML = kind === 'candidate' ? this.renderCandidateEntity(entity) : this.renderPartyEntity(entity);
    back?.addEventListener('click', () => this.renderPanel(null, this.activePanelView || 'party'));
    content.querySelectorAll('[data-election-result-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const result = this.findResultByKey(button.dataset.electionResultKey);
        if (result) {
          this.renderPanel(result, 'party');
          this.app.updateURLState();
        }
      });
    });
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
        <div class="test2-election-table-wrap">
          <table class="test2-election-table catalogue-detail__entity-table">
            <thead><tr><th>Constituency/DEA</th><th>First prefs</th><th>Final votes</th><th>Status</th></tr></thead>
            <tbody>
              ${(entity.appearances || []).map((row) => `
                <tr><td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(normalizeName(row.constituency || ''))}">${escapeHtml(row.constituency)}</button></td><td>${formatNumber(row.firstPref)}</td><td>${formatNumber(row.finalVotes)}</td><td>${escapeHtml(row.status || '')}</td></tr>
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
    if (!pane.querySelector('#electionPaneTitle')) {
      pane.innerHTML = `
        <div class="election-pane__header">
          <button type="button" id="electionPaneBack" class="election-pane__back hidden" aria-label="Back to overall election results">Back</button>
          <h3 id="electionPaneTitle" class="election-pane__title">Election results</h3>
          <div class="election-pane__header-right"></div>
        </div>
        <div id="electionPaneContent" class="election-pane__content"></div>
      `;
    }
    return pane;
  }

  removePanel() {
    const pane = document.getElementById('electionResultsPane');
    pane?.classList.remove('election-results-pane--open');
    if (pane) pane.innerHTML = '';
    document.body.classList.remove('test2-election-open');
  }

  async renderElectionOverlay() {
    this.removeElectionOverlays();
    if (!this.activeBundle || !this.shouldRenderElectionOverlays()) return;
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
  }

  async renderSeatCircles() {
    if (!this.activeBundle || !this.shouldRenderElectionOverlays()) return;
    const index = await this.loadFeatureIndex();
    const centres = this.buildFeatureCentreLookup(index?.items || []);
    const map = this.mapController.map;
    const groups = [];
    for (const result of this.activeBundle.results || []) {
      const center = result.anchor?.center || this.findCentreForResult(centres, result);
      if (!center) continue;
      const seats = this.seatCandidatesForResult(result);
      if (!seats.length) continue;
      groups.push({ result, center, seats, area: Number(result.anchor?.area || 0) });
    }
    const visibleGroups = this.filterOverlayGroupsByCollision(groups);
    const features = [];
    for (const group of visibleGroups) {
      const { result, center, seats } = group;
      const positions = seatPositions(seats.length, 13);
      seats.forEach((seat, indexWithinResult) => {
        const [lng, lat] = offsetSeat(center, positions[indexWithinResult], seats.length);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: {
            constituency: result.constituency || result.matchName || '',
            candidate: seat.name || '',
            party: seat.party || result.winnerParty || result.leadingParty || '',
            colour: seat.colour || partyColour(seat.party || result.winnerParty || result.leadingParty),
            resultKey: normalizeName(result.matchName || result.constituency || '')
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
    if (!map.getLayer(SEAT_LAYER_ID)) {
      map.addLayer({
        id: SEAT_LAYER_ID,
        type: 'circle',
        source: SEAT_SOURCE_ID,
        paint: {
          'circle-color': ['coalesce', ['get', 'colour'], '#6b7280'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 9, 7, 12, 10],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.95
        }
      });
    }
    if (!this.seatCircleClickBound) {
      this.seatCircleClickBound = true;
      map.on('click', SEAT_LAYER_ID, (event) => {
        const key = event.features?.[0]?.properties?.resultKey;
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
        return {
          ...group,
          point,
          width: Math.max(24, Math.min(96, Math.ceil(Math.sqrt(group.seats.length) * 24))),
          height: Math.max(20, Math.ceil(group.seats.length / 3) * 18)
        };
      })
      .filter((group) => Number.isFinite(group.point?.x) && Number.isFinite(group.point?.y));
    if (!projected.length) return [];
    const bounds = projected.reduce((acc, group) => ({
      minX: Math.min(acc.minX, group.point.x),
      maxX: Math.max(acc.maxX, group.point.x),
      minY: Math.min(acc.minY, group.point.y),
      maxY: Math.max(acc.maxY, group.point.y)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    if ((bounds.maxX - bounds.minX) < 120 || (bounds.maxY - bounds.minY) < 120) return [];
    const boxes = [];
    const visible = [];
    for (const group of projected.sort((a, b) => b.area - a.area || b.seats.length - a.seats.length)) {
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
    if (map.getSource(SEAT_SOURCE_ID)) map.removeSource(SEAT_SOURCE_ID);
  }

  removeVoteBars() {
    const map = this.mapController?.map;
    if (!map) return;
    if (map.getLayer(VOTE_BAR_LAYER_ID)) map.removeLayer(VOTE_BAR_LAYER_ID);
    if (map.getSource(VOTE_BAR_SOURCE_ID)) map.removeSource(VOTE_BAR_SOURCE_ID);
  }

  shouldRenderElectionOverlays() {
    const body = normalizeName(this.activeBundle?.body || this.activeEntry?.body || '');
    const type = normalizeName(this.activeBundle?.type || this.activeEntry?.type || '');
    return !body.includes('referendum') && !body.includes('recall petition') && !type.includes('referendum') && !type.includes('recall');
  }

  shouldRenderSeatCircles() {
    return this.shouldRenderElectionOverlays();
  }

  async loadFeatureIndex() {
    const layer = this.app.metadataService.getLayer(this.activeBundle.layerId)
      || this.app.metadataService.getLayer(this.activeBundle.sourceMapId);
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
          share: null
        });
      }
      const row = byParty.get(key);
      row.stood += 1;
      row.firstPrefs += Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0;
      if (candidate.elected) row.seats += 1;
    }
    for (const row of byParty.values()) {
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

function offsetSeat(center, positionOrIndex, total) {
  const lng = Number(center?.[0]);
  const lat = Number(center?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || total <= 1) return [lng, lat];
  if (positionOrIndex && typeof positionOrIndex === 'object') {
    const lngScale = Math.max(0.35, Math.cos(lat * Math.PI / 180));
    return [
      lng + Number(positionOrIndex.x || 0) * 0.002 / lngScale,
      lat - Number(positionOrIndex.y || 0) * 0.002
    ];
  }
  const angle = Math.PI * 2 * Number(positionOrIndex || 0) / total;
  const radius = Math.min(0.055, 0.012 + Math.sqrt(total) * 0.004);
  const lngScale = Math.max(0.35, Math.cos(lat * Math.PI / 180));
  return [
    lng + Math.cos(angle) * radius / lngScale,
    lat + Math.sin(angle) * radius
  ];
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
