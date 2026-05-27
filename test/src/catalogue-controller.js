import { escapeHtml } from './utils.js';

const MAX_INITIAL_CARDS = 80;

export class TestCatalogue {
  constructor(els, metadataService, controller, options = {}) {
    this.els = els;
    this.metadataService = metadataService;
    this.controller = controller;
    this.options = options;
    this.filteredLayers = [];
  }

  init() {
    this.filteredLayers = this.metadataService.layers;
    this.render();
    this.els.mapSearch.addEventListener('input', () => this.filter(this.els.mapSearch.value));
  }

  filter(query) {
    this.filteredLayers = this.metadataService.searchLayers(query);
    this.render();
  }

  render() {
    this.els.catalogue.innerHTML = '';
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
    card.className = `catalogue-card${isLoaded ? ' catalogue-card--loaded' : ''}`;
    card.dataset.layerId = layer.id;
    card.innerHTML = `
      <div class="catalogue-card__main">
        <div>
          <p>${escapeHtml(layer.category || 'Map')}</p>
          <h3>${escapeHtml(layer.name)}</h3>
        </div>
        <span>${escapeHtml(layer.sourceType || layer.renderer)}</span>
      </div>
      <p class="catalogue-card__notes">${escapeHtml(layer.notes || layer.description || '')}</p>
      ${renderSourceSummary(layer)}
      ${renderVariantSummary(layer)}
      <div class="catalogue-card__actions">
        <button type="button" data-action="load">${isLoaded ? 'Reload' : 'Load'}</button>
        <button type="button" data-action="fit">Fit</button>
        <button type="button" data-action="unload">Unload</button>
      </div>
    `;
    card.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.action;
      if (!action) return;
      try {
        if (action === 'load') await this.controller.loadLayer(layer);
        if (action === 'fit') this.controller.fitToLayer(layer.id);
        if (action === 'unload') this.controller.unloadLayer(layer.id);
        this.options.onLayerStateChange?.();
      } catch (err) {
        this.options.onError?.(err);
      }
    });
    return card;
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
