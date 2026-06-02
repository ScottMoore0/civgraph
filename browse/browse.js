const DATA_ROOT = '../data/browse';
const ENTITY_CONFIG = {
  maps: { label: 'Maps', singular: 'Map', index: 'maps.json', detailDir: 'maps', action: 'Open in interactive map' },
  elections: { label: 'Elections', singular: 'Election', index: 'elections.json', detailDir: 'elections', action: 'Open election layer' },
  features: { label: 'Features', singular: 'Feature group', index: 'features.json', detailDir: null, action: 'Open source map' },
  parties: { label: 'Parties / Labels', singular: 'Party / label', index: 'parties.json', detailDir: 'parties' },
  persons: { label: 'Persons', singular: 'Person', index: 'persons.json', detailDir: null },
  sources: { label: 'Books / Tables / Sources', singular: 'Source', index: 'sources.json', detailDir: 'sources' }
};

const state = {
  manifest: null,
  activeType: 'maps',
  activeId: null,
  query: '',
  indexes: new Map(),
  details: new Map(),
  selectedFeatureMap: null,
  loadedFeatureMap: null,
  auth: null,
  currentDetail: null,
  modalMode: null
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

  els.contributorForm?.addEventListener('submit', submitContributorForm);
}

function applyRoute() {
  const route = parseRoute();
  state.activeType = route.type;
  state.activeId = route.id;
  state.selectedFeatureMap = route.params.get('map');
  renderGroups();
  renderCurrent();
}

function parseRoute() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const parts = hash.split('/').filter(Boolean);
  const params = new URLSearchParams(location.search);
  let type = params.get('type') || parts[0] || 'maps';
  let id = params.get('id') || parts[1] || null;
  if (type === 'people') type = 'persons';
  if (!ENTITY_CONFIG[type]) type = 'maps';
  return { type, id, params };
}

function renderGroups() {
  const counts = state.manifest?.counts || {};
  els.groups.innerHTML = (state.manifest?.groups || []).map((group) => {
    const count = countForGroup(group.id, counts);
    const active = group.id === state.activeType ? ' browse-group-link--active' : '';
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

function setHero(config, item) {
  const title = item ? item.title : config.label;
  const description = item ? item.description || item.subtitle || '' : (state.manifest?.groups || []).find((group) => group.id === state.activeType)?.description || '';
  els.hero.innerHTML = `
    <p class="browse-kicker">Browse</p>
    <h1 class="browse-title">${escapeHtml(title)}</h1>
    ${description ? `<p class="browse-description">${escapeHtml(description)}</p>` : ''}
  `;
}

function renderList(type, items) {
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

function renderCard(type, item, config) {
  const slug = item.slug || slugify(item.id || item.key || item.title);
  const status = cleanStatus(item.status);
  const summary = item.description || summaryForItem(type, item);
  return `
    <article class="browse-card">
      <div>
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

async function renderDetail(type, indexItem) {
  const config = ENTITY_CONFIG[type];
  const detail = await loadDetail(type, indexItem);
  const item = detail?.item || indexItem;
  state.currentDetail = { type, item };
  setHero(config, item);
  els.results.innerHTML = `
    <div class="browse-detail">
      ${renderDetailActions(config, item)}
      ${renderContributorDetailActions(type, item)}
      ${renderOverviewPanel(type, item)}
      ${renderMetadataPanel(item)}
      ${renderRelatedPanel(type, item)}
      ${renderLinksPanel(item)}
    </div>
  `;
}

function renderDetailActions(config, item) {
  const actions = [];
  if (item.interactiveUrl) actions.push(`<a class="browse-btn browse-btn--primary" href="${escapeAttr(item.interactiveUrl)}">${escapeHtml(config.action || 'Open in interactive map')}</a>`);
  if (item.resultUrl) actions.push(`<a class="browse-btn" href="${escapeAttr(item.resultUrl)}" target="_blank" rel="noopener noreferrer">Election JSON</a>`);
  if (item.anchorUrl) actions.push(`<a class="browse-btn" href="${escapeAttr(item.anchorUrl)}" target="_blank" rel="noopener noreferrer">Seat anchors</a>`);
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

function renderOverviewPanel(type, item) {
  const rows = [];
  if (type === 'maps') {
    rows.push(['Category', item.category], ['Group', item.group], ['Provider', joinList(item.provider)], ['Date / years', item.date || joinList(item.years)]);
  } else if (type === 'elections') {
    rows.push(['Body', item.body], ['Date', formatDate(item.date)], ['Geography', item.geography], ['Constituencies', item.totalConstituencies], ['Matched / unmatched', `${item.matchedCount || 0} / ${item.unmatchedCount || 0}`]);
  } else if (type === 'parties') {
    rows.push(['Canonical name', item.canonicalName], ['Observed labels', joinList(item.observedNames?.slice(0, 8))], ['Years', item.subtitle], ['Occurrences', item.occurrenceCount]);
  } else if (type === 'persons') {
    rows.push(['Name', item.name], ['Years', item.subtitle], ['Parties', joinList(item.parties?.slice(0, 5).map((party) => party.name))], ['Contests', item.totals?.stood], ['Elected', item.totals?.elected]);
  } else if (type === 'sources') {
    rows.push(['Type', item.type], ['Category', item.category], ['Provider', joinList(item.provider)], ['Date', item.date]);
  }
  return `
    <section class="browse-detail__panel">
      <h2>Overview</h2>
      <div class="browse-detail__body">
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
        ${renderDefinitionRows(rows)}
        ${renderBadges(item)}
      </div>
    </section>
  `;
}

function renderMetadataPanel(item) {
  const rows = [
    ['ID', item.id || item.key],
    ['Status', item.status],
    ['Source map', item.sourceMapId],
    ['Layer', item.layerId],
    ['Label property', item.labelProperty],
    ['Keywords', joinList(item.keywords)]
  ];
  return `
    <section class="browse-detail__panel">
      <h2>Metadata</h2>
      <div class="browse-detail__body">${renderDefinitionRows(rows)}</div>
    </section>
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
  if (type === 'maps') return renderSimpleTable('Variants', ['Title', 'Date', 'ID'], item.variants || [], (row) => [escapeHtml(row.title || row.id), escapeHtml(row.date || ''), escapeHtml(row.id || '')]);
  return '';
}

function renderElectionRelated(item) {
  const partyRows = (item.partySummary || []).map((party) => [
    party.colour ? `<span class="browse-badge" style="border-color:${escapeAttr(party.colour)}">${escapeHtml(party.party || '')}</span>` : escapeHtml(party.party || ''),
    formatNumber(party.stood),
    formatNumber(party.seats),
    formatNumber(party.votes),
    party.share === undefined ? '' : `${Number(party.share).toFixed(2)}%`
  ]);
  const constituencyRows = (item.constituencies || []).map((name) => [escapeHtml(name)]);
  return `
    ${renderTablePanel('Party Summary', ['Party', 'Stood', 'Seats', 'Votes', 'Share'], partyRows)}
    ${renderTablePanel('Constituencies / Features', ['Name'], constituencyRows)}
  `;
}

function renderLinksPanel(item) {
  const rows = [];
  for (const link of item.downloads || []) rows.push(['Download', link.label, link.url]);
  for (const link of item.sourceFiles || []) rows.push(['Source file', link.label, link.url]);
  for (const ref of item.references || []) rows.push(['Reference', ref.label || ref.url, ref.url]);
  if (!rows.length) return '';
  return renderTablePanel('Sources, References, Downloads', ['Type', 'Label', 'Link'], rows.map((row) => [
    escapeHtml(row[0]),
    escapeHtml(row[1] || ''),
    row[2] ? `<a href="${escapeAttr(row[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(row[2])}</a>` : ''
  ]));
}

async function refreshAuth() {
  try {
    const response = await fetch('/_api/auth/status', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    state.auth = data.auth || { authenticated: false, allowed: false };
  } catch {
    state.auth = {
      authenticated: false,
      allowed: false,
      loginUrl: `/cdn-cgi/access/login?redirect_url=${encodeURIComponent(location.href)}`,
      logoutUrl: `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(`${location.origin}/browse/`)}`
    };
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
      <a class="contributor-btn contributor-btn--primary" href="${escapeAttr(auth.loginUrl || `/cdn-cgi/access/login?redirect_url=${encodeURIComponent(location.href)}`)}">Log in</a>
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

function openEditSubmissionForm(type, item) {
  const entityType = entityTypeForBrowseType(type);
  const entityId = item.id || item.key || item.slug || item.title;
  state.modalMode = 'metadata-edit';
  els.contributorModalTitle.textContent = `Propose edit: ${item.title || entityId}`;
  els.contributorForm.innerHTML = `
    <input type="hidden" name="kind" value="metadata-edit">
    <input type="hidden" name="entityType" value="${escapeAttr(entityType)}">
    <input type="hidden" name="entityId" value="${escapeAttr(entityId)}">
    <label>
      Summary
      <input name="summary" required maxlength="2000" placeholder="Briefly describe the correction or addition">
    </label>
    <label>
      Proposed fields
      <textarea name="fields" required placeholder='Example: {"provider":"OSNI","description":"Updated description"}'></textarea>
      <span class="contributor-form__hint">Use JSON object syntax. This creates a review-queue proposal; it does not alter production data directly.</span>
    </label>
    <label>
      Source URLs
      <textarea name="sourceUrls" placeholder="One or more supporting URLs, separated by spaces or new lines"></textarea>
    </label>
    <div class="contributor-form__status" aria-live="polite"></div>
    <div class="contributor-panel__actions">
      <button type="submit" class="contributor-btn contributor-btn--primary">Submit proposal</button>
      <button type="button" class="contributor-btn" data-contributor-close>Cancel</button>
    </div>
  `;
  openContributorModal();
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
      throw new Error(data.error || `${response.status} ${response.statusText}`);
    }
    status.className = 'contributor-form__status contributor-form__status--success';
    status.textContent = `Submitted for review: ${data.submission?.id || 'pending'}.`;
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
      fields: parseFieldObject(String(formData.get('fields') || '')),
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

function parseFieldObject(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Proposed fields are required.');
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error('Proposed fields must be a valid JSON object.');
  }
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
            ['Spatial index', item.spatialIndexUrl],
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
      ${(featureData?.features?.length || 0) > 500 ? '<p class="browse-description">Showing the first 500 matching features. Use search to narrow the list.</p>' : ''}
    </div>
  `;
}

function renderSimpleTable(title, headers, rows, mapper) {
  if (!rows?.length) return '';
  return renderTablePanel(title, headers, rows.map(mapper));
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

function renderDefinitionRows(rows) {
  const filtered = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!filtered.length) return '';
  return `<dl class="browse-detail__meta">${filtered.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl>`;
}

function renderBadges(item) {
  const badges = [];
  if (item.featured) badges.push('Featured');
  if (item.loadable) badges.push('Loadable');
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
  state.indexes.set(type, data);
  return data;
}

async function loadDetail(type, item) {
  const config = ENTITY_CONFIG[type];
  if (!config.detailDir) return { item };
  const slug = item.slug || slugify(item.id || item.key || item.title);
  const cacheKey = `${type}:${slug}`;
  if (state.details.has(cacheKey)) return state.details.get(cacheKey);
  const detail = await loadJson(`${DATA_ROOT}/details/${config.detailDir}/${encodeURIComponent(slug)}.json`);
  state.details.set(cacheKey, detail);
  return detail;
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
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
  if (type === 'sources') return [item.type, item.category, item.date];
  return [item.category, item.group, item.subtitle];
}

function summaryForItem(type, item) {
  if (type === 'elections') return `${formatNumber(item.totalConstituencies)} constituencies/features; ${formatNumber(item.unmatchedCount)} unmatched.`;
  if (type === 'features') return `Feature group for ${item.title}, loaded from ${item.spatialIndexUrl || 'the spatial index'}.`;
  if (type === 'parties') return `${item.title} has ${formatNumber(item.relatedElectionCount)} linked election summaries in Browse.`;
  if (type === 'persons') return joinList(item.parties?.slice(0, 3).map((party) => party.name));
  if (type === 'sources') return item.description || joinList(item.downloads?.slice(0, 2).map((link) => link.label));
  return item.subtitle;
}

function renderMeta(parts) {
  return parts.filter((part) => part !== null && part !== undefined && part !== '').map((part) => `<span>${escapeHtml(String(part))}</span>`).join('');
}

function cleanStatus(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function joinList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value || '';
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

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
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
