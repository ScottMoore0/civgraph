// Independent PRONI Search — a small client-routed app over the D1-backed PRONI
// catalogue. Three views share one shell:
//   /proni                      -> search (home)
//   /proni/<reference>          -> individual record page (e.g. /proni/AA/3)
//   /proni…?ecat=<reference>    -> "View on PRONI eCatalogue" instructions
const API = '/_api/proni/search';
const COUNT_API = '/_api/proni/count';
const EXPORT_API = '/_api/proni/export';
const NODE_API = '/_api/proni/node';
const ECAT_BROWSE = 'https://apps.proni.gov.uk/eCatNI_IE/BrowseSearchPage.aspx';
const LIMIT = 25;

const $ = (id) => document.getElementById(id);
const els = {
  q: $('q'), clear: $('clearBtn'), adv: $('advToggle'), advanced: $('advanced'),
  fTitle: $('fTitle'), fDescription: $('fDescription'), fRef: $('fRef'), fDates: $('fDates'),
  from: $('dateFrom'), to: $('dateTo'), sort: $('sort'), dir: $('dirBtn'),
  az: $('azBar'), status: $('status'), results: $('results'), sentinel: $('sentinel'),
  modal: $('modal'), modalBody: $('modalBody'),
  viewSearch: $('viewSearch'), viewRecord: $('viewRecord'), viewEcat: $('viewEcat'),
  exportResults: $('exportResults'), exportAll: $('exportAll'),
};

const state = { offset: 0, done: false, loading: false, seen: new Set(), letter: '', reqId: 0, queryId: 0, total: null, levels: null };

// Archival hierarchy order for the letter-browse level breakdown.
const LEVEL_ORDER = ['Fond', 'Sub-fond', 'Series', 'Sub-series', 'Sub-sub-series', 'Sub-sub-sub-series', 'Sub-sub-sub-sub-series', 'Sub-sub-sub-sub-sub-series', 'Sub-sub-sub-sub-sub-sub-series', 'File', 'Item'];
const levelRank = (l) => { const i = LEVEL_ORDER.indexOf(l); return i === -1 ? 999 : i; };
const pluralLevel = (level, n) => (n === 1 || /s$/i.test(level) ? level : `${level}s`);
function formatLevels(levels) {
  return levels.slice()
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || String(a.level).localeCompare(String(b.level)))
    .map((l) => `${l.n.toLocaleString()} ${pluralLevel(l.level || 'Other', l.n)}`)
    .join(', ');
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yearOf = (v) => (v && /^\d{4}/.test(v) ? v.slice(0, 4) : '');
// Clean URL for a reference: /proni/AA/3 — slashes stay as path separators,
// each segment is percent-encoded so spaces/odd chars survive.
const refToPath = (ref) => '/proni/' + String(ref).split('/').map(encodeURIComponent).join('/');

/* =========================== shared UI bits =========================== */

function metaHtml(r) {
  const m = [];
  if (r.level) m.push(`<span><b>Level:</b> ${esc(r.level)}</span>`);
  if (r.dates) m.push(`<span><b>Dates:</b> ${esc(r.dates)}</span>`);
  if (r.access) m.push(`<span><b>Access:</b> ${esc(r.access)}</span>`);
  if (r.fond) m.push(`<span class="ps-badge">${esc(r.fond)}</span>`);
  if (r.digitalRecord) m.push('<span class="ps-badge ps-badge--digi">Digitised</span>');
  return m.join('');
}

// The reference widget: heavier ref + copy-to-clipboard on one row, with a
// "View on PRONI eCatalogue" link below. `withLabel` prefixes "PRONI Ref:" (used
// on cards; omitted on the record page where the table row already labels it).
function refWidget(ref, withLabel) {
  const rid = esc(ref);
  return `<div class="ps-refwidget">
    <div class="ps-refwidget__row">
      ${withLabel ? '<span class="ps-refwidget__label">PRONI Ref:</span>' : ''}
      <span class="ps-ref">${rid}</span>
      <button type="button" class="ps-copy" data-copy="${rid}" title="Copy reference to clipboard" aria-label="Copy PRONI reference to clipboard">⧉ Copy</button>
      <button type="button" class="ps-copy ps-source" data-ecat="${rid}" title="How to view this record on the official PRONI eCatalogue" aria-label="View this record's source on the official PRONI eCatalogue">↗ Source</button>
    </div>
  </div>`;
}

function card(r, depth = 0) {
  const path = refToPath(r.ref);
  const descHtml = r.description
    ? `<p class="ps-card__desc">${esc(r.description)}${r.descTruncated ? '…' : ''}</p>` +
      (r.descTruncated ? `<button type="button" class="ps-card__more" data-more="${esc(r.ref)}">Show more</button>` : '')
    : '';
  const expand = r.hasChildren
    ? `<button type="button" class="ps-expand" data-expand="${esc(r.ref)}" aria-expanded="false"><span class="ps-expand__icon">▸</span> <span class="ps-expand__label">Expand</span></button>`
    : '';
  const meta = metaHtml(r);
  // The sticky region holds the title, top-right reference block, and the
  // record's details (level/dates/…) so all of it stays pinned while the
  // record's children scroll beneath an expanded card.
  return `<li class="ps-card" data-ref="${esc(r.ref)}" data-depth="${depth}" style="--depth:${depth}">
    <div class="ps-card__sticky">
      <div class="ps-card__head">
        <a class="ps-card__title" href="${path}" data-go="${path}">${esc(r.title || r.ref)}</a>
        ${refWidget(r.ref, true)}
      </div>
      ${meta ? `<div class="ps-card__meta">${meta}</div>` : ''}
      ${expand ? `<div class="ps-card__actions">${expand}</div>` : ''}
    </div>
    <div class="ps-card__body">${descHtml}</div>
    <ul class="ps-children" hidden></ul>
  </li>`;
}

/* =========================== search (home) =========================== */

// Query + filters only (no paging/sort) — shared by count and export.
function queryParams() {
  const p = new URLSearchParams();
  const q = els.q.value.trim();
  if (q) p.set('q', q);
  if (els.fTitle.value.trim()) p.set('title', els.fTitle.value.trim());
  if (els.fDescription.value.trim()) p.set('description', els.fDescription.value.trim());
  if (els.fRef.value.trim()) p.set('ref', els.fRef.value.trim());
  if (els.fDates.value.trim()) p.set('dates', els.fDates.value.trim());
  const from = yearOf(els.from.value), to = yearOf(els.to.value);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  // a selected letter is a top-level browse (fonds under that letter, A→Z), not a
  // filter on the current search — hence top=1 and no text query alongside it
  if (state.letter) { p.set('letter', state.letter); p.set('top', '1'); }
  return p;
}

// The text search terms (main box + advanced fields + dates) — cleared when the
// user switches to letter-browse.
function clearSearchTerms() {
  els.q.value = ''; els.clear.hidden = true;
  els.fTitle.value = ''; els.fDescription.value = ''; els.fRef.value = ''; els.fDates.value = '';
  els.from.value = ''; els.to.value = '';
}
function hasTextInput() {
  return !!(els.q.value.trim() || els.fTitle.value.trim() || els.fDescription.value.trim() ||
    els.fRef.value.trim() || els.fDates.value.trim());
}

function params(offset) {
  const p = queryParams();
  p.set('sort', els.sort.value);
  p.set('dir', els.dir.dataset.dir);
  p.set('limit', String(LIMIT));
  p.set('offset', String(offset));
  return p;
}

function hasAnyInput() {
  return els.q.value.trim() || els.fTitle.value.trim() || els.fDescription.value.trim() ||
    els.fRef.value.trim() || els.fDates.value.trim() || yearOf(els.from.value) || yearOf(els.to.value) || state.letter;
}

// The status line prefers the exact total once the (async, parallel) count
// lands; until then it shows the loaded-so-far "N+" fallback.
function updateStatus() {
  const hasInput = hasAnyInput();
  if (els.exportResults) els.exportResults.disabled = !hasInput || state.total === 0;
  if (!hasInput) { els.status.textContent = 'Type to search 1,538,177 PRONI catalogue records — or pick a starting letter.'; return; }
  // letter-browse: summarise everything under the letter by archival level
  if (state.letter && state.levels && state.levels.length) {
    els.status.textContent = `Reference ${state.letter} — ${formatLevels(state.levels)}`;
    return;
  }
  if (state.total != null && !state.letter) {
    els.status.textContent = state.total === 0 ? 'No matching records.' : `${state.total.toLocaleString()} result${state.total === 1 ? '' : 's'}`;
    return;
  }
  const n = state.seen.size;
  if (n) els.status.textContent = state.letter ? `Reference ${state.letter} — loading breakdown…` : `${n.toLocaleString()}${state.done ? '' : '+'} result${n === 1 ? '' : 's'}`;
  else els.status.textContent = state.done ? 'No matching records.' : 'Searching…';
}

async function fetchCount(qid) {
  try {
    // In letter-browse, ask for a per-level breakdown of ALL records under the
    // letter (not just the top-level fonds shown in the list).
    const url = state.letter
      ? `${COUNT_API}?letter=${encodeURIComponent(state.letter)}&breakdown=1`
      : `${COUNT_API}?${queryParams()}`;
    const data = await (await fetch(url)).json();
    if (qid !== state.queryId) return;                 // a newer query superseded this
    if (state.letter && Array.isArray(data.levels)) { state.levels = data.levels; state.total = data.count ?? null; updateStatus(); }
    else if (typeof data.count === 'number') { state.total = data.count; state.levels = null; updateStatus(); }
  } catch { /* keep the loaded-so-far fallback */ }
}

async function search(reset) {
  if (state.loading && !reset) return; // a new query interrupts an in-flight load; only pagination waits
  if (reset) { state.offset = 0; state.done = false; state.seen = new Set(); state.total = null; state.levels = null; state.queryId += 1; }
  if (state.done) return;
  if (!hasAnyInput()) {
    els.results.innerHTML = '';
    state.done = true;
    updateStatus();
    return;
  }
  state.loading = true;
  const rid = ++state.reqId;
  if (reset) { els.status.textContent = 'Searching…'; fetchCount(state.queryId); }
  try {
    const resp = await fetch(`${API}?${params(state.offset)}`);
    const data = await resp.json();
    if (rid !== state.reqId) return; // stale
    if (data.error) { els.status.textContent = 'Search error.'; state.done = true; return; }
    const batch = data.results || [];
    if (reset) els.results.innerHTML = '';
    const fresh = batch.filter((r) => !state.seen.has(r.ref));
    fresh.forEach((r) => { state.seen.add(r.ref); els.results.insertAdjacentHTML('beforeend', card(r)); });
    state.offset += LIMIT;
    if (batch.length < LIMIT) state.done = true;
    if (!state.seen.size) els.results.innerHTML = '<li class="ps-empty">No records match your search. Try fewer or broader terms.</li>';
    updateStatus();
  } catch {
    if (rid === state.reqId) els.status.textContent = 'Search is temporarily unavailable.';
  } finally {
    state.loading = false;
    // keep loading until the results fill the viewport (short result sets, so the
    // scroll observer alone would never re-fire) — only while the home view is up
    if (currentView === 'search' && !state.done && hasAnyInput() &&
        els.sentinel.getBoundingClientRect().top < window.innerHeight + 300) {
      setTimeout(() => search(false), 80);
    }
  }
}

/* =================== expand / collapse (sticky parent) =================== */

function setExpandLabel(btn, expanded, loading) {
  const icon = btn.querySelector('.ps-expand__icon');
  const label = btn.querySelector('.ps-expand__label');
  if (loading) { if (label) label.textContent = 'Loading…'; return; }
  if (icon) icon.textContent = expanded ? '▾' : '▸';
  if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
  btn.setAttribute('aria-expanded', String(expanded));
  btn.classList.toggle('is-open', expanded);
}

async function toggleExpand(ref, btn) {
  const li = btn.closest('.ps-card');
  if (!li) return;
  const kids = li.querySelector(':scope > .ps-children');
  const depth = Number(li.dataset.depth) || 0;

  if (li.classList.contains('is-expanded')) {
    // Collapse — then land the user back on the card they collapsed, rather than
    // wherever the shrinking page leaves the scroll position.
    li.classList.remove('is-expanded');
    kids.hidden = true; kids.innerHTML = '';
    setExpandLabel(btn, false);
    const y = li.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: Math.max(0, y) });
    return;
  }

  setExpandLabel(btn, false, true);
  btn.disabled = true;
  try {
    const data = await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json();
    const children = data.children || [];
    kids.innerHTML = children.length
      ? children.map((c) => card(c, depth + 1)).join('')
      : '<li class="ps-children__empty">No sub-records found.</li>';
    kids.hidden = false;
    li.classList.add('is-expanded');
    setExpandLabel(btn, true);
  } catch {
    setExpandLabel(btn, false);
  } finally {
    btn.disabled = false;
  }
}

/* =========================== record page =========================== */

function pager(nav) {
  const btn = (label, target, disabled) => disabled || !target
    ? `<span class="ps-pager__btn is-disabled">${label}</span>`
    : `<a class="ps-pager__btn" href="${refToPath(target)}" data-go="${refToPath(target)}">${label}</a>`;
  return `<div class="ps-pager" role="navigation" aria-label="Sibling records">
    ${btn('« First', nav.first, !nav.prev)}
    ${btn('‹ Previous', nav.prev, !nav.prev)}
    <span class="ps-pager__count">[${nav.position || 0} – ${nav.total || 0}]</span>
    ${btn('Next ›', nav.next, !nav.next)}
    ${btn('Last »', nav.last, !nav.next)}
  </div>`;
}

// The levels between this record and the top of the archive, shown vertically
// with each level's title (not just its reference) and linking to that level.
function levelsNav(ancestors, it) {
  const rows = (ancestors || []).map((a) =>
    `<a class="ps-levels__item" href="${refToPath(a.ref)}" data-go="${refToPath(a.ref)}"><span class="ps-ref">${esc(a.ref)}</span> <span class="ps-levels__t">${esc(a.title || '')}</span></a>`).join('');
  return `<nav class="ps-levels" aria-label="Levels above this record">
    ${rows}
    <span class="ps-levels__current"><span class="ps-ref">${esc(it.ref)}</span> <span class="ps-levels__t">${esc(it.title || '')}</span></span>
  </nav>`;
}

async function renderRecord(ref) {
  currentView = 'record';
  els.viewSearch.hidden = true; els.viewEcat.hidden = true; els.viewRecord.hidden = false;
  window.scrollTo(0, 0);
  document.title = `${ref} — Independent PRONI Search`;
  els.viewRecord.innerHTML = '<p class="ps-loading">Loading record…</p>';
  const token = routeToken;

  let data;
  try {
    data = await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json();
  } catch {
    if (token === routeToken) els.viewRecord.innerHTML = recordShell('<p class="ps-empty">Could not load this record. Please try again.</p>');
    return;
  }
  if (token !== routeToken) return;
  if (!data || !data.item) {
    els.viewRecord.innerHTML = recordShell(`<p class="ps-empty">No record found for reference <b>${esc(ref)}</b>.</p>`);
    return;
  }

  const it = data.item;
  const nav = data.nav || {};
  const digital = it.digitalRecord ? 'Digitised — held by PRONI' : '';
  const rows = [
    ['Repository', 'Public Record Office of Northern Ireland'],
    ['PRONI Reference', refWidget(it.ref, false)],
    ['Level', esc(it.level)],
    ['Access', esc(it.access)],
    ['Title', esc(it.title)],
    ['Dates', esc(it.dates)],
    ['Description', it.description ? `<div class="ps-rec__desc">${esc(it.description)}</div>` : ''],
    ['Digital Record', esc(digital)],
  ];
  const table = `<table class="ps-rec__table"><tbody>${
    rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v || ''}</td></tr>`).join('')
  }</tbody></table>`;

  const kids = data.children || [];
  const CAP = 200;
  const childList = kids.length ? `<section class="ps-rec__children">
    <h3>Records within ${esc(it.ref)} <span class="ps-rec__count">(${kids.length.toLocaleString()})</span></h3>
    <ul>${kids.slice(0, CAP).map((c) => `<li><a href="${refToPath(c.ref)}" data-go="${refToPath(c.ref)}"><span class="ps-ref">${esc(c.ref)}</span> ${esc(c.title || '')}</a></li>`).join('')}
      ${kids.length > CAP ? `<li class="ps-rec__morenote">…and ${(kids.length - CAP).toLocaleString()} more. Use search to find a specific record.</li>` : ''}</ul>
  </section>` : '';

  els.viewRecord.innerHTML = `
    <div class="ps-rec__toolbar">
      <a class="ps-back" href="/proni" data-go="/proni">← Back to search</a>
      ${levelsNav(data.ancestors, it)}
    </div>
    <article class="ps-rec">
      <h2 class="ps-rec__title">${esc(it.title || it.ref)}</h2>
      ${pager(nav)}
      ${table}
      ${pager(nav)}
      ${childList}
    </article>`;
}

function recordShell(inner) {
  return `<div class="ps-rec__toolbar"><a class="ps-back" href="/proni" data-go="/proni">← Back to search</a></div>
    <article class="ps-rec">${inner}</article>`;
}

/* ==================== "View on PRONI eCatalogue" page ==================== */

function renderEcat(ref) {
  currentView = 'ecat';
  els.viewSearch.hidden = true; els.viewRecord.hidden = true; els.viewEcat.hidden = false;
  window.scrollTo(0, 0);
  document.title = 'View on PRONI eCatalogue — Independent PRONI Search';
  const rid = esc(ref);
  els.viewEcat.innerHTML = `
    <div class="ps-rec__toolbar"><button type="button" class="ps-back" data-back>← Back</button></div>
    <article class="ps-guide">
      <h2 class="ps-guide__title">How to view this record on the official PRONI eCatalogue</h2>
      <ol class="ps-guide__steps">
        <li>
          <p class="ps-guide__lead">Click the reference below to copy it to your clipboard:</p>
          <div class="ps-guide__reffield" role="button" tabindex="0" data-copy="${rid}" title="Click to copy">${rid}</div>
          <span class="ps-guide__copied" hidden>Copied to clipboard ✓</span>
        </li>
        <li>
          <p class="ps-guide__lead">Paste it into the “Input a PRONI reference” field on the next page:</p>
          <figure class="ps-shotframe">
            <div class="ps-shotframe__bar" aria-hidden="true">
              <span class="ps-shotframe__dots"><i></i><i></i><i></i></span>
              <span class="ps-shotframe__url">apps.proni.gov.uk/eCatNI_IE/BrowseSearchPage.aspx</span>
            </div>
            <img class="ps-guide__shot" src="/apps/proni-search/proni-ecatalogue-browse.png" alt="The official PRONI eCatalogue browse page, showing the 'Input a PRONI reference' field and a Search button">
            <figcaption class="ps-shotframe__cap">📷 Example screenshot of the official PRONI eCatalogue — not part of this page</figcaption>
          </figure>
        </li>
        <li>
          <p class="ps-guide__lead">Press ‘Search’.</p>
        </li>
      </ol>
      <a class="ps-guide__cta" href="${ECAT_BROWSE}" target="_blank" rel="noopener">View record on PRONI eCatalogue now ↗</a>
    </article>`;
}

/* =============================== router =============================== */

let currentView = 'search';
let homeScrollY = 0;
let routeToken = 0;
let inAppNavs = 0;

function currentRef() {
  const p = decodeURIComponent(location.pathname);
  if (p === '/proni' || p === '/proni/') return null;
  if (p.startsWith('/proni/')) return p.slice('/proni/'.length).replace(/\/+$/, '');
  return null; // /apps/proni-search/ etc. -> home
}

function showHome() {
  currentView = 'search';
  els.viewRecord.hidden = true; els.viewEcat.hidden = true; els.viewSearch.hidden = false;
  document.title = 'Independent PRONI Search';
  window.scrollTo(0, homeScrollY);
}

function route() {
  if (currentView === 'search') homeScrollY = window.scrollY;
  routeToken += 1;
  closeModal();
  const ecat = new URLSearchParams(location.search).get('ecat');
  if (ecat) { renderEcat(ecat); return; }
  const ref = currentRef();
  if (ref) { renderRecord(ref); return; }
  showHome();
}

function go(url, replace) {
  closeModal();
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  inAppNavs += 1;
  route();
}

function goBack() {
  if (inAppNavs > 0) history.back(); else go('/proni', true);
}

/* ============================ clipboard ============================ */

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch { /* no-op */ }
  document.body.removeChild(ta);
}

async function copyRef(el) {
  const ref = el.getAttribute('data-copy');
  if (!ref) return;
  try { await navigator.clipboard.writeText(ref); } catch { fallbackCopy(ref); }
  if (el.classList.contains('ps-copy')) {
    const old = el.innerHTML;
    el.innerHTML = '✓ Copied'; el.classList.add('is-copied');
    setTimeout(() => { el.innerHTML = old; el.classList.remove('is-copied'); }, 1400);
  } else {
    el.classList.add('is-copied');
    const note = el.parentElement && el.parentElement.querySelector('.ps-guide__copied');
    if (note) { note.hidden = false; }
    setTimeout(() => {
      el.classList.remove('is-copied');
      if (note) note.hidden = true;
    }, 1600);
  }
}

/* ============================= detail modal ============================= */

async function openModal(ref) {
  els.modal.hidden = false;
  els.modalBody.innerHTML = '<p class="ps-loading">Loading record…</p>';
  document.body.style.overflow = 'hidden';
  try {
    const data = await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json();
    const it = data.item;
    if (!it) { els.modalBody.innerHTML = '<p class="ps-empty">Record not found.</p>'; return; }
    const rows = [
      ['PRONI reference', it.ref], ['Title', it.title], ['Level', it.level], ['Dates', it.dates],
      ['Access', it.access], ['Digital record', it.digitalRecord ? 'Digitised — held by PRONI' : ''],
      ['Repository', 'Public Record Office of Northern Ireland'],
    ].filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    els.modalBody.innerHTML = `
      <h2 id="modalTitle">${esc(it.title || it.ref)}</h2>
      <div class="ps-modal__ref">${esc(it.ref)}</div>
      <dl class="ps-dl">${rows}</dl>
      ${it.description ? `<div class="ps-modal__descheading">Description</div><div class="ps-modal__desc">${esc(it.description)}</div>` : ''}
      <a class="ps-modal__link" href="${refToPath(it.ref)}" data-go="${refToPath(it.ref)}">Open full record ↗</a>`;
  } catch {
    els.modalBody.innerHTML = '<p class="ps-empty">Could not load this record.</p>';
  }
}
function closeModal() { els.modal.hidden = true; document.body.style.overflow = ''; }

/* ============================== A-Z bar ============================== */

'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((L) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ps-az__btn'; b.textContent = L; b.dataset.letter = L;
  els.az.appendChild(b);
});
const azClear = document.createElement('button');
azClear.type = 'button'; azClear.className = 'ps-az__clear'; azClear.textContent = 'All';
els.az.appendChild(azClear);

/* =============================== events =============================== */

let timer;
const debounced = () => {
  clearTimeout(timer);
  els.clear.hidden = !els.q.value;
  // typing a search term deselects the browse letter (search supersedes browse)
  if (state.letter && hasTextInput()) {
    state.letter = '';
    els.az.querySelectorAll('.ps-az__btn').forEach((b) => b.classList.remove('is-active'));
  }
  timer = setTimeout(() => search(true), 220);
};
[els.q, els.fTitle, els.fDescription, els.fRef, els.fDates].forEach((el) => el.addEventListener('input', debounced));
[els.from, els.to, els.sort].forEach((el) => el.addEventListener('change', () => search(true)));

els.dir.addEventListener('click', () => {
  const next = els.dir.dataset.dir === 'asc' ? 'desc' : 'asc';
  els.dir.dataset.dir = next;
  els.dir.querySelector('.ps-sortdir__label').textContent = next === 'asc' ? 'A–Z' : 'Z–A';
  els.dir.querySelector('.ps-sortdir__arrow').textContent = next === 'asc' ? '▲' : '▼';
  els.dir.title = next === 'asc' ? 'Sort ascending — click for descending' : 'Sort descending — click for ascending';
  els.dir.setAttribute('aria-label', `Sort direction: ${next === 'asc' ? 'ascending' : 'descending'}`);
  search(true);
});
els.adv.addEventListener('click', () => {
  const open = els.advanced.hidden;
  els.advanced.hidden = !open;
  els.adv.setAttribute('aria-expanded', String(open));
  els.adv.textContent = open ? 'Advanced search ▴' : 'Advanced search ▾';
});
els.clear.addEventListener('click', () => { els.q.value = ''; els.clear.hidden = true; search(true); els.q.focus(); });
els.exportResults.addEventListener('click', () => {
  if (!hasAnyInput()) return;
  window.location.href = `${EXPORT_API}?${queryParams()}`; // streamed CSV download
});
els.az.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-letter]');
  if (btn) {
    state.letter = state.letter === btn.dataset.letter ? '' : btn.dataset.letter;
    if (state.letter) clearSearchTerms(); // browsing a letter replaces any active search
  } else if (e.target === azClear) {
    state.letter = '';
  } else return;
  els.az.querySelectorAll('.ps-az__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.letter === state.letter));
  search(true);
});

// One delegated handler for the whole app (search cards, record page, guide).
const isModified = (e) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
document.addEventListener('click', (e) => {
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) { e.preventDefault(); copyRef(copyEl); return; }

  const expandEl = e.target.closest('[data-expand]');
  if (expandEl) { e.preventDefault(); toggleExpand(expandEl.getAttribute('data-expand'), expandEl); return; }

  const moreEl = e.target.closest('[data-more]');
  if (moreEl) { e.preventDefault(); openModal(moreEl.getAttribute('data-more')); return; }

  if (e.target.closest('[data-close]')) { closeModal(); return; }

  const backEl = e.target.closest('[data-back]');
  if (backEl) { e.preventDefault(); goBack(); return; }

  if (isModified(e)) return; // let ctrl/cmd-click open a new tab

  const ecatEl = e.target.closest('[data-ecat]');
  if (ecatEl) { e.preventDefault(); go(`${location.pathname}?ecat=${encodeURIComponent(ecatEl.getAttribute('data-ecat'))}`); return; }

  const homeEl = e.target.closest('[data-home]');
  if (homeEl) { e.preventDefault(); go('/proni'); return; }

  const goEl = e.target.closest('[data-go]');
  if (goEl) { e.preventDefault(); go(goEl.getAttribute('data-go')); return; }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.modal.hidden) { closeModal(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-copy].ps-guide__reffield')) {
    e.preventDefault(); copyRef(e.target);
  }
});

window.addEventListener('popstate', route);

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && currentView === 'search' && !state.loading && !state.done && hasAnyInput()) search(false);
}, { rootMargin: '600px' }).observe(els.sentinel);

// Initialise the home view, then render whatever the current URL asks for.
search(true);
route();
