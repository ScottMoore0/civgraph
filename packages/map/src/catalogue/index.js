/**
 * The rebuilt catalogue pane.
 *
 * Mounted by UIController (packages/map/src/ui-controller.js) in place of the current pane when
 * catalogueNextRequested() (packages/map/src/catalogue/flag.js) is true; nothing here runs otherwise.
 *
 * Three sections, Maps (first), Elections and Books, plus the Tables tab. Maps lists every series
 * as one row whose editions are chips: each adds its map in one click and fills with the map's own
 * colour while it is on. Rows open in place for the timeline, facts, versions, parts and the
 * remaining actions; nothing needs a separate page. Filters (where, kind, years on a slider,
 * on the map, to be added) and search narrow the same list in place; a jump bar keeps every shelf
 * in reach. Search also finds places (each named feature, with its own buttons) and people,
 * parties and sources, through the current pane's own search code.
 *
 * Data: data/catalogue/catalogue.json, built by scripts/build/catalogue/build-catalogue.mjs; places on
 * demand from data/catalogue/places.json. Map actions go through the callbacks the app already
 * gives UIController (onMapLoad, onMapUnload, onMapToggle, onDownloadFgb, onLoadElection...).
 *
 * Addresses (#...&cat=<route>, kept by app.updateURLState): maps | series/<id>[/<mapId>] |
 * elections[/<body>] | books | here/<lng>/<lat>; old #flat-card-<id> links land on their series.
 */
import { CatalogueSearch, PeopleSearch, STOP_WORDS, coveringPoint, normalise } from './search.js';
import { AddressGeocoder, parsePostcode } from './geocoder.js';
import { CATALOGUE_CSS } from './styles.js';
import dataService, { resolveMapDownloadUrl } from '../data-service.js';
import { initialCatalogueRoute, takeCatalogueData } from './flag.js';
import { compositeChildIds } from '../map-relations.mjs';
import { icon, SHELF_LOOK, SHELF_ICON_IN, BOOK_CATEGORY_ICONS, MERGED_SHELVES, FLAT_SECTIONS } from './icons.js';
import catalogueKinds from '../../../registries/src/browser/catalogue-kinds.mjs';
import { esc, yearOf, mapDate, shortProvider } from './util.js';
import { formatDisplayDate } from '../../../core/src/date-format.mjs';
import { cdnUrl } from '../cdn-url.js';
import { openMenu, closeMenu } from './menu.js';
import { loadAuth, loginHref, openEditDialog, suggestEditOffered } from './edit.js';
import { decadeDomain, binCounts, indexOf, updateSlider, stepYear } from './slider.js';
import * as MapsView from './view-maps.js';
import * as ElectionsView from './view-elections.js';
import { BODY_GROUPS, groupOfBody, shelvesOf } from './view-elections.js';
import * as BooksView from './view-books.js';
import { CATALOGUE_TAB } from './route-state.mjs';
import { defineFlagFields, setHidden } from '../state-helpers.mjs';
import { forgetTypedPhrase, isLanguagePhrase, languageOptionsShown, revealLanguageOptions, typedLanguagePhrase } from './lang-reveal.js';
import { siteNumber } from '../../../core/src/format.js';
import { MAP_COLOURS } from '../colours.mjs';

/** @typedef {import('./catalogue-types.d.ts').CatalogueDoc} CatalogueDoc */
/** @typedef {import('./catalogue-types.d.ts').CatalogueRow} CatalogueRow */
/** @typedef {import('./catalogue-types.d.ts').CatalogueRowMember} CatalogueRowMember */
/** @typedef {import('./catalogue-types.d.ts').CatalogueRowElection} CatalogueRowElection */
/** @typedef {import('./catalogue-types.d.ts').CatalogueShelf} CatalogueShelf */
/** @typedef {import('./catalogue-types.d.ts').CatalogueSubject} CatalogueSubject */
/** @typedef {import('./catalogue-types.d.ts').CatalogueMapRec} CatalogueMapRec */
/** @typedef {import('./catalogue-types.d.ts').CataloguePeopleDoc} CataloguePeopleDoc */
/** @typedef {import('./catalogue-types.d.ts').CatalogueSearchRecord} CatalogueSearchRecord */
/** @typedef {import('./catalogue-types.d.ts').CatalogueUi} CatalogueUi */
/** @typedef {import('./catalogue-types.d.ts').CatalogueApp} CatalogueApp */
/** @typedef {import('./catalogue-types.d.ts').CatalogueMapView} CatalogueMapView */
/** @typedef {import('./search.js').PersonRow} PersonRow */
/** @typedef {import('./search.js').SearchHit} SearchHit */
/** @typedef {import('./geocoder.js').AddressResult} AddressResult */
/** @typedef {import('./menu.js').MenuItem} MenuItem */
/** @typedef {import('./slider.js').YearBin} YearBin */
/** @typedef {import('./slider.js').SliderState} SliderState */
/** @typedef {import('../data-service.js').BooksDocument} BooksDocument */
/** @typedef {import('../ui-controller-types.d.ts').MapRecord} MapRecord */
/**
 * The Maps tab's filters (toAdd: an older store's, dropped on load).
 * @typedef {{ scope: string, kind: string, from: number | null, to: number | null, onMap: boolean, undated: boolean, toAdd?: unknown }} MapFilters
 */
/** The Elections tab's filters. @typedef {{ body: string, ekind: string, escope: string, from: number | null, to: number | null }} ElectionFilters */
/** Which filters: the Maps tab's or the Elections tab's. @typedef {'maps' | 'elections'} FilterKey */
/**
 * A shelf as the list draws it: its subjects with the rows they show, how many, and the best search score.
 * @typedef {{ sh: CatalogueShelf, subjects: Array<{ sub: CatalogueSubject, series: CatalogueRow[], best: number }>, count: number, best: number }} VisibleShelf
 */
/**
 * The addresses for the search box (geocoder.js), with how the search for them went.
 * @typedef {{ query: string, results: AddressResult[], loading?: boolean, paused?: boolean, searched?: boolean, failed?: boolean, source?: string }} AddressState
 */
/** Named features of one name the search found, each with its record. @typedef {{ name: string, items: Array<{ record: CatalogueSearchRecord }> }} PlaceGroup */
/**
 * What a search found besides maps: places, people, parties and sources, and people who stood; or that it is still looking.
 * @typedef {{ loading?: boolean, places?: PlaceGroup[], people?: CatalogueSearchRecord[], persons?: Array<{ row: PersonRow, score: number }> }} SearchExtras
 */
/**
 * A person whose elections are listed: each contest's key with where, for which party and whether elected.
 * @typedef {{ id: string, name: string, row: PersonRow, contests: Map<string, { place: string, party: string, won: boolean }> }} CataloguePerson
 */
/** Two maps compared: the second fades in over the first. @typedef {{ a: string, b: string, aLabel: string, bLabel: string, value: number }} CatalogueCompare */
/** A point on the map ("What's here"). @typedef {{ lng: number, lat: number }} LngLat */
/** Who is signed in (edit.js loadAuth). @typedef {{ authenticated?: boolean, allowed?: boolean, loginUrl?: string | null, email?: string }} CatalogueAuth */
/**
 * An element the catalogue found by a data attribute (data-cn-*): the attributes its handler reads
 * are written with it in the views, and one that may be absent is tested where it is read.
 * @typedef {HTMLElement & { dataset: Record<string, string> }} DataTarget
 */
/** A part of the catalogue's markup: what it holds are HTML elements. @typedef {{ querySelector(selectors: string): HTMLElement | null }} HtmlScope */
/** A section of the open tab, for the contents drawer. @typedef {{ id: string, label: string | undefined, count: number, level: number, icon?: string, colour?: string }} ContentsSection */
// From D1 since data design phase 3 (the /data/catalogue/*.json URLs still answer, from the same rows).
const PLACES_URL = '/_api/catalogue?view=places';
const PEOPLE_URL = '/_api/catalogue?view=people';
const STORE = 'civgraph.catalogueNext.v2';
/** @type {MapFilters} */
const BLANK_FILTERS = { scope: '', kind: '', from: null, to: null, onMap: false, undated: false };
/** @type {ElectionFilters} */
const BLANK_EFILTERS = { body: '', ekind: 'general', escope: '', from: null, to: null };

const app = () => (typeof window !== 'undefined' ? /** @type {CatalogueApp | undefined} */ (window.__civgraphTest2?.app) : null);
// JSON.parse(null), nothing stored, is null, so the empty record.
/** @returns {{ v?: number, filters?: Partial<MapFilters>, efilters?: Partial<ElectionFilters>, opened?: string[] }} */
const readStore = () => { try { return JSON.parse(/** @type {string} */ (sessionStorage.getItem(STORE))) || {}; } catch { return {}; } };
// The map sections, each the maps of one kind.
// [section, kind, label, icon]: the catalogue-kinds registry's kinds (data/registries/catalogue-kinds.json), in order.
export const SECTIONS = catalogueKinds.sections.map(([id, kind, label, ic]) => [id, kind, label, ic]);
/** @type {Record<string, string>} */
const TAB_SHORT = { places: 'Places', historic: 'Historic' };
const KIND_OF_SECTION = Object.fromEntries(SECTIONS.map(([id, kind]) => [id, kind]));
const SECTION_OF_KIND = Object.fromEntries(SECTIONS.map(([id, kind]) => [kind, id]));
/** @param {string | undefined} kind */
// No kind (a row not found) finds no section: the default.
export const sectionOfKind = (kind) => SECTION_OF_KIND[/** @type {string} */ (kind)] || 'boundaries';

/**
 * A count's noun, singular for one: "1 County", "32 Counties".
 * @param {string} unit
 * @param {number} n
 */
export function unitWord(unit, n) {
  if (n !== 1) return unit;
  return String(unit).replace(/(\w+)$/, (w) => (/ies$/i.test(w) ? w.slice(0, -3) + 'y' : /(ches|shes|sses|xes)$/i.test(w) ? w.slice(0, -2) : /s$/i.test(w) && !/ss$/i.test(w) ? w.slice(0, -1) : w));
}

// CSS.escape is missing from some old browsers, which the lib types do not allow for.
/** @param {string} s */
const cssId = (s) => (/** @type {{ escape?: unknown } | undefined} */ (window.CSS)?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

export class CatalogueNext {
  /**
   * The open tab, a checked choice (route-state.mjs CATALOGUE_TAB; any other value throws).
   * @returns {'maps' | 'elections' | 'books'}
   */
  // The constructor sets the tab before anything reads it.
  get tab() { return /** @type {'maps' | 'elections' | 'books'} */ (this._tab); }
  set tab(value) { this._tab = CATALOGUE_TAB.check(value); }

  /** @param {CatalogueUi} ui */
  constructor(ui) {
    // The catalogue's lifetime (R8): its listeners on document and window pass this signal, and
    // dispose() takes them away.
    this.lifecycle = new AbortController();
    // Two-state fields as flags, and placesReady as a latch (MA-L): reads and writes unchanged.
    defineFlagFields(this, ['drawn', 'picking', 'electionsFirst', 'langNotice']);
    defineFlagFields(this, ['placesReady'], { latch: true });
    this.ui = ui;
    // Made by load() and mount(); what reads them before then tests for them first.
    /** @type {CatalogueDoc} */
    this.data = /** @type {CatalogueDoc} */ (/** @type {unknown} */ (null));
    /** @type {Promise<void> | null} */
    this.loading = null;
    /** @type {HTMLElement} */
    this.root = /** @type {HTMLElement} */ (/** @type {unknown} */ (null));
    // Made by mount() and load(), as root and data are; declared here as made.
    /** @type {HTMLElement} */
    this.tabsEl = /** @type {HTMLElement} */ (/** @type {unknown} */ (undefined));
    /** @type {HTMLElement} */
    this.viewEl = /** @type {HTMLElement} */ (/** @type {unknown} */ (undefined));
    /** @type {HTMLElement} */
    this.pickEl = /** @type {HTMLElement} */ (/** @type {unknown} */ (undefined));
    /** @type {HTMLElement} */
    this.compareEl = /** @type {HTMLElement} */ (/** @type {unknown} */ (undefined));
    /** @type {Map<string, CatalogueRow>} */
    this.seriesById = /** @type {Map<string, CatalogueRow>} */ (/** @type {unknown} */ (undefined));
    /** @type {Map<string, CatalogueSubject>} */
    this.subjectById = /** @type {Map<string, CatalogueSubject>} */ (/** @type {unknown} */ (undefined));
    /** @type {Map<string, CatalogueShelf>} */
    this.shelfById = /** @type {Map<string, CatalogueShelf>} */ (/** @type {unknown} */ (undefined));
    /** @type {Map<string, string>} each map's row */
    this.seriesOfMap = /** @type {Map<string, string>} */ (/** @type {unknown} */ (undefined));
    /** @type {Map<string, CatalogueRowElection>} */
    this.electionByKey = /** @type {Map<string, CatalogueRowElection>} */ (/** @type {unknown} */ (undefined));
    /** @type {CatalogueSearch} */
    this.search = /** @type {CatalogueSearch} */ (/** @type {unknown} */ (undefined));
    /** @type {YearBin[]} */
    this.mapBins = /** @type {YearBin[]} */ (/** @type {unknown} */ (undefined));
    /** @type {YearBin[]} */
    this.electionBins = /** @type {YearBin[]} */ (/** @type {unknown} */ (undefined));
    /** @type {[number, number] | [null, null]} */
    this.allMapYears = /** @type {[number, number] | [null, null]} */ (/** @type {unknown} */ (undefined));
    /** @type {[number, number] | [null, null]} */
    this.allElectionYears = /** @type {[number, number] | [null, null]} */ (/** @type {unknown} */ (undefined));
    const saved = readStore();
    this.tab = 'maps';
    this.section = 'boundaries';
    /** @type {MapFilters} */
    this.filters = { ...BLANK_FILTERS, ...(saved.filters || {}) };
    // "On the map" has no button for now, so it cannot be left on unseen; "to be added" is per row.
    this.filters.onMap = false;
    delete this.filters.toAdd;
    // The kind is the section now, not a filter.
    this.filters.kind = '';
    // Before v3 an empty kind was the default (All); General elections are now.
    const efilters = { ...(saved.efilters || {}) };
    if ((saved.v || 0) < 3) delete efilters.ekind;
    /** @type {ElectionFilters} */
    this.efilters = { ...BLANK_EFILTERS, ...efilters, body: '' };
    /** @type {Set<string>} the shelves open */
    this.opened = new Set(saved.opened || []);
    this.filtersOpen = false;
    /** @type {Set<string>} the rows open */
    this.expanded = new Set();
    /** @type {Map<string, string>} each row's chosen edition */
    this.selected = new Map();
    /** @type {Map<string, string>} each row's edition last put on the map */
    this.lastOn = new Map();
    /** @type {string | null} */
    this.focusSeries = null;
    /** @type {Set<string>} */
    this.moreChips = new Set();
    /** @type {Set<string>} */
    this.moreParts = new Set();
    /** @type {Set<string>} */
    this.showTodo = new Set();
    /** @type {Set<string>} */
    this.showLocal = new Set();
    /** @type {Record<string, boolean>} which lists show in full */
    this.limits = {};
    this.query = '';
    /** @type {Map<string, SearchHit> | null} */
    this.searchHits = null;
    /** @type {{ from: number, to: number } | null} */
    this.searchPeriod = null;
    /** @type {Map<string, string> | null} each election the search found, with why */
    this.electionHits = null;
    this.electionsFirst = false;
    /** @type {Set<string> | null} */
    this.bookHits = null;
    /** @type {SearchExtras | null} */
    this.extras = null;
    // The search is the language phrase (lang-reveal.js): one line in place of the results.
    this.langNotice = false;
    this.searchToken = 0;
    /** @type {LngLat | null} */
    this.here = null;
    /** @type {CataloguePerson | null} */
    this.person = null;
    // Addresses for the search box (geocoder.js): { loading, results, source, paused, query }.
    this.geocoder = new AddressGeocoder();
    /** @type {AddressState | null} */
    this.addresses = null;
    /** @type {AbortController | null} */
    this.addressController = null;
    /** @type {PeopleSearch | null} */
    this.peopleSearch = null;
    this.placesReady = false;
    /** @type {CatalogueCompare | null} */
    this.compare = null;
    this.picking = false;
    /** @type {Set<string>} maps and elections loading */
    this.busy = new Set();
    /** @type {Set<string>} */
    this.pendingToggle = new Set();
    if (typeof window !== 'undefined') {
      // Capture phase: the site's own popstate handlers, registered earlier, rewrite the address
      // from the current view, so this one has to take the new view first.
      window.addEventListener('popstate', () => this.onLocationChange({ rewrite: true }), { capture: true, signal: this.lifecycle.signal });
      window.addEventListener('hashchange', () => this.onLocationChange(), { capture: true, signal: this.lifecycle.signal });
      // The control's Hide action: the phrase leaves the search box with it.
      document.addEventListener('civgraph:langhide', () => {
        forgetTypedPhrase();
        const input = document.getElementById('searchInput');
        if (!this.langNotice || !input) return;
        /** @type {HTMLInputElement} */ (input).value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, { signal: this.lifecycle.signal });
    }
  }

  /* ================================================================ lifecycle */

  /** Removes the listeners the catalogue put on document and window (R8). */
  dispose() {
    this.lifecycle.abort();
  }

  async load() {
    // this.data is set mid-load, before the year spans and the route; a second render that
    // arrives then must wait for the whole load, not draw from half-built state.
    if (!this.loading) {
      this.loading = (async () => {
        // The books list is fetched alongside the catalogue rather than after it.
        const books = dataService.ensureBooksLoaded().catch(() => null);
        const [res] = await Promise.all([
          takeCatalogueData(),
          this.ui.ensureThumbnailManifest?.().catch(() => null),
          this.ui.ensureFeatureCountManifest?.().catch(() => null),
        ]);
        if (!res.ok) throw new Error(`catalogue data: ${res.status}`);
        this.data = /** @type {CatalogueDoc} */ (await res.json());
        this.seriesById = new Map(this.data.series.map((s) => [s.id, s]));
        loadAuth().then((auth) => { this.auth = auth; if (auth.allowed && this.drawn && this.expanded.size) this.refreshResults(); }).catch(() => {});
        this.subjectById = new Map(this.data.subjects.map((s) => [s.id, s]));
        this.shelfById = new Map(this.data.shelves.map((s) => [s.id, s]));
        this.seriesOfMap = new Map();
        for (const s of this.data.series) for (const m of [...s.members, ...(s.local || [])]) this.seriesOfMap.set(m.id, s.id);
        for (const s of this.data.series) for (const m of s.members) for (const p of [...(this.data.maps[m.id]?.parts || []), ...(this.data.maps[m.id]?.counties || [])]) if (!this.seriesOfMap.has(p.id)) this.seriesOfMap.set(p.id, s.id);
        this.electionByKey = new Map(this.data.elections.map((e) => [e.key, e]));
        /** @type {BooksDocument | null} */
        this.books = await books;
        if (this.books && !this.ui.booksData) this.ui.booksData = this.books;
        this.search = new CatalogueSearch(this.data, { books: this.books?.books || [] });
        /** @type {Array<number | null>} */
        const editionYears = [];
        for (const s of this.data.series) for (const m of s.members) editionYears.push(yearOf(this.rec(m.id).date));
        this.mapBins = decadeDomain(editionYears);
        /** @param {Array<number | null>} ys @returns {[number, number] | [null, null]} */
        const span2 = (ys) => { const v = /** @type {number[]} */ (ys.filter(Number.isFinite)); return v.length ? [Math.min(...v), Math.max(...v)] : [null, null]; };
        this.allMapYears = span2(editionYears);
        this.allElectionYears = span2(this.data.elections.map((e) => yearOf(e.date)));
        this.electionBins = decadeDomain(this.data.elections.map((e) => yearOf(e.date)));
        this.applyRoute(this.resolveRoute(initialCatalogueRoute()) || this.routeFromLocation() || 'maps');
      })();
    }
    await this.loading;
  }

  /**
   * Draw the catalogue into the container (mounting it there first), then search for the query.
   * @param {HTMLElement} container
   * @param {{ query?: string }} [options]
   * @returns {Promise<boolean>} false when the catalogue could not be loaded
   */
  async render(container, options = {}) {
    /** @type {HTMLElement} */
    this.container = container;
    if (!this.root || !container.contains(this.root)) this.mount(container);
    try {
      await this.load();
    } catch (err) {
      // fetch, res.json and load's own throw each reject with an Error.
      this.viewEl.innerHTML = `<p class="cn-empty">The catalogue could not be loaded (${esc(/** @type {Error} */ (err).message)}).</p>`;
      return false;
    }
    // The section bar and jump bar stick below the title-and-search shell; the current pane's
    // code measures the shell for exactly this.
    this.ui._syncCatalogueShellHeight?.();
    this.ensureContentsButton();
    const q = String((options.query !== undefined ? options.query : this.ui?._catalogueSearchQuery) || '').trim();
    if (q !== this.query) this.setQuery(q);
    else if (!this.drawn) this.draw();
    this.syncState();
    return true;
  }

  /** @param {HTMLElement} container */
  mount(container) {
    if (!document.getElementById('cn-styles')) {
      const style = document.createElement('style');
      style.id = 'cn-styles';
      style.textContent = CATALOGUE_CSS;
      document.head.appendChild(style);
    }
    container.innerHTML = `<div class="cn" data-cn-root>
      <nav class="catalogue-flat__sections cn-tabs" aria-label="Catalogue sections" data-cn-tabs></nav>
      <div class="cn-pick" data-cn-pick role="status" hidden></div>
      <div class="cn-view" data-cn-view><p class="cn-empty">Loading the catalogue…</p></div>
      <div data-cn-compare></div>
    </div>`;
    // Each is in the markup set just above.
    this.root = /** @type {HTMLElement} */ (container.querySelector('[data-cn-root]'));
    this.tabsEl = /** @type {HTMLElement} */ (this.root.querySelector('[data-cn-tabs]'));
    this.viewEl = /** @type {HTMLElement} */ (this.root.querySelector('[data-cn-view]'));
    this.pickEl = /** @type {HTMLElement} */ (this.root.querySelector('[data-cn-pick]'));
    this.compareEl = /** @type {HTMLElement} */ (this.root.querySelector('[data-cn-compare]'));
    // Clicks and keys in the catalogue land on its elements.
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onYearTyped(e));
    // Thumbnail hover previews and the reused search and book buttons are handled by the
    // current pane's delegates on the container.
    this.ui.bindFlatViewDelegates?.(container);
    this.drawn = false;
    this.scroller = this.findScroller();
    this.watchChrome();
    // Dragging the divider between the pane and the map changes how many chips fit on a row's
    // two lines and how far apart a timeline's labels sit: redraw the list once the width
    // settles (Phelim Birch's review, 2026-10-11). The layout itself follows by container queries.
    if (typeof ResizeObserver === 'function') {
      this.resizeObs?.disconnect();
      this.paneWidth = 0;
      /** @type {ResizeObserver | undefined} */
      this.resizeObs = new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (!w || Math.abs(w - (this.paneWidth || 0)) < 24) return;
        const first = !this.paneWidth;
        this.paneWidth = w;
        if (first) return;
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
          if (this.tab !== 'maps' || this.here || !this.drawn) return;
          const s = this.scroller || this.findScroller();
          const top = s?.scrollTop;
          this.refreshResults();
          if (s) s.scrollTop = /** @type {number} */ (top);
        }, 200);
      });
      this.resizeObs.observe(this.root);
    }
  }

  /** Keep each row's chips to one line: measure the chips as drawn and hide those that would
   * wrap, with "+N more" (itself on the first line) to show them all. A row whose chips are all
   * showing ("Hide" is drawn instead) is left as it is; so is one in a closed shelf, which is
   * fitted when it opens. */
  /** @param {ParentNode} scope */
  fitChips(scope) {
    scope.querySelectorAll?.('.cn-chips').forEach((box) => {
      const more = /** @type {HTMLElement | null} */ (box.querySelector(':scope > [data-cn-more]'));
      if (!more || !/** @type {HTMLElement} */ (box).offsetParent) return;
      // The to-be-added switch is a control, not a map: it stays on the line beside "+N more".
      const keep = /** @type {HTMLElement | null} */ (box.querySelector(':scope > [data-cn-todo]'));
      const items = [.../** @type {HTMLCollectionOf<HTMLElement>} */ (box.children)].filter((el) => el !== more && el !== keep);
      items.forEach((el) => { setHidden(el, false); });
      setHidden(more, true);
      const top = items[0]?.offsetTop;
      // The first chip's top: there is one, as the row has more than fit.
      /** @param {HTMLElement} el */
      const wraps = (el) => el.offsetTop > /** @type {number} */ (top) + 2;
      const firstWrapped = items.findIndex(wraps);
      if (firstWrapped < 0) return;
      let shown = firstWrapped;
      items.slice(shown).forEach((el) => { setHidden(el, true); });
      const label = () => { more.textContent = `+${items.length - shown} more`; };
      setHidden(more, false);
      label();
      // "+N more" sits on the first line too: give it room by hiding chips from the end.
      while (shown > 1 && (wraps(more) || (keep && wraps(keep)))) {
        shown -= 1;
        setHidden(items[shown], true);
        label();
      }
      more.setAttribute('aria-label', `Show ${items.length - shown} more`);
    });
  }

  /** The element the pane scrolls in: the catalogue's nearest scrolling ancestor. @returns {HTMLElement | null} */
  findScroller() {
    for (let el = /** @type {HTMLElement | null | undefined} */ (this.container); el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
    return null;
  }

  /* ================================================================ drawing */

  draw() {
    if (!this.root || !this.data) return;
    closeMenu({ restoreFocus: false });
    this.tabsEl.innerHTML = this.tabsHtml();
    let toolbar = '';
    let results = '';
    if (this.langNotice) {
      results = langNoticeHtml();
    } else if (this.tab === 'elections') {
      toolbar = ElectionsView.toolbarHtml(this);
      results = ElectionsView.resultsHtml(this);
    } else if (this.tab === 'books') {
      results = BooksView.booksHtml(this);
    } else {
      toolbar = this.here ? '' : MapsView.toolbarHtml(this);
      results = MapsView.resultsHtml(this);
    }
    this.viewEl.innerHTML = `${toolbar}<div class="cn-results" data-cn-results>${results}</div>`;
    /** @type {HTMLElement | null | undefined} */
    this.resultsEl = /** @type {HTMLElement | null} */ (this.viewEl.querySelector('[data-cn-results]'));
    this.drawn = true;
    this.afterDraw(this.root);
    this.drawCompare();
  }

  /** Redraw the list only: the filters stay (a slider handle may be held). */
  refreshResults() {
    if (!this.resultsEl || !this.resultsEl.isConnected) return this.draw();
    closeMenu({ restoreFocus: false });
    this.tabsEl.innerHTML = this.tabsHtml();
    this.resultsEl.innerHTML = this.langNotice ? langNoticeHtml() : this.tab === 'elections' ? ElectionsView.resultsHtml(this)
      : this.tab === 'books' ? BooksView.booksHtml(this) : MapsView.resultsHtml(this);
    this.refreshToolbar();
    this.afterDraw(this.resultsEl);
    return undefined;
  }

  refreshToolbar() {
    const bar = /** @type {HTMLElement | null} */ (this.viewEl.querySelector('[data-cn-toolbar]'));
    if (!bar) return;
    const key = /** @type {FilterKey} */ (bar.dataset.cnToolbar);
    // Read by each button's filter name.
    const f = /** @type {Record<string, unknown>} */ (key === 'maps' ? this.filters : this.efilters);
    /** @type {NodeListOf<DataTarget>} */ (bar.querySelectorAll('[data-cn-filter]')).forEach((b) => {
      const g = b.dataset.cnFilter;
      const on = g === 'onMap' ? Boolean(f[g]) : (f[g] || '') === (b.dataset.value || '');
      b.setAttribute('aria-pressed', String(on));
    });
    const { i, j, narrowed } = this.yearRange(key);
    const bins = key === 'maps' ? this.mapBins : this.electionBins;
    updateSlider(bar.querySelector('[data-cn-slider]'), bins, i, j, this.yearState(key));
    const undated = /** @type {HTMLElement | null} */ (bar.querySelector('[data-cn-undated-wrap]'));
    if (undated) setHidden(undated, !narrowed);
    const n = this.activeFilterCount(key);
    const toggle = bar.querySelector('.cn-filters-toggle');
    if (toggle) toggle.innerHTML = `${icon('sliders')}Filters${n ? ` <span class="cn-badge">${n}</span>` : ''}`;
    this.placeFiltersButton();
  }

  /**
   * The Filters button sits beside the search bar (owner, 1 Nov 2026). The toolbar keeps its own
   * button, visually hidden, so the folded-layout rules (a narrow catalogue) still decide whether a
   * button is needed at all; this copy mirrors it and passes clicks to it.
   */
  placeFiltersButton() {
    const search = document.querySelector('.search-input');
    if (!search) return;
    let copy = /** @type {HTMLButtonElement | null} */ (document.getElementById('cnFiltersButton'));
    if (!copy) {
      copy = document.createElement('button');
      copy.type = 'button';
      copy.id = 'cnFiltersButton';
      copy.className = 'cn-filters-button';
      copy.addEventListener('click', () => {
        /** @type {HtmlScope | undefined} */ (this.viewEl)?.querySelector('[data-cn-toolbar] .cn-filters-toggle')?.click();
        this.placeFiltersButton();
      });
      search.after(copy);
      if (!this._filtersButtonResize) {
        this._filtersButtonResize = () => this.placeFiltersButton();
        window.addEventListener('resize', this._filtersButtonResize, { signal: this.lifecycle.signal });
      }
    }
    const original = this.viewEl?.querySelector('[data-cn-toolbar] .cn-filters-toggle');
    setHidden(copy, !original || getComputedStyle(original).display === 'none');
    if (original) {
      copy.innerHTML = original.innerHTML.replace('Filters', '<span class="cn-filters-button__label">Filters</span>');
      copy.title = 'Filters';
      copy.setAttribute('aria-expanded', original.getAttribute('aria-expanded') || 'false');
    }
  }

  /** @param {ParentNode} scope */
  afterDraw(scope) {
    this.placeFiltersButton();
    // Sticky headings sit just below the section tabs, which wrap to two rows in a narrow pane.
    if (this.tabsEl?.offsetHeight) this.root.style.setProperty('--cn-tabs-h', `${this.tabsEl.offsetHeight}px`);
    // The folded filters show the count beside their button; the list keeps its own for screen readers.
    const tally = this.viewEl?.querySelector('[data-cn-tally]');
    if (tally) tally.textContent = this.resultsEl?.querySelector('.cn-summary--count')?.textContent || '';
    this.fitChips(scope);
    // A long timeline opens on the chosen edition, not on its first year.
    scope.querySelectorAll?.('.cn-tl').forEach((tl) => {
      const tick = /** @type {HTMLElement | null} */ (tl.querySelector('.cn-tick[aria-pressed="true"]'));
      if (tick && tl.scrollWidth > tl.clientWidth) tl.scrollLeft = Math.max(0, tick.offsetLeft - tl.clientWidth / 2);
    });
    this.observeThumbs(scope);
    this.ui.hydrateLazyThumbnails?.(scope);
    this.ui.syncCatalogueSearchActionButtons?.(scope);
    this.ui.syncDownloadButtons?.(scope);
    this.rovingChips(scope);
    this.syncState();
    if (this.scrollTarget) requestAnimationFrame(() => this.scrollToTarget());
  }

  /** A search is narrowing the lists (the language phrase does not). */
  get searching() { return Boolean(this.query) && !this.langNotice; }

  /** The open section: one of SECTIONS' ids, or elections (or books, reached only by an old link). */
  get openSection() { return this.tab === 'maps' ? this.section : this.tab; }

  tabsHtml() {
    const counts = this.tabCounts();
    // A phone shows a short label under the icon (styles.js): "Places", "Historic".
    /** @param {string} id @param {string} ic @param {string} label @param {number} n */
    const tab = (id, ic, label, n) => `<button type="button" class="catalogue-flat__section-tab cn-tab" data-cn-tab="${id}" aria-current="${String(this.openSection === id)}">${icon(ic, 'catalogue-flat__section-icon')}<span class="cn-tab__long">${label}</span><span class="cn-tab__short">${TAB_SHORT[id] || label}</span><span class="cn-tab__count">${siteNumber(n)}</span></button>`;
    return SECTIONS.map(([id, , label, ic]) => tab(id, ic, label, counts[id])).join('') + tab('elections', 'vote', 'Elections', counts.elections);
  }

  /** Series per section (those a search found, while searching) and elections. */
  tabCounts() {
    const searching = this.searching;
    /** @type {Record<string, number>} */
    const out = { elections: this.visibleElections().length, books: searching ? this.bookHits?.size || 0 : this.books?.books?.length || 0 };
    // Each section counts its maps (every map a row can add: editions, versions, council maps), not its rows.
    /** @param {CatalogueRow} s */
    const mapsIn = (s) => (searching ? (this.searchHits?.get(s.id)?.members?.length || s.members.length) : s.members.length + (s.local?.length || 0));
    for (const [id, kind] of SECTIONS) out[id] = this.data.series.filter((s) => s.kind === kind && (!searching || this.searchHits?.has(s.id))).reduce((n, s) => n + mapsIn(s), 0);
    return out;
  }

  /** When the open section has nothing for a search but another does, say so. */
  otherTabHint() {
    if (!this.query) return '';
    const n = this.tabCounts();
    const others = /** @type {Array<[string, string, number]>} */ ([...SECTIONS.map(([id, , label]) => [id, label.toLowerCase(), n[id]]), ['elections', 'elections', n.elections]]).filter(([id, , k]) => id !== this.openSection && k);
    if (!others.length) return '';
    return ` ${others.map(([id, label, k]) => `<button type="button" class="cn-link" data-cn-tab="${id}">${siteNumber(k)} in ${label}</button>`).join(', ')} match it.`;
  }

  /* ================================================================ data helpers (used by the views) */

  /** @param {string} id @returns {CatalogueMapRec} */
  rec(id) { return this.data.maps[id] || {}; }
  /** @param {string} id @returns {MapRecord | null} the record as the UI reads it (ui-controller-types.d.ts) */
  full(id) { try { return /** @type {MapRecord | undefined} */ (dataService.getMapById(id)) || null; } catch { return null; } }
  /**
   * A thumbnail, as the current pane draws it (same classes, so the same hover preview), but loaded
   * by observeThumbs: the current pane's loader watches the window, and the pane scrolls inside
   * its own box, which hides everything below its edge from that loader until it is on screen.
   */
  /** @param {string | undefined} id */
  thumb(id) {
    const ui = this.ui;
    const small = (id && (ui.thumbnailPath?.(id, '-60') || ui.thumbnailPath?.(id))) || '';
    if (!small) return '<span class="catalogue-flat__toc-thumb catalogue-flat__toc-thumb--fallback"></span>';
    // A thumbnail was found above, so there is an id.
    const full = ui.thumbnailPath?.(/** @type {string} */ (id)) || '';
    const blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const zoom = full ? `<span class="catalogue-flat__toc-thumbzoom" aria-hidden="true"><img src="${blank}" data-thumbnail-src="${full}" data-thumbnail-defer="hover" alt="" loading="lazy"></span>` : '';
    return `<span class="catalogue-flat__toc-thumbwrap"><img class="catalogue-flat__toc-thumb" src="${blank}" data-cn-src="${small}" alt="" decoding="async">${zoom}</span>`;
  }

  /** Load thumbnails a screen or two before they scroll into the pane. */
  /** @param {ParentNode} scope */
  observeThumbs(scope) {
    const imgs = /** @type {NodeListOf<HTMLImageElement>} */ (scope.querySelectorAll?.('img[data-cn-src]') || []);
    if (!imgs.length) return;
    /** @param {HTMLImageElement} img one still to load, so with its data-cn-src */
    const load = (img) => { img.src = /** @type {string} */ (img.dataset.cnSrc); img.removeAttribute('data-cn-src'); };
    if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
    if (!this.thumbObserver || this.thumbObserverRoot !== this.scroller) {
      this.thumbObserver?.disconnect();
      this.thumbObserverRoot = this.scroller;
      this.thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          /** @type {IntersectionObserver} */ (this.thumbObserver).unobserve(entry.target);
          load(/** @type {HTMLImageElement} */ (entry.target));
        }
      }, { root: this.scroller || null, rootMargin: '900px 0px' });
    }
    imgs.forEach((img) => /** @type {IntersectionObserver} */ (this.thumbObserver).observe(img));
  }

  /** "OSNI - 11 Local Government Districts": provider and feature count, as the current pane writes it. */
  /** @param {string} id @param {{ full?: boolean }} [options] */
  providerLine(id, { full: fullText = false } = {}) {
    const m = this.full(id);
    let line = '';
    if (m && this.ui.renderMapProviderSummary) line = this.ui.renderMapProviderSummary(m) || '';
    if (!line) {
      const r = this.rec(id);
      line = [(r.provider || []).join(', '), r.features ? `${siteNumber(r.features)} features` : ''].filter(Boolean).join(' - ');
    }
    return fullText || line.length <= 90 ? line : `${line.slice(0, 88)}…`;
  }

  /** @param {unknown} d @returns {number | null} */
  decimalYear(d) {
    const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(d || ''));
    if (!m) return null;
    return Number(m[1]) + (m[2] ? (Number(m[2]) - 1) / 12 : 0.5) + (m[3] ? (Number(m[3]) - 1) / 365 : 0);
  }

  /** What a map's own name adds to its label: "2022 (Final Recommendations)" in LGDs, labelled 2022 -> "Final Recommendations". */
  /** @param {string | undefined} name @param {string} label @param {string} [seriesName] */
  nameBeyondLabel(name, label, seriesName = '') {
    if (!name || name === label) return '';
    let rest = name;
    for (const part of [label, seriesName.replace(/\s*\([^)]*\)$/, '')]) {
      const i = part ? rest.toLowerCase().indexOf(part.toLowerCase()) : -1;
      if (i >= 0) rest = rest.slice(0, i) + rest.slice(i + part.length);
    }
    const clean = rest.replace(/\(\s*\)/g, '').replace(/^[\s—–:·,-]+|[\s—–:·,-]+$/g, '').replace(/^\((.*)\)$/, '$1').trim();
    return clean.length > 1 ? clean : '';
  }

  /** @param {CatalogueRow} s */
  selectedMember(s) {
    const id = this.selected.get(s.id);
    return s.members.find((m) => m.id === id) || s.members.find((m) => this.isLoaded(m.id)) || s.members.find((m) => this.rec(m.id).status !== 'placeholder') || s.members[0];
  }

  /** @param {CatalogueRow} s */
  hitFor(s) { return this.query ? this.searchHits?.get(s.id) : null; }

  /* ================================================================ filters */

  /** @param {FilterKey} key */
  yearRange(key) {
    const f = key === 'maps' ? this.filters : this.efilters;
    // The pane can be drawn before the year bins exist (a slow first load): treat them as empty.
    const bins = (key === 'maps' ? this.mapBins : this.electionBins) || [];
    const last = Math.max(0, bins.length - 1);
    // The years are exact (typed, or a decade's first year from a handle); the handles show
    // the decades they fall in.
    const from = Number.isFinite(f.from) ? f.from : null;
    const to = Number.isFinite(f.to) ? f.to : null;
    const i = indexOf(bins, from, 0);
    const j = Math.max(i, indexOf(bins, to, last));
    return { i, j, from, to, lo: from ?? -Infinity, hi: to ?? Infinity, narrowed: from !== null || to !== null };
  }

  /** What the year filter shows: the chosen years, the data's span, and how many it holds. */
  /** @param {FilterKey} key @returns {SliderState} */
  yearState(key) {
    const r = this.yearRange(key);
    const years = key === 'maps'
      ? this.data.series.filter((s) => this.seriesShown(s, { ignoreYears: true })).flatMap((s) => s.members.map((m) => yearOf(this.rec(m.id).date)))
      : this.data.elections.filter((e) => this.electionShown(e, { ignoreYears: true })).map((e) => yearOf(e.date));
    const all = key === 'maps' ? this.allMapYears : this.allElectionYears;
    return {
      from: r.from, to: r.to, min: all[0], max: all[1],
      // Number.isFinite has passed each year compared.
      total: years.filter((y) => Number.isFinite(y) && /** @type {number} */ (y) >= r.lo && /** @type {number} */ (y) <= r.hi).length,
      noun: key === 'maps' ? 'dated map' : 'election',
    };
  }

  /** @param {FilterKey} key @param {number | null} y */
  inYears(key, y) {
    const r = this.yearRange(key);
    if (!r.narrowed) return true;
    // Number.isFinite has passed the year compared.
    return Number.isFinite(y) && /** @type {number} */ (y) >= r.lo && /** @type {number} */ (y) <= r.hi;
  }

  // A map with no date (Civil Parishes, Baronies) shows until years are chosen; then only if the
  // reader includes undated maps (Phelim Birch's review, 2026-10-08: off by default).
  /** @param {string} id */
  editionInYears(id) {
    const r = this.rec(id);
    if (r.years?.length) return r.years.some((y) => this.inYears('maps', y));
    const y = yearOf(r.date);
    if (Number.isFinite(y)) return this.inYears('maps', y);
    return !this.yearRange('maps').narrowed || Boolean(this.filters.undated);
  }

  /** What a map is, in one form everywhere (hover, rows): "date · provider · count", the date
   * left out when there is none. */
  /** @param {string} id @param {{ date?: boolean, short?: boolean }} [options] */
  mapSummary(id, { date = true, short = false } = {}) {
    const r = this.rec(id);
    const m = this.full(id);
    const providers = (r.provider?.length ? r.provider : [m?.provider || []].flat()).filter(Boolean).map((p) => (short ? shortProvider(p) : p)).join(', ');
    let count = '';
    const n = r.features || (m && this.ui.getMapFeatureCount ? this.ui.getMapFeatureCount(m) : null);
    // Number.isFinite has passed the count used.
    if (Number.isFinite(n) && /** @type {number} */ (n) > 0) count = `${siteNumber(/** @type {number} */ (n))} ${unitWord(r.unit || (m && this.ui.getMapFeatureUnitLabel ? this.ui.getMapFeatureUnitLabel(m, /** @type {number} */ (n)) : 'features'), /** @type {number} */ (n))}`;
    const constituencies = /^constituencies-/.test(this.seriesOfMap?.get(id) || '');
    return [date && r.date && !constituencies ? mapDate(r) : '', providers, count].filter(Boolean).join(' · ');
  }

  /** Contributors suggest edits to a map; anyone else is sent to sign in first (packages/map/src/catalogue/edit.js). */
  /** @param {string} id */
  suggestEdit(id) {
    const record = this.full(id);
    if (!record) return;
    if (!this.auth?.allowed) {
      if (this.auth?.authenticated) { this.announce?.('Your account is not on the contributor list.'); window.alert(`Signed in as ${this.auth.email}, which is not on the contributor list. Ask the site owner to add it.`); return; }
      location.href = loginHref();
      return;
    }
    openEditDialog(record, { host: this.root || document.body });
  }

  /** The description of the row a map is in, for its Details page ('' when it has none). */
  /** @param {string} mapId */
  rowAboutHtml(mapId) {
    // A map in no row finds no row.
    const s = this.seriesById?.get(/** @type {string} */ (this.seriesOfMap?.get(mapId)));
    return s?.about ? MapsView.aboutHtml(s.about, { heading: s.name }) : '';
  }

  /** @param {FilterKey} key */
  activeFilterCount(key) {
    // Either tab's filters: each reads its own fields.
    const f = /** @type {Partial<MapFilters & ElectionFilters>} */ (key === 'maps' ? this.filters : this.efilters);
    const n = key === 'maps'
      ? [f.scope, f.kind, f.onMap].filter(Boolean).length
      : [f.ekind !== 'general', f.escope].filter(Boolean).length;
    return n + (this.yearRange(key).narrowed ? 1 : 0);
  }

  /** @param {CatalogueRow} s */
  seriesOnMap(s) {
    return [...s.members, ...(s.local || [])].some((m) => this.isLoaded(m.id) || (this.rec(m.id).parts || []).some((p) => this.isLoaded(p.id)));
  }

  /** @param {CatalogueRow} s @param {{ ignoreYears?: boolean, ignoreSection?: boolean }} [options] */
  seriesShown(s, { ignoreYears = false, ignoreSection = false } = {}) {
    const f = this.filters;
    if (f.scope && s.scope !== f.scope) return false;
    if (!ignoreSection && s.kind !== KIND_OF_SECTION[this.section]) return false;
    if (!ignoreYears && this.yearRange('maps').narrowed && !s.members.some((m) => this.editionInYears(m.id))) return false;
    if (f.onMap && !this.seriesOnMap(s)) return false;
    if (this.searching && !this.searchHits?.has(s.id)) return false;
    return true;
  }

  /** The shelf a series sits on in the open section (Boundaries merges four into Environment). */
  /** @param {CatalogueRow} s */
  shelfIn(s) {
    for (const [id, m] of Object.entries(MERGED_SHELVES[this.section] || {})) if (m.shelves.includes(s.shelf)) return id;
    return s.shelf;
  }

  /** @returns {VisibleShelf[]} */
  visibleShelves() {
    /** @param {CatalogueRow} s */
    const score = (s) => this.searchHits?.get(s.id)?.score || 0;
    let shelves = this.data.shelves.map((sh) => {
      // Every id the document lists is in it: filter(Boolean) only guards against one that is not.
      const subjects = /** @type {CatalogueSubject[]} */ (sh.subjects.map((sid) => this.subjectById.get(sid)).filter(Boolean)).map((sub) => {
        let series = /** @type {CatalogueRow[]} */ (sub.series.map((id) => this.seriesById.get(id)).filter((s) => s && this.seriesShown(s)));
        if (this.query) series = series.sort((a, b) => score(b) - score(a));
        return { sub, series, best: Math.max(0, ...series.map(score)) };
      }).filter((x) => x.series.length);
      if (this.query) subjects.sort((a, b) => b.best - a.best);
      return { sh, subjects, count: subjects.reduce((n, x) => n + x.series.length, 0), best: Math.max(0, ...subjects.map((x) => x.best)) };
    }).filter((x) => x.subjects.length);
    for (const [id, m] of Object.entries(MERGED_SHELVES[this.section] || {})) {
      const parts = shelves.filter((x) => m.shelves.includes(x.sh.id));
      if (!parts.length) continue;
      /** @type {VisibleShelf} */
      const merged = {
        // Each part's `last` rows still go to the end (Water Districts (Roscommon), a council's map).
        sh: { id, name: m.name, subjects: parts.flatMap((x) => x.sh.subjects), flat: true, last: parts.flatMap((x) => x.sh.last || []) },
        subjects: parts.flatMap((x) => x.subjects),
        count: parts.reduce((n, x) => n + x.count, 0),
        best: Math.max(...parts.map((x) => x.best)),
      };
      const at = shelves.indexOf(parts[0]);
      shelves = shelves.filter((x) => !parts.includes(x));
      shelves.splice(at, 0, merged);
    }
    if (this.query) shelves = shelves.filter((x) => x.count).sort((a, b) => b.best - a.best);
    return shelves;
  }

  mapCounts() {
    /** @type {Array<number | null>} */
    const years = [];
    for (const s of this.data.series) {
      if (!this.seriesShown(s, { ignoreYears: true })) continue;
      for (const m of s.members) years.push(yearOf(this.rec(m.id).date));
    }
    return binCounts(this.mapBins, years);
  }

  /** @param {CatalogueRowElection} e @param {{ ignoreYears?: boolean, ignoreKind?: boolean }} [options] */
  electionShown(e, { ignoreYears = false, ignoreKind = false } = {}) {
    const f = this.efilters;
    if (f.escope && e.scope !== f.escope) return false;
    // A person's record is every contest they stood in, by-elections included.
    const kind = ignoreKind || this.person ? '' : f.ekind;
    if (kind === 'by-election' && e.kind !== 'by-election') return false;
    if (kind === 'general' && e.kind === 'by-election') return false;
    if (!ignoreYears && !this.inYears('elections', yearOf(e.date))) return false;
    if (this.searching && !this.electionHits?.has(e.key)) return false;
    if (this.person && !this.person.contests.has(e.key)) return false;
    return true;
  }

  visibleElections() { return this.data.elections.filter((e) => this.electionShown(e)); }

  electionCounts() { return binCounts(this.electionBins, this.data.elections.filter((e) => this.electionShown(e, { ignoreYears: true })).map((e) => yearOf(e.date))); }

  /** By-elections the default (general elections only) leaves out of the list as it stands. */
  byElectionsHidden() {
    return this.data.elections.filter((e) => e.kind === 'by-election' && this.electionShown(e, { ignoreKind: true })).length;
  }

  /** Where and body are one-of-several with an All; kind (maps) and where (elections) have no All:
   * a pressed button is pressed again to show everything. */
  /** @param {string} group @param {string} value */
  setFilter(group, value) {
    if (group === 'scope') this.filters.scope = value;
    else if (group === 'kind') this.filters.kind = this.filters.kind === value ? '' : value;
    else if (group === 'onMap') this.filters.onMap = !this.filters.onMap;
    else if (group === 'ekind') this.efilters.ekind = value;
    else if (group === 'escope') this.efilters.escope = this.efilters.escope === value ? '' : value;
    this.saveStore();
    this.refreshResults();
  }

  clearFilters() {
    if (this.tab === 'elections') this.efilters = { ...BLANK_EFILTERS };
    else this.filters = { ...BLANK_FILTERS };
    this.saveStore();
    this.draw();
    this.replaceRoute();
  }

  saveStore() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ v: 3, filters: this.filters, efilters: this.efilters, opened: [...this.opened] }));
    } catch { /* private mode */ }
  }

  /* ================================================================ search */

  /** @param {string} q */
  setQuery(q) {
    this.query = q;
    if (q) this.person = null;
    this.limits = {};
    this.moreChips.clear();
    // The language phrase, typed into the box, turns the language control on; the line saying so
    // stands in for the results (also when the phrase comes back from the address afterwards).
    const revealed = isLanguagePhrase(q) && typedLanguagePhrase() && revealLanguageOptions();
    this.langNotice = isLanguagePhrase(q) && (revealed || languageOptionsShown() || typedLanguagePhrase());
    if (!q || this.langNotice) {
      this.addressController?.abort();
      this.addresses = null;
      this.searchHits = null;
      this.searchPeriod = null;
      this.electionHits = null;
      this.electionsFirst = false;
      this.bookHits = null;
      this.extras = null;
      this.draw();
      return;
    }
    const r = this.search.query(q, { includeToAdd: true });
    this.searchHits = new Map(r.series.map((h) => [h.id, h]));
    this.searchPeriod = r.period;
    this.electionHits = new Map(r.elections.map((h) => [h.id, '']));
    // "Dáil 2020" or "Westminster" is a search for elections: list them above any party or person
    // that shares a word, which used to push the election off the first screen.
    this.electionsFirst = r.elections.length > 0 && (r.namesBody || Boolean(r.period));
    for (const c of r.contests) for (const k of c.keys) if (!this.electionHits.has(k)) this.electionHits.set(k, `${c.name} contested`);
    this.bookHits = new Set(r.books.map((h) => h.id));
    this.extras = normalise(q).length >= 2 ? { loading: true } : null;
    this.loadAddresses(q);
    this.draw();
    if (this.extras) this.loadExtras(q);
  }

  /**
   * Address suggestions as the reader types (Photon, or postcodes.io for a BT postcode). The
   * box's own input debounce (280ms) spaces the requests; a newer query aborts the older one.
   * While Photon is paused (it failed, or turned us away) nothing is asked per keystroke: the
   * block says press Enter, and searchAddressesNow() makes the one request.
   */
  /** @param {string} q */
  loadAddresses(q) {
    this.addressController?.abort();
    this.addressController = null;
    const query = String(q || '').trim();
    if (query.length < 3 && !parsePostcode(query)) {
      this.addresses = null;
      return;
    }
    if (this.geocoder.paused && !parsePostcode(query)) {
      this.addresses = { query, results: [], paused: true };
      // Enter was pressed before the box's debounce passed this query on: search it now.
      if (this.enterQuery === query) {
        this.enterQuery = null;
        this.searchAddressesNow(query);
      }
      return;
    }
    const controller = new AbortController();
    this.addressController = controller;
    this.addresses = { query, loading: true, results: [] };
    this.geocoder.suggest(query, { signal: controller.signal }).then((r) => {
      if (controller.signal.aborted || query !== this.query) return;
      this.addresses = { query, ...r };
      this.refreshExtras();
    }).catch(() => {
      if (controller.signal.aborted || query !== this.query) return;
      this.addresses = { query, results: [], paused: this.geocoder.paused };
      this.refreshExtras();
    });
  }

  /** Enter in the search box: while suggestions are paused, the one Nominatim search. */
  /** @param {string} q */
  async searchAddressesNow(q) {
    const query = String(q || '').trim();
    if (!query || !this.geocoder.paused) return;
    if (query !== this.query) {
      this.enterQuery = query;
      return;
    }
    this.addresses = { query, loading: true, results: [], paused: true };
    this.refreshExtras();
    try {
      const r = await this.geocoder.search(query);
      if (query !== this.query) return;
      this.addresses = { query, ...r, paused: true, searched: true };
    } catch {
      this.addresses = { query, results: [], paused: true, searched: true, failed: true };
    }
    this.refreshExtras();
  }

  /** An address chosen from the results: fly there, with a marker; on a phone, show the map. */
  /** @param {string | number | undefined} index */
  goToAddress(index) {
    const hit = this.addresses?.results?.[Number(index)];
    if (!hit) return;
    this.ui.onAddressSelect?.(hit.lat, hit.lon, [hit.name, hit.detail].filter(Boolean).join(', '));
    app()?.dismissMobileCatalogueAfterLoad?.(hit.name);
    this.announce(`Showing ${hit.name} on the map`);
  }

  /** Places (named features, with their own buttons) and people, parties and sources, from the
   * current pane's search code, so they behave exactly as they do there. */
  /** @param {string} q */
  async loadExtras(q) {
    const token = ++this.searchToken;
    const norm = normalise(q);
    const ui = this.ui;
    const [features, index] = await Promise.all([
      ui.searchFeatures ? ui.searchFeatures(q).catch(() => []) : [],
      ui.ensureCatalogueSearchIndex ? ui.ensureCatalogueSearchIndex().catch(() => []) : [],
      ui.ensureFeatureThumbnailManifest ? ui.ensureFeatureThumbnailManifest().catch(() => null) : null,
      norm.length >= 3 ? this.ensurePeople() : null,
    ]);
    if (token !== this.searchToken || q !== this.query) return;
    /** @type {Map<string, PlaceGroup>} */
    const groups = new Map();
    for (const f of (features || []).slice(0, 150)) {
      const record = ui.featureSearchResultToCatalogueRecord ? ui.featureSearchResultToCatalogueRecord(f) : null;
      if (!record) continue;
      const k = normalise(record.title);
      if (!groups.has(k)) groups.set(k, { name: record.title, items: [] });
      /** @type {PlaceGroup} */ (groups.get(k)).items.push({ record });
    }
    const places = [...groups.values()].sort((a, b) => Number(normalise(b.name) === norm) - Number(normalise(a.name) === norm) || b.items.length - a.items.length);
    const qn = ui.normalizeCatalogueSearchText ? ui.normalizeCatalogueSearchText(q) : norm;
    const terms = qn.split(/\s+/).filter(Boolean);
    // The current pane's scorer counts a record that matches ANY word, so "general election 2020"
    // listed sixty parties and "Dáil 2020" put Renua above the election. Here every word but a
    // year must start a word of the record; a year alone names no party, person or source.
    const words = terms.filter((t) => !/^(1[5-9]\d\d|20\d\d)s?$/.test(t) && !STOP_WORDS.has(t));
    /** @param {CatalogueSearchRecord} r */
    const allWords = (r) => {
      const text = ` ${r.searchText || ''}`;
      return words.length > 0 && words.every((w) => text.includes(` ${w}`));
    };
    // Parties rank by how many elections they are linked to, after how well they match: "Ulster
    // Unionist" put sixty ballot-paper descriptions ("Ulster Unionist Farmer", each with 0 linked
    // elections) ahead of the UUP (UX review 2026-10-31, H8). Labels with no linked election are
    // left out of the index (ensureCatalogueSearchIndex).
    /** @param {CatalogueSearchRecord} r */
    const linked = (r) => Number(r.relatedElectionCount) || 0;
    const people = (index || [])
      .filter((r) => r.type === 'person' || r.type === 'party' || r.type === 'source')
      .filter(allWords)
      .map((r) => ({ r, s: ui.scoreCatalogueSearchRecord ? ui.scoreCatalogueSearchRecord(r, terms, qn, new Map()) : 0 }))
      .filter((x) => x.s > 0)
      .map((x) => (x.r.type === 'party' ? { ...x, s: x.s + Math.min(400, Math.log10(1 + linked(x.r)) * 150) } : x))
      .sort((a, b) => b.s - a.s || linked(b.r) - linked(a.r))
      .slice(0, 60)
      .map((x) => x.r);
    const persons = this.peopleSearch && norm.length >= 3 ? this.peopleSearch.query(q) : [];
    this.extras = { places, people, persons };
    this.refreshExtras();
  }

  /** Redraw what a search found besides maps, on the Maps or Elections tab, where it sits on top. */
  refreshExtras() {
    const slot = (this.tab === 'maps' && !this.here) || this.tab === 'elections' ? this.resultsEl?.querySelector('[data-cn-extras]') : null;
    if (!slot) return;
    slot.innerHTML = MapsView.extrasHtml(this, { places: this.tab === 'maps' });
    this.afterDraw(slot);
  }

  /** Empty the search box and the search, as when the reader clears it. */
  clearSearch() {
    const input = document.getElementById('searchInput');
    if (input) /** @type {HTMLInputElement} */ (input).value = '';
    this.query = '';
    this.langNotice = false;
    this.searchHits = null;
    this.searchPeriod = null;
    this.electionHits = null;
    this.electionsFirst = false;
    this.bookHits = null;
    this.extras = null;
    if (this.ui) this.ui._catalogueSearchQuery = '';
    const a = app();
    if (a) { a.searchQuery = ''; a.workerSearchQuery = ''; a.workerSearchResultIds = null; }
  }

  /** The person index (data/catalogue/people.json), on the first search that needs it. */
  /** @returns {Promise<PeopleSearch | null>} */
  ensurePeople() {
    if (this.peopleSearch) return Promise.resolve(this.peopleSearch);
    if (!this.peoplePromise) {
      /** @type {Promise<PeopleSearch | null> | undefined} */
      this.peoplePromise = fetch(PEOPLE_URL).then((r) => (r.ok ? r.json() : null)).then((/** @type {CataloguePeopleDoc | null} */ doc) => {
        if (!doc) return null;
        /** @type {CataloguePeopleDoc | undefined} */
        this.peopleDoc = doc;
        this.peopleSearch = new PeopleSearch(doc);
        this.peopleById = new Map(doc.people.map((row) => [String(row[0]), row]));
        return this.peopleSearch;
      }).catch(() => null);
    }
    return this.peoplePromise;
  }

  /** The elections a person stood in, each with where, for which party, and whether elected. */
  /** @param {PersonRow} row */
  setPerson(row) {
    // A person's row comes from the people index, so it is loaded.
    const { parties, constituencies } = /** @type {CataloguePeopleDoc} */ (this.peopleDoc);
    /** @type {CataloguePerson['contests']} */
    const contests = new Map();
    for (const [ei, pi, won, party] of row[8]) {
      const e = this.data.elections[ei];
      if (e) contests.set(e.key, { place: constituencies[pi] || '', party: party !== undefined ? parties[party] : (parties[row[2]] || ''), won: Boolean(won) });
    }
    this.person = { id: String(row[0]), name: row[1], row, contests };
  }

  /** @param {string} id */
  async showPersonElections(id) {
    await this.ensurePeople();
    const row = this.peopleById?.get(String(id));
    if (!row) return;
    this.setPerson(row);
    this.clearSearch();
    this.efilters = { ...BLANK_EFILTERS };
    this.saveStore();
    this.go(`elections/person/${row[0]}`);
  }

  /* ================================================================ routing */

  /** @returns {string} */
  routeFromLocation() {
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('flat-card-')) return this.resolveRoute(hash);
    try {
      return this.resolveRoute(new URLSearchParams(hash).get('cat') || '');
    } catch {
      return '';
    }
  }

  /** @param {string} route @returns {string} */
  resolveRoute(route) {
    if (!route) return '';
    if (route.startsWith('flat-card-')) {
      const s = this.data?.redirects?.[route.slice('flat-card-'.length)];
      return s ? `series/${s}` : 'maps';
    }
    const [view, id] = route.split('/');
    // A link to one map or set (Browse's "open on the map"): the row it is in, opened at it.
    if (view === 'map') {
      const sid = this.seriesOfMap?.get(id);
      if (sid && this.seriesById?.has(sid)) return /** @type {CatalogueRow} */ (this.seriesById.get(sid)).members.some((m) => m.id === id) ? `series/${sid}/${id}` : `series/${sid}`;
      // A map to be added opens its row with the maps to come showing; a hidden map, the row of
      // the map it belongs to (built into mapLinks).
      const link = this.data?.mapLinks?.[id];
      if (link?.route) return link.route;
      if (link && this.seriesById?.has(link.series)) {
        if (link.todo) return `series/${link.series}/${id}`;
        return link.map ? `series/${link.series}/${link.map}` : `series/${link.series}`;
      }
      const old = this.data?.redirects?.[id];
      return old && this.seriesById?.has(old) ? `series/${old}` : '';
    }
    if (view === 'series' && !this.seriesById?.has(id)) return 'maps';
    if (view === 'subject' && !this.subjectById?.has(id)) return 'maps';
    return route;
  }

  routeString() {
    if (!this.data) return initialCatalogueRoute();
    if (this.here) return `here/${this.here.lng.toFixed(5)}/${this.here.lat.toFixed(5)}`;
    if (this.tab === 'elections') {
      if (this.person) return `elections/person/${this.person.id}`;
      return 'elections';
    }
    if (this.tab === 'books') return 'books';
    if (this.focusSeries && this.expanded.has(this.focusSeries)) {
      const sel = this.selected.get(this.focusSeries);
      return `series/${this.focusSeries}${sel ? `/${sel}` : ''}`;
    }
    return this.section;
  }

  /** @param {string} route */
  applyRoute(route) {
    const [view, a, b] = String(route || 'maps').split('/');
    this.here = null;
    if (view === 'series' && this.seriesById.has(a)) {
      this.tab = 'maps';
      // Each of these is a row found above.
      this.section = sectionOfKind(/** @type {CatalogueRow} */ (this.seriesById.get(a)).kind);
      this.expanded.add(a);
      this.focusSeries = a;
      // A map still to be added is shown in its row's list of maps to come.
      if (b && /** @type {CatalogueRow} */ (this.seriesById.get(a)).todo?.some((t) => t.id === b)) this.showTodo.add(a);
      else if (b) this.selected.set(a, b);
      this.revealSeries(this.seriesById.get(a));
      this.scrollTarget = a;
    } else if (view === 'subject' && this.subjectById.has(a)) {
      this.tab = 'maps';
      const first = this.seriesById.get(/** @type {string} */ (/** @type {CatalogueSubject} */ (this.subjectById.get(a)).series?.[0]));
      if (first) this.section = sectionOfKind(first.kind);
      this.scrollTarget = `subject:${a}`;
    } else if (view === 'elections' && a === 'person' && b) {
      this.tab = 'elections';
      // The person index loads on demand: the list is drawn again once it is in.
      const row = this.peopleById?.get(b);
      if (row) this.setPerson(row);
      else this.ensurePeople().then(() => { const r = this.peopleById?.get(b); if (r) { this.setPerson(r); if (this.drawn) this.draw(); } });
    } else if (view === 'elections') {
      this.tab = 'elections';
      this.person = null;
      // elections/<body>: that body's shelf, opened (the body filter it once set is gone).
      const g = a && (BODY_GROUPS.some((x) => x.id === a) ? a : groupOfBody(a));
      if (g) { this.opened.add(`e-${g}`); this.scrollTarget = `shelf:e-${g}`; }
    } else if (view === 'books') {
      this.tab = 'books';
    } else if (KIND_OF_SECTION[view]) {
      this.tab = 'maps';
      this.section = view;
    } else if (view === 'here' && a && b && Number.isFinite(Number(a)) && Number.isFinite(Number(b))) {
      this.tab = 'maps';
      this.here = { lng: Number(a), lat: Number(b) };
      this.ensurePlaces();
    } else {
      this.tab = 'maps';
    }
  }

  /** A linked series must be visible: open its shelf, and lift filters that would hide it. */
  /** @param {CatalogueRow | undefined} s */
  revealSeries(s) {
    if (!s) return;
    this.opened.add(this.shelfIn(s));
    if (!this.query && !this.seriesShown(s)) {
      this.filters = { ...BLANK_FILTERS };
      this.saveStore();
    }
  }

  /** @param {string} route */
  go(route) {
    app()?.updateURLState?.();
    this.applyRoute(route);
    const raw = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(raw.startsWith('flat-') ? '' : raw);
    params.set('cat', this.routeString());
    history.pushState(null, '', `${location.pathname}${location.search}#${params.toString()}`);
    this.draw();
    this.scrollToTop();
  }

  replaceRoute() { app()?.updateURLState?.(); }

  /** @param {{ rewrite?: boolean }} [options] */
  onLocationChange({ rewrite = false } = {}) {
    if (!this.data || !this.root) return;
    const r = this.routeFromLocation();
    if (!r || r === this.routeString()) return;
    this.applyRoute(r);
    if (rewrite) app()?.updateURLState?.();
    this.draw();
  }

  scrollToTop() {
    const s = this.scroller || this.findScroller();
    if (s) s.scrollTop = 0;
  }

  /**
   * On a phone (the pane fills a screen at most 768px wide) the pinned search bar and section tabs
   * step aside while the list scrolls down and come back on any scroll up, near the top, or when
   * focus moves into them; styles.js does the moving. A jump to a heading keeps them in place, as
   * its scroll position allows for them.
   */
  watchChrome() {
    const s = this.scroller;
    if (!s || this.chromeWatched) return;
    this.chromeWatched = true;
    const phone = window.matchMedia?.('(max-width: 768px)');
    let last = s.scrollTop;
    /** @param {boolean} away */
    const set = (away) => { if (s.hasAttribute('data-chrome-away') !== away) s.toggleAttribute('data-chrome-away', away); };
    // A jump shows them at once (no slide), so it measures where the tabs end up, not where they were.
    /** @type {((holdMs?: number) => void) | undefined} */
    this.showChrome = (holdMs = 0) => {
      this.chromeHold = Date.now() + holdMs;
      last = s.scrollTop;
      if (!holdMs) return set(false);
      s.setAttribute('data-chrome-instant', '');
      set(false);
      requestAnimationFrame(() => requestAnimationFrame(() => s.removeAttribute('data-chrome-instant')));
    };
    s.addEventListener('scroll', () => {
      const y = s.scrollTop;
      const dy = y - last;
      if (Math.abs(dy) < 8) return;
      last = y;
      set(Boolean(phone?.matches) && dy > 0 && y > 160 && Date.now() > (this.chromeHold || 0));
    }, { passive: true });
    s.addEventListener('focusin', (e) => { if (/** @type {Element} */ (e.target).closest?.('.catalogue-sticky-shell, [data-cn-tabs]')) /** @type {(holdMs?: number) => void} */ (this.showChrome)(); });
  }

  scrollToTarget() {
    const t = this.scrollTarget;
    this.scrollTarget = null;
    if (!t || !this.root) return;
    this.showChrome?.(800);
    const el = t.startsWith('subject:') ? this.root.querySelector(`[data-cn-subject="${cssId(t.slice(8))}"]`)
      : t.startsWith('shelf:') ? this.root.querySelector(`#cn-shelf-${cssId(t.slice(6))}`)
        : this.root.querySelector(`[data-cn-series="${cssId(t)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    // The section tabs stick to the top of the pane: start the row just below them, not under them.
    const s = this.scroller || this.findScroller();
    const under = (this.tabsEl?.getBoundingClientRect().bottom || 0) + 8 - el.getBoundingClientRect().top;
    if (s && under > 0) s.scrollTop -= under;
    /** @type {HTMLElement | null} */ (el.querySelector('[data-cn-expand]'))?.focus({ preventScroll: true });
  }

  /* ================================================================ events */

  /** @param {MouseEvent} e */
  onClick(e) {
    /** @param {string} sel @returns {DataTarget | null} */
    const b = (sel) => /** @type {Element} */ (e.target).closest(sel);
    /** @type {DataTarget | null} */
    let el;
    if ((el = b('[data-cn-address]'))) { e.preventDefault(); this.goToAddress(el.dataset.cnAddress); return; }
    if ((el = b('[data-cn-tab]'))) {
      e.preventDefault();
      if (el.dataset.cnTab !== this.openSection || this.here) this.go(el.dataset.cnTab);
      return;
    }
    if ((el = b('[data-cn-toggle]'))) { e.preventDefault(); this.toggleMap(el.dataset.cnToggle, el); return; }
    if ((el = b('[data-cn-election-toggle]'))) { e.preventDefault(); this.toggleElection(el.dataset.cnElectionToggle, el); return; }
    if ((el = b('[data-cn-expand]'))) { e.preventDefault(); this.toggleExpand(el.dataset.cnExpand); return; }
    if ((el = b('[data-cn-select]'))) { e.preventDefault(); const [sid, mid] = el.dataset.cnSelect.split('|'); this.select(sid, mid); return; }
    if ((el = b('[data-cn-menu]'))) { e.preventDefault(); this.openSeriesMenu(el, el.dataset.cnMenu); return; }
    if ((el = b('[data-cn-more]'))) { e.preventDefault(); this.moreChips.add(el.dataset.cnMore); this.rerenderRow(el.dataset.cnMore, { focus: 'chips' }); return; }
    if ((el = b('[data-cn-fewer]'))) { e.preventDefault(); this.moreChips.delete(el.dataset.cnFewer); this.rerenderRow(el.dataset.cnFewer, { focus: 'chips' }); return; }
    if ((el = b('[data-cn-more-parts]'))) { e.preventDefault(); this.moreParts.add(el.dataset.cnMoreParts); this.rerenderPanel(/** @type {string} */ (this.seriesOfMap.get(el.dataset.cnMoreParts.replace(/:counties$/, '')))); return; }
    if ((el = b('[data-cn-visibility]'))) { e.preventDefault(); this.toggleVisible(el.dataset.cnVisibility); return; }
    if ((el = b('[data-cn-filter]'))) { e.preventDefault(); this.setFilter(el.dataset.cnFilter, el.dataset.value || ''); return; }
    if ((el = b('[data-cn-shelf]'))) { e.preventDefault(); this.toggleShelf(el); return; }
    if ((el = b('[data-cn-person]'))) { e.preventDefault(); this.showPersonElections(el.dataset.cnPerson); return; }
    // A person or party found by search opens its page here in the pane (UX review 2026-10-31, M6),
    // with the full record a link away in Browse; the name used to leave the map for Browse.
    if ((el = b('[data-cn-open-page]'))) {
      e.preventDefault();
      const [kind, ...rest] = el.dataset.cnOpenPage.split(':');
      this.ui.onOpenElectionEntityDetail?.(kind, rest.join(':'), /** @type {string} */ (el.textContent).trim());
      return;
    }
    if ((el = b('[data-cn-local]'))) {
      e.preventDefault();
      const id = el.dataset.cnLocal;
      if (this.showLocal.has(id)) this.showLocal.delete(id); else this.showLocal.add(id);
      this.rerenderRow(id);
      /** @type {HtmlScope} */ (this.root).querySelector(`[data-cn-series="${cssId(id)}"] [data-cn-local]`)?.focus({ preventScroll: true });
      return;
    }
    if ((el = b('[data-cn-todo]'))) {
      e.preventDefault();
      const id = el.dataset.cnTodo;
      if (this.showTodo.has(id)) this.showTodo.delete(id); else this.showTodo.add(id);
      this.rerenderRow(id);
      /** @type {HtmlScope} */ (this.root).querySelector(`[data-cn-series="${cssId(id)}"] [data-cn-todo]`)?.focus({ preventScroll: true });
      return;
    }
    if ((el = b('[data-cn-goto]'))) {
      e.preventDefault();
      const sid = el.dataset.cnGoto;
      if (!sid) return;
      this.here = null;
      this.tab = 'maps';
      this.section = sectionOfKind(this.seriesById.get(sid)?.kind);
      this.expanded.add(sid);
      this.focusSeries = sid;
      if (el.dataset.map) this.selected.set(sid, el.dataset.map);
      this.revealSeries(this.seriesById.get(sid));
      this.scrollTarget = sid;
      this.draw();
      this.replaceRoute();
      return;
    }
    if ((el = b('[data-cn-act]'))) { e.preventDefault(); this.act(el.dataset.cnAct, el); }
  }

  /** @param {KeyboardEvent} e */
  onKeyDown(e) {
    // Arrow keys move along a row's chips; Tab moves on to the next control.
    const chip = /** @type {HTMLButtonElement | null} */ (/** @type {Element} */ (e.target).closest?.('.cn-chips .cn-chip'));
    if (chip && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      const list = [.../** @type {NodeListOf<HTMLButtonElement>} */ (/** @type {Element} */ (chip.closest('.cn-chips')).querySelectorAll('button.cn-chip'))].filter((x) => !x.hidden);
      const i = list.indexOf(chip);
      const next = e.key === 'Home' ? list[0] : e.key === 'End' ? list[list.length - 1] : list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
      if (next) {
        list.forEach((x) => { x.tabIndex = -1; });
        next.tabIndex = 0;
        next.focus();
        e.preventDefault();
      }
    }
  }

  /** @param {Event} e */
  onInput(e) {
    const r = /** @type {HTMLInputElement | null} */ (/** @type {Element} */ (e.target).closest?.('[data-cn-range]'));
    if (!r) return;
    const key = /** @type {FilterKey} */ (r.dataset.key);
    const bins = key === 'maps' ? this.mapBins : this.electionBins;
    const wrap = /** @type {Element} */ (r.closest('[data-cn-slider]'));
    const [a, b] = /** @type {NodeListOf<HTMLInputElement>} */ (wrap.querySelectorAll('input[type="range"]'));
    let from = Number(a.value);
    let to = Number(b.value);
    if (from > to) {
      if (r === a) { to = from; b.value = String(to); } else { from = to; a.value = String(from); }
    }
    const f = key === 'maps' ? this.filters : this.efilters;
    // A handle stands for its decade's first year (1830, 1840 ...); at either end, no limit.
    f.from = stepYear(bins, from, 'from');
    f.to = stepYear(bins, to, 'to');
    this.saveStore();
    updateSlider(wrap, bins, from, to, this.yearState(key));
    cancelAnimationFrame(/** @type {number} */ (this.rangeRaf));
    this.rangeRaf = requestAnimationFrame(() => this.refreshResults());
  }

  /** A year typed into a box: applied when the box is left or Enter is pressed, not per key. */
  /** @param {Event} e */
  onYearTyped(e) {
    if (/** @type {Element} */ (e.target).matches?.('[data-cn-undated]')) {
      this.filters.undated = /** @type {HTMLInputElement} */ (e.target).checked;
      this.saveStore();
      this.refreshResults();
      return;
    }
    const box = /** @type {HTMLInputElement | null} */ (/** @type {Element} */ (e.target).closest?.('[data-cn-year]'));
    if (!box) return;
    const key = /** @type {FilterKey} */ (box.dataset.key);
    const f = key === 'maps' ? this.filters : this.efilters;
    const v = box.value.trim() === '' ? null : Math.round(Number(box.value));
    /** @type {Record<string, unknown>} */ (f)[/** @type {string} */ (box.dataset.cnYear)] = Number.isFinite(v) ? v : null;
    if (f.from !== null && f.to !== null && f.from > f.to) [f.from, f.to] = [f.to, f.from];
    this.saveStore();
    const r = this.yearRange(key);
    updateSlider(box.closest('[data-cn-slider]'), key === 'maps' ? this.mapBins : this.electionBins, r.i, r.j, this.yearState(key));
    this.refreshResults();
  }

  /** @param {ParentNode} scope */
  rovingChips(scope) {
    scope.querySelectorAll?.('.cn-chips').forEach((group) => {
      [.../** @type {NodeListOf<HTMLButtonElement>} */ (group.querySelectorAll('button.cn-chip'))].forEach((x, i) => { x.tabIndex = i === 0 ? 0 : -1; });
    });
  }

  /** @param {string} kind @param {DataTarget} el */
  act(kind, el) {
    // The actions on a map carry it (data-map); the rest do not read it.
    const id = /** @type {string} */ (el.dataset.map);
    switch (kind) {
      case 'tables':
        if (this.ui.showTab) this.ui.showTab('tables');
        else /** @type {HTMLElement | null} */ (document.querySelector('[data-tab-target="tables"]'))?.click();
        break;
      case 'filters': {
        this.filtersOpen = !this.filtersOpen;
        el.closest('[data-cn-toolbar]')?.toggleAttribute('data-open', this.filtersOpen);
        el.setAttribute('aria-expanded', String(this.filtersOpen));
        break;
      }
      case 'years-reset': {
        const f = el.dataset.key === 'maps' ? this.filters : this.efilters;
        f.from = null;
        f.to = null;
        this.saveStore();
        this.refreshResults();
        break;
      }
      case 'clear-filters': this.clearFilters(); break;
      case 'clear-person': this.person = null; this.draw(); this.replaceRoute(); break;
      case 'zoom': this.zoom(id); break;
      case 'details': this.details(id); break;
      case 'edit': this.suggestEdit(id); break;
      case 'downloads': openMenu(el, this.downloadsFor(id), { label: 'Download' }); break;
      case 'copy-link': this.copyLink(id, el); break;
      case 'cite': this.cite(id, this.seriesById.get(el.dataset.series), el); break;
      case 'compare': this.openCompareMenu(el, this.seriesById.get(el.dataset.series), id); break;
      case 'add-parts': this.addParts(id); break;
      case 'more-text': {
        const p = el.previousElementSibling;
        if (p) { p.toggleAttribute('data-open'); el.textContent = p.hasAttribute('data-open') ? 'Show less' : 'Read more'; }
        break;
      }
      case 'show-all': {
        this.limits[el.dataset.what] = true;
        if (el.dataset.what === 'here') { this.refreshResults(); break; }
        this.refreshExtras();
        break;
      }
      case 'toggle-all': {
        // Show every place, or go back to the first five; the button keeps its place and focus.
        this.limits[el.dataset.what] = !this.limits[el.dataset.what];
        this.refreshExtras();
        /** @type {HtmlScope | null | undefined} */ (this.resultsEl)?.querySelector(`[data-cn-act="toggle-all"][data-what="${el.dataset.what}"]`)?.focus({ preventScroll: true });
        break;
      }
      case 'pick-here': this.startPick(); break;
      case 'cancel-pick': this.stopPick(); break;
      case 'close-here': this.here = null; this.draw(); this.replaceRoute(); break;
      case 'flip': this.setFade(this.compare && this.compare.value >= 50 ? 0 : 100, true); break;
      case 'end-compare': this.endCompare(); break;
      default:
    }
  }

  /* ================================================================ rows */

  /** @param {string} id */
  toggleExpand(id) {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
      if (this.focusSeries === id) this.focusSeries = [...this.expanded].pop() || null;
    } else {
      this.expanded.add(id);
      this.focusSeries = id;
    }
    this.rerenderRow(id, { focus: 'title' });
    this.replaceRoute();
  }

  /** @param {string} sid @param {string} mid */
  select(sid, mid) {
    this.selected.set(sid, mid);
    this.focusSeries = sid;
    this.rerenderPanel(sid, `[data-cn-select="${cssId(`${sid}|${mid}`)}"]`);
    this.replaceRoute();
  }

  /** @param {CatalogueRow} s @returns {{ members?: string[] } | null | undefined} */
  rowHit(s) {
    if (!this.here) return this.hitFor(s);
    const hit = coveringPoint({ series: [s], maps: this.data.maps }, null, this.here.lng, this.here.lat);
    return { members: hit.series[0]?.members || [] };
  }

  /** @param {string} id @param {{ focus?: 'title' | 'chips' }} [options] */
  rerenderRow(id, { focus } = {}) {
    const li = this.root?.querySelector(`[data-cn-series="${cssId(id)}"]`);
    const s = this.seriesById.get(id);
    if (!li || !s) return;
    const tmp = document.createElement('ul');
    tmp.innerHTML = MapsView.seriesRowHtml(this, s, this.rowHit(s));
    // The row's markup is one list item.
    const fresh = /** @type {HTMLElement} */ (tmp.firstElementChild);
    li.replaceWith(fresh);
    this.afterDraw(fresh);
    if (focus === 'title') /** @type {HTMLElement | null} */ (fresh.querySelector('[data-cn-expand]'))?.focus({ preventScroll: true });
    if (focus === 'chips') /** @type {HTMLElement | null} */ (fresh.querySelector('.cn-chips .cn-chip'))?.focus({ preventScroll: true });
  }

  /** @param {string} sid @param {string} [focusSel] */
  rerenderPanel(sid, focusSel) {
    const panel = this.root?.querySelector(`[data-cn-panel="${cssId(sid)}"]`);
    const s = this.seriesById.get(sid);
    if (!panel || !s) { this.rerenderRow(sid); return; }
    panel.innerHTML = MapsView.panelHtml(this, s);
    this.afterDraw(panel);
    if (focusSel) /** @type {HTMLElement | null} */ (panel.querySelector(focusSel))?.focus({ preventScroll: true });
  }

  /** @param {HTMLElement} btn */
  toggleShelf(btn) {
    const id = /** @type {string} */ (btn.dataset.cnShelf);
    const open = btn.getAttribute('aria-expanded') !== 'true';
    if (open) this.opened.add(id); else this.opened.delete(id);
    btn.setAttribute('aria-expanded', String(open));
    const body = /** @type {HTMLElement | null | undefined} */ (btn.closest('.cn-shelf')?.querySelector('.cn-shelf__body'));
    if (body) setHidden(body, !open);
    if (open && body) this.fitChips(body);
    this.saveStore();
  }

  /* ================================================================ contents */

  /**
   * The contents button, left of the search box, styled as its neighbours (History, Home). It opens
   * a panel from the right listing the sections of the open tab -- shelves and their subjects,
   * decades, or book categories -- and dims the rest of the pane.
   */
  ensureContentsButton() {
    const shell = document.querySelector('.catalogue-sticky-shell');
    if (!shell || document.getElementById('catalogueContents')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'catalogueContents';
    btn.className = 'btn btn--icon btn--sm cn-contents-btn';
    btn.title = 'Contents';
    btn.setAttribute('aria-label', 'Contents: jump to a section');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/></svg>';
    btn.addEventListener('click', () => (this.contentsEl ? this.closeContents() : this.openContents()));
    // In a .catalogue-nav of its own, so the site's styles for History and Home apply to it too.
    const wrap = document.createElement('div');
    wrap.className = 'catalogue-nav cn-contents-nav';
    wrap.appendChild(btn);
    shell.insertBefore(wrap, shell.querySelector('.search-input'));
    shell.classList.add('cn-shell--contents');
    this.contentsBtn = btn;
  }

  /** Each section of the open tab: { id (an element's id), label, count, level, icon, colour }. */
  /** @returns {ContentsSection[]} */
  sections() {
    if (this.tab === 'elections') {
      return shelvesOf(this.visibleElections()).map(({ g, es }) => ({ id: `cn-shelf-e-${g.id}`, label: g.label, count: es.length, level: 1, icon: g.icon, colour: g.colour }));
    }
    if (this.tab === 'books') {
      const all = this.books?.books || [];
      const shown = this.query ? all.filter((b) => this.bookHits?.has(b.id)) : all;
      return (this.books?.categories || []).map((cat) => ({ cat, n: shown.filter((b) => b.category === cat.id).length })).filter((x) => x.n)
        .map(({ cat, n }) => ({ id: `cn-books-${cat.id}`, label: cat.name, count: n, level: 1, icon: BOOK_CATEGORY_ICONS[cat.id] || 'book-open' }));
    }
    if (this.here) return [];
    /** @type {ContentsSection[]} */
    const out = [];
    for (const { sh, subjects, count } of this.visibleShelves()) {
      const [look, col] = SHELF_LOOK[sh.id] || ['map', MAP_COLOURS.catalogueFallback];
      const ic = SHELF_ICON_IN[this.section]?.[sh.id] || look;
      out.push({ id: `cn-shelf-${sh.id}`, label: MapsView.shelfName(this.section, sh), count, level: 1, icon: ic, colour: col });
      if (!sh.flat && subjects.length > 1 && !FLAT_SECTIONS.has(this.section)) for (const { sub, series } of subjects) out.push({ id: `cn-subject-${sub.id}`, label: sub.name, count: series.length, level: 2 });
    }
    return out;
  }

  /** The section now at the top of the pane. */
  /** @param {ContentsSection[]} list */
  currentSection(list) {
    const s = this.scroller || this.findScroller();
    const top = (s ? s.getBoundingClientRect().top : 0) + (this.tabsEl?.getBoundingClientRect().bottom || 0) - (s ? s.getBoundingClientRect().top : 0) + 16;
    let current = null;
    for (const item of list) {
      const el = document.getElementById(item.id);
      if (!el || el.closest('[hidden]')) continue;
      if (el.getBoundingClientRect().top <= top) current = item.id;
    }
    return current || list[0]?.id;
  }

  openContents() {
    // The search row travels with the Tables tab; contents always mean the catalogue's.
    const catalogue = document.querySelector('.pane__content[data-tab-content="catalogue"]');
    if (catalogue?.classList.contains('pane-tab-content--hidden')) this.ui.showTab?.('catalogue');
    const pane = this.root?.closest('.pane') || document.querySelector('.pane--info');
    if (!pane) return;
    const list = this.sections();
    const current = this.currentSection(list);
    const tabName = this.tab === 'maps' ? (SECTIONS.find(([id]) => id === this.section)?.[2] || 'Maps') : ({ elections: 'Elections', books: 'Books' }[this.tab] || 'Maps');
    const el = document.createElement('div');
    el.className = 'cn-drawer';
    el.innerHTML = `<div class="cn-drawer__scrim" data-cn-drawer-close></div>
      <div class="cn-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="cn-drawer-title">
        <div class="cn-drawer__head">
          <h2 class="cn-drawer__title" id="cn-drawer-title">${tabName}: contents</h2>
          <button type="button" class="cn-iconbtn" data-cn-drawer-close aria-label="Close contents">${icon('x')}</button>
        </div>
        ${list.length ? `<ul class="cn-toc">${list.map((it) => `<li class="cn-toc__item cn-toc__item--l${it.level}"><button type="button" class="cn-toc__link" data-cn-goto-section="${esc(it.id)}"${it.id === current ? ' aria-current="true"' : ''}${it.colour ? ` style="--shelf:${it.colour}"` : ''}>${it.icon ? `<span class="cn-toc__icon">${icon(it.icon)}</span>` : ''}<span class="cn-toc__label">${esc(it.label)}</span><span class="cn-count">${siteNumber(it.count)}</span></button></li>`).join('')}</ul>`
          : `<p class="cn-empty">${this.here ? 'Close “What’s here” to see the shelves.' : 'Nothing to list with these filters.'}</p>`}
      </div>`;
    document.body.appendChild(el);
    this.contentsEl = el;
    this.placeContents(pane);
    this.contentsBtn?.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', (e) => {
      // A click in the drawer lands on an element of it.
      const go = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-cn-goto-section]'));
      if (go) { this.closeContents({ focus: false }); this.goToSection(/** @type {string} */ (go.dataset.cnGotoSection)); return; }
      if (/** @type {Element} */ (e.target).closest('[data-cn-drawer-close]')) this.closeContents();
    });
    // Escape closes the panel wherever focus is: it moves into the panel a frame after opening,
    // and a key pressed before then would otherwise be lost.
    /** @type {((e: KeyboardEvent) => void) | undefined} */
    this.onContentsKey = (e) => { if (e.key === 'Escape' && this.contentsEl) { e.preventDefault(); this.closeContents(); } };
    document.addEventListener('keydown', this.onContentsKey, true);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = [...el.querySelectorAll('button')];
      // Focus elsewhere (or on nothing) is not in the list: -1.
      const i = focusables.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
      if (e.shiftKey && i <= 0) { focusables[focusables.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && i === focusables.length - 1) { focusables[0].focus(); e.preventDefault(); }
    });
    /** @type {(() => void) | undefined} */
    this.onContentsResize = () => this.placeContents(pane);
    window.addEventListener('resize', this.onContentsResize);
    requestAnimationFrame(() => {
      el.classList.add('cn-drawer--open');
      const target = /** @type {HTMLElement | null} */ (el.querySelector('[aria-current="true"]') || el.querySelector('.cn-toc__link') || el.querySelector('[data-cn-drawer-close]'));
      // Scroll only the list to the current section: scrollIntoView would also scroll the drawer
      // itself sideways to reach the panel while it is still sliding in, and the two movements
      // made the panel shake as it opened (Alessio Coci).
      const toc = el.querySelector('.cn-toc');
      if (target && toc?.contains(target)) {
        const top = target.getBoundingClientRect().top - toc.getBoundingClientRect().top;
        if (top < 0 || top + target.offsetHeight > toc.clientHeight) toc.scrollTop += top - (toc.clientHeight - target.offsetHeight) / 2;
      }
      target?.focus({ preventScroll: true });
    });
  }

  /** The panel covers the catalogue pane exactly, whatever the split between pane and map. */
  /** @param {Element} pane */
  placeContents(pane) {
    if (!this.contentsEl) return;
    const r = pane.getBoundingClientRect();
    Object.assign(this.contentsEl.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  /** @param {{ focus?: boolean }} [options] */
  closeContents({ focus = true } = {}) {
    const el = this.contentsEl;
    if (!el) return;
    this.contentsEl = null;
    // Both were set when the drawer opened.
    window.removeEventListener('resize', /** @type {() => void} */ (this.onContentsResize));
    document.removeEventListener('keydown', /** @type {(e: KeyboardEvent) => void} */ (this.onContentsKey), true);
    this.contentsBtn?.setAttribute('aria-expanded', 'false');
    el.classList.remove('cn-drawer--open');
    const done = () => el.remove();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 200);
    if (focus) this.contentsBtn?.focus();
  }

  /** @param {string} id */
  goToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    // A subject in a closed shelf: open the shelf first.
    const shelf = el.closest('.cn-shelf');
    const toggle = /** @type {HTMLElement | null | undefined} */ (shelf?.querySelector('[data-cn-shelf][aria-expanded="false"]'));
    if (toggle) this.toggleShelf(toggle);
    el.scrollIntoView({ block: 'start' });
    const focusTarget = /** @type {HTMLElement | null} */ (el.querySelector('[data-cn-shelf], .cn-subject__head, .category-section__title'));
    if (focusTarget) {
      if (!focusTarget.matches('button')) focusTarget.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
    }
  }

  /* ================================================================ actions on the map */

  /** @param {string} id */
  isLoaded(id) { try { return Boolean(this.ui?.onCheckMapLoaded?.(id)); } catch { return false; } }
  /** @param {string} id */
  isVisible(id) { try { return this.ui?.onCheckMapVisible ? Boolean(this.ui.onCheckMapVisible(id)) : true; } catch { return true; } }
  /** @param {CatalogueRowElection} e */
  electionLoaded(e) { try { return Boolean(this.ui?.onCheckElectionLoaded?.(e.body, e.date)); } catch { return false; } }

  /** @param {string} text */
  announce(text) {
    const el = document.getElementById('announcer') || document.querySelector('[aria-live="polite"]');
    if (el) { el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); }
  }

  /** @param {string} id @param {HTMLElement} [btn] */
  async toggleMap(id, btn) {
    if (!id) return;
    // A click while the map is still loading is remembered and acted on when the load is done,
    // so a quick second click takes the map back off rather than being lost.
    if (this.busy.has(id)) {
      if (this.pendingToggle.has(id)) this.pendingToggle.delete(id); else this.pendingToggle.add(id);
      return;
    }
    this.busy.add(id);
    btn?.setAttribute('aria-busy', 'true');
    try {
      if (this.isLoaded(id)) {
        await this.ui.onMapUnload?.(id);
      } else {
        await this.ui.onMapLoad?.(id);
        const sid = btn?.dataset.series || this.seriesOfMap.get(id);
        if (sid) this.lastOn.set(sid, id);
      }
    } catch {
      // The app has said what went wrong, with a Retry, and taken the layer back off; the
      // syncState below puts the button back to Add rather than leaving it on "On map".
      this.pendingToggle.delete(id);
    } finally {
      this.busy.delete(id);
      btn?.removeAttribute('aria-busy');
      this.syncState();
    }
    if (this.pendingToggle.delete(id)) await this.toggleMap(id, btn);
  }

  /** @param {string} id */
  async addParts(id) {
    for (const p of this.rec(id).parts || []) if (!this.isLoaded(p.id)) await this.ui.onMapLoad?.(p.id);
    this.syncState();
  }

  /** @param {string} id */
  toggleVisible(id) { this.ui.onMapToggle?.(id); setTimeout(() => this.syncState(), 60); }

  /** @param {string} key @param {HTMLElement} [btn] */
  async toggleElection(key, btn) {
    const e = this.electionByKey.get(key);
    if (!e || this.busy.has(key)) return;
    this.busy.add(key);
    btn?.setAttribute('aria-busy', 'true');
    try {
      if (this.electionLoaded(e)) await this.ui.onUnloadElection?.();
      else await this.ui.onLoadElection?.(e.body, e.date);
    } catch {
      // Reported by the app, with a Retry; the button goes back to Open below.
    } finally {
      this.busy.delete(key);
      btn?.removeAttribute('aria-busy');
      this.syncState();
    }
  }

  /** @param {string} id */
  zoom(id) { const b = this.rec(id).bounds; if (b) app()?.mapController?.fitToBounds?.(b, { smooth: true }); }
  /** @param {string} id */
  details(id) { this.ui.showCatalogueDetailView?.(id, true); }

  /** @param {string} id @returns {MenuItem[]} */
  downloadsFor(id) {
    const full = this.full(id);
    /** @type {MenuItem[]} */
    const out = [];
    if (!full) return out;
    if (resolveMapDownloadUrl(full)) out.push({ label: 'FlatGeobuf (.fgb)', icon: 'download', onSelect: () => this.ui.onDownloadFgb?.(id) });
    if (/** @type {{ geojson?: string } | undefined} */ (full.files)?.geojson) out.push({ label: 'Original GeoJSON', icon: 'download', href: /** @type {{ geojson: string }} */ (full.files).geojson, download: true });
    for (const d of this.ui.getSourceDownloads?.(full) || []) if (d?.file) out.push({ label: d.label || 'Source file', icon: 'download', href: d.file, download: true });
    // The statistics CSVs are on the data bucket (data/census/ is not in the Pages build).
    if (full.isDataEntry && full.csv) out.push({ label: 'Statistics (CSV)', icon: 'download', href: cdnUrl(/** @type {string} */ (full.csv)), download: true });
    // The map drawn as a Wikipedia-style locator map of the current view (packages/map/app/map-image-export.js):
    // any map with a vector data file of its own or in its members.
    const vector = resolveMapDownloadUrl(full) || compositeChildIds(full).some((cid) => resolveMapDownloadUrl(this.full(cid)));
    if (vector && this.ui.onExportMapImage) {
      out.push({ label: 'Map image of this view (SVG)', icon: 'download', onSelect: () => /** @type {(mapId: string, format: string) => unknown} */ (this.ui.onExportMapImage)(id, 'svg') });
      out.push({ label: 'Map image of this view (PNG)', icon: 'download', onSelect: () => /** @type {(mapId: string, format: string) => unknown} */ (this.ui.onExportMapImage)(id, 'png') });
    }
    return out;
  }

  /** @param {string} text @param {string} what */
  async copyText(text, what) {
    try { await navigator.clipboard.writeText(text); this.announce(`${what} copied`); return true; } catch { window.prompt(`Copy the ${what.toLowerCase()}:`, text); return false; }
  }

  /** A map's link opens its row at that map, whatever the pane showed when it was copied (a link
   * copied with the row closed said only cat=boundaries; Phelim Birch's review, 2026-10-11). */
  /** @param {string} id */
  shareUrl(id) {
    const url = app()?.buildLayerShareUrl?.(id) || `${location.origin}/maps/#layers=${encodeURIComponent(id)}`;
    const route = this.resolveRoute(`map/${id}`);
    if (!route) return url;
    try {
      const u = new URL(url);
      const params = new URLSearchParams(u.hash.slice(1));
      params.set('cat', route);
      u.hash = params.toString();
      return u.toString();
    } catch {
      return url;
    }
  }

  /** @param {string} id @param {HTMLElement} [btn] */
  async copyLink(id, btn) {
    await this.copyText(this.shareUrl(id), 'Link');
    this.flash(btn, 'Link copied');
  }

  /** @param {string} id @param {CatalogueRow | undefined} s @param {HTMLElement} [btn] */
  async cite(id, s, btn) {
    const r = this.rec(id);
    const local = s?.local?.find((x) => x.id === id);
    const m = s?.members.find((x) => x.id === id) || local;
    const year = yearOf(r.date);
    const who = r.provider?.join(', ') || 'Civgraph';
    const title = s && (s.members.length > 1 || local) ? `${s.name}, ${m?.label || ''}` : (s?.name || r.name || id);
    const accessed = formatDisplayDate(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));
    await this.copyText(`${who}. ${title}${year && !String(m?.label || '').includes(String(year)) ? ` (${year})` : ''} [map layer]. Civgraph, ${this.shareUrl(id)} (accessed ${accessed}).`, 'Citation');
    this.flash(btn, 'Citation copied');
  }

  /** @param {HTMLElement | undefined} btn @param {string} text */
  flash(btn, text) {
    const label = btn?.querySelector('span');
    if (!label) return;
    const before = label.textContent;
    label.textContent = text;
    setTimeout(() => { if (label.isConnected) label.textContent = before; }, 1600);
  }

  /** The edition a row's menu acts on: the one last put on the map, else the chosen one, else the newest. */
  /** @param {CatalogueRow} s */
  menuTarget(s) {
    const last = this.lastOn.get(s.id);
    if (last && this.isLoaded(last)) return s.members.find((m) => m.id === last) || s.members[0];
    return s.members.find((m) => this.isLoaded(m.id)) || this.selectedMember(s);
  }

  /** @param {HTMLElement} anchor @param {string} sid */
  openSeriesMenu(anchor, sid) {
    const s = this.seriesById.get(sid);
    if (!s) return;
    const t = this.menuTarget(s);
    const r = this.rec(t.id);
    const loaded = this.isLoaded(t.id);
    /** @type {MenuItem[]} */
    const items = [];
    if (s.members.length > 1) items.push({ heading: t.label });
    if (r.status !== 'placeholder') items.push({ label: loaded ? 'Remove from map' : 'Add to map', icon: loaded ? 'x' : 'plus', onSelect: () => this.toggleMap(t.id) });
    if (loaded) items.push({ label: this.isVisible(t.id) ? 'Hide' : 'Show', icon: this.isVisible(t.id) ? 'eye-off' : 'eye', onSelect: () => this.toggleVisible(t.id) });
    if (r.bounds) items.push({ label: 'Zoom to', icon: 'maximize', onSelect: () => this.zoom(t.id) });
    if (this.full(t.id)) items.push({ label: 'Details', icon: 'info', onSelect: () => this.details(t.id) });
    items.push({ label: this.expanded.has(sid) ? 'Close' : (s.members.length > 1 ? 'Open: timeline and all actions' : 'Open: facts and all actions'), icon: 'chevron-down', onSelect: () => this.toggleExpand(sid) });
    const dls = this.downloadsFor(t.id);
    if (dls.length) items.push({ separator: true }, { heading: 'Download' }, ...dls);
    items.push({ separator: true }, { label: 'Copy link', icon: 'link', onSelect: () => this.copyLink(t.id) }, { label: 'Cite', icon: 'quote', onSelect: () => this.cite(t.id, s) });
    // Signed out, offered only to contributors (?contribute, remembered), as on Browse.
    if (this.full(t.id) && suggestEditOffered(this.auth)) items.push({ label: this.auth?.allowed ? 'Suggest an edit' : 'Suggest an edit (contributor sign-in)', icon: 'pencil', onSelect: () => this.suggestEdit(t.id) });
    const others = s.members.filter((m) => m.id !== t.id && this.rec(m.id).status !== 'placeholder');
    if (others.length) {
      items.push({ separator: true }, { heading: `Compare ${t.label} with` }, ...others.slice(0, 8).map((m) => ({ label: m.label, icon: 'columns', onSelect: () => this.startCompare(t.id, m.id) })));
      if (others.length > 8) items.push({ label: `${others.length - 8} more: open the row`, icon: 'chevron-down', onSelect: () => { if (!this.expanded.has(sid)) this.toggleExpand(sid); } });
    }
    openMenu(anchor, items, { label: `${s.name}: more` });
  }

  /** @param {HTMLElement} anchor @param {CatalogueRow | undefined} s @param {string} id */
  openCompareMenu(anchor, s, id) {
    if (!s) return;
    const others = s.members.filter((m) => m.id !== id && this.rec(m.id).status !== 'placeholder');
    openMenu(anchor, [{ heading: 'Compare with' }, ...others.map((m) => ({ label: m.label, icon: 'columns', onSelect: () => this.startCompare(id, m.id) }))], { label: 'Compare with' });
  }

  /* ================================================================ compare */

  /** @param {string} id */
  labelOf(id) {
    // A map in no row finds no row.
    const s = this.seriesById.get(/** @type {string} */ (this.seriesOfMap.get(id)));
    const m = s?.members.find((x) => x.id === id);
    const local = s?.local?.find((x) => x.id === id);
    // A member or council map found is the row's.
    if (local) return `${/** @type {CatalogueRow} */ (s).name}: ${local.label}`;
    return m ? (/** @type {CatalogueRow} */ (s).members.length > 1 ? m.label : /** @type {CatalogueRow} */ (s).name) : (this.rec(id).name || id);
  }

  /** @param {string} a @param {string} b */
  async startCompare(a, b) {
    // The second map is loaded last, so it draws on top; the slider fades it in over the first.
    if (!this.isLoaded(a)) await this.ui.onMapLoad?.(a);
    if (this.isLoaded(b)) await this.ui.onMapUnload?.(b);
    await this.ui.onMapLoad?.(b);
    this.compare = { a, b, aLabel: this.labelOf(a), bLabel: this.labelOf(b), value: 50 };
    this.setFade(50);
    this.drawCompare();
    this.syncState();
    /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (this.compareEl).querySelector('[data-cn-fade]'))?.focus({ preventScroll: true });
  }

  drawCompare() {
    if (!this.compareEl) return;
    if (!this.compare) { this.compareEl.innerHTML = ''; return; }
    const { aLabel, bLabel, value } = this.compare;
    this.compareEl.innerHTML = `<div class="cn-compare" role="group" aria-label="Compare two maps">
      <strong>Compare</strong>
      <div><input type="range" min="0" max="100" step="1" value="${value}" data-cn-fade aria-label="Fade from ${esc(aLabel)} to ${esc(bLabel)}">
        <div class="cn-compare__labels"><span>${esc(aLabel)}</span><span>${esc(bLabel)}</span></div></div>
      <button type="button" class="cn-btn" data-cn-act="flip">${icon('arrow-left-right')}<span>Flip</span></button>
      <button type="button" class="cn-btn" data-cn-act="end-compare">${icon('x')}<span>End</span></button>
    </div>`;
    // The slider is in the markup set just above.
    /** @type {HTMLInputElement} */ (this.compareEl.querySelector('[data-cn-fade]')).addEventListener('input', (ev) => this.setFade(Number(/** @type {HTMLInputElement} */ (ev.target).value)));
  }

  /** @param {number} value @param {boolean} [moveSlider] */
  setFade(value, moveSlider = false) {
    if (!this.compare) return;
    this.compare.value = value;
    const mc = app()?.mapController;
    mc?.setOpacity?.(this.compare.b, value / 100);
    mc?.setOpacity?.(this.compare.a, value >= 100 ? 0.15 : 1);
    if (moveSlider) { const r = /** @type {HTMLInputElement | null} */ (/** @type {HTMLElement} */ (this.compareEl).querySelector('[data-cn-fade]')); if (r) r.value = String(value); }
  }

  endCompare() {
    const mc = app()?.mapController;
    if (this.compare) { mc?.setOpacity?.(this.compare.a, 1); mc?.setOpacity?.(this.compare.b, 1); }
    this.compare = null;
    this.drawCompare();
  }

  /* ================================================================ what's here */

  ensurePlaces() {
    if (this.placesReady || this.placesPromise) return this.placesPromise;
    /** @type {Promise<void> | undefined} */
    this.placesPromise = fetch(PLACES_URL).then((r) => r.json()).then((/** @type {import('./search.js').PlacesDoc} */ doc) => {
      this.search.setPlaces(doc);
      this.placesReady = true;
      if (this.here && this.drawn) this.refreshResults();
    }).catch(() => { this.placesReady = true; });
    return this.placesPromise;
  }

  hereResult() {
    // Asked for only while a point is chosen.
    const { lng, lat } = /** @type {LngLat} */ (this.here);
    const hit = coveringPoint(this.data, this.placesReady ? this.search.places : null, lng, lat);
    // The rows found and shown (filter drops a row not found).
    const series = /** @type {Array<{ s: CatalogueRow, members: string[] }>} */ (hit.series.map((h) => ({ s: this.seriesById.get(h.id), members: h.members })).filter((x) => x.s && this.seriesShown(x.s)));
    // Named features whose box holds the point, smallest first: the most local place leads, and
    // whole regions and seas sink. Grid squares and codes ("H 86 62") are not places.
    /** @param {string} name */
    const codeLike = (name) => (name.match(/\d/g) || []).length > name.length * 0.3;
    /** @param {number[]} b */
    const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    const seen = new Set();
    /** @type {Array<{ name: string, map: string, seriesId: string | undefined, mapName: string | undefined }>} */
    const places = [];
    for (const n of hit.named.filter((x) => !codeLike(x.name)).sort((a, b) => area(a.bbox) - area(b.bbox))) {
      const k = normalise(n.name);
      if (seen.has(k)) continue;
      seen.add(k);
      places.push({ name: n.name, map: n.map, seriesId: this.seriesOfMap.get(n.map), mapName: this.rec(n.map).name });
    }
    return { series, places };
  }

  startPick() {
    const map = app()?.mapController?.map;
    if (!map) { this.announce('The map is not ready yet'); return; }
    this.ensurePlaces();
    this.picking = true;
    setHidden(this.pickEl, false);
    this.pickEl.innerHTML = `${icon('crosshair')}<span>Click a point on the map to list the maps that cover it</span><button type="button" class="cn-btn" data-cn-act="cancel-pick">Cancel</button>`;
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = 'crosshair';
    /** @type {((ev: { lngLat: { lng: number, lat: number } }) => void) | null | undefined} */
    this.pickHandler = (ev) => {
      const { lng, lat } = ev.lngLat;
      this.stopPick();
      this.go(`here/${lng.toFixed(5)}/${lat.toFixed(5)}`);
    };
    map.once('click', this.pickHandler);
  }

  stopPick() {
    const map = app()?.mapController?.map;
    if (map && this.pickHandler) map.off('click', this.pickHandler);
    const canvas = map?.getCanvas?.();
    if (canvas) canvas.style.cursor = '';
    this.pickHandler = null;
    this.picking = false;
    setHidden(this.pickEl, true);
    this.pickEl.innerHTML = '';
  }

  /* ================================================================ state from the map */

  /** Reflect what is on the map: called after every load, unload and visibility change. */
  syncState() {
    if (!this.root || !this.data) return;
    /** @type {NodeListOf<DataTarget>} */ (this.root.querySelectorAll('[data-cn-toggle]')).forEach((btn) => {
      const on = String(this.isLoaded(btn.dataset.cnToggle));
      if (btn.getAttribute('aria-pressed') !== on) btn.setAttribute('aria-pressed', on);
    });
    /** @type {NodeListOf<DataTarget>} */ (this.root.querySelectorAll('[data-cn-visibility]')).forEach((btn) => {
      const id = btn.dataset.cnVisibility;
      const on = this.isLoaded(id);
      setHidden(btn, !on);
      if (on) {
        const vis = this.isVisible(id);
        const html = `${icon(vis ? 'eye-off' : 'eye')}<span>${vis ? 'Hide' : 'Show'}</span>`;
        if (btn.innerHTML !== html) btn.innerHTML = html;
      }
    });
    /** @type {NodeListOf<DataTarget>} */ (this.root.querySelectorAll('[data-cn-dot]')).forEach((d) => d.classList.toggle('cn-tick--on', this.isLoaded(d.dataset.cnDot)));
    /** @type {NodeListOf<DataTarget>} */ (this.root.querySelectorAll('[data-cn-series]')).forEach((li) => {
      const s = this.seriesById.get(li.dataset.cnSeries);
      li.classList.toggle('cn-row--on', Boolean(s && this.seriesOnMap(s)));
    });
    /** @type {NodeListOf<DataTarget>} */ (this.root.querySelectorAll('[data-cn-election-toggle]')).forEach((btn) => {
      const e = this.electionByKey.get(btn.dataset.cnElectionToggle);
      const on = String(Boolean(e && this.electionLoaded(e)));
      if (btn.getAttribute('aria-pressed') !== on) btn.setAttribute('aria-pressed', on);
      btn.closest('.cn-erow')?.classList.toggle('cn-erow--on', on === 'true');
    });
    const n = app()?.getLoadedLayerIds?.()?.length ?? 0;
    this.root.querySelectorAll('[data-cn-onmap-count]').forEach((el) => { el.textContent = String(n); });
  }
}

/** The search box held the language phrase: say what it did, in place of the results. */
function langNoticeHtml() {
  return '<p class="cn-summary cn-summary--count" role="status" data-cn-lang-notice>Language options are now shown.</p>';
}
