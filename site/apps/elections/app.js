/**
 * Civgraph Elections: the app shell. Routes (lib/route.js) load their view module on demand, so
 * the first view loads only the shell, the shared helpers and its own module; the pivot tables'
 * DuckDB and the maps' MapLibre load only on those tools.
 *
 * Not public yet (owner, 11 Nov 2026): noindex, not linked from the site, not in a sitemap.
 */
import { isAppHref, parseRoute } from './lib/route.js';
import { esc } from './lib/format.js';

/** @type {Record<string, () => Promise<{ render: (root: HTMLElement, route: any, ctx: any) => Promise<string> }>>} */
const VIEWS = {
  home: () => import('./views/home.js'),
  body: () => import('./views/home.js'),
  election: () => import('./views/election.js'),
  contest: () => import('./views/contest.js'),
  pivot: () => import('./views/pivot.js'),
  map: () => import('./views/map.js'),
  compare: () => import('./views/compare.js'),
  swing: () => import('./views/swing.js'),
  notional: () => import('./views/notional.js'),
};
/** @type {Record<string, string>} */
const TAB_OF = { home: 'home', body: 'home', election: 'home', contest: 'home', pivot: 'pivot', map: 'map', compare: 'compare', swing: 'swing', notional: 'notional' };

const root = /** @type {HTMLElement} */ (document.getElementById('el-view'));
let generation = 0;

/** Render the current URL's view. */
async function render() {
  const mine = ++generation;
  const route = parseRoute(location.pathname, location.search);
  for (const a of document.querySelectorAll('.el-tabs a')) {
    if (a.getAttribute('data-tab') === TAB_OF[route.view]) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  root.setAttribute('aria-busy', 'true');
  try {
    const mod = await VIEWS[route.view]();
    if (mine !== generation) return;
    /** A view renders into root and returns the page title; `stale()` says a newer route started. */
    const title = await mod.render(root, route, { stale: () => mine !== generation, navigate });
    if (mine !== generation) return;
    document.title = title ? `${title} - Civgraph Elections` : 'Civgraph Elections';
  } catch (err) {
    if (mine !== generation) return;
    const status = /** @type {any} */ (err)?.status;
    root.innerHTML = status === 404
      ? '<h1>Not found</h1><p>There is no election or contest at this address. <a href="/elections/">All elections</a>.</p>'
      : `<h1>Something went wrong</h1><p class="cg-notice cg-notice--danger">${esc(/** @type {Error} */ (err)?.message || err)}</p>`;
    document.title = 'Civgraph Elections';
    console.error(err);
  } finally {
    if (mine === generation) root.removeAttribute('aria-busy');
  }
}

/** Go to an app URL without a page load (replace: keep history clean for state changes). */
/** @param {string} href @param {{ replace?: boolean, keepScroll?: boolean }} [opts] */
export function navigate(href, { replace = false, keepScroll = false } = {}) {
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  if (!keepScroll) window.scrollTo(0, 0);
  return render();
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = /** @type {HTMLElement | null} */ (event.target instanceof Element ? event.target.closest('a[href]') : null);
  if (!a || a.getAttribute('target') || a.hasAttribute('download')) return;
  const href = a.getAttribute('href') || '';
  if (!isAppHref(href, location.origin)) return;
  event.preventDefault();
  navigate(new URL(href, location.origin).pathname + new URL(href, location.origin).search);
});
window.addEventListener('popstate', () => render());

render();
