/**
 * The source panel: the sources and share link of a loaded layer, and "Features here".
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import { escapeHtml } from './helpers.mjs';
import { creditLine, mergedDerivedFromLines } from '../../../core/src/credits.mjs';
import uiController from '../ui-controller.js';
import dataService from '../data-service.js';
import { setHidden } from '../state-helpers.mjs';

/**
 * The app as these methods see it. featuresHereKeepOpen is a flag field Test2App's constructor
 * defines (defineFlagFields): the Features-here list stays open across the next details shown.
 * @typedef {import('./map-app').MapApp & SourcePanelMethods & { featuresHereKeepOpen: boolean }} SourcePanelApp
 */
/** @typedef {import('../../app/maplibre-main-adapter.js').RuntimeLayer} RuntimeLayer */
/** A reference or download as the panel reads it: a link with its note. @typedef {import('../../../types/index.js').SourceLink & { file?: string, note?: string, description?: string }} SourceLinkView */
/** The catalogue's record of a map, the fields the panel reads. @typedef {{ id?: string, name?: string, provider?: string | string[], sourceCredits?: unknown, description?: string, references?: SourceLinkView[], sourceDownloads?: SourceLinkView[] }} SourceConfigView */
/** A layer's sources: its id, its layer in the map index and its catalogue record. @typedef {{ id: string, layer: RuntimeLayer | null, mainConfig: import('../data-service.js').CatalogueMap | null }} SourceRecord */
/** A link the panel lists. @typedef {{ label: string, url?: string, note?: string }} SourcePanelLink */
/** @typedef {import('./map-app').LayerOrGroupState} LayerOrGroupState */

export class SourcePanelMethods {
  /** @this {SourcePanelApp} */
  setupSourcePanel() {
    if (document.getElementById('test2SourcePanel')) return;
    const panel = document.createElement('aside');
    panel.id = 'test2SourcePanel';
    panel.className = 'test2-source-panel hidden';
    panel.setAttribute('aria-label', 'Layer sources');
    panel.innerHTML = `
      <div class="test2-source-panel__header">
        <h3>Sources</h3>
        <button type="button" id="test2SourcePanelClose" class="test2-source-panel__close" aria-label="Close sources">Close</button>
      </div>
      <div id="test2SourcePanelContent" class="test2-source-panel__content">Load a layer to inspect sources.</div>
    `;
    document.body.appendChild(panel);
    document.getElementById('test2SourcePanelClose')?.addEventListener('click', () => this.closeSourcePanel());
  }

  /**
   * "Features here": every feature of the visible layers under the point clicked, so a reader
   * can show another one (a ward under a constituency, the 1911 union under the 1851 one) in the
   * feature details without hunting for a spot where it is on top.
   * @this {SourcePanelApp}
   * @param {{ mapId?: string, featureName?: unknown, name?: unknown } | null} current the feature the details show
   */
  addFeaturesHereList(current) {
    const entries = this.mapController?.featuresAtLastClick?.() || [];
    const content = document.getElementById('featureInfoContent');
    const section = content?.querySelector('.feature-info__section');
    if (!section || entries.length < 2) return;
    /** @param {{ mapId: string, featureName: unknown }} entry */
    const isCurrent = (entry) => current && entry.mapId === current.mapId
      && String(entry.featureName) === String(current.featureName || current.name || '');
    const wrap = document.createElement('div');
    wrap.className = 'feature-info__here';
    const listId = 'featureInfoHereList';
    wrap.innerHTML = `<button type="button" class="feature-info__here-btn" aria-expanded="false" aria-controls="${listId}">${entries.length} here</button>
      <ul id="${listId}" class="feature-info__here-list" hidden>${entries.map((entry, i) => `<li><button type="button" data-here="${i}"${isCurrent(entry) ? ' aria-current="true"' : ''}><span class="feature-info__here-name">${escapeHtml(entry.featureName)}</span><span class="feature-info__here-layer">${escapeHtml(entry.layerName || '')}</span></button></li>`).join('')}</ul>`;
    // Both are in the markup just written.
    const toggle = /** @type {HTMLButtonElement} */ (wrap.querySelector('.feature-info__here-btn'));
    const list = /** @type {HTMLUListElement} */ (wrap.querySelector('ul'));
    /** @param {boolean} open */
    const setOpen = (open) => { setHidden(list, !open); toggle.setAttribute('aria-expanded', String(open)); };
    toggle.addEventListener('click', () => setOpen(list.hidden));
    list.addEventListener('click', (event) => {
      const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button[data-here]'));
      if (!button) return;
      this.featuresHereKeepOpen = true;
      /** @type {import('./map-app').MapControllerView} */ (this.mapController).selectFeatureAtClick(entries[Number(button.dataset.here)]);
    });
    // The button sits at the end of the layer-name line; the list opens beneath it.
    const headerRow = section.querySelector('.feature-info__header-row');
    if (headerRow) {
      headerRow.appendChild(toggle);
      headerRow.after(wrap);
    } else section.prepend(wrap);
    if (this.featuresHereKeepOpen) setOpen(true);
    this.featuresHereKeepOpen = false;
  }

  /**
   * A layer's name in the Active Layers list opens its page in the catalogue pane (what the "i"
   * button did, which went to save width; owner, 1 Nov 2026). Enter or Space does the same.
   * @this {SourcePanelApp}
   */
  bindActiveLayerSourceButtons() {
    const rows = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#activeLayersList .active-layer-item[data-map-id]'));
    rows.forEach((row) => {
      const name = /** @type {HTMLElement | null} */ (row.querySelector('.active-layer-item__name'));
      const mapId = row.dataset.mapId;
      if (!name || !mapId || name.dataset.opensPage) return;
      name.dataset.opensPage = '1';
      name.classList.add('active-layer-item__name--link');
      name.setAttribute('role', 'button');
      name.setAttribute('tabindex', '0');
      name.title = "Open this map's page";
      const open = () => {
        // Reveal the catalogue pane if the app is in map-only mode.
        if (uiController.currentStateId === 'map-full') uiController.setSplitState('info-full');
        uiController.showCatalogueDetailView(mapId);
      };
      name.addEventListener('click', open);
      name.addEventListener('keydown', (/** @type {KeyboardEvent} */ event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        open();
      });
    });
  }

  /** @this {SourcePanelApp} @param {string | null | undefined} mapId */
  openSourcePanel(mapId) {
    this.currentSourceMapId = mapId || null;
    const panel = document.getElementById('test2SourcePanel');
    if (!panel || !this.currentSourceMapId) return;
    panel.classList.remove('hidden');
    this.renderSourcePanel();
    this.updateURLState();
  }

  /** @this {SourcePanelApp} */
  closeSourcePanel() {
    this.currentSourceMapId = null;
    document.getElementById('test2SourcePanel')?.classList.add('hidden');
    this.updateURLState();
  }

  /** @this {SourcePanelApp} */
  async renderSourcePanel() {
    const content = document.getElementById('test2SourcePanelContent');
    if (!content) return;
    const records = await this.getSourceRecords(this.currentSourceMapId);
    if (!records.length) {
      content.textContent = 'No source metadata is available for this layer yet.';
      return;
    }
    content.innerHTML = records.map((record) => this.renderSourceRecord(record)).join('');
    /** @type {NodeListOf<HTMLElement>} */ (content.querySelectorAll('[data-copy-source-link]')).forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard?.writeText(button.dataset.copySourceLink || '');
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Failed';
        }
      });
    });
  }

  /** @this {SourcePanelApp} @param {string | null} mapId @returns {Promise<SourceRecord[]>} */
  async getSourceRecords(mapId) {
    if (!mapId) return [];
    const groupState = /** @type {LayerOrGroupState | null | undefined} */ (/** @type {import('./map-app').MapControllerView} */ (this.mapController).getLayerState(mapId));
    const childIds = groupState?.isGroup
      ? groupState.childIds || []
      : this.getConvertedCompositeChildIds(dataService.getMapById(mapId));
    const ids = childIds.length ? childIds : [mapId];
    const records = /** @type {SourceRecord[]} */ (ids
      .map((id) => {
        const layer = /** @type {import('./map-app').MapControllerView} */ (this.mapController).resolveLayer(id);
        const mainConfig = dataService.getMapById(id) || dataService.getMapById(layer?.sourceMapId) || null;
        if (!layer && !mainConfig) return null;
        return { id, layer, mainConfig };
      })
      .filter(Boolean));
    await Promise.all(records.map((record) => record.layer?.id
      ? /** @type {import('../renderer/metadata-service.js').TestMetadataService} */ (this.metadataService).loadLayerDetails(record.layer.id).catch(() => null)
      : null));
    return records;
  }

  /** @this {SourcePanelApp} @param {SourceRecord} record */
  renderSourceRecord(record) {
    const layer = /** @type {Partial<RuntimeLayer>} */ (record.layer || {});
    const mainConfig = /** @type {SourceConfigView} */ (record.mainConfig || {});
    const title = layer.name || mainConfig.name || record.id;
    // The provider, then what a layer built from other people's maps was derived from (packages/core/src/credits.mjs).
    const provider = creditLine([layer.provider, mainConfig.provider].flat(2).filter(Boolean).map(String), mergedDerivedFromLines(layer.sourceCredits, mainConfig.sourceCredits));
    const sourceId = layer.sourceMapId || mainConfig.id || record.id;
    const references = /** @type {SourceLinkView[]} */ ([...(mainConfig.references || []), ...(layer.references || [])]);
    const downloads = /** @type {SourceLinkView[]} */ ([...(mainConfig.sourceDownloads || []), ...(layer.sourceDownloads || [])]);
    const technical = /** @type {SourcePanelLink[]} */ ([
      layer.tileUrl ? { label: 'PMTiles archive', url: layer.tileUrl } : null,
      layer.metadataUrl ? { label: 'Tile metadata', url: layer.metadataUrl } : null,
      layer.tilesFallback ? { label: 'Directory tile fallback', url: layer.tilesFallback.replace('/{z}/{x}/{y}.pbf', '/metadata.json') } : null
    ].filter(Boolean));
    const share = this.buildLayerShareUrl(sourceId);
    return `
      <article class="test2-source-panel__record" data-source-map-id="${escapeHtml(sourceId)}">
        <header>
          <h4>${escapeHtml(title)}</h4>
          <button type="button" data-copy-source-link="${escapeHtml(share)}">Copy layer</button>
        </header>
        <dl>
          ${provider ? `<div><dt>Provider</dt><dd>${escapeHtml(provider)}</dd></div>` : ''}
          <div><dt>Source ID</dt><dd>${escapeHtml(sourceId)}</dd></div>
          ${layer.sourceType ? `<div><dt>Format</dt><dd>${escapeHtml(layer.sourceType)}</dd></div>` : ''}
        </dl>
        ${mainConfig.description || layer.description ? `<p>${escapeHtml(mainConfig.description || layer.description)}</p>` : ''}
        ${this.renderSourceLinks('References', references.map((item, index) => ({
          label: item.label || `Reference ${index + 1}`,
          url: item.url || item.file,
          note: item.note || item.description
        })))}
        ${this.renderSourceLinks('Downloads', downloads.map((item, index) => ({
          label: item.label || `Download ${index + 1}`,
          url: item.file || item.url,
          note: item.note || item.description
        })))}
        ${this.renderSourceLinks('Tiles', technical)}
      </article>
    `;
  }

  /** @this {SourcePanelApp} @param {string} title @param {SourcePanelLink[]} links */
  renderSourceLinks(title, links) {
    const validLinks = links.filter((link) => link.url);
    if (!validLinks.length) {
      return `<details class="test2-source-panel__group"><summary>${escapeHtml(title)} <span>0</span></summary><p>No ${escapeHtml(title.toLowerCase())} recorded.</p></details>`;
    }
    return `
      <details class="test2-source-panel__group" open>
        <summary>${escapeHtml(title)} <span>${validLinks.length}</span></summary>
        ${validLinks.map((link) => `
          <div class="test2-source-panel__link-row">
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>
            ${link.note ? `<small>${escapeHtml(link.note)}</small>` : ''}
            <button type="button" data-copy-source-link="${escapeHtml(link.url)}">Copy</button>
          </div>
        `).join('')}
      </details>
    `;
  }

  /** @this {SourcePanelApp} @param {string} mapId */
  buildLayerShareUrl(mapId) {
    const url = new URL(location.href);
    const params = this.getCurrentURLParams();
    params.set('layers', mapId);
    url.hash = params.toString();
    return url.toString();
  }
}
