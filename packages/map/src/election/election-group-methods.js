/**
 * Opening a grouped entry (packages/map/src/election-groups.mjs): several elections drawn together
 * on one map, each keeping its own results. Each member's areas are coloured by its own result; the
 * results pane shows one member at a time, chosen by the tabs above it (and by clicking an area);
 * the legend has a section for each member. The open member is the manager's activeEntry and
 * activeBundle, so everything the pane does for one election it does for the member shown.
 *
 * Methods of the election manager (Test2ElectionManager, packages/map/app/election-manager.js),
 * installed on its prototype by installMethods: `this` is the manager.
 */
import { freshPanelState, OVERLAY_MODE, stylingModeFor } from './panel-model.mjs';
import { escapeHtml } from '../../../core/src/html.js';
import { mergeMatchExpressions } from '../election-groups.mjs';
import { unionFlatBbox } from '../renderer/utils.js';

/** @typedef {import('./election-manager').ElectionManager} ElectionManager */
/** @typedef {import('./election-manager').ElectionEntry} ElectionEntry */
/** @typedef {import('./election-manager').ElectionFeature} ElectionFeature */
/** @typedef {import('./election-manager').ElectionGroupMember} ElectionGroupMember */
/** @typedef {import('../../app/maplibre-main-adapter.js').ElectionStyle} ElectionStyle */
/** @typedef {import('../views/legend-view.mjs').LegendModel} LegendModel */

export class ElectionGroupMethods {
  /**
   * Open a grouped entry: every member's results and map, then the first member in the pane.
   * Opening it is a step Back can undo, as for any election.
   * @this {ElectionManager}
   * @param {ElectionEntry} entry
   * @param {{ keepView?: boolean }} [options]
   */
  async loadElectionGroup(entry, { keepView = false } = {}) {
    // Fields are written through `manager`: a plain `this.x =` here would declare x on this class.
    const manager = /** @type {ElectionManager} */ (this);
    const requestId = ++manager.loadSerial;
    const keys = /** @type {string[]} */ (Array.isArray(entry.memberKeys) ? entry.memberKeys : []);
    const labels = /** @type {string[]} */ (Array.isArray(entry.memberLabels) ? entry.memberLabels : []);
    const elections = this.catalogue?.elections || [];
    const entries = keys.map((key) => elections.find((item) => item.key === key)).filter((item) => item !== undefined);
    if (!entries.length) throw new Error(`Election not found: ${entry.body} ${entry.date}`);
    if (!keepView) this.app.beginNavigation?.(`Opened ${entry.displayTitle || entry.date}`);
    if (this.activeEntry) this.unloadElection({ updateURL: false, keepLoad: true });
    this.renderLoadingPanel(entry);
    const mapIds = [...new Set(entries.filter((item) => !item.resultsOnly && item.sourceMapId).map((item) => /** @type {string} */ (item.sourceMapId)))];
    const hadMaps = new Set(mapIds.filter((id) => this.mapController.isLayerLoaded?.(id)));
    manager.loadRun.to('loading');
    manager.pendingLoad = { requestId, body: entry.body, date: entry.date, sourceMapId: null, hadMap: false };
    /** @type {ElectionGroupMember[]} */
    let members;
    try {
      await Promise.all(mapIds.map((id) => this.app.loadMap(id, { fit: false })));
      // Framed on every member's map at once, as one election's load frames its own.
      const box = unionFlatBbox(mapIds.map((id) => this.mapController.resolveLayer?.(id)?.bounds));
      if (!keepView && box) this.mapController.fitToBounds?.(box, { smooth: false });
      members = await Promise.all(entries.map(async (member, i) => {
        const [bundle, previous] = await Promise.all([this.loadBundle(member), this.loadPreviousBundle(member)]);
        await this.loadFeatureIndexForBundle(bundle).catch(() => null);
        return { entry: member, bundle, previousBundle: this.previousBundleFor(member, previous, bundle), label: labels[keys.indexOf(member.key)] || member.displayTitle || String(i + 1) };
      }));
    } catch (error) {
      if (requestId !== this.loadSerial) return;
      this.removePanel();
      for (const id of mapIds) if (!hadMaps.has(id) && this.mapController.isLayerLoaded?.(id)) this.mapController.unloadLayer(id);
      this.app.syncCatalogueMapState();
      this.app.updateActiveLayers();
      manager.loadRun.to('closed');
      manager.pendingLoad = null;
      this.app.navigationPush?.clear();
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const wrapped = new Error(`${entry.displayTitle || entry.date} could not be loaded: ${offline ? 'you appear to be offline' : 'its results or map did not arrive'}.`);
      wrapped.cause = error;
      throw wrapped;
    }
    if (requestId !== this.loadSerial) return;
    manager.loadRun.to('open');
    manager.pendingLoad = null;
    manager.activeGroup = { entry, members, index: 0 };
    this.activateGroupMember(0, { render: false, overlay: false });
    this.applyActiveStyle();
    this.renderPanel();
    this.renderPanePeek();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await this.renderElectionOverlay();
    this.updateElectionTimeline();
    this.app.syncCatalogueMapState();
    this.app.updateActiveLayers();
    if (!keepView) this.app.refitAfterElectionPane?.(mapIds);
    this.app.focusActiveElectionCatalogueEntry?.(entry, { scroll: false });
    if (!keepView && this.app.endNavigation) this.app.endNavigation();
    else this.app.updateURLState();
  }

  /**
   * Show a member of the open entry in the pane: by its place in the entry or its key. Its areas
   * keep their colours (every member is drawn); the pane, the overlay and the address follow it.
   * @this {ElectionManager}
   * @param {number | string} which
   * @param {{ render?: boolean, overlay?: boolean }} [options] render: draw the pane and write the address now
   * @returns {boolean} whether `which` named a member
   */
  activateGroupMember(which, { render = true, overlay = true } = {}) {
    // Fields are written through `manager`: a plain `this.x =` here would declare x on this class.
    const manager = /** @type {ElectionManager} */ (this);
    /** @type {import('./election-manager').ElectionGroupState | null} */
    const group = manager.activeGroup;
    if (!group) return false;
    const index = typeof which === 'number' ? which : group.members.findIndex((/** @type {ElectionGroupMember} */ member) => member.entry.key === which);
    /** @type {ElectionGroupMember | undefined} */
    const member = group.members[index];
    if (!member) return false;
    group.index = index;
    manager.activeEntry = member.entry;
    manager.activeBundle = member.bundle;
    manager.previousBundle = member.previousBundle ?? null;
    manager.activeMode = stylingModeFor(member.entry, manager.activeMode);
    if (!this.shouldRenderElectionOverlays()) manager.overlayMode = OVERLAY_MODE.check('circles');
    Object.assign(this, freshPanelState(member.entry));
    this.entityPage.to('closed');
    manager.activeGeographyModeId = this.defaultGeographyModeId();
    manager.countDetailedView = false;
    this.resultsByLayer.clear();
    this.indexBundle(member.bundle);
    if (overlay) this.renderElectionOverlay().catch((error) => console.warn('[test2 elections] Overlay refresh failed', error));
    if (render) {
      this.applyActiveStyle();
      this.renderPanel();
      this.renderPanePeek();
      this.app.updateURLState();
    }
    return true;
  }

  /**
   * Run `fn` with `member` as the open election, then put the open one back: the styling and the
   * legend read the open election, and each member is styled and keyed as its own.
   * @template T
   * @this {ElectionManager}
   * @param {ElectionGroupMember} member
   * @param {() => T} fn
   * @returns {T}
   */
  withGroupMember(member, fn) {
    // Fields are written through `manager`: a plain `this.x =` here would declare x on this class.
    const manager = /** @type {ElectionManager} */ (this);
    /** @type {ElectionEntry | null} */
    const activeEntry = manager.activeEntry;
    /** @type {ElectionEntry | null} */
    const activeBundle = manager.activeBundle;
    /** @type {ElectionEntry | null} */
    const previousBundle = manager.previousBundle;
    manager.activeEntry = member.entry;
    manager.activeBundle = member.bundle;
    manager.previousBundle = member.previousBundle ?? null;
    try {
      return fn();
    } finally {
      manager.activeEntry = activeEntry;
      manager.activeBundle = activeBundle;
      manager.previousBundle = previousBundle;
    }
  }

  /**
   * Colour every member's areas by its own results: one style a layer, the members drawn on one
   * layer (the three plebiscites on the local authorities) merged into it.
   * @this {ElectionManager}
   */
  applyGroupStyle() {
    const group = this.activeGroup;
    if (!group) return;
    /** @type {Map<string, Array<{ sourceMapId: string, style: ElectionStyle }>>} */
    const byLayer = new Map();
    for (const member of group.members) {
      if (member.entry.resultsOnly) continue;
      const parts = this.withGroupMember(member, () => this.activeStyleParts(stylingModeFor(member.entry, this.activeMode)));
      if (parts) byLayer.set(parts.sourceMapId, [...(byLayer.get(parts.sourceMapId) || []), parts]);
    }
    for (const [sourceMapId, list] of byLayer) {
      const first = /** @type {{ sourceMapId: string, style: ElectionStyle }} */ (list[0]);
      /** @param {(style: ElectionStyle) => unknown} pick */
      const merged = (pick) => (list.length === 1 ? pick(first.style) : mergeMatchExpressions(list.map((parts) => pick(parts.style))));
      this.mapController.applyElectionStyle?.(sourceMapId, {
        ...first.style,
        fillColorExpression: merged((style) => style.fillColorExpression),
        lineColorExpression: merged((style) => style.lineColorExpression),
        ...(first.style.fillOpacityExpression !== undefined ? { fillOpacityExpression: merged((style) => style.fillOpacityExpression) } : {})
      });
    }
    this.renderLegend();
  }

  /**
   * Every map the open entry draws on (each member's boundaries and other geographies).
   * @this {ElectionManager}
   * @returns {string[]}
   */
  groupLayerIds() {
    return [...new Set((this.activeGroup?.members || []).flatMap((member) => this.backingLayerIdsOf(member.entry, member.bundle)))];
  }

  /**
   * The member a clicked area belongs to: one drawn on its map with a result for it (on a map two
   * members share, the one whose result names the area); null if none.
   * @this {ElectionManager}
   * @param {ElectionFeature | null | undefined} feature
   * @returns {ElectionGroupMember | null}
   */
  groupMemberForFeature(feature) {
    const group = this.activeGroup;
    if (!group || !feature) return null;
    const mapId = String(feature.mapId || feature['sourceMapId'] || feature['layerId'] || '');
    const onMap = group.members.filter((member) => this.backingLayerIdsOf(member.entry, member.bundle).includes(mapId));
    for (const member of onMap) {
      const found = this.withGroupMember(member, () => this.findResultForFeature(this.resultIndex(member.bundle.results), feature));
      if (found) return member;
    }
    return onMap[0] || null;
  }

  /**
   * The legend of an open entry: a section for each member, keyed as that member's areas are coloured.
   * @this {ElectionManager}
   * @returns {LegendModel | null}
   */
  groupLegendModel() {
    const group = this.activeGroup;
    if (!group) return null;
    const sections = group.members.flatMap((member) => {
      if (member.entry.resultsOnly) return [];
      const model = this.withGroupMember(member, () => this.singleLegendModel());
      return model ? [{ label: member.label, model }] : [];
    });
    const active = this.singleLegendModel();
    if (!active) return null;
    return { ...active, election: String(group.entry.displayTitle || ''), members: sections };
  }

  /**
   * The tabs above the results: one a member, the shown one pressed.
   * @this {ElectionManager}
   */
  groupTabsHtml() {
    const group = this.activeGroup;
    if (!group) return '';
    return `<div class="election-view-tabs test2-election-tabs election-group-tabs" role="group" aria-label="Elections shown together">${group.members.map((member, i) => {
      const on = i === group.index;
      return `<button type="button" class="election-view-tab${on ? ' election-view-tab--active' : ''}" data-election-group-member="${escapeHtml(member.entry.key)}" aria-pressed="${String(on)}" title="${escapeHtml(String(member.entry.displayTitle || member.label))}">${escapeHtml(member.label)}</button>`;
    }).join('')}</div>`;
  }

  /**
   * Wire the pane's member tabs: each shows its member's results.
   * @this {ElectionManager}
   * @param {ParentNode} pane
   */
  bindGroupTabs(pane) {
    /** @type {NodeListOf<HTMLElement>} */ (pane.querySelectorAll('[data-election-group-member]')).forEach((button) => {
      button.addEventListener('click', () => {
        const key = String(button.dataset['electionGroupMember'] || '');
        if (key === this.activeEntry?.key) return;
        this.activateGroupMember(key);
        /** @type {HTMLElement | null} */ (document.querySelector(`[data-election-group-member="${CSS.escape(key)}"]`))?.focus();
      });
    });
  }
}
