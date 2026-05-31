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
    this.activePanelView = 'party';
    this.bundleCache = new Map();
    this.featureIndexCache = new Map();
    this.resultsByLayer = new Map();
    this.seatCircleClickBound = false;
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
      displayProvider: entry.displayProvider || entry.body
    }));
  }

  async loadElection(body, date) {
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
    this.activeEntry = entry;
    this.activeBundle = bundle;
    this.previousBundle = previousBundle;
    this.activeMode = entry.stylingModes?.includes(this.activeMode)
      ? this.activeMode
      : (entry.stylingModes?.find((mode) => DEFAULT_MODE_ORDER.includes(mode)) || 'winner');
    this.activePanelView = 'party';
    this.indexBundle(bundle);
    this.applyActiveStyle();
    await this.renderSeatCircles();
    this.renderPanel();
    this.updateElectionTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    this.app.updateURLState();
  }

  unloadElection() {
    if (this.activeEntry?.sourceMapId) this.mapController.clearElectionStyle?.(this.activeEntry.sourceMapId);
    this.removeSeatCircles();
    this.resultsByLayer.clear();
    this.activeEntry = null;
    this.activeBundle = null;
    this.previousBundle = null;
    this.removePanel();
    this.app.updateTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    this.app.updateURLState();
  }

  isElectionLoaded(body, date) {
    return this.activeEntry?.body === body && this.activeEntry?.date === date;
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
    title.textContent = selectedResult?.constituency
      ? `${selectedResult.constituency} - ${this.activeBundle.body}`
      : `${this.activeBundle.body} - ${this.activeBundle.date}`;
    back?.classList.toggle('hidden', !selectedResult);
    const headerRight = pane.querySelector('.election-pane__header-right');
    if (headerRight) {
      headerRight.innerHTML = `
        <label class="test2-election-panel__mode test2-election-panel__mode--inline">
          <span>Style</span>
          <select id="test2ElectionMode">
            ${modes.map((mode) => `<option value="${escapeHtml(mode)}" ${mode === this.activeMode ? 'selected' : ''}>${escapeHtml(MODE_LABELS[mode] || mode)}</option>`).join('')}
          </select>
        </label>
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
    pane.querySelectorAll('[data-election-view]').forEach((button) => {
      button.addEventListener('click', () => this.renderPanel(selectedResult, button.dataset.electionView || 'party'));
    });
    pane.querySelectorAll('[data-election-result-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const result = this.findResultByKey(button.dataset.electionResultKey);
        if (result) this.renderPanel(result, 'party');
      });
    });
    pane.querySelectorAll('[data-election-entity]').forEach((button) => {
      button.addEventListener('click', () => this.renderEntityPanel(button.dataset.electionEntity, button.dataset.electionEntityKey));
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
    const rows = this.activeBundle.partySummary?.length ? this.activeBundle.partySummary : buildPartySummary(results);
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
          ['constituency', this.activeBundle.bodyGroup === 'local-government' ? 'By DEA' : 'By Constituency']
        ], view)}
        <div class="test2-election-panel__summary">
          <dl class="test2-election-panel__stats">
            <div><dt>Constituencies</dt><dd>${formatNumber(results.length)}</dd></div>
            <div><dt>Matched</dt><dd>${formatNumber(this.activeBundle.matchedCount)}</dd></div>
            <div><dt>Unmatched</dt><dd>${formatNumber(this.activeBundle.unmatchedCount)}</dd></div>
            ${totalSeats ? `<div><dt>Seats</dt><dd>${formatNumber(totalSeats)}</dd></div>` : ''}
            ${validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(validPoll)}</dd></div>` : ''}
            ${turnout ? `<div><dt>Turnout</dt><dd>${formatPercent(turnout)}</dd></div>` : ''}
          </dl>
          <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
        </div>
        ${view === 'candidate' ? this.renderCandidateSummaryTable(candidates) : view === 'constituency' ? this.renderConstituencySummaryTable(results) : rows.length ? `
          <div class="test2-election-table-wrap">
            <table class="test2-election-table catalogue-detail__entity-table">
              <thead><tr><th>Party</th><th>Stood</th><th>Seats</th><th>Votes</th><th>Share</th></tr></thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(row.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(row.colour)}"></span>${escapeHtml(row.party)}</button></td>
                    <td>${formatNumber(row.stood)}</td>
                    <td>${formatNumber(row.seats)}</td>
                    <td>${formatNumber(row.votes)}</td>
                    <td>${formatPercent(row.share)}</td>
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
    const candidates = [...(result.candidates || [])].sort((a, b) => {
      const elected = Number(Boolean(b.elected)) - Number(Boolean(a.elected));
      if (elected) return elected;
      return Number(b.finalVotes ?? b.firstPrefs ?? b.votes ?? 0) - Number(a.finalVotes ?? a.firstPrefs ?? a.votes ?? 0);
    });
    return `
      <section class="test2-election-panel" aria-label="${escapeHtml(result.constituency)} results">
        ${this.renderViewTabs([
          ['party', 'By Party'],
          ['counts', 'By Count'],
          ['animation', 'Transfers']
        ], view)}
        <dl class="test2-election-panel__stats">
          <div><dt>Constituency</dt><dd>${escapeHtml(result.constituency || '')}</dd></div>
          ${result.seatsTotal ? `<div><dt>Seats</dt><dd>${formatNumber(result.seatsTotal)}</dd></div>` : ''}
          ${result.validPoll ? `<div><dt>Valid poll</dt><dd>${formatNumber(result.validPoll)}</dd></div>` : ''}
          ${result.turnoutPct ? `<div><dt>Turnout</dt><dd>${formatPercent(result.turnoutPct)}</dd></div>` : ''}
          ${result.quota ? `<div><dt>Quota</dt><dd>${formatNumber(result.quota)}</dd></div>` : ''}
          ${result.previous ? `<div><dt>Previous winner</dt><dd>${escapeHtml(result.previous.winnerParty || result.previous.leadingParty || '')}</dd></div>` : ''}
        </dl>
        ${view === 'counts' ? this.renderCountTable(result, candidates) : view === 'animation' ? this.renderAnimationNotice(result) : candidates.length ? `
          <div class="test2-election-table-wrap">
            <table class="test2-election-table catalogue-detail__entity-table">
              <thead><tr><th>Candidate</th><th>Party</th><th>First prefs</th><th>Final votes</th><th>Status</th></tr></thead>
              <tbody>
                ${candidates.map((candidate) => `
                  <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
                    <td><button type="button" class="test2-election-link" data-election-entity="candidate" data-election-entity-key="${escapeHtml(candidate.id || `${candidate.name}|${candidate.party}`)}">${escapeHtml(candidate.name || candidate.candidate || '')}</button></td>
                    <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(candidate.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(electionPartyColour(candidate.party) || candidate.colour || '#6b7280')}"></span>${escapeHtml(candidate.party || '')}</button></td>
                    <td>${formatNumber(candidate.firstPrefs ?? candidate.votes ?? '')}</td>
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

  renderViewTabs(tabs, active) {
    return `
      <div class="election-view-tabs test2-election-tabs" role="tablist">
        ${tabs.map(([id, label]) => `
          <button type="button" class="election-view-tab${id === active ? ' election-view-tab--active' : ''}" data-election-view="${escapeHtml(id)}">${escapeHtml(label)}</button>
        `).join('')}
      </div>
    `;
  }

  renderCandidateSummaryTable(candidates) {
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead><tr><th>Candidate</th><th>Party</th><th>Constituency/DEA</th><th>First prefs</th><th>%</th><th>Status</th></tr></thead>
          <tbody>
            ${candidates.map((candidate) => `
              <tr class="${candidate.elected ? 'test2-election-table__elected' : ''}">
                <td><button type="button" class="test2-election-link" data-election-entity="candidate" data-election-entity-key="${escapeHtml(candidate.id || `${candidate.name}|${candidate.party}`)}">${escapeHtml(candidate.name || '')}</button></td>
                <td><button type="button" class="test2-election-link" data-election-entity="party" data-election-entity-key="${escapeHtml(normalizeName(candidate.party))}"><span class="test2-party-swatch" style="background:${escapeHtml(candidate.colour || electionPartyColour(candidate.party))}"></span>${escapeHtml(candidate.party || '')}</button></td>
                <td>${escapeHtml(candidate.constituency || '')}</td>
                <td>${formatNumber(candidate.firstPrefs)}</td>
                <td>${formatPercent(candidate.firstPrefPct)}</td>
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
          <thead><tr><th>Constituency/DEA</th><th>Winner/lead</th><th>Party</th><th>Seats</th><th>Turnout</th><th>Majority</th></tr></thead>
          <tbody>
            ${results.map((result) => `
              <tr>
                <td><button type="button" class="test2-election-link" data-election-result-key="${escapeHtml(normalizeName(result.matchName || result.constituency || ''))}">${escapeHtml(result.constituency || result.matchName || '')}</button></td>
                <td>${escapeHtml(result.winnerName || result.leadingName || '')}</td>
                <td><span class="test2-party-swatch" style="background:${escapeHtml(electionPartyColour(result.winnerParty || result.leadingParty))}"></span>${escapeHtml(result.winnerParty || result.leadingParty || '')}</td>
                <td>${formatNumber(result.seatsWon ?? result.seatsTotal ?? '')}</td>
                <td>${formatPercent(result.turnoutPct)}</td>
                <td>${formatNumber(result.majority)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderCountTable(result, candidates) {
    const countNumbers = result.countNumbers?.length
      ? result.countNumbers
      : [...new Set(candidates.flatMap((candidate) => (candidate.counts || []).map((count) => count.count)))].sort((a, b) => a - b);
    if (!countNumbers.length) return '<p class="election-no-data">No count-by-count data is available for this entry.</p>';
    return `
      <div class="test2-election-table-wrap">
        <table class="test2-election-table catalogue-detail__entity-table">
          <thead>
            <tr><th>Candidate</th><th>Party</th>${countNumbers.map((count) => `<th>Count ${formatNumber(count)}</th>`).join('')}<th>Status</th></tr>
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
                    return `<td>${row ? `${formatNumber(row.total ?? row.firstPrefs)}${row.transfers ? ` (${formatSigned(row.transfers)})` : ''}` : ''}</td>`;
                  }).join('')}
                  <td>${candidate.elected ? 'Elected' : escapeHtml(candidate.status || '')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
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
  }

  renderPartyEntity(entity) {
    return `
      <section class="election-entity-page">
        <div class="election-entity-page__hero">
          <span class="election-party-dot election-party-dot--hero" style="background:${escapeHtml(entity.colour || electionPartyColour(entity.name))}"></span>
          <div>
            <div class="election-entity-page__eyebrow">Party Information</div>
            <h3 class="election-entity-page__title">${escapeHtml(entity.name || '')}</h3>
            <p class="election-entity-page__subtitle">${escapeHtml(this.activeBundle.body)} - ${escapeHtml(this.activeBundle.date)}</p>
          </div>
        </div>
        <div class="election-entity-metrics">
          <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates stood</span><strong>${formatNumber(entity.stood)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">Candidates elected</span><strong>${formatNumber(entity.elected)}</strong></div>
          <div class="election-entity-metric"><span class="election-entity-metric__label">First prefs</span><strong>${formatNumber(entity.firstPrefs)}</strong></div>
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
          <div class="election-entity-metric"><span class="election-entity-metric__label">Share</span><strong>${formatPercent(entity.shareOfTotal)}</strong></div>
        </div>
        <div class="test2-election-table-wrap">
          <table class="test2-election-table catalogue-detail__entity-table">
            <thead><tr><th>Constituency/DEA</th><th>First prefs</th><th>Final votes</th><th>Status</th></tr></thead>
            <tbody>
              ${(entity.appearances || []).map((row) => `
                <tr><td>${escapeHtml(row.constituency)}</td><td>${formatNumber(row.firstPref)}</td><td>${formatNumber(row.finalVotes)}</td><td>${escapeHtml(row.status || '')}</td></tr>
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

  async renderSeatCircles() {
    this.removeSeatCircles();
    if (!this.activeBundle || !this.shouldRenderSeatCircles()) return;
    const index = await this.loadFeatureIndex();
    const centres = this.buildFeatureCentreLookup(index?.items || []);
    const features = [];
    for (const result of this.activeBundle.results || []) {
      const center = result.anchor?.center || this.findCentreForResult(centres, result);
      if (!center) continue;
      const seats = this.seatCandidatesForResult(result);
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
    const map = this.mapController.map;
    const data = { type: 'FeatureCollection', features };
    if (map.getSource(SEAT_SOURCE_ID)) {
      map.getSource(SEAT_SOURCE_ID).setData(data);
    } else {
      map.addSource(SEAT_SOURCE_ID, { type: 'geojson', data });
    }
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

  removeSeatCircles() {
    const map = this.mapController?.map;
    if (!map) return;
    if (map.getLayer(SEAT_LAYER_ID)) map.removeLayer(SEAT_LAYER_ID);
    if (map.getSource(SEAT_SOURCE_ID)) map.removeSource(SEAT_SOURCE_ID);
  }

  shouldRenderSeatCircles() {
    const body = normalizeName(this.activeBundle?.body || this.activeEntry?.body || '');
    const type = normalizeName(this.activeBundle?.type || this.activeEntry?.type || '');
    return !body.includes('referendum') && !body.includes('recall petition') && !type.includes('referendum') && !type.includes('recall');
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
    if (!this.shouldRenderSeatCircles()) return [];
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
