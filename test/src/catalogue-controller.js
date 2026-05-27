import { escapeHtml } from './utils.js';

const MAX_INITIAL_CARDS = 80;

export class TestCatalogue {
  constructor(els, metadataService, controller, options = {}) {
    this.els = els;
    this.metadataService = metadataService;
    this.controller = controller;
    this.options = options;
    this.filteredLayers = [];
    this.featureResults = [];
    this.searchToken = 0;
  }

  init() {
    this.filteredLayers = this.metadataService.layers;
    this.render();
    this.els.mapSearch.addEventListener('input', () => this.filter(this.els.mapSearch.value));
  }

  async filter(query) {
    const token = ++this.searchToken;
    this.filteredLayers = this.metadataService.searchLayers(query);
    this.featureResults = [];
    this.render();
    const trimmed = query.trim();
    if (trimmed.length >= 3 && this.options.featureSearch) {
      try {
        const results = await this.options.featureSearch.search(trimmed, 8);
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
    this.els.catalogue.innerHTML = '';
    this.renderFeatureResults();
    if (this.filteredLayers.length === 0) {
      this.els.catalogue.textContent = 'No test layers match that search.';
      return;
    }

    const grouped = groupLayers(this.filteredLayers);
    const fragment = document.createDocumentFragment();
    let rendered = 0;
    for (const group of grouped) {
      const section = document.createElement('section');
      section.className = 'catalogue-section';
      section.innerHTML = `<h3>${escapeHtml(group.name)}</h3>`;
      const list = document.createElement('div');
      list.className = 'catalogue-list';
      for (const layer of group.layers) {
        if (rendered >= MAX_INITIAL_CARDS) break;
        list.appendChild(this.renderCard(layer));
        rendered += 1;
      }
      section.appendChild(list);
      fragment.appendChild(section);
      if (rendered >= MAX_INITIAL_CARDS) break;
    }
    this.els.catalogue.appendChild(fragment);

    if (this.filteredLayers.length > rendered) {
      const more = document.createElement('p');
      more.className = 'catalogue-list__more';
      more.textContent = `${this.filteredLayers.length - rendered} more layers match. Narrow the search to avoid rendering unnecessary catalogue DOM.`;
      this.els.catalogue.appendChild(more);
    }
  }

  renderCard(layer) {
    const card = document.createElement('article');
    const isLoaded = this.controller.layers.has(layer.id);
    const isConverted = layer.loadable !== false && layer.isConverted !== false;
    card.className = `catalogue-card${isLoaded ? ' catalogue-card--loaded' : ''}${isConverted ? '' : ' catalogue-card--unconverted'}`;
    card.dataset.layerId = layer.id;
    card.innerHTML = `
      <div class="catalogue-card__main">
        <div>
          <p>${escapeHtml(layer.category || 'Map')}</p>
          <h3>${escapeHtml(layer.name)}</h3>
        </div>
        <span>${escapeHtml(isConverted ? (layer.sourceType || layer.renderer) : 'not yet converted')}</span>
      </div>
      ${renderMetaLine(layer)}
      <p class="catalogue-card__notes">${escapeHtml(layer.notes || layer.description || '')}</p>
      ${renderSourceSummaryRich(layer)}
      ${renderConversionSummary(layer)}
      ${renderVariantSummaryRich(layer)}
      <div class="catalogue-card__actions">
        <button type="button" data-action="load" ${isConverted ? '' : 'disabled'}>${isLoaded ? 'Reload' : 'Load'}</button>
        <button type="button" data-action="fit" ${isConverted || layer.bounds ? '' : 'disabled'}>Fit</button>
        <button type="button" data-action="unload" ${isLoaded ? '' : 'disabled'}>Unload</button>
      </div>
    `;
    card.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.action;
      if (!action) return;
      try {
        if (action === 'load') {
          if (!isConverted) return;
          await this.controller.loadLayer(layer);
        }
        if (action === 'fit') {
          if (isLoaded) this.controller.fitToLayer(layer.id);
          else if (layer.bounds) this.controller.fitToBounds(layer.bounds);
        }
        if (action === 'unload') this.controller.unloadLayer(layer.id);
        this.options.onLayerStateChange?.();
      } catch (err) {
        this.options.onError?.(err);
      }
    });
    return card;
  }

  renderFeatureResults() {
    if (!this.els.featureResults) return;
    this.els.featureResults.innerHTML = '';
    if (!this.featureResults.length) return;
    const fragment = document.createDocumentFragment();
    const heading = document.createElement('p');
    heading.className = 'feature-results__heading';
    heading.textContent = 'Feature matches';
    fragment.appendChild(heading);
    for (const result of this.featureResults) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'feature-result';
      button.innerHTML = `
        <strong>${escapeHtml(result.name)}</strong>
        <span>${escapeHtml(result.layerName)}</span>
      `;
      button.addEventListener('click', async () => {
        try {
          const layer = this.metadataService.getLayer(result.layerId);
          if (!layer) return;
          await this.controller.loadLayer(layer);
          if (Array.isArray(result.center)) {
            this.controller.map.flyTo({ center: result.center, zoom: Math.max(this.controller.map.getZoom(), 11), duration: 350 });
          }
          this.controller.selectFeatureById(result.layerId, result.id, {
            id: result.id,
            label_name: result.name,
            name_en: result.name,
            aliases: result.aliases || []
          });
          this.options.onLayerStateChange?.();
        } catch (err) {
          this.options.onError?.(err);
        }
      });
      fragment.appendChild(button);
    }
    this.els.featureResults.appendChild(fragment);
  }
}

function groupLayers(layers) {
  const groups = new Map();
  for (const layer of layers) {
    const key = layer.group || layer.category || 'Maps';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(layer);
  }
  return [...groups.entries()].map(([name, groupLayers]) => ({
    name,
    layers: groupLayers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
  }));
}

function renderSourceSummary(layer) {
  const bits = [layer.provider, layer.status, layer.sourceMapId].filter(Boolean);
  if (!bits.length && !layer.references?.length && !layer.sourceDownloads?.length) return '';
  const links = [
    ...(layer.references || []).slice(0, 2).map((ref, index) => `<a href="${escapeHtml(ref.url || ref.file || '#')}" target="_blank" rel="noopener">Ref ${index + 1}</a>`),
    ...(layer.sourceDownloads || []).slice(0, 2).map((download) => `<a href="${escapeHtml(download.file || '#')}" target="_blank" rel="noopener">${escapeHtml(download.label || 'Source')}</a>`)
  ].join('');
  return `<div class="catalogue-card__source"><span>${escapeHtml(bits.join(' · '))}</span>${links}</div>`;
}

function renderVariantSummary(layer) {
  if (!layer.variants?.length) return '';
  return `<p class="catalogue-card__variants">${layer.variants.length} variants available in metadata.</p>`;
}

function renderSourceSummaryRich(layer) {
  const bits = [formatProvider(layer.provider), layer.date || layer.dateEffective || layer.dateAdded, layer.status, layer.sourceMapId].filter(Boolean);
  const credits = (layer.sourceCredits || []).filter(Boolean);
  if (!bits.length && !credits.length && !layer.references?.length && !layer.sourceDownloads?.length) return '';
  const links = [
    ...(layer.references || []).slice(0, 3).map((ref, index) => `<a href="${escapeHtml(ref.url || ref.file || '#')}" target="_blank" rel="noopener">${escapeHtml(ref.label || `Ref ${index + 1}`)}</a>`),
    ...(layer.sourceDownloads || []).slice(0, 3).map((download) => `<a href="${escapeHtml(download.file || '#')}" target="_blank" rel="noopener">${escapeHtml(download.label || 'Source')}</a>`)
  ].join('');
  const creditText = credits.length ? `Credit: ${credits.join(', ')}` : '';
  return `<div class="catalogue-card__source"><span>${escapeHtml([bits.join(' - '), creditText].filter(Boolean).join(' - '))}</span>${links}</div>`;
}

function renderVariantSummaryRich(layer) {
  const count = layer.variants?.length || layer.variantCount || 0;
  if (!count) return '';
  return `<p class="catalogue-card__variants">${count} variants available in metadata.</p>`;
}

function renderMetaLine(layer) {
  const bits = [layer.group, layer.dateEffective || layer.date, layer.dateAdded ? `added ${layer.dateAdded}` : null, layer.recommendedTarget].filter(Boolean);
  if (!bits.length) return '';
  return `<p class="catalogue-card__meta">${escapeHtml(bits.join(' - '))}</p>`;
}

function renderConversionSummary(layer) {
  if (layer.isConverted !== false && layer.loadable !== false) return '';
  const bits = [
    layer.conversionStatus || 'not-yet-converted',
    layer.unsupportedReason,
    layer.sourceFiles?.length ? `${layer.sourceFiles.length} source file(s)` : null
  ].filter(Boolean);
  return `<p class="catalogue-card__conversion">${escapeHtml(bits.join(' - '))}</p>`;
}

function formatProvider(provider) {
  if (Array.isArray(provider)) return provider.join(', ');
  return provider || '';
}
