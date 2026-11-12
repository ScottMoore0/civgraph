/**
 * Catalogue search: the search box, the search worker (packages/map/app/search-worker.js) and the in-page fallback.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../ui-controller.js';
import dataService from '../data-service.js';
import { normalizeSearchText } from './helpers.mjs';

export class SearchMethods {
  setupSearch() {
    uiController.initializeFuse = () => {
      // The promoted MapLibre shell renders search results in the catalogue
      // body. Keep Fuse.js out of the critical path; search-worker/simple
      // fallback paths below provide the runtime search contract.
      uiController.fuse = null;
      uiController.searchItems = [];
    };
    const mapResultsProvider = (query, limit = 1000) => this.searchCatalogueWithWorker(query, limit);
    uiController.performSearch = async (query) => {
      const trimmed = String(query || '').trim();
      uiController.hideAutocomplete?.();
      this.searchQuery = trimmed;
      uiController._catalogueSearchQuery = trimmed;
      if (!trimmed) {
        this.workerSearchQuery = '';
        this.workerSearchResultIds = null;
        uiController.clearCatalogueSearchResults?.({ render: true });
        this.updateURLState();
        return [];
      }
      const ids = await mapResultsProvider(trimmed, 1000);
      if (this.searchQuery !== trimmed) return [];
      this.workerSearchQuery = trimmed;
      this.workerSearchResultIds = ids;
      await uiController.renderCatalogueSearchResults?.(trimmed, { mapResultIds: ids, mapResultsProvider });
      this.updateURLState();
      return ids;
    };
    uiController.onSearch = (query) => {
      const trimmed = String(query || '').trim();
      this.searchQuery = trimmed;
      uiController._catalogueSearchQuery = trimmed;
      if (!trimmed) {
        this.workerSearchQuery = '';
        this.workerSearchResultIds = null;
        uiController.clearCatalogueSearchResults?.({ render: true });
        this.updateMapList();
        this.updateURLState();
        return;
      }
      uiController.performSearch(trimmed).catch((error) => {
        console.warn('[App] Catalogue search failed:', error);
      });
    };
    uiController.setupSearch();
    // Enter searches addresses once (Nominatim) while suggestions-as-you-type are paused; see
    // packages/map/src/catalogue/geocoder.js. With suggestions running it does nothing extra.
    document.getElementById('searchInput')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      uiController._catalogueNext?.searchAddressesNow?.(event.target.value);
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.overflow-menu')) {
        document.querySelectorAll('.overflow-menu--open').forEach((menu) => menu.classList.remove('overflow-menu--open'));
      }
    }, { signal: this.lifecycle.signal });
  }

  prepareSearchWorker() {
    if (!('Worker' in window)) return;
    try {
      this.searchWorker = new Worker('/app/src/search-worker.js?v=app-search-001', { type: 'module' });
      this.searchWorker.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.type === 'ready') {
          this.searchWorkerReady.set(true);
          return;
        }
        if (message.type === 'results') {
          const callback = this.searchWorkerCallbacks.get(message.seq);
          if (!callback) return;
          this.searchWorkerCallbacks.delete(message.seq);
          callback.resolve(Array.isArray(message.ids) ? message.ids : []);
        }
      });
      this.searchWorker.addEventListener('error', () => {
        this.searchWorkerReady.set(false);
      });
      this.searchWorker.postMessage({
        type: 'init',
        maps: dataService.getAllMaps().map((map) => ({
          id: map.id,
          name: map.name,
          category: map.category,
          group: map.group,
          provider: map.provider,
          description: map.description,
          date: map.date,
          dateRange: map.dateRange,
          keywords: map.keywords
        }))
      });
    } catch (error) {
      console.warn('[Test2] Search worker unavailable', error);
      this.searchWorker = null;
    }
  }

  async searchCatalogueWithWorker(query, limit = 200) {
    const trimmed = String(query || '').trim();
    if (!trimmed || trimmed.length < 1) return [];
    if (!this.searchWorker) return this.simpleSearchMapIds(trimmed, limit);
    const seq = ++this.searchWorkerSeq;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.searchWorkerCallbacks.delete(seq);
        resolve(this.simpleSearchMapIds(trimmed, limit));
      }, 900);
      this.searchWorkerCallbacks.set(seq, {
        resolve: (ids) => {
          clearTimeout(timeout);
          resolve(ids);
        }
      });
      this.searchWorker.postMessage({ type: 'search', query: trimmed, limit, seq });
    });
  }

  searchMapsForCatalogue(query, allMaps) {
    if (this.workerSearchQuery === query && Array.isArray(this.workerSearchResultIds)) {
      const idSet = new Set(this.workerSearchResultIds);
      return allMaps.filter((map) => idSet.has(map.id));
    }
    const fallbackIds = new Set(this.simpleSearchMapIds(query, 1000));
    return allMaps.filter((map) => fallbackIds.has(map.id));
  }

  simpleSearchMapIds(query, limit = 200) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return dataService.getAllMaps()
      .map((map) => {
        const text = normalizeSearchText([
          map.id,
          map.name,
          map.category,
          map.group,
          map.provider,
          map.description,
          map.date,
          map.dateRange,
          ...(Array.isArray(map.keywords) ? map.keywords : [])
        ].flat().filter(Boolean).join(' '));
        const name = normalizeSearchText(map.name || '');
        if (!terms.every((term) => text.includes(term))) return null;
        const score = terms.reduce((sum, term) => sum + (name.startsWith(term) ? 100 : (name.includes(term) ? 60 : 10)), 0);
        return { id: map.id, score, name: map.name || '' };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((item) => item.id);
  }
}
