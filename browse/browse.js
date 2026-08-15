const DATA_ROOT = '../data/browse';
const GRAPH_ROOT = '../data/graph';
const BROWSE_DATA_VERSION = '20260702-proni-4';
const THUMBNAIL_ASSET_VERSION = '20260604-tight-admin-frame';
const ENTITY_CONFIG = {
  maps: { label: 'Maps', singular: 'Map', index: 'maps.json', detailDir: 'maps', action: 'Open in interactive map' },
  elections: { label: 'Elections', singular: 'Election', index: 'elections.json', detailDir: 'elections', action: 'Open election layer' },
  features: { label: 'Features', singular: 'Feature group', index: 'features.json', detailDir: null, action: 'Open source map' },
  parties: { label: 'Parties / Labels', singular: 'Party / label', index: 'parties.json', detailDir: 'parties' },
  persons: { label: 'Persons', singular: 'Person', index: 'persons.json', detailDir: null },
  'register-interests': { label: 'Register Interests', singular: 'Register interest', index: 'register-interests.json', detailDir: 'register-interests' },
  sources: { label: 'Books / Tables / Sources', singular: 'Source', index: 'sources.json', detailDir: 'sources' },
  proni: { label: 'PRONI Records', singular: 'PRONI record', index: 'proni.json', detailDir: 'proni' }
};

const REGISTER_INTEREST_SORT_OPTIONS = [
  { key: 'date', label: 'Date' },
  { key: 'memberName', label: 'Politician' },
  { key: 'electedBody', label: 'Body' },
  { key: 'constituency', label: 'Constituency' },
  { key: 'interestCount', label: 'Interests' },
  { key: 'sourceCount', label: 'Sources' }
];

const REGISTER_INTEREST_FILTERS = [
  { key: 'electedBody', label: 'Body' },
  { key: 'memberType', label: 'Member type' },
  { key: 'chamber', label: 'Chamber' },
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
const GRAPH_HEADER_PINNED_PROPERTIES = [
  'cg:property:instance-of',
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

const state = {
  manifest: null,
  isHome: true,
  activeType: 'maps',
  activeId: null,
  query: '',
  indexes: new Map(),
  details: new Map(),
  featureTables: {},
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
  menuBtn: document.getElementById('browseMenuBtn'),
  mobileMenu: document.getElementById('browseMobileMenu'),
  contributorPanel: document.getElementById('contributorPanel'),
  contributorModal: document.getElementById('contributorModal'),
  contributorForm: document.getElementById('contributorForm'),
  contributorModalTitle: document.getElementById('contributorModalTitle')
};

init().catch((error) => {
  console.error(error);
  els.results.innerHTML = `<div class="browse-empty">Browse data could not be loaded: ${escapeHtml(error.message)}</div>`;
});

async function init() {
  state.manifest = await loadJson(`${DATA_ROOT}/index.json`);
  bindEvents();
  await refreshAuth();
  renderGroups();
  applyRoute();
  window.addEventListener('hashchange', applyRoute);
}

function bindEvents() {
  els.search?.addEventListener('input', () => {
    state.query = els.search.value.trim();
    renderCurrent();
  });

  els.menuBtn?.addEventListener('click', () => {
    const open = els.mobileMenu.classList.toggle('hidden') === false;
    els.menuBtn.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (event) => {
    const portalJump = event.target.closest('[data-portal-jump]');
    if (portalJump) {
      event.preventDefault();
      const target = document.querySelector(portalJump.getAttribute('href'));
      target?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
      els.mobileMenu?.classList.add('hidden');
      els.menuBtn?.setAttribute('aria-expanded', 'false');
      return;
    }
    if (els.mobileMenu && !els.mobileMenu.classList.contains('hidden') && !event.target.closest('.mobile-menu') && !event.target.closest('.mobile-menu-btn')) {
      els.mobileMenu.classList.add('hidden');
      els.menuBtn?.setAttribute('aria-expanded', 'false');
    }

    const registerSort = event.target.closest('[data-register-sort]');
    if (registerSort) {
      event.preventDefault();
      state.registerInterestControls.sortKey = registerSort.dataset.registerSort || 'date';
      renderCurrent();
      return;
    }

    const registerDirection = event.target.closest('[data-register-direction]');
    if (registerDirection) {
      event.preventDefault();
      state.registerInterestControls.sortDir = registerDirection.dataset.registerDirection === 'asc' ? 'asc' : 'desc';
      renderCurrent();
      return;
    }

    const clearRegisterFilters = event.target.closest('[data-register-clear-filters]');
    if (clearRegisterFilters) {
      event.preventDefault();
      state.registerInterestControls.filters = {};
      renderCurrent();
      return;
    }

    const contributorAction = event.target.closest('[data-contributor-action]');
    if (contributorAction) {
      event.preventDefault();
      handleContributorAction(contributorAction.dataset.contributorAction);
      return;
    }

    if (event.target.closest('[data-contributor-close]')) {
      closeContributorModal();
    }
  });

  document.addEventListener('change', (event) => {
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
    renderCurrent();
  });

  els.contributorForm?.addEventListener('submit', submitContributorForm);
}

function applyRoute() {
  const route = parseRoute();
  state.isHome = route.isHome;
  state.activeType = route.type;
  state.activeId = route.id;
  state.selectedFeatureMap = route.params.get('map');
  if (route.params.has('q')) {
    state.query = route.params.get('q').trim();
    if (els.search) els.search.value = state.query;
  }
  renderGroups();
  renderCurrent();
}

function parseRoute() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const parts = hash.split('/').filter(Boolean);
  const params = new URLSearchParams(location.search);
  const hasExplicitType = params.has('type') || parts.length > 0;
  if (!hasExplicitType) {
    return { isHome: true, type: 'maps', id: null, params };
  }
  let type = params.get('type') || parts[0] || 'maps';
  let id = params.get('id') || parts[1] || null;
  if (type === 'people') type = 'persons';
  if (type === 'entities') return { isHome: false, type, id, params };
  if (!ENTITY_CONFIG[type]) type = 'maps';
  return { isHome: false, type, id, params };
}

function renderGroups() {
  const counts = state.manifest?.counts || {};
  els.groups.innerHTML = (state.manifest?.groups || []).map((group) => {
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
}

function countForGroup(id, counts) {
  if (id === 'features') return counts.featureGroups || counts.features || 0;
  return counts[id] || 0;
}

async function renderCurrent() {
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
  const data = await loadIndex(state.activeType);
  if (state.activeType === 'features') {
    await renderFeatureGroups(data);
    return;
  }
  if (state.activeId) {
    const item = findItem(data.items || [], state.activeId);
    if (!item) {
      els.results.innerHTML = `<div class="browse-empty">${escapeHtml(config.singular)} not found.</div>`;
      return;
    }
    await renderDetail(state.activeType, item);
    return;
  }
  renderList(state.activeType, data.items || []);
}

function setPortalHero() {
  const counts = state.manifest?.counts || {};
  const total = (counts.maps || 0)
    + (counts.elections || 0)
    + (counts.featureGroups || 0)
    + (counts.parties || 0)
    + (counts.persons || 0)
    + (counts['register-interests'] || 0)
    + (counts.sources || 0);
  els.hero.innerHTML = `
    <p class="browse-kicker">Browse</p>
    <h1 class="browse-title">Civgraph data directory</h1>
    <p class="browse-description">A structured portal into maps, elections, boundary features, parties and labels, people, books, tables, downloads, and source records. Use the directory below to browse by subject, or search within a chosen section.</p>
    <div class="browse-portal-stats" aria-label="Browse totals">
      ${renderPortalStat('Maps', counts.maps)}
      ${renderPortalStat('Elections', counts.elections)}
      ${renderPortalStat('Feature groups', counts.featureGroups)}
      ${renderPortalStat('Parties / labels', counts.parties)}
      ${renderPortalStat('Persons', counts.persons)}
      ${renderPortalStat('Register interests', counts['register-interests'])}
      ${renderPortalStat('Sources', counts.sources)}
      ${renderPortalStat('Total entries', total)}
    </div>
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
  const counts = state.manifest?.counts || {};
  return [
    {
      id: 'maps',
      title: 'Maps',
      href: '#/maps',
      count: counts.maps,
      summary: 'Catalogue entries, map metadata, downloads, source credits, and interactive-map links.',
      columns: [
        { heading: 'Historic geographies', links: [['Townlands', '#/maps'], ['Civil parishes', '#/maps'], ['Baronies', '#/maps'], ['Counties', '#/maps'], ['Provinces', '#/maps']] },
        { heading: 'Electoral boundaries', links: [['Dáil constituencies', '#/maps'], ['Westminster constituencies', '#/maps'], ['Assembly constituencies', '#/maps'], ['DEAs and wards', '#/maps']] },
        { heading: 'Reference and open data', links: [['Administrative areas', '#/maps'], ['Settlements', '#/maps'], ['Infrastructure', '#/maps'], ['Environmental datasets', '#/maps']] }
      ]
    },
    {
      id: 'elections',
      title: 'Elections',
      href: '#/elections',
      count: counts.elections,
      summary: 'Election entries by date, body, geography, result data, and links to open election layers.',
      columns: [
        { heading: 'By election type', links: [['Dáil Éireann', '#/elections'], ['Westminster', '#/elections'], ['NI Assembly', '#/elections'], ['Local government', '#/elections'], ['Referendums', '#/elections']] },
        { heading: 'By decade', links: [['2020s', '#/elections'], ['2010s', '#/elections'], ['2000s', '#/elections'], ['1990s', '#/elections'], ['Earlier elections', '#/elections']] },
        { heading: 'Election data', links: [['Overall results', '#/elections'], ['Constituency results', '#/features'], ['Parties and labels', '#/parties'], ['Candidates and representatives', '#/persons']] }
      ]
    },
    {
      id: 'features',
      title: 'Features',
      href: '#/features',
      count: counts.featureGroups,
      summary: 'Boundary and geography feature groups, with feature records loaded lazily by source map.',
      columns: [
        { heading: 'Administrative features', links: [['Counties', '#/features'], ['Local authorities', '#/features'], ['Civil parishes', '#/features'], ['Townlands', '#/features']] },
        { heading: 'Election geographies', links: [['Constituencies', '#/features'], ['DEAs', '#/features'], ['Wards', '#/features'], ['Electoral divisions', '#/features']] },
        { heading: 'Linked records', links: [['Features with election results', '#/features'], ['Feature source maps', '#/features'], ['Open source map', '#/features']] }
      ]
    },
    {
      id: 'parties',
      title: 'Parties / labels',
      href: '#/parties',
      count: counts.parties,
      summary: 'Political parties, tickets, labels, aliases, colours, and observed election appearances.',
      columns: [
        { heading: 'Party data', links: [['Canonical parties', '#/parties'], ['Political tickets', '#/parties'], ['Independent labels', '#/parties']] },
        { heading: 'Colour and label checks', links: [['Party colours', '#/parties'], ['Observed labels', '#/parties'], ['Aliases and abbreviations', '#/parties']] },
        { heading: 'Related records', links: [['Election summaries', '#/elections'], ['Candidates', '#/persons'], ['Sources', '#/sources']] }
      ]
    },
    {
      id: 'persons',
      title: 'Persons',
      href: '#/persons',
      count: counts.persons,
      summary: 'Candidate and elected-person entries observed across the election data.',
      columns: [
        { heading: 'People indexes', links: [['Candidates', '#/persons'], ['Elected representatives', '#/persons'], ['Repeated candidates', '#/persons']] },
        { heading: 'Election links', links: [['Contests stood', '#/persons'], ['Seats won', '#/persons'], ['Party histories', '#/parties']] },
        { heading: 'Research routes', links: [['Search persons', '#/persons'], ['Election entries', '#/elections'], ['Source records', '#/sources']] }
      ]
    },
    {
      id: 'register-interests',
      title: 'Register interests',
      href: '#/register-interests',
      count: counts['register-interests'],
      summary: 'MLA and Northern Ireland MP register of interests rows, linked to source editions, provider APIs, and filtered CSV extracts.',
      columns: [
        { heading: 'Bodies', links: [['NI Assembly MLAs', '#/register-interests'], ['NI Westminster MPs', '#/register-interests'], ['Current API entries', '#/register-interests']] },
        { heading: 'Interest data', links: [['Employment and earnings', '#/register-interests'], ['Donations and support', '#/register-interests'], ['Gifts, visits and hospitality', '#/register-interests']] },
        { heading: 'Source routes', links: [['Register source documents', '#/sources'], ['Structured JSON shards', '#/sources'], ['Historical editions', '#/sources']] }
      ]
    },
    {
      id: 'sources',
      title: 'Books / tables / sources',
      href: '#/sources',
      count: counts.sources,
      summary: 'Books, tables, datasets, map source files, downloads, references, and provider records.',
      columns: [
        { heading: 'Source types', links: [['Books', '#/sources'], ['Tables', '#/sources'], ['Map sources', '#/sources'], ['Datasets', '#/sources']] },
        { heading: 'Download routes', links: [['Source files', '#/sources'], ['Map downloads', '#/sources'], ['References', '#/sources']] },
        { heading: 'Providers', links: [['OSI / OSNI', '#/sources'], ['CSO / NISRA', '#/sources'], ['Local authorities', '#/sources'], ['Open data portals', '#/sources']] }
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
  const title = item ? item.title : config.label;
  const description = item ? heroDescriptionForItem(state.activeType, item) : (state.manifest?.groups || []).find((group) => group.id === state.activeType)?.description || '';
  els.hero.innerHTML = `
    <p class="browse-kicker">Browse</p>
    <h1 class="browse-title">${escapeHtml(title)}</h1>
    ${description ? `<p class="browse-description">${escapeHtml(description)}</p>` : ''}
  `;
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
  const filtered = filterItems(items, state.query);
  const config = ENTITY_CONFIG[type];
  els.results.innerHTML = `
    ${renderFilterSummary(filtered.length, items.length)}
    <div class="browse-grid">
      ${filtered.slice(0, 500).map((item) => renderCard(type, item, config)).join('')}
    </div>
    ${filtered.length > 500 ? `<p class="browse-description">Showing the first 500 matching records. Narrow the search to find more.</p>` : ''}
  `;
}

function renderRegisterInterestList(items) {
  const textFiltered = filterItems(items, state.query);
  const filtered = applyRegisterInterestFilters(textFiltered);
  const sorted = sortRegisterInterestItems(filtered);
  const config = ENTITY_CONFIG['register-interests'];
  els.results.innerHTML = `
    ${renderRegisterInterestControls(items, sorted.length, items.length)}
    ${renderFilterSummary(sorted.length, items.length)}
    <div class="browse-grid">
      ${sorted.slice(0, 500).map((item) => renderCard('register-interests', item, config)).join('')}
    </div>
    ${sorted.length > 500 ? `<p class="browse-description">Showing the first 500 matching records. Narrow the search or filters to find more.</p>` : ''}
  `;
}

function renderRegisterInterestControls(items, filteredCount, totalCount) {
  const controls = state.registerInterestControls;
  const activeFilters = Object.values(controls.filters || {}).filter(Boolean).length;
  return `
    <section class="browse-controls" aria-label="Register interest sorting and filters">
      <div class="browse-control-group">
        <span class="browse-control-label">Sort by</span>
        <div class="browse-segmented" role="group" aria-label="Sort attribute">
          ${REGISTER_INTEREST_SORT_OPTIONS.map((option) => `
            <button type="button" class="browse-control-btn${controls.sortKey === option.key ? ' browse-control-btn--active' : ''}" data-register-sort="${escapeAttr(option.key)}">${escapeHtml(option.label)}</button>
          `).join('')}
        </div>
      </div>
      <div class="browse-control-group">
        <span class="browse-control-label">Order</span>
        <div class="browse-segmented" role="group" aria-label="Sort direction">
          <button type="button" class="browse-control-btn${controls.sortDir === 'desc' ? ' browse-control-btn--active' : ''}" data-register-direction="desc">Newest / Desc</button>
          <button type="button" class="browse-control-btn${controls.sortDir === 'asc' ? ' browse-control-btn--active' : ''}" data-register-direction="asc">Oldest / Asc</button>
        </div>
      </div>
      <div class="browse-filter-grid">
        ${REGISTER_INTEREST_FILTERS.map((filter) => renderRegisterInterestFilter(filter, items)).join('')}
      </div>
      <div class="browse-control-footer">
        <span>${formatNumber(filteredCount)} of ${formatNumber(totalCount)} records after controls${activeFilters ? `, ${activeFilters} active ${activeFilters === 1 ? 'filter' : 'filters'}` : ''}.</span>
        <button type="button" class="browse-btn" data-register-clear-filters>Clear filters</button>
      </div>
    </section>
  `;
}

function renderRegisterInterestFilter(filter, items) {
  const value = state.registerInterestControls.filters[filter.key] || '';
  const options = registerInterestFilterOptions(filter.key, items);
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

function registerInterestFilterOptions(key, items) {
  if (key === 'nilStatus') {
    return [
      { value: 'has-registrable', label: 'Has registrable interests' },
      { value: 'nil-only', label: 'Nil / no interests only' },
      { value: 'includes-nil', label: 'Includes nil entries' }
    ];
  }
  const values = new Set();
  for (const item of items) {
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
  return `
    <article class="browse-card">
      ${renderThumbnail(item, 'card')}
      <div class="browse-card__main">
        <h2 class="browse-card__title"><a href="#/${type}/${encodeURIComponent(slug)}" data-browse-link>${escapeHtml(item.title || item.name || item.id)}</a></h2>
        <div class="browse-card__meta">${renderMeta(metaForItem(type, item))}</div>
      </div>
      ${status ? `<span class="browse-card__status browse-card__status--${escapeAttr(status)}">${escapeHtml(item.status || status.replace(/-/g, ' '))}</span>` : ''}
      ${summary ? `<p class="browse-card__summary">${escapeHtml(summary)}</p>` : ''}
      ${renderInlineActions(config, item)}
    </article>
  `;
}

function renderInlineActions(config, item) {
  const actions = [];
  if (item.interactiveUrl) actions.push(`<a class="browse-btn browse-btn--primary" href="${escapeAttr(item.interactiveUrl)}">${escapeHtml(config.action || 'Open')}</a>`);
  if (item.downloads?.[0]?.url) actions.push(`<a class="browse-btn" href="${escapeAttr(item.downloads[0].url)}" target="_blank" rel="noopener noreferrer">Download/source</a>`);
  return actions.length ? `<div class="browse-actions">${actions.join('')}</div>` : '';
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
  const config = ENTITY_CONFIG.proni;
  state.currentDetail = null;
  if (!id) {
    setHero(config, null);
    els.results.innerHTML = '<div class="browse-loading">Loading PRONI records...</div>';
    // Prefer the static roots file (CDN-cached, no D1 hit); fall back to the API.
    let data = await loadJson(`${DATA_ROOT}/proni-roots.json`).catch(() => null);
    if (!data || !data.roots) data = await loadJson('/_api/proni/node').catch(() => null);
    renderProniLanding(config, (data && data.roots) || []);
    return;
  }
  els.results.innerHTML = '<div class="browse-loading">Loading record...</div>';
  const node = await loadProniNode(id);
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
             placeholder="Search ${formatNumber(1538177)} PRONI records — title, reference, or dates…"
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
    input.focus();
    // place cursor at end
    const v = input.value; input.value = ''; input.value = v;
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
    const resp = await fetch(`/_api/proni/search?q=${encodeURIComponent(q)}&limit=30`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if ((state.proniQuery || '').trim() !== q) return; // stale response
    renderProniSearchResults(box, data);
  } catch (error) {
    box.innerHTML = '<div class="browse-empty">PRONI search runs on the deployed site (the D1-backed API is not available in this local preview).</div>';
  }
}

function renderProniSearchResults(box, data) {
  const results = data.results || [];
  if (!results.length) {
    box.innerHTML = `<div class="browse-empty">No matches for &ldquo;${escapeHtml(data.query || '')}&rdquo;.</div>`;
    return;
  }
  box.innerHTML = `
    <p class="proni-search-count">${formatNumber(results.length)} result${results.length === 1 ? '' : 's'}</p>
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
    ['Digitised', it.digitalRecord ? 'Yes — digital image held by PRONI' : ''],
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
  const config = ENTITY_CONFIG[type];
  const detail = await loadDetail(type, indexItem);
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
  const pinnedRows = pinnedStatementRows(graph?.statements || []);
  // Maps fold their downloadable files into the statements panel as a
  // "Downloads & files" statement group, so the whole map body is one semantic
  // view rather than a separate Downloads section.
  const fileLinks = isMap ? collectFileLinks(item) : [];
  // Tier 3: the semantic statements are the spine of the page, so they render
  // expanded and high up. The register-interests page keeps them collapsed
  // because it has its own purpose-built summary above them.
  const graphPanel = await renderGraphStatementsPanel(type, item, { collapsed: type === 'register-interests', graph, fileLinks });
  if (type === 'register-interests') {
    els.results.innerHTML = renderRegisterInterestDetailPage(config, item, graphPanel);
    return;
  }
  // Map layers get a table of the features that comprise them.
  const featuresPanel = isMap ? await renderMapFeaturesTable(item, graph?.entityId) : '';
  // Maps render their own header (thumbnail beside the title), so the generic
  // hero would just duplicate the title — blank it for map detail pages.
  if (isMap) els.hero.innerHTML = '';
  els.results.innerHTML = `
    <div class="browse-detail browse-detail--reader${isMap ? ' browse-detail--map' : ''}">
      ${isMap ? renderMapHeaderPanel(item) : ''}
      ${renderDetailActions(config, item)}
      ${renderContributorDetailActions(type, item)}
      ${isMap ? '' : renderHeaderPanel(type, item, pinnedRows)}
      ${graphPanel}
      ${featuresPanel}
      ${isMap ? '' : renderLinksPanel(item, { collapsed: true })}
      ${renderRelatedPanel(type, item)}
      ${renderTechnicalPanel(type, item)}
    </div>
  `;
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
  const curatedPinned = readerSummaryRows(type, item);
  // Only let statements drive the header when they yield a substantive set of
  // facts; sparse catalogue records keep their more informative curated header.
  const usingStatements = pinnedRows.length >= 2;
  const primary = usingStatements ? pinnedRows : curatedPinned;
  const primaryLabels = summaryLabelSet(primary);
  const secondarySource = usingStatements
    ? [...curatedPinned, ...metadataRows(type, item)]
    : metadataRows(type, item);
  const secondary = dedupeRows(secondarySource)
    .filter(([label, value]) => !isEmptyValue(value) && !primaryLabels.has(String(label).toLowerCase()));
  const summary = readerSummaryText(type, item);
  return `
    <section class="browse-detail__panel browse-reader-summary">
      <div class="browse-detail__body">
        ${summary ? `<p class="browse-reader-summary__lede">${escapeHtml(summary)}</p>` : ''}
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
  if (type === 'parties') return `${item.title || item.canonicalName} appears in ${formatNumber(item.relatedElectionCount || 0)} election summaries.`;
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
      ['Constituencies', item.totalConstituencies],
      ['Matched / unmatched', `${item.matchedCount || 0} / ${item.unmatchedCount || 0}`]
    ];
  }
  if (type === 'parties') {
    return [
      ['Canonical name', item.canonicalName || item.title],
      ['Years', item.subtitle],
      ['Observed labels', item.observedNames?.length],
      ['Election appearances', item.occurrenceCount]
    ];
  }
  if (type === 'persons') {
    return [
      ['Name', item.name || item.title],
      ['Years', item.subtitle],
      ['Parties', joinList(item.parties?.slice(0, 5).map((party) => party.name))],
      ['Contests', item.totals?.stood],
      ['Elected', item.totals?.elected]
    ];
  }
  if (type === 'sources') {
    return [
      ['Type', item.type],
      ['Category', item.category],
      ['Provider', joinList(item.provider)],
      ['Date', item.date]
    ];
  }
  return [
    ['Category', item.category],
    ['Group', item.group],
    ['Status', item.status]
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
  const rows = [
    ['Politician', item.memberName],
    ['Body', item.electedBody],
    ['Chamber', item.chamber],
    ['Date', formatDate(item.date)],
    ['Constituency', item.constituency || joinList(item.constituencies)],
    ['Party', joinList(item.parties)],
    ['Interests', item.interestCount],
    ['Non-nil', item.nonNilInterestCount]
  ];
  const lede = item.isNone
    ? `${item.memberName || 'This member'} had a nil return for this register edition.`
    : `${item.memberName || 'This member'} had ${formatNumber(item.interestCount || 0)} grouped ${item.interestCount === 1 ? 'interest' : 'interests'} in this ${item.electedBody || 'register'} edition.`;
  return `
    <section class="browse-detail__panel browse-reader-summary browse-register-summary">
      <div class="browse-detail__body">
        <p class="browse-reader-summary__lede">${escapeHtml(lede)}</p>
        ${renderDefinitionRows(rows, 'browse-reader-facts')}
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
      <div class="browse-table-wrap">
        <table class="browse-table browse-table--compact">
          <thead>
            <tr><th>Date</th><th>Category</th><th>Source</th><th>Method</th><th>Confidence</th></tr>
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

function renderOverviewPanel(type, item) {
  const rows = [];
  if (type === 'maps') {
    rows.push(['Category', item.category], ['Group', item.group], ['Provider', joinList(item.provider)], ['Date / years', item.date || joinList(item.years)]);
  } else if (type === 'elections') {
    if (item.entryKind && item.entryKind !== 'election') {
      rows.push(
        ['Entry type', resultKindLabel(item.resultKind || item.entryKind)],
        ['Election', item.parentTitle],
        ['Result', item.resultName],
        ['Date', formatDate(item.date)],
        ['Geography', item.geography]
      );
    } else {
      rows.push(['Body', item.body], ['Date', formatDate(item.date)], ['Geography', item.geography], ['Constituencies', item.totalConstituencies], ['Matched / unmatched', `${item.matchedCount || 0} / ${item.unmatchedCount || 0}`]);
    }
  } else if (type === 'parties') {
    rows.push(['Canonical name', item.canonicalName], ['Observed labels', joinList(item.observedNames?.slice(0, 8))], ['Years', item.subtitle], ['Occurrences', item.occurrenceCount]);
  } else if (type === 'persons') {
    rows.push(['Name', item.name], ['Years', item.subtitle], ['Parties', joinList(item.parties?.slice(0, 5).map((party) => party.name))], ['Contests', item.totals?.stood], ['Elected', item.totals?.elected]);
  } else if (type === 'register-interests') {
    rows.push(
      ['Elected body', item.electedBody],
      ['Chamber', item.chamber],
      ['Member type', item.memberType],
      ['Jurisdiction', item.jurisdiction],
      ['Member', item.memberName],
      ['Constituency', item.constituency || joinList(item.constituencies)],
      ['Date', formatDate(item.date)],
      ['Categories', joinList(item.categories) || item.category],
      ['Interest entries', item.interestCount],
      ['Non-nil entries', item.nonNilInterestCount],
      ['Source rows merged', item.sourceCount],
      ['Source kinds', joinList((item.sourceKinds || []).map(sourceKindLabel))]
    );
  } else if (type === 'sources') {
    rows.push(['Type', item.type], ['Category', item.category], ['Provider', joinList(item.provider)], ['Date', item.date]);
  }
  return `
    <section class="browse-detail__panel">
      <h2>Overview</h2>
      <div class="browse-detail__body">
        ${type === 'register-interests' && (item.interestSummary || item.description) ? `<p>${escapeHtml(item.interestSummary || item.description)}</p>` : item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
        ${renderDefinitionRows(rows)}
        ${renderBadges(item)}
      </div>
    </section>
  `;
}

// Curated secondary fields for a record, as data. The header panel pins the
// headline subset and tucks the rest behind its "More fields" disclosure.
function metadataRows(type, item) {
  const rows = [
    ['Status', item.status],
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
      ['Total labels', item.observedNames?.length],
      ['Election appearances', item.occurrenceCount]
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

// Merge an item's downloadable artifacts into one list, de-duplicated by URL.
// `downloads` and `sourceFiles` are identical for most maps (same file listed
// twice), so collapsing by URL shows each file once; where they genuinely
// differ (e.g. original upstream formats vs the converted CivGraph file) every
// distinct file is preserved. `downloads` is taken first so its label wins.
function collectFileLinks(item) {
  const seen = new Set();
  const out = [];
  for (const link of [...(item.downloads || []), ...(item.sourceFiles || [])]) {
    if (!link) continue;
    const key = link.url || `label:${link.label || link.name || ''}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
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
  const headerRow = `<tr><th>Thumbnail</th><th>Feature</th>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`;
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
      <div class="browse-table-wrap">
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
  const headerRow = `<tr><th>Thumbnail</th><th>Feature</th><th>Bounding box</th>${attrColumns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`;
  const tbodyId = `feature-rows-${slugify(mapId)}`;
  const footer = ctx.nextPage < ctx.pageCount
    ? `<div class="browse-feature-more"><button type="button" class="browse-btn browse-btn--small" data-feature-load-more data-feature-map="${escapeAttr(mapId)}">Load more (${formatNumber(ctx.loaded)} of ${formatNumber(ctx.total)})</button></div>`
    : (ctx.total > ctx.loaded ? `<p class="browse-graph__more">Showing ${formatNumber(ctx.loaded)} of ${formatNumber(ctx.total)} features.</p>` : '');
  return `
    <section class="browse-detail__panel">
      <h2>Features in this layer</h2>
      <div class="browse-table-wrap">
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

function renderRelatedPanel(type, item) {
  if (type === 'elections') return renderElectionRelated(item);
  if (type === 'parties') return renderSimpleTable('Linked Elections', ['Date', 'Election', 'Stood', 'Seats', 'Votes'], item.relatedElections || [], (row) => [
    formatDate(row.date),
    row.interactiveUrl ? `<a href="${escapeAttr(row.interactiveUrl)}">${escapeHtml(row.title)}</a>` : escapeHtml(row.title),
    formatNumber(row.stood),
    formatNumber(row.seats),
    formatNumber(row.votes)
  ]);
  if (type === 'persons') return renderSimpleTable('Election Appearances', ['Date', 'Election', 'Party', 'Constituency', 'Status'], item.elections || [], (row) => [
    formatDate(row.date),
    row.interactiveUrl ? `<a href="${escapeAttr(row.interactiveUrl)}">${escapeHtml(row.title)}</a>` : escapeHtml(row.title),
    escapeHtml(row.party || ''),
    escapeHtml(row.constituency || ''),
    escapeHtml(row.status || (row.elected ? 'Elected' : ''))
  ]);
  if (type === 'register-interests') return renderRegisterInterestRelated(item);
  if (type === 'maps') return renderMapVariants(item);
  return '';
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
      <div class="browse-table-wrap">
        <table class="browse-table browse-table--compact">
          <thead><tr><th>Variant</th><th>Date</th><th>Open</th></tr></thead>
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
  state.currentDetail = null;
  els.results.innerHTML = '<div class="browse-loading">Loading entity...</div>';
  if (!slug) {
    await renderEntitySearchRoute();
    return;
  }
  const entityIndex = await loadGraphEntityIndex();
  const entityId = entityIndex.bySlug?.[slug] || (entityIndex.byIdShard?.[slug] ? slug : '');
  const entity = entityId ? await loadGraphEntitySummary(entityId) : null;
  if (!entity) {
    setHero({ label: 'Entities', singular: 'Entity' }, null);
    els.results.innerHTML = '<div class="browse-empty">Entity not found.</div>';
    return;
  }
  const graph = await loadGraphStatementsForEntity(entityId);
  const related = await loadGraphRelatedForEntity(entityId);
  const title = entity.label || entityId;
  els.hero.innerHTML = `
    <p class="browse-kicker">Entity</p>
    <h1 class="browse-title">${escapeHtml(title)}</h1>
    <p class="browse-description">${escapeHtml(entity.typeLabels?.join(', ') || entity.typeIds?.join(', ') || entityId)}</p>
  `;
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

function renderEntityRelatedPanel(related) {
  const reverseRows = normalizeArray(related?.reverse).slice(0, 40).map((row) => [
    row.subjectSlug ? `<a href="#/entities/${encodeURIComponent(row.subjectSlug)}" data-browse-link>${escapeHtml(row.subjectLabel || row.subjectId)}</a>` : escapeHtml(row.subjectLabel || row.subjectId),
    escapeHtml(row.propertyLabel || row.propertyId || ''),
    escapeHtml(joinList(row.subjectTypeLabels))
  ]);
  const sourceRows = normalizeArray(related?.sourceStatements).slice(0, 40).map((row) => [
    row.subjectSlug ? `<a href="#/entities/${encodeURIComponent(row.subjectSlug)}" data-browse-link>${escapeHtml(row.subjectLabel || row.subjectId)}</a>` : escapeHtml(row.subjectLabel || row.subjectId),
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
        ${renderInlineTable('Subject of statements by', ['Entity', 'Relationship', 'Type'], reverseRows)}
        ${renderInlineTable('Source-supported statements', ['Entity', 'Statement', 'Reference'], sourceRows)}
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
  const entityHref = entitySummary?.slug ? `#/entities/${encodeURIComponent(entitySummary.slug)}` : '';
  const body = `
    <div class="browse-detail__body browse-graph">
      <div class="browse-graph__summary">
        ${graph?.entityId ? `<span>${escapeHtml(graph.entityId)}</span>` : ''}
        <span>${formatNumber(statements.length)} statements</span>
        ${entityHref ? `<a href="${escapeAttr(entityHref)}" data-browse-link>Open entity view</a>` : ''}
      </div>
      ${renderStatementGroups(groups, fileLinks)}
    </div>
  `;
  if (options.collapsed) {
    return renderCollapsiblePanel('Semantic statements', body, `${formatNumber(statements.length)} graph statements`, {
      className: 'browse-graph-panel browse-detail__panel--supporting'
    });
  }
  return `
    <section class="browse-detail__panel browse-graph-panel">
      <h2>Semantic statements</h2>
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
  return statement.valueLabel || statement.valueText || statement.valueId || '';
}

// Render a statement value as a link to the value's own entity page when the
// value is itself an entity (provider, elected body, instance-of, source file,
// …). That page lists every other entity sharing the value via its reverse
// statements — i.e. "show me everything else with this value". Literal values
// (free-text dates, categories) have no entity page yet, so they stay plain.
function graphStatementValueHtml(statement) {
  const value = graphStatementValueText(statement);
  if (!value) return '';
  if (statement.valueType === 'entity' && statement.valueId) {
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
  const subjectMap = await loadGraphSubjectMap();
  const shardUrl = subjectMap[entityId];
  if (!shardUrl) return { entityId, statements: [] };
  let shard = state.graph.subjectShards.get(shardUrl);
  if (!shard) {
    shard = await loadJson(shardUrl);
    state.graph.subjectShards.set(shardUrl, shard);
  }
  return { entityId, statements: normalizeArray(shard.items?.[entityId]) };
}

async function graphEntityIdForBrowseItem(type, item) {
  const mapping = await loadGraphBrowseMapping();
  for (const key of graphBrowseKeys(type, item)) {
    if (mapping[key]) return mapping[key];
  }
  return '';
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

async function loadGraphBrowseMapping() {
  if (state.graph.browseMapping) return state.graph.browseMapping;
  const manifest = await loadGraphManifest();
  const mapping = await loadJson(manifest.indexes.browseRecordToEntity);
  state.graph.browseMapping = mapping.items || {};
  return state.graph.browseMapping;
}

async function loadGraphEntityIndex() {
  if (state.graph.entityIndex) return state.graph.entityIndex;
  const manifest = await loadGraphManifest();
  const index = await loadJson(manifest.indexes.entitySlugs);
  state.graph.entityIndex = index;
  return state.graph.entityIndex;
}

async function loadGraphEntitySearch() {
  if (state.graph.entitySearch) return state.graph.entitySearch;
  const manifest = await loadGraphManifest();
  state.graph.entitySearch = await loadJson(manifest.indexes.entitySearch);
  return state.graph.entitySearch;
}

async function loadGraphEntitySummary(entityId) {
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
  const manifest = await loadGraphManifest();
  if (!state.graph[mapStateKey]) {
    const mapPayload = await loadJson(manifest.indexes[manifestIndexKey]);
    state.graph[mapStateKey] = mapPayload.items || {};
  }
  const shardUrl = state.graph[mapStateKey][entityId];
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
    party.colour ? `<span class="browse-badge" style="border-color:${escapeAttr(party.colour)}">${escapeHtml(party.party || '')}</span>` : escapeHtml(party.party || ''),
    formatNumber(party.stood),
    formatNumber(party.seats),
    formatNumber(party.votes),
    party.share === undefined ? '' : `${Number(party.share).toFixed(2)}%`
  ]);
  const constituencyRows = (item.resultEntries || []).length
    ? (item.resultEntries || []).map((entry) => [
      entry.browseUrl ? `<a href="#/elections/${encodeURIComponent((entry.browseUrl || '').split('/').pop() || entry.key)}" data-browse-link>${escapeHtml(entry.resultName || entry.title || entry.key)}</a>` : escapeHtml(entry.resultName || entry.title || entry.key),
      escapeHtml(resultKindLabel(entry.resultKind || 'result'))
    ])
    : (item.constituencies || []).map((name) => [escapeHtml(name), '']);
  return `
    ${renderTablePanel('Party Summary', ['Party', 'Stood', 'Seats', 'Votes', 'Share'], partyRows)}
    ${renderTablePanel('Constituencies / Features', ['Name', 'Type'], constituencyRows)}
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
    <div class="browse-table-wrap">
      <table class="browse-table browse-table--compact">
        <thead><tr><th>Type</th><th>Label</th><th>Link</th></tr></thead>
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
    return `
      <figure class="browse-thumb browse-thumb--${escapeAttr(context)}">
        <img src="${escapeAttr(src)}"${srcset} alt="${escapeAttr(thumbnail.alt || item.title || '')}" loading="lazy" decoding="async">
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
        <img src="${escapeAttr(src)}"${srcset} alt="${escapeAttr(thumbnail.alt || item.title || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
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
      <div class="browse-table-wrap">
        <table class="browse-table browse-table--technical">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
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
  if (auth.allowed) {
    els.contributorPanel.innerHTML = `
      <h2 class="contributor-panel__title">Contributor</h2>
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
      <h2 class="contributor-panel__title">Contributor</h2>
      <p class="contributor-panel__body">Logged in as <span class="contributor-panel__email">${escapeHtml(auth.email || 'unknown')}</span>, but this account is not in the contributor allowlist.</p>
      <div class="contributor-panel__actions">
        <a class="contributor-btn" href="${escapeAttr(auth.logoutUrl || '/cdn-cgi/access/logout')}">Log out</a>
      </div>
    `;
    return;
  }
  els.contributorPanel.innerHTML = `
    <h2 class="contributor-panel__title">Contributor</h2>
    <p class="contributor-panel__body">Selected contributors can propose Browse edits and map submissions.</p>
    <div class="contributor-panel__actions">
      <a class="contributor-btn contributor-btn--primary" href="${escapeAttr(auth.loginUrl || '/_api/contributions/login?return=%2Fbrowse%2F')}">Log in</a>
    </div>
  `;
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

    state.editBaseline = {};
    const blocks = [];
    for (const field of fields) {
      const text = valueToText(record ? record[field.name] : undefined, field.type);
      state.editBaseline[field.name] = text;
      blocks.push(editFieldHtml(field, text));
    }
    host.innerHTML = blocks.join('');

    if (!record) {
      status.className = 'contributor-form__status';
      status.textContent = 'Current values could not be loaded, so every field starts empty. Anything you fill in will be proposed as a change.';
    }
  } catch (error) {
    host.innerHTML = '';
    status.className = 'contributor-form__status contributor-form__status--error';
    status.textContent = error.message;
  }
  openContributorModal();
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
function editFieldHtml(field, currentText) {
  const name = escapeAttr(field.name);
  const label = escapeHtml(field.name);

  if (field.type === 'boolean') {
    const isTrue = currentText === 'true';
    const isFalse = currentText === 'false';
    return `
      <label class="contributor-form__field">
        <span class="contributor-form__field-name">${label}</span>
        <select name="field:${name}" data-edit-field="${name}" data-edit-type="boolean">
          <option value=""${!isTrue && !isFalse ? ' selected' : ''}>(not set)</option>
          <option value="true"${isTrue ? ' selected' : ''}>true</option>
          <option value="false"${isFalse ? ' selected' : ''}>false</option>
        </select>
      </label>`;
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

/** Render a stored value as the text the form shows for it. */
function valueToText(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
  if (type === 'bounds') return Array.isArray(value) ? value.join(', ') : '';
  if (type === 'array') {
    if (!Array.isArray(value)) return '';
    // Objects (references, sourceDownloads) are shown as JSON so they at least
    // round-trip unchanged if left alone.
    return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  }
  return String(value);
}


function openMapSubmissionForm() {
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
  const inputs = els.contributorForm.querySelectorAll('[data-edit-field]');
  const patch = {};
  const problems = [];

  for (const input of inputs) {
    const field = input.dataset.editField;
    const type = input.dataset.editType || 'string';
    const now = String(input.value ?? '');
    const before = String(baseline[field] ?? '');
    if (now === before) continue;

    if (!now.trim()) { patch[field] = null; continue; }

    if (type === 'boolean') {
      patch[field] = now === 'true';
    } else if (type === 'bounds') {
      const numbers = now.split(/[\s,]+/).filter(Boolean).map(Number);
      if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) {
        problems.push(`${field}: needs four numbers (west, south, east, north).`);
        continue;
      }
      patch[field] = numbers;
    } else if (type === 'array') {
      patch[field] = now.split('\n').map((line) => line.trim()).filter(Boolean)
        .map((line) => {
          // A line that was rendered as JSON (an object entry) is parsed back,
          // so leaving it untouched does not turn an object into a string.
          if (!/^[[{]/.test(line)) return line;
          try { return JSON.parse(line); } catch { return line; }
        });
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
  els.results.innerHTML = `
    <div class="browse-note">Feature browsing is grouped by map and loads existing spatial-index sidecars on demand. This keeps the public Browse page responsive while still exposing the feature catalogue.</div>
    ${selected ? await renderFeatureGroupDetail(selected) : `
      ${renderFilterSummary(items.length, data.items?.length || 0)}
      <div class="browse-grid">${items.slice(0, 500).map((item) => renderCard('features', item, ENTITY_CONFIG.features)).join('')}</div>
    `}
  `;
}

async function renderFeatureGroupDetail(item) {
  let featureData = null;
  try {
    featureData = await loadJson(`../data/database/spatial-index/${encodeURIComponent(item.id)}.json`);
    state.loadedFeatureMap = item.id;
  } catch {
    featureData = null;
  }
  const features = filterItems(featureData?.features || item.sampleFeatures || [], state.query).slice(0, 500);
  return `
    <div class="browse-detail">
      <div class="browse-actions">
        <a class="browse-btn" href="#/features" data-browse-link>Back to feature groups</a>
        ${item.interactiveUrl ? `<a class="browse-btn browse-btn--primary" href="${escapeAttr(item.interactiveUrl)}">Open source map</a>` : ''}
      </div>
      <section class="browse-detail__panel">
        <h2>${escapeHtml(item.title)}</h2>
        <div class="browse-detail__body">
          ${renderDefinitionRows([
            ['Feature count', formatNumber(item.featureCount)],
            ['Source map', item.sourceMapId],
            ['Related elections', item.relatedElectionCount]
          ])}
        </div>
      </section>
      ${renderSimpleTable('Related Elections', ['Date', 'Election'], item.relatedElections || [], (row) => [
        formatDate(row.date),
        row.interactiveUrl ? `<a href="${escapeAttr(row.interactiveUrl)}">${escapeHtml(row.title)}</a>` : escapeHtml(row.title)
      ])}
      ${renderTablePanel('Features', ['Name', 'Bounds'], features.map((feature) => [
        escapeHtml(feature.name || feature.label || 'Unnamed feature'),
        escapeHtml(Array.isArray(feature.bbox) ? feature.bbox.map((value) => Number(value).toFixed(5)).join(', ') : '')
      ]))}
      ${renderTechnicalPanel('features', item)}
      ${(featureData?.features?.length || 0) > 500 ? '<p class="browse-description">Showing the first 500 matching features. Use search to narrow the list.</p>' : ''}
    </div>
  `;
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

function renderTablePanel(title, headers, rows) {
  if (!rows?.length) return '';
  return `
    <section class="browse-detail__panel">
      <h2>${escapeHtml(title)}</h2>
      <div class="browse-table-wrap">
        <table class="browse-table">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
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
      <div class="browse-table-wrap">
        <table class="browse-table browse-table--compact">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
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
  return `<dl class="${escapeAttr(className)}">${filtered.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl>`;
}

function renderBadges(item) {
  const badges = [];
  if (item.placeholder) badges.push('Placeholder');
  if (item.status) badges.push(item.status);
  if (!badges.length) return '';
  return `<div class="browse-badges">${badges.map((badge) => `<span class="browse-badge">${escapeHtml(badge)}</span>`).join('')}</div>`;
}

function renderFilterSummary(count, total) {
  const suffix = state.query ? ` matching "${escapeHtml(state.query)}"` : '';
  return `<p class="browse-description">${formatNumber(count)} of ${formatNumber(total)} records${suffix}.</p>`;
}

async function loadIndex(type) {
  if (state.indexes.has(type)) return state.indexes.get(type);
  const config = ENTITY_CONFIG[type];
  const data = await loadJson(`${DATA_ROOT}/${config.index}`);
  if (data.indexLayout === 'sharded' && Array.isArray(data.shards)) {
    const shardData = await Promise.all(data.shards.map((shard) => loadJson(shard.url)));
    data.items = shardData.flatMap((shard) => Array.isArray(shard.items) ? shard.items : []);
  }
  state.indexes.set(type, data);
  return data;
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

async function loadJson(url) {
  const requestUrl = versionBrowseDataUrl(url);
  const response = await fetch(requestUrl, { cache: 'no-store' });
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
  const needle = query.toLowerCase();
  return items.filter((item) => searchableText(item).includes(needle));
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
  ].flat().filter(Boolean).join(' ').toLowerCase();
}

function findItem(items, id) {
  const needle = decodeURIComponent(id || '').toLowerCase();
  return items.find((item) => String(item.slug || '').toLowerCase() === needle || String(item.id || '').toLowerCase() === needle || String(item.key || '').toLowerCase() === needle);
}

function metaForItem(type, item) {
  if (type === 'elections') return [formatDate(item.date), item.body, item.subtitle, item.geography];
  if (type === 'features') return [item.category, `${formatNumber(item.featureCount)} features`, item.relatedElectionCount ? `${item.relatedElectionCount} elections` : null];
  if (type === 'parties') return [item.subtitle, `${formatNumber(item.occurrenceCount)} occurrences`, `${formatNumber(item.relatedElectionCount)} elections`];
  if (type === 'persons') return [item.subtitle, `${formatNumber(item.totals?.stood)} contests`, `${formatNumber(item.totals?.elected)} elected`];
  if (type === 'register-interests') return [
    formatDate(item.date),
    item.electedBody || item.memberType,
    item.constituency || joinList(item.constituencies),
    item.interestCount ? `${formatNumber(item.interestCount)} interests` : item.category,
    item.sourceCount ? `${formatNumber(item.sourceCount)} source rows` : null
  ];
  if (type === 'sources') return [item.type, item.category, item.date];
  return [item.category, item.group, item.subtitle];
}

function summaryForItem(type, item) {
  if (type === 'elections') return `${formatNumber(item.totalConstituencies)} constituencies/features; ${formatNumber(item.unmatchedCount)} unmatched.`;
  if (type === 'features') return `Feature group for ${item.title}, loaded from ${item.spatialIndexUrl || 'the spatial index'}.`;
  if (type === 'parties') return `${item.title} has ${formatNumber(item.relatedElectionCount)} linked election summaries in Browse.`;
  if (type === 'persons') return joinList(item.parties?.slice(0, 3).map((party) => party.name));
  if (type === 'register-interests') return item.interestSummary || item.description || joinList(item.categories);
  if (type === 'sources') return item.description || joinList(item.downloads?.slice(0, 2).map((link) => link.label));
  return item.subtitle;
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
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
