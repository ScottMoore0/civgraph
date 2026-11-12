// Independent PRONI Search — a small client-routed app over the D1-backed PRONI
// catalogue. Three views share one shell:
//   /proni                      -> search (home)
//   /proni/<reference>          -> individual record page (e.g. /proni/AA/3)
//   /proni…?ecat=<reference>    -> "View on PRONI eCatalogue" instructions
/**
 * An element of the page reached by a delegated listener or a selector: any HTML element, with
 * the form-control fields read where it is one.
 * @typedef {HTMLElement & Partial<Pick<HTMLInputElement, 'value' | 'checked' | 'disabled' | 'type' | 'placeholder'>>} UiElement
 */
/**
 * An event from a delegated listener, whose target is an element of the page.
 * @template {Event} [E=Event]
 * @typedef {E & { target: { closest(selectors: string): UiElement | null } & UiElement }} ElementEvent
 */
/**
 * The PRONI answers this app reads (/_api/proni/*, the handlers /api/v1/proni/* also serves).
 * @typedef {import('../../packages/types/index.js').ApiV1.ProniSearchResultsAnswer} ProniSearchAnswer
 * @typedef {import('../../packages/types/index.js').ApiV1.ProniNodeNodeAnswer} ProniNodeAnswer
 * @typedef {import('../../packages/types/index.js').ApiV1.ProniNodeRootsAnswer} ProniRootsAnswer
 */
/** A top-level fond (a node's children have the same shape). @typedef {ProniRootsAnswer['roots'][number]} ProniRoot */
/** A record a result card shows: a search match, a fond or a sub-record. @typedef {ProniSearchAnswer['results'][number] | ProniRoot} ProniCardRecord */
/** One level of count.js's per-letter breakdown. @typedef {{ level: string, n: number }} ProniLevelCount */
/**
 * count.js's answer; `breakdown=1` adds `levels`.
 * @typedef {import('../../packages/types/index.js').ApiV1.ProniCountCountAnswer & { levels?: ProniLevelCount[] }} ProniCountAnswer
 */
import { AZ_SCOPE, CARD_CHILDREN, CARD_DESCRIPTION, COPY_FLASH, MODAL, RESULTS, VIEW } from './state-machines.js';
import { esc, recordHtml, recordNotFound, recordShell, refToPath, refWidget } from '../../pkg/ui/src/templates/proni/record-view.js';

const API = '/_api/proni/search';
const COUNT_API = '/_api/proni/count';
const EXPORT_API = '/_api/proni/export';
const NODE_API = '/_api/proni/node';
const ECAT_BROWSE = 'https://apps.proni.gov.uk/eCatNI_IE/BrowseSearchPage.aspx';
const LIMIT = 25;

// The page's HTML (index.html) holds every element looked up here, so each lookup is typed as
// present; the input and select fields are typed as what they are.
/** @param {string} id @returns {UiElement} */
const $ = (id) => /** @type {UiElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLInputElement} */
const $input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLSelectElement} */
const $select = (id) => /** @type {HTMLSelectElement} */ (document.getElementById(id));
/**
 * The element `selector` finds inside `root`, which the page's markup always contains. A missing
 * one throws a TypeError where the old `root.querySelector(selector).x` did.
 * @param {ParentNode} root @param {string} selector @returns {Element}
 */
function child(root, selector) {
  const el = root.querySelector(selector);
  if (!el) throw new TypeError(`${selector} is missing`);
  return el;
}
const els = {
  q: $input('q'), clear: $('clearBtn'), adv: $('advToggle'), advanced: $('advanced'),
  fTitle: $input('fTitle'), fDescription: $input('fDescription'), fRef: $input('fRef'), fDates: $input('fDates'),
  fLevel: $select('fLevel'), fAccess: $select('fAccess'),
  from: $input('dateFrom'), to: $input('dateTo'), sort: $select('sort'), dir: $('dirBtn'),
  az: $('azBar'), status: $('status'), results: $('results'), sentinel: $('sentinel'),
  modal: $('modal'), modalBody: $('modalBody'),
  viewSearch: $('viewSearch'), viewRecord: $('viewRecord'), viewEcat: $('viewEcat'),
  exportResults: $('exportResults'), exportAll: $('exportAll'),
};

const state = {
  // seen: the references shown for the current query.
  offset: 0, seen: /** @type {Set<string>} */ (new Set()), letter: '', reqId: 0, queryId: 0,
  /** The current query's exact count once it lands. @type {number | null} */
  total: null,
  /** Browse mode's per-level breakdown from count.js. @type {ProniLevelCount[] | null} */
  levels: null,
  /** The 'All' view's letter sections (renderAllRoots), and how many of them are shown. @type {Array<[string, ProniRoot[]]> | null} */
  allSections: null,
  allIndex: 0,
  // The current query's results (state-machines.js RESULTS) and the A-Z bar's scope (AZ_SCOPE).
  results: RESULTS.start(),
  azScope: AZ_SCOPE.start(),
};
/** Whether the current query has no more results to load (its last page came, or it failed). */
const resultsEnded = () => state.results.state() === 'done' || state.results.state() === 'failed';

// Every top-level PRONI record (parent = ''), 9,404 of them, as { roots, count } from
// /_api/proni/node (edge-cached for a day). The 'All' view and letter browsing are both fully
// enumerable and change only when PRONI's catalogue does, so they are loaded once: one cached
// fetch instead of a query per letter, and the grouping and ordering happen locally and
// instantly. (It was the static /data/browse/proni-roots.json until data design phase 3; that
// URL answers 301 here.)
const ROOTS_URL = '/_api/proni/node';
/** @type {Promise<ProniRoot[] | null> | null} */
let rootsPromise = null;
function loadRoots() {
  if (!rootsPromise) {
    rootsPromise = fetch(ROOTS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((/** @type {ProniRootsAnswer} */ d) => d.roots || [])
      .catch(() => { rootsPromise = null; return null; });
  }
  return rootsPromise;
}

// Archival hierarchy order for the letter-browse level breakdown.
const LEVEL_ORDER = ['Fond', 'Sub-fond', 'Series', 'Sub-series', 'Sub-sub-series', 'Sub-sub-sub-series', 'Sub-sub-sub-sub-series', 'Sub-sub-sub-sub-sub-series', 'Sub-sub-sub-sub-sub-sub-series', 'File', 'Item'];
const levelRank = (/** @type {string} */ l) => { const i = LEVEL_ORDER.indexOf(l); return i === -1 ? 999 : i; };
const pluralLevel = (/** @type {string} */ level, /** @type {number} */ n) => (n === 1 || /s$/i.test(level) ? level : `${level}s`);
/** @param {ProniLevelCount[]} levels */
function formatLevels(levels) {
  return levels.slice()
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || String(a.level).localeCompare(String(b.level)))
    .map((l) => `${l.n.toLocaleString()} ${pluralLevel(l.level || 'Other', l.n)}`)
    .join(', ');
}

const yearOf = (/** @type {string} */ v) => (v && /^\d{4}/.test(v) ? v.slice(0, 4) : '');

/* =========================== shared UI bits =========================== */

/** @param {ProniCardRecord} r */
function metaHtml(r) {
  const m = [];
  if (r.level) m.push(`<span><b>Level:</b> ${esc(r.level)}</span>`);
  if (r.dates) m.push(`<span><b>Dates:</b> ${esc(r.dates)}</span>`);
  if (r.access) m.push(`<span><b>Access:</b> ${esc(r.access)}</span>`);
  if (r.fond) m.push(`<span class="ps-badge">${esc(r.fond)}</span>`);
  if (r.digitalRecord) m.push('<span class="ps-badge ps-badge--digi">Digitised</span>');
  return m.join('');
}

/** @param {ProniCardRecord} r @param {number} [depth] */
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

/**
 * Show or clear the inverted-date-range message.
 *
 * An inverted range used to be sent to the API, match nothing, and render as "no
 * records" -- which reads as "these records do not exist" rather than "this query is
 * impossible". The message is in a live region so it is announced, and it is placed next
 * to the date inputs rather than in the results area, because that is where the mistake
 * is and where the fix has to be made.
 * @param {string | null} message
 */
function reportDateRangeError(message) {
  let box = document.getElementById('psDateError');
  if (!box) {
    if (!message) return;
    box = document.createElement('p');
    box.id = 'psDateError';
    box.className = 'ps-date-error';
    box.setAttribute('role', 'alert');
    (els.from.closest('.ps-dates') || els.from.parentElement)?.appendChild(box);
  }
  box.textContent = message || '';
  box.hidden = !message;
  els.from.setAttribute('aria-invalid', message ? 'true' : 'false');
  els.to.setAttribute('aria-invalid', message ? 'true' : 'false');
}

// Query + filters only (no paging/sort) — shared by count and export.
function queryParams() {
  const p = new URLSearchParams();
  const q = els.q.value.trim();
  if (q) p.set('q', q);
  if (els.fTitle.value.trim()) p.set('title', els.fTitle.value.trim());
  if (els.fDescription.value.trim()) p.set('description', els.fDescription.value.trim());
  if (els.fRef.value.trim()) p.set('ref', els.fRef.value.trim());
  if (els.fDates.value.trim()) p.set('dates', els.fDates.value.trim());
  if (els.fLevel.value) p.set('level', els.fLevel.value);
  if (els.fAccess.value) p.set('access', els.fAccess.value);
  const from = yearOf(els.from.value), to = yearOf(els.to.value);
  // An INVERTED range (From later than To) matched nothing and said nothing, so the app
  // reported "no records" for a query that was never valid -- a wrong answer rather than
  // an empty one. Report it instead of sending it (UX plan T3-09, #190).
  if (from && to && Number(from) > Number(to)) {
    reportDateRangeError(`From (${from}) is later than To (${to}).`);
    return null;
  }
  reportDateRangeError(null);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  // A selected letter restricts to records whose reference begins with it. With
  // no search terms this browses the top-level fonds (top=1); with search terms
  // it filters to all matching records within those fonds (no top).
  if (state.letter) {
    p.set('letter', state.letter);
    if (!hasTextInput()) p.set('top', '1');
  }
  return p;
}

function hasTextInput() {
  return !!(els.q.value.trim() || els.fTitle.value.trim() || els.fDescription.value.trim() ||
    els.fRef.value.trim() || els.fDates.value.trim() || els.fLevel.value || els.fAccess.value);
}

/** @param {number} offset */
function params(offset) {
  const p = queryParams();
  if (!p) return null;   // inverted date range; reportDateRangeError has said so
  p.set('sort', els.sort.value);
  p.set('dir', String(els.dir.dataset.dir));
  p.set('limit', String(LIMIT));
  p.set('offset', String(offset));
  return p;
}

function hasAnyInput() {
  return els.q.value.trim() || els.fTitle.value.trim() || els.fDescription.value.trim() ||
    els.fRef.value.trim() || els.fDates.value.trim() || els.fLevel.value || els.fAccess.value ||
    yearOf(els.from.value) || yearOf(els.to.value) || state.letter || state.azScope.state() === 'all';
}

// The status line prefers the exact total once the (async, parallel) count
// lands; until then it shows the loaded-so-far "N+" fallback.
function updateStatus() {
  const hasInput = hasAnyInput();
  if (els.exportResults) els.exportResults.disabled = !hasInput || state.total === 0;
  if (!hasInput) { els.status.textContent = 'Type to search 1,538,177 PRONI catalogue records - or pick a starting letter.'; return; }
  // letter alone browses fonds -> summarise everything under the letter by level;
  // letter + search terms is a filtered search -> show the matching-result count
  const browseMode = state.letter && !hasTextInput();
  if (state.azScope.state() === 'all') {
    els.status.textContent = state.total != null
      ? `${state.total.toLocaleString()} top-level references, A–Z`
      : 'Loading the full reference list…';
    return;
  }
  if (browseMode && state.levels && state.levels.length) {
    // The breakdown never carried a total, so browse mode was the one place the reader
    // could not see how many records they were looking at. count.js already returns the
    // per-level numbers; the total is their sum, not another query.
    const total = state.levels.reduce((sum, l) => sum + (Number(l.n) || 0), 0);
    els.status.textContent = `Reference ${state.letter} - ${total.toLocaleString()} record${total === 1 ? '' : 's'}: ${formatLevels(state.levels)}`;
    return;
  }
  if (state.total != null && !browseMode) {
    const scope = state.letter ? ` in reference ${state.letter}` : '';
    els.status.textContent = state.total === 0 ? 'No matching records.' : `${state.total.toLocaleString()} result${state.total === 1 ? '' : 's'}${scope}`;
    return;
  }
  // Deliberately no "N+" while the exact count is in flight. It is only ever wrong for a
  // few hundred milliseconds, but a number that changes under the reader is worse than
  // no number: it invites them to read a partial figure as the answer. Once the results have
  // ended the loaded count IS exact, so it is shown then.
  const n = state.seen.size;
  if (browseMode) { els.status.textContent = `Reference ${state.letter} - counting…`; return; }
  if (resultsEnded() && n) els.status.textContent = `${n.toLocaleString()} result${n === 1 ? '' : 's'}`;
  else if (resultsEnded()) els.status.textContent = 'No matching records.';
  else els.status.textContent = 'Searching…';
}

/** @param {number} qid the query's id (state.queryId when it began) */
async function fetchCount(qid) {
  try {
    // letter alone -> per-level breakdown of everything under the letter;
    // letter + terms (or plain search) -> a normal matching-result count
    const browseMode = state.letter && !hasTextInput();
    const url = browseMode
      ? `${COUNT_API}?letter=${encodeURIComponent(state.letter)}&breakdown=1`
      : (() => { const qp = queryParams(); return qp ? `${COUNT_API}?${qp}` : null; })();
    if (!url) return;
    const data = /** @type {ProniCountAnswer} */ (await (await fetch(url)).json());
    if (qid !== state.queryId) return;                 // a newer query superseded this
    if (browseMode && Array.isArray(data.levels)) { state.levels = data.levels; state.total = data.count ?? null; updateStatus(); }
    else if (typeof data.count === 'number') { state.total = data.count; state.levels = null; updateStatus(); }
  } catch { /* keep the loaded-so-far fallback */ }
}

/**
 * The 'All' view: every top-level record, grouped by first letter.
 *
 * 'All' previously just cleared the letter filter, which returned the reader to "type to
 * search" -- so the one control that sounds like "show me everything" showed nothing.
 * It now renders all 9,404 top-level records in letter sections, and within each section
 * in the same order a single letter would give (by reference), so moving between the two
 * views does not reorder anything.
 *
 * Rendered a section at a time as the reader scrolls. 9,404 cards at once is several
 * seconds of layout on a mid-range phone, and the letter sections are natural batch
 * boundaries -- which is why grouping makes the paging easier rather than harder.
 */
const ALL_SECTION_BATCH = 3;

/** @param {ProniRoot[]} roots @returns {Array<[string, ProniRoot[]]>} */
function groupRootsByLetter(roots) {
  /** @type {Map<string, ProniRoot[]>} */
  const groups = new Map();
  for (const r of roots) {
    const letter = String(r.ref || '').charAt(0).toUpperCase() || '#';
    if (!groups.has(letter)) groups.set(letter, []);
    /** @type {ProniRoot[]} */ (groups.get(letter)).push(r);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([letter, items]) => [letter, items.sort((a, b) => String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }))]);
}

/** @param {boolean} reset @param {number} rid this load's request id (state.reqId when it began) */
async function renderAllRoots(reset, rid) {
  if (reset) { els.results.innerHTML = ''; state.allSections = null; state.allIndex = 0; }
  const roots = await loadRoots();
  if (!roots) {
    els.status.textContent = 'Could not load the full reference list.';
    if (rid === state.reqId) state.results.to('failed');
    return;
  }
  if (!state.allSections) {
    state.allSections = groupRootsByLetter(roots);
    state.total = roots.length;
    updateStatus();
  }
  const slice = state.allSections.slice(state.allIndex, state.allIndex + ALL_SECTION_BATCH);
  for (const [letter, items] of slice) {
    const heading = `<li class="ps-section" role="presentation"><h2 class="ps-section__title" id="ps-section-${esc(letter)}">${esc(letter)}</h2>`
      + `<span class="ps-section__count">${items.length.toLocaleString()} record${items.length === 1 ? '' : 's'}</span></li>`;
    els.results.insertAdjacentHTML('beforeend', heading + items.map((r) => card(r)).join(''));
  }
  state.allIndex += slice.length;
  if (rid === state.reqId) state.results.to(state.allIndex >= state.allSections.length ? 'done' : 'idle');
  updateStatus();
}

/** @param {boolean} reset a new query (else the next page of the current one) */
async function search(reset) {
  if (state.results.state() === 'loading' && !reset) return; // a new query interrupts an in-flight load; only pagination waits
  if (reset) {
    // A new query: a page still loading for the old one is stale from here (its request id
    // is behind), so it neither writes results nor moves the machine.
    state.offset = 0; state.seen = new Set(); state.total = null; state.levels = null; state.queryId += 1; state.reqId += 1;
    state.results.to('idle');
  }
  if (resultsEnded()) return;
  if (!hasAnyInput()) {
    els.results.innerHTML = '';
    state.results.to('done');
    updateStatus();
    return;
  }
  const rid = ++state.reqId;
  state.results.to('loading');
  if (state.azScope.state() === 'all') {
    try { await renderAllRoots(reset, rid); } finally {
      if (rid === state.reqId && state.results.state() === 'loading') state.results.to('idle');
    }
    return;
  }
  if (reset) { els.status.textContent = 'Searching…'; fetchCount(state.queryId); }
  try {
    const search = params(state.offset);
    if (!search) {
      // Inverted date range. reportDateRangeError has already said so beside the inputs;
      // saying "no records" here as well would contradict it.
      els.status.textContent = 'Check the date range.';
      state.results.to('done');
      return;
    }
    const resp = await fetch(`${API}?${search}`);
    const data = /** @type {ProniSearchAnswer} */ (await resp.json());
    if (rid !== state.reqId) return; // stale
    if (data.error) { els.status.textContent = 'Search error.'; state.results.to('failed'); return; }
    const batch = data.results || [];
    if (reset) els.results.innerHTML = '';
    const fresh = batch.filter((r) => !state.seen.has(r.ref));
    fresh.forEach((r) => { state.seen.add(r.ref); els.results.insertAdjacentHTML('beforeend', card(r)); });
    state.offset += LIMIT;
    state.results.to(batch.length < LIMIT ? 'done' : 'idle');
    if (!state.seen.size) els.results.innerHTML = '<li class="ps-empty">No records match your search. Try fewer or broader terms.</li>';
    updateStatus();
  } catch {
    if (rid === state.reqId) els.status.textContent = 'Search is temporarily unavailable.';
  } finally {
    // Only this query's latest request settles the machine: a stale one used to clear the
    // loading flag while the newer request was still in flight.
    if (rid === state.reqId && state.results.state() === 'loading') state.results.to('idle');
    // keep loading until the results fill the viewport (short result sets, so the
    // scroll observer alone would never re-fire) — only while the home view is up
    if (rid === state.reqId && view.state() === 'search' && !resultsEnded() && hasAnyInput() &&
        els.sentinel.getBoundingClientRect().top < window.innerHeight + 300) {
      setTimeout(() => search(false), 80);
    }
  }
}

/* =================== expand / collapse (sticky parent) =================== */

/** @param {Element} btn @param {boolean} expanded @param {boolean} [loading] */
function setExpandLabel(btn, expanded, loading) {
  const icon = btn.querySelector('.ps-expand__icon');
  const label = btn.querySelector('.ps-expand__label');
  if (loading) { if (label) label.textContent = 'Loading…'; return; }
  if (icon) icon.textContent = expanded ? '▾' : '▸';
  if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
  btn.setAttribute('aria-expanded', String(expanded));
  btn.classList.toggle('is-open', expanded);
}

/** @param {string} ref @param {UiElement} btn */
async function toggleExpand(ref, btn) {
  const li = /** @type {HTMLElement | null} */ (btn.closest('.ps-card'));
  if (!li) return;
  const kids = /** @type {HTMLElement} */ (li.querySelector(':scope > .ps-children')); // every card's markup has it
  const depth = Number(li.dataset.depth) || 0;
  // The card's sub-records (state-machines.js CARD_CHILDREN); the card's class holds the state
  // between clicks, and the button is disabled while `loading`, so a click never meets it.
  const children = CARD_CHILDREN.start(li.classList.contains('is-expanded') ? 'expanded' : 'collapsed');

  if (children.state() === 'expanded') {
    children.to('collapsed');
    // Collapse — then land the user back on the card they collapsed, rather than
    // wherever the shrinking page leaves the scroll position.
    li.classList.remove('is-expanded');
    kids.hidden = true; kids.innerHTML = '';
    setExpandLabel(btn, false);
    const y = li.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: Math.max(0, y) });
    return;
  }

  children.to('loading');
  setExpandLabel(btn, false, true);
  btn.disabled = true;
  try {
    const data = /** @type {ProniNodeAnswer} */ (await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json());
    const records = data.children || [];
    kids.innerHTML = records.length
      ? records.map((c) => card(c, depth + 1)).join('')
      : '<li class="ps-children__empty">No sub-records found.</li>';
    kids.hidden = false;
    li.classList.add('is-expanded');
    children.to('expanded');
    setExpandLabel(btn, true);
  } catch {
    if (children.state() === 'loading') children.to('collapsed');
    setExpandLabel(btn, false);
  } finally {
    btn.disabled = false;
  }
}

/* =========================== record page =========================== */

/** @param {string} ref */
async function renderRecord(ref) {
  showView('record');
  window.scrollTo(0, 0);
  document.title = `${ref} - Independent PRONI Search`;
  els.viewRecord.innerHTML = '<p class="ps-loading">Loading record…</p>';
  const token = routeToken;

  /** @type {ProniNodeAnswer | undefined} */
  let data;
  try {
    data = await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json();
  } catch {
    if (token === routeToken) els.viewRecord.innerHTML = recordShell('<p class="ps-empty">Could not load this record. Please try again.</p>');
    return;
  }
  if (token !== routeToken) return;
  if (!data || !data.item) {
    els.viewRecord.innerHTML = recordNotFound(ref);
    return;
  }

  els.viewRecord.innerHTML = recordHtml(data);
}

/* ==================== "View on PRONI eCatalogue" page ==================== */

/** @param {string} ref */
function renderEcat(ref) {
  showView('ecat');
  window.scrollTo(0, 0);
  document.title = 'View on PRONI eCatalogue - Independent PRONI Search';
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
            <figcaption class="ps-shotframe__cap">📷 Example screenshot of the official PRONI eCatalogue - not part of this page</figcaption>
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

// Which view is shown (state-machines.js VIEW); each view's `hidden` follows the machine.
const view = VIEW.start();
/** @param {'search' | 'record' | 'ecat'} name */
function showView(name) {
  view.to(name);
  els.viewSearch.hidden = name !== 'search';
  els.viewRecord.hidden = name !== 'record';
  els.viewEcat.hidden = name !== 'ecat';
}
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
  showView('search');
  document.title = 'Independent PRONI Search';
  window.scrollTo(0, homeScrollY);
}

// A record address arrives with the record already on the page: the server rendered it into
// #viewRecord with record-view.js (packages/api/src/handlers/proni/page.js) and marked it with
// data-ssr-ref. The first route keeps that page, and its title, instead of fetching it again.
const ssrRef = els.viewRecord.dataset.ssrRef;
delete els.viewRecord.dataset.ssrRef;

function route() {
  if (view.state() === 'search') homeScrollY = window.scrollY;
  routeToken += 1;
  closeModal();
  const ecat = new URLSearchParams(location.search).get('ecat');
  if (ecat) { renderEcat(ecat); return; }
  const ref = currentRef();
  if (ref && routeToken === 1 && ref === ssrRef) { showView('record'); return; }
  if (ref) { renderRecord(ref); return; }
  showHome();
}

/** @param {string | null} url @param {boolean} [replace] replace the history entry instead of adding one */
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

/** @param {string} text */
function fallbackCopy(text) {
  // Restore focus afterwards. The textarea has to take focus for execCommand('copy') to
  // work, and removing it leaves focus on <body> -- so a keyboard user who copied a
  // reference lost their place in the results and had to tab back from the top.
  const previous = /** @type {HTMLElement | null} */ (document.activeElement);
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch { /* no-op */ }
  document.body.removeChild(ta);
  if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
    previous.focus();
  }
}

/**
 * The copy confirmation of each element (COPY_FLASH). `show` puts it up and returns what takes
 * it down; a second copy while it shows only restarts the timer, so the button no longer saves
 * '✓ Copied' as the label to put back, and the guide's note no longer hides at the first timer.
 * @type {WeakMap<Element, { run: ReturnType<typeof COPY_FLASH.start>, timer: ReturnType<typeof setTimeout> | undefined, hide: () => void }>}
 */
const copyFlashes = new WeakMap();
/**
 * @param {Element} el
 * @param {number} ms
 * @param {() => () => void} show
 */
function flashCopied(el, ms, show) {
  let flash = copyFlashes.get(el);
  if (!flash) {
    flash = { run: COPY_FLASH.start(), timer: undefined, hide: () => {} };
    copyFlashes.set(el, flash);
  }
  const current = flash;
  if (current.run.state() === 'idle') {
    current.run.to('copied');
    current.hide = show();
  }
  clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    current.run.to('idle');
    current.hide();
  }, ms);
}

/** @param {UiElement} el the copy button, or the guide's reference field */
async function copyRef(el) {
  const ref = el.getAttribute('data-copy');
  if (!ref) return;
  try { await navigator.clipboard.writeText(ref); } catch { fallbackCopy(ref); }
  if (el.classList.contains('ps-copy')) {
    flashCopied(el, 1400, () => {
      const old = el.innerHTML;
      el.innerHTML = '✓ Copied'; el.classList.add('is-copied');
      return () => { el.innerHTML = old; el.classList.remove('is-copied'); };
    });
  } else {
    flashCopied(el, 1600, () => {
      el.classList.add('is-copied');
      const note = /** @type {HTMLElement | null} */ (el.parentElement && el.parentElement.querySelector('.ps-guide__copied'));
      if (note) { note.hidden = false; }
      return () => {
        el.classList.remove('is-copied');
        if (note) note.hidden = true;
      };
    });
  }
}

/* ============================= detail modal ============================= */

/**
 * "Show more" expands the card in place first, and opens the modal on the second press.
 *
 * It used to jump straight to the modal, which is a heavy response to "I would like to
 * read a bit more" -- it covers the page, loses the reader's place in the results, and
 * has to be dismissed to carry on scanning. Two presses now match two intentions: read a
 * little more here, or leave the list and read the whole record.
 *
 * THE FULL TEXT IS FETCHED, NOT PRE-SENT. The search endpoint truncates descriptions to
 * DESC_PREVIEW and flags `descTruncated`, so the card never had the rest of the text.
 * Sending it with every result would multiply the search payload by 25 results a page
 * for text most readers never open; fetching on the first press costs one request, only
 * for the cards someone actually expands, and it is the same endpoint the modal already
 * uses, so it is usually warm by the time they press again.
 *
 * The 3x cap is enforced in CSS via max-height rather than by measuring the text, so a
 * short-but-truncated description does not animate to an odd fraction of a card.
 *
 * Scroll position is pinned across the expansion. Growing a card halfway down a long
 * list otherwise pushes everything below it, and the thing the reader was pointing at
 * moves out from under the cursor.
 * @param {UiElement} button the card's "Show more" button
 */
async function expandOrOpen(button) {
  const ref = /** @type {string} */ (button.getAttribute('data-more')); // matched by [data-more], so always a string
  const card = /** @type {HTMLElement | null} */ (button.closest('.ps-card'));
  if (!card) { openModal(ref); return; }

  // The description (state-machines.js CARD_DESCRIPTION); the card holds the state between clicks.
  const description = CARD_DESCRIPTION.start(card.classList.contains('is-expanded') ? 'expanded' : 'preview');
  if (description.state() === 'expanded') { description.to('expanded'); openModal(ref); return; }

  const desc = card.querySelector('.ps-card__desc');
  if (!desc) { openModal(ref); return; }

  if (!card.dataset.fullLoaded) {
    description.to('loading');
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Loading…';
    try {
      const data = /** @type {ProniNodeAnswer | null} */ (await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json());
      const full = data?.item?.description;
      if (full) { desc.textContent = full; card.dataset.fullLoaded = '1'; }
    } catch {
      // Leave the preview in place and fall through to the modal, which reports its own
      // failure. A silent no-op on a button press is the one outcome to avoid.
      description.to('preview');
      button.disabled = false;
      button.textContent = previous;
      openModal(ref);
      return;
    }
    button.disabled = false;
  }
  description.to('expanded');

  const before = card.getBoundingClientRect().top;
  card.classList.add('is-expanded');
  button.textContent = 'Show full record';
  button.setAttribute('aria-expanded', 'true');
  const after = card.getBoundingClientRect().top;
  if (after !== before) window.scrollBy(0, after - before);
}

// The record dialog, open or closed; the page behind it does not scroll while it is open.
const modal = MODAL.start();
/** @param {boolean} open */
function showModal(open) {
  const next = open ? 'open' : 'closed';
  if (modal.state() !== next) modal.to(next);
  els.modal.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
}

/** @param {string} ref */
async function openModal(ref) {
  showModal(true);
  els.modalBody.innerHTML = '<p class="ps-loading">Loading record…</p>';
  try {
    const data = /** @type {ProniNodeAnswer} */ (await (await fetch(`${NODE_API}?ref=${encodeURIComponent(ref)}`)).json());
    const it = data.item;
    if (!it) { els.modalBody.innerHTML = '<p class="ps-empty">Record not found.</p>'; return; }
    const rows = [
      ['PRONI reference', it.ref], ['Title', it.title], ['Level', it.level], ['Dates', it.dates],
      ['Access', it.access], ['Digital record', it.digitalRecord ? 'Digitised - held by PRONI' : ''],
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
function closeModal() { showModal(false); }

/* ============================== A-Z bar ============================== */

'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((L) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ps-az__btn'; b.textContent = L; b.dataset.letter = L;
  els.az.appendChild(b);
});
const azClear = document.createElement('button');
azClear.type = 'button'; azClear.className = 'ps-az__clear'; azClear.textContent = 'All';
azClear.setAttribute('aria-pressed', 'false');
els.az.appendChild(azClear);

/* =============================== events =============================== */

/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
const debounced = () => {
  clearTimeout(timer);
  els.clear.hidden = !els.q.value;
  // typing filters *within* the selected letter — the letter stays selected
  timer = setTimeout(() => search(true), 220);
};
[els.q, els.fTitle, els.fDescription, els.fRef, els.fDates].forEach((el) => el.addEventListener('input', debounced));
[els.from, els.to, els.sort, els.fLevel, els.fAccess].forEach((el) => el.addEventListener('change', () => search(true)));

els.dir.addEventListener('click', () => {
  const next = els.dir.dataset.dir === 'asc' ? 'desc' : 'asc';
  els.dir.dataset.dir = next;
  child(els.dir, '.ps-sortdir__label').textContent = next === 'asc' ? 'A–Z' : 'Z–A';
  child(els.dir, '.ps-sortdir__arrow').textContent = next === 'asc' ? '▲' : '▼';
  els.dir.title = next === 'asc' ? 'Sort ascending - click for descending' : 'Sort descending - click for ascending';
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
  const qp = queryParams();
  if (!qp) return;   // do not export a query the user cannot have meant
  window.location.href = `${EXPORT_API}?${qp}`; // streamed CSV download
});
els.az.addEventListener('click', (/** @type {MouseEvent} */ rawEvent) => { const e = /** @type {ElementEvent<MouseEvent>} */ (rawEvent);
  const btn = e.target.closest('[data-letter]');
  if (btn) {
    // toggle the letter; it filters alongside any active search terms
    if (state.letter === btn.dataset.letter) {
      state.azScope.to('none');
      state.letter = '';
    } else {
      state.azScope.to('letter');
      state.letter = btn.dataset.letter ?? ''; // matched by [data-letter], so always a string
    }
  } else if (e.target === azClear) {
    // 'All' now MEANS all: every top-level record, grouped by letter. It used to clear
    // the filter and leave an empty screen, which is the opposite of what the word says.
    state.letter = '';
    state.azScope.to(state.azScope.state() === 'all' ? 'none' : 'all');
  } else return;
  azClear.classList.toggle('is-active', state.azScope.state() === 'all');
  azClear.setAttribute('aria-pressed', String(state.azScope.state() === 'all'));
  /** @type {NodeListOf<HTMLElement>} */ (els.az.querySelectorAll('.ps-az__btn')).forEach((b) => b.classList.toggle('is-active', b.dataset.letter === state.letter));
  search(true);
});

// One delegated handler for the whole app (search cards, record page, guide).
const isModified = (/** @type {MouseEvent} */ e) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
document.addEventListener('click', (/** @type {MouseEvent} */ rawEvent) => { const e = /** @type {ElementEvent<MouseEvent>} */ (rawEvent);
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) { e.preventDefault(); copyRef(copyEl); return; }

  const expandEl = e.target.closest('[data-expand]');
  if (expandEl) { e.preventDefault(); toggleExpand(/** @type {string} */ (expandEl.getAttribute('data-expand')), expandEl); return; }

  const moreEl = e.target.closest('[data-more]');
  if (moreEl) { e.preventDefault(); expandOrOpen(moreEl); return; }

  if (e.target.closest('[data-close]')) { closeModal(); return; }

  const backEl = e.target.closest('[data-back]');
  if (backEl) { e.preventDefault(); goBack(); return; }

  if (isModified(e)) return; // let ctrl/cmd-click open a new tab

  const ecatEl = e.target.closest('[data-ecat]');
  if (ecatEl) { e.preventDefault(); go(`${location.pathname}?ecat=${encodeURIComponent(String(ecatEl.getAttribute('data-ecat')))}`); return; }

  const homeEl = e.target.closest('[data-home]');
  if (homeEl) { e.preventDefault(); go('/proni'); return; }

  const goEl = e.target.closest('[data-go]');
  if (goEl) { e.preventDefault(); go(goEl.getAttribute('data-go')); return; }
});

document.addEventListener('keydown', (/** @type {KeyboardEvent} */ rawEvent) => { const e = /** @type {ElementEvent<KeyboardEvent>} */ (rawEvent);
  if (e.key === 'Escape' && modal.state() === 'open') { closeModal(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-copy].ps-guide__reffield')) {
    e.preventDefault(); copyRef(e.target);
  }
});

window.addEventListener('popstate', route);

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && view.state() === 'search' && state.results.state() === 'idle' && hasAnyInput()) search(false);
}, { rootMargin: '600px' }).observe(els.sentinel);

// Initialise the home view, then render whatever the current URL asks for.
search(true);
route();
