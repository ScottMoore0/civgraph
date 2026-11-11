/**
 * Civgraph Elections: the app shell. Routes (lib/route.js) load their view module on demand, so
 * the first view loads only the shell, the shared helpers and its own module; the pivot tables'
 * DuckDB and the maps' MapLibre load only on those tools.
 *
 * Not public yet (owner, 11 Nov 2026): noindex, not linked from the site, not in a sitemap.
 */
import { isAppHref, parseRoute } from './lib/route.js';
import { esc } from './lib/format.js';
import { createViewScope } from './lib/lifecycle.js';
import { ROUTE } from './state-machines.js';

/**
 * A view module: `render` draws into the root and returns the page title.
 * @typedef {import('./lib/route.js').Route} Route
 * @typedef {{ signal: AbortSignal, stale: () => boolean, onDispose: (cleanup: () => void) => void, navigate: typeof navigate }} ViewContext
 * @typedef {{ render: (root: HTMLElement, route: Route, ctx: ViewContext) => Promise<string> }} ViewModule
 */

/** @type {Record<string, () => Promise<ViewModule>>} */
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
/** EL-01: the route's state (state-machines.js ROUTE). */
const routeRun = ROUTE.start();
/** The view on screen (or loading): leaving it disposes its listeners, maps and holders. */
let scope = createViewScope();

/** Render the current URL's view. */
async function render() {
  scope.dispose();
  const mine = createViewScope();
  scope = mine;
  routeRun.to('loading');
  root.dataset.route = 'loading';
  const route = parseRoute(location.pathname, location.search);
  for (const a of document.querySelectorAll('.el-tabs a')) {
    if (a.getAttribute('data-tab') === TAB_OF[route.view]) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  root.setAttribute('aria-busy', 'true');
  try {
    const mod = await VIEWS[route.view]();
    if (mine.stale()) return;
    const title = await mod.render(root, route, { signal: mine.signal, stale: mine.stale, onDispose: mine.onDispose, navigate });
    if (mine.stale()) return;
    document.title = title ? `${title} - Civgraph Elections` : 'Civgraph Elections';
    root.dataset.route = routeRun.to('rendered');
  } catch (err) {
    if (mine.stale()) return;
    const status = /** @type {{ status?: number } | null} */ (err)?.status;
    root.innerHTML = status === 404
      ? '<h1>Not found</h1><p>There is no election or contest at this address. <a href="/elections/">All elections</a>.</p>'
      : `<h1>Something went wrong</h1><p class="cg-notice cg-notice--danger">${esc(/** @type {Error} */ (err)?.message || err)}</p>`;
    document.title = 'Civgraph Elections';
    root.dataset.route = routeRun.to(status === 404 ? 'not-found' : 'failed');
    console.error(err);
  } finally {
    if (!mine.stale()) root.removeAttribute('aria-busy');
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
