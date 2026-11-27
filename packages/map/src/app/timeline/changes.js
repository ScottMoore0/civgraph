/**
 * Boundary changes between consecutive editions on the timeline (scripts/build/timeline-changes.py): the
 * change index, the remembered "Highlight changes" switch, the changes panel with its "Changes since"
 * menu (which pair or pairs: since.mjs), the map markers, and the older/newer edition roles of two
 * editions of one series.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import dataService from '../../data-service.js';
import { formatHectares, timelineChangeName } from './dates.mjs';
import { TIMELINE_FIRST_EDITION_TEXT, timelineChangesPanelHtml } from '../../views/timeline-view.mjs';
import { setHidden } from '../../state-helpers.mjs';
import {
  limitTimelineSinceSteps, movedHectares, resolveTimelineSinceIndex, timelineChangeKind, timelineSinceOptions, timelineSinceSteps, timelineSinceSummary,
} from './since.mjs';
import { siteNumber } from '../../../../core/src/format.js';

// Boundary changes between consecutive editions (scripts/build/timeline-changes.py). They
// replace the Play-only transition overlays of data/timeline-transition-overlays/.
const TIMELINE_CHANGES_BASE_PATH = '/data/timeline-changes';

const TIMELINE_HIGHLIGHT_STORAGE_KEY = 'civgraph:timelineHighlightChanges';

// "Changes since" an edition far back lists the latest steps that have changes, up to this many
// change files fetched, and says how many earlier steps it left out.
const TIMELINE_CHANGES_MAX_FILES = 20;

const TIMELINE_CHANGES_MAX_MARKERS = 200;

/** The changes button's label for each kind of comparison (since.mjs timelineChangeKind). @type {Record<import('./since.mjs').TimelineChangeKind, (count: number) => string>} */
const TIMELINE_CHANGES_BUTTON_LABEL = {
  changes: (count) => (count === 1 ? '1 change' : `${siteNumber(count)} changes`),
  redrawn: () => 'Redrawn',
  none: () => 'No changes',
  unavailable: () => 'Not compared',
  first: () => 'First edition'
};

/** @typedef {import('../map-app').MapApp & TimelineChangeMethods} TimelineChangeApp */
/** @typedef {import('../map-app').TimelineItem} TimelineItem */
/** @typedef {import('../map-app').TimelineChange} TimelineChange */
/** @typedef {import('../map-app').TimelineChangeFile} TimelineChangeFile */
/** @typedef {import('../map-app').TimelineChangeState} TimelineChangeState */
/** @typedef {import('../map-app').TimelineChangeIndexEntry} TimelineChangeIndexEntry */

/** One step between consecutive stops (getTimelineChangeSteps). @typedef {{ id: string, fromMapId: string, toMapId: string, fromItem: TimelineItem, toItem: TimelineItem, entry: TimelineChangeIndexEntry | null }} TimelineChangeStep */

export class TimelineChangeMethods {
  /* ------------------------------------------------------------------------------------------
   * Boundary changes on the timeline (reviewer report, Phelim, 2026-11-01).
   *
   * Dragging the slider only swapped one edition for the next: colours stayed the same, a
   * change of a few townlands was invisible at island zoom, and only Play mode showed an
   * overlay -- for Counties, one that painted the whole island purple. Every step now draws
   * what changed between the edition that was shown and the one now shown, from
   * data/timeline-changes/ (scripts/build/timeline-changes.py), and the "N changes" button
   * beside the date lists them with a zoom-to for each.
   * ------------------------------------------------------------------------------------------ */

  /** @this {TimelineChangeApp} */
  async loadTimelineChangeIndex() {
    try {
      const response = await fetch(`${TIMELINE_CHANGES_BASE_PATH}/index.json`, { cache: 'default' });
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (!response.ok || contentType.includes('text/html')) return;
      const index = /** @type {{ pairs?: Record<string, TimelineChangeIndexEntry> } | null} */ (await response.json());
      /** @type {Record<string, TimelineChangeIndexEntry>} */
      this.timelineChangeIndex = index?.pairs && typeof index.pairs === 'object' ? index.pairs : {};
    } catch {
      this.timelineChangeIndex = {};
    }
  }

  /** @this {TimelineChangeApp} */
  getTimelineHighlightEnabled() {
    try {
      return localStorage.getItem(TIMELINE_HIGHLIGHT_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  /**
   * @this {TimelineChangeApp}
   * @param {unknown} value
   */
  setTimelineHighlightEnabled(value) {
    try { localStorage.setItem(TIMELINE_HIGHLIGHT_STORAGE_KEY, value ? '1' : '0'); } catch { /* private mode */ }
    const toggle = document.getElementById('timelineHighlight');
    toggle?.setAttribute('aria-checked', value ? 'true' : 'false');
    this.drawTimelineChanges();
  }

  /**
   * The index of the timeline stop whose edition is on the map now, or -1. With two editions of the
   * series on together it is the later one, where the slider stands (getCurrentTimelineTimestamp
   * takes the latest date of the layers loaded): the first one found was the earlier, so the panel
   * described an edition the slider was not on.
   * (A default parameter is checked against the class, not the typed this: there it reaches the app's
   * other methods through a cast, as the app is what installMethods makes `this`.)
   * @this {TimelineChangeApp}
   * @param {TimelineItem[]} [items]
   * @returns {number}
   */
  getShownTimelineIndex(items = /** @type {TimelineChangeApp} */ (/** @type {unknown} */ (this)).getTimelineAnimationItems()) {
    const list = Array.isArray(items) ? items : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const mapId = list[i]?.mapId;
      if (mapId && this.isMapLoaded(mapId) && this.isMapVisible(mapId)) return i;
    }
    return -1;
  }

  /**
   * The earliest other edition of the series on the map with the one at stop `shown`, or null. Two
   * editions on together (the older drawn grey and dashed, updateEditionRoles) were how two editions
   * were compared before the "Changes since" menu, and a shared address keeps both in its layers=
   * list: the panel lists the later one's changes since the earlier.
   * @this {TimelineChangeApp}
   * @param {TimelineItem[]} items
   * @param {number} shown
   * @returns {string | null}
   */
  getLoadedEarlierEdition(items, shown) {
    const shownMapId = items[shown]?.mapId;
    for (let i = 0; i < shown; i += 1) {
      const mapId = items[i]?.mapId;
      if (mapId && mapId !== shownMapId && this.isMapLoaded(mapId) && this.isMapVisible(mapId)) return mapId;
    }
    return null;
  }

  /**
   * The consecutive pairs from stop `fromIndex` to stop `toIndex`, oldest first (since.mjs
   * timelineSinceSteps), each with its items and its entry in the change index.
   * @this {TimelineChangeApp}
   * @param {number} fromIndex
   * @param {number} toIndex
   * @param {TimelineItem[]} [items]
   * @returns {TimelineChangeStep[]}
   */
  getTimelineChangeSteps(fromIndex, toIndex, items = /** @type {TimelineChangeApp} */ (/** @type {unknown} */ (this)).getTimelineAnimationItems()) {
    return timelineSinceSteps(items, fromIndex, toIndex).map((step) => ({
      id: step.id,
      fromMapId: step.fromMapId,
      toMapId: step.toMapId,
      // timelineSinceSteps pairs only stops that hold a map, so both items exist.
      fromItem: /** @type {TimelineItem} */ (items[step.fromIndex]),
      toItem: /** @type {TimelineItem} */ (items[step.toIndex]),
      entry: this.timelineChangeIndex?.[step.id] || null
    }));
  }

  /**
   * @this {TimelineChangeApp}
   * @param {string | null | undefined} path
   * @returns {Promise<TimelineChangeFile | null>}
   */
  fetchTimelineChangePair(path) {
    if (!path) return Promise.resolve(null);
    const url = path.startsWith('/') ? path : `/${path}`;
    if (!this.timelineChangeCache.has(url)) {
      this.timelineChangeCache.set(url, fetch(url, { cache: 'default' })
        .then((response) => {
          const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
          return response.ok && !contentType.includes('text/html') ? /** @type {Promise<TimelineChangeFile | null>} */ (response.json()) : null;
        })
        .catch(() => null));
    }
    return /** @type {Promise<TimelineChangeFile | null>} */ (this.timelineChangeCache.get(url));
  }

  /**
   * The changes of the edition at stop `selectedIndex` since an earlier edition of the series:
   * `options.sinceMapId`'s (the "Changes since" menu), else the edition directly before it. Called
   * after every timeline step (drag, previous/next, latest, Play), whichever way the slider moved,
   * and for a map opened some other way (syncTimelineChangesToShownEdition). The first edition
   * gets the "nothing earlier to compare" view. It is drawn unless the reader has switched
   * highlighting off, and stays until the next step; `draw: false` only describes it, for the button.
   * @this {TimelineChangeApp}
   * @param {number} selectedIndex
   * @param {TimelineItem[]} [items]
   * @param {{ draw?: boolean, sinceMapId?: string | null }} [options]
   * @returns {Promise<TimelineChangeState | null>}
   */
  async showTimelineChangesFor(selectedIndex, items = /** @type {TimelineChangeApp} */ (/** @type {unknown} */ (this)).getTimelineAnimationItems(), options = {}) {
    const token = (this.timelineChangeToken = (this.timelineChangeToken || 0) + 1);
    const toItem = items[selectedIndex];
    if (!toItem?.mapId) {
      this.setTimelineChangeView(null);
      return null;
    }
    const fromIndex = resolveTimelineSinceIndex(items, selectedIndex, options.sinceMapId);
    const sinceOptions = timelineSinceOptions(items, selectedIndex, (item) => this.formatTimelineItemLabel(/** @type {TimelineItem} */ (item)));
    const { listed, skipped } = limitTimelineSinceSteps(this.getTimelineChangeSteps(fromIndex, selectedIndex, items), TIMELINE_CHANGES_MAX_FILES, (step) => Boolean(step.entry?.path));
    // While a step's own changes load, a layer change elsewhere must not replace them with the
    // undrawn description syncTimelineChangesToShownEdition gives a newly opened map.
    if (options.draw !== false) this.timelineChangeStepPending = token;
    /** @type {Array<TimelineChangeFile | null>} */
    let files;
    try {
      files = await Promise.all(listed.map((step) => this.fetchTimelineChangePair(step.entry?.path)));
    } finally {
      if (this.timelineChangeStepPending === token) this.timelineChangeStepPending = 0;
    }
    if (token !== this.timelineChangeToken) return null;
    const fromItem = fromIndex >= 0 ? items[fromIndex] : undefined;
    const view = this.buildTimelineChangeView(listed, files, {
      fromItem,
      toItem,
      skipped,
      since: { options: sinceOptions.map(({ mapId, label, preceding }) => ({ mapId, label, preceding })), selected: String(fromItem?.mapId || '') }
    });
    view.drawn = options.draw !== false;
    this.setTimelineChangeView(view);
    return view;
  }

  /**
   * The "Changes since" menu chose an earlier edition: list and draw every change since it. The
   * choice holds until another edition is selected, which goes back to the preceding edition.
   * @this {TimelineChangeApp}
   * @param {string} sinceMapId
   * @returns {Promise<TimelineChangeState | null>}
   */
  async setTimelineChangesSince(sinceMapId) {
    const items = this.getTimelineAnimationItems();
    const shown = this.getShownTimelineIndex(items);
    if (shown < 0) return null;
    return this.showTimelineChangesFor(shown, items, { sinceMapId });
  }

  /**
   * @this {TimelineChangeApp}
   * @param {TimelineChangeStep[]} steps oldest first
   * @param {Array<TimelineChangeFile | null>} files
   * @param {{ fromItem: TimelineItem | undefined, toItem: TimelineItem | undefined, skipped?: number, since?: NonNullable<TimelineChangeState['since']> }} options
   * @returns {TimelineChangeState}
   */
  buildTimelineChangeView(steps, files, { fromItem, toItem, skipped = 0, since }) {
    const multi = steps.length > 1;
    /** @type {TimelineChangeState['changes']} */
    const changes = [];
    /** @type {TimelineChangeState['features']} */
    const features = [];
    /** @type {TimelineChangeState['parts']} */
    const parts = [];
    steps.forEach((step, k) => {
      const file = files[k];
      const entry = step.entry || null;
      // A step is named by the later edition's date, when its changes took effect (Phelim,
      // 20 Nov 2026).
      const label = this.formatTimelineItemLabel(step.toItem);
      parts.push({ label, kind: entry?.kind || 'unknown', count: Number(entry?.count) || 0, text: entry?.text || 'No change data for this step.' });
      for (const change of Array.isArray(file?.changes) ? file.changes : []) {
        changes.push({ ...change, key: `${k}:${change.id}`, step: multi ? label : '', group: k, text: this.describeTimelineChange(change) });
      }
      for (const feature of Array.isArray(file?.features) ? file.features : []) {
        const changeId = feature?.properties?.['changeId'];
        features.push(changeId ? { ...feature, properties: { ...feature.properties, changeKey: `${k}:${changeId}` } } : feature);
      }
    });
    const count = parts.reduce((sum, part) => sum + part.count, 0);
    const fromLabel = this.formatTimelineItemLabel(fromItem);
    /** @type {TimelineChangeState} */
    const view = {
      key: steps.map((step) => step.id).join('|') || `first:${toItem?.mapId || ''}`,
      kind: timelineChangeKind(parts.map((part) => part.kind)),
      count,
      parts,
      changes,
      features,
      skipped,
      fromLabel,
      toLabel: this.formatTimelineItemLabel(toItem),
      dateLabels: parts.map((part) => part.label),
      fromMapId: fromItem?.mapId || null,
      toMapId: toItem?.mapId || null,
      // The note on the step's later edition.
      note: !multi && steps[0]?.toMapId ? String(dataService.getMapById(steps[0].toMapId)?.changeNote || '') : '',
      drawn: true
    };
    if (since) view.since = since;
    if (multi) view.summary = timelineSinceSummary({ sinceLabel: fromLabel, steps: steps.length, count, hectares: movedHectares(changes) });
    return view;
  }

  /**
   * A name in capitals ("KILKENNY", "KING'S COUNTY") in ordinary case for a sentence.
   * @this {TimelineChangeApp}
   * @param {unknown} name
   */
  timelineChangeName(name) {
    return timelineChangeName(name);
  }

  /**
   * @this {TimelineChangeApp}
   * @param {unknown} value
   */
  formatHectares(value) {
    return formatHectares(value);
  }

  /**
   * What happened at the step, in the order it happened, whichever way the slider moved: going
   * back past the 2014 step still reads "North Tipperary and South Tipperary County Councils
   * merged to form Tipperary County Council", not the merger undone (Phelim Birch, 26 Nov 2026).
   * @this {TimelineChangeApp}
   * @param {TimelineChange | null | undefined} change
   * @returns {string}
   */
  describeTimelineChange(change) {
    const from = this.timelineChangeName(change?.from);
    const to = this.timelineChangeName(change?.to);
    const ha = this.formatHectares(change?.ha);
    /** @param {unknown} names @param {string} fallback */
    const list = (names, fallback) => {
      const all = [...new Set((Array.isArray(names) ? names : []).map((name) => this.timelineChangeName(name)).filter(Boolean))];
      // A comma before the last 'and' when a name has its own: "Newry and Mourne, and Down".
      const last = all.some((name) => /\band\b/i.test(name)) ? ', and ' : ' and ';
      return all.length > 1 ? `${all.slice(0, -1).join(', ')}${last}${all[all.length - 1]}` : all[0] || fallback;
    };
    switch (change?.type) {
      case 'merged':
        return `${list(change.fromNames, from)} merged to form ${to}`;
      case 'divided':
        return `${from} divided into ${list(change.toNames, to)}`;
      case 'created':
        return `${to} formed from ${from}`;
      case 'abolished':
        return `${from} abolished, joined to ${to}`;
      case 'renamed':
        return `${from} renamed ${to}`;
      // Drawn in one edition only (a gap in the other's source layer).
      case 'appeared':
        return `${to} first drawn in this edition`;
      case 'disappeared':
        return `${from} no longer drawn`;
      default:
        return `${ha} from ${from} to ${to}`;
    }
  }

  /**
   * @this {TimelineChangeApp}
   * @param {TimelineChangeState | null} view
   */
  setTimelineChangeView(view) {
    if (!view) this.timelineChangeToken = (this.timelineChangeToken || 0) + 1;
    this.timelineChangeView = view || null;
    this.renderTimelineChangesControl();
    this.drawTimelineChanges();
  }

  /** @this {TimelineChangeApp} */
  drawTimelineChanges() {
    const view = this.timelineChangeView;
    if (!view || !view.drawn || !this.getTimelineHighlightEnabled() || (!view.features.length && !view.changes.length)) {
      this.mapController?.clearTimelineChanges?.();
      return;
    }
    this.mapController?.setTimelineChanges?.({ features: view.features }, {
      key: view.key,
      // A marker per change shows a small one at island zoom; past a few hundred (a ward review)
      // they would only blanket the map, and the new lines say it better.
      points: view.changes.length > TIMELINE_CHANGES_MAX_MARKERS ? [] : view.changes
        .filter((change) => Array.isArray(change.point))
        // A change's point is [lng, lat] (kept by the filter above).
        .map((change) => ({ id: change.key, lng: Number(/** @type {unknown[]} */ (change.point)[0]), lat: Number(/** @type {unknown[]} */ (change.point)[1]) }))
    });
  }

  /**
   * Keep the changes button about the edition on the map. A map opened from the catalogue,
   * or an edition changed some other way, is described against the edition before it (the
   * first edition says it has nothing earlier), but not drawn until the reader steps or opens
   * the list. A "Changes since" choice for the edition shown is kept.
   * @this {TimelineChangeApp}
   */
  syncTimelineChangesToShownEdition() {
    const items = this.getTimelineAnimationItems();
    const shown = this.getShownTimelineIndex(items);
    const view = this.timelineChangeView;
    if (shown < 0) {
      if (view) this.setTimelineChangeView(null);
      else this.renderTimelineChangesControl();
      return;
    }
    const sinceMapId = this.getLoadedEarlierEdition(items, shown);
    const current = view && view.toMapId === items[shown]?.mapId && (!sinceMapId || view.since?.selected === sinceMapId);
    if (current || this.timelineChangeStepPending) {
      this.renderTimelineChangesControl();
      return;
    }
    this.showTimelineChangesFor(shown, items, { draw: false, sinceMapId }).catch(() => {});
  }

  /** @this {TimelineChangeApp} */
  renderTimelineChangesControl() {
    const group = document.getElementById('timelineChangesGroup');
    const button = document.getElementById('timelineChanges');
    if (!group || !button) return;
    const view = this.timelineChangeView;
    const items = this.getTimelineAnimationItems();
    const boundaryTimeline = !this.elections?.activeEntry && items.some((item) => item?.mapId);
    setHidden(group, !boundaryTimeline);
    const toggle = document.getElementById('timelineHighlight');
    toggle?.setAttribute('aria-checked', this.getTimelineHighlightEnabled() ? 'true' : 'false');
    // Every edition of a boundary series has a state to show, the first one included: a hidden
    // button read as "no changes" (Phelim Birch, 27 Nov 2026).
    setHidden(button, !view);
    if (!view) {
      this.closeTimelineChangesPanel();
      return;
    }
    button.textContent = TIMELINE_CHANGES_BUTTON_LABEL[view.kind](view.count);
    button.dataset['kind'] = view.kind;
    button.title = view.kind === 'first'
      ? `${view.toLabel}: ${TIMELINE_FIRST_EDITION_TEXT}`
      : `${view.fromLabel} to ${view.toLabel}: ${view.parts.map((part) => part.text).join(' ')}`;
    if (!document.getElementById('timelineChangesPanel')?.hidden) this.renderTimelineChangesPanel();
  }

  /**
   * @this {TimelineChangeApp}
   * @returns {HTMLElement | null}
   */
  ensureTimelineChangesPanel() {
    let panel = document.getElementById('timelineChangesPanel');
    if (panel) return panel;
    const host = this.mapController?.map?.getContainer?.() || document.getElementById('map');
    if (!host) return null;
    panel = document.createElement('section');
    panel.id = 'timelineChangesPanel';
    panel.className = 'timeline-changes-panel';
    panel.setAttribute('aria-label', 'Boundary changes');
    setHidden(panel, true);
    panel.addEventListener('click', (event) => {
      const zoom = /** @type {HTMLElement | null | undefined} */ (/** @type {Element} */ (event.target).closest?.('[data-change-key]'));
      if (zoom) {
        this.zoomToTimelineChange(zoom.dataset['changeKey']);
        return;
      }
      if (/** @type {Element} */ (event.target).closest?.('.timeline-changes-panel__close')) this.closeTimelineChangesPanel({ focusButton: true });
    });
    panel.addEventListener('change', (event) => {
      const select = /** @type {HTMLSelectElement} */ (event.target);
      if (select.id !== 'timelineChangesSince') return;
      this.setTimelineChangesSince(select.value).catch(() => {});
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeTimelineChangesPanel({ focusButton: true });
    });
    host.appendChild(panel);
    return panel;
  }

  /** @this {TimelineChangeApp} */
  toggleTimelineChangesPanel() {
    const panel = this.ensureTimelineChangesPanel();
    if (!panel) return;
    if (!panel.hidden) {
      this.closeTimelineChangesPanel();
      return;
    }
    // Opening the list draws the changes it lists.
    if (this.timelineChangeView && !this.timelineChangeView.drawn) {
      this.timelineChangeView.drawn = true;
      this.drawTimelineChanges();
    }
    this.renderTimelineChangesPanel();
    setHidden(panel, false);
    document.getElementById('timelineChanges')?.setAttribute('aria-expanded', 'true');
    /** @type {HTMLElement | null} */ (panel.querySelector('.timeline-changes-panel__close'))?.focus({ preventScroll: true });
  }

  /**
   * @this {TimelineChangeApp}
   * @param {{ focusButton?: boolean }} [options]
   */
  closeTimelineChangesPanel(options = {}) {
    const panel = document.getElementById('timelineChangesPanel');
    const button = document.getElementById('timelineChanges');
    if (panel && !panel.hidden) {
      setHidden(panel, true);
      if (options.focusButton) button?.focus({ preventScroll: true });
    }
    button?.setAttribute('aria-expanded', 'false');
  }

  /** @this {TimelineChangeApp} */
  renderTimelineChangesPanel() {
    const panel = this.ensureTimelineChangesPanel();
    const view = this.timelineChangeView;
    if (!panel || !view) return;
    // The menu is written afresh with the list: a reader working it by keyboard keeps their place.
    const menuFocused = document.activeElement?.id === 'timelineChangesSince';
    panel.innerHTML = timelineChangesPanelHtml(view);
    if (menuFocused) /** @type {HTMLElement | null} */ (panel.querySelector('#timelineChangesSince'))?.focus({ preventScroll: true });
  }

  /**
   * @this {TimelineChangeApp}
   * @param {string | undefined} changeKey
   */
  zoomToTimelineChange(changeKey) {
    const change = this.timelineChangeView?.changes?.find((item) => item.key === changeKey);
    if (!change || !Array.isArray(change.bbox)) return;
    const [w, s, e, n] = /** @type {[number, number, number, number]} */ (/** @type {unknown[]} */ (change.bbox).map(Number));
    // A small change is shown with some country round it, not filling the screen.
    const padLng = Math.max((e - w) * 0.6, 0.01);
    const padLat = Math.max((n - s) * 0.6, 0.006);
    this.mapController?.fitToBounds?.([w - padLng, s - padLat, e + padLng, n + padLat]);
    if (this.isPhoneLayout?.()) this.closeTimelineChangesPanel();
  }

  /**
   * Two editions of one series switched on together were drawn identically, with two identical
   * legend entries. The older is now grey and dashed, and the legend says which is which.
   * @this {TimelineChangeApp}
   */
  updateEditionRoles() {
    const ids = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id) && this.isMapVisible(id));
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    for (const id of ids) {
      const chain = dataService.getChainForMap?.(id);
      if (!chain) continue;
      const key = `${chain.id}|${(dataService.getColumnClassIds?.(chain, id) || []).join(',')}`;
      if (!groups.has(key)) groups.set(key, []);
      /** @type {string[]} */ (groups.get(key)).push(id);
    }
    /** @type {Map<string, string>} */
    const roles = new Map();

    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const dated = members
        .map((id) => ({ id, time: Number(dataService.parseMapDate?.(dataService.getMapById(id)?.date)) }))
        .sort((a, b) => (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity));
      roles.set(/** @type {(typeof dated)[number]} */ (dated[0]).id, 'newer');
      for (const { id } of dated.slice(1)) roles.set(id, 'older');
    }
    for (const id of new Set([...(this.editionRoles?.keys() || []), ...roles.keys()])) {
      this.mapController?.setEditionRole?.(id, roles.get(id) === 'older' ? 'older' : null);
    }
    this.editionRoles = roles;
  }
}
