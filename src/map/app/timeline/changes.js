/**
 * Boundary changes between consecutive editions on the timeline (scripts/build/timeline-changes.py): the
 * change index, the remembered "Highlight changes" switch, the changes panel and the map markers, and
 * the older/newer edition roles of two editions of one series.
 *
 * Methods of the map app (Test2App, app/src/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import dataService from '../../../data-service.js';
import { escapeHtml } from '../helpers.mjs';
import { formatHectares, timelineChangeName } from './dates.mjs';

// Boundary changes between consecutive editions (scripts/build/timeline-changes.py). They
// replace the Play-only transition overlays of data/timeline-transition-overlays/.
const TIMELINE_CHANGES_BASE_PATH = '/data/timeline-changes';

const TIMELINE_HIGHLIGHT_STORAGE_KEY = 'civgraph:timelineHighlightChanges';

// A jump across more editions than this lists the first steps and says how many more.
const TIMELINE_CHANGES_MAX_STEPS = 12;

const TIMELINE_CHANGES_MAX_MARKERS = 200;

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

  async loadTimelineChangeIndex() {
    try {
      const response = await fetch(`${TIMELINE_CHANGES_BASE_PATH}/index.json`, { cache: 'default' });
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (!response.ok || contentType.includes('text/html')) return;
      const index = await response.json();
      this.timelineChangeIndex = index?.pairs && typeof index.pairs === 'object' ? index.pairs : {};
    } catch {
      this.timelineChangeIndex = {};
    }
  }

  getTimelineHighlightEnabled() {
    try {
      return localStorage.getItem(TIMELINE_HIGHLIGHT_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  setTimelineHighlightEnabled(value) {
    try { localStorage.setItem(TIMELINE_HIGHLIGHT_STORAGE_KEY, value ? '1' : '0'); } catch { /* private mode */ }
    const toggle = document.getElementById('timelineHighlight');
    toggle?.setAttribute('aria-checked', value ? 'true' : 'false');
    this.drawTimelineChanges();
  }

  /** The index of the timeline stop whose edition is on the map now, or -1. */
  getShownTimelineIndex(items = this.getTimelineAnimationItems()) {
    return (Array.isArray(items) ? items : [])
      .findIndex((item) => item?.mapId && this.isMapLoaded(item.mapId) && this.isMapVisible(item.mapId));
  }

  /**
   * The consecutive pairs between two stops, in the order they are stepped through: forward
   * from 1927 to 1957 is 1927-1955 then 1955-1957; backward is the same pairs, latest first.
   */
  getTimelineChangeSteps(fromIndex, toIndex, items = this.getTimelineAnimationItems()) {
    const steps = [];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return steps;
    for (let i = Math.min(fromIndex, toIndex); i < Math.max(fromIndex, toIndex); i += 1) {
      const fromMapId = items[i]?.mapId;
      const toMapId = items[i + 1]?.mapId;
      if (!fromMapId || !toMapId || fromMapId === toMapId) continue;
      const id = `${fromMapId}__${toMapId}`;
      steps.push({ id, fromMapId, toMapId, fromItem: items[i], toItem: items[i + 1], entry: this.timelineChangeIndex?.[id] || null });
    }
    return toIndex < fromIndex ? steps.reverse() : steps;
  }

  fetchTimelineChangePair(path) {
    if (!path) return Promise.resolve(null);
    const url = path.startsWith('/') ? path : `/${path}`;
    if (!this.timelineChangeCache.has(url)) {
      this.timelineChangeCache.set(url, fetch(url, { cache: 'default' })
        .then((response) => {
          const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
          return response.ok && !contentType.includes('text/html') ? response.json() : null;
        })
        .catch(() => null));
    }
    return this.timelineChangeCache.get(url);
  }

  /**
   * After every timeline step (drag, previous/next, latest, Play): what changed between the
   * edition that was shown (fromIndex) and the one now shown (toIndex). Stepping backwards
   * shows the same pairs reversed. It is drawn unless the reader has switched highlighting
   * off, and stays until the next step. `draw: false` only describes it, for the button.
   */
  async showTimelineStepChanges(fromIndex, toIndex, items = this.getTimelineAnimationItems(), options = {}) {
    const token = (this.timelineChangeToken = (this.timelineChangeToken || 0) + 1);
    const steps = this.getTimelineChangeSteps(fromIndex, toIndex, items);
    if (!steps.length) {
      this.setTimelineChangeView(null);
      return null;
    }
    const used = steps.slice(0, TIMELINE_CHANGES_MAX_STEPS);
    // While a step's own changes load, a layer change elsewhere must not replace them with the
    // undrawn description syncTimelineChangesToShownEdition gives a newly opened map.
    if (options.draw !== false) this.timelineChangeStepPending = token;
    let files;
    try {
      files = await Promise.all(used.map((step) => this.fetchTimelineChangePair(step.entry?.path)));
    } finally {
      if (this.timelineChangeStepPending === token) this.timelineChangeStepPending = 0;
    }
    if (token !== this.timelineChangeToken) return null;
    const view = this.buildTimelineChangeView(used, files, {
      reversed: toIndex < fromIndex,
      fromItem: items[fromIndex],
      toItem: items[toIndex],
      skipped: steps.length - used.length
    });
    view.drawn = options.draw !== false;
    this.setTimelineChangeView(view);
    return view;
  }

  buildTimelineChangeView(steps, files, { reversed, fromItem, toItem, skipped = 0 }) {
    const multi = steps.length > 1;
    const changes = [];
    const features = [];
    const parts = [];
    steps.forEach((step, k) => {
      const file = files[k];
      const entry = step.entry || null;
      const label = reversed
        ? `${this.formatTimelineItemLabel(step.toItem)} to ${this.formatTimelineItemLabel(step.fromItem)}`
        : `${this.formatTimelineItemLabel(step.fromItem)} to ${this.formatTimelineItemLabel(step.toItem)}`;
      parts.push({ label, kind: entry?.kind || 'unknown', count: Number(entry?.count) || 0, text: entry?.text || 'No change data for this step.' });
      for (const change of Array.isArray(file?.changes) ? file.changes : []) {
        changes.push({ ...change, key: `${k}:${change.id}`, step: multi ? label : '', text: this.describeTimelineChange(change, reversed) });
      }
      for (const feature of Array.isArray(file?.features) ? file.features : []) {
        const changeId = feature?.properties?.changeId;
        features.push(changeId ? { ...feature, properties: { ...feature.properties, changeKey: `${k}:${changeId}` } } : feature);
      }
    });
    const count = parts.reduce((sum, part) => sum + part.count, 0);
    const kinds = new Set(parts.map((part) => part.kind));
    const kind = kinds.has('changes') ? 'changes'
      : kinds.size === 1 && kinds.has('none') ? 'none'
        : kinds.has('redrawn') ? 'redrawn'
          : kinds.has('none') ? 'none' : 'unknown';
    const toMapId = toItem?.mapId || null;
    return {
      key: steps.map((step) => step.id).join('|') + (reversed ? '|reversed' : ''),
      reversed,
      kind,
      count,
      parts,
      changes,
      features,
      skipped,
      fromLabel: this.formatTimelineItemLabel(fromItem),
      toLabel: this.formatTimelineItemLabel(toItem),
      fromMapId: fromItem?.mapId || null,
      toMapId,
      note: !reversed && !multi && toMapId ? String(dataService.getMapById(toMapId)?.changeNote || '') : '',
      drawn: true
    };
  }

  /** A name in capitals ("KILKENNY", "KING'S COUNTY") in ordinary case for a sentence. */
  timelineChangeName(name) {
    return timelineChangeName(name);
  }

  formatHectares(value) {
    return formatHectares(value);
  }

  describeTimelineChange(change, reversed = false) {
    const from = this.timelineChangeName(change?.from);
    const to = this.timelineChangeName(change?.to);
    const ha = this.formatHectares(change?.ha);
    switch (change?.type) {
      case 'created':
        return reversed ? `${to} merged back into ${from}` : `${to} formed from ${from}`;
      case 'abolished':
        return reversed ? `${from} re-formed from ${to}` : `${from} abolished, joined to ${to}`;
      case 'renamed':
        return reversed ? `${to} renamed back to ${from}` : `${from} renamed ${to}`;
      // Drawn in one edition only (a gap in the other's source layer).
      case 'appeared':
        return reversed ? `${to} not drawn in this edition` : `${to} first drawn in this edition`;
      case 'disappeared':
        return reversed ? `${from} drawn again in this edition` : `${from} no longer drawn`;
      default:
        return reversed ? `${ha} from ${to} back to ${from}` : `${ha} from ${from} to ${to}`;
    }
  }

  setTimelineChangeView(view) {
    if (!view) this.timelineChangeToken = (this.timelineChangeToken || 0) + 1;
    this.timelineChangeView = view || null;
    this.renderTimelineChangesControl();
    this.drawTimelineChanges();
  }

  drawTimelineChanges() {
    const view = this.timelineChangeView;
    if (!view || !view.drawn || !this.getTimelineHighlightEnabled() || (!view.features.length && !view.changes.length)) {
      this.mapController?.clearTimelineChanges?.();
      return;
    }
    this.mapController?.setTimelineChanges?.({ features: view.features }, {
      key: view.key,
      reversed: view.reversed,
      // A marker per change shows a small one at island zoom; past a few hundred (a ward review)
      // they would only blanket the map, and the new lines say it better.
      points: view.changes.length > TIMELINE_CHANGES_MAX_MARKERS ? [] : view.changes
        .filter((change) => Array.isArray(change.point))
        .map((change) => ({ id: change.key, lng: Number(change.point[0]), lat: Number(change.point[1]) }))
    });
  }

  /**
   * Keep the changes button about the edition on the map. A map opened from the catalogue,
   * or an edition changed some other way, is described against the edition before it, but
   * not drawn until the reader steps or opens the list.
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
    if ((view && view.toMapId === items[shown].mapId) || this.timelineChangeStepPending) {
      this.renderTimelineChangesControl();
      return;
    }
    if (shown > 0) this.showTimelineStepChanges(shown - 1, shown, items, { draw: false }).catch(() => {});
    else this.setTimelineChangeView(null);
  }

  renderTimelineChangesControl() {
    const group = document.getElementById('timelineChangesGroup');
    const button = document.getElementById('timelineChanges');
    if (!group || !button) return;
    const view = this.timelineChangeView;
    const items = this.getTimelineAnimationItems();
    const boundaryTimeline = !this.elections?.activeEntry && items.some((item) => item?.mapId);
    group.hidden = !boundaryTimeline;
    const toggle = document.getElementById('timelineHighlight');
    toggle?.setAttribute('aria-checked', this.getTimelineHighlightEnabled() ? 'true' : 'false');
    const known = view && view.kind !== 'unknown';
    button.hidden = !known;
    if (!known) {
      this.closeTimelineChangesPanel();
      return;
    }
    const label = view.kind === 'changes'
      ? `${view.count.toLocaleString('en-GB')} change${view.count === 1 ? '' : 's'}`
      : view.kind === 'redrawn' ? 'Redrawn' : 'No changes';
    button.textContent = label;
    button.dataset.kind = view.kind;
    button.title = `${view.fromLabel} to ${view.toLabel}: ${view.parts.map((part) => part.text).join(' ')}`;
    if (!document.getElementById('timelineChangesPanel')?.hidden) this.renderTimelineChangesPanel();
  }

  ensureTimelineChangesPanel() {
    let panel = document.getElementById('timelineChangesPanel');
    if (panel) return panel;
    const host = this.mapController?.map?.getContainer?.() || document.getElementById('map');
    if (!host) return null;
    panel = document.createElement('section');
    panel.id = 'timelineChangesPanel';
    panel.className = 'timeline-changes-panel';
    panel.setAttribute('aria-label', 'Boundary changes');
    panel.hidden = true;
    panel.addEventListener('click', (event) => {
      const zoom = event.target.closest?.('[data-change-key]');
      if (zoom) {
        this.zoomToTimelineChange(zoom.dataset.changeKey);
        return;
      }
      if (event.target.closest?.('.timeline-changes-panel__close')) this.closeTimelineChangesPanel({ focusButton: true });
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeTimelineChangesPanel({ focusButton: true });
    });
    host.appendChild(panel);
    return panel;
  }

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
    panel.hidden = false;
    document.getElementById('timelineChanges')?.setAttribute('aria-expanded', 'true');
    panel.querySelector('.timeline-changes-panel__close')?.focus({ preventScroll: true });
  }

  closeTimelineChangesPanel(options = {}) {
    const panel = document.getElementById('timelineChangesPanel');
    const button = document.getElementById('timelineChanges');
    if (panel && !panel.hidden) {
      panel.hidden = true;
      if (options.focusButton) button?.focus({ preventScroll: true });
    }
    button?.setAttribute('aria-expanded', 'false');
  }

  renderTimelineChangesPanel() {
    const panel = this.ensureTimelineChangesPanel();
    const view = this.timelineChangeView;
    if (!panel || !view) return;
    const esc = (value) => escapeHtml(String(value ?? ''));
    const typeLabel = { created: 'New', abolished: 'Abolished', renamed: 'Renamed', transfer: 'Transfer', reorganised: 'Transfer', appeared: 'Added', disappeared: 'Gone' };
    const reversedType = { created: 'abolished', abolished: 'created', appeared: 'disappeared', disappeared: 'appeared' };
    const summaries = view.parts.map((part) => `<p class="timeline-changes-panel__summary">${view.parts.length > 1 ? `<strong>${esc(part.label)}:</strong> ` : ''}${esc(part.text)}</p>`).join('');
    const list = view.changes.length
      ? `<ol class="timeline-changes-panel__list">${view.changes.map((change) => {
        const type = view.reversed ? (reversedType[change.type] || change.type) : change.type;
        return `<li class="timeline-changes-panel__item">
          <span class="timeline-changes-panel__type timeline-changes-panel__type--${esc(type)}">${esc(typeLabel[type] || 'Change')}</span>
          <span class="timeline-changes-panel__text">${esc(change.text)}${change.step ? ` <span class="timeline-changes-panel__step">(${esc(change.step)})</span>` : ''}</span>
          <button type="button" class="timeline-changes-panel__zoom" data-change-key="${esc(change.key)}" aria-label="Zoom to: ${esc(change.text)}" title="Zoom to this change">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </li>`;
      }).join('')}</ol>`
      : '';
    const more = view.skipped > 0 ? `<p class="timeline-changes-panel__summary">and ${view.skipped} more step${view.skipped === 1 ? '' : 's'}: step one edition at a time to see them.</p>` : '';
    const key = view.changes.length
      ? `<p class="timeline-changes-panel__key" aria-hidden="true"><span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--area"></span>changed area <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--new"></span>new line <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--gone"></span>line gone</p>`
      : '';
    const note = view.note ? `<p class="timeline-changes-panel__note"><strong>Catalogue note:</strong> ${esc(view.note)}</p>` : '';
    panel.innerHTML = `
      <header class="timeline-changes-panel__header">
        <h2 class="timeline-changes-panel__title">Changes, ${esc(view.fromLabel)} to ${esc(view.toLabel)}</h2>
        <button type="button" class="timeline-changes-panel__close" aria-label="Close the list of changes">&times;</button>
      </header>
      ${summaries}${more}${key}${list}${note}`;
  }

  zoomToTimelineChange(changeKey) {
    const change = this.timelineChangeView?.changes?.find((item) => item.key === changeKey);
    if (!change || !Array.isArray(change.bbox)) return;
    const [w, s, e, n] = change.bbox.map(Number);
    // A small change is shown with some country round it, not filling the screen.
    const padLng = Math.max((e - w) * 0.6, 0.01);
    const padLat = Math.max((n - s) * 0.6, 0.006);
    this.mapController?.fitToBounds?.([w - padLng, s - padLat, e + padLng, n + padLat]);
    if (this.isPhoneLayout?.()) this.closeTimelineChangesPanel();
  }

  /**
   * Two editions of one series switched on together were drawn identically, with two identical
   * legend entries. The older is now grey and dashed, and the legend says which is which.
   */
  updateEditionRoles() {
    const ids = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id) && this.isMapVisible(id));
    const groups = new Map();
    for (const id of ids) {
      const chain = dataService.getChainForMap?.(id);
      if (!chain) continue;
      const key = `${chain.id}|${(dataService.getColumnClassIds?.(chain, id) || []).join(',')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    }
    const roles = new Map();
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const dated = members
        .map((id) => ({ id, time: Number(dataService.parseMapDate?.(dataService.getMapById(id)?.date)) }))
        .sort((a, b) => (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity));
      roles.set(dated[0].id, 'newer');
      for (const { id } of dated.slice(1)) roles.set(id, 'older');
    }
    for (const id of new Set([...(this.editionRoles?.keys() || []), ...roles.keys()])) {
      this.mapController?.setEditionRole?.(id, roles.get(id) === 'older' ? 'older' : null);
    }
    this.editionRoles = roles;
  }
}
