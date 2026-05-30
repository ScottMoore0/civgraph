import {
  buildRepairedLabelValueExpression,
  repairFeatureProperties
} from '../../test/src/feature-property-repairs.js';

const ELECTION_MANIFEST_URL = '/test/metadata/elections-test2.json?v=test-020';
const DEFAULT_MODE_ORDER = ['winner', 'leadingParty', 'voteShare', 'turnout', 'majority', 'seats', 'quota'];

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
    this.activeMode = 'winner';
    this.bundleCache = new Map();
    this.resultsByLayer = new Map();
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
    this.activeEntry = entry;
    this.activeBundle = bundle;
    this.activeMode = entry.stylingModes?.includes(this.activeMode)
      ? this.activeMode
      : (entry.stylingModes?.find((mode) => DEFAULT_MODE_ORDER.includes(mode)) || 'winner');
    this.indexBundle(bundle);
    this.applyActiveStyle();
    this.renderPanel();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    this.app.updateURLState();
  }

  unloadElection() {
    if (this.activeEntry?.sourceMapId) this.mapController.clearElectionStyle?.(this.activeEntry.sourceMapId);
    this.resultsByLayer.clear();
    this.activeEntry = null;
    this.activeBundle = null;
    this.removePanel();
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

  renderPanel() {
    this.ensurePanel();
    const panel = document.getElementById('test2ElectionPanel');
    if (!panel || !this.activeEntry || !this.activeBundle) return;
    const modes = this.activeEntry.stylingModes || [];
    panel.innerHTML = `
      <div class="test2-election-panel__header">
        <div>
          <div class="test2-election-panel__eyebrow">Election layer</div>
          <h3>${escapeHtml(this.activeBundle.body)}</h3>
          <p>${escapeHtml(this.activeBundle.date)}</p>
        </div>
        <button type="button" id="test2ElectionClose" aria-label="Unload election">Close</button>
      </div>
      <label class="test2-election-panel__mode">
        <span>Style</span>
        <select id="test2ElectionMode">
          ${modes.map((mode) => `<option value="${escapeHtml(mode)}" ${mode === this.activeMode ? 'selected' : ''}>${escapeHtml(MODE_LABELS[mode] || mode)}</option>`).join('')}
        </select>
      </label>
      <div id="test2ElectionLegend" class="test2-election-panel__legend"></div>
      <dl class="test2-election-panel__stats">
        <div><dt>Matched</dt><dd>${this.activeBundle.matchedCount}</dd></div>
        <div><dt>Unmatched</dt><dd>${this.activeBundle.unmatchedCount}</dd></div>
        <div><dt>Geography</dt><dd>${escapeHtml(this.activeBundle.sourceMapId || 'Unavailable')}</dd></div>
      </dl>
    `;
    panel.classList.remove('hidden');
    panel.querySelector('#test2ElectionClose')?.addEventListener('click', () => this.unloadElection());
    panel.querySelector('#test2ElectionMode')?.addEventListener('change', (event) => {
      this.activeMode = event.target.value;
      this.applyActiveStyle();
    });
    this.renderLegend();
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
    if (document.getElementById('test2ElectionPanel')) return;
    const panel = document.createElement('aside');
    panel.id = 'test2ElectionPanel';
    panel.className = 'test2-election-panel hidden';
    panel.setAttribute('aria-live', 'polite');
    document.querySelector('.pane--map')?.appendChild(panel);
  }

  removePanel() {
    document.getElementById('test2ElectionPanel')?.classList.add('hidden');
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
