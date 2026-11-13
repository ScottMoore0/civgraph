/**
 * Opening a grouped year (packages/map/src/election/grouped-years.mjs): a year of pre-1973 Northern
 * Ireland council elections, drawn by packages/map/app/ni-local-view.js.
 *
 * Methods of the election manager (Test2ElectionManager, packages/map/app/election-manager.js), installed
 * on its prototype by installMethods: `this` is the manager. Moved out of election-manager.js
 * (frontend plan section 5.1) without changing behaviour.
 */
import { NiLocalGroupedView } from '../../app/ni-local-view.js';

/** @typedef {import('./election-manager').ElectionManager} ElectionManager */
/** @typedef {import('./election-manager').ElectionEntry} ElectionEntry */

export class GroupedYearMethods {
  /**
   * A year of pre-1973 Northern Ireland council elections (packages/map/app/ni-local-view.js): the year's
   * rounds at the reader's level (or `level`), coloured by votes or seats. Opening it is a step
   * Back can undo, as for any election; the timeline steps through the years.
   * @this {ElectionManager}
   * @param {ElectionEntry} entry
   * @param {{ keepView?: boolean, level?: string | null, show?: string | null, members?: string | null, area?: string | null }} [options]
   */
  async loadNiLocalGroup(entry, { keepView = false, level = null, show = null, members = null, area = null } = {}) {
    const requestId = ++this.loadSerial;
    if (!keepView) this.app.beginNavigation?.(`Opened ${entry.displayTitle}`);
    if (this.activeEntry && this.activeEntry.key !== entry.key) this.unloadElection({ updateURL: false });
    else if (this.niLocal?.active) this.closeGroupedYearLayers();
    this.renderLoadingPanel(entry);
    if (!this.niLocal) this.niLocal = new NiLocalGroupedView(this);
    try {
      await this.niLocal.open(entry, { keepView, level, show, members, area });
    } catch (error) {
      if (requestId === this.loadSerial) {
        this.closeGroupedYearLayers();
        // Written through the manager's type: a plain `this.x =` here would declare x on this class.
        /** @type {ElectionManager} */ (this).activeEntry = null;
        /** @type {ElectionManager} */ (this).activeBundle = null;
        this.removePanel();
        this.app.syncCatalogueMapState();
        this.app.updateActiveLayers();
      }
      this.app.navigationPush?.clear();
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const wrapped = new Error(`${entry.displayTitle} could not be loaded: ${offline ? 'you appear to be offline' : 'its results or map did not arrive'}.`);
      wrapped.cause = error;
      throw wrapped;
    }
    if (requestId !== this.loadSerial) return;
    this.removeElectionOverlays();
    this.updateElectionTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    const sourceMapId = this.niLocal.sourceMapId();
    if (sourceMapId && !keepView) this.app.refitAfterElectionPane?.(sourceMapId);
    this.app.focusActiveElectionCatalogueEntry?.(this.activeEntry, { scroll: false });
    if (!keepView && this.app.endNavigation) this.app.endNavigation();
    else this.app.updateURLState();
  }

  /**
   * Take the open year's drawing off the map, with the boundary layers it loaded.
   * @this {ElectionManager}
   */
  closeGroupedYearLayers() {
    // Called only while a year is open, so the view is there.
    /** @type {NiLocalGroupedView} */ (this.niLocal).teardown();
    this.unloadElectionBackingLayers(/** @type {NiLocalGroupedView} */ (this.niLocal).backingLayerIds());
    /** @type {NiLocalGroupedView} */ (this.niLocal).forgetLoadedLayers();
  }
}
