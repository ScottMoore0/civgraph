/**
 * The election pane as the app sees it: loading the election manager (app/src/election-manager.js) on
 * demand, opening an election, the draggable pane splitter, refitting the map after the pane opens, and
 * which loaded layers belong to the active election.
 *
 * Methods of the map app (Test2App, app/src/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import { parseLayerOrder } from './layer-order.mjs';
import uiController from '../../ui-controller.js';

export class ElectionPaneMethods {
  /**
   * Re-fit the map once the election results pane has taken its space.
   *
   * UX plan T3-08 (#96), "12 of 18 constituencies below the fold". The fit itself was
   * never broken -- loadMap fits correctly, and measured before the pane opens the view
   * contains the whole layer (south edge 51.168 against the layer's 51.389). The pane
   * then opens, the map container goes from 736px to 374px at 1280x800, and MapLibre
   * keeps the camera where it was. The view loses 2.3 degrees of latitude and the
   * southern third of an all-island election is simply off-screen.
   *
   * So this is a RE-fit after a resize, not a first fit.
   *
   * SKIPPED WHILE RESTORING FROM A URL. A viewport in the URL is an explicit request and
   * must win; re-fitting would silently discard the lng/lat/zoom someone shared.
   */
  refitAfterElectionPane(sourceMapId) {
    if (!sourceMapId || this._restoringURLState) return;
    const map = this.mapController?.map;
    if (!map) return;
    // Measure the container first. Without this the fit is computed against the
    // pre-pane height and lands in exactly the place this exists to correct.
    map.resize();
    this.mapController.fitToLayer?.(sourceMapId);
    // The layout is not finished when the pane opens: the catalogue pane changes width a
    // moment later (src/catalogue/split.js) and the pane slides up, so that fit was made for a
    // larger map than the one left. Fit again each time the map's box changes over the next
    // second, then stop listening, so a reader's own panning is never undone.
    const container = map.getContainer?.();
    if (!container || typeof ResizeObserver === 'undefined') return;
    this._electionRefitObserver?.disconnect();
    let last = `${container.clientWidth}x${container.clientHeight}`;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const size = `${container.clientWidth}x${container.clientHeight}`;
      if (size === last) return;
      last = size;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (this.elections?.activeEntry?.sourceMapId !== sourceMapId) return;
        map.resize();
        this.mapController.fitToLayer?.(sourceMapId);
      });
    });
    this._electionRefitObserver = observer;
    observer.observe(container);
    setTimeout(() => {
      if (this._electionRefitObserver !== observer) return;
      observer.disconnect();
      this._electionRefitObserver = null;
    }, 1200);
  }

  setupElectionPaneResize() {
    if (this._electionPaneResizeReady) return;
    this._electionPaneResizeReady = true;
    const storageKey = 'civgraph:test2:electionPaneHeight';
    const minPaneHeight = 120;
    const defaultPaneHeight = () => Math.round(Math.min(window.innerHeight * 0.30, Math.max(minPaneHeight, window.innerHeight * 0.26)));
    const parseCssPx = (value, fallback) => {
      const number = Number.parseFloat(String(value || '').trim());
      return Number.isFinite(number) ? number : fallback;
    };
    const maxPaneHeight = () => {
      const rootStyle = getComputedStyle(document.body);
      const header = document.querySelector('.app-header')?.getBoundingClientRect().height || parseCssPx(rootStyle.getPropertyValue('--header-height'), 64);
      const mapMin = parseCssPx(rootStyle.getPropertyValue('--map-min-height'), 220);
      const timeline = document.getElementById('timelineSlider');
      const timelineHeight = timeline && !timeline.classList.contains('hidden')
        ? timeline.getBoundingClientRect().height
        : 0;
      return Math.max(minPaneHeight, window.innerHeight - header - mapMin - timelineHeight - 6);
    };
    const isPhoneLayout = () => Boolean(window.matchMedia?.('(max-width: 768px)')?.matches);
    const clampPaneHeight = (height) => Math.max(minPaneHeight, Math.min(maxPaneHeight(), Math.round(height)));
    const invalidateMapSize = () => {
      requestAnimationFrame(() => this.mapController?.invalidateSize?.());
    };
    const applyPaneHeightCss = (height) => {
      const cssValue = `${height}px`;
      document.documentElement.style.setProperty('--test2-election-pane-height', cssValue);
      document.body.style.setProperty('--test2-election-pane-height', cssValue);
      document.querySelector('.app-shell')?.style.setProperty('--test2-election-pane-height', cssValue);
    };
    const setPaneHeight = (height, options = {}) => {
      const { invalidate = true, persist = true } = options || {};
      const nextHeight = clampPaneHeight(height);
      this._electionPaneHeight = nextHeight;
      applyPaneHeightCss(nextHeight);
      if (persist) {
        try {
          localStorage.setItem(storageKey, String(nextHeight));
        } catch {
          // Ignore storage failures; resizing must still work in private modes.
        }
      }
      if (invalidate) invalidateMapSize();
      this.syncElectionPaneResizerAria();
      return nextHeight;
    };
    // The resizer is a separator with a value, so it must always say its value and range, not
    // only once a drag or key press has set them (UX review 2026-10-30, #13).
    this.syncElectionPaneResizerAria = () => {
      const handle = document.querySelector('[data-election-pane-resize]');
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      const now = Math.round(this._electionPaneHeight || pane?.getBoundingClientRect().height || defaultPaneHeight());
      handle.setAttribute('aria-valuemin', String(minPaneHeight));
      handle.setAttribute('aria-valuemax', String(Math.round(maxPaneHeight())));
      handle.setAttribute('aria-valuenow', String(now));
      handle.setAttribute('aria-valuetext', `${now} pixels tall`);
    };
    try {
      const savedHeight = Number.parseFloat(localStorage.getItem(storageKey) || '');
      if (Number.isFinite(savedHeight)) {
        setPaneHeight(savedHeight, { invalidate: false, persist: false });
      }
    } catch {
      // Ignore storage failures; the CSS default remains available.
    }
    const resizeSavedHeight = () => {
      let savedHeight = NaN;
      try {
        savedHeight = parseCssPx(localStorage.getItem(storageKey), NaN);
      } catch {
        savedHeight = NaN;
      }
      const current = this._electionPaneHeight || savedHeight;
      if (Number.isFinite(current)) setPaneHeight(current, { invalidate: true, persist: false });
    };
    window.addEventListener('resize', () => requestAnimationFrame(resizeSavedHeight), { passive: true });
    const getResizeTarget = (target) => {
      const explicit = target.closest?.('[data-election-pane-resize]');
      if (explicit) return explicit;
      const header = target.closest?.('.election-pane__header');
      if (!header) return null;
      const interactive = target.closest?.('button,a,input,select,textarea,[role="button"],[data-election-view],[data-election-entity],[data-election-result-key]');
      return interactive ? null : (document.querySelector('[data-election-pane-resize]') || header);
    };
    const startDrag = (event) => {
      const handle = getResizeTarget(event.target);
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      if (!pane?.classList.contains('election-results-pane--open')) return;
      event.preventDefault();
      event.stopPropagation();
      const phone = isPhoneLayout();
      // On a phone the folded bar opens with the finger once it moves, or to the default
      // height on a plain tap; a tap must not fold it straight back on release.
      let folded = phone && document.body.classList.contains('test2-election-collapsed');
      const startY = event.clientY;
      let moved = false;
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture can fail on some synthetic/mobile events; window listeners cover it.
      }
      document.body.classList.add('test2-election-pane-resizing');
      handle.setAttribute('aria-valuemin', String(minPaneHeight));
      handle.setAttribute('aria-valuemax', String(maxPaneHeight()));
      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        if (!moved && Math.abs(moveEvent.clientY - startY) < 6) return;
        moved = true;
        if (folded) {
          folded = false;
          this.elections?.setPaneCollapsed?.(false, { refit: false });
        }
        const nextHeight = setPaneHeight(window.innerHeight - moveEvent.clientY, { invalidate: false, persist: false });
        handle.setAttribute('aria-valuenow', String(nextHeight));
      };
      const onEnd = () => {
        document.body.classList.remove('test2-election-pane-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        const current = this._electionPaneHeight || pane.getBoundingClientRect().height || defaultPaneHeight();
        if (phone && !moved) {
          if (folded) {
            this.elections?.setPaneCollapsed?.(false, { refit: false });
            setPaneHeight(defaultPaneHeight(), { invalidate: false, persist: true });
            if (this.elections?.activeEntry?.sourceMapId) this.refitAfterElectionPane(this.elections.activeEntry.sourceMapId);
          }
          return;
        }
        if (phone) {
          // Phones snap to three heights: folded to the seat strip, the default, or as tall as
          // the map allows. A free height is fiddly with a thumb and easily left half-way.
          if (current < minPaneHeight + 40) {
            this.elections?.setPaneCollapsed?.(true);
            return;
          }
          const stops = [defaultPaneHeight(), maxPaneHeight()];
          const nearest = stops.reduce((best, stop) => (Math.abs(stop - current) < Math.abs(best - current) ? stop : best), stops[0]);
          setPaneHeight(nearest, { invalidate: false, persist: true });
          invalidateMapSize();
          if (this.elections?.activeEntry?.sourceMapId) this.refitAfterElectionPane(this.elections.activeEntry.sourceMapId);
          return;
        }
        setPaneHeight(current, { invalidate: false, persist: true });
        invalidateMapSize();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    };
    document.addEventListener('pointerdown', startDrag);
    document.addEventListener('keydown', (event) => {
      const handle = getResizeTarget(event.target);
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      if (!pane?.classList.contains('election-results-pane--open')) return;
      const current = pane.getBoundingClientRect().height || defaultPaneHeight();
      const step = event.shiftKey ? 50 : 20;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(current + step)));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(current - step)));
      } else if (event.key === 'Home') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(maxPaneHeight())));
      } else if (event.key === 'End') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(minPaneHeight)));
      }
    });
    document.addEventListener('dblclick', (event) => {
      if (!getResizeTarget(event.target)) return;
      event.preventDefault();
      setPaneHeight(defaultPaneHeight());
    });
  }

  async ensureElections(options = {}) {
    if (this.elections?.catalogue) return this.elections;
    if (!this.electionModulePromise) {
      this.electionModulePromise = import('../../../app/src/election-manager.js');
    }
    const { Test2ElectionManager } = await this.electionModulePromise;
    if (!this.elections) {
      this.elections = new Test2ElectionManager({
        app: this,
        mapController: this.mapController,
        onError: (error) => this.showMapError(error)
      });
      if (window.__civgraphTest2) window.__civgraphTest2.elections = this.elections;
    }
    if (!this.electionLoadPromise) {
      this.electionLoadPromise = this.elections.load();
    }
    await this.electionLoadPromise;
    if (options.refreshCatalogue) this.updateMapList();
    return this.elections;
  }

  scheduleElectionCatalogueWarm() {
    if (this.electionCatalogueWarmScheduled || this.elections?.catalogue) return;
    this.electionCatalogueWarmScheduled = true;
    const warm = () => {
      this.ensureElections({ refreshCatalogue: true }).catch((error) => {
        console.warn('[Test2] Election catalogue warmup failed', error);
      });
    };
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hasElectionState = this.hasElectionURLState(params, parseLayerOrder(params.get('layers')));
    const timeout = hasElectionState ? 1200 : 6000;
    this.scheduleIdleTask(warm, { timeout });
  }

  /** Open an election as the catalogue would (loading panel, errors with a Retry, announcements). */
  openElection(body, date) {
    return uiController.onLoadElection?.(body, date);
  }

  hasElectionURLState(params, layers = []) {
    if ([...layers].some((id) => String(id).startsWith('election-'))) return true;
    return params.has('electionBody') || params.has('electionDate') || params.has('electionMode') || params.has('electionView');
  }

  unloadActiveElectionForLayer(mapId) {
    if (!mapId || !this.elections?.activeEntry) return false;
    if (!this.isActiveElectionLayerId(mapId)) return false;
    const backingLayerIds = this.getActiveElectionBackingLayerIds(mapId);
    this.elections.unloadElection({ unloadBackingLayer: false });
    for (const layerId of backingLayerIds) {
      if (this.mapController.getLayerState(layerId) || this.mapController.groupStates?.has(layerId)) {
        this.mapController.unloadLayer(layerId);
      }
    }
    return true;
  }

  isActiveElectionLayerId(mapId) {
    if (!mapId || !this.elections?.activeEntry) return false;
    const activeElectionIds = this.getActiveElectionLayerIds();
    const candidateIds = this.getMapUnloadCandidateIds(mapId);
    return [...candidateIds].some((candidateId) => activeElectionIds.has(candidateId));
  }

  getActiveElectionLayerIds() {
    if (!this.elections?.activeEntry) return new Set();
    const activeEntry = this.elections.activeEntry;
    const activeBundle = this.elections.activeBundle;
    return new Set([
      this.elections.getCanonicalLayerId?.(activeEntry),
      activeEntry?.sourceMapId,
      activeBundle?.sourceMapId,
      activeBundle?.layerId
    ].filter(Boolean));
  }

  getActiveElectionBackingLayerIds(mapId) {
    const activeEntry = this.elections?.activeEntry;
    const activeBundle = this.elections?.activeBundle;
    const backingIds = new Set([
      activeEntry?.sourceMapId,
      activeBundle?.sourceMapId,
      activeBundle?.layerId
    ].filter(Boolean));
    const candidateIds = this.getMapUnloadCandidateIds(mapId);
    const requestedBackingIds = [...candidateIds].filter((candidateId) => backingIds.has(candidateId));
    return requestedBackingIds.length ? requestedBackingIds : [...backingIds];
  }
}
