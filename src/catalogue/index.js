/**
 * The rebuilt catalogue pane.
 *
 * Mounted by UIController (src/ui-controller.js) in place of the current pane when
 * catalogueNextRequested() (src/catalogue/flag.js) is true; nothing here runs otherwise.
 *
 * Three sections, Maps (first), Elections and Books, plus the Tables tab. Maps lists every series
 * as one row whose editions are chips: each adds its map in one click and fills with the map's own
 * colour while it is on. Rows open in place for the timeline, facts, versions, parts and the
 * remaining actions; nothing needs a separate page. Filters (where, kind, years on a slider,
 * on the map, to be added) and search narrow the same list in place; a jump bar keeps every shelf
 * in reach. Search also finds places (each named feature, with its own buttons) and people,
 * parties and sources, through the current pane's own search code.
 *
 * Data: data/catalogue/catalogue.json, built by scripts/catalogue/build-catalogue.mjs; places on
 * demand from data/catalogue/places.json. Map actions go through the callbacks the app already
 * gives UIController (onMapLoad, onMapUnload, onMapToggle, onDownloadFgb, onLoadElection...).
 *
 * Addresses (#...&cat=<route>, kept by app.updateURLState): maps | series/<id>[/<mapId>] |
 * elections[/<body>] | books | here/<lng>/<lat>; old #flat-card-<id> links land on their series.
 */
import { CatalogueSearch, PeopleSearch, coveringPoint, normalise } from './search.js';
import { CATALOGUE_CSS } from './styles.js';
import dataService, { resolveMapDownloadUrl } from '../data-service.js';
import { initialCatalogueRoute } from './flag.js';
import { icon, SHELF_LOOK, BOOK_CATEGORY_ICONS } from './icons.js';
import { esc, yearOf } from './util.js';
import { openMenu, closeMenu } from './menu.js';
import { decadeDomain, binCounts, indexOf, updateSlider, stepYear } from './slider.js';
import * as MapsView from './view-maps.js';
import * as ElectionsView from './view-elections.js';
import { BODY_GROUPS, groupOfBody, decadesOf } from './view-elections.js';
import * as BooksView from './view-books.js';

const DATA_URL = '/data/catalogue/catalogue.json';
const PLACES_URL = '/data/catalogue/places.json';
const PEOPLE_URL = '/data/catalogue/people.json';
const STORE = 'civgraph.catalogueNext.v2';
const BLANK_FILTERS = { scope: '', kind: '', from: null, to: null, onMap: false };
const BLANK_EFILTERS = { body: '', ekind: '', escope: '', from: null, to: null };

const app = () => (typeof window !== 'undefined' ? window.__civgraphTest2?.app : null);
const readStore = () => { try { return JSON.parse(sessionStorage.getItem(STORE)) || {}; } catch { return {}; } };
const cssId = (s) => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

export class CatalogueNext {
  constructor(ui) {
    this.ui = ui;
    this.data = null;
    this.loading = null;
    this.root = null;
    const saved = readStore();
    this.tab = 'maps';
    this.filters = { ...BLANK_FILTERS, ...(saved.filters || {}) };
    // "On the map" has no button for now, so it cannot be left on unseen; "to be added" is per row.
    this.filters.onMap = false;
    delete this.filters.toAdd;
    // The kinds were Boundary and Dataset before Statistics and Places & routes were split out.
    if (this.filters.kind && !['Boundary', 'Places', 'Statistics'].includes(this.filters.kind)) this.filters.kind = null;
    this.efilters = { ...BLANK_EFILTERS, ...(saved.efilters || {}) };
    this.collapsed = new Set(saved.collapsed || []);
    this.filtersOpen = false;
    this.expanded = new Set();
    this.selected = new Map();
    this.lastOn = new Map();
    this.focusSeries = null;
    this.moreChips = new Set();
    this.moreParts = new Set();
    this.showTodo = new Set();
    this.limits = {};
    this.query = '';
    this.searchHits = null;
    this.searchPeriod = null;
    this.electionHits = null;
    this.bookHits = null;
    this.extras = null;
    this.searchToken = 0;
    this.here = null;
    this.person = null;
    this.peopleSearch = null;
    this.placesReady = false;
    this.compare = null;
    this.picking = false;
    this.busy = new Set();
    this.pendingToggle = new Set();
    if (typeof window !== 'undefined') {
      // Capture phase: the site's own popstate handlers, registered earlier, rewrite the address
      // from the current view, so this one has to take the new view first.
      window.addEventListener('popstate', () => this.onLocationChange({ rewrite: true }), true);
      window.addEventListener('hashchange', () => this.onLocationChange(), true);
    }
  }

  /* ================================================================ lifecycle */

  async load() {
    if (this.data) return;
    if (!this.loading) {
      this.loading = (async () => {
        const [res] = await Promise.all([
          fetch(DATA_URL, { cache: 'no-cache' }),
          this.ui.ensureThumbnailManifest?.().catch(() => null),
          this.ui.ensureFeatureCountManifest?.().catch(() => null),
        ]);
        if (!res.ok) throw new Error(`catalogue data: ${res.status}`);
        this.data = await res.json();
        this.seriesById = new Map(this.data.series.map((s) => [s.id, s]));
        this.subjectById = new Map(this.data.subjects.map((s) => [s.id, s]));
        this.shelfById = new Map(this.data.shelves.map((s) => [s.id, s]));
        this.seriesOfMap = new Map();
        for (const s of this.data.series) for (const m of s.members) this.seriesOfMap.set(m.id, s.id);
        for (const s of this.data.series) for (const m of s.members) for (const p of this.data.maps[m.id]?.parts || []) if (!this.seriesOfMap.has(p.id)) this.seriesOfMap.set(p.id, s.id);
        this.electionByKey = new Map(this.data.elections.map((e) => [e.key, e]));
        try { this.books = await dataService.ensureBooksLoaded(); } catch { this.books = null; }
        if (this.books && !this.ui.booksData) this.ui.booksData = this.books;
        this.search = new CatalogueSearch(this.data, { books: this.books?.books || [] });
        const editionYears = [];
        for (const s of this.data.series) for (const m of s.members) editionYears.push(yearOf(this.rec(m.id).date));
        this.mapBins = decadeDomain(editionYears);
        const span2 = (ys) => { const v = ys.filter(Number.isFinite); return v.length ? [Math.min(...v), Math.max(...v)] : [null, null]; };
        this.allMapYears = span2(editionYears);
        this.allElectionYears = span2(this.data.elections.map((e) => yearOf(e.date)));
        this.electionBins = decadeDomain(this.data.elections.map((e) => yearOf(e.date)));
        this.applyRoute(this.resolveRoute(initialCatalogueRoute()) || this.routeFromLocation() || 'maps');
      })();
    }
    await this.loading;
  }

  async render(container, options = {}) {
    this.container = container;
    if (!this.root || !container.contains(this.root)) this.mount(container);
    try {
      await this.load();
    } catch (err) {
      this.viewEl.innerHTML = `<p class="cn-empty">The catalogue could not be loaded (${esc(err.message)}).</p>`;
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
    this.root = container.querySelector('[data-cn-root]');
    this.tabsEl = this.root.querySelector('[data-cn-tabs]');
    this.viewEl = this.root.querySelector('[data-cn-view]');
    this.pickEl = this.root.querySelector('[data-cn-pick]');
    this.compareEl = this.root.querySelector('[data-cn-compare]');
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onYearTyped(e));
    // Thumbnail hover previews and the reused search and book buttons are handled by the
    // current pane's delegates on the container.
    this.ui.bindFlatViewDelegates?.(container);
    this.drawn = false;
    this.scroller = this.findScroller();
  }

  findScroller() {
    for (let el = this.container; el; el = el.parentElement) {
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
    if (this.tab === 'elections') {
      toolbar = ElectionsView.toolbarHtml(this);
      results = ElectionsView.resultsHtml(this);
    } else if (this.tab === 'books') {
      results = BooksView.booksHtml(this);
    } else {
      toolbar = this.here ? '' : MapsView.toolbarHtml(this);
      results = MapsView.resultsHtml(this);
    }
    this.viewEl.innerHTML = `${toolbar}<div class="cn-results" data-cn-results>${results}</div>`;
    this.resultsEl = this.viewEl.querySelector('[data-cn-results]');
    this.drawn = true;
    this.afterDraw(this.root);
    this.drawCompare();
  }

  /** Redraw the list only: the filters stay (a slider handle may be held). */
  refreshResults() {
    if (!this.resultsEl || !this.resultsEl.isConnected) return this.draw();
    closeMenu({ restoreFocus: false });
    this.tabsEl.innerHTML = this.tabsHtml();
    this.resultsEl.innerHTML = this.tab === 'elections' ? ElectionsView.resultsHtml(this)
      : this.tab === 'books' ? BooksView.booksHtml(this) : MapsView.resultsHtml(this);
    this.refreshToolbar();
    this.afterDraw(this.resultsEl);
    return undefined;
  }

  refreshToolbar() {
    const bar = this.viewEl.querySelector('[data-cn-toolbar]');
    if (!bar) return;
    const key = bar.dataset.cnToolbar;
    const f = key === 'maps' ? this.filters : this.efilters;
    bar.querySelectorAll('[data-cn-filter]').forEach((b) => {
      const g = b.dataset.cnFilter;
      const on = g === 'onMap' ? Boolean(f[g]) : (f[g] || '') === (b.dataset.value || '');
      b.setAttribute('aria-pressed', String(on));
    });
    if (key === 'elections') {
      const counts = this.electionBodyCounts();
      bar.querySelectorAll('[data-cn-filter="body"]').forEach((b) => {
        const n = b.dataset.value ? counts[b.dataset.value] || 0 : counts.all;
        const el = b.querySelector('.cn-count');
        if (el) el.textContent = n.toLocaleString('en-GB');
      });
    }
    const { i, j } = this.yearRange(key);
    const bins = key === 'maps' ? this.mapBins : this.electionBins;
    updateSlider(bar.querySelector('[data-cn-slider]'), bins, i, j, this.yearState(key));
    const n = this.activeFilterCount(key);
    const toggle = bar.querySelector('.cn-filters-toggle');
    if (toggle) toggle.innerHTML = `${icon('sliders')}Filters${n ? ` <span class="cn-badge">${n}</span>` : ''}`;
  }

  afterDraw(scope) {
    // A long timeline opens on the chosen edition, not on its first year.
    scope.querySelectorAll?.('.cn-tl').forEach((tl) => {
      const tick = tl.querySelector('.cn-tick[aria-pressed="true"]');
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

  tabsHtml() {
    const counts = this.tabCounts();
    const tab = (id, ic, label, n) => `<button type="button" class="catalogue-flat__section-tab cn-tab" data-cn-tab="${id}" aria-current="${String(this.tab === id)}">${icon(ic, 'catalogue-flat__section-icon')}<span>${label}</span><span class="cn-tab__count">${n.toLocaleString('en-GB')}</span></button>`;
    return tab('maps', 'map', 'Maps', counts.maps) + tab('elections', 'vote', 'Elections', counts.elections) + tab('books', 'book-open', 'Books', counts.books)
      + `<button type="button" class="catalogue-flat__section-tab cn-tab" data-cn-act="tables">${icon('table', 'catalogue-flat__section-icon')}<span>Tables</span></button>`;
  }

  tabCounts() {
    if (!this.query) return { maps: this.data.series.length, elections: this.data.elections.length, books: this.books?.books?.length || 0 };
    return { maps: this.searchHits?.size || 0, elections: this.electionHits?.size || 0, books: this.bookHits?.size || 0 };
  }

  /** When the open section has nothing for a search but another does, say so. */
  otherTabHint() {
    if (!this.query) return '';
    const n = this.tabCounts();
    const others = [['maps', 'maps', n.maps], ['elections', 'elections', n.elections], ['books', 'books', n.books]].filter(([id, , k]) => id !== this.tab && k);
    if (!others.length) return '';
    return ` ${others.map(([id, label, k]) => `<button type="button" class="cn-link" data-cn-tab="${id}">${k.toLocaleString('en-GB')} ${label}</button>`).join(' and ')} match it.`;
  }

  /* ================================================================ data helpers (used by the views) */

  rec(id) { return this.data.maps[id] || {}; }
  full(id) { try { return dataService.getMapById(id) || null; } catch { return null; } }
  /**
   * A thumbnail, as the current pane draws it (same classes, so the same hover preview), but loaded
   * by observeThumbs: the current pane's loader watches the window, and the pane scrolls inside
   * its own box, which hides everything below its edge from that loader until it is on screen.
   */
  thumb(id) {
    const ui = this.ui;
    const small = (id && (ui.thumbnailPath?.(id, '-60') || ui.thumbnailPath?.(id))) || '';
    if (!small) return '<span class="catalogue-flat__toc-thumb catalogue-flat__toc-thumb--fallback"></span>';
    const full = ui.thumbnailPath?.(id) || '';
    const blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const zoom = full ? `<span class="catalogue-flat__toc-thumbzoom" aria-hidden="true"><img src="${blank}" data-thumbnail-src="${full}" data-thumbnail-defer="hover" alt="" loading="lazy"></span>` : '';
    return `<span class="catalogue-flat__toc-thumbwrap"><img class="catalogue-flat__toc-thumb" src="${blank}" data-cn-src="${small}" alt="" decoding="async">${zoom}</span>`;
  }

  /** Load thumbnails a screen or two before they scroll into the pane. */
  observeThumbs(scope) {
    const imgs = scope.querySelectorAll?.('img[data-cn-src]') || [];
    if (!imgs.length) return;
    const load = (img) => { img.src = img.dataset.cnSrc; img.removeAttribute('data-cn-src'); };
    if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
    if (!this.thumbObserver || this.thumbObserverRoot !== this.scroller) {
      this.thumbObserver?.disconnect();
      this.thumbObserverRoot = this.scroller;
      this.thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.thumbObserver.unobserve(entry.target);
          load(entry.target);
        }
      }, { root: this.scroller || null, rootMargin: '900px 0px' });
    }
    imgs.forEach((img) => this.thumbObserver.observe(img));
  }

  /** "OSNI - 11 Local Government Districts": provider and feature count, as the current pane writes it. */
  providerLine(id, { full: fullText = false } = {}) {
    const m = this.full(id);
    let line = '';
    if (m && this.ui.renderMapProviderSummary) line = this.ui.renderMapProviderSummary(m) || '';
    if (!line) {
      const r = this.rec(id);
      line = [(r.provider || []).join(', '), r.features ? `${r.features.toLocaleString('en-GB')} features` : ''].filter(Boolean).join(' - ');
    }
    return fullText || line.length <= 90 ? line : `${line.slice(0, 88)}…`;
  }

  decimalYear(d) {
    const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(d || ''));
    if (!m) return null;
    return Number(m[1]) + (m[2] ? (Number(m[2]) - 1) / 12 : 0.5) + (m[3] ? (Number(m[3]) - 1) / 365 : 0);
  }

  /** What a map's own name adds to its label: "2022 (Final Recommendations)" in LGDs, labelled 2022 -> "Final Recommendations". */
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

  selectedMember(s) {
    const id = this.selected.get(s.id);
    return s.members.find((m) => m.id === id) || s.members.find((m) => this.isLoaded(m.id)) || s.members.find((m) => this.rec(m.id).status !== 'placeholder') || s.members[0];
  }

  hitFor(s) { return this.query ? this.searchHits?.get(s.id) : null; }

  /* ================================================================ filters */

  yearRange(key) {
    const f = key === 'maps' ? this.filters : this.efilters;
    const bins = key === 'maps' ? this.mapBins : this.electionBins;
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
  yearState(key) {
    const r = this.yearRange(key);
    const years = key === 'maps'
      ? this.data.series.filter((s) => this.seriesShown(s, { ignoreYears: true })).flatMap((s) => s.members.map((m) => yearOf(this.rec(m.id).date)))
      : this.data.elections.filter((e) => this.electionShown(e, { ignoreYears: true })).map((e) => yearOf(e.date));
    const all = key === 'maps' ? this.allMapYears : this.allElectionYears;
    return {
      from: r.from, to: r.to, min: all[0], max: all[1],
      total: years.filter((y) => Number.isFinite(y) && y >= r.lo && y <= r.hi).length,
      noun: key === 'maps' ? 'dated map' : 'election',
    };
  }

  inYears(key, y) {
    const r = this.yearRange(key);
    if (!r.narrowed) return true;
    return Number.isFinite(y) && y >= r.lo && y <= r.hi;
  }

  // A map with no date (Civil Parishes, Baronies) is taken to cover all time: it stays in view
  // whatever years are chosen.
  editionInYears(id) {
    const y = yearOf(this.rec(id).date);
    return !Number.isFinite(y) || this.inYears('maps', y);
  }

  activeFilterCount(key) {
    const f = key === 'maps' ? this.filters : this.efilters;
    const n = key === 'maps'
      ? [f.scope, f.kind, f.onMap].filter(Boolean).length
      : [f.body, f.ekind, f.escope].filter(Boolean).length;
    return n + (this.yearRange(key).narrowed ? 1 : 0);
  }

  seriesOnMap(s) {
    return s.members.some((m) => this.isLoaded(m.id) || (this.rec(m.id).parts || []).some((p) => this.isLoaded(p.id)));
  }

  seriesShown(s, { ignoreYears = false } = {}) {
    const f = this.filters;
    if (f.scope && s.scope !== f.scope) return false;
    if (f.kind && s.kind !== f.kind) return false;
    if (!ignoreYears && this.yearRange('maps').narrowed && !s.members.some((m) => this.editionInYears(m.id))) return false;
    if (f.onMap && !this.seriesOnMap(s)) return false;
    if (this.query && !this.searchHits?.has(s.id)) return false;
    return true;
  }

  visibleShelves() {
    const score = (s) => this.searchHits?.get(s.id)?.score || 0;
    let shelves = this.data.shelves.map((sh) => {
      const subjects = sh.subjects.map((sid) => this.subjectById.get(sid)).filter(Boolean).map((sub) => {
        let series = sub.series.map((id) => this.seriesById.get(id)).filter((s) => s && this.seriesShown(s));
        if (this.query) series = series.sort((a, b) => score(b) - score(a));
        return { sub, series, best: Math.max(0, ...series.map(score)) };
      }).filter((x) => x.series.length);
      if (this.query) subjects.sort((a, b) => b.best - a.best);
      return { sh, subjects, count: subjects.reduce((n, x) => n + x.series.length, 0), best: Math.max(0, ...subjects.map((x) => x.best)) };
    }).filter((x) => x.subjects.length);
    if (this.query) shelves = shelves.filter((x) => x.count).sort((a, b) => b.best - a.best);
    return shelves;
  }

  mapCounts() {
    const years = [];
    for (const s of this.data.series) {
      if (!this.seriesShown(s, { ignoreYears: true })) continue;
      for (const m of s.members) years.push(yearOf(this.rec(m.id).date));
    }
    return binCounts(this.mapBins, years);
  }

  electionShown(e, { ignoreYears = false, ignoreBody = false } = {}) {
    const f = this.efilters;
    if (!ignoreBody && f.body && groupOfBody(e.bodySlug) !== f.body) return false;
    if (f.escope && e.scope !== f.escope) return false;
    if (f.ekind === 'by-election' && e.kind !== 'by-election') return false;
    if (f.ekind === 'general' && e.kind === 'by-election') return false;
    if (!ignoreYears && !this.inYears('elections', yearOf(e.date))) return false;
    if (this.query && !this.electionHits?.has(e.key)) return false;
    if (this.person && !this.person.contests.has(e.key)) return false;
    return true;
  }

  visibleElections() { return this.data.elections.filter((e) => this.electionShown(e)); }

  electionCounts() { return binCounts(this.electionBins, this.data.elections.filter((e) => this.electionShown(e, { ignoreYears: true })).map((e) => yearOf(e.date))); }

  electionBodyCounts() {
    const counts = { all: 0 };
    for (const e of this.data.elections) {
      if (!this.electionShown(e, { ignoreBody: true })) continue;
      counts.all += 1;
      const g = groupOfBody(e.bodySlug);
      counts[g] = (counts[g] || 0) + 1;
    }
    return counts;
  }

  /** Where and body are one-of-several with an All; kind (maps) and where (elections) have no All:
   * a pressed button is pressed again to show everything. */
  setFilter(group, value) {
    if (group === 'scope') this.filters.scope = value;
    else if (group === 'kind') this.filters.kind = this.filters.kind === value ? '' : value;
    else if (group === 'onMap') this.filters.onMap = !this.filters.onMap;
    else if (group === 'body') this.efilters.body = value;
    else if (group === 'ekind') this.efilters.ekind = value;
    else if (group === 'escope') this.efilters.escope = this.efilters.escope === value ? '' : value;
    this.saveStore();
    this.refreshResults();
    if (group === 'body') this.replaceRoute();
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
      sessionStorage.setItem(STORE, JSON.stringify({ filters: this.filters, efilters: this.efilters, collapsed: [...this.collapsed] }));
    } catch { /* private mode */ }
  }

  /* ================================================================ search */

  setQuery(q) {
    this.query = q;
    if (q) this.person = null;
    this.limits = {};
    this.moreChips.clear();
    if (!q) {
      this.searchHits = null;
      this.searchPeriod = null;
      this.electionHits = null;
      this.bookHits = null;
      this.extras = null;
      this.draw();
      return;
    }
    const r = this.search.query(q, { includeToAdd: true });
    this.searchHits = new Map(r.series.map((h) => [h.id, h]));
    this.searchPeriod = r.period;
    this.electionHits = new Map(r.elections.map((h) => [h.id, '']));
    for (const c of r.contests) for (const k of c.keys) if (!this.electionHits.has(k)) this.electionHits.set(k, `${c.name} contested`);
    this.bookHits = new Set(r.books.map((h) => h.id));
    this.extras = normalise(q).length >= 2 ? { loading: true } : null;
    this.draw();
    if (this.extras) this.loadExtras(q);
  }

  /** Places (named features, with their own buttons) and people, parties and sources, from the
   * current pane's search code, so they behave exactly as they do there. */
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
    const groups = new Map();
    for (const f of (features || []).slice(0, 150)) {
      const record = ui.featureSearchResultToCatalogueRecord ? ui.featureSearchResultToCatalogueRecord(f) : null;
      if (!record) continue;
      const k = normalise(record.title);
      if (!groups.has(k)) groups.set(k, { name: record.title, items: [] });
      groups.get(k).items.push({ record });
    }
    const places = [...groups.values()].sort((a, b) => Number(normalise(b.name) === norm) - Number(normalise(a.name) === norm) || b.items.length - a.items.length);
    const qn = ui.normalizeCatalogueSearchText ? ui.normalizeCatalogueSearchText(q) : norm;
    const terms = qn.split(/\s+/).filter(Boolean);
    const people = (index || [])
      .filter((r) => r.type === 'person' || r.type === 'party' || r.type === 'source')
      .map((r) => ({ r, s: ui.scoreCatalogueSearchRecord ? ui.scoreCatalogueSearchRecord(r, terms, qn, new Map()) : 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
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
    if (input) input.value = '';
    this.query = '';
    this.searchHits = null;
    this.searchPeriod = null;
    this.electionHits = null;
    this.bookHits = null;
    this.extras = null;
    if (this.ui) this.ui._catalogueSearchQuery = '';
    const a = app();
    if (a) { a.searchQuery = ''; a.workerSearchQuery = ''; a.workerSearchResultIds = null; }
  }

  /** The person index (data/catalogue/people.json), on the first search that needs it. */
  ensurePeople() {
    if (this.peopleSearch) return Promise.resolve(this.peopleSearch);
    if (!this.peoplePromise) {
      this.peoplePromise = fetch(PEOPLE_URL).then((r) => (r.ok ? r.json() : null)).then((doc) => {
        if (!doc) return null;
        this.peopleDoc = doc;
        this.peopleSearch = new PeopleSearch(doc);
        this.peopleById = new Map(doc.people.map((row) => [String(row[0]), row]));
        return this.peopleSearch;
      }).catch(() => null);
    }
    return this.peoplePromise;
  }

  /** The elections a person stood in, each with where, for which party, and whether elected. */
  setPerson(row) {
    const { parties, constituencies } = this.peopleDoc;
    const contests = new Map();
    for (const [ei, pi, won, party] of row[8]) {
      const e = this.data.elections[ei];
      if (e) contests.set(e.key, { place: constituencies[pi] || '', party: party !== undefined ? parties[party] : (parties[row[2]] || ''), won: Boolean(won) });
    }
    this.person = { id: String(row[0]), name: row[1], row, contests };
  }

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

  routeFromLocation() {
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('flat-card-')) return this.resolveRoute(hash);
    try {
      return this.resolveRoute(new URLSearchParams(hash).get('cat') || '');
    } catch {
      return '';
    }
  }

  resolveRoute(route) {
    if (!route) return '';
    if (route.startsWith('flat-card-')) {
      const s = this.data?.redirects?.[route.slice('flat-card-'.length)];
      return s ? `series/${s}` : 'maps';
    }
    const [view, id] = route.split('/');
    if (view === 'series' && !this.seriesById?.has(id)) return 'maps';
    if (view === 'subject' && !this.subjectById?.has(id)) return 'maps';
    return route;
  }

  routeString() {
    if (!this.data) return initialCatalogueRoute();
    if (this.here) return `here/${this.here.lng.toFixed(5)}/${this.here.lat.toFixed(5)}`;
    if (this.tab === 'elections') {
      if (this.person) return `elections/person/${this.person.id}`;
      return this.efilters.body ? `elections/${this.efilters.body}` : 'elections';
    }
    if (this.tab === 'books') return 'books';
    if (this.focusSeries && this.expanded.has(this.focusSeries)) {
      const sel = this.selected.get(this.focusSeries);
      return `series/${this.focusSeries}${sel ? `/${sel}` : ''}`;
    }
    return 'maps';
  }

  applyRoute(route) {
    const [view, a, b] = String(route || 'maps').split('/');
    this.here = null;
    if (view === 'series' && this.seriesById.has(a)) {
      this.tab = 'maps';
      this.expanded.add(a);
      this.focusSeries = a;
      if (b) this.selected.set(a, b);
      this.revealSeries(this.seriesById.get(a));
      this.scrollTarget = a;
    } else if (view === 'subject' && this.subjectById.has(a)) {
      this.tab = 'maps';
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
      if (a !== undefined) this.efilters.body = BODY_GROUPS.some((g) => g.id === a) ? a : groupOfBody(a);
    } else if (view === 'books') {
      this.tab = 'books';
    } else if (view === 'here' && a && b && Number.isFinite(Number(a)) && Number.isFinite(Number(b))) {
      this.tab = 'maps';
      this.here = { lng: Number(a), lat: Number(b) };
      this.ensurePlaces();
    } else {
      this.tab = 'maps';
    }
  }

  /** A linked series must be visible: open its shelf, and lift filters that would hide it. */
  revealSeries(s) {
    if (!s) return;
    this.collapsed.delete(s.shelf);
    if (!this.query && !this.seriesShown(s)) {
      this.filters = { ...BLANK_FILTERS };
      this.saveStore();
    }
  }

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

  scrollToTarget() {
    const t = this.scrollTarget;
    this.scrollTarget = null;
    if (!t || !this.root) return;
    const el = t.startsWith('subject:')
      ? this.root.querySelector(`[data-cn-subject="${cssId(t.slice(8))}"]`)
      : this.root.querySelector(`[data-cn-series="${cssId(t)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.querySelector('[data-cn-expand]')?.focus({ preventScroll: true });
  }

  /* ================================================================ events */

  onClick(e) {
    const b = (sel) => e.target.closest(sel);
    let el;
    if ((el = b('[data-cn-tab]'))) {
      e.preventDefault();
      if (el.dataset.cnTab !== this.tab || this.here) this.go(el.dataset.cnTab === 'elections' ? `elections${this.efilters.body ? `/${this.efilters.body}` : ''}` : el.dataset.cnTab);
      return;
    }
    if ((el = b('[data-cn-toggle]'))) { e.preventDefault(); this.toggleMap(el.dataset.cnToggle, el); return; }
    if ((el = b('[data-cn-election-toggle]'))) { e.preventDefault(); this.toggleElection(el.dataset.cnElectionToggle, el); return; }
    if ((el = b('[data-cn-expand]'))) { e.preventDefault(); this.toggleExpand(el.dataset.cnExpand); return; }
    if ((el = b('[data-cn-select]'))) { e.preventDefault(); const [sid, mid] = el.dataset.cnSelect.split('|'); this.select(sid, mid); return; }
    if ((el = b('[data-cn-menu]'))) { e.preventDefault(); this.openSeriesMenu(el, el.dataset.cnMenu); return; }
    if ((el = b('[data-cn-more]'))) { e.preventDefault(); this.moreChips.add(el.dataset.cnMore); this.rerenderRow(el.dataset.cnMore, { focus: 'chips' }); return; }
    if ((el = b('[data-cn-more-parts]'))) { e.preventDefault(); this.moreParts.add(el.dataset.cnMoreParts); this.rerenderPanel(this.seriesOfMap.get(el.dataset.cnMoreParts)); return; }
    if ((el = b('[data-cn-visibility]'))) { e.preventDefault(); this.toggleVisible(el.dataset.cnVisibility); return; }
    if ((el = b('[data-cn-filter]'))) { e.preventDefault(); this.setFilter(el.dataset.cnFilter, el.dataset.value || ''); return; }
    if ((el = b('[data-cn-shelf]'))) { e.preventDefault(); this.toggleShelf(el); return; }
    if ((el = b('[data-cn-person]'))) { e.preventDefault(); this.showPersonElections(el.dataset.cnPerson); return; }
    if ((el = b('[data-cn-todo]'))) {
      e.preventDefault();
      const id = el.dataset.cnTodo;
      if (this.showTodo.has(id)) this.showTodo.delete(id); else this.showTodo.add(id);
      this.rerenderRow(id);
      this.root.querySelector(`[data-cn-series="${cssId(id)}"] [data-cn-todo]`)?.focus({ preventScroll: true });
      return;
    }
    if ((el = b('[data-cn-goto]'))) {
      e.preventDefault();
      const sid = el.dataset.cnGoto;
      if (!sid) return;
      this.here = null;
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

  onKeyDown(e) {
    // Arrow keys move along a row's chips; Tab moves on to the next control.
    const chip = e.target.closest?.('.cn-chips .cn-chip');
    if (chip && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      const list = [...chip.closest('.cn-chips').querySelectorAll('button.cn-chip')];
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

  onInput(e) {
    const r = e.target.closest?.('[data-cn-range]');
    if (!r) return;
    const key = r.dataset.key;
    const bins = key === 'maps' ? this.mapBins : this.electionBins;
    const wrap = r.closest('[data-cn-slider]');
    const [a, b] = wrap.querySelectorAll('input[type="range"]');
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
    cancelAnimationFrame(this.rangeRaf);
    this.rangeRaf = requestAnimationFrame(() => this.refreshResults());
  }

  /** A year typed into a box: applied when the box is left or Enter is pressed, not per key. */
  onYearTyped(e) {
    const box = e.target.closest?.('[data-cn-year]');
    if (!box) return;
    const key = box.dataset.key;
    const f = key === 'maps' ? this.filters : this.efilters;
    const v = box.value.trim() === '' ? null : Math.round(Number(box.value));
    f[box.dataset.cnYear] = Number.isFinite(v) ? v : null;
    if (f.from !== null && f.to !== null && f.from > f.to) [f.from, f.to] = [f.to, f.from];
    this.saveStore();
    const r = this.yearRange(key);
    updateSlider(box.closest('[data-cn-slider]'), key === 'maps' ? this.mapBins : this.electionBins, r.i, r.j, this.yearState(key));
    this.refreshResults();
  }

  rovingChips(scope) {
    scope.querySelectorAll?.('.cn-chips').forEach((group) => {
      [...group.querySelectorAll('button.cn-chip')].forEach((x, i) => { x.tabIndex = i === 0 ? 0 : -1; });
    });
  }

  act(kind, el) {
    const id = el.dataset.map;
    switch (kind) {
      case 'tables':
        if (this.ui.showTab) this.ui.showTab('tables');
        else document.querySelector('[data-tab-target="tables"]')?.click();
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
      case 'pick-here': this.startPick(); break;
      case 'cancel-pick': this.stopPick(); break;
      case 'close-here': this.here = null; this.draw(); this.replaceRoute(); break;
      case 'flip': this.setFade(this.compare && this.compare.value >= 50 ? 0 : 100, true); break;
      case 'end-compare': this.endCompare(); break;
      default:
    }
  }

  /* ================================================================ rows */

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

  select(sid, mid) {
    this.selected.set(sid, mid);
    this.focusSeries = sid;
    this.rerenderPanel(sid, `[data-cn-select="${cssId(`${sid}|${mid}`)}"]`);
    this.replaceRoute();
  }

  rowHit(s) {
    if (!this.here) return this.hitFor(s);
    const hit = coveringPoint({ series: [s], maps: this.data.maps }, null, this.here.lng, this.here.lat);
    return { members: hit.series[0]?.members || [] };
  }

  rerenderRow(id, { focus } = {}) {
    const li = this.root?.querySelector(`[data-cn-series="${cssId(id)}"]`);
    const s = this.seriesById.get(id);
    if (!li || !s) return;
    const tmp = document.createElement('ul');
    tmp.innerHTML = MapsView.seriesRowHtml(this, s, this.rowHit(s));
    const fresh = tmp.firstElementChild;
    li.replaceWith(fresh);
    this.afterDraw(fresh);
    if (focus === 'title') fresh.querySelector('[data-cn-expand]')?.focus({ preventScroll: true });
    if (focus === 'chips') fresh.querySelector('.cn-chips .cn-chip')?.focus({ preventScroll: true });
  }

  rerenderPanel(sid, focusSel) {
    const panel = this.root?.querySelector(`[data-cn-panel="${cssId(sid)}"]`);
    const s = this.seriesById.get(sid);
    if (!panel || !s) { this.rerenderRow(sid); return; }
    panel.innerHTML = MapsView.panelHtml(this, s);
    this.afterDraw(panel);
    if (focusSel) panel.querySelector(focusSel)?.focus({ preventScroll: true });
  }

  toggleShelf(btn) {
    const id = btn.dataset.cnShelf;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    if (open) this.collapsed.delete(id); else this.collapsed.add(id);
    btn.setAttribute('aria-expanded', String(open));
    const body = btn.closest('.cn-shelf')?.querySelector('.cn-shelf__body');
    if (body) body.hidden = !open;
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
  sections() {
    if (this.tab === 'elections') {
      return [...decadesOf(this.visibleElections()).entries()].map(([d, es]) => ({ id: `cn-decade-${d}`, label: `${d}s`, count: es.length, level: 1 }));
    }
    if (this.tab === 'books') {
      const all = this.books?.books || [];
      const shown = this.query ? all.filter((b) => this.bookHits?.has(b.id)) : all;
      return (this.books?.categories || []).map((cat) => ({ cat, n: shown.filter((b) => b.category === cat.id).length })).filter((x) => x.n)
        .map(({ cat, n }) => ({ id: `cn-books-${cat.id}`, label: cat.name, count: n, level: 1, icon: BOOK_CATEGORY_ICONS[cat.id] || 'book-open' }));
    }
    if (this.here) return [];
    const out = [];
    for (const { sh, subjects, count } of this.visibleShelves()) {
      const [ic, col] = SHELF_LOOK[sh.id] || ['map', '#7a8699'];
      out.push({ id: `cn-shelf-${sh.id}`, label: sh.name, count, level: 1, icon: ic, colour: col });
      if (!sh.flat) for (const { sub, series } of subjects) out.push({ id: `cn-subject-${sub.id}`, label: sub.name, count: series.length, level: 2 });
    }
    return out;
  }

  /** The section now at the top of the pane. */
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
    const tabName = { maps: 'Maps', elections: 'Elections', books: 'Books' }[this.tab] || 'Maps';
    const el = document.createElement('div');
    el.className = 'cn-drawer';
    el.innerHTML = `<div class="cn-drawer__scrim" data-cn-drawer-close></div>
      <div class="cn-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="cn-drawer-title">
        <div class="cn-drawer__head">
          <h2 class="cn-drawer__title" id="cn-drawer-title">${tabName}: contents</h2>
          <button type="button" class="cn-iconbtn" data-cn-drawer-close aria-label="Close contents">${icon('x')}</button>
        </div>
        ${list.length ? `<ul class="cn-toc">${list.map((it) => `<li class="cn-toc__item cn-toc__item--l${it.level}"><button type="button" class="cn-toc__link" data-cn-goto-section="${esc(it.id)}"${it.id === current ? ' aria-current="true"' : ''}${it.colour ? ` style="--shelf:${it.colour}"` : ''}>${it.icon ? `<span class="cn-toc__icon">${icon(it.icon)}</span>` : ''}<span class="cn-toc__label">${esc(it.label)}</span><span class="cn-count">${it.count.toLocaleString('en-GB')}</span></button></li>`).join('')}</ul>`
          : `<p class="cn-empty">${this.here ? 'Close “What’s here” to see the shelves.' : 'Nothing to list with these filters.'}</p>`}
      </div>`;
    document.body.appendChild(el);
    this.contentsEl = el;
    this.placeContents(pane);
    this.contentsBtn?.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', (e) => {
      const go = e.target.closest('[data-cn-goto-section]');
      if (go) { this.closeContents({ focus: false }); this.goToSection(go.dataset.cnGotoSection); return; }
      if (e.target.closest('[data-cn-drawer-close]')) this.closeContents();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.closeContents(); return; }
      if (e.key !== 'Tab') return;
      const focusables = [...el.querySelectorAll('button')];
      const i = focusables.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { focusables[focusables.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && i === focusables.length - 1) { focusables[0].focus(); e.preventDefault(); }
    });
    this.onContentsResize = () => this.placeContents(pane);
    window.addEventListener('resize', this.onContentsResize);
    requestAnimationFrame(() => {
      el.classList.add('cn-drawer--open');
      const target = el.querySelector('[aria-current="true"]') || el.querySelector('.cn-toc__link') || el.querySelector('[data-cn-drawer-close]');
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    });
  }

  /** The panel covers the catalogue pane exactly, whatever the split between pane and map. */
  placeContents(pane) {
    if (!this.contentsEl) return;
    const r = pane.getBoundingClientRect();
    Object.assign(this.contentsEl.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  closeContents({ focus = true } = {}) {
    const el = this.contentsEl;
    if (!el) return;
    this.contentsEl = null;
    window.removeEventListener('resize', this.onContentsResize);
    this.contentsBtn?.setAttribute('aria-expanded', 'false');
    el.classList.remove('cn-drawer--open');
    const done = () => el.remove();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 200);
    if (focus) this.contentsBtn?.focus();
  }

  goToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    // A subject in a closed shelf: open the shelf first.
    const shelf = el.closest('.cn-shelf');
    const toggle = shelf?.querySelector('[data-cn-shelf][aria-expanded="false"]');
    if (toggle) this.toggleShelf(toggle);
    el.scrollIntoView({ block: 'start' });
    const focusTarget = el.querySelector('[data-cn-shelf], .cn-subject__head, .cn-decade__head, .category-section__title');
    if (focusTarget) {
      if (!focusTarget.matches('button')) focusTarget.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
    }
  }

  /* ================================================================ actions on the map */

  isLoaded(id) { try { return Boolean(this.ui?.onCheckMapLoaded?.(id)); } catch { return false; } }
  isVisible(id) { try { return this.ui?.onCheckMapVisible ? Boolean(this.ui.onCheckMapVisible(id)) : true; } catch { return true; } }
  electionLoaded(e) { try { return Boolean(this.ui?.onCheckElectionLoaded?.(e.body, e.date)); } catch { return false; } }

  announce(text) {
    const el = document.getElementById('announcer') || document.querySelector('[aria-live="polite"]');
    if (el) { el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); }
  }

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
    } finally {
      this.busy.delete(id);
      btn?.removeAttribute('aria-busy');
      this.syncState();
    }
    if (this.pendingToggle.delete(id)) await this.toggleMap(id, btn);
  }

  async addParts(id) {
    for (const p of this.rec(id).parts || []) if (!this.isLoaded(p.id)) await this.ui.onMapLoad?.(p.id);
    this.syncState();
  }

  toggleVisible(id) { this.ui.onMapToggle?.(id); setTimeout(() => this.syncState(), 60); }

  async toggleElection(key, btn) {
    const e = this.electionByKey.get(key);
    if (!e || this.busy.has(key)) return;
    this.busy.add(key);
    btn?.setAttribute('aria-busy', 'true');
    try {
      if (this.electionLoaded(e)) await this.ui.onUnloadElection?.();
      else await this.ui.onLoadElection?.(e.body, e.date);
    } finally {
      this.busy.delete(key);
      btn?.removeAttribute('aria-busy');
      this.syncState();
    }
  }

  zoom(id) { const b = this.rec(id).bounds; if (b) app()?.mapController?.fitToBounds?.(b, { smooth: true }); }
  details(id) { this.ui.showCatalogueDetailView?.(id, true); }

  downloadsFor(id) {
    const full = this.full(id);
    const out = [];
    if (!full) return out;
    if (resolveMapDownloadUrl(full)) out.push({ label: 'FlatGeobuf (.fgb)', icon: 'download', onSelect: () => this.ui.onDownloadFgb?.(id) });
    if (full.files?.geojson) out.push({ label: 'Original GeoJSON', icon: 'download', href: full.files.geojson, download: true });
    for (const d of this.ui.getSourceDownloads?.(full) || []) if (d?.file) out.push({ label: d.label || 'Source file', icon: 'download', href: d.file, download: true });
    if (full.isDataEntry && full.csv) out.push({ label: 'Statistics (CSV)', icon: 'download', href: `/${String(full.csv).replace(/^\//, '')}`, download: true });
    return out;
  }

  async copyText(text, what) {
    try { await navigator.clipboard.writeText(text); this.announce(`${what} copied`); return true; } catch { window.prompt(`Copy the ${what.toLowerCase()}:`, text); return false; }
  }

  shareUrl(id) { return app()?.buildLayerShareUrl?.(id) || `${location.origin}/maps/#layers=${encodeURIComponent(id)}`; }

  async copyLink(id, btn) {
    await this.copyText(this.shareUrl(id), 'Link');
    this.flash(btn, 'Link copied');
  }

  async cite(id, s, btn) {
    const r = this.rec(id);
    const m = s?.members.find((x) => x.id === id);
    const year = yearOf(r.date);
    const who = r.provider?.join(', ') || 'Civgraph';
    const title = s && s.members.length > 1 ? `${s.name}, ${m?.label || ''}` : (s?.name || r.name || id);
    const accessed = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    await this.copyText(`${who}. ${title}${year && !String(m?.label || '').includes(String(year)) ? ` (${year})` : ''} [map layer]. Civgraph, ${this.shareUrl(id)} (accessed ${accessed}).`, 'Citation');
    this.flash(btn, 'Citation copied');
  }

  flash(btn, text) {
    const label = btn?.querySelector('span');
    if (!label) return;
    const before = label.textContent;
    label.textContent = text;
    setTimeout(() => { if (label.isConnected) label.textContent = before; }, 1600);
  }

  /** The edition a row's menu acts on: the one last put on the map, else the chosen one, else the newest. */
  menuTarget(s) {
    const last = this.lastOn.get(s.id);
    if (last && this.isLoaded(last)) return s.members.find((m) => m.id === last) || s.members[0];
    return s.members.find((m) => this.isLoaded(m.id)) || this.selectedMember(s);
  }

  openSeriesMenu(anchor, sid) {
    const s = this.seriesById.get(sid);
    if (!s) return;
    const t = this.menuTarget(s);
    const r = this.rec(t.id);
    const loaded = this.isLoaded(t.id);
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
    const others = s.members.filter((m) => m.id !== t.id && this.rec(m.id).status !== 'placeholder');
    if (others.length) {
      items.push({ separator: true }, { heading: `Compare ${t.label} with` }, ...others.slice(0, 8).map((m) => ({ label: m.label, icon: 'columns', onSelect: () => this.startCompare(t.id, m.id) })));
      if (others.length > 8) items.push({ label: `${others.length - 8} more: open the row`, icon: 'chevron-down', onSelect: () => { if (!this.expanded.has(sid)) this.toggleExpand(sid); } });
    }
    openMenu(anchor, items, { label: `${s.name}: more` });
  }

  openCompareMenu(anchor, s, id) {
    if (!s) return;
    const others = s.members.filter((m) => m.id !== id && this.rec(m.id).status !== 'placeholder');
    openMenu(anchor, [{ heading: 'Compare with' }, ...others.map((m) => ({ label: m.label, icon: 'columns', onSelect: () => this.startCompare(id, m.id) }))], { label: 'Compare with' });
  }

  /* ================================================================ compare */

  labelOf(id) {
    const s = this.seriesById.get(this.seriesOfMap.get(id));
    const m = s?.members.find((x) => x.id === id);
    return m ? (s.members.length > 1 ? m.label : s.name) : (this.rec(id).name || id);
  }

  async startCompare(a, b) {
    // The second map is loaded last, so it draws on top; the slider fades it in over the first.
    if (!this.isLoaded(a)) await this.ui.onMapLoad?.(a);
    if (this.isLoaded(b)) await this.ui.onMapUnload?.(b);
    await this.ui.onMapLoad?.(b);
    this.compare = { a, b, aLabel: this.labelOf(a), bLabel: this.labelOf(b), value: 50 };
    this.setFade(50);
    this.drawCompare();
    this.syncState();
    this.compareEl.querySelector('[data-cn-fade]')?.focus();
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
    this.compareEl.querySelector('[data-cn-fade]').addEventListener('input', (ev) => this.setFade(Number(ev.target.value)));
  }

  setFade(value, moveSlider = false) {
    if (!this.compare) return;
    this.compare.value = value;
    const mc = app()?.mapController;
    mc?.setOpacity?.(this.compare.b, value / 100);
    mc?.setOpacity?.(this.compare.a, value >= 100 ? 0.15 : 1);
    if (moveSlider) { const r = this.compareEl.querySelector('[data-cn-fade]'); if (r) r.value = String(value); }
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
    this.placesPromise = fetch(PLACES_URL).then((r) => r.json()).then((doc) => {
      this.search.setPlaces(doc);
      this.placesReady = true;
      if (this.here && this.drawn) this.refreshResults();
    }).catch(() => { this.placesReady = true; });
    return this.placesPromise;
  }

  hereResult() {
    const { lng, lat } = this.here;
    const hit = coveringPoint(this.data, this.placesReady ? this.search.places : null, lng, lat);
    const series = hit.series.map((h) => ({ s: this.seriesById.get(h.id), members: h.members })).filter((x) => x.s && this.seriesShown(x.s));
    // Named features whose box holds the point, smallest first: the most local place leads, and
    // whole regions and seas sink. Grid squares and codes ("H 86 62") are not places.
    const codeLike = (name) => (name.match(/\d/g) || []).length > name.length * 0.3;
    const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    const seen = new Set();
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
    this.pickEl.hidden = false;
    this.pickEl.innerHTML = `${icon('crosshair')}<span>Click a point on the map to list the maps that cover it</span><button type="button" class="cn-btn" data-cn-act="cancel-pick">Cancel</button>`;
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = 'crosshair';
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
    this.pickEl.hidden = true;
    this.pickEl.innerHTML = '';
  }

  /* ================================================================ state from the map */

  /** Reflect what is on the map: called after every load, unload and visibility change. */
  syncState() {
    if (!this.root || !this.data) return;
    this.root.querySelectorAll('[data-cn-toggle]').forEach((btn) => {
      const on = String(this.isLoaded(btn.dataset.cnToggle));
      if (btn.getAttribute('aria-pressed') !== on) btn.setAttribute('aria-pressed', on);
    });
    this.root.querySelectorAll('[data-cn-visibility]').forEach((btn) => {
      const id = btn.dataset.cnVisibility;
      const on = this.isLoaded(id);
      btn.hidden = !on;
      if (on) {
        const vis = this.isVisible(id);
        const html = `${icon(vis ? 'eye-off' : 'eye')}<span>${vis ? 'Hide' : 'Show'}</span>`;
        if (btn.innerHTML !== html) btn.innerHTML = html;
      }
    });
    this.root.querySelectorAll('[data-cn-dot]').forEach((d) => d.classList.toggle('cn-tick--on', this.isLoaded(d.dataset.cnDot)));
    this.root.querySelectorAll('[data-cn-series]').forEach((li) => {
      const s = this.seriesById.get(li.dataset.cnSeries);
      li.classList.toggle('cn-row--on', Boolean(s && this.seriesOnMap(s)));
    });
    this.root.querySelectorAll('[data-cn-election-toggle]').forEach((btn) => {
      const e = this.electionByKey.get(btn.dataset.cnElectionToggle);
      const on = String(Boolean(e && this.electionLoaded(e)));
      if (btn.getAttribute('aria-pressed') !== on) btn.setAttribute('aria-pressed', on);
      btn.closest('.cn-erow')?.classList.toggle('cn-erow--on', on === 'true');
    });
    const n = app()?.getLoadedLayerIds?.()?.length ?? 0;
    this.root.querySelectorAll('[data-cn-onmap-count]').forEach((el) => { el.textContent = String(n); });
  }
}
