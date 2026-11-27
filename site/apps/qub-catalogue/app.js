/**
 * The Independent QUB Catalogue app (/qub, /qub/<mms_id>): search Queen's University Belfast
 * Library's catalogue, by default only the records within Civgraph's scope, and read a record
 * with its link to QUB's own catalogue. LOCAL ONLY until the owner approves its deployment
 * (LANDING/qub-app). Views only wire: the markup is views.js, the URL state url-state.js, the
 * reads api.js, the states state-machines.js.
 */
import * as api from './api.js';
import { RESULTS, VIEW } from './state-machines.js';
import { parseRoute, searchPath } from './url-state.js';
import { siteNumber } from '../../pkg/core/src/format.js';
import { recordHtml, recordMissing, resultCard, setTagNames, statsHtml, summaryLine, tagFilters } from './views.js';
import { EXPORT_CAP, PAGE_SIZE } from './config.js';

/** @typedef {import('./url-state.js').SearchState} SearchState */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const el = {
  viewSearch: $('viewSearch'), viewRecord: $('viewRecord'), form: /** @type {HTMLFormElement} */ ($('searchForm')),
  q: /** @type {HTMLInputElement} */ ($('q')), scope: /** @type {HTMLSelectElement} */ ($('scope')),
  from: /** @type {HTMLInputElement} */ ($('from')), to: /** @type {HTMLInputElement} */ ($('to')),
  sort: /** @type {HTMLSelectElement} */ ($('sort')), dir: /** @type {HTMLSelectElement} */ ($('dir')),
  tags: $('tagFilters'), stats: $('stats'), summary: $('summary'), results: $('results'), more: /** @type {HTMLButtonElement} */ ($('moreBtn')),
  status: $('status'), exportLink: /** @type {HTMLAnchorElement} */ ($('exportLink')),
};

const view = VIEW.start();
const results = RESULTS.start();
/** @type {AbortController | null} */
let searchRun = null;
/** @type {AbortController | null} */
let recordRun = null;
let offset = 0;
/** @type {SearchState} */
let current = parseRoute(location.pathname, location.search).search;

/** The form's search state. @returns {SearchState} */
function formState() {
  const tags = [...el.tags.querySelectorAll('input[name="tag"]:checked')].map((i) => /** @type {HTMLInputElement} */ (i).value).sort();
  return {
    q: el.q.value.trim(), scope: /** @type {SearchState['scope']} */ (el.scope.value), tags,
    from: el.from.value.trim(), to: el.to.value.trim(),
    sort: /** @type {SearchState['sort']} */ (el.sort.value), dir: el.dir.value === 'desc' ? 'desc' : 'asc',
  };
}

/** Put a search state into the form. @param {SearchState} s */
function fillForm(s) {
  el.q.value = s.q; el.scope.value = s.scope; el.from.value = s.from; el.to.value = s.to;
  el.sort.value = s.sort; el.dir.value = s.dir;
  for (const i of el.tags.querySelectorAll('input[name="tag"]')) {
    const box = /** @type {HTMLInputElement} */ (i);
    box.checked = s.tags.includes(box.value);
  }
}

/** Fetch and draw a page of results; a stale run (a newer search started) changes nothing. @param {boolean} first */
async function loadPage(first) {
  if (first) {
    searchRun?.abort();
    searchRun = new AbortController();
    offset = 0;
    if (results.state() !== 'idle') results.to('idle');
    el.results.innerHTML = '';
    el.summary.textContent = '';
  }
  const run = /** @type {AbortController} */ (searchRun);
  results.to('loading');
  el.status.textContent = 'Searching…';
  el.more.hidden = true;
  try {
    const answer = await api.search(current, offset, run.signal);
    if (run.signal.aborted) return;
    const rows = answer.results.slice(0, PAGE_SIZE);
    el.results.insertAdjacentHTML('beforeend', rows.map(resultCard).join(''));
    if (first) el.summary.textContent = summaryLine(answer.total ?? null, Boolean(answer.totalCapped), current.scope);
    offset += rows.length;
    const more = answer.results.length > PAGE_SIZE;
    results.to(more ? 'idle' : 'done');
    el.more.hidden = !more;
    el.status.textContent = '';
  } catch (error) {
    if (run.signal.aborted) return;
    results.to('failed');
    el.status.textContent = `Search failed: ${/** @type {Error} */ (error).message}`;
  }
}

/** Show a record. @param {string} id */
async function showRecord(id) {
  recordRun?.abort();
  recordRun = new AbortController();
  const run = recordRun;
  el.viewRecord.innerHTML = '<p class="qc-status">Loading…</p>';
  try {
    const answer = await api.record(id, run.signal);
    if (run.signal.aborted) return;
    el.viewRecord.innerHTML = recordHtml(answer);
    document.title = `${answer.item.title} – QUB catalogue record – Civgraph`;
  } catch (error) {
    if (run.signal.aborted) return;
    const status = /** @type {{ status?: number }} */ (error).status;
    el.viewRecord.innerHTML = status === 404 ? recordMissing(id) : `<p class="qc-status">${String(/** @type {Error} */ (error).message)}</p>`;
  }
}

/** Draw the view the address names. */
function route() {
  const r = parseRoute(location.pathname, location.search);
  view.to(r.view);
  el.viewSearch.hidden = r.view !== 'search';
  el.viewRecord.hidden = r.view !== 'record';
  if (r.view === 'record') {
    searchRun?.abort();
    void showRecord(r.id);
    window.scrollTo(0, 0);
    return;
  }
  recordRun?.abort();
  document.title = 'Independent QUB Catalogue – Civgraph';
  current = r.search;
  fillForm(current);
  el.exportLink.href = api.exportUrl(current);
  el.exportLink.title = `Download the matches as CSV (at most ${siteNumber(EXPORT_CAP)} rows)`;
  void loadPage(true);
}

/** Go to an address in the app. @param {string} href */
function go(href) {
  history.pushState(null, '', href);
  route();
}

const life = new AbortController();
const { signal } = life;
el.form.addEventListener('submit', (e) => { e.preventDefault(); go(searchPath(formState())); }, { signal });
el.form.addEventListener('change', (e) => {
  if (/** @type {HTMLElement} */ (e.target).id !== 'q') go(searchPath(formState()));
}, { signal });
el.more.addEventListener('click', () => { if (results.state() === 'idle') void loadPage(false); }, { signal });
document.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const link = target.closest('a[data-go], a[data-back]');
  if (!link || e.defaultPrevented || /** @type {MouseEvent} */ (e).ctrlKey || /** @type {MouseEvent} */ (e).metaKey) return;
  e.preventDefault();
  go(link.hasAttribute('data-back') ? searchPath(current) : String(link.getAttribute('data-go')));
}, { signal });
window.addEventListener('popstate', route, { signal });

api.stats(signal).then((s) => {
  setTagNames(s.tags);
  el.stats.innerHTML = statsHtml(s);
  el.tags.innerHTML = tagFilters(s.tags, current.tags);
}).catch(() => { el.stats.textContent = 'The catalogue is not available.'; });

route();
