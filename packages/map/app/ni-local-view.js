/**
 * The grouped pre-1973 Northern Ireland local elections on the map: one year's council rounds,
 * drawn at a level the reader chooses (wards and DEDs, county electoral divisions, the town
 * commissioners' towns, the districts or the counties), coloured by votes or by seats, with grey
 * hatching where results are not available or are incomplete, and aldermen apart from councillors
 * where the year had aldermanic polls.
 *
 * The year file (render/metadata/ni-local/<year>.json, scripts/build/build-ni-local-grouped.mjs) says,
 * for each level, which boundary edition to draw and each feature's seats and votes by party. This
 * view owns the election pane while a year is open; Test2ElectionManager hands it the calls that
 * would otherwise go to a single election (style, panel, legend, feature clicks, the address).
 */
import { NI_LOCAL_LEVELS, NI_LOCAL_TIERS } from '../src/ni-local-groups.mjs';
import { NO_LABEL } from '../../core/src/election-domain.mjs';
import { partyAbbreviation, partyFullName, partyLabelHtml } from '../../core/src/party-names.mjs';
import { printedLabelsToggleHtml } from '../src/printed-labels.mjs';
import { formatDisplayDate } from '../../core/src/date-format.mjs';
import { NI_LOCAL_VIEW, niLocalViewActive } from '../src/election/ni-local-state.mjs';
import { createState } from '../src/state-helpers.mjs';
import statuses from '../../registries/src/browser/statuses.mjs';
import { summaryPollStatus } from '../../core/src/unopposed.mjs';
import { siteNumber } from '../../core/src/format.js';
import { MAP_COLOURS } from '../src/colours.mjs';

/** @typedef {import('../src/election/election-manager').ElectionManager} ElectionManager */
/** @typedef {import('../src/election/election-manager').ElectionEntry} ElectionEntry */
/** @typedef {import('../src/election/election-manager').ElectionFeature} ElectionFeature */
/** @typedef {import('../src/app/legend-view.mjs').LegendModel} LegendModel */
/**
 * One area of a level (a feature of its map): its key and label (the file's, or a clicked feature's property), the [round, contest] pairs held
 * there, the seats and votes by party, and the hatching when its results are missing or partial.
 * @typedef {{
 *   k: string, l?: unknown, n?: number, r?: Array<[number, number]>,
 *   seats?: Record<string, number>, votes?: Record<string, number>, hatch?: boolean, why?: string
 * }} NiLocalItem
 */
/**
 * A level of the year: whether it can be drawn (else why not), the boundary map and the property
 * its features are keyed by, the edition, results with no area here, and its areas.
 * @typedef {{
 *   available?: boolean, reason?: string, sourceMapId?: string, layerId?: string, labelProperty?: string,
 *   keyProps?: string[], editionName?: string, unplaced?: Array<[number, number]>,
 *   features?: { councillors?: NiLocalItem[], aldermen?: NiLocalItem[], [members: string]: NiLocalItem[] | undefined }
 * }} NiLocalLevel
 */
/**
 * A contest: its area, seats, whether it went to a poll, whether it elected aldermen, and its
 * candidates as [name, party, label as printed, votes, elected].
 * @typedef {{
 *   area?: string, seats?: number, contested?: boolean, aldermen?: boolean,
 *   cands?: Array<[string, string, (string | null)?, (number | null)?, boolean?]>
 * }} NiLocalContest
 */
/** A council's round of the year. @typedef {{ key: string, body: string, date: string, tier: string, status?: string, note?: string, aldermen?: boolean, contests: NiLocalContest[] }} NiLocalRound */
/**
 * The year file (render/metadata/ni-local/<year>.json, scripts/build/build-ni-local-grouped.mjs).
 * @typedef {{
 *   year: number, title: string, dates?: string[], hasAldermen?: boolean,
 *   levels?: Record<string, NiLocalLevel>, rounds: NiLocalRound[],
 *   missing?: Array<{ tier: string, bodySlug?: string, reason?: string }>
 * }} NiLocalYear
 */

// The words for a round's site status, a missing round and a contest: the statuses registry's
// election-round siteLabels and missingReasons (RG-03) and contest labels (RG-02).
const ROUND_LABELS = statuses.roundSiteLabels;
const MISSING_REASONS = statuses.missingReasons;
const CONTEST_LABELS = statuses.contestLabels;

const YEAR_FILE_VERSION = 'nl-1';
const PREF_KEY = 'civgraph.niLocal.view';
const DEFAULT_LEVEL_ORDER = ['districts', 'ded', 'ced', 'counties', 'towns'];
const SHOW_OPTIONS = [['votes', 'Votes'], ['seats', 'Seats']];
const MEMBER_OPTIONS = [['councillors', 'Councillors'], ['aldermen', 'Aldermen']];
const STYLE = Object.freeze({
  unmatchedFill: MAP_COLOURS.unmatchedFill,
  unmatchedFillOpacity: 0.12,
  neutralFill: MAP_COLOURS.neutralFill,
  neutralFillOpacity: 0.45,
  splitFill: MAP_COLOURS.splitFill,
  seatsFillOpacity: 0.72,
  matchedStroke: MAP_COLOURS.matchedStroke,
  unmatchedStroke: MAP_COLOURS.unmatchedStroke,
  strokeOpacity: 0.8,
  strokeWidth: 1.2
});

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

/** @param {unknown} value */
function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? siteNumber(n) : '-';
}

/**
 * "CLIFTON" -> "Clifton", "ADMINISTRATIVE COUNTY OF DOWN" -> "Administrative County of Down".
 * @param {unknown} label
 */
export function niLocalAreaName(label) {
  const text = String(label || '').trim();
  if (!text || text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s(.'-])([a-z])/g, (_m, p, c) => `${p}${c.toUpperCase()}`)
    .replace(/\b(Of|And|The|No)\b/g, (w, _x, i) => (i === 0 ? w : w.toLowerCase()))
    .replace(/'S\b/g, "'s");
}

/**
 * The party with most of `counts`, its share of the total, and whether it ties.
 * @param {Record<string, number> | null | undefined} [counts]
 */
export function leadingParty(counts = {}) {
  const rows = Object.entries(counts || {}).filter(([, n]) => Number(n) > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = rows.reduce((sum, [, n]) => sum + Number(n), 0);
  if (!rows.length || !total) return null;
  return { party: rows[0][0], value: rows[0][1], total, share: (rows[0][1] / total) * 100, tie: rows.length > 1 && rows[1][1] === rows[0][1] };
}

/**
 * Fill opacity for a leading party's share of the votes: the site's vote-share range, 10% to 70%.
 * @param {unknown} share
 */
export function voteShareOpacity(share) {
  const t = Math.max(0, Math.min(1, (Number(share) - 10) / 60));
  return Math.round((0.25 + 0.6 * t) * 100) / 100;
}

/**
 * Whether a compact contest (build-ni-local-grouped.mjs: no statuses) went to a poll, by core's
 * one rule (packages/core/src/unopposed.mjs summaryPollStatus): 'polled' (contested, with votes),
 * 'unopposed' (no votes and no more candidates than seats), or 'not-recorded' (no votes printed
 * for a contest that had a poll: not unopposed).
 * @param {{ contested?: boolean, seats?: number, cands?: unknown[] }} contest
 * @returns {'polled' | 'unopposed' | 'not-recorded'}
 */
export function contestPoll(contest) {
  if (contest.contested) return 'polled';
  return summaryPollStatus({ candidateCount: (contest.cands || []).length, seatsTotal: Number(contest.seats) || 1 });
}

export class NiLocalGroupedView {
  /** The view is open (active or switching level): a read-only view of viewState. */
  get active() { return niLocalViewActive(this.viewState.state()); }

  /** @param {ElectionManager} manager */
  constructor(manager) {
    this.manager = manager;
    this.app = manager.app;
    this.mapController = manager.mapController;
    // inactive, opening, active or switching (packages/map/src/election/ni-local-state.mjs).
    this.viewState = createState(NI_LOCAL_VIEW);
    /** @type {ElectionEntry | null} */
    this.entry = null;
    /** @type {NiLocalYear | null} */
    this.data = null;
    /** @type {Map<number, NiLocalYear>} */
    this.cache = new Map();
    /** @type {string | null} */
    this.level = null;
    /** @type {string} */
    this.show = 'seats';
    /** @type {string} */
    this.members = 'councillors';
    /** @type {string | null} */
    this.selectedKey = null;
    /** @type {Set<string>} */
    this.loadedLayerIds = new Set();
    /** @type {MutationObserver | null} */
    this.themeObserver = null;
    /** @type {MediaQueryList | null} */
    this.themeMedia = null;
  }

  // ------------------------------------------------------------------ state

  /** @returns {{ level?: string, show?: string, members?: string }} */
  readPrefs() {
    try {
      const value = JSON.parse(globalThis.localStorage?.getItem(PREF_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  writePrefs() {
    try {
      globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify({ level: this.level, show: this.show, members: this.members }));
    } catch {
      // Private windows and blocked storage: the choice holds for this page only.
    }
  }

  /**
   * @param {ElectionEntry} entry
   * @returns {Promise<NiLocalYear>}
   */
  async fetchYear(entry) {
    const year = Number(entry?.year || String(entry?.date || '').slice(0, 4));
    if (this.cache.has(year)) return /** @type {NiLocalYear} */ (this.cache.get(year));
    const response = await fetch(`/render/metadata/ni-local/${year}.json?v=${YEAR_FILE_VERSION}`, { cache: 'default' });
    if (!response.ok) throw new Error(`The ${year} Northern Ireland local elections could not be loaded: ${response.status}`);
    const data = await response.json();
    this.cache.set(year, data);
    return data;
  }

  /**
   * @param {string | null} [id]
   * @returns {NiLocalLevel | null}
   */
  levelInfo(id = this.level) {
    // No level yet reads levels["null"]: nothing.
    return this.data?.levels?.[/** @type {string} */ (id)] || null;
  }

  /**
   * @param {string | null | undefined} id
   * @returns {boolean}
   */
  levelAvailable(id) {
    return Boolean(this.levelInfo(id)?.available);
  }

  /**
   * Why a level is greyed out, in a few words, for its tooltip.
   * @param {string} id
   */
  levelReason(id) {
    const info = this.levelInfo(id);
    const level = NI_LOCAL_LEVELS.find((item) => item.id === id);
    if (!info) return '';
    if (info.available) return '';
    if (info.reason === 'No elections at this level this year') {
      return `No ${level?.long || 'elections at this level'} polled in ${this.data?.year}`;
    }
    return `No boundary map yet for the ${level?.long || 'areas'} of ${this.data?.year}`;
  }

  availableLevels() {
    return NI_LOCAL_LEVELS.map((level) => level.id).filter((id) => this.levelAvailable(id));
  }

  /**
   * @param {string | null | undefined} requested
   * @returns {string}
   */
  pickLevel(requested) {
    if (requested && this.levelAvailable(requested)) return requested;
    return DEFAULT_LEVEL_ORDER.find((id) => this.levelAvailable(id)) || 'districts';
  }

  /** @param {string | null} [level] */
  aldermenAvailable(level = this.level) {
    return Boolean(this.levelInfo(level)?.features?.aldermen?.some((item) => item.n));
  }

  /** The year has separate aldermanic polls at all (the toggle shows only then). */
  hasAldermen() {
    return Boolean(this.data?.hasAldermen);
  }

  /** @returns {NiLocalItem[]} */
  items() {
    const info = this.levelInfo();
    return info?.features?.[this.members] || [];
  }

  /**
   * @param {unknown} key
   * @returns {NiLocalItem | null}
   */
  itemByKey(key) {
    const wanted = String(key || '');
    return this.items().find((item) => item.k === wanted || item.l === wanted) || null;
  }

  sourceMapId() {
    return this.levelInfo()?.sourceMapId || null;
  }

  backingLayerIds() {
    return [...this.loadedLayerIds];
  }

  // ------------------------------------------------------------------ open / close

  /**
   * @param {ElectionEntry} entry
   * @param {{ keepView?: boolean, level?: string | null, show?: string | null, members?: string | null, area?: string | null }} [options]
   */
  async open(entry, { keepView = false, level = null, show = null, members = null, area = null } = {}) {
    this.viewState.to('opening');
    let data;
    try {
      data = await this.fetchYear(entry);
    } catch (error) {
      if (this.viewState.is('opening')) this.viewState.to('inactive');
      throw error;
    }
    this.data = data;
    this.entry = entry;
    const prefs = this.readPrefs();
    const wantShow = show || prefs.show;
    // One of the options (some() found it), so a string.
    this.show = SHOW_OPTIONS.some(([id]) => id === wantShow) ? /** @type {string} */ (wantShow) : 'seats';
    this.level = this.pickLevel(level || prefs.level);
    const wantMembers = members || prefs.members;
    this.members = wantMembers === 'aldermen' && this.aldermenAvailable() ? 'aldermen' : 'councillors';
    this.selectedKey = null;
    this.viewState.to('active');
    this.syncManagerEntry();
    await this.loadLevelLayer({ fit: !keepView });
    this.applyStyle();
    const item = area ? this.itemByKey(area) : null;
    if (item) this.renderArea(item, { push: false });
    else this.renderPanel({ push: false });
    this.watchTheme();
  }

  /** The manager's view of the open election: the year's entry, drawn on this level's map. */
  syncManagerEntry() {
    const info = this.levelInfo();
    // open() set the entry. A level with no map leaves its ids null, which the manager reads only
    // for truthiness.
    const entry = {
      .../** @type {ElectionEntry} */ (this.entry),
      sourceMapId: info?.sourceMapId || null,
      layerId: info?.layerId || null,
      labelProperty: info?.labelProperty || null,
      stylingModes: []
    };
    this.manager.activeEntry = /** @type {ElectionEntry} */ (entry);
    this.manager.activeBundle = /** @type {ElectionEntry} */ ({
      key: entry.key,
      body: entry.body,
      bodySlug: entry.bodySlug,
      date: entry.date,
      displayTitle: entry.displayTitle,
      niLocal: true,
      sourceMapId: entry.sourceMapId,
      layerId: entry.layerId,
      labelProperty: entry.labelProperty,
      results: []
    });
  }

  /** @param {{ fit?: boolean }} [options] */
  async loadLevelLayer({ fit = false } = {}) {
    const id = this.sourceMapId();
    if (!id) return;
    if (!this.mapController.isLayerLoaded?.(id)) {
      await this.app.loadMap(id, { fit });
      this.loadedLayerIds.add(id);
    } else {
      this.mapController.showLayer?.(id);
      if (fit) this.mapController.fitToLayer?.(id);
    }
  }

  teardown() {
    for (const id of new Set([this.sourceMapId(), ...this.loadedLayerIds].filter(Boolean))) {
      // filter(Boolean) left only ids.
      this.mapController.clearElectionStyle?.(/** @type {string} */ (id));
    }
    this.viewState.to('inactive');
    this.selectedKey = null;
    this.unwatchTheme();
    // The manager unloads the layers it is told are the election's (backingLayerIds).
  }

  forgetLoadedLayers() {
    this.loadedLayerIds.clear();
    this.entry = null;
    this.data = null;
  }

  watchTheme() {
    if (this.themeObserver || !globalThis.MutationObserver) return;
    const reapply = () => { if (this.active) this.applyStyle(); };
    this.themeObserver = new MutationObserver(reapply);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    try {
      this.themeMedia = globalThis.matchMedia?.('(prefers-color-scheme: dark)') || null;
      this.themeMedia?.addEventListener?.('change', reapply);
      this.themeMediaListener = reapply;
    } catch {
      this.themeMedia = null;
    }
  }

  unwatchTheme() {
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    // Before watchTheme set a listener there is none to remove, and removing undefined does nothing.
    try { this.themeMedia?.removeEventListener?.('change', /** @type {() => void} */ (this.themeMediaListener)); } catch { /* ignore */ }
    this.themeMedia = null;
  }

  // ------------------------------------------------------------------ choices

  /** @param {string} id */
  async setLevel(id) {
    if (!this.active || id === this.level || !this.levelAvailable(id)) return;
    this.viewState.to('switching');
    const previous = this.sourceMapId();
    this.level = id;
    if (this.members === 'aldermen' && !this.aldermenAvailable()) this.members = 'councillors';
    const next = this.sourceMapId();
    if (previous && previous !== next) {
      this.mapController.clearElectionStyle?.(previous);
      if (this.loadedLayerIds.has(previous)) {
        this.mapController.unloadLayer?.(previous);
        this.loadedLayerIds.delete(previous);
      }
    }
    this.selectedKey = null;
    this.syncManagerEntry();
    this.renderPanel({ push: false, busy: true });
    await this.loadLevelLayer({ fit: false });
    // Done, unless a teardown came first (it stays inactive, as the old flag did).
    if (this.viewState.is('switching')) this.viewState.to('active');
    this.applyStyle();
    this.renderPanel({ push: false });
    this.writePrefs();
    this.app.updateActiveLayers?.();
    this.app.updateURLState?.();
  }

  /** @param {string} id */
  setShow(id) {
    if (!SHOW_OPTIONS.some(([value]) => value === id) || id === this.show) return;
    this.show = id;
    this.applyStyle();
    this.rerender();
    this.writePrefs();
    this.app.updateURLState?.();
  }

  /** @param {string} id */
  setMembers(id) {
    if (!MEMBER_OPTIONS.some(([value]) => value === id) || id === this.members) return;
    if (id === 'aldermen' && !this.aldermenAvailable()) return;
    this.members = id;
    const selected = this.selectedKey;
    this.selectedKey = null;
    this.applyStyle();
    const item = selected ? this.itemByKey(selected) : null;
    if (item) this.renderArea(item, { push: false });
    else this.renderPanel({ push: false });
    this.writePrefs();
    this.app.updateURLState?.();
  }

  rerender() {
    const item = this.selectedKey ? this.itemByKey(this.selectedKey) : null;
    if (item) this.renderArea(item, { push: false });
    else this.renderPanel({ push: false });
  }

  // ------------------------------------------------------------------ map style

  /** @param {string} party */
  partyColour(party) {
    if (!party || party === NO_LABEL) return this.manager.mainPanePartyColour(NO_LABEL) || MAP_COLOURS.noFigure;
    return this.manager.mainPanePartyColour(party);
  }

  /** @param {NiLocalLevel | null} [info] */
  matchInput(info = this.levelInfo()) {
    if (Array.isArray(info?.keyProps) && info.keyProps.length > 1) {
      /** @type {unknown[]} */
      const parts = [];
      info.keyProps.forEach((prop, index) => {
        if (index) parts.push('|');
        parts.push(['coalesce', ['to-string', ['get', prop]], '']);
      });
      return ['concat', ...parts];
    }
    return ['to-string', ['get', info?.labelProperty || 'name']];
  }

  /**
   * How one feature is drawn: { colour, opacity, party, share, tie, kind }.
   * @param {NiLocalItem} item
   * @returns {{ colour: string, opacity: number, party?: string, share?: number, tie?: boolean, kind: 'none' | 'uncontested' | 'split' | 'party' }}
   */
  styleFor(item) {
    if (!item?.n) return { colour: STYLE.neutralFill, opacity: item?.hatch ? 0.18 : STYLE.unmatchedFillOpacity, kind: 'none' };
    if (this.show === 'votes') {
      const lead = leadingParty(item.votes);
      if (!lead) return { colour: STYLE.neutralFill, opacity: STYLE.neutralFillOpacity, kind: 'uncontested' };
      return { colour: this.partyColour(lead.party), opacity: voteShareOpacity(lead.share), party: lead.party, share: lead.share, tie: lead.tie, kind: 'party' };
    }
    const lead = leadingParty(item.seats);
    if (!lead) return { colour: STYLE.neutralFill, opacity: STYLE.neutralFillOpacity, kind: 'uncontested' };
    if (lead.tie) return { colour: STYLE.splitFill, opacity: STYLE.seatsFillOpacity, kind: 'split', tie: true };
    return { colour: this.partyColour(lead.party), opacity: STYLE.seatsFillOpacity, party: lead.party, share: lead.share, kind: 'party' };
  }

  /**
   * The hatching is drawn over the base map, so its tone follows the base map, not the page:
   * dark lines over the light maps (the default, in the light and the dark theme alike), light
   * lines over the dark ones (the satellite ones went with the Esri base maps, 11 Nov 2026).
   * Both tones carry an edge of the other.
   */
  hatchTone() {
    const base = String(this.app.baseMapId || 'osm-standard');
    return /dark/.test(base) ? 'dark' : 'light';
  }

  applyStyle() {
    if (!this.active) return;
    const info = this.levelInfo();
    const id = info?.sourceMapId;
    if (!id) return;
    const input = this.matchInput(info);
    const colours = [];
    const opacities = [];
    const strokes = [];
    const hatched = [];
    const seen = new Set();
    for (const item of this.items()) {
      if (!item.k || seen.has(item.k)) continue;
      seen.add(item.k);
      const style = this.styleFor(item);
      colours.push(item.k, style.colour);
      opacities.push(item.k, style.opacity);
      strokes.push(item.k, STYLE.matchedStroke);
      if (item.hatch) hatched.push(item.k);
    }
    /**
     * @param {unknown[]} pairs
     * @param {unknown} fallback
     */
    const match = (pairs, fallback) => (pairs.length ? ['match', input, ...pairs, fallback] : fallback);
    this.mapController.applyElectionStyle?.(id, {
      mode: `ni-local-${this.show}`,
      fillColorExpression: match(colours, STYLE.unmatchedFill),
      fillOpacityExpression: match(opacities, STYLE.unmatchedFillOpacity),
      lineColorExpression: match(strokes, STYLE.unmatchedStroke),
      lineOpacity: STYLE.strokeOpacity,
      lineWidth: STYLE.strokeWidth,
      hideLabels: true
    });
    this.mapController.setElectionHatch?.(id, hatched.length ? { matchInput: input, keys: hatched, theme: this.hatchTone() } : null);
    this.app.updateMapLegend?.();
  }

  // ------------------------------------------------------------------ legend

  /** @returns {LegendModel | null} */
  legendModel() {
    if (!this.active) return null;
    const byParty = new Map();
    let uncontested = 0;
    let split = 0;
    let hatched = 0;
    for (const item of this.items()) {
      if (item.hatch) hatched += 1;
      const style = this.styleFor(item);
      if (style.kind === 'party') {
        const key = style.party;
        if (!byParty.has(key)) byParty.set(key, { party: key, abbreviation: partyAbbreviation(key) || key, name: key === NO_LABEL ? NO_LABEL : partyFullName(key), colour: style.colour, count: 0 });
        byParty.get(key).count += 1;
      } else if (style.kind === 'uncontested') uncontested += 1;
      else if (style.kind === 'split') split += 1;
    }
    const level = NI_LOCAL_LEVELS.find((item) => item.id === this.level);
    const notes = [];
    if (this.show === 'votes') {
      notes.push({ kind: 'note', text: 'Deeper colour: a larger share of the vote' });
      if (uncontested) notes.push({ kind: 'neutral', text: 'Returned unopposed, or no votes printed', count: uncontested });
    } else {
      if (split) notes.push({ kind: 'split', text: 'Seats split evenly between parties', count: split });
      if (uncontested) notes.push({ kind: 'neutral', text: 'No seats filled', count: uncontested });
    }
    if (hatched) notes.push({ kind: 'hatch', text: 'Results not available or incomplete', count: hatched });
    const title = this.show === 'votes' ? 'Votes' : 'Seats';
    return {
      title,
      heading: `${level?.label || 'Areas'} coloured by ${this.show === 'votes' ? 'leading party in contested polls' : 'party holding the seats'}${this.members === 'aldermen' ? ' (aldermen)' : ''}`,
      election: this.data?.title || '',
      items: [...byParty.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      keyNotes: notes,
      unit: 'area',
      ramp: null,
      seats: false,
      bars: false
    };
  }

  // ------------------------------------------------------------------ pane

  /** The year's results at this level, by party, from every contest of the councils drawn here. */
  partySummary() {
    const tiers = Object.entries(NI_LOCAL_TIERS).filter(([, tier]) => tier.levels.includes(/** @type {string} */ (this.level))).map(([id]) => id);
    const wantAldermen = this.members === 'aldermen';
    const rows = new Map();
    let totalSeats = 0;
    let totalVotes = 0;
    let contests = 0;
    let contested = 0;
    for (const round of this.data?.rounds || []) {
      if (!tiers.includes(round.tier)) continue;
      for (const contest of round.contests || []) {
        if (Boolean(round.aldermen || contest.aldermen) !== wantAldermen) continue;
        contests += 1;
        if (contest.contested) contested += 1;
        for (const [, party, , votes, elected] of contest.cands || []) {
          if (!rows.has(party)) rows.set(party, { party, seats: 0, unopposed: 0, notRecorded: 0, votes: 0, candidates: 0 });
          const row = rows.get(party);
          row.candidates += 1;
          if (elected) {
            row.seats += 1;
            totalSeats += 1;
            const poll = contestPoll(contest);
            if (poll === 'unopposed') row.unopposed += 1;
            else if (poll === 'not-recorded') row.notRecorded += 1;
          }
          if (contest.contested && Number.isFinite(Number(votes)) && votes !== null) {
            row.votes += Number(votes);
            totalVotes += Number(votes);
          }
        }
      }
    }
    const list = [...rows.values()].sort((a, b) => b.seats - a.seats || b.votes - a.votes || a.party.localeCompare(b.party));
    return { rows: list, totalSeats, totalVotes, contests, contested };
  }

  roundsAtLevel() {
    const tiers = Object.entries(NI_LOCAL_TIERS).filter(([, tier]) => tier.levels.includes(/** @type {string} */ (this.level))).map(([id]) => id);
    return {
      rounds: (this.data?.rounds || []).map((round, index) => ({ round, index })).filter(({ round }) => tiers.includes(round.tier)),
      missing: (this.data?.missing || []).filter((item) => tiers.includes(item.tier))
    };
  }

  /**
   * @param {string} name
   * @param {string} label
   * @param {string[][]} options  [id, text, full text]
   * @param {string | null} active
   * @param {{ disabled?: (id: string) => string, describedBy?: string }} [extra]
   */
  segmentedHtml(name, label, options, active, { disabled = () => '', describedBy = '' } = {}) {
    return `<div class="ni-seg" role="group" aria-label="${escapeHtml(label)}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
      <span class="ni-seg__label" aria-hidden="true">${escapeHtml(label)}</span>
      <span class="ni-seg__buttons">${options.map(([id, text, full]) => {
        const reason = disabled(id);
        return `<button type="button" class="ni-seg__btn" data-ni-${name}="${escapeHtml(id)}" aria-pressed="${String(id === active)}"${reason ? ` aria-disabled="true" title="${escapeHtml(reason)}"` : (full ? ` title="${escapeHtml(full)}"` : '')}>${escapeHtml(text)}</button>`;
      }).join('')}</span>
    </div>`;
  }

  controlsHtml() {
    const levelOptions = NI_LOCAL_LEVELS.map((level) => [level.id, level.label, level.long.charAt(0).toUpperCase() + level.long.slice(1)]);
    const levelLabel = NI_LOCAL_LEVELS.find((level) => level.id === this.level)?.label || '';
    const showLabel = SHOW_OPTIONS.find(([id]) => id === this.show)?.[1] || '';
    const membersShown = this.hasAldermen();
    const summary = [levelLabel, showLabel, membersShown && this.members === 'aldermen' ? 'Aldermen' : ''].filter(Boolean).join(' · ');
    let open = true;
    try { open = !globalThis.matchMedia?.('(max-width: 640px)').matches; } catch { open = true; }
    if (this.viewMenuOpen !== undefined) open = this.viewMenuOpen;
    return `<details class="ni-local-view"${open ? ' open' : ''}>
      <summary class="ni-local-view__summary"><span class="ni-local-view__label">View</span> <span class="ni-local-view__current">${escapeHtml(summary)}</span></summary>
      <div class="ni-local-controls">
        ${this.segmentedHtml('level', 'Level', levelOptions, this.level, { disabled: (id) => this.levelReason(id) })}
        ${this.segmentedHtml('show', 'Show', SHOW_OPTIONS.map(([id, text]) => [id, text, id === 'votes' ? 'Colour contested polls by the leading party' : 'Colour every area by the party holding its seats']), this.show)}
        ${membersShown ? this.segmentedHtml('members', 'Members', MEMBER_OPTIONS, this.members, { disabled: (id) => (id === 'aldermen' && !this.aldermenAvailable() ? `No aldermanic polls at the ${levelLabel} level this year` : '') }) : ''}
      </div>
    </details>`;
  }

  editionNote() {
    const info = this.levelInfo();
    if (!info?.available) return '';
    const items = this.items();
    const withResults = items.filter((item) => item.n).length;
    const hatched = items.filter((item) => item.hatch).length;
    const unplaced = (info.unplaced || []).filter(([ri, ci]) => {
      // The year is loaded while its levels are drawn.
      const round = /** @type {NiLocalYear} */ (this.data).rounds[ri];
      return Boolean(round.aldermen || round.contests[ci]?.aldermen) === (this.members === 'aldermen');
    }).length;
    const edition = info.editionName ? `Boundaries: ${info.editionName}` : '';
    const counts = [
      `${formatNumber(withResults)} area${withResults === 1 ? '' : 's'} with results`,
      hatched ? `<span class="ni-local-note__hatch"><i class="ni-hatch-swatch" aria-hidden="true"></i>${formatNumber(hatched)} not available or incomplete</span>` : '',
      unplaced ? `${formatNumber(unplaced)} result${unplaced === 1 ? '' : 's'} with no boundary at this level` : ''
    ].filter(Boolean).join(' · ');
    return `<p class="ni-local-note">${escapeHtml(edition)}${edition ? '. ' : ''}${counts}.</p>`;
  }

  summaryTableHtml() {
    const summary = this.partySummary();
    if (!summary.rows.length) return '<p class="election-no-data">No results at this level for this year.</p>';
    const unopposedSeats = summary.rows.reduce((sum, row) => sum + (row.unopposed || 0), 0);
    const notRecordedSeats = summary.rows.reduce((sum, row) => sum + (row.notRecorded || 0), 0);
    const rows = summary.rows.map((row) => {
      const share = summary.totalVotes && row.votes ? `${((row.votes / summary.totalVotes) * 100).toFixed(1)}%` : '-';
      const colour = escapeHtml(this.partyColour(row.party));
      return `<tr><td class="election-party-cell" style="--party-colour:${colour}">${this.partyLabel(row.party)}</td>`
        + `<td class="election-num"${row.unopposed || row.notRecorded ? ` title="${escapeHtml([row.unopposed ? `${row.unopposed} returned unopposed` : '', row.notRecorded ? `${row.notRecorded} from polls whose votes are not recorded` : ''].filter(Boolean).join('; '))}"` : ''}>${formatNumber(row.seats)}</td>`
        + `<td class="election-num">${row.votes ? formatNumber(row.votes) : '-'}</td>`
        + `<td class="election-num">${share}</td></tr>`;
    }).join('');
    return `<table class="ni-local-table">
      <caption class="ni-local-caption">${formatNumber(summary.contests)} contests, ${formatNumber(summary.contested)} polled${unopposedSeats ? `; ${formatNumber(unopposedSeats)} ${unopposedSeats === 1 ? 'seat' : 'seats'} returned unopposed, counted as seats but not votes` : ''}${notRecordedSeats ? `; ${formatNumber(notRecordedSeats)} ${notRecordedSeats === 1 ? 'seat' : 'seats'} from polls whose votes are not recorded` : ''}. Votes are from the polled contests only.</caption>
      <thead><tr><th scope="col">Party</th><th scope="col" class="election-num">Seats</th><th scope="col" class="election-num">Votes</th><th scope="col" class="election-num">Share</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="election-num">${formatNumber(summary.totalSeats)}</td><td class="election-num">${summary.totalVotes ? formatNumber(summary.totalVotes) : '-'}</td><td></td></tr></tfoot>
    </table>`;
  }

  councilsHtml() {
    const { rounds, missing } = this.roundsAtLevel();
    /** @param {NiLocalRound} round */
    const status = (round) => (round.status === 'complete' ? '' : `<span class="ni-local-badge"${round.note ? ` title="${escapeHtml(round.note)}"` : ''}>${round.status === 'held' ? ROUND_LABELS.held : ROUND_LABELS.partial}</span>`);
    const items = rounds.map(({ round }) => `<li><button type="button" class="ni-local-council" data-ni-round="${escapeHtml(round.key)}">${escapeHtml(round.body)}</button> <span class="ni-local-council__meta">${escapeHtml(formatDisplayDate(round.date))} · ${formatNumber(round.contests.length)} contest${round.contests.length === 1 ? '' : 's'}</span>${status(round)}</li>`);
    const gaps = missing.map((item) => `<li class="ni-local-council--missing"><i class="ni-hatch-swatch" aria-hidden="true"></i>${escapeHtml(this.councilName(item.bodySlug))} <span class="ni-local-council__meta">${escapeHtml(item.reason === MISSING_REASONS.excluded.reason ? MISSING_REASONS.excluded.label : MISSING_REASONS.otherwise.label)}</span></li>`);
    if (!items.length && !gaps.length) return '';
    return `<details class="ni-local-councils">
      <summary>Councils at this level <span class="ni-local-count">${formatNumber(rounds.length)}${gaps.length ? ` + ${formatNumber(gaps.length)} without results` : ''}</span></summary>
      <ul class="ni-local-council-list">${items.join('')}${gaps.join('')}</ul>
    </details>`;
  }

  /** @param {unknown} bodySlug */
  councilName(bodySlug) {
    const base = String(bodySlug || '').replace(/-aldermen$/, '');
    const words = base.split('-').map((word) => (word === 'no' ? 'No.' : word.charAt(0).toUpperCase() + word.slice(1)));
    // test() reads a missing slug as "undefined", which does not match.
    return `${words.join(' ')}${/-aldermen$/.test(/** @type {string} */ (bodySlug)) ? ' (aldermen)' : ''}`;
  }

  /** @param {string} party */
  partyLabel(party) {
    if (!String(party || '').trim() || party === NO_LABEL) return `<span class="election-no-label">${escapeHtml(NO_LABEL)}</span>`;
    return partyLabelHtml(party, escapeHtml);
  }

  paneParts() {
    const pane = this.manager.ensurePanel();
    const content = document.getElementById('electionPaneContent');
    const title = document.getElementById('electionPaneTitle');
    const back = document.getElementById('electionPaneBack');
    return { pane, content, title, back };
  }

  headerRightHtml() {
    return '<button type="button" id="electionCloseBtn" class="election-pane__close" aria-label="Unload election">&#10005;</button>';
  }

  /** @param {{ push?: boolean, busy?: boolean }} [options] */
  renderPanel({ push = true, busy = false } = {}) {
    const { pane, content, title, back } = this.paneParts();
    if (!pane || !content || !title || !this.data) return;
    const wasSelected = this.selectedKey;
    this.selectedKey = null;
    title.textContent = this.data.title;
    back?.classList.add('hidden');
    const headerRight = pane.querySelector('.election-pane__header-right');
    if (headerRight) headerRight.innerHTML = this.headerRightHtml();
    // Polling days only (a round whose day is unknown is filed under its year).
    const dates = (this.data.dates || []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
    const span = dates.length > 1
      ? `${formatDisplayDate(dates[0])} to ${formatDisplayDate(dates[dates.length - 1])}`
      : (dates[0] ? formatDisplayDate(dates[0]) : '');
    content.innerHTML = `<section class="test2-election-panel ni-local" aria-label="${escapeHtml(this.data.title)}"${busy ? ' aria-busy="true"' : ''}>
      ${this.controlsHtml()}
      <p class="ni-local-lede">${escapeHtml(`${this.data.rounds.length} council ${this.data.rounds.length === 1 ? 'round' : 'rounds'}${span ? `, ${span}` : ''}.`)} Select an area on the map for its results.</p>
      ${this.editionNote()}
      ${this.summaryTableHtml()}
      ${this.councilsHtml()}
    </section>`;
    pane.classList.add('election-results-pane--open');
    document.body.classList.add('test2-election-open');
    this.bindPane(pane);
    this.renderPeek();
    this.app.syncElectionPaneResizerAria?.();
    if (push && wasSelected) this.app.pushURLState?.(this.data.title);
  }

  /**
   * @param {NiLocalItem} item
   * @param {{ push?: boolean }} [options]
   */
  renderArea(item, { push = true } = {}) {
    const { pane, content, title, back } = this.paneParts();
    if (!pane || !content || !title || !this.data || !item) return;
    const changed = this.selectedKey !== item.k;
    this.selectedKey = item.k;
    const name = niLocalAreaName(item.l);
    title.textContent = name;
    back?.classList.remove('hidden');
    const headerRight = pane.querySelector('.election-pane__header-right');
    if (headerRight) headerRight.innerHTML = this.headerRightHtml();
    /** @type {Map<number, number[]>} */
    const byRound = new Map();
    for (const [ri, ci] of item.r || []) {
      if (!byRound.has(ri)) byRound.set(ri, []);
      /** @type {number[]} */ (byRound.get(ri)).push(ci);
    }
    const blocks = [...byRound.entries()].map(([ri, contestIndexes]) => {
      // The year is loaded while its levels are drawn.
      const round = /** @type {NiLocalYear} */ (this.data).rounds[ri];
      const contests = contestIndexes.map((ci) => this.contestHtml(round.contests[ci])).join('');
      return `<section class="ni-local-round">
        <h4 class="ni-local-round__title">${escapeHtml(round.body)} <span class="ni-local-council__meta">${escapeHtml(formatDisplayDate(round.date))}</span></h4>
        ${contests}
        <button type="button" class="ni-local-open" data-ni-round="${escapeHtml(round.key)}">All ${escapeHtml(round.body)} results</button>
      </section>`;
    }).join('');
    const hatch = item.hatch ? `<p class="ni-local-hatch-note" role="note"><i class="ni-hatch-swatch" aria-hidden="true"></i>${escapeHtml(item.why || 'Results not available or incomplete')}</p>` : '';
    const empty = !item.n ? `<p class="election-no-data">No results for ${escapeHtml(name)} at this level in ${escapeHtml(String(this.data.year))}.</p>` : '';
    content.innerHTML = `<section class="test2-election-panel ni-local ni-local-area" aria-label="${escapeHtml(`${name}, ${this.data.title}`)}">
      ${this.controlsHtml()}
      ${hatch}
      ${item.n ? printedLabelsToggleHtml(escapeHtml, 'printed-labels-toggle election-printed-toggle') : ''}
      ${blocks}${empty}
    </section>`;
    pane.classList.add('election-results-pane--open');
    document.body.classList.add('test2-election-open');
    this.bindPane(pane);
    this.renderPeek();
    if (push && changed) {
      this.app.pushURLState?.(`${this.data.title}: ${name}`);
    } else {
      this.app.updateURLState?.();
    }
  }

  /** @param {NiLocalContest} contest */
  contestHtml(contest) {
    const seats = Number(contest.seats) || 1;
    // A contest without printed votes is "Returned unopposed" only when nobody stood against the
    // members (core's one rule); otherwise its votes are missing, not unopposed.
    const poll = contestPoll(contest);
    const status = poll === 'polled' ? CONTEST_LABELS.contested : poll === 'unopposed' ? CONTEST_LABELS.uncontested : 'Votes not recorded';
    const rows = (contest.cands || []).map(([name, party, printed, votes, elected]) => `<tr>
      <td>${escapeHtml(name)}</td>
      <td class="election-party-cell" style="--party-colour:${escapeHtml(this.partyColour(party))}">${this.partyLabel(party)}</td>
      <td class="election-col-printed"><span class="election-cell-wrap">${escapeHtml(printed || '')}</span></td>
      <td class="election-num">${votes === null || votes === undefined ? '-' : formatNumber(votes)}</td>
      <td class="election-num ni-local-mark">${elected ? '<span class="election-elected-mark election-elected-mark--yes" role="img" aria-label="Elected" title="Elected">✓</span>' : ''}</td>
    </tr>`).join('');
    return `<div class="ni-local-contest">
      <p class="ni-local-contest__meta"><strong>${escapeHtml(contest.area)}</strong> · ${seats} seat${seats === 1 ? '' : 's'}${contest.aldermen ? ' (aldermen)' : ''} · ${status}</p>
      <table class="ni-local-table">
        <thead><tr><th scope="col">Candidate</th><th scope="col">Party</th><th scope="col" class="election-col-printed" title="The label as printed in the cited newspaper or report">As printed</th><th scope="col" class="election-num">Votes</th><th scope="col" class="election-num ni-local-mark"><span class="visually-hidden">Elected</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  renderPeek() {
    const peek = document.getElementById('electionPanePeek');
    if (!peek) return;
    const rows = this.partySummary().rows.filter((row) => row.seats > 0).slice(0, 8);
    peek.innerHTML = rows.map((row) => `<span class="election-pane__peek-item" style="--peek-colour:${escapeHtml(this.partyColour(row.party))}"><i></i>${this.partyLabel(row.party)} <b>${formatNumber(row.seats)}</b></span>`).join('')
      || `<span>${escapeHtml(this.data?.title || '')}</span>`;
  }

  /** @param {Element} pane */
  bindPane(pane) {
    pane.querySelector('#electionCloseBtn')?.addEventListener('click', () => this.manager.unloadElection({ label: 'Closed the election' }));
    const back = document.getElementById('electionPaneBack');
    if (back && !back.dataset.niBound) {
      back.dataset.niBound = '1';
      back.addEventListener('click', () => {
        if (this.active && this.selectedKey) this.renderPanel();
      });
    }
    const details = /** @type {HTMLDetailsElement | null} */ (pane.querySelector('.ni-local-view'));
    details?.addEventListener('toggle', () => { this.viewMenuOpen = details.open; });
    /** @type {NodeListOf<HTMLElement>} */ (pane.querySelectorAll('[data-ni-level]')).forEach((button) => button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      this.setLevel(/** @type {string} */ (button.dataset.niLevel)).catch((error) => this.manager.onError?.(error));
    }));
    /** @type {NodeListOf<HTMLElement>} */ (pane.querySelectorAll('[data-ni-show]')).forEach((button) => button.addEventListener('click', () => this.setShow(/** @type {string} */ (button.dataset.niShow))));
    /** @type {NodeListOf<HTMLElement>} */ (pane.querySelectorAll('[data-ni-members]')).forEach((button) => button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      this.setMembers(/** @type {string} */ (button.dataset.niMembers));
    }));
    /** @type {NodeListOf<HTMLElement>} */ (pane.querySelectorAll('[data-ni-round]')).forEach((button) => button.addEventListener('click', () => this.openRound(button.dataset.niRound)));
  }

  /**
   * One council's own results, as before grouping (its timeline, its tables).
   * @param {string | undefined} key
   */
  async openRound(key) {
    const round = (this.data?.rounds || []).find((item) => item.key === key);
    if (!round) return;
    if (this.app.openElection) await this.app.openElection(round.body, round.date);
    else await this.manager.loadElection(round.body, round.date);
  }

  // ------------------------------------------------------------------ map clicks

  /** @param {ElectionFeature | null | undefined} feature */
  featureKey(feature) {
    const info = this.levelInfo();
    const props = feature?.properties || {};
    if (Array.isArray(info?.keyProps) && info.keyProps.length > 1) {
      return info.keyProps.map((prop) => String(props[prop] ?? '')).join('|');
    }
    // No label property reads props["undefined"]: nothing.
    return String(props[/** @type {string} */ (info?.labelProperty)] ?? feature?.featureName ?? feature?.name ?? '');
  }

  /** @param {ElectionFeature | null | undefined} feature */
  isOwnFeature(feature) {
    const info = this.levelInfo();
    const id = String(feature?.mapId || feature?.sourceMapId || feature?.layerId || '');
    return Boolean(info && id && (id === info.sourceMapId || id === info.layerId));
  }

  /** @param {ElectionFeature | null | undefined} feature */
  showFeature(feature) {
    if (!this.active || !this.isOwnFeature(feature)) return false;
    const key = this.featureKey(feature);
    const item = this.itemByKey(key) || { k: key, l: feature?.properties?.[/** @type {string} */ (this.levelInfo()?.labelProperty)] || key, n: 0 };
    this.renderArea(item);
    return true;
  }

  /** @param {ElectionFeature} feature */
  enrichFeature(feature) {
    if (!this.active || !this.isOwnFeature(feature)) return feature;
    const item = this.itemByKey(this.featureKey(feature));
    if (!item) return feature;
    const seats = Object.entries(item.seats || {}).sort((a, b) => b[1] - a[1]).map(([party, n]) => `${party} ${n}`).join(', ');
    const lead = leadingParty(item.votes);
    /** @type {Record<string, unknown>} */
    const properties = {
      ...(feature.properties || {}),
      // An own feature's level is the open year's.
      Election: /** @type {NiLocalYear} */ (this.data).title,
      Seats: seats || '-',
      'Leading party (votes)': lead ? `${lead.party} (${lead.share.toFixed(1)}%)` : 'No contested poll'
    };
    if (item.hatch) properties.Results = item.why || 'Not available or incomplete';
    return { ...feature, featureName: niLocalAreaName(item.l), properties };
  }

  // ------------------------------------------------------------------ address

  urlState() {
    return {
      level: this.level,
      show: this.show,
      members: this.members,
      area: this.selectedKey
    };
  }
}
