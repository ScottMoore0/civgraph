import { escapeHtml } from './utils.js';

const MAX_INITIAL_CARDS = 140;
const COLLAPSE_KEY = 'civgraph.test.catalogue.collapsed';
const PREF_KEY = 'civgraph.test.catalogue.preferences';

export class TestCatalogue {
  constructor(els, metadataService, controller, options = {}) {
    this.els = els;
    this.metadataService = metadataService;
    this.controller = controller;
    this.options = options;
    this.filteredLayers = [];
    this.featureResults = [];
    this.searchToken = 0;
    this.currentQuery = '';
    this.selectedCategory = '';
    this.selectedProvider = '';
    this.view = { type: 'home', layerId: null };
    this.history = [];
    this.historyIndex = -1;
    this.collapsed = readCollapsed();
    const preferences = readPreferences();
    this.viewMode = normalizeViewMode(preferences.viewMode || 'cards');
    this.sortMode = normalizeSortMode(preferences.sortMode || 'order');
  }

  init() {
    this.applyHashState();
    this.updateFilteredLayers();
    this.pushHistory(this.view);
    this.bindControls();
    this.render();
    if (this.els.mapSearch) this.els.mapSearch.value = this.currentQuery;
    if (this.els.catalogueView) this.els.catalogueView.value = this.viewMode;
    if (this.els.catalogueSort) this.els.catalogueSort.value = this.sortMode;
    this.els.mapSearch.addEventListener('input', () => this.filter(this.els.mapSearch.value));
    this.els.mapSearch.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      const first = this.els.featureResults?.querySelector('.feature-result');
      if (!first) return;
      event.preventDefault();
      first.focus();
    });
    this.els.mapSearchClear?.addEventListener('click', () => {
      this.els.mapSearch.value = '';
      this.filter('');
      this.els.mapSearch.focus();
    });
  }

  bindControls() {
    this.els.catalogueBack?.addEventListener('click', () => this.goHistory(-1));
    this.els.catalogueForward?.addEventListener('click', () => this.goHistory(1));
    this.els.catalogueHome?.addEventListener('click', () => this.showHome());
    this.els.catalogueHistory?.addEventListener('click', () => this.toggleHistoryPanel());
    this.els.catalogueView?.addEventListener('change', () => {
      this.viewMode = normalizeViewMode(this.els.catalogueView.value || 'cards');
      this.savePreferences();
      this.writeCatalogueHash();
      this.render();
    });
    this.els.catalogueSort?.addEventListener('change', () => {
      this.sortMode = normalizeSortMode(this.els.catalogueSort.value || 'order');
      this.savePreferences();
      this.updateFilteredLayers();
      this.writeCatalogueHash();
      this.render();
    });
    document.addEventListener('click', (event) => {
      if (!this.els.catalogueHistoryPanel || this.els.catalogueHistoryPanel.classList.contains('hidden')) return;
      if (this.els.catalogueHistoryPanel.contains(event.target) || this.els.catalogueHistory?.contains(event.target)) return;
      this.closeHistoryPanel();
    });
  }

  applyHashState() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    this.currentQuery = params.get('q') || '';
    this.selectedCategory = params.get('category') || '';
    this.selectedProvider = params.get('provider') || '';
    this.viewMode = normalizeViewMode(params.get('catView') || this.viewMode);
    this.sortMode = normalizeSortMode(params.get('catSort') || this.sortMode);
    const collapsed = params.get('collapsed');
    if (collapsed) this.collapsed = new Set(collapsed.split('|').map(decodeURIComponent).filter(Boolean));
    const layerId = params.get('catalogue');
    if (!layerId || !this.metadataService.getLayer(layerId)) return;
    this.view = { type: 'detail', layerId };
  }

  async filter(query) {
    const token = ++this.searchToken;
    this.currentQuery = query.trim();
    this.updateFilteredLayers();
    this.featureResults = [];
    this.view = { type: 'home', layerId: null };
    this.pushHistory(this.view);
    this.writeCatalogueHash();
    this.render();
    const trimmed = query.trim();
    if (trimmed.length >= 3 && this.options.featureSearch) {
      try {
        const results = await this.options.featureSearch.search(trimmed, 32);
        if (token !== this.searchToken) return;
        this.featureResults = results;
        this.renderFeatureResults();
        this.options.onLayerStateChange?.();
      } catch (err) {
        this.options.onError?.(err);
      }
    }
  }

  render() {
    this.updateNav();
    this.renderFilters();
    this.renderFeatureResults();
    if (this.view.type === 'detail') {
      const layer = this.metadataService.getLayer(this.view.layerId);
      if (layer) return this.renderDetail(layer);
      this.view = { type: 'home', layerId: null };
    }
    this.renderHome();
  }

  renderHome() {
    this.els.catalogue.hidden = false;
    this.els.catalogueDetail.hidden = true;
    this.els.catalogue.innerHTML = '';
    this.els.catalogue.dataset.view = this.viewMode;
    if (this.els.catalogueStats) {
      const converted = this.filteredLayers.filter((layer) => layer.loadable !== false && layer.isConverted !== false).length;
      const unconverted = this.filteredLayers.length - converted;
      this.els.catalogueStats.textContent = `${this.filteredLayers.length} maps shown, ${converted} loadable, ${unconverted} not yet converted.`;
    }
    if (this.filteredLayers.length === 0) {
      this.els.catalogue.textContent = 'No test layers match that search.';
      return;
    }

    if (this.els.catalogueView) this.els.catalogueView.value = this.viewMode;
    if (this.els.catalogueSort) this.els.catalogueSort.value = this.sortMode;
    const fragment = document.createDocumentFragment();
    let rendered = 0;
    if (this.viewMode === 'table') {
      this.renderTableHome(fragment);
      this.els.catalogue.appendChild(fragment);
      return;
    }
    for (const group of groupByGroupAndCategory(this.filteredLayers, this.sortMode)) {
      const groupSection = document.createElement('section');
      groupSection.className = 'catalogue-group c1-card';
      const groupCollapsed = this.collapsed.has(group.name);
      groupSection.innerHTML = `
        <button type="button" class="catalogue-group__header" data-collapse-key="${escapeHtml(group.name)}" aria-expanded="${String(!groupCollapsed)}">
          <span>${escapeHtml(group.name)}</span>
          <b>${group.count}</b>
        </button>
        <div class="catalogue-group__body" ${groupCollapsed ? 'hidden' : ''}></div>
      `;
      const body = groupSection.querySelector('.catalogue-group__body');
      for (const category of group.categories) {
        if (rendered >= MAX_INITIAL_CARDS) break;
        const categorySection = document.createElement('section');
        categorySection.className = 'catalogue-section c1-card__section catalogue-flat__toc';
        categorySection.innerHTML = `
          <div class="c1-card__section-header">
            <h3>${escapeHtml(category.name)}</h3>
            <span>${category.layers.length}</span>
          </div>
        `;
        const list = document.createElement('div');
        list.className = `catalogue-list c1-card__section-members catalogue-flat__cards${this.viewMode === 'dense' ? ' catalogue-list--dense' : ''}`;
        for (const layer of category.layers) {
          if (rendered >= MAX_INITIAL_CARDS) break;
          list.appendChild(this.renderCard(layer));
          rendered += 1;
        }
        categorySection.appendChild(list);
        body.appendChild(categorySection);
      }
      groupSection.querySelector('[data-collapse-key]').addEventListener('click', (event) => {
        this.toggleCollapsed(event.currentTarget.dataset.collapseKey);
      });
      fragment.appendChild(groupSection);
      if (rendered >= MAX_INITIAL_CARDS) break;
    }
    this.els.catalogue.appendChild(fragment);

    if (this.filteredLayers.length > rendered) {
      const more = document.createElement('p');
      more.className = 'catalogue-list__more';
      more.textContent = `${this.filteredLayers.length - rendered} more layers match. Narrow the search to keep catalogue rendering fast.`;
      this.els.catalogue.appendChild(more);
    }
  }

  renderTableHome(fragment) {
    const table = document.createElement('table');
    table.className = 'catalogue-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Map</th>
          <th>Category</th>
          <th>Provider</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const body = table.querySelector('tbody');
    for (const layer of this.filteredLayers.slice(0, MAX_INITIAL_CARDS)) {
      body.appendChild(this.renderTableRow(layer));
    }
    fragment.appendChild(table);
    if (this.filteredLayers.length > MAX_INITIAL_CARDS) {
      const more = document.createElement('p');
      more.className = 'catalogue-list__more';
      more.textContent = `${this.filteredLayers.length - MAX_INITIAL_CARDS} more layers match. Narrow the search to keep catalogue rendering fast.`;
      fragment.appendChild(more);
    }
  }

  renderTableRow(layer) {
    const row = document.createElement('tr');
    const isConverted = layer.loadable !== false && layer.isConverted !== false;
    row.dataset.layerId = layer.id;
    row.innerHTML = `
      <td><strong>${escapeHtml(layer.name)}</strong><small>${escapeHtml(layer.group || '')}</small></td>
      <td>${escapeHtml(layer.category || 'Uncategorised')}</td>
      <td>${escapeHtml(formatProvider(layer.provider) || 'Unknown')}</td>
      <td><span class="${isConverted ? 'catalogue-table__status--ready' : 'catalogue-table__status--pending'}">${escapeHtml(isConverted ? 'Ready' : 'Not converted')}</span></td>
      <td>
        <button type="button" data-action="detail">Details</button>
        <button type="button" data-action="load" ${isConverted ? '' : 'disabled'}>Load</button>
      </td>
    `;
    row.addEventListener('click', (event) => this.handleLayerAction(event, layer));
    return row;
  }

  renderFilters() {
    if (!this.els.catalogueFilters) return;
    const categoryCounts = countBy(this.metadataService.layers, (layer) => layer.category || 'Uncategorised');
    const providerCounts = countBy(this.metadataService.layers, (layer) => formatProvider(layer.provider) || 'Unknown provider');
    this.els.catalogueFilters.innerHTML = `
      ${renderPillGroup('Category', 'category', categoryCounts, this.selectedCategory)}
      ${renderPillGroup('Provider', 'provider', providerCounts, this.selectedProvider)}
    `;
    this.els.catalogueFilters.querySelectorAll('[data-filter-kind]').forEach((button) => {
      button.addEventListener('click', () => {
        const kind = button.dataset.filterKind;
        const value = button.dataset.filterValue || '';
        if (kind === 'category') this.selectedCategory = value === this.selectedCategory ? '' : value;
        if (kind === 'provider') this.selectedProvider = value === this.selectedProvider ? '' : value;
        this.updateFilteredLayers();
        this.view = { type: 'home', layerId: null };
        this.pushHistory(this.view);
        this.writeCatalogueHash();
        this.render();
      });
    });
  }

  renderCard(layer) {
    const card = document.createElement('article');
    const isLoaded = this.controller.layers.has(layer.id);
    const isConverted = layer.loadable !== false && layer.isConverted !== false;
    card.className = `catalogue-card class-member${isLoaded ? ' catalogue-card--loaded' : ''}${isConverted ? '' : ' catalogue-card--unconverted'}`;
    card.dataset.layerId = layer.id;
    card.innerHTML = `
      <div class="catalogue-card__main class-member__info">
        <div class="class-member__titleblock">
          <p>${escapeHtml(layer.category || 'Map')}</p>
          <h3 class="class-member__name">${escapeHtml(layer.name)}</h3>
        </div>
        <span>${escapeHtml(isConverted ? (layer.sourceType || layer.renderer) : 'not yet converted')}</span>
      </div>
      <div class="class-member__content">
        ${renderWarningBadges(layer)}
        ${renderMetaLine(layer)}
        <p class="catalogue-card__notes">${escapeHtml(layer.notes || layer.description || fallbackDescription(layer))}</p>
        ${renderSourceSummaryRich(layer)}
        ${renderConversionSummary(layer)}
        ${renderVariantSummaryRich(layer)}
      </div>
      <div class="catalogue-card__actions class-member__actions">
        <button type="button" data-action="detail">Details</button>
        <button type="button" data-action="load" ${isConverted ? '' : 'disabled'}>${isLoaded ? 'Reload' : 'Load'}</button>
        <button type="button" data-action="fit" ${isConverted || layer.bounds ? '' : 'disabled'}>Fit</button>
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="unload" ${isLoaded ? '' : 'disabled'}>Unload</button>
      </div>
    `;
    card.addEventListener('click', (event) => this.handleLayerAction(event, layer));
    return card;
  }

  renderDetail(layer) {
    const isLoaded = this.controller.layers.has(layer.id);
    const isConverted = layer.loadable !== false && layer.isConverted !== false;
    this.els.catalogue.hidden = true;
    this.els.catalogueDetail.hidden = false;
    this.els.catalogueDetail.innerHTML = `
      <article class="catalogue-detail">
        <button type="button" class="catalogue-detail__back" data-action="home">Back to catalogue</button>
        <div class="catalogue-detail__card">
          <div class="catalogue-detail__color" style="background:${escapeHtml(layer.style?.fillColor || layer.style?.color || '#4f46e5')}"></div>
          <div class="catalogue-detail__name">${escapeHtml(layer.name)}</div>
          <div class="catalogue-detail__date">${escapeHtml([layer.category, layer.group, layer.dateEffective || layer.date].filter(Boolean).join(' - '))}</div>
        </div>
        <div class="catalogue-detail__badges">
          <span class="catalogue-detail__badge ${isConverted ? 'catalogue-detail__badge--group' : 'catalogue-detail__badge--hidden'}">${escapeHtml(isConverted ? 'MapLibre ready' : 'Not yet converted')}</span>
          <span class="catalogue-detail__badge">${escapeHtml(layer.sourceType || layer.recommendedTarget || 'source')}</span>
          ${layer.category ? `<span class="catalogue-detail__badge">${escapeHtml(layer.category)}</span>` : ''}
          ${layer.provider ? `<span class="catalogue-detail__badge">${escapeHtml(formatProvider(layer.provider))}</span>` : ''}
          ${layer.tilePackage?.preferred ? '<span class="catalogue-detail__badge">PMTiles CDN</span>' : ''}
          ${layer.keywords?.length ? '<span class="catalogue-detail__badge">keywords</span>' : ''}
        </div>
        ${layer.description || layer.notes ? `<div class="catalogue-detail__description">${escapeHtml(layer.description || layer.notes)}</div>` : ''}
        <div class="catalogue-detail__actions catalogue-detail__feature-actions">
          <button type="button" class="catalogue-detail__load-btn${isLoaded ? ' catalogue-detail__load-btn--loaded' : ''}" data-action="load" ${isConverted ? '' : 'disabled'}>${isLoaded ? 'Reload layer' : 'Load layer'}</button>
          <button type="button" class="panel-action" data-action="fit" ${isConverted || layer.bounds ? '' : 'disabled'}>Fit</button>
          <button type="button" class="panel-action" data-action="copy">Copy share URL</button>
          <button type="button" class="panel-action" data-action="unload" ${isLoaded ? '' : 'disabled'}>Unload</button>
        </div>
        ${renderDetailMeta(layer)}
        ${renderDetailLinks('References', layer.references || [])}
        ${renderDetailLinks('Downloads', (layer.sourceDownloads || []).map((item) => ({ label: item.label || 'Download', url: item.file || item.url })))}
        ${renderDetailSources(layer)}
        ${renderDetailVariants(layer)}
        ${renderDetailKeywords(layer)}
      </article>
    `;
    this.els.catalogueDetail.onclick = (event) => this.handleLayerAction(event, layer);
  }

  async handleLayerAction(event, layer) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    event.preventDefault();
    try {
      if (action === 'detail') return this.showDetail(layer.id);
      if (action === 'home') return this.showHome();
      if (action === 'load') {
        if (layer.loadable === false || layer.isConverted === false) return;
        await this.controller.loadLayer(layer);
      }
      if (action === 'fit') {
        if (this.controller.layers.has(layer.id)) this.controller.fitToLayer(layer.id);
        else if (layer.bounds) this.controller.fitToBounds(layer.bounds);
      }
      if (action === 'copy') await copyLayerShare(layer, this.controller);
      if (action === 'unload') this.controller.unloadLayer(layer.id);
      this.options.onLayerStateChange?.();
      this.render();
    } catch (err) {
      this.options.onError?.(err);
    }
  }

  showDetail(layerId) {
    this.view = { type: 'detail', layerId };
    this.pushHistory(this.view);
    this.writeCatalogueHash();
    this.render();
  }

  showHome() {
    this.view = { type: 'home', layerId: null };
    this.pushHistory(this.view);
    this.writeCatalogueHash();
    this.render();
  }

  pushHistory(view) {
    const current = this.history[this.historyIndex];
    if (current?.type === view.type && current?.layerId === view.layerId) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push({ ...view });
    this.historyIndex = this.history.length - 1;
  }

  goHistory(delta) {
    const next = this.historyIndex + delta;
    if (next < 0 || next >= this.history.length) return;
    this.historyIndex = next;
    this.view = { ...this.history[this.historyIndex] };
    this.writeCatalogueHash();
    this.render();
  }

  updateNav() {
    if (this.els.catalogueBack) this.els.catalogueBack.disabled = this.historyIndex <= 0;
    if (this.els.catalogueForward) this.els.catalogueForward.disabled = this.historyIndex >= this.history.length - 1;
    this.renderHistoryPanel();
  }

  toggleHistoryPanel() {
    if (!this.els.catalogueHistoryPanel) return;
    const open = this.els.catalogueHistoryPanel.classList.contains('hidden');
    this.els.catalogueHistoryPanel.classList.toggle('hidden', !open);
    this.els.catalogueHistory?.setAttribute('aria-expanded', String(open));
    if (open) this.renderHistoryPanel();
  }

  closeHistoryPanel() {
    this.els.catalogueHistoryPanel?.classList.add('hidden');
    this.els.catalogueHistory?.setAttribute('aria-expanded', 'false');
  }

  renderHistoryPanel() {
    if (!this.els.catalogueHistoryPanel) return;
    this.els.catalogueHistoryPanel.innerHTML = this.history.length ? `
      ${this.history.map((entry, index) => `
        <button type="button" data-history-index="${index}" class="${index === this.historyIndex ? 'catalogue-history__item--active' : ''}">
          <span>${escapeHtml(historyLabel(entry, this.metadataService))}</span>
          <small>${index === this.historyIndex ? 'Current' : entry.type}</small>
        </button>
      `).join('')}
    ` : '<p>No catalogue history yet.</p>';
    this.els.catalogueHistoryPanel.querySelectorAll('[data-history-index]').forEach((button) => {
      button.addEventListener('click', () => {
        this.historyIndex = Number(button.dataset.historyIndex);
        this.view = { ...this.history[this.historyIndex] };
        this.writeCatalogueHash();
        this.closeHistoryPanel();
        this.render();
      });
    });
  }

  updateFilteredLayers() {
    const queryMatches = this.metadataService.searchLayers(this.currentQuery);
    this.filteredLayers = queryMatches.filter((layer) => {
      if (this.selectedCategory && layer.category !== this.selectedCategory) return false;
      if (this.selectedProvider && formatProvider(layer.provider) !== this.selectedProvider) return false;
      return true;
    }).sort((a, b) => compareLayers(a, b, this.sortMode));
  }

  writeCatalogueHash() {
    const url = new URL(location.href);
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (this.view.type === 'detail' && this.view.layerId) params.set('catalogue', this.view.layerId);
    else params.delete('catalogue');
    if (this.currentQuery) params.set('q', this.currentQuery);
    else params.delete('q');
    if (this.selectedCategory) params.set('category', this.selectedCategory);
    else params.delete('category');
    if (this.selectedProvider) params.set('provider', this.selectedProvider);
    else params.delete('provider');
    if (this.viewMode !== 'cards') params.set('catView', this.viewMode);
    else params.delete('catView');
    if (this.sortMode !== 'order') params.set('catSort', this.sortMode);
    else params.delete('catSort');
    if (this.collapsed.size) params.set('collapsed', [...this.collapsed].map(encodeURIComponent).join('|'));
    else params.delete('collapsed');
    url.hash = params.toString();
    history.replaceState(null, '', url);
  }

  toggleCollapsed(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    writeCollapsed(this.collapsed);
    this.writeCatalogueHash();
    this.render();
  }

  savePreferences() {
    writePreferences({ viewMode: this.viewMode, sortMode: this.sortMode });
  }

  renderFeatureResults() {
    if (!this.els.featureResults) return;
    this.els.featureResults.innerHTML = '';
    if (!this.featureResults.length) return;
    const fragment = document.createDocumentFragment();
    const heading = document.createElement('p');
    heading.className = 'feature-results__heading';
    heading.textContent = `${this.featureResults.length} feature matches`;
    fragment.appendChild(heading);
    for (const group of groupFeatureResults(this.featureResults)) {
      const groupHeading = document.createElement('p');
      groupHeading.className = 'feature-results__group';
      groupHeading.textContent = `${group.layerName} (${group.results.length})`;
      fragment.appendChild(groupHeading);
      for (const result of group.results) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'feature-result';
        button.dataset.featureResult = result.id;
        button.innerHTML = `
          <strong>${highlightMatch(result.name, this.currentQuery)}</strong>
          <span><b>${escapeHtml(result.layerName)}</b>${result.category ? ` ${escapeHtml(result.category)}` : ''} - score ${Math.round(result.score || 0)}</span>
        `;
        button.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            focusSiblingResult(button, event.key === 'ArrowDown' ? 1 : -1);
          }
          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            focusEdgeResult(button, event.key === 'Home' ? 0 : -1);
          }
        });
        button.addEventListener('click', async () => this.selectFeatureResult(button, result));
        fragment.appendChild(button);
      }
    }
    this.els.featureResults.appendChild(fragment);
  }

  async selectFeatureResult(button, result) {
    try {
      const layer = this.metadataService.getLayer(result.layerId);
      if (!layer) return;
      await this.controller.loadLayer(layer);
      if (Array.isArray(result.center)) {
        this.controller.map.flyTo({ center: result.center, zoom: Math.max(this.controller.map.getZoom(), 11), duration: 250 });
      }
      this.controller.selectFeatureById(result.layerId, result.id, {
        id: result.id,
        label_name: result.name,
        name_en: result.name,
        aliases: result.aliases || []
      });
      this.els.featureResults.querySelectorAll('.feature-result--selected').forEach((item) => item.classList.remove('feature-result--selected'));
      button.classList.add('feature-result--selected');
      this.options.onLayerStateChange?.();
    } catch (err) {
      this.options.onError?.(err);
    }
  }
}

function groupByGroupAndCategory(layers, sortMode = 'order') {
  const groups = new Map();
  for (const layer of layers) {
    const groupName = layer.group || 'Maps';
    const categoryName = layer.category || 'Uncategorised';
    if (!groups.has(groupName)) groups.set(groupName, new Map());
    const categories = groups.get(groupName);
    if (!categories.has(categoryName)) categories.set(categoryName, []);
    categories.get(categoryName).push(layer);
  }
  return [...groups.entries()].map(([name, categories]) => ({
    name,
    count: [...categories.values()].reduce((sum, items) => sum + items.length, 0),
    categories: [...categories.entries()].map(([categoryName, groupLayers]) => ({
      name: categoryName,
      layers: groupLayers.sort((a, b) => compareLayers(a, b, sortMode))
    })).sort((a, b) => a.name.localeCompare(b.name))
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function countBy(layers, getValue) {
  const counts = new Map();
  for (const layer of layers) {
    const value = getValue(layer);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderPillGroup(label, kind, entries, activeValue) {
  if (!entries.length) return '';
  const visible = entries.slice(0, 10);
  if (activeValue && !visible.some(([value]) => value === activeValue)) {
    const activeEntry = entries.find(([value]) => value === activeValue);
    if (activeEntry) visible.push(activeEntry);
  }
  return `
    <div class="catalogue-filter-group">
      <span>${escapeHtml(label)}</span>
      <div>
        <button type="button" data-filter-kind="${escapeHtml(kind)}" data-filter-value="" class="${activeValue ? '' : 'catalogue-filter-pill--active'}">All</button>
        ${visible.map(([value, count]) => `
          <button type="button" data-filter-kind="${escapeHtml(kind)}" data-filter-value="${escapeHtml(value)}" class="${activeValue === value ? 'catalogue-filter-pill--active' : ''}">
            ${escapeHtml(value)} <small>${count}</small>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function historyLabel(entry, metadataService) {
  if (entry.type === 'detail') return metadataService.getLayer(entry.layerId)?.name || entry.layerId || 'Detail';
  return 'Catalogue home';
}

function compareLayers(a, b, mode = 'order') {
  if (mode === 'name') return a.name.localeCompare(b.name);
  if (mode === 'category') return `${a.category || ''} ${a.name}`.localeCompare(`${b.category || ''} ${b.name}`);
  if (mode === 'provider') return `${formatProvider(a.provider)} ${a.name}`.localeCompare(`${formatProvider(b.provider)} ${b.name}`);
  if (mode === 'status') return `${a.loadable === false ? '1' : '0'} ${a.name}`.localeCompare(`${b.loadable === false ? '1' : '0'} ${b.name}`);
  return (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
}

function groupFeatureResults(results) {
  const groups = new Map();
  for (const result of results) {
    const key = result.layerName || result.layerId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }
  return [...groups.entries()].map(([layerName, groupResults]) => ({ layerName, results: groupResults }));
}

function focusSiblingResult(button, delta) {
  const buttons = [...button.closest('.feature-results')?.querySelectorAll('.feature-result') || []];
  const index = buttons.indexOf(button);
  const next = buttons[index + delta];
  if (next) next.focus();
}

function focusEdgeResult(button, index) {
  const buttons = [...button.closest('.feature-results')?.querySelectorAll('.feature-result') || []];
  const next = index === -1 ? buttons.at(-1) : buttons[index];
  if (next) next.focus();
}

function highlightMatch(value, query) {
  const text = String(value || '');
  const q = String(query || '').trim();
  if (!q) return escapeHtml(text);
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(text.slice(index, index + q.length))}</mark>${escapeHtml(text.slice(index + q.length))}`;
}

function renderSourceSummaryRich(layer) {
  const bits = [formatProvider(layer.provider), layer.date || layer.dateEffective || layer.dateAdded, layer.status, layer.sourceMapId].filter(Boolean);
  const credits = (layer.sourceCredits || []).filter(Boolean);
  if (!bits.length && !credits.length && !layer.references?.length && !layer.sourceDownloads?.length) return '';
  const links = [
    ...(layer.references || []).slice(0, 2).map((ref, index) => `<a href="${escapeHtml(ref.url || ref.file || '#')}" target="_blank" rel="noopener">${escapeHtml(ref.label || `Ref ${index + 1}`)}</a>`),
    ...(layer.sourceDownloads || []).slice(0, 2).map((download) => `<a href="${escapeHtml(download.file || download.url || '#')}" target="_blank" rel="noopener">${escapeHtml(download.label || 'Source')}</a>`)
  ].join('');
  const creditText = credits.length ? `Credit: ${credits.join(', ')}` : '';
  return `<div class="catalogue-card__source"><span>${escapeHtml([bits.join(' - '), creditText].filter(Boolean).join(' - '))}</span>${links}</div>`;
}

function renderVariantSummaryRich(layer) {
  const count = layer.variants?.length || layer.variantCount || 0;
  if (!count) return '';
  return `<p class="catalogue-card__variants">${count} variant${count === 1 ? '' : 's'} available in main metadata.</p>`;
}

function renderMetaLine(layer) {
  const bits = [layer.group, layer.dateEffective || layer.date, layer.dateAdded ? `added ${layer.dateAdded}` : null, layer.recommendedTarget].filter(Boolean);
  if (!bits.length) return '';
  return `<p class="catalogue-card__meta">${escapeHtml(bits.join(' - '))}</p>`;
}

function renderWarningBadges(layer) {
  const badges = [];
  const bytes = Number(layer.generatedFrom?.bytes || layer.tilePackage?.bytes || 0);
  const maxTileBytes = Number(layer.generatedFrom?.maxTileBytes || 0);
  if (layer.sourceType === 'pmtiles') badges.push('PMTiles');
  if (bytes >= 50 * 1024 * 1024) badges.push('large layer');
  if (maxTileBytes >= 1024 * 1024) badges.push('large tiles');
  if (/townlands/i.test(`${layer.id} ${layer.name} ${layer.category}`)) badges.push('heavy');
  if (layer.warning) badges.push('warning');
  if (!badges.length) return '';
  return `<div class="catalogue-card__badges">${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</div>`;
}

function renderConversionSummary(layer) {
  if (layer.isConverted !== false && layer.loadable !== false) return '';
  const bits = [
    layer.conversionStatus || 'not-yet-converted',
    layer.unsupportedReason,
    layer.sourceFiles?.length ? `${layer.sourceFiles.length} source file(s) known` : null
  ].filter(Boolean);
  return `<p class="catalogue-card__conversion">${escapeHtml(bits.join(' - '))}</p>`;
}

function renderDetailMeta(layer) {
  const rows = [
    ['Status', layer.status || layer.conversionStatus],
    ['Provider', formatProvider(layer.provider)],
    ['Credits', (layer.sourceCredits || []).join(', ')],
    ['Source map ID', layer.sourceMapId || layer.id],
    ['Target', layer.recommendedTarget || layer.sourceType],
    ['Date', layer.dateEffective || layer.date || layer.dateAdded],
    ['Bounds', Array.isArray(layer.bounds) ? layer.bounds.flat().join(', ') : null]
  ].filter(([, value]) => value);
  return `
    <div class="catalogue-detail__meta">
      ${rows.map(([label, value]) => `
        <div class="catalogue-detail__meta-row">
          <span class="catalogue-detail__meta-label">${escapeHtml(label)}</span>
          <span class="catalogue-detail__meta-value">${escapeHtml(value)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDetailLinks(title, links) {
  const normalized = (links || [])
    .map((item, index) => ({
      label: item.label || `${title} ${index + 1}`,
      href: item.url || item.file,
      note: item.note || item.description || '',
      accessed: item.accessed || item.accessDate || ''
    }))
    .filter((item) => item.href)
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!normalized.length) return `
    <section class="catalogue-detail__section">
      <div class="catalogue-detail__section-title">${escapeHtml(title)}</div>
      <p class="catalogue-card__conversion">No ${escapeHtml(title.toLowerCase())} recorded.</p>
    </section>
  `;
  return `
    <section class="catalogue-detail__section">
      <div class="catalogue-detail__section-title">${escapeHtml(title)} (${normalized.length})</div>
      <div class="catalogue-detail__references">
        ${normalized.map((item, index) => `
          <div class="catalogue-detail__ref">
            <span class="catalogue-detail__ref-num">[${index + 1}]</span>
            <a href="${escapeHtml(item.href)}" target="_blank" rel="noopener">${escapeHtml(item.label)}</a>
            ${item.note ? `<span class="catalogue-detail__ref-note">${escapeHtml(item.note)}</span>` : ''}
            ${item.accessed ? `<span class="catalogue-detail__ref-accessed">Accessed ${escapeHtml(item.accessed)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderDetailSources(layer) {
  const files = layer.sourceFiles || [];
  if (!files.length) return '';
  return `
    <section class="catalogue-detail__section">
      <div class="catalogue-detail__section-title">Source files (${files.length})</div>
      <div class="catalogue-detail__references">
        ${files.slice(0, 10).map((item) => `
          <div class="catalogue-detail__ref catalogue-detail__source-file">
            <span class="catalogue-detail__meta-value--mono">${escapeHtml(item.kind || 'file')}</span>
            <span class="catalogue-detail__file-path">${escapeHtml(item.file || '')}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderDetailKeywords(layer) {
  const keywords = (layer.keywords || []).filter(Boolean).slice(0, 18);
  if (!keywords.length) return '';
  return `
    <section class="catalogue-detail__section">
      <div class="catalogue-detail__section-title">Keywords</div>
      <div class="catalogue-detail__keywords">
        ${keywords.map((keyword) => `<span class="catalogue-detail__keyword">${escapeHtml(keyword)}</span>`).join('')}
      </div>
    </section>
  `;
}

function renderDetailVariants(layer) {
  const count = layer.variants?.length || layer.variantCount || 0;
  if (!count) return '';
  return `
    <section class="catalogue-detail__section">
      <div class="catalogue-detail__section-title">Variants</div>
      <p class="catalogue-card__variants">${escapeHtml(String(count))} variant${count === 1 ? '' : 's'} are recorded in the main-site catalogue metadata.</p>
    </section>
  `;
}

function fallbackDescription(layer) {
  if (layer.loadable === false || layer.isConverted === false) return 'This catalogue entry is retained from the main site and awaits MapLibre/vector-tile conversion.';
  return '';
}

function formatProvider(provider) {
  if (Array.isArray(provider)) return provider.join(', ');
  return provider || '';
}

async function copyLayerShare(layer, controller) {
  const url = new URL(location.href);
  if (layer.loadable === false || layer.isConverted === false) {
    url.hash = `catalogue=${encodeURIComponent(layer.id)}`;
  } else {
    const layers = new Set(controller.layers.keys());
    layers.add(layer.id);
    url.hash = `layers=${[...layers].join(',')}`;
  }
  await navigator.clipboard.writeText(url.toString());
}

function readCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function writeCollapsed(value) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...value]));
  } catch {}
}

function readPreferences() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  } catch {
    return {};
  }
}

function writePreferences(value) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(value));
  } catch {}
}

function normalizeViewMode(value) {
  return ['cards', 'dense', 'table'].includes(value) ? value : 'cards';
}

function normalizeSortMode(value) {
  return ['order', 'name', 'category', 'provider', 'status'].includes(value) ? value : 'order';
}
