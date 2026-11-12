/**
 * The catalogue map list: category pills, the list refresh, the public map count and the active election
 * entry.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../ui-controller.js';
import dataService from '../data-service.js';
import featureLoader from '../feature-loader.js';
import { publicMaps } from '../public-map.mjs';

export class CatalogueListMethods {
  renderCategoryPills() {
    uiController.renderCategoryPills(dataService.getMapCategories(), this.currentCategory);
    uiController.renderProviderPills(this.currentProviderCategory);
  }

  updateMapList() {
    const allMaps = dataService.getAllMaps();
    let maps = dataService.getMapsByCategory(this.currentCategory);

    if (this.currentAuthor !== 'all') {
      const authors = Array.isArray(this.currentAuthor) ? this.currentAuthor : [this.currentAuthor];
      maps = maps.filter((map) => authors.some((author) => map.provider?.includes(author)));
    }

    if (this.currentProviderCategory !== 'all-providers' && this.currentProviderList.length > 0) {
      maps = maps.filter((map) => {
        const providers = Array.isArray(map.provider) ? map.provider : map.provider ? [map.provider] : [];
        return providers.some((provider) => this.currentProviderList.includes(provider));
      });
    }

    if (this.searchQuery) {
      maps = this.searchMapsForCatalogue(this.searchQuery, allMaps);
      if (this.currentCategory !== 'all') maps = maps.filter((map) => map.category === this.currentCategory);
    }

    const featureCounts = new Map();
    maps.forEach((map) => {
      const count = featureLoader.getFeatureCount(map.id);
      if (count > 0) featureCounts.set(map.id, count);
    });

    uiController.renderMapList(maps, {
      visibleIds: this.mapController.getVisibleLayers(),
      loadedIds: this.getLoadedLayerIds(),
      featureCounts,
      totalMaps: this.publicMapCount(),
      // `shown` counted a DIFFERENT set from `total`, which is how "1,012 of 893 maps"
      // happened: a filtered count under the old rule against a total under the new one.
      shownMaps: Math.min(maps.length, this.publicMapCount())
    });
  }

  /**
   * The number the catalogue shows as "N maps".
   *
   * It used to be getAllMaps().length, which filters only `hidden` -- so the homepage
   * counted placeholders (dates known but not digitised, which cannot be looked at) and
   * reported 1,0xx while /browse reported 993 and the file holds 1,031 entries. Three
   * numbers for one question.
   *
   * The rule is in packages/map/src/public-map.mjs and is shared with build-browse-indexes.mjs, so the
   * two surfaces cannot drift again. Loadability is decided by the RENDER record, because
   * the DoBIH layers carry no catalogue `files` yet draw perfectly.
   */
  publicMapCount() {
    // READ the stamped number; do not recompute it. Computing it here from the browser's
    // catalogue copy produced "1,012 of 893 maps" -- a third wrong answer -- because that
    // copy is not byte-identical to the file the other surfaces measure.
    // build-render-time-series-chains.mjs stamps it, and check:public-map-count pins it.
    const stamped = this.metadataService?.metadata?.publicMapCount;
    if (Number.isFinite(stamped)) return stamped;
    // Fallback only for a metadata load that has not landed yet.
    const layerIds = new Set((this.metadataService?.layers || []).map((layer) => layer.sourceMapId).filter(Boolean));
    return publicMaps(dataService.maps?.maps || [], (id) => layerIds.has(id)).length;
  }

  focusActiveElectionCatalogueEntry(entry, options = {}) {
    if (!entry?.body || !entry?.date) return;
    // An election opened from a party, person or constituency page leaves the reader on that
    // page: putting the catalogue list back under them lost the page they came from.
    if (this.currentPage && !document.getElementById('catalogueDetailView')?.classList.contains('hidden')) return;
    const restoreCatalogueListState = () => {
      this.searchQuery = '';
      this.currentCategory = 'all';
      this.currentProviderCategory = 'all-providers';
      this.currentProviderList = [];
      const search = document.getElementById('searchInput');
      if (search) search.value = '';
      document.getElementById('searchClear')?.classList.remove('visible');
      uiController.showCatalogueListView?.(false);
      this.updateMapList();
    };
    // The catalogue opens on a table of contents. Election rows exist only inside a
    // decade card that has been opened, so restoring an election from a URL used to have
    // nothing to mark: focusRow ran, saw rows: 0, and returned. It appeared to work only
    // when some earlier interaction had already opened a decade -- which is why the
    // browser test for it passed in company and failed alone.
    //
    // Open the decade that holds the election. The decade table lives in
    // ui-controller.js (decadeDefs); rather than copy those 12 rows here and let the two
    // drift, read the decade buttons the TOC has already rendered and match on label.
    // A decade the catalogue does not offer is therefore a no-op, not a wrong guess.
    const openDecadeForEntry = async () => {
      const year = Number.parseInt(String(entry.date).slice(0, 4), 10);
      if (!Number.isFinite(year)) return;
      const label = `${Math.floor(year / 10) * 10}s`;
      const button = [...document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc-decade-btn')]
        .find((el) => el.textContent.trim() === label);
      const targetId = button?.dataset?.catalogueTarget;
      if (!targetId) return;
      // ensureCatalogueTargetRendered returns early when the card is already open, so
      // retrying is free. Deliberately NOT handleFlatTocClick: that pushes a history
      // entry, and restoring state from a URL must not rewrite the URL it came from.
      await uiController.ensureCatalogueTargetRendered?.(targetId, 'elections');
    };

    // Budget in TIME, not in frames. The first version of this retried across four
    // animation frames -- about 60ms -- and the decade buttons it needs are not in the
    // DOM that early on a cold load, so every attempt found nothing and gave up before
    // the catalogue had rendered. Measured: clicking the decade button yields 170 rows
    // and the marking below then works, so the failure was purely one of timing.
    const FOCUS_DEADLINE_MS = 8000;
    const FOCUS_POLL_MS = 120;
    const focusDeadline = performance.now() + FOCUS_DEADLINE_MS;
    let listStateRestored = false;
    const focusRow = () => {
      const rows = [...document.querySelectorAll('#catalogueFlatView .flat-election-entry')];
      const target = rows.find((row) => row.dataset.electionBody === entry.body && row.dataset.electionDate === entry.date);
      if (!target) {
        if (performance.now() >= focusDeadline) return;
        if (!listStateRestored) {
          listStateRestored = true;
          restoreCatalogueListState();
        }
        Promise.resolve(openDecadeForEntry())
          .catch(() => {})
          .then(() => setTimeout(focusRow, FOCUS_POLL_MS));
        return;
      }
      rows.forEach((row) => {
        const active = row === target;
        row.classList.toggle('class-member--loaded', active);
        row.classList.toggle('flat-election-entry--active', active);
        const button = row.querySelector('.election-load-btn');
        if (button) button.setAttribute('title', active ? 'Unload' : 'Load');
      });
      target.querySelector('.election-load-btn')?.setAttribute('title', 'Unload');
      if (options.scroll) {
        const scroller = target.closest('.pane__content') || document.querySelector('.pane__content[data-tab-content="catalogue"]');
        if (scroller?.scrollTo) {
          scroller.scrollTo({ top: Math.max(0, target.offsetTop - 72), behavior: 'auto' });
        } else {
          target.scrollIntoView({ block: 'nearest' });
        }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(focusRow));
  }
}
