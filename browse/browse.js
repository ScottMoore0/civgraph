const DATA_ROOT = '/data/browse';
const GRAPH_ROOT = '/data/graph';
const BROWSE_DATA_VERSION = '20260702-proni-4';
const THUMBNAIL_ASSET_VERSION = '20260604-tight-admin-frame';
// `layer` is the Civgraph 1.0 layer each entity belongs to (docs/CIVGRAPH_1.0.md):
// 'source' is original material as published, 'data' is what has been derived from it.
// The same app serves /catalogue/ (source) and /records/ (data) and scopes itself by the
// section the shell page declares; /browse/ declares none and still shows everything, so
// no existing link breaks.
const ENTITY_CONFIG = {
  maps: { label: 'Maps', singular: 'Map', index: 'maps.json', detailDir: 'maps', action: 'Open in interactive map', layer: 'data' },
  elections: { label: 'Elections', singular: 'Election', index: 'elections.json', listIndex: 'elections-list.json', detailDir: 'elections', action: 'Open election layer', layer: 'data' },
  features: { label: 'Features', singular: 'Feature group', index: 'features.json', detailDir: null, action: 'Open source map', layer: 'data' },
  parties: { label: 'Parties / Labels', singular: 'Party / label', index: 'parties.json', detailDir: 'parties', layer: 'data' },
  persons: { label: 'Persons', singular: 'Person', index: 'persons.json', detailDir: null, action: 'Latest election on map', layer: 'data' },
  'register-interests': { label: 'Register Interests', singular: 'Register interest', index: 'register-interests.json', detailDir: 'register-interests', layer: 'data' },
  sources: { label: 'Books / Tables / Sources', singular: 'Source', index: 'sources.json', detailDir: 'sources', layer: 'source' },
  proni: { label: 'PRONI Records', singular: 'PRONI record', index: 'proni.json', detailDir: 'proni', layer: 'source' }
};

// Which layer this page is scoped to: 'source', 'data', or null for the unscoped /browse/.
const SECTION_LAYER = (() => {
  const v = document.documentElement.dataset.browseSection;
  return v === 'source' || v === 'data' ? v : null;
})();

const SECTION_COPY = {
  source: {
    kicker: 'Catalogue',
    title: 'Civgraph source catalogue',
    description: 'Original sources as published: books, tables, datasets, map downloads, source files and archival records, with their publisher, licence and files. This is the source layer — material as it was issued, before anything was derived from it.'
  },
  data: {
    kicker: 'Records',
    title: 'Civgraph records',
    description: 'What has been derived from the sources: map layers, elections, boundary features, parties and labels, people, and register entries, linked to one another and back to the source each came from.'
  }
};

// Entity types visible in this section, in ENTITY_CONFIG order.
function sectionTypes() {
  const all = Object.keys(ENTITY_CONFIG);
  if (!SECTION_LAYER) return all;
  return all.filter((type) => ENTITY_CONFIG[type].layer === SECTION_LAYER);
}

function inSection(type) {
  return !SECTION_LAYER || ENTITY_CONFIG[type]?.layer === SECTION_LAYER;
}

// The Catalogue's facet bar. Each key is already a filter the /_api/sources endpoint
// accepts and a key in its precomputed facets blob, so adding one here is a server change
// (a column and a facet in build-browse-index-d1-import.mjs) plus a line below -- never a
// scan of the 40,553 records in the browser, which is what this listing used to do.
const SOURCE_FILTERS = [
  { key: 'provider', label: 'Publisher' },
  { key: 'category', label: 'Category' },
  { key: 'license', label: 'Licence' },
  { key: 'publicationStatus', label: 'Publication status' },
];

// Filters for the lists read whole from a static index, so the options come from every record
// rather than a page of them. `value` reads the facet from an item; `label` names an option.
const ELECTION_KIND_LABELS = { general: 'General elections', 'by-election': 'By-elections', referendum: 'Referendums', other: 'Other' };
const LIST_FILTERS = {
  elections: [
    { key: 'body', label: 'Body', value: (item) => item.body },
    { key: 'decade', label: 'Decade', value: (item) => item.decade, order: 'desc' },
    { key: 'kind', label: 'Type', value: (item) => electionKind(item), optionLabel: (value) => ELECTION_KIND_LABELS[value] || value },
    {
      key: 'results',
      label: 'Show',
      value: (item) => (!item.entryKind || item.entryKind === 'election' ? 'elections' : 'results'),
      optionLabel: (value) => (value === 'elections' ? 'Elections only' : 'Constituency and overall results only'),
      allLabel: 'Elections and their results'
    }
  ],
  maps: [
    { key: 'category', label: 'Category', value: (item) => item.category }
  ],
  // `values` for a facet a record has several of: a party contested several bodies.
  parties: [
    { key: 'body', label: 'Body contested', values: (item) => item.bodies || [] },
    { key: 'decade', label: 'Active in', values: (item) => item.decades || [], order: 'desc' }
  ],
  // People: the options come from persons-facets.json (the list itself is paged from D1), and
  // the values below filter the whole index only when the API cannot (renderServerList).
  persons: [
    { key: 'body', label: 'Body', values: (item) => normalizeArray(item.bodies) },
    { key: 'party', label: 'Party', values: (item) => personPartySlugs(item) },
    { key: 'decade', label: 'Stood in', values: (item) => personDecades(item), order: 'desc' },
    {
      key: 'elected',
      label: 'Elected',
      value: (item) => (Number(item.totals?.elected) > 0 ? 'yes' : 'no'),
      optionLabel: (value) => (value === 'yes' ? 'Elected at least once' : 'Never elected'),
      allLabel: 'Elected or not'
    }
  ]
};

// Sort orders of the People and Parties lists (?sort=). The first is each list's own order.
// `dir` is sent to /_api/persons with the sort; `compare` sorts a list read whole.
const byNumberDesc = (read) => (a, b) => (Number(read(b)) || 0) - (Number(read(a)) || 0);
const byYear = (read, dir) => (a, b) => {
  const x = Number(read(a)) || null;
  const y = Number(read(b)) || null;
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return dir === 'desc' ? y - x : x - y;
};
const byTitle = (a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''));
const LIST_SORTS = {
  persons: [
    { key: '', label: 'Most often elected' },
    { key: 'name', label: 'Name (A to Z)', dir: 'asc', compare: byTitle },
    { key: 'contests', label: 'Most contests', dir: 'desc', compare: byNumberDesc((item) => item.totals?.stood) },
    { key: 'firstYear', label: 'Earliest first contest', dir: 'asc', compare: byYear((item) => item.firstYear, 'asc') },
    { key: 'lastYear', label: 'Most recent contest', dir: 'desc', compare: byYear((item) => item.lastYear, 'desc') }
  ],
  parties: [
    { key: '', label: 'Most candidacies' },
    { key: 'name', label: 'Name (A to Z)', compare: byTitle },
    { key: 'elections', label: 'Most elections', compare: byNumberDesc((item) => item.relatedElectionCount) },
    { key: 'seats', label: 'Most seats won', compare: byNumberDesc((item) => item.totals?.seats) },
    { key: 'firstYear', label: 'Earliest first election', compare: byYear((item) => item.firstYear, 'asc') },
    { key: 'lastYear', label: 'Most recent election', compare: byYear((item) => item.lastYear, 'desc') }
  ]
};
// The sorts /_api/persons answered before it reported what it applied (persons-4).
const PERSON_SORTS_BEFORE_APPLIED = new Set(['name', 'firstYear', 'lastYear']);

function listSortOption(type) {
  const options = LIST_SORTS[type] || [];
  return options.find((option) => option.key === (state.listSort[type] || '')) || options[0] || null;
}

function sortListItems(type, items) {
  const option = listSortOption(type);
  return option?.compare ? [...items].sort((a, b) => option.compare(a, b) || byTitle(a, b)) : items;
}

/** The decades a person stood in, from their contests. */
function personDecades(item) {
  return [...new Set(normalizeArray(item.elections).map((row) => Number(row.year || String(row.date || '').slice(0, 4)))
    .filter((year) => year > 0).map((year) => `${Math.floor(year / 10) * 10}s`))];
}

/** A person's parties as party slugs, through the spellings persons-facets.json lists. */
function personPartySlugs(item) {
  const bySpelling = state.personFacets?.partyBySpelling;
  if (!bySpelling) return [];
  return [...new Set(normalizeArray(item.parties).map((party) => bySpelling.get(party?.name || party)).filter(Boolean))];
}

/** The People filter options (data/browse/persons-facets.json, 24 KB), loaded once. */
async function loadPersonFacets() {
  if (state.personFacets) return state.personFacets;
  let facets = {};
  try {
    facets = (await loadJson(`${DATA_ROOT}/persons-facets.json`)).facets || {};
  } catch { /* the list still shows, without its filters */ }
  const partyBySpelling = new Map();
  const partyNames = new Map();
  for (const party of facets.party || []) {
    partyNames.set(party.value, party.names || []);
    for (const name of party.names || []) partyBySpelling.set(name, party.value);
  }
  state.personFacets = { facets, partyBySpelling, partyNames };
  return state.personFacets;
}

function electionKind(item) {
  if (item.kind === 'general' || item.kind === 'by-election') return item.kind;
  return /referendum/i.test(`${item.body || ''} ${item.title || ''}`) ? 'referendum' : 'other';
}

const REGISTER_INTEREST_SORT_OPTIONS = [
  { key: 'date', label: 'Date' },
  { key: 'memberName', label: 'Politician' },
  { key: 'electedBody', label: 'Body' },
  { key: 'constituency', label: 'Constituency' },
  { key: 'interestCount', label: 'Interests' },
  { key: 'sourceCount', label: 'Sources' }
];

// Body only, not Body, Member type and Chamber as well: every entry is an MLA of the Assembly
// or an MP of the Commons, so the three asked the same question three ways. An address that
// still carries f.memberType or f.chamber filters as before.
const REGISTER_INTEREST_FILTERS = [
  { key: 'electedBody', label: 'Body' },
  { key: 'constituency', label: 'Constituency' },
  { key: 'categories', label: 'Category' },
  { key: 'sourceKinds', label: 'Source kind' },
  { key: 'nilStatus', label: 'Interest status' }
];

const GRAPH_STATEMENT_PROPERTY_ORDER = [
  'cg:property:name',
  'cg:property:date',
  'cg:property:year',
  'cg:property:instance-of',
  'cg:property:register-record',
  'cg:property:declared-interest',
  'cg:property:has-candidature',
  'cg:property:stood-in-election',
  'cg:property:has-contest',
  'cg:property:contest-in-election',
  'cg:property:contest',
  'cg:property:candidate',
  'cg:property:member-of-political-party',
  'cg:property:appeared-in-election',
  'cg:property:elected-body',
  'cg:property:political-office',
  'cg:property:constituency',
  'cg:property:source'
];

// Properties pinned into the header as "at a glance" facts, in display order.
// Deliberately the concise, identifying statements — not the bulky relational
// lists (candidatures, register records) that belong in the statement body.
// Not "instance of": the kicker above the title already says what the record is, and as the
// first header row ("Instance of: Person") it pushed the useful facts down.
const GRAPH_HEADER_PINNED_PROPERTIES = [
  'cg:property:political-office',
  'cg:property:member-of-political-party',
  'cg:property:elected-body',
  'cg:property:constituency',
  'cg:property:date'
];

// Statement properties that are maintenance/system wiring rather than facts a
// lay reader needs up front (URLs, file-format records). They render inside a
// collapsed sub-section of the Semantic statements panel.
const GRAPH_TECHNICAL_PROPERTIES = new Set([
  'cg:property:interactive-url',
  'cg:property:browse-url',
  'cg:property:source-file',
  'cg:property:download'
]);

const TECHNICAL_FIELD_KEYS = new Set([
  'anchorUrl',
  'bbox',
  'bounds',
  'browseUrl',
  'chunkIndexUrl',
  'cloneOf',
  'derivedFrom',
  'detailUrl',
  'featureIndexUrl',
  'id',
  'interactiveUrl',
  'key',
  'labelProperty',
  'layerId',
  'loadable',
  'mapId',
  'parentCardId',
  'pmtilesUrl',
  'publicWhipId',
  'rawMetadata',
  'resultUrl',
  'slug',
  'sourceMapId',
  'sourceMapUrl',
  'sourceRecordId',
  'sourceUrl',
  'spatialIndexUrl',
  'thumbnail',
  'tileUrl',
  'tilesUrl',
  'type'
]);

const PUBLIC_METADATA_KEYS = new Set([
  'body',
  'canonicalName',
  'category',
  'categories',
  'categoryCount',
  'constituencies',
  'date',
  'dateEnd',
  'dateStart',
  'description',
  'downloads',
  'chamber',
  'constituency',
  'constituencies',
  'electedBody',
  'elections',
  'featured',
  'geography',
  'group',
  'keywords',
  'interestCount',
  'interests',
  'memberName',
  'memberType',
  'nonNilInterestCount',
  'name',
  'observedNames',
  'parentCard',
  'partySummary',
  'provider',
  'references',
  'relatedElections',
  'sampleFeatures',
  'interestSummary',
  'interestText',
  'isNone',
  'hasNilInterests',
  'jurisdiction',
  'sourceFiles',
  'sourceCount',
  'sourceKinds',
  'sourceRefs',
  'sourceKind',
  'sourceTitle',
  'sourceTitles',
  'status',
  'subtitle',
  'title',
  'totals',
  'url',
  'variants',
  'years'
]);

// Per-map feature attribute pages live on R2 (data.civgraph.net), sharded into
// pages and fetched lazily by the map detail page only — never by the homepage.
const MAP_FEATURES_BASE = 'https://data.civgraph.net/data/browse/map-features';

// T2-09: section listings were capped at a hard 500 with a "narrow the search"
// notice and no way to page past it, so records 501+ of a section were reachable
// only by guessing a narrower query. 200 per page keeps the initial render cheap
// (these listings run to thousands of cards) and the button appends rather than
// replacing, so scroll position survives.
const LIST_PAGE_SIZE = 200;

const state = {
  manifest: null,
  isHome: true,
  activeType: 'maps',
  activeId: null,
  query: '',
  indexes: new Map(),
  details: new Map(),
  featureTables: {},
  // T2-09: how many cards of the current listing are shown. Reset on every
  // navigation and every query change, so a filter never inherits a page depth
  // from the previous view.
  listShown: LIST_PAGE_SIZE,
  // Pages accumulated from D1 for the current listing, and the facet options for each
  // type. serverList is replaced (not appended) whenever the query, sort or filters
  // change, because the earlier pages no longer describe the same result set.
  serverList: { type: null, items: [], total: 0 },
  serverFacets: new Map(),
  // Catalogue facets, in the shape the /_api/sources filters already accept. Empty string
  // means "All", which is also what the endpoint treats as absent.
  sourceFilters: { provider: '', category: '', publicationStatus: '', license: '' },
  // Filters of the lists read from a static index (LIST_FILTERS), per type: { body: 'Dáil Éireann' }.
  listFilters: {},
  // Parties: whether the one-off ballot-paper labels are listed (?labels=1).
  showBallotLabels: false,
  // Sort order of the People and Parties lists (LIST_SORTS key; '' is the list's own order).
  listSort: {},
  personFacets: null,
  graph: {
    manifest: null,
    browseMapping: null,
    entityIndex: null,
    entitySummaryShards: new Map(),
    entitySearch: null,
    subjectMap: null,
    subjectShards: new Map(),
    reverseEntityMap: null,
    reverseEntityShards: new Map(),
    sourceStatementMap: null,
    sourceStatementShards: new Map()
  },
  selectedFeatureMap: null,
  loadedFeatureMap: null,
  auth: null,
  currentDetail: null,
  modalMode: null,
  registerInterestControls: {
    sortKey: 'date',
    sortDir: 'desc',
    filters: {}
  }
};

const els = {
  announcer: document.getElementById('announcer'),
  groups: document.getElementById('browseGroups'),
  search: document.getElementById('browseSearch'),
  hero: document.getElementById('browseHero'),
  results: document.getElementById('browseResults'),
  contributorPanel: document.getElementById('contributorPanel'),
  contributorModal: document.getElementById('contributorModal'),
  contributorForm: document.getElementById('contributorForm'),
  contributorModalTitle: document.getElementById('contributorModalTitle'),
  contributorEditor: document.getElementById('contributorEditor'),
  contributorEditorTitle: document.getElementById('contributorEditorTitle'),
  contributorEditorSlot: document.getElementById('contributorEditorSlot')
};

init().catch((error) => {
  console.error(error);
  els.results.innerHTML = `<div class="browse-empty">Browse data could not be loaded: ${escapeHtml(error.message)}</div>`;
});

async function init() {
  state.manifest = await loadJson(`${DATA_ROOT}/index.json`);
  bindEvents();
  renderContributorPanel();
  renderGroups();
  applyRoute();
  // Who is signed in is asked after the page has rendered, not before: the two requests took
  // about 340 ms on every first load. A contributor's record page is drawn again with their
  // tools once the answer arrives.
  refreshAuth().then(() => {
    if (state.auth?.allowed && state.currentDetail) renderCurrent();
  });
  window.addEventListener('hashchange', applyRoute);
  // Back from /browse/#/... to a path-style record page changes the path, not only the hash,
  // and browsers do not reliably fire hashchange for that; popstate always fires. applyRoute
  // ignores a repeat of the address it last rendered, so the two events never render twice.
  window.addEventListener('popstate', () => {
    if (pathRouteParts()) applyRoute();
  });
}

let lastRoutedAddress = null;

// Every navigation, search or filter change starts a new render. A render that finishes after
// a newer one has started must not write: a slow record opened just before the reader moved
// on used to land on top of the new view (the address said Elections, the page showed a map).
// Each async render takes the counter on entry and returns after any await if it has moved.
let renderSeq = 0;

function bindEvents() {
  // A quarter-second pause before searching, as the PRONI box already did: each key used to
  // send its own /_api request (seven for "Paisley") or re-render 200 cards.
  let searchTimer = null;
  els.search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value.trim();
      // On the PRONI page the sidebar box searches PRONI, the only search that page has; it
      // used to re-render the page and move the cursor into the PRONI box after one letter.
      if (!state.isHome && state.activeType === 'proni' && !state.activeId) {
        const box = document.getElementById('proni-search-input');
        if (box) box.value = state.query;
        scheduleProniSearch(state.query);
        return;
      }
      state.listShown = LIST_PAGE_SIZE;   // T2-09: a new query starts at page one
      syncListAddress();
      renderCurrent();
    }, 250);
  });

  // Where the reader had scrolled to, per address, so Back returns them to the same card. Not
  // while a navigation is rendering: the page shrinks to "Loading" and the clamped position
  // would overwrite the one being restored.
  let scrollPending = false;
  window.addEventListener('scroll', () => {
    if (scrollPending || state.routing) return;
    scrollPending = true;
    setTimeout(() => {
      scrollPending = false;
      if (state.routing) return;
      try { sessionStorage.setItem(`browse-scroll:${currentAddress()}`, String(Math.round(window.scrollY))); } catch { /* storage blocked */ }
    }, 150);
  }, { passive: true });

  document.addEventListener('click', (event) => {
    const portalJump = event.target.closest('[data-portal-jump]');
    if (portalJump) {
      event.preventDefault();
      const target = document.querySelector(portalJump.getAttribute('href'));
      target?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }

    // Append the next page from D1. Separate from the in-memory path below because it
    // fetches rather than slicing an array that is already present.
    const serverMore = event.target.closest('[data-server-load-more]');
    if (serverMore) {
      event.preventDefault();
      serverMore.disabled = true;
      serverMore.textContent = 'Loading...';
      const before = cardCount();
      state.listShown += LIST_PAGE_SIZE;
      syncListAddress();
      renderServerList(state.serverList.type || state.activeType, { append: true }).then(() => focusCard(before));
      return;
    }

    // T2-09: append the next page of a section listing.
    const listMore = event.target.closest('[data-list-load-more]');
    if (listMore) {
      event.preventDefault();
      const before = cardCount();
      state.listShown += LIST_PAGE_SIZE;
      syncListAddress();
      // Re-render through the closure the listing registered, so this works for
      // every listing type without a switch on state.activeType.
      Promise.resolve(state.lastListRender?.()).then(() => focusCard(before));
      return;
    }

    const loadMore = event.target.closest('[data-feature-load-more]');
    if (loadMore) {
      event.preventDefault();
      handleFeatureLoadMore(loadMore);
      return;
    }

    const descToggle = event.target.closest('[data-proni-desc-toggle]');
    if (descToggle) {
      event.preventDefault();
      const section = descToggle.closest('[data-proni-desc]');
      if (section) {
        const expanded = section.getAttribute('data-expanded') === 'true';
        section.setAttribute('data-expanded', String(!expanded));
        descToggle.setAttribute('aria-expanded', String(!expanded));
        descToggle.textContent = expanded ? 'Show more' : 'Show less';
      }
      return;
    }

    const link = event.target.closest('[data-browse-link]');
    if (link) {
      event.preventDefault();
      location.hash = link.getAttribute('href').replace(/^.*#/, '#');
      return;
    }

    const registerSort = event.target.closest('[data-register-sort]');
    if (registerSort) {
      event.preventDefault();
      state.registerInterestControls.sortKey = registerSort.dataset.registerSort || 'date';
      rerenderList();
      return;
    }

    const registerDirection = event.target.closest('[data-register-direction]');
    if (registerDirection) {
      event.preventDefault();
      state.registerInterestControls.sortDir = registerDirection.dataset.registerDirection === 'asc' ? 'asc' : 'desc';
      rerenderList();
      return;
    }

    const clearRegisterFilters = event.target.closest('[data-register-clear-filters]');
    if (clearRegisterFilters) {
      event.preventDefault();
      state.registerInterestControls.filters = {};
      rerenderList();
      return;
    }

    const clearSourceFilters = event.target.closest('[data-source-clear-filters]');
    if (clearSourceFilters) {
      event.preventDefault();
      for (const key of Object.keys(state.sourceFilters)) state.sourceFilters[key] = '';
      rerenderList();
      return;
    }

    const clearListFilters = event.target.closest('[data-list-clear-filters]');
    if (clearListFilters) {
      event.preventDefault();
      state.listFilters[state.activeType] = {};
      rerenderList();
      return;
    }

    const ballotLabels = event.target.closest('[data-ballot-labels]');
    if (ballotLabels) {
      event.preventDefault();
      state.showBallotLabels = !state.showBallotLabels;
      rerenderList();
      return;
    }

    const login = event.target.closest('[data-contributor-login]');
    if (login) {
      // The address may have changed since the link was drawn.
      login.setAttribute('href', contributorLoginUrl());
      return;
    }

    const contributorAction = event.target.closest('[data-contributor-action]');
    if (contributorAction) {
      event.preventDefault();
      handleContributorAction(contributorAction.dataset.contributorAction);
      return;
    }

    if (event.target.closest('[data-contributor-close]')) {
      if (els.contributorEditor && !els.contributorEditor.hidden) {
        closeInlineEditor();
        return;
      }
      closeContributorModal();
    }
  });

  document.addEventListener('change', (event) => {
    const sourceFilter = event.target.closest('[data-source-filter]');
    if (sourceFilter) {
      const key = sourceFilter.dataset.sourceFilter;
      // Changing a facet invalidates the accumulated pages, so renderCurrent() re-requests
      // from offset 0 rather than appending to a list built under the old filter.
      if (key && key in state.sourceFilters) state.sourceFilters[key] = sourceFilter.value || '';
      rerenderList();
      return;
    }

    const listSort = event.target.closest('[data-list-sort]');
    if (listSort) {
      state.listSort[state.activeType] = listSort.value || '';
      rerenderList();
      return;
    }

    const listFilter = event.target.closest('[data-list-filter]');
    if (listFilter) {
      const key = listFilter.dataset.listFilter;
      const filters = { ...(state.listFilters[state.activeType] || {}) };
      if (listFilter.value) filters[key] = listFilter.value;
      else delete filters[key];
      state.listFilters[state.activeType] = filters;
      rerenderList();
      return;
    }

    const filter = event.target.closest('[data-register-filter]');
    if (!filter) return;
    const key = filter.dataset.registerFilter;
    if (!key) return;
    const value = filter.value || '';
    if (value) {
      state.registerInterestControls.filters[key] = value;
    } else {
      delete state.registerInterestControls.filters[key];
    }
    rerenderList();
  });

  els.contributorForm?.addEventListener('submit', submitContributorForm);
  // Bound once, here, for the lifetime of the page. See bindObjectArrayControls.
  if (els.contributorForm) bindObjectArrayControls();
}

function applyRoute() {
  // Leaving a path-style record page through an in-app #/ link: show the address as the
  // ordinary /browse/#/... one, so it does not read as the record it left. Same document, no
  // reload; Back still returns to the record, whose path then routes again.
  if (pathRouteParts() && /^#\//.test(location.hash)) {
    history.replaceState(history.state, '', `/browse/${location.hash}`);
  }
  const address = currentAddress();
  if (address === lastRoutedAddress) return;
  const firstRoute = lastRoutedAddress === null;
  lastRoutedAddress = address;
  const route = parseRoute();
  state.isHome = route.isHome;
  state.activeType = route.type;
  state.activeId = route.id;
  state.selectedFeatureMap = route.params.get('map');
  state.routeParams = route.params;
  if (route.params.has('q')) {
    state.query = route.params.get('q').trim();
    if (els.search) els.search.value = state.query;
  }
  // A list's depth, sort and filters come from its address, so Back, a reload or a shared
  // link shows the same list (T2-09: without a depth in the address, page one).
  state.listShown = Math.max(LIST_PAGE_SIZE, Math.min(5000, Number(route.params.get('shown')) || LIST_PAGE_SIZE));
  if (!route.id) readListControls(route.type, route.params);
  renderGroups();
  state.routing = true;
  renderCurrent().then(
    () => afterRouteRender(address, { firstRoute, isList: !route.id && !route.isHome }),
    (error) => { state.routing = false; console.error(error); }
  );
}

function currentAddress() {
  return `${location.pathname}${location.search}${location.hash}`;
}

/** Sort and filters of the two server-side lists, from ?sort, ?dir and ?f.<facet> in the address. */
function readListControls(type, params) {
  if (LIST_FILTERS[type]) {
    const filters = {};
    for (const filter of LIST_FILTERS[type]) {
      const value = params.get(`f.${filter.key}`);
      if (value) filters[filter.key] = value;
    }
    state.listFilters[type] = filters;
  }
  if (type === 'parties') state.showBallotLabels = params.get('labels') === '1';
  if (LIST_SORTS[type]) {
    const sort = params.get('sort') || '';
    state.listSort[type] = LIST_SORTS[type].some((option) => option.key === sort) ? sort : '';
  }
  if (type === 'sources') {
    state.sourceFilters = Object.fromEntries(Object.keys(state.sourceFilters).map((key) => [key, params.get(`f.${key}`) || '']));
  }
  if (type === 'register-interests') {
    const filters = {};
    for (const [key, value] of params) if (key.startsWith('f.') && value) filters[key.slice(2)] = value;
    state.registerInterestControls = {
      ...state.registerInterestControls,
      sortKey: params.get('sort') || 'date',
      sortDir: params.get('dir') === 'asc' ? 'asc' : 'desc',
      filters
    };
  }
}

/**
 * Write the current list's search, depth, sort and filters into the address without a new
 * history entry, so the list can be bookmarked, shared, reloaded or returned to with Back.
 */
function syncListAddress() {
  if (state.isHome || state.activeId || pathRouteParts() || !ENTITY_CONFIG[state.activeType]) return;
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.listShown > LIST_PAGE_SIZE) params.set('shown', String(state.listShown));
  if (state.activeType === 'sources') {
    for (const [key, value] of Object.entries(state.sourceFilters)) if (value) params.set(`f.${key}`, value);
  }
  for (const [key, value] of Object.entries(state.listFilters[state.activeType] || {})) if (value) params.set(`f.${key}`, value);
  if (state.activeType === 'parties' && state.showBallotLabels) params.set('labels', '1');
  if (LIST_SORTS[state.activeType] && state.listSort[state.activeType]) params.set('sort', state.listSort[state.activeType]);
  if (state.activeType === 'register-interests') {
    const controls = state.registerInterestControls;
    if (controls.sortKey && controls.sortKey !== 'date') params.set('sort', controls.sortKey);
    if (controls.sortDir === 'asc') params.set('dir', 'asc');
    for (const [key, value] of Object.entries(controls.filters)) if (value) params.set(`f.${key}`, value);
  }
  const query = params.toString();
  const hash = `#/${state.activeType}${query ? `?${query}` : ''}`;
  if (location.hash === hash) return;
  history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  lastRoutedAddress = currentAddress();
}

/**
 * After a navigation: a list returns to where the reader left it; anything else starts at the
 * top with focus on its heading, so keyboard and screen-reader users land on the new page
 * rather than on <body> half-way down the old one. The first page load leaves focus alone.
 */
function afterRouteRender(address, { firstRoute, isList }) {
  if (address !== lastRoutedAddress && address !== currentAddress()) return;
  state.routing = false;
  let saved = null;
  try { saved = sessionStorage.getItem(`browse-scroll:${currentAddress()}`); } catch { /* storage blocked */ }
  window.scrollTo(0, isList && saved !== null ? Number(saved) || 0 : 0);
  if (firstRoute) return;
  const heading = els.hero.querySelector('h1') || els.results.querySelector('h1, h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

/** Re-render a list after a filter or sort change: page one, address updated, focus kept. */
async function rerenderList() {
  state.listShown = LIST_PAGE_SIZE;
  syncListAddress();
  const key = focusKeyFor(document.activeElement);
  await renderCurrent();
  const target = key ? document.querySelector(key) : null;
  (target || els.results.querySelector('select, button'))?.focus({ preventScroll: true });
}

function focusKeyFor(element) {
  for (const attr of ['data-source-filter', 'data-register-filter', 'data-register-sort', 'data-register-direction', 'data-list-filter', 'data-list-sort', 'data-ballot-labels']) {
    if (element?.hasAttribute?.(attr)) return `[${attr}="${CSS.escape(element.getAttribute(attr))}"]`;
  }
  return null;
}

function cardCount() {
  return els.results.querySelectorAll('.browse-card').length;
}

/** After "Show more", move focus to the first card that was added. */
function focusCard(index) {
  const card = els.results.querySelectorAll('.browse-card')[index];
  card?.querySelector('a, button')?.focus({ preventScroll: true });
}

// Path-style record URLs: /browse/<type>/<slug>, served by functions/browse/<type>/ with the
// record's own title and canonical link so search engines can index each record (a hash is
// never sent to the server). Inside the app, links stay in the hash.
const PATH_ROUTE_TYPES = new Set(['elections', 'maps', 'parties', 'persons', 'register-interests', 'sources']);

function pathRouteParts() {
  const match = /^\/browse\/([^/]+)\/(.+?)\/?$/.exec(location.pathname);
  if (!match || !PATH_ROUTE_TYPES.has(match[1])) return null;
  try {
    return [match[1], decodeURIComponent(match[2])];
  } catch {
    return [match[1], match[2]];
  }
}

function parseRoute() {
  const pathParts = pathRouteParts();
  // On a path-style page the path is the route until an in-app link sets a #/ hash; a plain
  // fragment such as the skip link's #main-content is not a route there.
  const useHash = !pathParts || /^#\//.test(location.hash);
  const rawHash = useHash ? location.hash.replace(/^#\/?/, '') : '';
  // A list keeps its search, depth, sort and filters after a ? inside the hash (syncListAddress).
  const [hashPath, hashQuery = ''] = rawHash.split('?');
  const hash = decodeURIComponent(hashPath);
  const parts = useHash ? hash.split('/').filter(Boolean) : pathParts;
  const params = new URLSearchParams(location.search);
  for (const [key, value] of new URLSearchParams(hashQuery)) params.set(key, value);
  // The fallback type is the first one this section owns, not always 'maps' -- on
  // /catalogue/ that would land the reader in a section the page does not show.
  const fallback = sectionTypes()[0] || 'maps';
  const hasExplicitType = params.has('type') || parts.length > 0;
  if (!hasExplicitType) {
    return { isHome: true, type: fallback, id: null, params };
  }
  let type = params.get('type') || parts[0] || fallback;
  let id = params.get('id') || parts[1] || null;
  if (type === 'people') type = 'persons';
  if (type === 'entities') return { isHome: false, type, id, params };
  // A deep link to the other layer still resolves rather than 404ing, so shared URLs keep
  // working; only the directory and the default view are scoped.
  if (!ENTITY_CONFIG[type]) type = fallback;
  return { isHome: false, type, id, params };
}

function renderGroups() {
  const counts = state.manifest?.counts || {};
  els.groups.innerHTML = (state.manifest?.groups || []).filter((group) => inSection(group.id)).map((group) => {
    const count = countForGroup(group.id, counts);
    const active = !state.isHome && group.id === state.activeType ? ' browse-group-link--active' : '';
    return `
      <a href="#/${group.id}" class="browse-group-link${active}" data-browse-link>
        <span class="browse-group-link__name">${escapeHtml(group.label)}</span>
        <span class="browse-count">${formatNumber(count)}</span>
        <span class="browse-group-link__description">${escapeHtml(group.description || '')}</span>
      </a>
    `;
  }).join('');
  // On a phone the sections are one scrolling row: bring the current one into view.
  const active = els.groups.querySelector('.browse-group-link--active');
  if (active && els.groups.scrollWidth > els.groups.clientWidth) els.groups.scrollLeft = Math.max(0, active.offsetLeft - 16);
}

function countForGroup(id, counts) {
  if (id === 'features') return counts.featureGroups || counts.features || 0;
  return counts[id] || 0;
}

async function renderCurrent() {
  const token = ++renderSeq;
  // T2-09: the depth of a listing (state.listShown) is set by applyRoute from the address and
  // reset to page one by every search, filter or sort change, not here: a re-render from
  // Back must keep the depth the reader had reached.
  state.lastListRender = null;
  if (state.isHome) {
    state.currentDetail = null;
    setPortalHero();
    renderPortalLanding();
    return;
  }
  if (state.activeType === 'entities') {
    await renderEntityRoute(state.activeId);
    return;
  }
  if (state.activeType === 'proni') {
    await renderProniRoute(state.activeId);
    return;
  }
  const config = ENTITY_CONFIG[state.activeType];
  state.currentDetail = null;
  setHero(config, null);
  els.results.innerHTML = '<div class="browse-loading">Loading browse data...</div>';

  // A DEEP LINK TO ONE RECORD SHOULD NOT COST THE WHOLE INDEX.
  //
  // findItem() searches an in-memory list, so opening #/sources/<slug> used to require
  // loadIndex() first -- 51 MB across nine shards to read one record. persons and
  // register-interests had the same shape for the same reason: each was sharded only
  // because a single file breached Cloudflare Pages' 25 MB per-file limit.
  //
  // Those three now live in D1, so ask for the one record. Falls through to the index if
  // the endpoint is unavailable, so a Functions outage degrades rather than breaks -- and
  // the fallback is deliberately second, because it is the slow path.
  if (state.activeId && D1_INDEXES.has(state.activeType)) {
    const item = await fetchIndexRecord(state.activeType, state.activeId);
    if (token !== renderSeq) return;
    // A stale or mistyped link used to fall through to the whole list (24,772 people) with no
    // word that the record was missing.
    if (item === RECORD_NOT_FOUND) {
      renderNotFound(config, state.activeId);
      return;
    }
    if (item) {
      // Reached by an old address (a source merged into another): the address becomes the
      // record's own, so a copied link is the current one.
      if (item.slug && item.slug !== state.activeId && normalizeArray(item.previousSlugs).includes(state.activeId)) {
        state.activeId = item.slug;
        history.replaceState(history.state, '', `${location.pathname}${location.search}#/${state.activeType}/${encodeURIComponent(item.slug)}`);
        lastRoutedAddress = currentAddress();
      }
      await renderDetail(state.activeType, item);
      return;
    }
  }

  // LIST VIEW FROM D1 for the three large indexes. Everything below this point still
  // works from a loaded index, which is correct for the small ones: maps, elections,
  // parties and features are a reasonable download and the client filters them locally.
  if (D1_INDEXES.has(state.activeType)) {
    await renderServerList(state.activeType);
    return;
  }

  // An election or one constituency's result opens from its own file: elections.json (54 MB,
  // every contest) is only needed for the list.
  if (state.activeId && state.activeType === 'elections') {
    const record = await loadElectionRecord(state.activeId);
    if (token !== renderSeq) return;
    if (record) {
      await renderDetail('elections', record);
      return;
    }
  }

  // A list reads the list index where there is one (elections: 2.8 MB, not 54 MB).
  const data = await loadIndex(state.activeType, { list: !state.activeId });
  if (token !== renderSeq) return;
  if (state.activeType === 'features') {
    await renderFeatureGroups(data);
    return;
  }
  if (state.activeId) {
    const item = findItem(data.items || [], state.activeId);
    if (!item) {
      renderNotFound(config, state.activeId);
      return;
    }
    await renderDetail(state.activeType, item);
    return;
  }
  renderList(state.activeType, data.items || []);
}

/** A record that does not exist: say so, link back to its list, and offer a search for the slug. */
function renderNotFound(config, id) {
  const words = decodeURIComponent(String(id || '')).replace(/[-_]+/g, ' ').replace(/\b\d{3,}\b/g, '').replace(/\s+/g, ' ').trim();
  els.hero.innerHTML = `
    <p class="browse-kicker">${escapeHtml(sectionName())}</p>
    <h1 class="browse-title" tabindex="-1">${escapeHtml(config.singular)} not found</h1>
  `;
  els.results.innerHTML = `
    <div class="browse-empty">
      <p>No ${escapeHtml(config.singular.toLowerCase())} has the address “${escapeHtml(String(id || ''))}”. The link may be out of date.</p>
      <p><a href="#/${escapeAttr(state.activeType)}" data-browse-link>All ${escapeHtml(config.label.toLowerCase())}</a>${words ? ` · <a href="#/${escapeAttr(state.activeType)}?q=${encodeURIComponent(words)}" data-browse-link>Search for “${escapeHtml(words)}”</a>` : ''}</p>
    </div>`;
  setDocumentHead({ title: `${config.singular} not found – Civgraph` });
  announce(`${config.singular} not found.`);
}

function setPortalHero() {
  resetDocumentHead();
  const counts = state.manifest?.counts || {};
  const total = (counts.maps || 0)
    + (counts.elections || 0)
    + (counts.featureGroups || 0)
    + (counts.parties || 0)
    + (counts.persons || 0)
    + (counts['register-interests'] || 0)
    + (counts.sources || 0);
  const copy = SECTION_COPY[SECTION_LAYER] || {
    kicker: 'Browse',
    title: 'Civgraph data directory',
    description: 'A structured portal into maps, elections, boundary features, parties and labels, people, books, tables, downloads, and source records. Use the directory below to browse by subject, or search within a chosen section.'
  };
  // PRONI is deliberately absent from the unscoped totals: at 1.5m records it is larger
  // than everything else combined, so adding it to one "total" tells the reader nothing.
  // The source section counts it on its own tile instead.
  const stats = SECTION_LAYER === 'source'
    ? `${renderPortalStat('Sources', counts.sources)}
       ${renderPortalStat('PRONI records', counts.proni)}`
    : SECTION_LAYER === 'data'
      ? `${renderPortalStat('Maps', counts.maps)}
         ${renderPortalStat('Elections', counts.elections)}
         ${renderPortalStat('Feature groups', counts.featureGroups)}
         ${renderPortalStat('Parties / labels', counts.parties)}
         ${renderPortalStat('Persons', counts.persons)}
         ${renderPortalStat('Register interests', counts['register-interests'])}
         ${renderPortalStat('Total records', total - (counts.sources || 0))}`
      : `${renderPortalStat('Maps', counts.maps)}
         ${renderPortalStat('Elections', counts.elections)}
         ${renderPortalStat('Feature groups', counts.featureGroups)}
         ${renderPortalStat('Parties / labels', counts.parties)}
         ${renderPortalStat('Persons', counts.persons)}
         ${renderPortalStat('Register interests', counts['register-interests'])}
         ${renderPortalStat('Sources', counts.sources)}
         ${renderPortalStat('Total entries', total)}`;
  els.hero.innerHTML = `
    <p class="browse-kicker">${escapeHtml(copy.kicker)}</p>
    <h1 class="browse-title">${escapeHtml(copy.title)}</h1>
    <p class="browse-description">${escapeHtml(copy.description)}</p>
    <div class="browse-portal-stats" aria-label="Browse totals">
      ${stats}
    </div>
    ${renderSectionSwitch()}
  `;
}

// A reader who lands in one layer needs a way across to the other.
function renderSectionSwitch() {
  if (!SECTION_LAYER) return '';
  const to = SECTION_LAYER === 'source'
    ? { href: '/records/', label: 'Records', note: 'maps, elections, people and parties derived from these sources' }
    : { href: '/catalogue/', label: 'Catalogue', note: 'the original sources these records were derived from' };
  return `
    <p class="browse-section-switch">
      Looking for <a href="${to.href}">${escapeHtml(to.label)}</a>? &mdash; ${escapeHtml(to.note)}.
    </p>
  `;
}

function renderPortalLanding() {
  const query = state.query.trim();
  if (query) {
    els.results.innerHTML = `
      <section class="browse-portal-search-note">
        <h2>Choose a section to search</h2>
        <p>The Browse search is scoped to the active section so large indexes stay responsive. Select Maps, Elections, Features, Parties / Labels, Persons, Register Interests, or Sources, then search within that section.</p>
      </section>
      ${renderPortalSections()}
    `;
    return;
  }
  els.results.innerHTML = `
    <nav class="browse-portal-jump" aria-label="Browse directory sections">
      ${portalSections().map((section) => `<a href="#portal-${escapeAttr(section.id)}" data-portal-jump>${escapeHtml(section.title)}</a>`).join('')}
    </nav>
    ${renderPortalSections()}
  `;
}

function renderPortalSections() {
  return `
    <div class="browse-portal">
      ${portalSections().map(renderPortalSection).join('')}
    </div>
  `;
}

function portalSections() {
  return allPortalSections().filter((section) => inSection(section.id));
}

// Every link under a section filters or searches it. About a hundred of them used to point at
// the bare section ("Townlands", "2020s", "Seats won" all opened #/maps or #/elections), which
// looked like a filter and was not one; links that could not be made to filter are gone.
const portalLink = (type, params) => `#/${type}?${new URLSearchParams(params)}`;

function allPortalSections() {
  const counts = state.manifest?.counts || {};
  const elections = (params) => portalLink('elections', params);
  const maps = (params) => portalLink('maps', params);
  return [
    {
      id: 'maps',
      title: 'Maps',
      href: '#/maps',
      count: counts.maps,
      summary: 'Catalogue entries, map metadata, downloads, source credits, and interactive-map links.',
      columns: [
        { heading: 'Historic geographies', links: [['Townlands', maps({ 'f.category': 'Townlands' })], ['Civil parishes', maps({ q: 'civil parishes' })], ['Baronies', maps({ q: 'baronies' })], ['Counties', maps({ 'f.category': 'Counties' })], ['Historic boundaries', maps({ 'f.category': 'Historic Boundaries' })]] },
        { heading: 'Electoral boundaries', links: [['Dáil constituencies', maps({ 'f.category': 'Dáil Éireann Constituencies' })], ['Westminster constituencies', maps({ 'f.category': 'Parliamentary Constituencies' })], ['Stormont and Assembly', maps({ 'f.category': 'Devolved Constituencies' })], ['District electoral areas', maps({ 'f.category': 'District Electoral Areas' })]] },
        { heading: 'Reference and open data', links: [['Local government districts', maps({ 'f.category': 'Local Government Districts' })], ['Settlements', maps({ 'f.category': 'Settlements' })], ['Transport', maps({ 'f.category': 'Transport' })], ['Environment', maps({ 'f.category': 'Environment' })]] }
      ]
    },
    {
      id: 'elections',
      title: 'Elections',
      href: '#/elections',
      count: counts.elections,
      summary: 'Election entries by date, body, geography, result data, and links to open election layers.',
      columns: [
        { heading: 'By body', links: [['Dáil Éireann', elections({ 'f.body': 'Dáil Éireann' })], ['Westminster', elections({ 'f.body': 'House of Commons of the United Kingdom' })], ['Stormont', elections({ 'f.body': 'Parliament of Northern Ireland' })], ['NI Assembly', elections({ 'f.body': 'Northern Ireland Assembly' })], ['Referendums', elections({ 'f.kind': 'referendum' })]] },
        { heading: 'By decade', links: [['2020s', elections({ 'f.decade': '2020s' })], ['2010s', elections({ 'f.decade': '2010s' })], ['2000s', elections({ 'f.decade': '2000s' })], ['1990s', elections({ 'f.decade': '1990s' })], ['1920s', elections({ 'f.decade': '1920s' })]] },
        { heading: 'Election data', links: [['General elections', elections({ 'f.kind': 'general', 'f.results': 'elections' })], ['By-elections', elections({ 'f.kind': 'by-election', 'f.results': 'elections' })], ['Constituency results', elections({ 'f.results': 'results' })], ['Parties and labels', '#/parties'], ['Candidates and representatives', '#/persons']] }
      ]
    },
    {
      id: 'features',
      title: 'Features',
      href: '#/features',
      count: counts.featureGroups,
      summary: 'Boundary and geography feature groups, with feature records loaded lazily by source map.',
      columns: [
        { heading: 'Feature groups', links: [['Constituencies', portalLink('features', { q: 'constituencies' })], ['Wards', portalLink('features', { q: 'wards' })], ['Electoral divisions', portalLink('features', { q: 'electoral divisions' })], ['Civil parishes', portalLink('features', { q: 'civil parishes' })]] }
      ]
    },
    {
      id: 'parties',
      title: 'Parties / labels',
      href: '#/parties',
      count: counts.parties,
      summary: 'Political parties, tickets, labels, aliases, colours, and observed election appearances.',
      columns: [
        { heading: 'Party data', links: [['Parties', '#/parties'], ['Ballot-paper labels too', portalLink('parties', { labels: '1' })], ['Independents', portalLink('parties', { q: 'independent' })]] }
      ]
    },
    {
      id: 'persons',
      title: 'Persons',
      href: '#/persons',
      count: counts.persons,
      summary: 'Candidate and elected-person entries observed across the election data.',
      columns: [
        { heading: 'People', links: [['Search persons', '#/persons'], ['Party histories', '#/parties'], ['Register interests', '#/register-interests']] }
      ]
    },
    {
      id: 'register-interests',
      title: 'Register interests',
      href: '#/register-interests',
      count: counts['register-interests'],
      summary: 'MLA and Northern Ireland MP register of interests rows, linked to source editions, provider APIs, and filtered CSV extracts.',
      columns: [
        { heading: 'Bodies', links: [['NI Assembly MLAs', portalLink('register-interests', { 'f.electedBody': 'Assembly' })], ['NI Westminster MPs', portalLink('register-interests', { 'f.electedBody': 'House of Commons' })]] },
        { heading: 'Interest data', links: [['Employment and earnings', portalLink('register-interests', { q: 'employment' })], ['Donations and support', portalLink('register-interests', { q: 'donations' })], ['Gifts, visits and hospitality', portalLink('register-interests', { q: 'gifts' })]] }
      ]
    },
    {
      id: 'sources',
      title: 'Books / tables / sources',
      href: '#/sources',
      count: counts.sources,
      summary: 'Books, tables, datasets, map source files, downloads, references, and provider records.',
      columns: [
        { heading: 'Source types', links: [['Books', portalLink('sources', { 'f.category': 'Books' })], ['Tables', portalLink('sources', { 'f.category': 'Tables' })], ['Map sources', portalLink('sources', { 'f.category': 'Map sources' })], ['Election sources', portalLink('sources', { 'f.category': 'Election sources' })]] },
        { heading: 'Providers', links: [['OSNI', portalLink('sources', { q: 'osni' })], ['CSO', portalLink('sources', { q: 'cso' })], ['NISRA', portalLink('sources', { q: 'nisra' })], ['Open Data NI', portalLink('sources', { q: 'open data ni' })]] }
      ]
    },
    {
      id: 'proni',
      title: 'PRONI Records',
      href: '#/proni',
      count: counts.proni || 1538177,
      summary: 'Archival catalogue records from the PRONI eCatalogue (Public Record Office of Northern Ireland), browsable by their original hierarchy. Open Government Licence.',
      columns: [
        { heading: 'Browse the hierarchy', links: [['All fonds', '#/proni'], ['Boards of Guardians (BG)', '#/proni/BG']] }
      ]
    }
  ];
}

function renderPortalSection(section) {
  return `
    <section id="portal-${escapeAttr(section.id)}" class="browse-portal-section">
      <div class="browse-portal-section__header">
        <div>
          <h2><a href="${escapeAttr(section.href)}" data-browse-link>${escapeHtml(section.title)}</a></h2>
          <p>${escapeHtml(section.summary)}</p>
        </div>
        <a href="${escapeAttr(section.href)}" class="browse-portal-section__count" data-browse-link>${formatNumber(section.count || 0)}</a>
      </div>
      <div class="browse-portal-columns">
        ${section.columns.map((column) => `
          <div class="browse-portal-column">
            <h3>${escapeHtml(column.heading)}</h3>
            <ul>
              ${column.links.map(([label, href]) => `<li><a href="${escapeAttr(href)}" data-browse-link>${escapeHtml(label)}</a></li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderPortalStat(label, value) {
  return `
    <div class="browse-portal-stat">
      <strong>${formatNumber(value || 0)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function setHero(config, item) {
  const title = item ? readerTitle(state.activeType, item) : config.label;
  const description = item ? heroDescriptionForItem(state.activeType, item) : (state.manifest?.groups || []).find((group) => group.id === state.activeType)?.description || '';
  // The kicker names the record's kind on a record ("Person"), the section on a list
  // ("Records", "Catalogue"); it said "Browse" on every page of all three shells.
  els.hero.innerHTML = `
    <p class="browse-kicker">${escapeHtml(item ? config.singular : sectionName())}</p>
    <h1 class="browse-title">${escapeHtml(title)}</h1>
    ${description ? `<p class="browse-description">${escapeHtml(description)}</p>` : ''}
  `;
  if (item) {
    setDocumentHead({
      title: recordDocumentTitle(state.activeType, config, title),
      description: documentDescriptionForItem(state.activeType, item) || description,
      canonical: recordCanonicalUrl(state.activeType, item)
    });
  } else {
    setDocumentHead({
      title: `${config.label} – ${sectionName()} – Civgraph`,
      description: description || BASE_HEAD.description
    });
  }
}

// THE DOCUMENT HEAD FOLLOWS THE VIEW. Every Browse, Records and Catalogue view used to be
// titled "Browse - Civgraph" with the same description, so a bookmark, a tab and a search
// result could not tell Gerry Adams from the 2024 election. functions/_browse-page.js
// writes the same title, description and canonical into the HTML of the path-style URLs.
const SITE_ORIGIN = 'https://civgraph.net';
// The shell's own head, restored on the landing view. A path-style page arrives with the
// record's head already written in, so it uses the /browse/ shell's values instead.
const BASE_HEAD = pathRouteParts()
  ? {
    title: 'Browse – Civgraph',
    description: 'Browse Civgraph maps, elections, features, parties, persons, books, tables, and sources.',
    canonical: `${SITE_ORIGIN}/browse/`
  }
  : {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href')
      || `${SITE_ORIGIN}${SECTION_LAYER === 'source' ? '/catalogue/' : SECTION_LAYER === 'data' ? '/records/' : '/browse/'}`
  };

function sectionName() {
  if (SECTION_LAYER === 'source') return 'Catalogue';
  if (SECTION_LAYER === 'data') return 'Records';
  return 'Browse';
}

/** "Gerry Adams – Person – Civgraph"; an election's title already says what it is. */
function recordDocumentTitle(type, config, title) {
  if (type === 'elections' || !config?.singular) return `${title} – Civgraph`;
  return `${title} – ${config.singular} – Civgraph`;
}

function setDocumentHead({ title, description, canonical } = {}) {
  document.title = title || BASE_HEAD.title;
  const text = truncateDescription(description || BASE_HEAD.description);
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', text);
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', canonical || BASE_HEAD.canonical);
}

function resetDocumentHead() {
  setDocumentHead({});
}

function truncateDescription(value, limit = 300) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

// Records with a path-style page canonicalise there, whichever shell (/browse/, /records/,
// /catalogue/) and whichever id they were opened by, so each is indexed once.
function recordCanonicalUrl(type, item) {
  if (!PATH_ROUTE_TYPES.has(type)) return BASE_HEAD.canonical;
  const slug = item.slug || slugify(item.id || item.key || item.title);
  return `${SITE_ORIGIN}/browse/${type}/${encodeURIComponent(slug)}`;
}

function documentDescriptionForItem(type, item) {
  if (type === 'persons') {
    const name = item.name || item.title;
    const parties = joinList(normalizeArray(item.parties).slice(0, 3).map((party) => party.name));
    const stood = Number(item.totals?.stood) || normalizeArray(item.elections).length;
    const elected = Number(item.totals?.elected) || normalizeArray(item.elections).filter((row) => row.elected).length;
    const places = joinList(normalizeArray(item.constituencies).slice(0, 4).map((place) => place.name));
    let sentence = `${name}${parties ? ` (${parties})` : ''}`;
    if (stood) {
      sentence += ` stood in ${formatNumber(stood)} ${stood === 1 ? 'election' : 'elections'}`;
      if (places) sentence += ` in ${places}`;
      if (elected) sentence += `, elected ${formatNumber(elected)} ${elected === 1 ? 'time' : 'times'}`;
    }
    return `${sentence}. Election results, parties and sources on Civgraph.`;
  }
  return heroDescriptionForItem(type, item) || readerSummaryText(type, item) || `${item.title} on Civgraph.`;
}

function heroDescriptionForItem(type, item) {
  if (type === 'register-interests') {
    const parts = [
      item.memberName,
      item.electedBody,
      formatDate(item.date),
      item.interestCount ? `${formatNumber(item.interestCount)} grouped ${item.interestCount === 1 ? 'interest' : 'interests'}` : null,
      item.nonNilInterestCount !== undefined ? `${formatNumber(item.nonNilInterestCount)} non-nil` : null
    ].filter(Boolean);
    return parts.join(' / ');
  }
  return item.description || item.subtitle || '';
}

function renderList(type, items) {
  if (type === 'register-interests') {
    renderRegisterInterestList(items);
    return;
  }
  const config = ENTITY_CONFIG[type];
  let filtered = sortListItems(type, filterItems(applyListFilters(type, items), state.query));
  // Parties: the ballot-paper labels (a spelling seen on a few ballot papers, in no election's
  // party table) wait behind a button, so the parties are not lost among them.
  let labelsNote = '';
  if (type === 'parties') {
    const labels = filtered.filter((item) => item.ballotLabel).length;
    if (!state.showBallotLabels) filtered = filtered.filter((item) => !item.ballotLabel);
    else filtered = [...filtered.filter((item) => !item.ballotLabel), ...filtered.filter((item) => item.ballotLabel)];
    if (labels) {
      labelsNote = `
        <p class="browse-description browse-labels-note">
          ${state.showBallotLabels
            ? `Including ${formatNumber(labels)} ballot-paper ${labels === 1 ? 'label' : 'labels'}, listed last.`
            : `${formatNumber(labels)} ballot-paper ${labels === 1 ? 'label' : 'labels'} ${state.query ? 'also match' : 'are not listed'}: party names as printed on a few ballot papers that are in no election's party table.`}
          <button type="button" class="browse-btn browse-btn--small" data-ballot-labels aria-pressed="${state.showBallotLabels}">${state.showBallotLabels ? 'Hide' : 'Show'} ballot-paper labels</button>
        </p>`;
    }
  }
  els.results.innerHTML = `
    ${renderListFilterControls(type, items, type === 'persons' ? state.personFacets?.facets : null)}
    ${renderFilterSummary(filtered.length, items.length)}
    ${labelsNote}
    ${renderListPage(filtered, (item) => renderCard(type, item, config))}
  `;
  state.lastListRender = () => renderList(type, items);
  announceList(config, filtered.length);
}

function applyListFilters(type, items) {
  const filters = Object.entries(state.listFilters[type] || {}).filter(([, value]) => value);
  if (!filters.length || !LIST_FILTERS[type]) return items;
  const defs = new Map(LIST_FILTERS[type].map((filter) => [filter.key, filter]));
  return items.filter((item) => filters.every(([key, value]) => !defs.has(key) || filterValues(defs.get(key), item).includes(value)));
}

function filterValues(filter, item) {
  return (filter.values ? filter.values(item) : [filter.value(item)])
    .filter((value) => value !== null && value !== undefined && value !== '').map(String);
}

/**
 * The filter bar of a static list: one select per LIST_FILTERS entry, options from every
 * record -- or, for a list paged from the server (People), from its precomputed `facets`
 * ({ key: [{ value, label?, count }] }). A sort select where the list has LIST_SORTS.
 */
function renderListFilterControls(type, items, facets = null) {
  const defs = LIST_FILTERS[type];
  if (!defs) return '';
  const current = state.listFilters[type] || {};
  const active = Object.values(current).filter(Boolean).length;
  const selects = defs.map((filter) => {
    const counts = new Map();
    const labels = new Map();
    if (facets) {
      for (const option of facets[filter.key] || []) {
        counts.set(String(option.value), option.count);
        if (option.label) labels.set(String(option.value), option.label);
      }
    } else {
      for (const item of items || []) {
        for (const value of filterValues(filter, item)) counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    const labelOf = (option) => labels.get(option) || (filter.optionLabel ? filter.optionLabel(option) : option);
    const options = [...counts.keys()].sort((a, b) => (filter.order === 'desc' ? b.localeCompare(a) : labelOf(a).localeCompare(labelOf(b))));
    if (options.length < 2) return '';
    const value = current[filter.key] || '';
    return `
      <label class="browse-filter">
        <span>${escapeHtml(filter.label)}</span>
        <select data-list-filter="${escapeAttr(filter.key)}">
          <option value="">${escapeHtml(filter.allLabel || 'All')}</option>
          ${options.map((option) => `<option value="${escapeAttr(option)}"${option === value ? ' selected' : ''}>${escapeHtml(labelOf(option))} (${formatNumber(counts.get(option))})</option>`).join('')}
        </select>
      </label>
    `;
  }).join('');
  const sorts = LIST_SORTS[type];
  const sortKey = listSortOption(type)?.key || '';
  const sortSelect = sorts ? `
      <label class="browse-filter">
        <span>Sort by</span>
        <select data-list-sort>
          ${sorts.map((option) => `<option value="${escapeAttr(option.key)}"${option.key === sortKey ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
      </label>` : '';
  if (!selects && !sortSelect) return '';
  return `
    <section class="browse-controls" aria-label="${escapeAttr(ENTITY_CONFIG[type].label)} filters">
      <div class="browse-filter-grid">${selects}${sortSelect}</div>
      ${active ? `<div class="browse-control-footer"><span>${active} active ${active === 1 ? 'filter' : 'filters'}.</span><button type="button" class="browse-btn" data-list-clear-filters>Clear filters</button></div>` : ''}
    </section>
  `;
}

/**
 * Say what a list now holds through the polite announcer, once per change of list, search or
 * count: #browseResults is no longer a live region (a whole page of cards read out on every
 * view), so this is how a screen-reader user hears that a search did something.
 */
function announceList(config, count) {
  const key = `${config.label}|${state.query}|${JSON.stringify(state.listFilters[state.activeType] || {})}|${count}`;
  if (state.lastListAnnouncement === key) return;
  state.lastListAnnouncement = key;
  announce(`${config.label}: ${formatNumber(count)} ${count === 1 ? 'record' : 'records'}${state.query ? ` matching ${state.query}` : ''}.`);
}

function renderRegisterInterestList(items) {
  const textFiltered = filterItems(items, state.query);
  const filtered = applyRegisterInterestFilters(textFiltered);
  const sorted = sortRegisterInterestItems(filtered);
  const config = ENTITY_CONFIG['register-interests'];
  els.results.innerHTML = `
    ${renderRegisterInterestControls(items, sorted.length, items.length)}
    ${renderFilterSummary(sorted.length, items.length)}
    ${renderListPage(sorted, (item) => renderCard('register-interests', item, config))}
  `;
  state.lastListRender = () => renderRegisterInterestList(items);
}

function renderRegisterInterestControls(items, filteredCount, totalCount, facets = null) {
  const controls = state.registerInterestControls;
  const activeFilters = Object.values(controls.filters || {}).filter(Boolean).length;
  return `
    <section class="browse-controls" aria-label="Register interest sorting and filters">
      <div class="browse-control-group">
        <span class="browse-control-label">Sort by</span>
        <div class="browse-segmented" role="group" aria-label="Sort attribute">
          ${REGISTER_INTEREST_SORT_OPTIONS.map((option) => `
            <button type="button" class="browse-control-btn${controls.sortKey === option.key ? ' browse-control-btn--active' : ''}" data-register-sort="${escapeAttr(option.key)}" aria-pressed="${controls.sortKey === option.key}">${escapeHtml(option.label)}</button>
          `).join('')}
        </div>
      </div>
      <div class="browse-control-group">
        <span class="browse-control-label">Order</span>
        <div class="browse-segmented" role="group" aria-label="Sort direction">
          <button type="button" class="browse-control-btn${controls.sortDir === 'desc' ? ' browse-control-btn--active' : ''}" data-register-direction="desc" aria-pressed="${controls.sortDir === 'desc'}">Newest / Desc</button>
          <button type="button" class="browse-control-btn${controls.sortDir === 'asc' ? ' browse-control-btn--active' : ''}" data-register-direction="asc" aria-pressed="${controls.sortDir === 'asc'}">Oldest / Asc</button>
        </div>
      </div>
      <div class="browse-filter-grid">
        ${REGISTER_INTEREST_FILTERS.map((filter) => renderRegisterInterestFilter(filter, items, facets)).join('')}
      </div>
      <div class="browse-control-footer">
        <span>${formatNumber(filteredCount)} of ${formatNumber(totalCount)} records after controls${activeFilters ? `, ${activeFilters} active ${activeFilters === 1 ? 'filter' : 'filters'}` : ''}.</span>
        <button type="button" class="browse-btn" data-register-clear-filters>Clear filters</button>
      </div>
    </section>
  `;
}

/**
 * The Catalogue facet bar, in the shape every open-data portal uses: publisher, category,
 * licence and status, each a single select over values precomputed server-side.
 *
 * Options come from `/_api/sources?facets=1`, never from the rendered page: a filter built
 * from the 200 records currently on screen would silently omit every value that appears
 * later in the 40,553.
 */
function renderSourceControls(filteredCount, totalCount, facets) {
  const active = SOURCE_FILTERS.filter((f) => state.sourceFilters[f.key]).length;
  const selects = SOURCE_FILTERS.map((filter) => {
    const options = Array.isArray(facets?.[filter.key]) ? facets[filter.key] : [];
    if (!options.length) return '';
    const value = state.sourceFilters[filter.key] || '';
    return `
      <label class="browse-filter">
        <span>${escapeHtml(filter.label)}</span>
        <select data-source-filter="${escapeAttr(filter.key)}">
          <option value="">All</option>
          ${options.map((option) => `<option value="${escapeAttr(option)}"${option === value ? ' selected' : ''}>${escapeHtml(filter.key === 'publicationStatus' ? `${publicationStatusLabel(option)} (${option.replace(/-/g, ' ')})` : option)}</option>`).join('')}
        </select>
      </label>
    `;
  }).join('');
  if (!selects) return '';
  return `
    <section class="browse-controls" aria-label="Catalogue filters">
      <div class="browse-filter-grid">${selects}</div>
      <div class="browse-control-footer">
        <span>${formatNumber(filteredCount)} of ${formatNumber(totalCount)} sources${active ? `, ${active} active ${active === 1 ? 'filter' : 'filters'}` : ''}.</span>
        <button type="button" class="browse-btn" data-source-clear-filters>Clear filters</button>
      </div>
    </section>
  `;
}

function renderRegisterInterestFilter(filter, items, facets = null) {
  const value = state.registerInterestControls.filters[filter.key] || '';
  const options = registerInterestFilterOptions(filter.key, items, facets);
  return `
    <label class="browse-filter">
      <span>${escapeHtml(filter.label)}</span>
      <select data-register-filter="${escapeAttr(filter.key)}">
        <option value="">All</option>
        ${options.map((option) => `<option value="${escapeAttr(option.value)}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
      </select>
    </label>
  `;
}

function registerInterestFilterOptions(key, items, facets = null) {
  if (key === 'nilStatus') {
    return [
      { value: 'has-registrable', label: 'Has registrable interests' },
      { value: 'nil-only', label: 'Nil / no interests only' },
      { value: 'includes-nil', label: 'Includes nil entries' }
    ];
  }
  // Precomputed options when the listing came from D1. Deriving them from `items` would
  // only ever see the page currently rendered -- so a filter built from page one would
  // silently omit every value that appears later in the index.
  if (facets && Array.isArray(facets[key])) {
    // Same label mapping as the in-memory branch below; sourceKinds are stored as codes.
    return facets[key].map((value) => ({ value, label: key === 'sourceKinds' ? sourceKindLabel(value) : value }));
  }
  const values = new Set();
  for (const item of items || []) {
    for (const value of registerInterestFilterValues(item, key)) {
      if (value) values.add(value);
    }
  }
  return [...values]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => ({ value, label: key === 'sourceKinds' ? sourceKindLabel(value) : value }));
}

function registerInterestFilterValues(item, key) {
  if (key === 'categories') return normalizeArray(item.categories || item.category);
  if (key === 'sourceKinds') return normalizeArray(item.sourceKinds || item.sourceKind);
  if (key === 'constituency') return normalizeArray(item.constituencies || item.constituency);
  return normalizeArray(item[key]);
}

function applyRegisterInterestFilters(items) {
  const filters = state.registerInterestControls.filters || {};
  return items.filter((item) => Object.entries(filters).every(([key, value]) => registerInterestMatchesFilter(item, key, value)));
}

function registerInterestMatchesFilter(item, key, value) {
  if (!value) return true;
  if (key === 'nilStatus') {
    if (value === 'has-registrable') return Number(item.nonNilInterestCount || 0) > 0 || item.isNone === false;
    if (value === 'nil-only') return item.isNone === true;
    if (value === 'includes-nil') return item.hasNilInterests === true || item.isNone === true;
    return true;
  }
  return registerInterestFilterValues(item, key).some((itemValue) => String(itemValue) === String(value));
}

function sortRegisterInterestItems(items) {
  const controls = state.registerInterestControls;
  const sortKey = REGISTER_INTEREST_SORT_OPTIONS.some((option) => option.key === controls.sortKey) ? controls.sortKey : 'date';
  const direction = controls.sortDir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const compared = compareRegisterInterestValues(registerInterestSortValue(a, sortKey), registerInterestSortValue(b, sortKey), sortKey);
    return direction * compared
      || compareRegisterInterestValues(registerInterestSortValue(a, 'date'), registerInterestSortValue(b, 'date'), 'date') * -1
      || compareRegisterInterestValues(a.memberName || '', b.memberName || '', 'memberName')
      || compareRegisterInterestValues(a.id || '', b.id || '', 'id');
  });
}

function registerInterestSortValue(item, key) {
  if (key === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? item.date : '';
  if (key === 'constituency') return item.constituency || normalizeArray(item.constituencies)[0] || '';
  if (key === 'interestCount' || key === 'sourceCount') return Number(item[key] || 0);
  return item[key] || '';
}

function compareRegisterInterestValues(left, right, key) {
  if (key === 'interestCount' || key === 'sourceCount') return Number(left || 0) - Number(right || 0);
  return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true });
}

function renderCard(type, item, config) {
  const slug = item.slug || slugify(item.id || item.key || item.title);
  const status = cleanStatus(item.status);
  const summary = item.description || summaryForItem(type, item);
  const title = readerTitle(type, item);
  return `
    <article class="browse-card${type === 'persons' || type === 'parties' ? ' browse-card--compact' : ''}">
      ${renderThumbnail(item, 'card')}
      <div class="browse-card__main">
        <h2 class="browse-card__title"><a href="#/${type}/${encodeURIComponent(slug)}" data-browse-link>${escapeHtml(title)}</a></h2>
        <div class="browse-card__meta">${renderMeta(metaForItem(type, item))}</div>
      </div>
      ${status ? `<span class="browse-card__status browse-card__status--${escapeAttr(status)}">${escapeHtml(statusLabel(item.status) || status.replace(/-/g, ' '))}</span>` : ''}
      ${summary ? `<p class="browse-card__summary">${escapeHtml(summary)}</p>` : ''}
      ${renderInlineActions(config, item, title)}
    </article>
  `;
}

// Each button names its record for a screen reader ("Open election layer: 2024 general
// election"), where a page of identical "Open" links said nothing (WCAG 2.4.4).
function renderInlineActions(config, item, title = item.title || item.name || '') {
  const actions = [];
  const label = config.action || 'Open in interactive map';
  if (item.interactiveUrl) actions.push(`<a class="browse-btn browse-btn--primary" href="${escapeAttr(item.interactiveUrl)}" aria-label="${escapeAttr(`${label}: ${title}`)}">${escapeHtml(label)}</a>`);
  if (item.downloads?.[0]?.url) actions.push(`<a class="browse-btn" href="${escapeAttr(item.downloads[0].url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(`Download or source: ${title}`)}">Download/source</a>`);
  return actions.length ? `<div class="browse-actions">${actions.join('')}</div>` : '';
}

/**
 * A record's title for display. A register entry's title ends in its ISO date ("David Trimble
 * - House of Commons - 2000-11-10"); it is shown as the site shows dates elsewhere.
 */
function readerTitle(type, item) {
  const title = item.title || item.name || item.id || '';
  if (type === 'register-interests') {
    return String(title).replace(/ - (\d{4}-\d{2}-\d{2})$/, (match, date) => ` – ${formatDate(date)}`).replace(/ - /g, ' – ');
  }
  return title;
}

// --- PRONI Records: hierarchical archival catalogue ---------------------------
// PRONI has ~1.4M nodes, so records are NOT held in the index. Every container
// node has a self-contained shard (data/browse/details/proni/<slug>.json) listing
// its children; leaf Items carry their full detail inside the parent shard. The
// route renders directly from shards rather than the generic index lookup.
const PRONI_LICENCE_NOTE = 'Catalogue data from the PRONI eCatalogue (Public Record Office of Northern Ireland), Crown copyright, published under the Open Government Licence.';
const PRONI_ECAT_URL = 'https://apps.proni.gov.uk/eCatNI_IE/Default.aspx';

function proniRefToSlug(ref) { return String(ref).replace(/\//g, '~'); }
function proniSlugToRef(slug) { return String(slug).replace(/~/g, '/'); }

// Browse data is served from D1 via the node API (not static shards), so it
// scales to the full ~1.5M-record tree without shipping shard files.
async function loadProniNode(slug) {
  const ref = proniSlugToRef(slug);
  const data = await loadJson(`/_api/proni/node?ref=${encodeURIComponent(ref)}`).catch(() => null);
  if (!data || !data.item) return null;
  const item = { ...data.item, path: data.ancestors || [], children: data.children || [] };
  return { item };
}

async function renderProniRoute(id) {
  const token = renderSeq;
  const config = ENTITY_CONFIG.proni;
  state.currentDetail = null;
  if (!id) {
    setHero(config, null);
    els.results.innerHTML = '<div class="browse-loading">Loading PRONI records...</div>';
    // Prefer the static roots file (CDN-cached, no D1 hit); fall back to the API.
    let data = await loadJson(`${DATA_ROOT}/proni-roots.json`).catch(() => null);
    if (!data || !data.roots) data = await loadJson('/_api/proni/node').catch(() => null);
    if (token !== renderSeq) return;
    renderProniLanding(config, (data && data.roots) || []);
    return;
  }
  els.results.innerHTML = '<div class="browse-loading">Loading record...</div>';
  const node = await loadProniNode(id);
  if (token !== renderSeq) return;
  if (!node) {
    els.results.innerHTML = '<div class="browse-empty">PRONI record not found.</div>';
    setHero(config, { title: proniSlugToRef(id) });
    return;
  }
  state.currentDetail = { type: 'proni', item: node.item };
  setHero(config, { title: node.item.title || node.item.ref, description: node.item.dates || '' });
  els.results.innerHTML = renderProniDetailPage(node);
}

function renderProniLanding(config, items) {
  els.results.innerHTML = `
    <section class="proni-search">
      <input type="search" id="proni-search-input" class="proni-search-input" autocomplete="off"
             placeholder="Search ${formatNumber(1538177)} PRONI records - title, reference, or dates…"
             value="${escapeAttr(state.proniQuery || '')}" aria-label="Search PRONI records">
      <div id="proni-search-results" class="proni-search-results"></div>
    </section>
    <section class="proni-fonds">
      <h2 class="proni-section-title">Browse by collection${items.length ? ` (${formatNumber(items.length)})` : ''}</h2>
      <ul class="proni-child-list">
        ${items.slice(0, 800).map((it) => `
          <li class="proni-child proni-child--container">
            <a href="#/proni/${encodeURIComponent(it.slug)}" data-browse-link>
              <span class="proni-child-icon" aria-hidden="true">&#128193;</span>
              <span class="proni-child-main">
                <span class="proni-child-title">${escapeHtml(it.title || it.ref)}</span>
                <span class="proni-child-meta">${escapeHtml(it.ref)}${it.level ? `<span class="proni-child-level">${escapeHtml(it.level)}</span>` : ''}</span>
              </span>
            </a>
          </li>`).join('')}
      </ul>
      ${items.length > 800 ? `<p class="browse-description">Showing the first 800 of ${formatNumber(items.length)} collections. Use the search box above to find any record.</p>` : ''}
    </section>`;
  const input = document.getElementById('proni-search-input');
  if (input) {
    input.addEventListener('input', () => scheduleProniSearch(input.value));
    if ((state.proniQuery || '').trim().length >= 2) runProniSearch(state.proniQuery);
    // No autofocus: it ran on every render, including the first, and opened a phone's keyboard
    // over the page.
  }
}

let proniSearchTimer = null;
function scheduleProniSearch(query) {
  state.proniQuery = query;
  clearTimeout(proniSearchTimer);
  proniSearchTimer = setTimeout(() => runProniSearch(query), 250);
}

async function runProniSearch(query) {
  const box = document.getElementById('proni-search-results');
  if (!box) return;
  const q = (query || '').trim();
  if (q.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="browse-loading">Searching…</div>';
  try {
    const resp = await fetch(`/_api/proni/search?q=${encodeURIComponent(q)}&limit=${PRONI_SEARCH_LIMIT}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if ((state.proniQuery || '').trim() !== q) return; // stale response
    renderProniSearchResults(box, data);
  } catch (error) {
    // Said on production too, where "not available in this local preview" was untrue.
    if ((state.proniQuery || '').trim() !== q) return;
    box.innerHTML = '<div class="browse-empty">PRONI search is not available just now. Please try again in a moment.</div>';
  }
}

const PRONI_SEARCH_LIMIT = 30;

function renderProniSearchResults(box, data) {
  const results = data.results || [];
  if (!results.length) {
    box.innerHTML = `<div class="browse-empty">No matches for &ldquo;${escapeHtml(data.query || '')}&rdquo;.</div>`;
    return;
  }
  // A full page means there may be more: the search returns at most PRONI_SEARCH_LIMIT.
  const count = results.length >= PRONI_SEARCH_LIMIT
    ? `The first ${formatNumber(results.length)} matches. There may be more: add a word, a reference or a date to narrow the search.`
    : `${formatNumber(results.length)} result${results.length === 1 ? '' : 's'}`;
  box.innerHTML = `
    <p class="proni-search-count">${count}</p>
    <ul class="proni-child-list">
      ${results.map((r) => `
        <li class="proni-child proni-child--${r.hasChildren ? 'container' : 'item'}">
          <a href="#/proni/${encodeURIComponent(r.slug)}" data-browse-link>
            <span class="proni-child-icon" aria-hidden="true">${r.hasChildren ? '&#128193;' : '&#128196;'}</span>
            <span class="proni-child-main">
              <span class="proni-child-title">${escapeHtml(r.title)}</span>
              <span class="proni-child-meta">${escapeHtml(r.ref)}${r.level ? `<span class="proni-child-level">${escapeHtml(r.level)}</span>` : ''}${r.dates ? `<span class="proni-child-dates">${escapeHtml(r.dates)}</span>` : ''}</span>
            </span>
          </a>
        </li>`).join('')}
    </ul>`;
}

function proniBreadcrumb(node) {
  // The node API returns the full ancestor chain for any node.
  const ancestors = (node.item.path || []).map((a) => ({ slug: a.slug, title: a.title || a.ref }));
  const crumbs = ['<a href="#/proni" data-browse-link>PRONI Records</a>'];
  ancestors.forEach((a) => {
    crumbs.push(`<a href="#/proni/${encodeURIComponent(a.slug)}" data-browse-link>${escapeHtml(a.title)}</a>`);
  });
  crumbs.push(`<span aria-current="page">${escapeHtml(node.item.title || node.item.ref)}</span>`);
  return `<nav class="proni-breadcrumb" aria-label="Record hierarchy">${crumbs.join('<span class="proni-crumb-sep">/</span>')}</nav>`;
}

function proniMetaRows(it) {
  const rows = [
    ['Reference', it.ref],
    ['Level', it.level],
    ['Dates', it.dates],
    ['Access', it.access],
    ['Digitised', it.digitalRecord ? 'Yes - digital image held by PRONI' : ''],
    ['Repository', it.repository]
  ].filter(([, v]) => v);
  return rows.map(([k, v]) => `
    <div class="proni-meta-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
}

function proniChildRow(c) {
  const badge = c.hasChildren ? 'container' : 'item';
  const icon = c.hasChildren ? '&#128193;' : '&#128196;'; // folder / page
  const dates = c.dates ? `<span class="proni-child-dates">${escapeHtml(c.dates)}</span>` : '';
  const lvl = c.level ? `<span class="proni-child-level">${escapeHtml(c.level)}</span>` : '';
  return `
    <li class="proni-child proni-child--${badge}">
      <a href="#/proni/${encodeURIComponent(c.slug)}" data-browse-link>
        <span class="proni-child-icon" aria-hidden="true">${icon}</span>
        <span class="proni-child-main">
          <span class="proni-child-title">${escapeHtml(c.title || c.ref)}</span>
          <span class="proni-child-meta">${escapeHtml(c.ref)}${lvl}${dates}</span>
        </span>
      </a>
    </li>`;
}

const PRONI_DESC_LIMIT = 280;

// Descriptions over the limit collapse to a preview with a Show more/less toggle.
// Both the preview and the full text are rendered; CSS shows one at a time.
// Render description text as HTML paragraphs, preserving the line/paragraph
// breaks captured from PRONI: blank lines (\n\n) split paragraphs, single
// newlines become <br>. Every segment is escaped before any markup is added.
function proniDescParas(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function renderProniDescription(text) {
  if (!text) return '';
  const heading = '<h2 class="proni-section-title">Description</h2>';
  if (text.length <= PRONI_DESC_LIMIT) {
    return `<section class="proni-description">${heading}${proniDescParas(text)}</section>`;
  }
  let cut = text.slice(0, PRONI_DESC_LIMIT);
  const sp = cut.lastIndexOf(' ');
  if (sp > PRONI_DESC_LIMIT * 0.6) cut = cut.slice(0, sp);
  const short = cut.replace(/[\s.,;:]+$/, '') + '…';
  return `
    <section class="proni-description" data-proni-desc data-expanded="false">
      ${heading}
      <div class="proni-desc-short">${proniDescParas(short)}</div>
      <div class="proni-desc-full">${proniDescParas(text)}</div>
      <button type="button" class="proni-desc-toggle" data-proni-desc-toggle aria-expanded="false">Show more</button>
    </section>`;
}

function renderProniDetailPage(node) {
  const it = node.item;
  const children = it.children || [];
  const childList = children.length
    ? `<section class="proni-children">
         <h2 class="proni-section-title">Contains ${formatNumber(children.length)} ${children.length === 1 ? 'record' : 'records'}</h2>
         <ul class="proni-child-list">${children.map(proniChildRow).join('')}</ul>
       </section>`
    : '';
  const description = renderProniDescription(it.description);
  return `
    <div class="browse-detail browse-detail--reader proni-detail">
      ${proniBreadcrumb(node)}
      <section class="proni-summary">
        <dl class="proni-meta">${proniMetaRows(it)}</dl>
      </section>
      ${description}
      ${childList}
      <section class="proni-provenance">
        <p>${escapeHtml(PRONI_LICENCE_NOTE)}</p>
        <p><a href="${escapeAttr(PRONI_ECAT_URL)}" target="_blank" rel="noopener noreferrer">Search this reference at the PRONI eCatalogue &#8599;</a></p>
      </section>
    </div>
  `;
}

async function renderDetail(type, indexItem) {
  const token = renderSeq;
  const config = ENTITY_CONFIG[type];
  const detail = await loadDetail(type, indexItem);
  if (token !== renderSeq) return;
  const item = detail?.item || indexItem;
  state.currentDetail = { type, item };
  setHero(config, item);
  const isMap = type === 'maps';
  // Load the entity's statements once and reuse them for both the header (pinned
  // facts) and the statements panel, so the page is a single view over the graph.
  let graph = null;
  try {
    graph = await loadGraphStatementsForBrowseItem(type, item);
  } catch (error) {
    console.warn('Graph statements could not be loaded for Browse detail page.', error);
  }
  if (token !== renderSeq) return;
  const pinnedRows = pinnedStatementRows(graph?.statements || []);
  // The facts panel is folded below the readable tables on every record but a source's: on
  // Gerry Adams the election appearances started about 6,700px down, under hundreds of raw
  // statements, and a map's opened on its raw "cg:map-layer" wiring. A map's files are listed
  // in their own open panel instead of inside the statements.
  const statementsFolded = type !== 'sources';
  const graphPanel = await renderGraphStatementsPanel(type, item, { collapsed: statementsFolded, graph });
  if (token !== renderSeq) return;
  if (type === 'register-interests') {
    await loadPartyNames();
    if (token !== renderSeq) return;
    els.results.innerHTML = renderRegisterInterestDetailPage(config, item, graphPanel);
    announce(`Loaded ${item.title || config.singular}.`);
    return;
  }
  // Party names in a person's elections and a contest's candidates link to the party.
  if (type === 'persons' || type === 'elections') await loadPartyNames();
  // Map layers get a table of the features that comprise them.
  const featuresPanel = isMap ? await renderMapFeaturesTable(item, graph?.entityId) : '';
  // A contest (one constituency's result) shows its candidates and count summary.
  const contestPanel = isContestItem(type, item) ? await renderContestResultPanel(item) : '';
  if (token !== renderSeq) return;
  // Maps render their own header (thumbnail beside the title), so the generic
  // hero would just duplicate the title — blank it for map detail pages.
  if (isMap) els.hero.innerHTML = '';
  els.results.innerHTML = `
    <div class="browse-detail browse-detail--reader${isMap ? ' browse-detail--map' : ''}">
      ${isMap ? renderMapHeaderPanel(item) : ''}
      ${renderDetailActions(config, item)}
      ${renderContributorDetailActions(type, item)}
      ${isMap ? '' : renderHeaderPanel(type, item, pinnedRows)}
      ${contestPanel}
      ${isMap ? renderLinksPanel(item) : ''}
      ${featuresPanel}
      ${statementsFolded ? renderRelatedPanel(type, item) : ''}
      ${graphPanel}
      ${isMap ? '' : renderLinksPanel(item, { collapsed: true })}
      ${statementsFolded ? '' : renderRelatedPanel(type, item)}
      ${renderTechnicalPanel(type, item)}
    </div>
  `;
  announce(`Loaded ${item.title || config.singular}.`);
}

function renderDetailActions(config, item) {
  const actions = [];
  if (item.interactiveUrl) actions.push(`<a class="browse-btn browse-btn--primary" href="${escapeAttr(item.interactiveUrl)}">${escapeHtml(config.action || 'Open in interactive map')}</a>`);
  if (!actions.length) return '';
  return `<div class="browse-actions">${actions.join('')}</div>`;
}

function renderContributorDetailActions(type, item) {
  if (!state.auth?.allowed) return '';
  const entityType = entityTypeForBrowseType(type);
  const entityId = item.id || item.key || item.slug || item.title;
  if (!entityType || !entityId) return '';
  return `
    <div class="browse-actions browse-actions--contributor">
      <button type="button" class="contributor-btn contributor-btn--primary" data-contributor-action="edit-current">Propose edit</button>
      <button type="button" class="contributor-btn" data-contributor-action="submit-map">Submit map</button>
    </div>
  `;
}

// Tier 2 + 3: one header panel whose pinned facts are a projection of the
// entity's semantic statements when the record is graph-backed. Statement facts
// become the headline; the curated catalogue fields (and any other secondary
// metadata) move into a single "More fields" disclosure. When the record has no
// statements, the curated reader summary is the pinned fallback so non-graph
// items still get a header.
function renderHeaderPanel(type, item, pinnedRows = []) {
  // The curated facts lead (a person's dates and contests, an election's body, date and
  // constituencies) and the graph's pinned statements follow, where they add something. The
  // header used to switch wholesale to the statements once there were two, which hid the
  // curated facts in a closed "More fields" behind "Instance of: Person".
  const curatedPinned = readerSummaryRows(type, item).filter(([, value]) => !isEmptyValue(value));
  const curatedLabels = summaryLabelSet(curatedPinned);
  const primary = dedupeRows([
    ...curatedPinned,
    ...pinnedRows.filter(([label]) => !curatedLabels.has(String(label).toLowerCase()))
  ]);
  const primaryLabels = summaryLabelSet(primary);
  const secondary = dedupeRows(metadataRows(type, item))
    .filter(([label, value]) => !isEmptyValue(value) && !primaryLabels.has(String(label).toLowerCase()));
  const summary = readerSummaryText(type, item);
  // The hero already shows the description; the same paragraph again under it was noise.
  const heroText = heroDescriptionForItem(type, item);
  const lede = summary && normalizeSearchQuery(summary) !== normalizeSearchQuery(heroText) ? summary : '';
  return `
    <section class="browse-detail__panel browse-reader-summary">
      <div class="browse-detail__body">
        ${lede ? `<p class="browse-reader-summary__lede">${escapeHtml(lede)}</p>` : ''}
        ${renderDefinitionRows(primary, 'browse-reader-facts')}
        ${renderBadges(item)}
        ${secondary.length ? renderMoreFields(secondary) : ''}
      </div>
    </section>
  `;
}

function renderMoreFields(rows, label = 'More fields') {
  return `
    <details class="browse-more-fields">
      <summary>${escapeHtml(label)}</summary>
      ${renderDefinitionRows(rows)}
    </details>
  `;
}

function readerSummaryText(type, item) {
  if (type === 'elections') return item.description || `${formatNumber(item.totalConstituencies || 0)} constituencies/features in this election record.`;
  if (type === 'persons') return joinList(item.parties?.slice(0, 4).map((party) => party.name)) || item.subtitle || '';
  // The detail record has no relatedElectionCount, so this read 0 above a 141-row table.
  if (type === 'parties') return `${item.title || item.canonicalName} appears in ${formatNumber(item.relatedElectionCount ?? item.relatedElections?.length ?? 0)} election summaries.`;
  if (type === 'sources') return item.description || joinList(item.downloads?.slice(0, 2).map((link) => link.label)) || '';
  return item.description || item.subtitle || '';
}

function readerSummaryRows(type, item) {
  if (type === 'elections') {
    if (item.entryKind && item.entryKind !== 'election') {
      return [
        ['Entry type', resultKindLabel(item.resultKind || item.entryKind)],
        ['Election', item.parentTitle],
        ['Date', formatDate(item.date)],
        ['Geography', item.geography],
        ['Result', item.resultName]
      ];
    }
    return [
      ['Body', item.body],
      ['Date', formatDate(item.date)],
      ['Geography', item.geography],
      ['Constituencies', item.totalConstituencies]
    ];
  }
  if (type === 'parties') {
    return [
      ['Name', item.title || item.canonicalName],
      ['Short name', item.shortName],
      // The years alone: the subtitle also repeats the short name and the count of elections.
      ['Years', yearRange(item.firstYear, item.lastYear) || item.subtitle],
      ['Spellings on ballot papers', item.observedNames?.length],
      ['Candidacies', item.occurrenceCount]
    ];
  }
  if (type === 'persons') {
    return [
      ['Name', item.name || item.title],
      ['Born', formatDate(item.born)],
      ['Died', formatDate(item.died)],
      ['Years', yearRange(item.firstYear, item.lastYear) || item.subtitle],
      ['Parties', joinList(item.parties?.slice(0, 5).map((party) => party.name))],
      ['Contests', item.totals?.stood],
      ['Elected', item.totals?.elected]
    ];
  }
  if (type === 'sources') {
    return [
      ['Type', sourceTypeLabel(item.type)],
      ['Category', item.category],
      ['Provider', joinList(item.provider)],
      ['Date', formatDate(item.date)],
      ['Licence', licenceText(item.license)],
      ['Publication status', publicationStatusLabel(item.publicationStatus)]
    ];
  }
  return [
    ['Category', item.category],
    ['Group', item.group],
    ['Status', statusLabel(item.status)]
  ];
}

function renderRegisterInterestDetailPage(config, item, graphPanel) {
  return `
    <div class="browse-detail browse-detail--reader browse-register-detail">
      ${renderDetailActions(config, item)}
      ${renderContributorDetailActions('register-interests', item)}
      ${renderRegisterInterestSummaryPanel(item)}
      ${renderRegisterInterestEntriesPanel(item)}
      ${renderRegisterSourcePanel(item)}
      ${graphPanel}
      ${renderTechnicalPanel('register-interests', item)}
    </div>
  `;
}

function renderRegisterInterestSummaryPanel(item) {
  // The member and their party link to their own records (personSlug is matched at build by
  // name and constituency); the entry used to link only to graph entity pages.
  const member = item.personSlug
    ? `<a href="#/persons/${encodeURIComponent(item.personSlug)}" data-browse-link>${escapeHtml(item.memberName || '')}</a>`
    : escapeHtml(item.memberName || '');
  const parties = normalizeArray(item.parties).map((party) => partyLinkHtml(party)).join(', ');
  const rows = [
    ['Politician', member],
    ['Body', escapeHtml(item.electedBody || '')],
    ['Chamber', escapeHtml(item.chamber || '')],
    ['Date', escapeHtml(formatDate(item.date))],
    ['Constituency', escapeHtml(item.constituency || joinList(item.constituencies))],
    ['Party', parties],
    ['Interests', item.interestCount === undefined || item.interestCount === null ? '' : formatNumber(item.interestCount)],
    ['Non-nil', item.nonNilInterestCount === undefined || item.nonNilInterestCount === null ? '' : formatNumber(item.nonNilInterestCount)]
  ];
  const lede = item.isNone
    ? `${item.memberName || 'This member'} had a nil return for this register edition.`
    : `${item.memberName || 'This member'} had ${formatNumber(item.interestCount || 0)} grouped ${item.interestCount === 1 ? 'interest' : 'interests'} in this ${item.electedBody || 'register'} edition.`;
  return `
    <section class="browse-detail__panel browse-reader-summary browse-register-summary">
      <div class="browse-detail__body">
        <p class="browse-reader-summary__lede">${escapeHtml(lede)}</p>
        <dl class="browse-reader-facts">${rows.filter(([, value]) => value).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${value}</dd></div>`).join('')}</dl>
      </div>
    </section>
  `;
}

function renderRegisterInterestEntriesPanel(item) {
  const interests = normalizeArray(item.interests);
  if (!interests.length) {
    const text = item.interestText || item.interestSummary || item.description || '';
    if (!text) return '';
    return `
      <section class="browse-detail__panel browse-register-interests-panel">
        <h2>Registered Interests</h2>
        <div class="browse-detail__body">
          <article class="browse-interest-entry">
            ${renderInterestText(text)}
          </article>
        </div>
      </section>
    `;
  }
  return `
    <section class="browse-detail__panel browse-register-interests-panel">
      <h2>Registered Interests</h2>
      <div class="browse-detail__body browse-interest-list">
        ${interests.map((interest, index) => renderInterestEntry(interest, index)).join('')}
      </div>
    </section>
  `;
}

function renderInterestEntry(interest, index) {
  const sourceSummary = summarizeInterestSources(interest);
  return `
    <article class="browse-interest-entry">
      <header class="browse-interest-entry__header">
        <div>
          <span class="browse-interest-entry__number">${formatNumber(index + 1)}</span>
          <h3>${escapeHtml(interest.category || 'Registered interest')}</h3>
        </div>
        <span class="browse-interest-entry__status">${interest.isNone ? 'Nil' : 'Declared'}</span>
      </header>
      ${renderInterestText(interest.interestText || interest.interestSummary || '')}
      ${sourceSummary ? `<div class="browse-interest-entry__sources">${sourceSummary}</div>` : ''}
    </article>
  `;
}

function renderInterestText(text) {
  const parsed = parseInterestText(text);
  if (parsed.fields.length >= 2) {
    return `
      ${parsed.leading ? `<p class="browse-interest-entry__text">${escapeHtml(parsed.leading)}</p>` : ''}
      <dl class="browse-interest-facts">
        ${parsed.fields.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join('')}
      </dl>
    `;
  }
  return `<p class="browse-interest-entry__text">${escapeHtml(cleanInterestText(text))}</p>`;
}

function parseInterestText(text) {
  const normalized = cleanInterestText(text);
  const labels = [
    'Summary',
    'Description',
    'Regularity Of Payment',
    'Period For Hours Worked',
    'Payment Type',
    'Monetary Value',
    'Hours Worked',
    'Registration Date',
    'Published Date',
    'Parent interest details',
    'Job Title',
    'Payer Name',
    'Payer Public Address',
    'Location',
    'Property Owner Details',
    'Is Land',
    'Country',
    'Land Use',
    'Miscellaneous Interest Type',
    'Name of donor',
    'Address of donor',
    'Amount of donation',
    'Date received',
    'Date accepted',
    'Destination',
    'Purpose of visit',
    'Who paid',
    'Value'
  ];
  const labelPattern = new RegExp(`(^|\\\\s)(${labels.map(escapeRegExp).join('|')}):\\\\s*`, 'gi');
  const matches = [...normalized.matchAll(labelPattern)];
  if (!matches.length) return { leading: normalized, fields: [] };
  const fields = [];
  const firstIndex = matches[0].index + matches[0][1].length;
  const leading = normalized.slice(0, firstIndex).trim();
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const label = canonicalInterestLabel(match[2]);
    const valueStart = match.index + match[0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    const value = normalized.slice(valueStart, valueEnd).trim();
    if (value) fields.push([label, value]);
  }
  return { leading, fields };
}

function cleanInterestText(text) {
  return String(text || '')
    .replace(/([a-z)])([A-Z][a-z]+ interest details:)/g, '$1 $2')
    .replace(/(\d{4})(Parent interest details:)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalInterestLabel(label) {
  return String(label || '').replace(/\b(Of|For|And|The|In|Uk)\b/g, (match) => match.toLowerCase() === 'uk' ? 'UK' : match.toLowerCase());
}

function summarizeInterestSources(interest) {
  const refs = normalizeArray(interest.sourceRefs);
  const labels = [...new Set(refs.map((ref) => [ref.sourceTitle || sourceKindLabel(ref.sourceKind), formatDate(ref.date)].filter(Boolean).join(', ')).filter(Boolean))];
  const sourceCount = interest.sourceCount || refs.length;
  const parts = [
    sourceCount ? `${formatNumber(sourceCount)} ${sourceCount === 1 ? 'source row' : 'source rows'}` : null,
    labels.slice(0, 2).join(' / ')
  ].filter(Boolean);
  return parts.length ? parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('') : '';
}

function renderRegisterSourcePanel(item) {
  const sourceRows = normalizeArray(item.sourceRefs);
  if (!sourceRows.length) return '';
  const body = `
    <div class="browse-detail__body browse-source-provenance">
      <p class="browse-supporting-note">These are the source rows merged into the readable record above. They are kept here for audit and provenance rather than repeated in the main text.</p>
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr('Provenance records')}">
        <table class="browse-table browse-table--compact">
          <caption class="visually-hidden">Provenance records</caption>
          <thead>
            <tr><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Source</th><th scope="col">Method</th><th scope="col">Confidence</th></tr>
          </thead>
          <tbody>
            ${sourceRows.map((row) => `
              <tr>
                <td>${escapeHtml(formatDate(row.date || row.editionDate || row.latestDeclaration || row.earliestDeclaration))}</td>
                <td>${escapeHtml(row.category || '')}</td>
                <td>${row.sourceUrl ? `<a href="${escapeAttr(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.sourceTitle || row.sourceUrl)}</a>` : escapeHtml(row.sourceTitle || sourceKindLabel(row.sourceKind) || '')}</td>
                <td>${escapeHtml(row.extractionMethod || '')}</td>
                <td>${escapeHtml(row.extractionConfidence || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  return renderCollapsiblePanel('Sources and provenance', body, `${formatNumber(sourceRows.length)} source ${sourceRows.length === 1 ? 'row' : 'rows'}`, {
    className: 'browse-detail__panel--supporting browse-source-panel'
  });
}

// Curated secondary fields for a record, as data. The header panel pins the
// headline subset and tucks the rest behind its "More fields" disclosure.
function metadataRows(type, item) {
  const rows = [
    ['Status', statusLabel(item.status)],
    ['Keywords', joinList(item.keywords)]
  ];
  if (type === 'elections') {
    if (item.entryKind && item.entryKind !== 'election') {
      rows.push(
        ['Parent election key', item.parentElectionKey],
        ['Matched feature', item.matched === undefined ? '' : item.matched ? 'Yes' : 'No'],
        ['Feature name', item.featureName],
        ['Local body', item.localBody]
      );
    } else {
      rows.push(
        ['Matched constituencies/features', item.matchedCount],
        ['Unmatched constituencies/features', item.unmatchedCount],
        ['Result entries', item.resultEntryCount],
        ['Result source', item.resultUrl ? 'Available' : '']
      );
    }
  } else if (type === 'parties') {
    rows.push(
      ['Spellings on ballot papers', joinList(item.observedNames?.slice(0, 30))]
    );
  } else if (type === 'persons') {
    rows.push(
      ['Contests', item.totals?.stood],
      ['Elected', item.totals?.elected]
    );
  } else if (type === 'register-interests') {
    rows.push(
      ['Record kind', item.recordKind],
      ['Source kind', sourceKindLabel(item.sourceKind)],
      ['Source kinds', joinList((item.sourceKinds || []).map(sourceKindLabel))],
      ['Extraction method', item.extractionMethod],
      ['Extraction confidence', item.extractionConfidence],
      ['Duplicate source rows merged', item.duplicateSourceRowCount],
      ['Nil-only record', item.isNone === undefined ? '' : item.isNone ? 'Yes' : 'No'],
      ['Includes nil entries', item.hasNilInterests === undefined ? '' : item.hasNilInterests ? 'Yes' : 'No'],
      ['Earliest declaration', item.earliestDeclaration],
      ['Latest declaration', item.latestDeclaration],
      ['Parties', joinList(item.parties)],
      ['Election dates', joinList(item.electionDates)]
    );
  }
  return rows;
}

// Map page header: thumbnail box (with asset name + link) on the left; title,
// entry type, and year/date on the right. Every other attribute is a semantic
// statement in the body below, so nothing else lives here.
function renderMapHeaderPanel(item) {
  const dateLabel = item.subtitle || (item.date !== undefined && item.date !== null && item.date !== '' ? String(item.date) : '') || joinList(item.years);
  return `
    <section class="browse-detail__panel browse-map-lead browse-map-header">
      <div class="browse-map-lead__preview">
        ${renderThumbnail(item, 'detail')}
        ${renderMapThumbnailNote(item)}
      </div>
      <div class="browse-map-lead__content">
        <p class="browse-kicker">Map</p>
        <h1 class="browse-title browse-map-header__title">${escapeHtml(item.title || '')}</h1>
        ${dateLabel ? `<p class="browse-map-header__subtitle">${escapeHtml(String(dateLabel))}</p>` : ''}
      </div>
    </section>
  `;
}

function renderMapThumbnailNote(item) {
  const thumbnail = item.thumbnail || fallbackThumbnail(item);
  if (thumbnail.kind === 'asset') {
    return `
      <p class="browse-thumb-caption browse-map-thumbnail-note">
        Thumbnail asset: <span>${escapeHtml(thumbnail.id || fileName(thumbnail.url))}</span>
        ${thumbnail.url ? ` · <a href="${escapeAttr(versionedThumbnailUrl(thumbnail.url))}" target="_blank" rel="noopener noreferrer">Open actual size</a>` : ''}
      </p>
    `;
  }
  return `
    <p class="browse-thumb-caption browse-map-thumbnail-note">
      Cartographic fallback thumbnail with grey land context.
    </p>
  `;
}

// A "Downloads & files" statement group: the actual downloadable artifacts,
// rendered inside the Semantic statements panel rather than as a separate
// section. Each file is a single clickable line (the filename).
function renderDownloadStatementGroup(links) {
  return `
    <div class="browse-graph-group">
      <div class="browse-graph-group__property">Downloads &amp; files</div>
      <div class="browse-graph-group__values">
        ${links.map((link) => {
          const label = fileName(link.url) || link.label || link.name || link.type || 'File';
          return `
            <div class="browse-graph-statement">
              <div class="browse-graph-statement__value">${link.url ? `<a href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}</div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// Features table for a map layer. Prefers the full per-feature attributes
// extracted from the source .fgb (data/browse/map-features/<id>.json, fetched
// lazily only on this page); falls back to the sampled graph features (name +
// bounding box) when no attribute file exists.
async function renderMapFeaturesTable(item, entityId) {
  let related;
  try {
    related = entityId ? await loadGraphRelatedForEntity(entityId) : null;
  } catch (error) {
    related = null;
  }
  const features = normalizeArray(related?.reverse).filter((row) =>
    row.propertyId === 'cg:property:feature-in-layer' && (row.subjectTypeLabels || []).includes('Geographic feature'));

  // Preferred: sharded per-feature attribute pages on R2, fetched lazily.
  let meta = null;
  try {
    meta = await loadJson(`${MAP_FEATURES_BASE}/${encodeURIComponent(item.id)}/meta.json`);
  } catch (error) {
    meta = null;
  }
  if (meta && meta.total) {
    const table = await renderMapFeaturesFromShards(item.id, meta, features);
    if (table) return table;
  }

  if (!features.length) return '';
  const MAX = 60;
  const shown = features.slice(0, MAX);
  const attrMaps = await Promise.all(shown.map(async (feature) => {
    try {
      const detail = await loadGraphStatementsForEntity(feature.subjectId);
      const attrs = {};
      for (const statement of detail.statements || []) {
        if (['cg:property:name', 'cg:property:instance-of', 'cg:property:feature-in-layer'].includes(statement.propertyId)) continue;
        attrs[statement.propertyLabel || statement.propertyId] = graphStatementValueText(statement);
      }
      return attrs;
    } catch (error) {
      return {};
    }
  }));
  const columns = [];
  for (const attrs of attrMaps) for (const key of Object.keys(attrs)) if (!columns.includes(key)) columns.push(key);
  const headerRow = `<tr><th scope="col">Thumbnail</th><th scope="col">Feature</th>${columns.map((col) => `<th scope="col">${escapeHtml(col)}</th>`).join('')}</tr>`;
  const bodyRows = shown.map((feature, index) => {
    const link = `<a href="#/entities/${encodeURIComponent(feature.subjectId)}" data-browse-link>${escapeHtml(feature.subjectLabel || feature.subjectId)}</a>`;
    const cells = columns.map((col) => {
      const raw = attrMaps[index][col] || '';
      return `<td>${isBoundingBoxColumn(col) ? renderBoundingBoxCell(raw) : escapeHtml(raw)}</td>`;
    }).join('');
    return `<tr><td class="browse-feature-thumb"></td><td>${link}</td>${cells}</tr>`;
  }).join('');
  const more = features.length > shown.length
    ? `<p class="browse-graph__more">Showing the first ${formatNumber(shown.length)} of ${formatNumber(features.length)} features.</p>`
    : '';
  return `
    <section class="browse-detail__panel">
      <h2>Features in this layer</h2>
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr('Features in this layer')}">
        <table class="browse-table browse-table--compact browse-features-table">
          <thead>${headerRow}</thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      ${more}
    </section>
  `;
}

// Render the features table from the sharded attribute pages on R2. The first
// page is fetched now; further pages load on demand via the "Load more" button,
// so even a 100k+ feature layer never fetches or renders more than is scrolled
// to. Each source property is a column, the bounding box uses the rounded/
// expandable cell, and each feature links to its graph entity when one exists.
async function renderMapFeaturesFromShards(mapId, meta, graphFeatures) {
  const base = `${MAP_FEATURES_BASE}/${encodeURIComponent(mapId)}`;
  let firstPage;
  try {
    firstPage = await loadJson(`${base}/0.json`);
  } catch (error) {
    return '';
  }
  const linkBySlug = {};
  for (const feature of normalizeArray(graphFeatures)) {
    const key = feature.subjectSlug || slugify(feature.subjectLabel || '');
    if (key && !linkBySlug[key]) linkBySlug[key] = feature.subjectId;
  }
  const nameKeys = new Set(['name', 'Name', 'NAME']);
  const attrColumns = normalizeArray(meta.propertyKeys).filter((key) => !nameKeys.has(key));
  const ctx = { base, attrColumns, linkBySlug, pageCount: meta.pageCount, total: meta.total, loaded: 0, nextPage: 1 };
  state.featureTables[mapId] = ctx;
  const rows = normalizeArray(firstPage).map((feature) => featureRowHtml(feature, ctx)).join('');
  ctx.loaded = normalizeArray(firstPage).length;
  const headerRow = `<tr><th scope="col">Thumbnail</th><th scope="col">Feature</th><th scope="col">Bounding box</th>${attrColumns.map((col) => `<th scope="col">${escapeHtml(col)}</th>`).join('')}</tr>`;
  const tbodyId = `feature-rows-${slugify(mapId)}`;
  const footer = ctx.nextPage < ctx.pageCount
    ? `<div class="browse-feature-more"><button type="button" class="browse-btn browse-btn--small" data-feature-load-more data-feature-map="${escapeAttr(mapId)}">Load more (${formatNumber(ctx.loaded)} of ${formatNumber(ctx.total)})</button></div>`
    : (ctx.total > ctx.loaded ? `<p class="browse-graph__more">Showing ${formatNumber(ctx.loaded)} of ${formatNumber(ctx.total)} features.</p>` : '');
  return `
    <section class="browse-detail__panel">
      <h2>Features in this layer</h2>
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr('Features in this layer')}">
        <table class="browse-table browse-table--compact browse-features-table">
          <thead>${headerRow}</thead>
          <tbody id="${tbodyId}">${rows}</tbody>
        </table>
      </div>
      ${footer}
    </section>
  `;
}

function featureRowHtml(feature, ctx) {
  const entityId = ctx.linkBySlug[slugify(feature.name || '')];
  const nameCell = entityId
    ? `<a href="#/entities/${encodeURIComponent(entityId)}" data-browse-link>${escapeHtml(feature.name || '(unnamed)')}</a>`
    : escapeHtml(feature.name || '(unnamed)');
  const bboxCell = Array.isArray(feature.bbox) ? renderBoundingBoxCell(feature.bbox.join(',')) : '';
  const attrCells = ctx.attrColumns.map((col) => {
    const value = feature.properties ? feature.properties[col] : undefined;
    return `<td>${value === null || value === undefined ? '' : escapeHtml(String(value))}</td>`;
  }).join('');
  return `<tr><td class="browse-feature-thumb"></td><td>${nameCell}</td><td>${bboxCell}</td>${attrCells}</tr>`;
}

async function handleFeatureLoadMore(button) {
  const mapId = button.dataset.featureMap;
  const ctx = state.featureTables[mapId];
  if (!ctx) return;
  button.disabled = true;
  let page;
  try {
    page = await loadJson(`${ctx.base}/${ctx.nextPage}.json`);
  } catch (error) {
    button.disabled = false;
    return;
  }
  const tbody = document.getElementById(`feature-rows-${slugify(mapId)}`);
  if (tbody) tbody.insertAdjacentHTML('beforeend', normalizeArray(page).map((feature) => featureRowHtml(feature, ctx)).join(''));
  ctx.loaded += normalizeArray(page).length;
  ctx.nextPage += 1;
  if (ctx.nextPage >= ctx.pageCount) {
    button.closest('.browse-feature-more')?.remove();
  } else {
    button.disabled = false;
    button.textContent = `Load more (${formatNumber(ctx.loaded)} of ${formatNumber(ctx.total)})`;
  }
}

function isBoundingBoxColumn(col) {
  return /bounding box|bbox|extent/i.test(String(col));
}

// A bounding box cell shows the coordinates rounded to 3 decimal places by
// default; clicking it toggles the full-precision figures (pure <details>).
function renderBoundingBoxCell(raw) {
  const parts = String(raw).split(',').map((part) => part.trim()).filter(Boolean);
  const numbers = parts.map(Number);
  if (!parts.length || numbers.some((n) => !Number.isFinite(n))) return escapeHtml(String(raw || ''));
  const rounded = numbers.map((n) => n.toFixed(3)).join(', ');
  const full = parts.join(', ');
  return `
    <details class="browse-bbox">
      <summary>
        <span class="browse-bbox__short">${escapeHtml(rounded)}</span>
        <span class="browse-bbox__full">${escapeHtml(full)}</span>
      </summary>
    </details>
  `;
}

/** Rows in date order, oldest first; rows without a date keep their place at the end. */
function byDate(rows) {
  return [...(rows || [])].sort((a, b) => String(a?.date || '9999').localeCompare(String(b?.date || '9999')));
}

function renderRelatedPanel(type, item) {
  if (type === 'elections') return renderElectionRelated(item);
  if (type === 'parties') return renderSimpleTable('Linked Elections', ['Date', 'Election', 'Stood', 'Seats', 'Votes'], byDate(item.relatedElections), (row) => [
    formatDate(row.date),
    row.key
      ? `<a href="#/elections/${encodeURIComponent(electionSlug(row.key))}" data-browse-link>${escapeHtml(row.title)}</a>`
      : row.interactiveUrl ? `<a href="${escapeAttr(row.interactiveUrl)}">${escapeHtml(row.title)}</a>` : escapeHtml(row.title),
    // A 0 beside seats won is a figure the summary did not carry (unopposed returns, older
    // files with no candidate counts), not a real zero: "Stood 0, Seats 1" read as nonsense.
    knownCount(row.stood, Number(row.seats) > 0),
    knownCount(row.seats, false),
    knownCount(row.votes, Number(row.seats) > 0 || Number(row.stood) > 0)
  ]);
  // The election and the constituency open their Browse pages (the constituency is that
  // contest's result); the map link sits beside them rather than being the only way on.
  if (type === 'persons') {
    // Votes and share only where the record has some: most pre-1832 contests have neither.
    const withVotes = normalizeArray(item.elections).some((row) => Number(row.firstPrefs) > 0);
    const withShare = normalizeArray(item.elections).some((row) => Number.isFinite(Number(row.share)) && row.share !== null && row.share !== undefined);
    const headers = ['Date', 'Election', 'Party', 'Constituency', 'Result', ...(withVotes ? ['Votes'] : []), ...(withShare ? ['Share'] : []), 'Map'];
    return renderSimpleTable('Contests', headers, byDate(item.elections), (row) => [
      formatDate(row.date),
      row.key ? `<a href="#/elections/${encodeURIComponent(electionSlug(row.key))}" data-browse-link>${escapeHtml(row.title)}</a>` : escapeHtml(row.title),
      partyLinkHtml(row.party || ''),
      row.key && row.constituency
        ? `<a href="#/elections/${encodeURIComponent(contestSlug(row.key, row.constituency))}" data-browse-link>${escapeHtml(row.constituency)}</a>`
        : escapeHtml(row.constituency || ''),
      escapeHtml(contestOutcome(row)),
      ...(withVotes ? [Number(row.firstPrefs) > 0 ? formatNumber(row.firstPrefs) : '&ndash;'] : []),
      ...(withShare ? [row.share !== null && row.share !== undefined && row.share !== '' ? `${Number(row.share).toFixed(1)}%` : '&ndash;'] : []),
      row.interactiveUrl ? `<a href="${escapeAttr(row.interactiveUrl)}" aria-label="${escapeAttr(`Open ${row.title || 'election'} on the map`)}">Open map</a>` : ''
    ]) + renderSimpleTable('Seats in the Commons (History of Parliament)', ['Constituency', 'Held'], item.seatsHeld || [], (row) => [
    escapeHtml(row.constituency || ''),
    row.source ? `<a href="${escapeAttr(row.source)}" rel="noopener">${escapeHtml(row.dates || '')}</a>` : escapeHtml(row.dates || '')
  ])
    // Offices and family from a published reference work (Boylan's Dictionary of Irish
    // Biography): facts only, each with its citation. Seats the election results above
    // already show are not repeated here.
    + renderSimpleTable('Offices held', ['Office', 'Held', 'Source'], item.officesHeld || [], (row) => [
      escapeHtml([row.office, row.constituency].filter(Boolean).join(', ')),
      escapeHtml(formatHeldYears(row)),
      escapeHtml(row.source || '')
    ])
    + renderSimpleTable('Family', ['Relation', 'Person', 'Source'], item.relatives || [], (row) => [
      escapeHtml(row.relation ? row.relation.charAt(0).toUpperCase() + row.relation.slice(1) : ''),
      row.slug ? `<a href="#/persons/${encodeURIComponent(row.slug)}" data-browse-link>${escapeHtml(row.name || row.slug)}</a>` : escapeHtml(row.name || ''),
      escapeHtml(row.source || '')
    ]) + (item.historyOfParliament?.length
    // The member's biography in the History of Parliament, cited and linked; the Trust's
    // text is not reproduced. Born and died in the overview come from these pages.
    ? renderSimpleTable('History of Parliament', ['Volume', 'Biography'], item.historyOfParliament, (row) => [
      escapeHtml([row.title, row.edition].filter(Boolean).join(', ')),
      `<a href="${escapeAttr(row.url)}" rel="noopener">${escapeHtml(row.heading || row.url)}</a>`
    ])
    : '') + (item.officialProfiles?.length
    // The person's own record with the Houses of the Oireachtas, the NI Assembly, the UK
    // Parliament, Democracy Club and Wikidata: the ids that identify them across elections.
    ? renderSimpleTable('Official records', ['Source', 'Record', 'Licence'], item.officialProfiles, (row) => [
      escapeHtml(row.source || ''),
      `<a href="${escapeAttr(row.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.label || row.url)}</a>`,
      escapeHtml(row.licence || '')
    ]) + (item.bornSource || item.diedSource
      ? `<p class="browse-note">Born and died: ${escapeHtml([...new Set([item.bornSource, item.diedSource].filter(Boolean))].join(', '))}.</p>`
      : '')
    : '');
  }
  if (type === 'register-interests') return renderRegisterInterestRelated(item);
  if (type === 'maps') return renderMapVariants(item);
  return '';
}

/**
 * One way of saying how a contest went. The source files say "Elected", "Made Quota", "Deemed
 * elected" (used for every first-past-the-post Westminster win), "Elected at constituency",
 * "Excluded", "Eliminated" or "Not Elected" for the same two outcomes, so one person's table
 * read four ways. Elected or Not elected, with the way of it in brackets where that says more.
 */
function contestOutcome(row) {
  const status = String(row.status || '').trim();
  const lower = status.toLowerCase();
  const elected = /^elected|made quota|deemed elected/.test(lower) || (row.elected === true && !/^(not|excluded|eliminated)/.test(lower));
  if (elected) {
    if (lower === 'made quota') return 'Elected (reached the quota)';
    if (/auto returned/.test(lower)) return 'Elected (returned unopposed)';
    if (/regional list/.test(lower)) return 'Elected (regional list)';
    return 'Elected';
  }
  if (/^(excluded|eliminated)/.test(lower)) return 'Not elected (excluded)';
  return status || row.elected === false ? 'Not elected' : '';
}

// Variants are alternative editions/versions of the same map layer (e.g. a
// redrawn or differently-styled cut). Each opens as its own layer in the
// interactive map, so we give each one an Open button rather than a bare row.
function renderMapVariants(item) {
  const variants = normalizeArray(item.variants);
  if (!variants.length) return '';
  const rows = variants.map((variant) => {
    const layerId = variant.id || variant.slug;
    const open = layerId
      ? `<a class="browse-btn browse-btn--small" href="/#layers=${encodeURIComponent(layerId)}">Open in interactive map</a>`
      : '';
    return `
      <tr>
        <td>${escapeHtml(variant.title || layerId || 'Variant')}</td>
        <td>${escapeHtml(variant.date || '')}</td>
        <td>${open}</td>
      </tr>`;
  }).join('');
  return `
    <section class="browse-detail__panel">
      <h2>Variants</h2>
      <p class="browse-supporting-note">Alternative editions or versions of this map layer. Each opens as its own layer in the interactive map.</p>
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr('Variants')}">
        <table class="browse-table browse-table--compact">
          <caption class="visually-hidden">Variants</caption>
          <thead><tr><th scope="col">Variant</th><th scope="col">Date</th><th scope="col">Open</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRegisterInterestRelated(item) {
  const interestRows = normalizeArray(item.interests);
  const sourceRows = normalizeArray(item.sourceRefs);
  return `
    ${renderSimpleTable('Register Interests', ['Category', 'Interest', 'Sources', 'Nil'], interestRows, (row) => [
      escapeHtml(row.category || ''),
      escapeHtml(row.interestText || ''),
      formatNumber(row.sourceCount || normalizeArray(row.sourceRefs).length),
      row.isNone ? 'Yes' : 'No'
    ])}
    ${renderSimpleTable('Register Sources', ['Date', 'Category', 'Kind', 'Source', 'Page'], sourceRows, (row) => [
      formatDate(row.date || row.editionDate || row.latestDeclaration || row.earliestDeclaration),
      escapeHtml(row.category || ''),
      escapeHtml(sourceKindLabel(row.sourceKind || '')),
      row.sourceUrl ? `<a href="${escapeAttr(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.sourceTitle || row.sourceUrl)}</a>` : escapeHtml(row.sourceTitle || ''),
      escapeHtml([row.sourcePageStart, row.sourcePageEnd && row.sourcePageEnd !== row.sourcePageStart ? row.sourcePageEnd : null].filter(Boolean).join('-'))
    ])}
  `;
}

async function renderEntityRoute(slug) {
  const token = renderSeq;
  state.currentDetail = null;
  els.results.innerHTML = '<div class="browse-loading">Loading entity...</div>';
  if (!slug) {
    await renderEntitySearchRoute();
    return;
  }
  let entityId = '';
  if (await loadGraphLookupHead()) {
    // An id (cg:...) is its own key; a readable slug is looked up.
    entityId = /^cg:/.test(slug) ? slug : (await loadGraphLookupBucket('slug', slug))?.[slug] || '';
  } else {
    const entityIndex = await loadGraphEntityIndex();
    entityId = entityIndex.bySlug?.[slug] || (entityIndex.byIdShard?.[slug] ? slug : '');
  }
  const entity = entityId ? await loadGraphEntitySummary(entityId) : null;
  if (token !== renderSeq) return;
  if (!entity) {
    setHero({ label: 'Entities', singular: 'Entity' }, null);
    setDocumentHead({ title: 'Entity not found – Civgraph' });
    els.results.innerHTML = '<div class="browse-empty">Entity not found.</div>';
    return;
  }
  // A person, party, election, map or source has its own Browse record, which is the readable
  // page for it; a link to the entity (from a statement, a register entry, a feature) opens
  // that record. The graph view stays one click away from the record (?graph=1).
  if (entity.browseType && entity.browseSlug && ENTITY_CONFIG[entity.browseType] && state.routeParams?.get('graph') !== '1') {
    location.replace(`#/${entity.browseType}/${encodeURIComponent(entity.browseSlug)}`);
    return;
  }
  const graph = await loadGraphStatementsForEntity(entityId);
  const related = await loadGraphRelatedForEntity(entityId);
  if (token !== renderSeq) return;
  const title = entity.label || entityId;
  const typeText = entity.typeLabels?.join(', ') || entity.typeIds?.join(', ') || entityId;
  els.hero.innerHTML = `
    <p class="browse-kicker">Entity</p>
    <h1 class="browse-title">${escapeHtml(title)}</h1>
    <p class="browse-description">${escapeHtml(typeText)}</p>
  `;
  setDocumentHead({ title: `${title} – Entity – Civgraph`, description: `${title}: ${typeText}, in the Civgraph semantic graph.` });
  els.results.innerHTML = renderEntityPage(entityId, entity, graph.statements, related);
}

async function renderEntitySearchRoute() {
  setHero({ label: 'Entities', singular: 'Entity' }, null);
  const search = await loadGraphEntitySearch();
  const query = normalizeSearchQuery(state.query);
  const items = query
    ? search.items.filter((item) => entitySearchText(item).includes(query)).slice(0, 200)
    : search.items.slice(0, 200);
  els.hero.innerHTML = `
    <p class="browse-kicker">Entity Search</p>
    <h1 class="browse-title">Graph entities</h1>
    <p class="browse-description">${query ? `${formatNumber(items.length)} visible matches for "${escapeHtml(state.query)}"` : 'Search graph-backed people, parties, bodies, elections, map layers, feature groups, sources, providers, and sampled geography.'}</p>
  `;
  els.results.innerHTML = `
    <div class="browse-grid">
      ${items.map(renderEntitySearchCard).join('')}
    </div>
  `;
}

function entitySearchText(item) {
  const typeLabels = item.typeLabels || item.types;
  return normalizeSearchQuery([item.label, joinList(typeLabels), item.browseType, item.browseSlug, joinList(item.searchHints)].filter(Boolean).join(' '));
}

function renderEntitySearchCard(item) {
  const typeLabels = item.typeLabels || item.types;
  return `
    <article class="browse-card">
      <div class="browse-card__main">
        <h2 class="browse-card__title"><a href="#/entities/${encodeURIComponent(item.slug || item.browseSlug)}" data-browse-link>${escapeHtml(item.label || item.entityId)}</a></h2>
        <div class="browse-card__meta">${renderMeta([joinList(typeLabels), item.browseType])}</div>
        ${item.description ? `<p class="browse-card__summary">${escapeHtml(item.description)}</p>` : ''}
      </div>
    </article>
  `;
}

function renderEntityPage(entityId, entity, statements, related) {
  const groups = groupGraphStatements(statements);
  const browseHref = entity.browseType && entity.browseSlug ? `#/${entity.browseType}/${encodeURIComponent(entity.browseSlug)}` : '';
  // Header facts are pinned from the entity's own statements; fall back to the
  // declared types when nothing is pinnable. Browse mapping lives in the
  // identifiers panel below, so it is not repeated up here.
  const pinned = pinnedStatementRows(statements);
  const headerFacts = pinned.length ? pinned : [['Types', joinList(entity.typeLabels || entity.typeIds)]];
  const statementBody = `
    <div class="browse-detail__body browse-graph">
      <div class="browse-graph__summary">
        <span>${escapeHtml(entityId)}</span>
        <span>${formatNumber(statements.length)} statements</span>
      </div>
      ${renderStatementGroups(groups)}
    </div>
  `;
  const identifierBody = `
    <div class="browse-detail__body">
      ${renderDefinitionRows([
        ['ID', entityId],
        ['Browse type', entity.browseType],
        ['Browse slug', entity.browseSlug],
        ['Type IDs', joinList(entity.typeIds)]
      ])}
    </div>
  `;
  return `
    <div class="browse-detail browse-detail--reader browse-entity">
      <div class="browse-actions">
        ${browseHref ? `<a class="browse-btn" href="${escapeAttr(browseHref)}" data-browse-link>Open Browse record</a>` : ''}
      </div>
      <section class="browse-detail__panel browse-reader-summary browse-entity-header">
        <h2>Entity</h2>
        <div class="browse-detail__body">
          ${entity.description ? `<p class="browse-reader-summary__lede">${escapeHtml(entity.description)}</p>` : ''}
          ${renderDefinitionRows(headerFacts, 'browse-reader-facts')}
        </div>
      </section>
      <section class="browse-detail__panel browse-graph-panel">
        <h2>Statements</h2>
        ${statementBody}
      </section>
      ${renderEntityRelatedPanel(related)}
      ${renderCollapsiblePanel('Entity identifiers', identifierBody, 'IDs and generated Browse mapping', { className: 'browse-detail__panel--technical' })}
    </div>
  `;
}

function relatedTableTitle(title, shown, total) {
  return shown < total ? `${title} (${formatNumber(shown)} of ${formatNumber(total)})` : `${title} (${formatNumber(total)})`;
}

function entitySubjectLinkHtml(row) {
  const label = escapeHtml(row.subjectLabel || row.subjectId);
  if (!row.subjectSlug || (row.subjectId && !isLinkableEntityId(row.subjectId))) return label;
  return `<a href="#/entities/${encodeURIComponent(row.subjectSlug)}" data-browse-link>${label}</a>`;
}

// Statements about an entity, each subject and relationship once: the House of Commons listed
// "1801 Irish by-elections" three times in its first forty rows and said nothing of the
// thousands after them.
const ENTITY_RELATED_LIMIT = 200;

function dedupeRelatedRows(rows) {
  const seen = new Set();
  return normalizeArray(rows).filter((row) => {
    const key = `${row.subjectId || row.subjectLabel}|${row.propertyId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderEntityRelatedPanel(related) {
  const allReverse = dedupeRelatedRows(related?.reverse);
  const allSource = dedupeRelatedRows(related?.sourceStatements);
  const reverseRows = allReverse.slice(0, ENTITY_RELATED_LIMIT).map((row) => [
    entitySubjectLinkHtml(row),
    escapeHtml(row.propertyLabel || row.propertyId || ''),
    escapeHtml(joinList(row.subjectTypeLabels))
  ]);
  const sourceRows = allSource.slice(0, ENTITY_RELATED_LIMIT).map((row) => [
    entitySubjectLinkHtml(row),
    escapeHtml(row.propertyLabel || row.propertyId || ''),
    escapeHtml([row.sourceKind, row.date].filter(Boolean).join(' / '))
  ]);
  if (!reverseRows.length && !sourceRows.length) return '';
  // Tier 3: reverse statements (where this entity is the object) are part of the
  // statement view, not a separate buried "Related records" copy.
  return `
    <section class="browse-detail__panel browse-entity-related-panel">
      <h2>Statements about this entity</h2>
      <div class="browse-detail__body browse-entity-related">
        ${renderInlineTable(relatedTableTitle('Subject of statements by', reverseRows.length, allReverse.length), ['Entity', 'Relationship', 'Type'], reverseRows)}
        ${renderInlineTable(relatedTableTitle('Source-supported statements', sourceRows.length, allSource.length), ['Entity', 'Statement', 'Reference'], sourceRows)}
        ${allReverse.length >= 1000 || allSource.length >= 1000 ? '<p class="browse-graph__more">The graph keeps at most 1,000 of these per entity.</p>' : ''}
      </div>
    </section>
  `;
}

async function renderGraphStatementsPanel(type, item, options = {}) {
  let graph = options.graph;
  if (graph === undefined) {
    try {
      graph = await loadGraphStatementsForBrowseItem(type, item);
    } catch (error) {
      console.warn('Graph statements could not be loaded for Browse detail page.', error);
      return '';
    }
  }
  const fileLinks = options.fileLinks || [];
  const statements = graph?.statements || [];
  if (!statements.length && !fileLinks.length) return '';
  const entitySummary = graph?.entityId ? await loadGraphEntitySummary(graph.entityId) : null;
  const groups = groupGraphStatements(statements);
  // ?graph=1: the entity route otherwise opens the Browse record, which is this page.
  const entityHref = entitySummary?.slug ? `#/entities/${encodeURIComponent(graph.entityId)}?graph=1` : '';
  const body = `
    <div class="browse-detail__body browse-graph">
      <div class="browse-graph__summary">
        <span>${formatNumber(statements.length)} ${statements.length === 1 ? 'fact' : 'facts'}</span>
        ${entityHref ? `<a href="${escapeAttr(entityHref)}" data-browse-link>What else refers to this</a>` : ''}
      </div>
      ${renderStatementGroups(groups, fileLinks)}
    </div>
  `;
  // "All facts and sources", not "Semantic statements": the panel is every fact the graph holds
  // about the record with the source of each, and readers do not know the data-model term.
  if (options.collapsed) {
    return renderCollapsiblePanel('All facts and sources', body, `${formatNumber(statements.length)} ${statements.length === 1 ? 'fact' : 'facts'}, each with its source`, {
      className: 'browse-graph-panel browse-detail__panel--supporting'
    });
  }
  return `
    <section class="browse-detail__panel browse-graph-panel">
      <h2>All facts and sources</h2>
      ${body}
    </section>
  `;
}

// Render statement groups with maintenance/system properties (URLs, file-format
// records) tucked into a collapsed sub-section, so the lay-relevant statements
// lead and the technical wiring stays available but out of the way. Downloadable
// files are folded in as their own "Downloads & files" statement group.
function renderStatementGroups(groups, fileLinks = []) {
  const primary = groups.filter((group) => !GRAPH_TECHNICAL_PROPERTIES.has(group.propertyId));
  const technical = groups.filter((group) => GRAPH_TECHNICAL_PROPERTIES.has(group.propertyId));
  const visiblePrimary = primary.slice(0, 10);
  const hiddenPrimary = Math.max(0, primary.length - visiblePrimary.length);
  return `
    <div class="browse-graph__groups">
      ${visiblePrimary.map(renderGraphStatementGroup).join('')}
      ${fileLinks.length ? renderDownloadStatementGroup(fileLinks) : ''}
    </div>
    ${hiddenPrimary ? `<p class="browse-graph__more">${formatNumber(hiddenPrimary)} further statement groups are available in the generated graph data.</p>` : ''}
    ${technical.length ? `
      <details class="browse-more-fields browse-graph-technical">
        <summary>System &amp; technical statements</summary>
        <div class="browse-graph__groups">
          ${technical.map(renderGraphStatementGroup).join('')}
        </div>
      </details>
    ` : ''}
  `;
}

function renderGraphStatementGroup(group) {
  const visibleStatements = group.statements.slice(0, 12);
  const hiddenCount = Math.max(0, group.statements.length - visibleStatements.length);
  return `
    <div class="browse-graph-group">
      <div class="browse-graph-group__property">${escapeHtml(group.label)}</div>
      <div class="browse-graph-group__values">
        ${visibleStatements.map(renderGraphStatement).join('')}
        ${hiddenCount ? `<div class="browse-graph-statement browse-graph-statement--more">+ ${formatNumber(hiddenCount)} more</div>` : ''}
      </div>
    </div>
  `;
}

function renderGraphStatement(statement) {
  const value = graphStatementValueText(statement);
  const qualifiers = normalizeArray(statement.qualifiers)
    .filter((qualifier) => qualifier.propertyId !== 'cg:property:name')
    .slice(0, 8);
  const references = normalizeArray(statement.references).slice(0, 4);
  const omittedReferences = Math.max(0, Number(statement.referenceCount || 0) - references.length);
  return `
    <div class="browse-graph-statement">
      <div class="browse-graph-statement__value">${graphStatementValueHtml(statement)}</div>
      ${qualifiers.length ? `
        <div class="browse-graph-statement__qualifiers">
          ${qualifiers.map((qualifier) => `<span><b>${escapeHtml(qualifier.propertyLabel || qualifier.propertyId)}</b> ${escapeHtml(graphStatementValueText(qualifier))}</span>`).join('')}
        </div>
      ` : ''}
      ${(references.length || omittedReferences) ? `
        <div class="browse-graph-statement__references">
          ${references.map((reference) => `<span>${escapeHtml(graphReferenceLabel(reference))}</span>`).join('')}
          ${omittedReferences ? `<span>+ ${formatNumber(omittedReferences)} more</span>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

function graphStatementValueText(statement) {
  const text = statement.valueLabel || statement.valueText || statement.valueId || '';
  // Dates as everywhere else on the site ("29 Nov 2024", not "2024-11-29").
  return /^\d{4}-\d{2}(-\d{2})?$/.test(text) ? formatDate(text) : text;
}

// Render a statement value as a link to the value's own entity page when the
// value is itself an entity (provider, elected body, instance-of, source file,
// …). That page lists every other entity sharing the value via its reverse
// statements — i.e. "show me everything else with this value". Literal values
// (free-text dates, categories) have no entity page yet, so they stay plain.
// Entity kinds that have a page: the id namespaces the graph's entity index covers
// (build-semantic-graph.mjs). Candidatures, entity types, source files and register
// interests are values in statements but have no index entry, so a link to them always
// landed on "Entity not found"; they are shown as text instead.
const LINKABLE_ENTITY_KINDS = new Set([
  'body', 'contest', 'date-month', 'date-year', 'election', 'feature-group', 'geographic-feature',
  'map-category', 'map-layer', 'office', 'party', 'person', 'provider', 'register-record', 'source'
]);

function isLinkableEntityId(id) {
  const match = /^cg:([a-z-]+):/.exec(String(id || ''));
  return Boolean(match && LINKABLE_ENTITY_KINDS.has(match[1]));
}

function graphStatementValueHtml(statement) {
  const value = graphStatementValueText(statement);
  if (!value) return '';
  if (statement.valueType === 'entity' && statement.valueId && isLinkableEntityId(statement.valueId)) {
    return `<a href="#/entities/${encodeURIComponent(statement.valueId)}" data-browse-link>${escapeHtml(value)}</a>`;
  }
  return escapeHtml(value);
}

function graphReferenceLabel(reference) {
  return [reference.sourceTitle || reference.sourceRecordId || reference.sourceKind || 'Source', reference.date].filter(Boolean).join(' / ');
}

function groupGraphStatements(statements) {
  const byProperty = new Map();
  for (const statement of statements) {
    const key = statement.propertyId || 'unknown';
    if (!byProperty.has(key)) {
      byProperty.set(key, {
        propertyId: key,
        label: statement.propertyLabel || key,
        statements: []
      });
    }
    byProperty.get(key).statements.push(statement);
  }
  return [...byProperty.values()]
    .sort((a, b) => graphPropertyRank(a.propertyId) - graphPropertyRank(b.propertyId) || a.label.localeCompare(b.label));
}

function graphPropertyRank(propertyId) {
  const index = GRAPH_STATEMENT_PROPERTY_ORDER.indexOf(propertyId);
  return index === -1 ? 999 : index;
}

// Project an entity's statements into a short list of header facts. Each pinned
// property contributes one row (its label and a compact summary of its values),
// so the header is a view over the statement store rather than a separate
// authored field list.
function pinnedStatementRows(statements, limit = 6) {
  if (!Array.isArray(statements) || !statements.length) return [];
  const byProperty = new Map();
  for (const group of groupGraphStatements(statements)) byProperty.set(group.propertyId, group);
  const rows = [];
  for (const propertyId of GRAPH_HEADER_PINNED_PROPERTIES) {
    const group = byProperty.get(propertyId);
    if (!group) continue;
    const value = summarizeStatementValues(group.statements);
    if (!value) continue;
    rows.push([group.label, value]);
    if (rows.length >= limit) break;
  }
  return rows;
}

function summarizeStatementValues(statements, max = 3) {
  const values = [];
  for (const statement of statements) {
    const text = graphStatementValueText(statement);
    if (text && !values.includes(text)) values.push(text);
  }
  if (!values.length) return '';
  const shown = values.slice(0, max);
  const extra = values.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${formatNumber(extra)} more` : shown.join(', ');
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const [label, value] of rows) {
    const key = String(label).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([label, value]);
  }
  return out;
}

async function loadGraphStatementsForBrowseItem(type, item) {
  const entityId = await graphEntityIdForBrowseItem(type, item);
  if (!entityId) return null;
  return loadGraphStatementsForEntity(entityId);
}

async function loadGraphStatementsForEntity(entityId) {
  const lookup = await loadGraphLookupHead();
  let shardUrl;
  if (lookup) {
    const entry = await lookupGraphEntity(entityId);
    shardUrl = graphShardUrl(lookup, 'statements', entry?.st);
  } else {
    shardUrl = (await loadGraphSubjectMap())[entityId];
  }
  if (!shardUrl) return { entityId, statements: [] };
  let shard = state.graph.subjectShards.get(shardUrl);
  if (!shard) {
    shard = await loadJson(shardUrl);
    state.graph.subjectShards.set(shardUrl, shard);
  }
  return { entityId, statements: normalizeArray(shard.items?.[entityId]) };
}

async function graphEntityIdForBrowseItem(type, item) {
  // The record's keys in the order the build is surest to have written them: its own slug
  // first, so the usual case is one small lookup file.
  if (await loadGraphLookupHead()) {
    for (const key of graphBrowseKeys(type, item)) {
      const items = await loadGraphLookupBucket('browse', key);
      if (items?.[key]) return items[key];
    }
    return '';
  }
  const mapping = await loadGraphBrowseMapping(type);
  for (const key of graphBrowseKeys(type, item)) {
    if (mapping[key]) return mapping[key];
  }
  return '';
}

// THE GRAPH LOOKUP. A record page used to read three whole maps to find its facts -- the
// record-to-entity map for its type (up to 14 MB), the subject-to-shard map (20 MB) and the
// four-part slug index (28 MB) -- 56 MB to read one key from each. The graph build now splits
// each map by a hash of its key (scripts/graph/build-semantic-graph.mjs writeLookupIndex), so
// the page computes which small file holds the key and reads that one. The head file names the
// bucket counts and URL patterns; without it (an older graph) the whole maps are used as before.
async function loadGraphLookupHead() {
  if (state.graph.lookup !== undefined) return state.graph.lookup;
  state.graph.lookup = (async () => {
    try {
      // Revalidated on every visit: its version is what keeps the cached lookup files and
      // shards from an earlier build out of this one.
      const head = await loadJson(`${GRAPH_ROOT}/indexes/lookup.json`, { cache: 'no-cache' });
      return head?.buckets && head?.urls ? head : null;
    } catch {
      return null;
    }
  })();
  state.graph.lookup = await state.graph.lookup;
  return state.graph.lookup;
}

/** The `items` of the lookup file of `kind` ('browse', 'entity', 'slug') that holds `key`. */
async function loadGraphLookupBucket(kind, key) {
  const lookup = await loadGraphLookupHead();
  const count = lookup?.buckets?.[kind];
  if (!count || !lookup.urls?.[kind]) return null;
  const bucket = String(lookupBucket(key, count)).padStart(lookup.bucketPad || 4, '0');
  const url = graphVersionedUrl(lookup.urls[kind].replace('{bucket}', bucket), lookup);
  state.graph.lookupBuckets ||= new Map();
  if (!state.graph.lookupBuckets.has(url)) {
    state.graph.lookupBuckets.set(url, loadJson(url).then((payload) => payload.items || {}).catch(() => ({})));
  }
  return state.graph.lookupBuckets.get(url);
}

/** An entity's lookup entry: its summary, and the shard numbers of its statements (st, rv, ss). */
async function lookupGraphEntity(entityId) {
  if (!entityId) return null;
  const items = await loadGraphLookupBucket('entity', entityId);
  return items?.[entityId] || null;
}

function graphShardUrl(lookup, kind, number) {
  const shard = lookup?.shards?.[kind];
  if (!shard || number === undefined || number === null) return '';
  return graphVersionedUrl(shard.url.replace('{n}', String(number).padStart(shard.pad || 3, '0')), lookup);
}

// The graph is served with a day's max-age, so a URL is tied to the build that wrote it.
function graphVersionedUrl(url, lookup) {
  return lookup?.version ? `${url}${url.includes('?') ? '&' : '?'}g=${encodeURIComponent(lookup.version)}` : url;
}

/**
 * Which of `count` files a key lives in: FNV-1a over the key's UTF-16 code units. The browse and
 * graph builds have the same function (lookupBucket); the three must agree.
 */
function lookupBucket(key, count) {
  let hash = 0x811c9dc5;
  const text = String(key);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % count;
}

function graphBrowseKeys(type, item) {
  const keys = [];
  for (const value of [item.slug, item.id, item.key, item.title, item.name]) {
    if (!value) continue;
    keys.push(`${type}:${value}`);
    keys.push(`${type}:${slugify(value)}`);
  }
  return [...new Set(keys)];
}

async function loadGraphManifest() {
  if (state.graph.manifest) return state.graph.manifest;
  state.graph.manifest = await loadJson(`${GRAPH_ROOT}/manifest.json`);
  return state.graph.manifest;
}

// The map is written one file per Browse type (`byType`), so a record page loads only its own
// type's keys; a single-file map (`items`) is used as it is.
async function loadGraphBrowseMapping(type) {
  state.graph.browseMapping ||= new Map();
  if (state.graph.browseMapping.has(type)) return state.graph.browseMapping.get(type);
  const manifest = await loadGraphManifest();
  const head = await loadJson(manifest.indexes.browseRecordToEntity);
  const url = head.byType?.[type];
  const items = url ? (await loadJson(url)).items || {} : head.items || {};
  state.graph.browseMapping.set(type, items);
  return items;
}

// The entity indexes are written in parts (each file must stay under Cloudflare Pages' 25 MiB
// limit): the index file lists them in `parts`, and they are merged here. A single-file index
// (no `parts`) is used as it is.
async function loadIndexWithParts(url) {
  const head = await loadJson(url);
  if (!Array.isArray(head?.parts)) return head;
  const pieces = await Promise.all(head.parts.map((partUrl) => loadJson(partUrl)));
  const merged = { ...head, items: [], bySlug: {}, byIdShard: {} };
  for (const piece of pieces) {
    if (Array.isArray(piece.items)) merged.items.push(...piece.items);
    Object.assign(merged.bySlug, piece.bySlug || {});
    Object.assign(merged.byIdShard, piece.byIdShard || {});
  }
  return merged;
}

async function loadGraphEntityIndex() {
  if (state.graph.entityIndex) return state.graph.entityIndex;
  const manifest = await loadGraphManifest();
  const index = await loadIndexWithParts(manifest.indexes.entitySlugs);
  state.graph.entityIndex = index;
  return state.graph.entityIndex;
}

async function loadGraphEntitySearch() {
  if (state.graph.entitySearch) return state.graph.entitySearch;
  const manifest = await loadGraphManifest();
  state.graph.entitySearch = await loadIndexWithParts(manifest.indexes.entitySearch);
  return state.graph.entitySearch;
}

async function loadGraphEntitySummary(entityId) {
  if (await loadGraphLookupHead()) {
    const entry = await lookupGraphEntity(entityId);
    if (!entry) return null;
    const { st: _st, rv: _rv, ss: _ss, ...summary } = entry;
    return summary;
  }
  const index = await loadGraphEntityIndex();
  if (index.byId?.[entityId]) return index.byId[entityId];
  const shardUrl = index.byIdShard?.[entityId];
  if (!shardUrl) return null;
  let shard = state.graph.entitySummaryShards.get(shardUrl);
  if (!shard) {
    shard = await loadJson(shardUrl);
    state.graph.entitySummaryShards.set(shardUrl, shard);
  }
  return shard.items?.[entityId] || null;
}

async function loadGraphRelatedForEntity(entityId) {
  const [reverse, sourceStatements] = await Promise.all([
    loadGraphRelatedShard(entityId, 'reverseEntityMap', 'reverseEntityShards', 'reverseEntityValuesMap'),
    loadGraphRelatedShard(entityId, 'sourceStatementMap', 'sourceStatementShards', 'sourceStatementsMap')
  ]);
  return { reverse, sourceStatements };
}

async function loadGraphRelatedShard(entityId, mapStateKey, shardStateKey, manifestIndexKey) {
  let shardUrl;
  const lookup = await loadGraphLookupHead();
  if (lookup) {
    const entry = await lookupGraphEntity(entityId);
    shardUrl = mapStateKey === 'reverseEntityMap'
      ? graphShardUrl(lookup, 'reverse', entry?.rv)
      : graphShardUrl(lookup, 'sourceStatements', entry?.ss);
  } else {
    const manifest = await loadGraphManifest();
    if (!state.graph[mapStateKey]) {
      const mapPayload = await loadJson(manifest.indexes[manifestIndexKey]);
      state.graph[mapStateKey] = mapPayload.items || {};
    }
    shardUrl = state.graph[mapStateKey][entityId];
  }
  if (!shardUrl) return [];
  let shard = state.graph[shardStateKey].get(shardUrl);
  if (!shard) {
    shard = await loadJson(shardUrl);
    state.graph[shardStateKey].set(shardUrl, shard);
  }
  return normalizeArray(shard.items?.[entityId]);
}

async function loadGraphSubjectMap() {
  if (state.graph.subjectMap) return state.graph.subjectMap;
  const manifest = await loadGraphManifest();
  const subjectMap = await loadJson(manifest.indexes.statementsBySubjectMap);
  state.graph.subjectMap = subjectMap.items || {};
  return state.graph.subjectMap;
}

function sourceKindLabel(value) {
  return String(value || '')
    .replace(/^historical-/, '')
    .replace(/-register$/, '')
    .replace(/current-provider-json-api/, 'current API')
    .replace(/filtered-westminster-csv/, 'NI MP CSV')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Election and contest slugs, as scripts/build-browse-indexes.mjs writes them: the key with
// "__" made "-", then the constituency. The NI Forum's province-wide list is its
// "Regional List" entry, which person records call "Northern Ireland".
function electionSlug(key) {
  return slugify(key);
}

function contestSlug(key, constituency) {
  const regionalList = /^northern-ireland-forum/.test(String(key)) && normalizeSearchQuery(constituency) === 'northern ireland';
  return `${slugify(key)}-${regionalList ? 'regional-list' : slugify(constituency)}`;
}

function isContestItem(type, item) {
  return type === 'elections' && item.entryKind === 'election-constituency-result' && Boolean(item.parentElectionKey);
}

function foldName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchJsonOrNull(url) {
  try {
    const response = await fetch(url, { cache: 'default' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * One contest's constituency row and candidates, from the same sources as the map app.
 *
 * The elections API first (D1, the default transport in production): by name, which needs
 * one request. An API that predates the name lookup answers that request with the whole
 * election instead, so the row number is read from it and the constituency asked for by
 * number, as election-manager.js ensureAnimationPayload does. If the API cannot answer at
 * all, the election's static bundle (resultUrl) still has every result.
 */
async function loadContestResult(item) {
  const key = item.parentElectionKey;
  const name = item.constituency || item.sourceResultName || item.resultName;
  if (!key || !name) return null;
  const wanted = foldName(name);
  const sameName = (row) => foldName(row?.name || row?.constituency) === wanted;
  const base = `/_api/elections?key=${encodeURIComponent(key)}`;

  const byName = await fetchJsonOrNull(`${base}&constituencyName=${encodeURIComponent(name)}`);
  if (byName && Array.isArray(byName.candidates) && byName.constituency) {
    return { constituency: byName.constituency, candidates: byName.candidates };
  }
  const row = Array.isArray(byName?.constituencies) ? byName.constituencies.find(sameName) : null;
  if (row && Number.isInteger(Number(row.seq))) {
    const bySeq = await fetchJsonOrNull(`${base}&constituency=${Number(row.seq)}`);
    if (bySeq && Array.isArray(bySeq.candidates)) return { constituency: bySeq.constituency || row, candidates: bySeq.candidates };
  }

  if (item.resultUrl) {
    const bundle = await fetchJsonOrNull(item.resultUrl);
    const result = (bundle?.results || []).find(sameName);
    if (result) return { constituency: { ...result, votingSystem: result.votingSystem || bundle.votingSystem }, candidates: result.candidates || [] };
  }
  return null;
}

function contestIsStv(constituency, item) {
  const system = foldName(constituency?.votingSystem || item.votingSystem || '');
  if (system.includes('stv')) return true;
  const quota = Number(constituency?.quota);
  return Number.isFinite(quota) && quota > 0 && normalizeArray(constituency?.countNumbers).some((count) => Number(count) > 1);
}

function contestPersonLink(candidate) {
  const name = escapeHtml(candidate.name || '');
  const personId = candidate.personId ?? candidate.person_id;
  if (personId === null || personId === undefined || personId === '') return name;
  // The persons endpoint finds a record by id as well as by slug, so the id is the link that
  // cannot miss when a candidacy's spelling differs from the person's canonical name.
  return `<a href="#/persons/${encodeURIComponent(String(personId))}" data-browse-link>${name}</a>`;
}

async function renderContestResultPanel(item) {
  const result = await loadContestResult(item);
  if (!result || !result.candidates?.length) {
    return `
      <section class="browse-detail__panel">
        <h2>Result</h2>
        <p class="browse-note">The candidates for this contest could not be loaded.${item.interactiveUrl ? ` They are on the <a href="${escapeAttr(item.interactiveUrl)}">interactive map</a>.` : ''}</p>
      </section>
    `;
  }
  const { constituency = {}, candidates } = result;
  // "1st pref" under STV; a plurality ballot (Westminster, the old block votes) and anything
  // else counts plain votes, as the map app's tables now say.
  const stv = contestIsStv(constituency, item);
  const votesLabel = stv ? '1st pref' : 'Votes';
  const firstPrefs = (candidate) => Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0;
  const sorted = [...candidates].sort((a, b) => firstPrefs(b) - firstPrefs(a));
  const valid = Number(constituency.validPoll || constituency.totalVotes) || sorted.reduce((sum, candidate) => sum + firstPrefs(candidate), 0);
  const outcome = (candidate) => {
    if (candidate.elected) return stv && candidate.electedAt ? `Elected (count ${candidate.electedAt})` : 'Elected';
    if (stv && candidate.excluded && candidate.excludedAt) return `Excluded (count ${candidate.excludedAt})`;
    return 'Not elected';
  };
  const rows = sorted.map((candidate) => {
    const share = valid ? `${(firstPrefs(candidate) / valid * 100).toFixed(1)}%` : '';
    const party = candidate.colour
      ? partyLinkHtml(candidate.party || 'Independent', `<span class="browse-badge" style="border-color:${escapeAttr(candidate.colour)}">${escapeHtml(candidate.party || 'Independent')}</span>`)
      : partyLinkHtml(candidate.party || '');
    return `
      <tr${candidate.elected ? ' class="browse-contest__elected"' : ''}>
        <td>${contestPersonLink(candidate)}</td>
        <td>${party}</td>
        <td class="browse-num">${formatNumber(firstPrefs(candidate))}</td>
        <td class="browse-num">${share}</td>
        <td>${escapeHtml(outcome(candidate))}</td>
      </tr>
    `;
  }).join('');
  const turnout = Number(constituency.turnoutPct);
  const summaryRows = [
    ['Seats', constituency.seatsTotal ?? constituency.countInfo?.Number_Of_Seats],
    ['Electorate', constituency.electorate ? formatNumber(constituency.electorate) : ''],
    ['Total poll', constituency.totalPoll ? formatNumber(constituency.totalPoll) : ''],
    ['Invalid', constituency.spoiled ? formatNumber(constituency.spoiled) : ''],
    ['Valid', valid ? formatNumber(valid) : ''],
    ['Turnout', Number.isFinite(turnout) && turnout > 0 ? `${turnout.toFixed(2)}%` : ''],
    ['Quota', stv && constituency.quota ? formatNumber(constituency.quota) : ''],
    ['Counts', stv && normalizeArray(constituency.countNumbers).length > 1 ? normalizeArray(constituency.countNumbers).length : '']
  ];
  const elected = sorted.filter((candidate) => candidate.elected).length;
  return `
    <section class="browse-detail__panel browse-contest">
      <h2>Result</h2>
      ${renderDefinitionRows(summaryRows, 'browse-reader-facts')}
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr('Candidates')}">
        <table class="browse-table">
          <caption class="visually-hidden">Candidates in ${escapeHtml(item.resultName || item.constituency || '')}, ${escapeHtml(item.parentTitle || '')}: ${formatNumber(sorted.length)} standing, ${formatNumber(elected)} elected</caption>
          <thead><tr>
            <th scope="col">Candidate</th>
            <th scope="col">Party</th>
            <th scope="col" class="browse-num">${votesLabel}</th>
            <th scope="col" class="browse-num">Share</th>
            <th scope="col">Result</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderElectionRelated(item) {
  if (item.entryKind && item.entryKind !== 'election') {
    const parentRows = item.parentElectionKey ? [[
      item.date ? formatDate(item.date) : '',
      item.parentBrowseUrl ? `<a href="#/elections/${encodeURIComponent((item.parentBrowseUrl || '').split('/').pop() || item.parentElectionKey)}" data-browse-link>${escapeHtml(item.parentTitle || item.parentElectionKey)}</a>` : escapeHtml(item.parentTitle || item.parentElectionKey),
      item.interactiveUrl ? `<a href="${escapeAttr(item.interactiveUrl)}">Open election layer</a>` : ''
    ]] : [];
    return renderTablePanel('Parent Election', ['Date', 'Election', 'Interactive layer'], parentRows);
  }
  const partyRows = (item.partySummary || []).map((party) => [
    partyLinkHtml(party.party || '', party.colour ? `<span class="browse-badge" style="border-color:${escapeAttr(party.colour)}">${escapeHtml(party.party || '')}</span>` : escapeHtml(party.party || '')),
    formatNumber(party.stood),
    formatNumber(party.seats),
    formatNumber(party.votes),
    party.share === undefined ? '' : `${Number(party.share).toFixed(2)}%`
  ]);
  // The overall result first, then the constituencies in order: "Overall results" used to sit
  // alphabetically between Offaly and Roscommon. A type column said "Constituency Result" on
  // every row but that one, so it is gone.
  const entries = [...(item.resultEntries || [])].sort((a, b) =>
    (a.resultKind === 'overall' ? 0 : 1) - (b.resultKind === 'overall' ? 0 : 1));
  const constituencyRows = entries.length
    ? entries.map((entry) => [
      entry.browseUrl ? `<a href="#/elections/${encodeURIComponent((entry.browseUrl || '').split('/').pop() || entry.key)}" data-browse-link>${escapeHtml(entry.resultName || entry.title || entry.key)}</a>` : escapeHtml(entry.resultName || entry.title || entry.key)
    ])
    : (item.constituencies || []).map((name) => [escapeHtml(name)]);
  return `
    ${renderTablePanel('Party Summary', ['Party', 'Stood', 'Seats', 'Votes', 'Share'], partyRows)}
    ${renderTablePanel('Results by constituency', ['Result'], constituencyRows)}
  `;
}

function resultKindLabel(value) {
  return String(value || '')
    .replace(/^election-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderLinksPanel(item, options = {}) {
  // Tier 3: references are citations and now live on the statements that use
  // them, so this panel lists only the actual downloadable artifacts.
  // De-duplicate by URL so a file listed as both a download and a source file
  // (the common case) appears once; the first occurrence keeps its type label.
  const rows = [];
  const seenUrls = new Set();
  const pushRow = (type, label, url) => {
    if (url && seenUrls.has(url)) return;
    if (url) seenUrls.add(url);
    rows.push([type, label, url]);
  };
  if (item.url) pushRow('Source link', item.title || item.name || item.url, item.url);
  if (item.sourceUrl) pushRow('Source link', item.sourceTitle || item.sourceUrl, item.sourceUrl);
  for (const link of item.downloads || []) pushRow('Download', link.label, link.url);
  for (const link of item.sourceFiles || []) pushRow('Source file', link.label, link.url);
  if (!rows.length) return '';
  const body = `
    <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr('Downloads and files')}">
      <table class="browse-table browse-table--compact">
        <caption class="visually-hidden">Related links</caption>
        <thead><tr><th scope="col">Type</th><th scope="col">Label</th><th scope="col">Link</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row[0])}</td>
              <td>${escapeHtml(row[1] || '')}</td>
              <td>${row[2] ? `<a href="${escapeAttr(row[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(row[2])}</a>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (options.collapsed) {
    return renderCollapsiblePanel('Downloads & files', body, `${formatNumber(rows.length)} ${rows.length === 1 ? 'file' : 'files'}`, {
      className: 'browse-detail__panel--supporting'
    });
  }
  return renderTablePanel('Downloads & files', ['Type', 'Label', 'Link'], rows.map((row) => [
    escapeHtml(row[0]),
    escapeHtml(row[1] || ''),
    row[2] ? `<a href="${escapeAttr(row[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(row[2])}</a>` : ''
  ]));
}

function renderThumbnail(item, context = 'card') {
  const thumbnail = normalizedThumbnail(item);
  if (!thumbnail) return '';
  if (thumbnail.kind === 'asset' && thumbnail.url) {
    const url = versionedThumbnailUrl(thumbnail.url);
    const smallUrl = thumbnail.smallUrl ? versionedThumbnailUrl(thumbnail.smallUrl) : null;
    const src = context === 'card' ? (smallUrl || url) : url;
    const srcset = context === 'card' && thumbnail.smallUrl && thumbnail.url
      ? ` srcset="${escapeAttr(smallUrl)} 60w, ${escapeAttr(url)} 120w" sizes="72px"`
      : '';
    // A card's thumbnail is decoration beside its own title link (alt=""), not the title again.
    const alt = context === 'card' ? '' : thumbnail.alt || item.title || '';
    return `
      <figure class="browse-thumb browse-thumb--${escapeAttr(context)}">
        <img src="${escapeAttr(src)}"${srcset} alt="${escapeAttr(alt)}" loading="lazy" decoding="async">
      </figure>
    `;
  }
  if (thumbnail.kind === 'external' && thumbnail.url) {
    const src = context === 'card' ? (thumbnail.smallUrl || thumbnail.url) : thumbnail.url;
    const srcset = context === 'card' && thumbnail.smallUrl && thumbnail.url
      ? ` srcset="${escapeAttr(thumbnail.smallUrl)} 120w, ${escapeAttr(thumbnail.url)} 480w" sizes="72px"`
      : '';
    return `
      <figure class="browse-thumb browse-thumb--${escapeAttr(context)} browse-thumb--external">
        <img src="${escapeAttr(src)}"${srcset} alt="${escapeAttr(context === 'card' ? '' : thumbnail.alt || item.title || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      </figure>
    `;
  }
  if (thumbnail.kind === 'map-fallback') {
    return `
      <figure class="browse-thumb browse-thumb--${escapeAttr(context)} browse-thumb--map-fallback" aria-label="${escapeAttr(thumbnail.alt || item.title || 'Map thumbnail')}">
        ${renderMapFallbackSvg(item, thumbnail)}
      </figure>
    `;
  }
  return `
    <div class="browse-thumb browse-thumb--${escapeAttr(context)} browse-thumb--placeholder browse-thumb--${escapeAttr(thumbnail.type || item.type || 'entry')}" aria-hidden="true">
      <span>${escapeHtml(thumbnail.label || thumbnailInitials(item.title || item.name || item.id))}</span>
    </div>
  `;
}

function versionedThumbnailUrl(url) {
  if (!url || !url.startsWith('/assets/thumbnails/')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${THUMBNAIL_ASSET_VERSION}`;
}

function renderThumbnailPanel(item) {
  const thumbnail = normalizedThumbnail(item);
  const caption = thumbnail.kind === 'asset'
    ? `Thumbnail asset: ${thumbnail.id || fileName(thumbnail.url)}`
    : thumbnail.kind === 'external'
      ? 'External thumbnail from the linked source; the image is not stored by Civgraph.'
      : 'No image asset is available for this item; Browse is showing a generated placeholder.';
  return `
    <section class="browse-detail__panel browse-detail__panel--thumbnail">
      <h2>Thumbnail</h2>
      <div class="browse-detail__body">
        ${renderThumbnail(item, 'detail')}
        <p class="browse-thumb-caption">${escapeHtml(caption)}</p>
        ${thumbnail.kind === 'asset' && thumbnail.url ? `<p class="browse-thumb-caption"><a href="${escapeAttr(versionedThumbnailUrl(thumbnail.url))}" target="_blank" rel="noopener noreferrer">Open thumbnail at actual size</a></p>` : ''}
        ${thumbnail.kind === 'external' && thumbnail.url ? `<p class="browse-thumb-caption"><a href="${escapeAttr(thumbnail.url)}" target="_blank" rel="noopener noreferrer">Open external thumbnail</a></p>` : ''}
      </div>
    </section>
  `;
}

function normalizedThumbnail(item) {
  const thumbnail = item.thumbnail || fallbackThumbnail(item);
  if (thumbnail?.kind === 'placeholder' && (item?.type === 'map' || item?.type === 'data-entry')) {
    return fallbackThumbnail(item);
  }
  return thumbnail;
}

function fallbackThumbnail(item) {
  if (item?.type === 'register-interest') {
    return {
      kind: 'placeholder',
      label: 'RI',
      type: 'register-interest'
    };
  }
  if (item?.type === 'map' || item?.type === 'data-entry' || item?.category || item?.parentCard) {
    return {
      kind: 'map-fallback',
      label: item.category || item.parentCard || 'Map',
      alt: `${item.title || item.name || item.id || 'Map'} preview`,
      type: 'map'
    };
  }
  return {
    kind: 'placeholder',
    label: thumbnailInitials(item.title || item.name || item.id || item.key || 'C'),
    type: item.type || 'entry'
  };
}

function renderMapFallbackSvg(item, thumbnail) {
  const color = mapFallbackColor(item);
  const label = thumbnail.label || item.category || item.parentCard || 'Map';
  const title = item.title || item.name || item.id || 'Map';
  return `
    <svg class="browse-map-fallback-svg" viewBox="0 0 120 120" role="img" aria-labelledby="map-fallback-${escapeAttr(slugify(title))}">
      <title id="map-fallback-${escapeAttr(slugify(title))}">${escapeHtml(title)} map preview</title>
      <rect width="120" height="120" rx="8" fill="#f8fafc"/>
      <path d="M0 75 C18 68 31 73 46 66 C59 60 67 44 82 40 C98 35 108 44 120 38 L120 120 L0 120 Z" fill="#d7dce2"/>
      <path d="M76 13 C87 18 94 27 96 40 C99 57 88 70 76 80 C65 89 50 87 41 76 C31 64 31 49 38 36 C46 21 60 8 76 13 Z" fill="#c9d0d8" stroke="#aeb8c2" stroke-width="1"/>
      <path d="M42 26 C50 34 48 46 41 55 C33 65 21 63 16 52 C10 39 18 24 31 21 C35 20 39 22 42 26 Z" fill="#c9d0d8" stroke="#aeb8c2" stroke-width="1"/>
      <path d="M55 52 C58 56 57 62 52 65 C47 67 42 64 41 59 C40 53 45 49 50 49 C52 49 54 50 55 52 Z" fill="#c9d0d8" stroke="#aeb8c2" stroke-width="1"/>
      <path d="M14 77 C24 72 34 76 46 70 C58 64 67 55 81 52 C94 49 104 54 114 50" fill="none" stroke="#aeb8c2" stroke-width="1" opacity=".7"/>
      <path d="M20 82 C31 79 38 84 50 78 C63 72 71 63 86 61 C99 59 107 63 117 60" fill="none" stroke="#aeb8c2" stroke-width="1" opacity=".45"/>
      <circle cx="60" cy="60" r="25" fill="${escapeAttr(color)}" opacity=".12"/>
      <path d="M35 74 C47 58 54 49 71 43 C82 40 91 41 101 45" fill="none" stroke="${escapeAttr(color)}" stroke-width="3" stroke-linecap="round" opacity=".9"/>
      <path d="M31 84 C42 78 52 79 63 72 C74 65 80 58 92 57" fill="none" stroke="${escapeAttr(color)}" stroke-width="2" stroke-linecap="round" opacity=".75"/>
      <rect x="8" y="91" width="104" height="21" rx="5" fill="rgba(255,255,255,.86)"/>
      <text x="60" y="104" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700" fill="#334155">${escapeHtml(truncate(label, 24))}</text>
    </svg>
  `;
}

function mapFallbackColor(item) {
  const source = item.rawMetadata?.style?.color || item.color || '';
  if (/^#[0-9a-f]{6}$/i.test(source)) return source;
  const palette = ['#2563eb', '#059669', '#7c3aed', '#dc2626', '#0891b2', '#ca8a04'];
  const seed = String(item.categoryId || item.category || item.parentCard || item.id || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[seed % palette.length];
}

function thumbnailInitials(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'C';
}

function renderTechnicalPanel(type, item) {
  // Internal ids and source-map wiring are for the people who maintain the records; a reader
  // saw "Technical data" at the foot of every page.
  if (!state.auth?.allowed) return '';
  const technicalRows = technicalFieldEntries(type, item);
  // A wholesale field dump and the inline raw JSON each re-list the entire
  // record, duplicating fields the curated panels already show. Keep raw JSON
  // only for signed-in contributors (who need it to debug source-map wiring);
  // regular readers get just the curated internal-ID fields.
  const showRaw = Boolean(state.auth?.allowed) && Boolean(item.rawMetadata);
  const rawJson = showRaw ? JSON.stringify(item.rawMetadata, null, 2) : '';
  if (!technicalRows.length && !rawJson) return '';
  return `
    <section class="browse-detail__panel browse-detail__panel--technical">
      <details class="browse-technical">
        <summary>
          <span>Technical data</span>
          <small>Internal IDs and source-map wiring${rawJson ? ', plus raw JSON' : ''}</small>
        </summary>
        <div class="browse-technical__body">
          ${technicalRows.length ? renderTechnicalTable('Technical fields', technicalRows) : ''}
          ${rawJson ? `
            <section class="browse-technical__raw">
              <h3>Raw source metadata</h3>
              <pre class="browse-field-json">${escapeHtml(rawJson)}</pre>
            </section>
          ` : ''}
        </div>
      </details>
    </section>
  `;
}

function technicalFieldEntries(type, item) {
  const entries = Object.entries(item)
    .filter(([key, value]) => isTechnicalField(type, key, value))
    .map(([key, value]) => [humanizeKey(key), renderFieldValue(value)]);
  return entries;
}

function isTechnicalField(type, key, value) {
  if (isEmptyValue(value)) return false;
  if (key === 'rawMetadata') return false;
  if (key === 'url') return false;
  if (TECHNICAL_FIELD_KEYS.has(key)) return true;
  if (/^(.*Url|.*Id|.*Key)$/i.test(key)) return true;
  if (/(bbox|bounds|tile|pmtiles|spatial|index|geometry|geojson|mvt|chunk|lod)/i.test(key)) return true;
  if (type === 'maps' && ['featured', 'loadable', 'placeholder', 'slug', 'group', 'keywords', 'status'].includes(key)) return true;
  return false;
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function renderTechnicalTable(title, rows) {
  return `
    <section class="browse-technical__group">
      <h3>${escapeHtml(title)}</h3>
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr(title)}">
        <table class="browse-table browse-table--technical">
          <caption class="visually-hidden">Technical fields</caption>
          <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
          <tbody>${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${value}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderFieldValue(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '';
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return escapeHtml(value.join(', '));
    }
    return `<pre class="browse-field-json">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  }
  if (typeof value === 'object') {
    return `<pre class="browse-field-json">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    return `<a href="${escapeAttr(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
  }
  return escapeHtml(String(value));
}

/**
 * Work out who is signed in.
 *
 * TWO endpoints, and the second one is the load-bearing one.
 *
 * /_api/auth/status sits OUTSIDE the Cloudflare Access application (which covers
 * only `_api/contributions`, so that this page stays public). Access therefore
 * never injects the identity header into it, and it reports authenticated:false
 * for everyone -- including a signed-in contributor. Consulting it alone made
 * the panel show "Log in" immediately after a successful sign-in.
 *
 * /_api/contributions/whoami is inside the application, so it can see the
 * identity. An anonymous visitor gets an opaque redirect to the Access login
 * instead, which is the normal case and not an error -- hence redirect:'manual'
 * rather than letting fetch follow it into a cross-origin failure.
 */
async function refreshAuth() {
  // Public baseline: gives the login/logout URLs and works signed out.
  try {
    const response = await fetch('/_api/auth/status', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    state.auth = data.auth || { authenticated: false, allowed: false };
  } catch {
    state.auth = { authenticated: false, allowed: false, loginUrl: '/_api/contributions/login?return=%2Fbrowse%2F' };
  }

  // Then ask the endpoint that can actually see an Access identity.
  try {
    const response = await fetch('/_api/contributions/whoami', {
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (response.ok) {
      const data = await response.json();
      if (data?.auth) state.auth = { ...state.auth, ...data.auth };
    }
  } catch {
    // Not signed in, or Access is not configured. Keep the public baseline.
  }

  renderContributorPanel();
}

function renderContributorPanel() {
  if (!els.contributorPanel) return;
  const auth = state.auth || {};
  // Titles are not headings: the panel came before the page's h1, so every page's outline
  // opened on "Contributor".
  els.contributorPanel.classList.toggle('contributor-panel--signed-out', !auth.allowed && !auth.authenticated);
  if (auth.allowed) {
    els.contributorPanel.innerHTML = `
      <p class="contributor-panel__title">Contributor</p>
      <p class="contributor-panel__body">Logged in as <span class="contributor-panel__email">${escapeHtml(auth.email || 'contributor')}</span>.</p>
      <div class="contributor-panel__actions">
        <button type="button" class="contributor-btn contributor-btn--primary" data-contributor-action="submit-map">Submit map</button>
        <a class="contributor-btn" href="${escapeAttr(auth.logoutUrl || '/cdn-cgi/access/logout')}">Log out</a>
      </div>
    `;
    return;
  }
  if (auth.authenticated && !auth.allowed) {
    els.contributorPanel.innerHTML = `
      <p class="contributor-panel__title">Contributor</p>
      <p class="contributor-panel__body">Logged in as <span class="contributor-panel__email">${escapeHtml(auth.email || 'unknown')}</span>, but this account is not in the contributor allowlist.</p>
      <div class="contributor-panel__actions">
        <a class="contributor-btn" href="${escapeAttr(auth.logoutUrl || '/cdn-cgi/access/logout')}">Log out</a>
      </div>
    `;
    return;
  }
  // Signed out, the panel is one quiet line at the foot of the sidebar: it was a boxed "Log
  // in" above the sections for every visitor, and only a few contributors ever use it.
  els.contributorPanel.innerHTML = `
    <p class="contributor-panel__body">Contributors can propose corrections and new maps. <a href="${escapeAttr(contributorLoginUrl())}" data-contributor-login>Contributor log in</a></p>
  `;
}

/** The sign-in link, returning to the page the reader is on rather than always to /browse/. */
function contributorLoginUrl() {
  const here = `${location.pathname}${location.search}${location.hash}`;
  return `/_api/contributions/login?return=${encodeURIComponent(here)}`;
}

function handleContributorAction(action) {
  if (action === 'submit-map') {
    openMapSubmissionForm();
    return;
  }
  if (action === 'edit-current') {
    if (!state.currentDetail) return;
    openEditSubmissionForm(state.currentDetail.type, state.currentDetail.item);
  }
}

/**
 * The edit form: every editable field, showing its CURRENT value, edited in place.
 *
 * The first version asked the contributor to pick a field from a dropdown and
 * type its new value into an empty box. That is a poor way to correct a record:
 * you cannot see what the value is now, so you cannot tell whether it is already
 * right, and proposing three corrections meant three separate rows.
 *
 * Showing the record as a form makes the current state visible, which is most of
 * what a corrector needs, and makes the change an ordinary edit. Only fields the
 * contributor actually altered are submitted -- the patch is a DIFF against the
 * values loaded here, not a dump of the form. That also means a form left open
 * while the record changes underneath cannot silently re-assert stale values for
 * fields nobody touched.
 */
async function openEditSubmissionForm(type, item) {
  const entityType = entityTypeForBrowseType(type);
  const entityId = item.id || item.key || item.slug || item.title;
  state.modalMode = 'metadata-edit';
  state.editBaseline = null;
  els.contributorModalTitle.textContent = `Propose edit: ${item.title || entityId}`;
  // Guard first: replacing a dirty form for another record would silently throw
  // away someone's work. Offer the choice inline rather than with a browser
  // dialog, which blocks the page and is worse than the problem.
  if (isEditorDirty() && state.editEntityId && state.editEntityId !== entityId) {
    showDiscardPrompt(entityId, () => openEditSubmissionForm(type, item));
    return;
  }
  state.editEntityId = entityId;

  els.contributorForm.innerHTML = `
    <input type="hidden" name="kind" value="metadata-edit">
    <input type="hidden" name="entityType" value="${escapeAttr(entityType)}">
    <input type="hidden" name="entityId" value="${escapeAttr(entityId)}">
    <label>
      Summary of your changes
      <input name="summary" required maxlength="2000" placeholder="Briefly describe what you are correcting, and why">
    </label>
    <div class="contributor-form__fields" data-edit-fields>
      <p class="contributor-form__hint">Loading current values...</p>
    </div>
    <label>
      Source URLs
      <textarea name="sourceUrls" placeholder="Evidence for the change: one or more URLs, separated by spaces or new lines"></textarea>
    </label>
    <div class="contributor-form__status" aria-live="polite"></div>
    <div class="contributor-panel__actions">
      <button type="submit" class="contributor-btn contributor-btn--primary">Propose these changes</button>
      <button type="button" class="contributor-btn" data-contributor-close>Cancel</button>
    </div>
  `;
  const host = els.contributorForm.querySelector('[data-edit-fields]');
  const status = els.contributorForm.querySelector('.contributor-form__status');

  try {
    const [schema, record] = await Promise.all([
      loadContributorSchema(),
      loadCurrentRecord(entityType, entityId, item),
    ]);
    const fields = schema.entityTypes?.[entityType] || [];
    if (!fields.length) throw new Error(`No editable fields are defined for ${entityType}.`);

    // The baseline is what the diff is taken against. Object arrays are stored
    // as canonical JSON rather than rendered text, because their form state is
    // reassembled from many inputs and only the resulting VALUE is comparable.
    state.editBaseline = {};
    const blocks = [];
    for (const field of fields) {
      const current = record ? record[field.name] : undefined;
      state.editBaseline[field.name] = field.type === 'objectArray'
        ? JSON.stringify(Array.isArray(current) ? current : [])
        : valueToText(current, field.type);
      blocks.push(editFieldHtml(field, current));
    }
    host.innerHTML = blocks.join('');
    state.editFields = fields;

    if (!record) {
      status.className = 'contributor-form__status';
      status.textContent = 'Current values could not be loaded, so every field starts empty. Anything you fill in will be proposed as a change.';
    }
  } catch (error) {
    host.innerHTML = '';
    status.className = 'contributor-form__status contributor-form__status--error';
    status.textContent = error.message;
  }
  showInlineEditor(`Propose edit: ${item.title || entityId}`);
}


/**
 * Show the contributor form inline, above the record it edits.
 *
 * The form element itself is MOVED between the modal panel and the inline slot
 * rather than duplicated, so its submit handler -- bound once at init -- follows
 * it. Two form elements would mean two of everything and a live question about
 * which one els.contributorForm refers to.
 */
function showInlineEditor(title) {
  if (!els.contributorEditor || !els.contributorEditorSlot) return;
  closeContributorModal();
  els.contributorEditorTitle.textContent = title;
  els.contributorEditorSlot.appendChild(els.contributorForm);
  els.contributorEditor.hidden = false;
  state.modalMode = 'metadata-edit';
  els.contributorEditor.scrollIntoView({ block: 'start', behavior: 'smooth' });
  els.contributorForm.querySelector('input:not([type="hidden"]), textarea')?.focus();
}

function closeInlineEditor() {
  if (!els.contributorEditor) return;
  els.contributorEditor.hidden = true;
  els.contributorForm.innerHTML = '';
  state.modalMode = null;
  state.editEntityId = null;
  state.editBaseline = null;
  state.editFields = null;
}

/**
 * Has the contributor actually changed anything?
 *
 * collectPatch throws when nothing differs from the baseline, which is exactly
 * the question being asked -- so the throw is the answer, not an error.
 */
function isEditorDirty() {
  if (!els.contributorEditor || els.contributorEditor.hidden) return false;
  const summary = els.contributorForm.querySelector('[name="summary"]')?.value?.trim();
  if (summary) return true;
  try {
    collectPatch();
    return true;
  } catch {
    return false;
  }
}

/** Ask before discarding unsaved work, without a blocking browser dialog. */
function showDiscardPrompt(nextEntityId, proceed) {
  const existing = els.contributorEditor.querySelector('.contributor-inline__discard');
  existing?.remove();
  const bar = document.createElement('div');
  bar.className = 'contributor-inline__discard';
  bar.innerHTML = `
    <span>You have unsaved changes to <strong>${escapeHtml(state.editEntityId || 'this record')}</strong>.</span>
    <span class="contributor-inline__discard-actions">
      <button type="button" class="contributor-btn contributor-btn--small" data-discard-confirm>Discard and edit ${escapeHtml(nextEntityId)}</button>
      <button type="button" class="contributor-btn contributor-btn--small" data-discard-cancel>Keep editing</button>
    </span>`;
  els.contributorEditor.insertBefore(bar, els.contributorEditor.firstChild);
  els.contributorEditor.scrollIntoView({ block: 'start', behavior: 'smooth' });
  bar.querySelector('[data-discard-confirm]').addEventListener('click', () => {
    bar.remove();
    state.editEntityId = null;
    state.editBaseline = null;
    proceed();
  });
  bar.querySelector('[data-discard-cancel]').addEventListener('click', () => bar.remove());
}

/**
 * The record as it currently stands.
 *
 * For maps the catalogue API is authoritative: it is the same document the
 * server dry-runs the patch against, so what the contributor sees is exactly
 * what their change will be compared with. For other entity types there is no
 * such endpoint yet, so the Browse detail item is a best effort -- field names
 * largely coincide, and anything absent simply starts blank.
 */
async function loadCurrentRecord(entityType, entityId, fallbackItem) {
  if (entityType === 'map') {
    try {
      const response = await fetch(`/_api/catalogue?id=${encodeURIComponent(entityId)}`, { credentials: 'same-origin' });
      if (response.ok) {
        const doc = await response.json();
        const found = (Array.isArray(doc?.maps) ? doc.maps : []).find((m) => m?.id === entityId);
        if (found) return found;
      }
    } catch {
      // fall through to the Browse item
    }
  }
  return fallbackItem || null;
}

/** Render one field as an input appropriate to its declared type. */
function editFieldHtml(field, current) {
  const name = escapeAttr(field.name);
  const label = escapeHtml(field.name);

  if (field.type === 'objectArray') {
    return objectArrayFieldHtml(field, Array.isArray(current) ? current : []);
  }

  const currentText = valueToText(current, field.type);

  if (field.type === 'boolean') {
    // Radio buttons, not a select. Three mutually exclusive states that all fit
    // on one line: showing them is faster to read and to set than opening a
    // dropdown to discover the same three options.
    const state = currentText === 'true' ? 'true' : currentText === 'false' ? 'false' : '';
    const radio = (value, text) => `
        <label class="contributor-form__radio">
          <input type="radio" name="field:${name}" value="${escapeAttr(value)}"
                 data-edit-field="${name}" data-edit-type="boolean"${state === value ? ' checked' : ''}>
          <span>${escapeHtml(text)}</span>
        </label>`;
    return `
      <fieldset class="contributor-form__field contributor-form__field--radio">
        <legend class="contributor-form__field-name">${label}</legend>
        <div class="contributor-form__radios">${radio('', '(not set)')}${radio('true', 'true')}${radio('false', 'false')}</div>
      </fieldset>`;
  }

  const hint = field.type === 'array'
    ? 'One entry per line.'
    : field.type === 'bounds'
      ? 'Four numbers: west, south, east, north.'
      : 'Clear the box to remove this value.';

  const multiline = field.type === 'array' || field.name === 'description';
  if (multiline) {
    return `
      <label class="contributor-form__field">
        <span class="contributor-form__field-name">${label}</span>
        <textarea name="field:${name}" data-edit-field="${name}" data-edit-type="${escapeAttr(field.type)}" rows="3">${escapeHtml(currentText)}</textarea>
        <span class="contributor-form__hint">${hint}</span>
      </label>`;
  }

  return `
    <label class="contributor-form__field">
      <span class="contributor-form__field-name">${label}</span>
      <input type="text" name="field:${name}" data-edit-field="${name}" data-edit-type="${escapeAttr(field.type)}" value="${escapeAttr(currentText)}">
      <span class="contributor-form__hint">${hint}</span>
    </label>`;
}

/**
 * An array of objects (references, sourceDownloads) as repeatable groups.
 *
 * One labelled input per attribute, with Add and Remove. Nobody should have to
 * hand-write JSON in a web form to correct a citation: the previous version
 * rendered these as raw JSON per line, which is a developer's shortcut and
 * invites exactly the malformed input the validator then rejects.
 *
 * Attributes come from the server (schema.attributes), so the inputs offered and
 * the inputs accepted cannot drift.
 */
function objectArrayFieldHtml(field, entries) {
  const name = escapeAttr(field.name);
  const groups = entries.map((entry, index) => objectArrayEntryHtml(field, entry, index)).join('');
  return `
    <fieldset class="contributor-form__field contributor-form__objects" data-object-array="${name}" data-edit-type="objectArray">
      <legend class="contributor-form__field-name">${escapeHtml(field.name)}</legend>
      <div data-object-entries>${groups}</div>
      <button type="button" class="contributor-btn contributor-btn--small" data-object-add="${name}">Add ${escapeHtml(singularise(field.name))}</button>
    </fieldset>`;
}

function objectArrayEntryHtml(field, entry, index) {
  const rows = (field.attributes || []).map((attribute) => {
    const value = entry && entry[attribute.name] !== undefined && entry[attribute.name] !== null
      ? String(entry[attribute.name])
      : '';
    const required = attribute.required ? ' <span class="contributor-form__required">(required)</span>' : '';
    const inputType = attribute.type === 'number' ? 'number' : 'text';
    return `
        <label class="contributor-form__object-attr">
          <span class="contributor-form__attr-name">${escapeHtml(attribute.name)}${required}</span>
          <input type="${inputType}" data-object-attr="${escapeAttr(attribute.name)}"
                 data-attr-type="${escapeAttr(attribute.type)}" value="${escapeAttr(value)}">
        </label>`;
  }).join('');

  return `
      <div class="contributor-form__object" data-object-entry>
        <div class="contributor-form__object-head">
          <span class="contributor-form__object-index">${escapeHtml(singularise(field.name))} ${index + 1}</span>
          <button type="button" class="contributor-btn contributor-btn--small" data-object-remove>Remove</button>
        </div>
        ${rows}
      </div>`;
}

function singularise(name) {
  if (name === 'references') return 'reference';
  if (name === 'sourceDownloads') return 'download';
  return name.replace(/s$/, '');
}

/**
 * Re-number the "reference 1, reference 2" headings after an add or remove, so
 * the labels keep matching the positions the validator will report errors
 * against.
 */
function renumberObjectEntries(fieldset) {
  const singular = singularise(fieldset.dataset.objectArray || '');
  [...fieldset.querySelectorAll('[data-object-entry]')].forEach((entry, index) => {
    const heading = entry.querySelector('.contributor-form__object-index');
    if (heading) heading.textContent = `${singular} ${index + 1}`;
  });
}

/**
 * Wire Add/Remove for object-array fieldsets. Bound ONCE at init.
 *
 * This used to be called from openEditSubmissionForm, which attached a fresh
 * listener every time the form opened -- so the second open added two entries
 * per click on Add, the third added three. The field definitions it needs are
 * read from state rather than captured in the closure, which is what makes a
 * single binding possible.
 */
function bindObjectArrayControls() {
  els.contributorForm.addEventListener('click', (event) => {
    const byName = new Map((state.editFields || []).map((f) => [f.name, f]));
    const addButton = event.target.closest('[data-object-add]');
    if (addButton) {
      const field = byName.get(addButton.dataset.objectAdd);
      const fieldset = addButton.closest('[data-object-array]');
      const host = fieldset?.querySelector('[data-object-entries]');
      if (!field || !host) return;
      host.insertAdjacentHTML('beforeend', objectArrayEntryHtml(field, {}, host.children.length));
      renumberObjectEntries(fieldset);
      return;
    }
    const removeButton = event.target.closest('[data-object-remove]');
    if (removeButton) {
      const fieldset = removeButton.closest('[data-object-array]');
      removeButton.closest('[data-object-entry]')?.remove();
      if (fieldset) renumberObjectEntries(fieldset);
    }
  });
}

/** Read one object-array fieldset back into an array of objects. */
function readObjectArray(fieldset) {
  const entries = [];
  for (const entry of fieldset.querySelectorAll('[data-object-entry]')) {
    const object = {};
    let hasValue = false;
    for (const input of entry.querySelectorAll('[data-object-attr]')) {
      const raw = String(input.value ?? '').trim();
      if (!raw) continue;
      hasValue = true;
      object[input.dataset.objectAttr] = input.dataset.attrType === 'number' ? Number(raw) : raw;
    }
    // A group left entirely blank is someone who clicked Add and changed their
    // mind. Dropping it is kinder than failing the whole submission on it.
    if (hasValue) entries.push(object);
  }
  return entries;
}


/** Render a stored value as the text the form shows for it. */
function valueToText(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
  if (type === 'bounds') return Array.isArray(value) ? value.join(', ') : '';
  if (type === 'array') {
    if (!Array.isArray(value)) return '';
    // Plain string arrays. Object arrays are rendered as structured groups by
    // objectArrayFieldHtml and never come through here.
    return value.filter((v) => typeof v === 'string').join('\n');
  }
  return String(value);
}


function openMapSubmissionForm() {
  // Submit map is not tied to a record, so it stays a dialog -- "start something
  // new" is what a modal is for. Move the shared form back into the modal panel.
  closeInlineEditor();
  document.querySelector('.contributor-modal__panel')?.appendChild(els.contributorForm);
  state.modalMode = 'map-submission';
  els.contributorModalTitle.textContent = 'Submit map for review';
  els.contributorForm.innerHTML = `
    <input type="hidden" name="kind" value="map-submission">
    <label>
      Map title
      <input name="title" required maxlength="180" placeholder="e.g. Local Authority Boundaries 1944">
    </label>
    <label>
      Geography
      <input name="geography" maxlength="180" placeholder="Ireland, Northern Ireland, county, council area...">
    </label>
    <label>
      Date range
      <input name="dateRange" maxlength="120" placeholder="e.g. 1944 or 1930-1942">
    </label>
    <label>
      Provider / source
      <input name="provider" maxlength="180" placeholder="OSI, OSNI, CSO, collaborator name, archive...">
    </label>
    <label>
      Proposed catalogue category
      <input name="proposedCategory" maxlength="180" placeholder="Counties, DEAs, Local Government, Sources...">
    </label>
    <label>
      Description
      <textarea name="summary" required placeholder="What is this map, where did it come from, and what should be done with it?"></textarea>
    </label>
    <label>
      Source URLs
      <textarea name="sourceUrls" placeholder="Archive links, cloud-drive links, issue links, or other supporting URLs"></textarea>
      <span class="contributor-form__hint">Binary upload is intentionally not direct-to-production. Use source links for now; an R2 upload flow can be added after review policies are finalised.</span>
    </label>
    <label>
      Notes
      <textarea name="notes" placeholder="Projection, format, licensing, credits, known issues, or conversion notes"></textarea>
    </label>
    <div class="contributor-form__status" aria-live="polite"></div>
    <div class="contributor-panel__actions">
      <button type="submit" class="contributor-btn contributor-btn--primary">Submit map request</button>
      <button type="button" class="contributor-btn" data-contributor-close>Cancel</button>
    </div>
  `;
  openContributorModal();
}

function openContributorModal() {
  els.contributorModal?.classList.remove('hidden');
  els.contributorForm?.querySelector('input:not([type="hidden"]), textarea, select, button')?.focus();
}

function closeContributorModal() {
  els.contributorModal?.classList.add('hidden');
  state.modalMode = null;
}

async function submitContributorForm(event) {
  event.preventDefault();
  const status = els.contributorForm.querySelector('.contributor-form__status');
  const submitButton = els.contributorForm.querySelector('button[type="submit"]');
  status.className = 'contributor-form__status';
  status.textContent = 'Submitting...';
  submitButton.disabled = true;
  try {
    const payload = buildContributorPayload(new FormData(els.contributorForm));
    const response = await fetch('/_api/contributions/submit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      // A 422 carries the dry run, which says exactly which field is wrong.
      // Showing only data.error here would throw that away and leave the
      // contributor with 'Proposed patch failed validation' and no idea why.
      const detail = (data.dryRun?.errors || []).join(' ');
      throw new Error(detail || data.hint || data.error || `${response.status} ${response.statusText}`);
    }
    status.className = 'contributor-form__status contributor-form__status--success';
    const warnings = data.dryRun?.warnings || [];
    status.textContent = `Submitted for review: ${data.submission?.id || 'pending'}.`
      + (warnings.length ? ` Note: ${warnings.join(' ')}` : '')
      + ' Nothing changes on the site until an administrator approves and applies it.';
    announce('Contributor submission sent for review.');
  } catch (error) {
    status.className = 'contributor-form__status contributor-form__status--error';
    status.textContent = error.message;
    announce('Contributor submission failed.');
  } finally {
    submitButton.disabled = false;
  }
}

function buildContributorPayload(formData) {
  const kind = String(formData.get('kind') || '');
  if (kind === 'metadata-edit') {
    return {
      kind,
      entityType: String(formData.get('entityType') || ''),
      entityId: String(formData.get('entityId') || ''),
      summary: String(formData.get('summary') || ''),
      patch: collectPatch(),
      sourceUrls: splitUrls(String(formData.get('sourceUrls') || '')),
      pageUrl: location.href
    };
  }
  return {
    kind: 'map-submission',
    title: String(formData.get('title') || ''),
    summary: String(formData.get('summary') || ''),
    sourceUrls: splitUrls(String(formData.get('sourceUrls') || '')),
    mapRequest: {
      title: String(formData.get('title') || ''),
      geography: String(formData.get('geography') || ''),
      dateRange: String(formData.get('dateRange') || ''),
      provider: String(formData.get('provider') || ''),
      proposedCategory: String(formData.get('proposedCategory') || ''),
      notes: String(formData.get('notes') || '')
    },
    pageUrl: location.href
  };
}

// Editable fields, fetched from /_api/contributions/schema -- the same module
// that validates submissions. Deliberately not hardcoded here: a copy would
// drift, and the drift would surface as somebody else's rejected submission.
let contributorSchema = null;

async function loadContributorSchema() {
  if (contributorSchema) return contributorSchema;
  const response = await fetch('/_api/contributions/schema', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load the list of editable fields.');
  contributorSchema = await response.json();
  return contributorSchema;
}

/** One field row: which field, and its new value, typed appropriately. */
/**
 * Build the patch as a DIFF against the values the form was loaded with.
 *
 * Only fields whose text actually changed are included. That is what makes the
 * batch form safe: the contributor sees and can edit everything, but proposes
 * only what they touched, so a reviewer's diff is exactly the intended change
 * rather than the whole record restated.
 *
 * Emptying a field that had a value proposes null, which the API treats as an
 * explicit clear. Emptying one that was already empty is not a change at all.
 */
function collectPatch() {
  const baseline = state.editBaseline || {};
  const patch = {};
  const problems = [];

  // Object arrays first: their state lives across many inputs, so they are read
  // per fieldset rather than per input.
  for (const fieldset of els.contributorForm.querySelectorAll('[data-object-array]')) {
    const field = fieldset.dataset.objectArray;
    const entries = readObjectArray(fieldset);
    if (JSON.stringify(entries) === String(baseline[field] ?? '[]')) continue;
    patch[field] = entries.length ? entries : null;
  }

  const inputs = els.contributorForm.querySelectorAll('[data-edit-field]');
  const seenRadioGroups = new Set();

  for (const input of inputs) {
    const field = input.dataset.editField;
    const type = input.dataset.editType || 'string';

    // Radio groups: read the checked member once, not once per button.
    if (input.type === 'radio') {
      if (seenRadioGroups.has(field)) continue;
      seenRadioGroups.add(field);
      const checked = els.contributorForm.querySelector(`input[type="radio"][data-edit-field="${field}"]:checked`);
      const nowValue = checked ? String(checked.value) : '';
      if (nowValue === String(baseline[field] ?? '')) continue;
      patch[field] = nowValue === '' ? null : nowValue === 'true';
      continue;
    }

    const now = String(input.value ?? '');
    const before = String(baseline[field] ?? '');
    if (now === before) continue;

    if (!now.trim()) { patch[field] = null; continue; }

    if (type === 'bounds') {
      const numbers = now.split(/[\s,]+/).filter(Boolean).map(Number);
      if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) {
        problems.push(`${field}: needs four numbers (west, south, east, north).`);
        continue;
      }
      patch[field] = numbers;
    } else if (type === 'array') {
      // Plain string arrays only -- keywords and the like. Arrays of objects are
      // handled above as structured groups and never reach this branch.
      patch[field] = now.split('\n').map((line) => line.trim()).filter(Boolean);
    } else {
      patch[field] = now.trim();
    }
  }

  if (problems.length) throw new Error(problems.join(' '));
  if (!Object.keys(patch).length) {
    throw new Error('Nothing has been changed yet. Edit a field, then propose the change.');
  }
  return patch;
}

function splitUrls(value) {
  return value.split(/\s+/).map((url) => url.trim()).filter(Boolean);
}

function entityTypeForBrowseType(type) {
  if (type === 'maps') return 'map';
  if (type === 'elections') return 'election';
  if (type === 'features') return 'feature';
  if (type === 'parties') return 'party';
  if (type === 'persons') return 'person';
  if (type === 'register-interests') return 'register-interest';
  if (type === 'sources') return 'source';
  return null;
}

function announce(message) {
  if (els.announcer) els.announcer.textContent = message;
}

async function renderFeatureGroups(data) {
  const items = filterItems(data.items || [], state.query);
  const selectedId = state.activeId || state.selectedFeatureMap;
  const selected = selectedId ? findItem(items, selectedId) || findItem(data.items || [], selectedId) : null;
  const token = renderSeq;
  const selectedHtml = selected ? await renderFeatureGroupDetail(selected) : '';
  if (token !== renderSeq) return;
  if (selectedId && !selected) {
    renderNotFound(ENTITY_CONFIG.features, selectedId);
    return;
  }
  // A feature group's page is titled by its map, as every other record is by itself; it kept
  // the heading "Features".
  if (selected) setHero(ENTITY_CONFIG.features, { ...selected, description: selected.category || '' });
  els.results.innerHTML = `
    ${selected ? selectedHtml : `
      <p class="browse-note">Each map's boundaries by name, grouped by map.</p>
      ${renderFilterSummary(items.length, data.items?.length || 0)}
      ${renderListPage(items, (entry) => renderCard('features', entry, ENTITY_CONFIG.features))}
    `}
  `;
  if (!selected) {
    state.lastListRender = () => renderFeatureGroups(data);
    announceList(ENTITY_CONFIG.features, items.length);
  } else {
    announce(`Loaded ${selected.title}.`);
  }
}

async function renderFeatureGroupDetail(item) {
  // Only a group with a sidecar file has one to fetch (the build leaves spatialIndexUrl out
  // otherwise); the old code asked for every group's and 404ed on maps like stormont-1929,
  // after which the features table silently vanished.
  let featureData = null;
  if (item.spatialIndexUrl) {
    try {
      featureData = await loadJson(item.spatialIndexUrl);
      state.loadedFeatureMap = item.id;
    } catch {
      featureData = null;
    }
  }
  const allFeatures = featureData?.features || item.sampleFeatures || [];
  const features = filterItems(allFeatures, state.query).slice(0, 500);
  const mapLink = item.mapSlug ? `<a href="#/maps/${encodeURIComponent(item.mapSlug)}" data-browse-link>map's record</a>` : 'map';
  const related = item.relatedElections || [];
  return `
    <div class="browse-detail">
      <div class="browse-actions">
        <a class="browse-btn" href="#/features" data-browse-link>Back to feature groups</a>
        ${item.mapSlug ? `<a class="browse-btn" href="#/maps/${encodeURIComponent(item.mapSlug)}" data-browse-link>Map record</a>` : ''}
        ${item.interactiveUrl ? `<a class="browse-btn browse-btn--primary" href="${escapeAttr(item.interactiveUrl)}">Open source map</a>` : ''}
      </div>
      <section class="browse-detail__panel">
        <div class="browse-detail__body">
          ${renderDefinitionRows([
            ['Features', item.featureCount || null],
            ['Category', item.category],
            ['Elections on this map', item.relatedElectionCount]
          ], 'browse-reader-facts')}
        </div>
      </section>
      ${related.length ? renderTablePanel(
        item.relatedElectionCount > related.length ? `Elections on this map (${formatNumber(related.length)} of ${formatNumber(item.relatedElectionCount)})` : 'Elections on this map',
        ['Date', 'Election'],
        related.map((row) => [
          formatDate(row.date),
          row.key
            ? `<a href="#/elections/${encodeURIComponent(electionSlug(row.key))}" data-browse-link>${escapeHtml(row.title)}</a>`
            : row.interactiveUrl ? `<a href="${escapeAttr(row.interactiveUrl)}">${escapeHtml(row.title)}</a>` : escapeHtml(row.title)
        ])) : ''}
      ${features.length
        ? renderTablePanel('Features', ['Name', 'Bounds'], features.map((feature) => [
          escapeHtml(feature.name || feature.label || 'Unnamed feature'),
          escapeHtml(Array.isArray(feature.bbox) ? feature.bbox.map((value) => Number(value).toFixed(5)).join(', ') : '')
        ]))
        : `<section class="browse-detail__panel"><h2>Features</h2><p class="browse-note">The feature list for this map is not available here. The ${mapLink} has its full features table.</p></section>`}
      ${allFeatures.length > 500 ? `<p class="browse-description">Showing the first 500 of ${formatNumber(allFeatures.length)} features. Use search to narrow the list.</p>` : ''}
      ${renderTechnicalPanel('features', item)}
    </div>
  `;
}

// "1945–1948", "1932" (from that year; the source gives no end), "to 1969", or blank.
function formatHeldYears(row) {
  if (row.start && row.end) return row.start === row.end ? String(row.start) : `${row.start}–${row.end}`;
  if (row.start) return String(row.start);
  if (row.end) return `to ${row.end}`;
  return '';
}

function renderSimpleTable(title, headers, rows, mapper) {
  if (!rows?.length) return '';
  return renderTablePanel(title, headers, rows.map(mapper));
}

function renderCollapsiblePanel(title, bodyHtml, summaryText = '', options = {}) {
  if (!bodyHtml) return '';
  const className = ['browse-detail__panel', 'browse-collapsible-panel', options.className].filter(Boolean).join(' ');
  return `
    <section class="${escapeAttr(className)}">
      <details class="browse-collapsible"${options.open ? ' open' : ''}>
        <summary>
          <span>${escapeHtml(title)}</span>
          ${summaryText ? `<small>${escapeHtml(summaryText)}</small>` : ''}
        </summary>
        ${bodyHtml}
      </details>
    </section>
  `;
}

// A wide table scrolls inside its wrapper, which is a focusable, named region (tabindex,
// role, aria-label) so a keyboard user can scroll it too, as in every table wrapper here.
function renderTablePanel(title, headers, rows) {
  if (!rows?.length) return '';
  return `
    <section class="browse-detail__panel">
      <h2>${escapeHtml(title)}</h2>
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr(title)}">
        <table class="browse-table">
          <thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderInlineTable(title, headers, rows) {
  if (!rows?.length) return '';
  return `
    <section class="browse-inline-table">
      <h3>${escapeHtml(title)}</h3>
      <div class="browse-table-wrap" tabindex="0" role="region" aria-label="${escapeAttr(title)}">
        <table class="browse-table browse-table--compact">
          <thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </section>
  `;
}

// Field-ownership guard: build a set of the (lowercased) labels a higher panel
// has already shown, so secondary panels can drop any field that is a duplicate.
// The first panel to render a field owns it; later panels skip it.
function summaryLabelSet(rows) {
  return new Set(
    (rows || [])
      .filter(([, value]) => !isEmptyValue(value))
      .map(([label]) => String(label).toLowerCase())
  );
}

function renderDefinitionRows(rows, className = 'browse-detail__meta') {
  const filtered = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!filtered.length) return '';
  // Numbers with thousands separators ("14,808", not "14808").
  const text = (value) => (typeof value === 'number' ? formatNumber(value) : String(value));
  return `<dl class="${escapeAttr(className)}">${filtered.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(text(value))}</dd></div>`).join('')}</dl>`;
}

function renderBadges(item) {
  const badges = [];
  if (item.placeholder) badges.push('Placeholder');
  if (item.status) badges.push(statusLabel(item.status));
  if (!badges.length) return '';
  return `<div class="browse-badges">${badges.map((badge) => `<span class="browse-badge">${escapeHtml(badge)}</span>`).join('')}</div>`;
}

/**
 * T2-09: render one page of a listing, with a button for the next.
 *
 * Replaces a hard `.slice(0, 500)` plus a "narrow the search to find more"
 * notice. The notice was honest -- the truncation was never silent -- but there
 * was no way past it, so records 501+ of a section could only be reached by
 * guessing a narrower query. The count line above still reports the true total,
 * so this changes how many you can reach, not what you are told.
 */
function renderListPage(items, renderItem) {
  const shown = Math.min(state.listShown, items.length);
  const remaining = items.length - shown;
  const cards = items.slice(0, shown).map(renderItem).join('');
  const more = remaining > 0
    ? `<div class="browse-load-more">
         <button type="button" class="browse-btn" data-list-load-more>
           Show ${formatNumber(Math.min(LIST_PAGE_SIZE, remaining))} more
         </button>
         <p class="browse-description">Showing ${formatNumber(shown)} of ${formatNumber(items.length)}.</p>
       </div>`
    : '';
  return `<div class="browse-grid">${cards}</div>${more}`;
}

function renderFilterSummary(count, total) {
  const suffix = state.query ? ` matching "${escapeHtml(state.query)}"` : '';
  return `<p class="browse-description">${formatNumber(count)} of ${formatNumber(total)} records${suffix}.</p>`;
}

// Browse indexes that have a D1 endpoint. The rest are still read as static files,
// which is correct: features, maps, elections and parties are small enough that a whole
// index is a reasonable download and the client filters it locally.
const D1_INDEXES = new Set(['persons', 'sources', 'register-interests']);

/**
 * One record from D1, or null to fall back to the static index.
 *
 * Returns null on ANY failure -- a 404, a 500, an outage -- because the caller's fallback
 * is correct in all three cases. Distinguishing them here would only let the page fail
 * where it could instead be slow.
 */
// Returned by fetchIndexRecord when the API answers 404: the record does not exist, which is
// different from the API being unreachable (null), where the static index is the fallback.
const RECORD_NOT_FOUND = Symbol('record not found');

async function fetchIndexRecord(type, id) {
  try {
    const response = await fetch(`/_api/${type}?slug=${encodeURIComponent(id)}`);
    if (response.status === 404) return RECORD_NOT_FOUND;
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.record || null;
  } catch {
    return null;
  }
}

/**
 * One PAGE of an index, from D1.
 *
 * The list view used to load the whole index and filter, sort and slice it in the
 * browser. For sources that is 51 MB before the first card renders. The query, the
 * facet filters, the sort and the paging now all happen in SQL, so the client receives
 * only the page it is about to draw.
 *
 * Returns null on any failure, so the caller can fall back to the static index. That
 * fallback is what keeps a Functions outage slow rather than broken.
 */
async function fetchIndexPage(type, { query, sort, dir, filters, offset, limit }) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (sort) params.set('sort', sort);
  if (dir) params.set('dir', dir);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  for (const [key, value] of Object.entries(filters || {})) {
    for (const one of Array.isArray(value) ? value : [value]) if (one) params.append(key, one);
  }
  try {
    const response = await fetch(`/_api/${type}?${params}`);
    if (!response.ok) return null;
    const payload = await response.json();
    const items = payload[type] || payload.records || null;
    if (!Array.isArray(items)) return null;
    return { items, total: Number(payload.total) || 0, applied: payload.applied || null };
  } catch {
    return null;
  }
}

/** Facet dropdown options, precomputed at import and fetched once per type. */
async function fetchIndexFacets(type) {
  if (state.serverFacets.has(type)) return state.serverFacets.get(type);
  let facets = {};
  try {
    const response = await fetch(`/_api/${type}?facets=1`);
    if (response.ok) facets = (await response.json()).facets || {};
  } catch { /* fall back to no options */ }
  state.serverFacets.set(type, facets);
  return facets;
}

/**
 * Render a listing from D1 rather than from a loaded index.
 *
 * Pages ACCUMULATE: "Show more" fetches the next page and appends, so the rendered list
 * only ever grows, which is what the existing renderListPage()/lastListRender() pair
 * already expects. `append` is false whenever the query, sort or filters change, because
 * those make the previously fetched pages meaningless.
 */
async function renderServerList(type, { append = false } = {}) {
  const config = ENTITY_CONFIG[type];
  const isRegister = type === 'register-interests';
  const isSources = type === 'sources';
  const isPersons = type === 'persons';
  const controls = state.registerInterestControls;
  const token = renderSeq;
  if (!append) els.results.innerHTML = '<div class="browse-loading">Loading browse data...</div>';
  const personFacets = isPersons ? await loadPersonFacets() : null;
  if (token !== renderSeq) return;
  const personSort = isPersons ? listSortOption('persons') : null;
  const request = {
    query: state.query,
    sort: isRegister ? controls.sortKey : personSort?.key || '',
    dir: isRegister ? controls.sortDir : personSort?.dir || '',
    filters: isRegister ? controls.filters : isSources ? state.sourceFilters : isPersons ? personApiFilters(personFacets) : {},
    offset: append ? state.serverList.items.length : 0,
    limit: LIST_PAGE_SIZE,
  };

  let page = await fetchIndexPage(type, request);
  if (token !== renderSeq) return;
  // A People filter or sort the API did not apply -- it predates them, or its table has not
  // been re-imported with their columns -- would show the wrong list under the right heading.
  // The whole index is read and filtered here instead: slower, never wrong.
  if (page && isPersons && !personRequestHonoured(page.applied, request)) page = null;
  // Back to a list the reader had paged into: fetch the pages they had, 200 at a time.
  while (page && !append && page.items.length < Math.min(state.listShown, page.total)) {
    const next = await fetchIndexPage(type, { ...request, offset: page.items.length });
    if (token !== renderSeq) return;
    if (!next?.items?.length) break;
    page.items = [...page.items, ...next.items];
  }
  if (!page) {
    // The endpoint is unavailable. Fall back to the static index, which still works.
    if (isPersons && !append) els.results.innerHTML = '<div class="browse-loading">Loading the full list of people...</div>';
    const data = await loadIndex(type);
    if (token !== renderSeq) return;
    renderList(type, data.items || []);
    return;
  }

  state.serverList = {
    type,
    items: append ? [...state.serverList.items, ...page.items] : page.items,
    total: page.total,
  };

  const items = state.serverList.items;
  const remaining = page.total - items.length;
  const more = remaining > 0
    ? `<div class="browse-load-more">
         <button type="button" class="browse-btn" data-server-load-more>
           Show ${formatNumber(Math.min(LIST_PAGE_SIZE, remaining))} more
         </button>
         <p class="browse-description">Showing ${formatNumber(items.length)} of ${formatNumber(page.total)}.</p>
       </div>`
    : '';

  const facets = (isRegister || isSources) ? await fetchIndexFacets(type) : null;
  if (token !== renderSeq) return;
  // page.total is the count AFTER filtering. The unfiltered total comes from the browse
  // manifest, so the summary can still read "120 of 40,327" rather than "120 of 120" --
  // which would hide the fact that a filter is doing anything.
  const unfiltered = (state.manifest?.counts || {})[type] || page.total;
  els.results.innerHTML = `
    ${isRegister ? renderRegisterInterestControls(null, page.total, unfiltered, facets) : ''}
    ${isSources ? renderSourceControls(page.total, unfiltered, facets) : ''}
    ${isPersons ? renderListFilterControls('persons', null, personFacets?.facets || {}) : ''}
    ${renderFilterSummary(page.total, unfiltered)}
    <div class="browse-grid">${items.map((item) => renderCard(type, item, config)).join('')}</div>
    ${more}
  `;
  state.lastListRender = () => renderServerList(type);
  announceList(config, page.total);
}

/**
 * The People filters as /_api/persons parameters. A party is sent as every spelling of it in
 * the person records (persons-facets.json), which is what the API matches.
 */
function personApiFilters(personFacets) {
  const filters = {};
  for (const [key, value] of Object.entries(state.listFilters.persons || {})) {
    if (!value) continue;
    filters[key] = key === 'party' ? (personFacets?.partyNames?.get(value) || [value]) : value;
  }
  return filters;
}

/** Whether a page from /_api/persons applied every filter and the sort it was asked for. */
function personRequestHonoured(applied, request) {
  const asked = Object.keys(request.filters || {});
  const sort = request.sort || '';
  if (applied) {
    return asked.every((key) => normalizeArray(applied.filters).includes(key)) && (!sort || applied.sort === sort);
  }
  // persons-4, before `applied`: it sorted by name and by first or last year, and matched a
  // party only on its own (the search, other filters and sort were then ignored).
  if (!asked.length) return !sort || PERSON_SORTS_BEFORE_APPLIED.has(sort);
  return asked.length === 1 && asked[0] === 'party' && !sort && !request.query;
}

/**
 * Every name a party is known by, folded, to its slug (data/browse/party-names.json, about
 * 40 KB): party names in a person's elections, a contest's candidates and an election's party
 * table were plain text, though each party has a page.
 */
async function loadPartyNames() {
  if (!state.partyNames) {
    state.partyNames = loadJson(`${DATA_ROOT}/party-names.json`).then((payload) => payload.items || {}).catch(() => ({}));
  }
  state.partyNames = await state.partyNames;
  return state.partyNames;
}

/** A party name as a link to its page when the party is known, else as text. `inner` is the HTML shown. */
function partyLinkHtml(name, inner = escapeHtml(name || '')) {
  const names = state.partyNames && typeof state.partyNames.then !== 'function' ? state.partyNames : null;
  // Folded as build-browse-indexes.mjs normalizeName folds the keys.
  const key = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const slug = key ? names?.[key] : '';
  return slug ? `<a href="#/parties/${encodeURIComponent(slug)}" data-browse-link>${inner}</a>` : inner;
}

/**
 * One election or constituency result without the elections index. A contest is found through
 * election-contest-parents.json and its election's contest file; an election from its detail
 * file. Returns null when neither has it, and the caller falls back to the index.
 */
/**
 * The election a contest slug belongs to: from the small file its slug hashes to
 * (election-contest-parents/<bucket>.json, about 20 KB), or from the whole 1.2 MB map when an
 * older build wrote only that.
 */
async function electionContestParent(slug) {
  const bucket = String(lookupBucket(slug, ELECTION_CONTEST_PARENT_BUCKETS)).padStart(4, '0');
  try {
    const items = (await loadJson(`${DATA_ROOT}/election-contest-parents/${bucket}.json`)).items || {};
    return items[slug] || null;
  } catch {
    state.electionContestParents ||= (await loadJson(`${DATA_ROOT}/election-contest-parents.json`)).items || {};
    return state.electionContestParents[slug] || null;
  }
}

// Must equal CONTEST_PARENT_BUCKETS in scripts/build-browse-indexes.mjs.
const ELECTION_CONTEST_PARENT_BUCKETS = 64;

async function loadElectionRecord(id) {
  let slug = String(id || '');
  try { slug = decodeURIComponent(slug); } catch { /* keep as is */ }
  // An election's key ("dail-eireann__2024-11-29", from an older link or the graph) is its slug
  // with "__" made "-".
  if (slug.includes('__')) slug = slugify(slug);
  try {
    const parent = await electionContestParent(slug);
    if (parent) {
      const shard = await loadJson(`${DATA_ROOT}/details/election-contests/${encodeURIComponent(parent)}.json`);
      return (shard.items || []).find((entry) => entry.slug === slug) || null;
    }
    const detail = await loadJson(`${DATA_ROOT}/details/elections/${encodeURIComponent(slug)}.json`);
    if (!detail?.item) return null;
    state.details.set(`elections:${detail.item.slug || slug}`, detail);
    return detail.item;
  } catch {
    return null;
  }
}

async function loadIndex(type, { list = false } = {}) {
  const config = ENTITY_CONFIG[type];
  if (list && config.listIndex) {
    const cacheKey = `${type}:list`;
    if (state.indexes.has(cacheKey)) return state.indexes.get(cacheKey);
    if (state.indexes.has(type)) return state.indexes.get(type);
    try {
      const listData = expandElectionList(await loadJson(`${DATA_ROOT}/${config.listIndex}`));
      state.indexes.set(cacheKey, listData);
      return listData;
    } catch {
      // No list index (an older build): the full index still lists everything.
    }
  }
  if (state.indexes.has(type)) return state.indexes.get(type);
  const data = await loadJson(`${DATA_ROOT}/${config.index}`);
  if (data.indexLayout === 'sharded' && Array.isArray(data.shards)) {
    const shardData = await Promise.all(data.shards.map((shard) => loadJson(shard.url)));
    data.items = shardData.flatMap((shard) => Array.isArray(shard.items) ? shard.items : []);
  }
  state.indexes.set(type, data);
  return data;
}

/**
 * elections-list.json carries each contest as its title, slug and constituency with `of`, the
 * place of its election in the list; the date, body, kind, status, thumbnail and map link are
 * its election's and are copied back here, so cards, filters and search see whole items.
 */
function expandElectionList(data) {
  const thumbnails = data.thumbnails || {};
  const items = data.items || [];
  for (const item of items) {
    if (item.thumb && thumbnails[item.thumb]) item.thumbnail = thumbnails[item.thumb];
  }
  for (const item of items) {
    const parent = Number.isInteger(item.of) ? items[item.of] : null;
    if (!parent) continue;
    item.entryKind = item.result === 'overall' ? 'election-overall-result' : 'election-constituency-result';
    item.parentTitle = parent.title;
    item.subtitle = `${item.result === 'overall' ? 'Overall result' : item.result === 'regional-list' ? 'Regional list result' : 'Constituency result'}: ${parent.title}`;
    for (const key of ['date', 'decade', 'body', 'kind', 'status', 'thumbnail', 'interactiveUrl']) {
      if (parent[key] !== undefined && item[key] === undefined) item[key] = parent[key];
    }
  }
  return { ...data, items };
}

async function loadDetail(type, item) {
  const config = ENTITY_CONFIG[type];
  if (!config.detailDir) return { item };
  if (type === 'elections' && item.entryKind && item.entryKind !== 'election') return { item };
  const slug = item.slug || slugify(item.id || item.key || item.title);
  const cacheKey = `${type}:${slug}`;
  if (state.details.has(cacheKey)) return state.details.get(cacheKey);
  let detail;
  try {
    if (item.detailUrl) {
      detail = await loadShardDetail(item, slug);
    } else {
      detail = await loadJson(`${DATA_ROOT}/details/${config.detailDir}/${encodeURIComponent(slug)}.json`);
    }
  } catch (error) {
    if (type === 'elections' && error.status === 404) {
      detail = { item };
    } else {
      throw error;
    }
  }
  state.details.set(cacheKey, detail);
  return detail;
}

async function loadShardDetail(item, slug) {
  const shardUrl = item.detailUrl;
  const shardCacheKey = `source-shard:${shardUrl}`;
  let shard = state.details.get(shardCacheKey);
  if (!shard) {
    shard = await loadJson(shardUrl);
    state.details.set(shardCacheKey, shard);
  }
  const items = Array.isArray(shard?.items)
    ? shard.items
    : Array.isArray(shard?.interests)
      ? shard.interests
      : [];
  const match = items.find((candidate) => (
    String(candidate.slug || '').toLowerCase() === String(slug || '').toLowerCase() ||
    String(candidate.id || '').toLowerCase() === String(item.id || '').toLowerCase()
  ));
  if (!match) {
    const error = new Error(`Source detail ${slug} was not found in ${shardUrl}`);
    error.status = 404;
    error.url = shardUrl;
    throw error;
  }
  return { schemaVersion: shard.schemaVersion || 1, generatedAt: shard.generatedAt, item: { ...item, ...match } };
}

async function loadJson(url, init = undefined) {
  const requestUrl = versionBrowseDataUrl(url);
  // The browser's own cache, not no-store: the host answers max-age=0, must-revalidate, so a
  // revisit asks whether the file changed and gets a 304 instead of downloading megabytes again.
  const response = await fetch(requestUrl, init);
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText} for ${url}`);
    error.status = response.status;
    error.url = requestUrl;
    throw error;
  }
  return response.json();
}

function versionBrowseDataUrl(url) {
  if (!url || typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin && /\/data\//.test(parsed.pathname)) {
      parsed.searchParams.set('v', BROWSE_DATA_VERSION);
      return parsed.href;
    }
  } catch {
    return url;
  }
  return url;
}

function filterItems(items, query) {
  if (!query) return [...items];
  // Fadas and other accents are folded on both sides, and every word must appear somewhere:
  // most readers type "Micheal Martin" or "fianna fail", which matched nothing before.
  const phrase = normalizeSearchQuery(query);
  const words = phrase.split(/\s+/).filter(Boolean);
  const matches = items.filter((item) => {
    const text = searchableText(item);
    return words.every((word) => text.includes(word));
  });
  // A record whose own title is the phrase, then one whose title contains it, before records
  // found only through an alias ("Ulster DUP" must not put the DUP above the UUP).
  const rank = (item) => {
    const titles = [item.title || item.name, item.shortName].filter(Boolean).map(normalizeSearchQuery);
    return titles.includes(phrase) ? 0 : titles.some((title) => title.includes(phrase)) ? 1 : 2;
  };
  return matches.map((item, index) => [rank(item), index, item]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , item]) => item);
}

function searchableText(item) {
  return [
    item.id,
    item.key,
    item.title,
    item.name,
    item.subtitle,
    item.description,
    item.category,
    item.group,
    item.provider,
    item.body,
    item.date,
    item.status,
    item.canonicalName,
    item.observedNames,
    item.knownAliases,
    item.shortName,
    item.memberName,
    item.memberType,
    item.electedBody,
    item.chamber,
    item.jurisdiction,
    item.constituency,
    item.constituencies,
    item.categories,
    item.parties,
    item.sourceTitle,
    item.sourceTitles,
    item.sourceKind,
    item.sourceKinds,
    item.interestSummary,
    item.interestText,
    item.keywords
  ].flat().filter(Boolean).join(' ').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function findItem(items, id) {
  const needle = decodeURIComponent(id || '').toLowerCase();
  // previousSlugs keeps links from an earlier id scheme working. Person slugs changed
  // when candidacies gained registry ids, and these are hash URLs, so the server never
  // sees the slug and a redirect could not catch them. Matched last, so a current slug
  // always wins over another record's old one.
  return items.find((item) => String(item.slug || '').toLowerCase() === needle
      || String(item.id || '').toLowerCase() === needle
      || String(item.key || '').toLowerCase() === needle)
    || items.find((item) => (item.previousSlugs || [])
      .some((slug) => String(slug || '').toLowerCase() === needle));
}

function metaForItem(type, item) {
  if (type === 'elections') return [formatDate(item.date), item.body, String(item.subtitle || '').replace(/^1 constituencies\b/, '1 constituency'), item.geography];
  if (type === 'features') return [item.category, item.featureCount ? countText(item.featureCount, 'feature') : null, item.relatedElectionCount ? countText(item.relatedElectionCount, 'election') : null];
  // The subtitle already says the years and the number of linked elections; the counts that
  // followed repeated it ("26 contests 26 contests").
  if (type === 'parties') return [item.subtitle, item.occurrenceCount ? countText(item.occurrenceCount, 'candidacy', 'candidacies') : null];
  if (type === 'persons') return [item.subtitle, item.totals?.elected !== undefined ? `${formatNumber(item.totals.elected)} elected` : null];
  if (type === 'register-interests') return [
    formatDate(item.date),
    item.electedBody || item.memberType,
    item.constituency || joinList(item.constituencies),
    item.interestCount ? `${formatNumber(item.interestCount)} interests` : item.category,
    item.sourceCount ? `${formatNumber(item.sourceCount)} source rows` : null
  ];
  if (type === 'sources') return [sourceTypeLabel(item.type), item.category, formatDate(item.date)];
  return [item.category, item.group, item.subtitle];
}

/** "1969–2007", or one year, or blank. */
function yearRange(first, last) {
  if (!first && !last) return '';
  if (!first || !last || first === last) return String(first || last);
  return `${first}–${last}`;
}

/** "1 contest", "26 contests": a count with its noun in the right number. */
function countText(count, singular, plural = `${singular}s`) {
  const number = Number(count) || 0;
  return `${formatNumber(number)} ${number === 1 ? singular : plural}`;
}

function summaryForItem(type, item) {
  // The subtitle already gives an election's number of constituencies.
  if (type === 'elections') return '';
  if (type === 'features') return item.spatialIndexUrl ? `The ${item.title} features, by name and extent.` : 'No feature list here; the map record has its features table.';
  if (type === 'parties') return item.relatedElectionCount ? `In the party tables of ${countText(item.relatedElectionCount, 'election')}.` : '';
  if (type === 'persons') return joinList(item.parties?.slice(0, 3).map((party) => party.name));
  if (type === 'register-interests') return item.interestSummary || item.description || joinList(item.categories);
  if (type === 'sources') return item.description || joinList(item.downloads?.slice(0, 2).map((link) => link.label));
  return item.subtitle;
}

// The build's status words, in a reader's: "available" said nothing about what was available.
const STATUS_LABELS = {
  available: 'On the interactive map',
  'metadata only': 'Not on the map',
  'not yet converted': 'Not yet on the map'
};

function statusLabel(value) {
  return STATUS_LABELS[String(value || '').toLowerCase()] || value || '';
}

// A source's pipeline type ("approved-table-source") as the kind of thing it is.
const SOURCE_TYPE_LABELS = {
  'approved-table-source': 'Table',
  'approved-source-reference-source': 'Reference',
  'approved-medium-priority-source': 'Dataset',
  'approved-book-or-report-source': 'Book or report',
  'approved-variant-source': 'Variant of another source',
  'approved-spatial-source-source': 'Spatial dataset',
  'election-source': 'Election results',
  'map-source': 'Map source file',
  'raw-source-table': 'Table',
  'raw-source-document': 'Document',
  'raw-source-source': 'Source file',
  'internet-archive-raster-map': 'Scanned map',
  'register-source-document': 'Register document',
  'register-source-dataset': 'Register dataset',
  'register-source-collection': 'Register collection',
  'wikipedia-article': 'Wikipedia article',
  'image-source': 'Image',
  'document-source': 'Document',
  'dataset-source': 'Dataset',
  'table-source': 'Table',
  'already-on-site-enrichment-source': 'Source note',
  table: 'Table',
  book: 'Book'
};

function sourceTypeLabel(value) {
  const text = String(value || '');
  if (!text) return '';
  if (SOURCE_TYPE_LABELS[text]) return SOURCE_TYPE_LABELS[text];
  if (/^peatland-geoportal/.test(text)) return 'Peatland Geoportal source';
  const words = text.replace(/^approved-/, '').replace(/-source$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Publication-pipeline states, as what they mean for a reader. Filter values stay the codes the
// API accepts; only the words shown change.
function publicationStatusLabel(value) {
  const text = String(value || '');
  if (!text) return '';
  if (/review-only|duplicate-review/.test(text)) return 'Under review';
  if (/raw-source-mirrored-internet-archive/.test(text)) return 'Source copy kept (Internet Archive)';
  if (/external-reference-live-link-only/.test(text)) return 'Link to the source only';
  if (/source-copy-in-repo-archive/.test(text)) return 'Source copy kept';
  if (/staged/.test(text)) return 'Being prepared';
  if (/approval-ready|approved|published|enriched|source-record/.test(text)) return 'Published';
  return text.replace(/-/g, ' ');
}

function licenceText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.status ? `${value.status.replace(/-/g, ' ')}${value.note ? ` (${value.note})` : ''}` : '';
}

function renderMeta(parts) {
  return parts.filter((part) => part !== null && part !== undefined && part !== '').map((part) => `<span>${escapeHtml(String(part))}</span>`).join('');
}

function cleanStatus(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeSearchQuery(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function joinList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value || '';
}

function normalizeArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function formatDate(value) {
  if (!value) return '';
  // A date known only to the year ("1961", an election whose day the source does not give)
  // reads "1961": parsed as a date it became a false "1 Jan 1961".
  if (/^\d{4}$/.test(String(value).trim())) return String(value).trim();
  // A date known only to the month ("1884-10", from a reference work) reads "Oct 1884".
  const month = /^(\d{4})-(\d{2})$/.exec(String(value));
  if (month) return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month[2]) - 1]} ${month[1]}`;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  // "1 Jan 1950", as everywhere on the site (src/date-format.mjs): no zero-padded day, and a
  // fixed month list because en-GB's short month for September is "Sept".
  return `${date.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** A count for a table cell: "–" when it is missing, or when it is 0 but cannot be (`zeroIsUnknown`). */
function knownCount(value, zeroIsUnknown) {
  if (value === null || value === undefined || value === '') return '–';
  if (zeroIsUnknown && Number(value) === 0) return '–';
  return formatNumber(value);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value === null || value === undefined ? '' : String(value);
  return new Intl.NumberFormat('en-GB').format(number);
}

function truncate(value, maxLength = 32) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

function humanizeKey(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function fileName(value) {
  const text = String(value || '');
  return text.split(/[\\/]/).pop()?.split('?')[0] || text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
