/**
 * The Elections app's routes. Pure: tests/unit/elections-app-lib.test.mjs.
 *
 * The app is served at /elections/ (a _redirects rewrite to /apps/elections/index.html) and
 * also answers at /apps/elections/ itself (the file's own address), so both prefixes route.
 *
 *   /elections/                              home: bodies and recent elections
 *   /elections/body/<body-slug>/             one body's elections
 *   /elections/<election-slug>/              an election overview
 *   /elections/<election-slug>/<contest>/    a contest: count sheet, transfers, sources
 *   /elections/pivot/ map/ compare/ swing/ notional/   the tools (state in the query string)
 */
export const BASES = ['/elections', '/apps/elections'];
export const TOOLS = ['pivot', 'map', 'compare', 'swing', 'notional'];

/**
 * @param {string} pathname
 * @param {string} [search]
 * @returns {{ view: string, election?: string, contest?: string, body?: string, query: URLSearchParams }}
 */
export function parseRoute(pathname, search = '') {
  const query = new URLSearchParams(search);
  let rest = String(pathname || '/');
  for (const base of BASES) {
    if (rest === base || rest.startsWith(`${base}/`)) { rest = rest.slice(base.length); break; }
  }
  const parts = rest.split('/').filter(Boolean).map((p) => decodeURIComponent(p)).filter((p) => p !== 'index.html');
  if (!parts.length) return { view: 'home', query };
  if (TOOLS.includes(parts[0])) return { view: parts[0], query };
  if (parts[0] === 'body' && parts[1]) return { view: 'body', body: parts[1], query };
  if (parts.length === 1) return { view: 'election', election: parts[0], query };
  return { view: 'contest', election: parts[0], contest: parts[1], query };
}

/** Whether a link's href is one of the app's own routes (handled without a page load). */
/** @param {string} href @param {string} origin */
export function isAppHref(href, origin) {
  try {
    const u = new URL(href, origin);
    return u.origin === origin && BASES.some((b) => u.pathname === b || u.pathname.startsWith(`${b}/`));
  } catch {
    return false;
  }
}
