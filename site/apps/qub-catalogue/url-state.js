/**
 * The Independent QUB Catalogue's URL state (architecture rule R8: one pure, tested function pair
 * per view). /qub?q=…&scope=…&tag=A,B&from=…&to=…&sort=…&dir=… is the search; /qub/<mms_id> a
 * record. Defaults are left out of the URL, so the plain /qub is the default search.
 */
import { BASE, DEFAULTS } from './config.js';

/** @typedef {'in' | 'out' | 'all'} Scope */
/**
 * @typedef {object} SearchState
 * @property {string} q
 * @property {Scope} scope
 * @property {string[]} tags
 * @property {string} from
 * @property {string} to
 * @property {'relevance' | 'year' | 'title'} sort
 * @property {'asc' | 'desc'} dir
 */
/** @typedef {{ view: 'search', search: SearchState } | { view: 'record', id: string, search: SearchState }} Route */

const TAG_LETTERS = 'ABCDEFGH';

/**
 * Read an address.
 * @param {string} pathname
 * @param {string} search  location.search
 * @returns {Route}
 */
export function parseRoute(pathname, search) {
  const p = new URLSearchParams(search);
  const g = (/** @type {string} */ k) => (p.get(k) || '').trim();
  const scopeRaw = g('scope');
  const sortRaw = g('sort');
  /** @type {SearchState} */
  const state = {
    q: g('q'),
    scope: scopeRaw === 'all' || scopeRaw === 'out' ? scopeRaw : 'in',
    tags: [...new Set(g('tag').toUpperCase().split(/[\s,]+/).filter((t) => t.length === 1 && TAG_LETTERS.includes(t)))].sort(),
    from: /^\d{1,4}$/.test(g('from')) ? g('from') : '',
    to: /^\d{1,4}$/.test(g('to')) ? g('to') : '',
    sort: sortRaw === 'year' || sortRaw === 'title' ? sortRaw : 'relevance',
    dir: g('dir') === 'desc' ? 'desc' : 'asc',
  };
  const m = new RegExp(`^${BASE}/(\\d+)/?$`).exec(pathname);
  return m ? { view: 'record', id: /** @type {string} */ (m[1]), search: state } : { view: 'search', search: state };
}

/**
 * The query string of a search: the API's parameters, defaults left out.
 * @param {SearchState} s
 * @returns {string}  '' or '?…'
 */
export function searchQuery(s) {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.scope !== DEFAULTS.scope) p.set('scope', s.scope);
  if (s.tags.length) p.set('tag', s.tags.join(','));
  if (s.from) p.set('from', s.from);
  if (s.to) p.set('to', s.to);
  if (s.sort !== DEFAULTS.sort) p.set('sort', s.sort);
  if (s.dir !== DEFAULTS.dir) p.set('dir', s.dir);
  const text = p.toString();
  return text ? `?${text}` : '';
}

/** A record's address. @param {string} id */
export const recordPath = (id) => `${BASE}/${encodeURIComponent(id)}`;

/** The search page's address for a state. @param {SearchState} s */
export const searchPath = (s) => `${BASE}${searchQuery(s)}`;

/** Does a search state ask for anything (text, a topic or a year)? With scope 'in' alone it lists the in-scope records. @param {SearchState} s */
export const hasCriteria = (s) => Boolean(s.q || s.tags.length || s.from || s.to || s.scope !== 'all');
