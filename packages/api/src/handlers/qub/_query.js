/**
 * The Independent QUB Catalogue's shared request logic (search, export, record, stats): pure,
 * so the unit test qub-query.test.mjs runs it without a database.
 *
 *   q      free text: "phrase", -exclude, field:value (title, author, subject, notes)
 *   scope  'in' (default: Within Civgraph scope) | 'out' | 'all'
 *   tag    one or more of A-H (comma-separated): every tag must be present
 *   from, to   publication year range (inclusive)
 *
 * The rights basis (owner, 27 Nov 2026): QUB's metadata reuse policy allows reuse for
 * not-for-profit purposes when each record links back to its record in QUB's catalogue; every
 * record answer carries that link (qubRecordUrl) and the credit (QUB_CREDIT).
 */

/** Civgraph's scope topics (SCOPE.md, owner-approved 27 Nov 2026). */
export const QUB_TAGS = Object.freeze({
  A: 'Law',
  B: 'Parliaments and government records',
  C: 'Elections and representation',
  D: 'Local government and administration',
  E: 'Places, land and maps',
  F: 'Population and statistics',
  G: 'Political history',
  H: 'Reference works',
});

/** QUB's Primo VE view (qublibsearch.qub.ac.uk redirects to this view). */
export const QUB_PRIMO = Object.freeze({ origin: 'https://qub.primo.exlibrisgroup.com', vid: '44QSUB_INST:QUB' });

export const QUB_CREDIT = 'Catalogue record from Queen’s University Belfast Library, reused under QUB’s metadata reuse policy '
  + '(not-for-profit reuse, with a link back to each record). Some records derive from shared cataloguing sources such as OCLC WorldCat.';

export const LIMITS = Object.freeze({ page: 25, maxPage: 60, exportRows: 50000, exportPage: 1000, countCap: 10000 });

/** @typedef {'in' | 'out' | 'all'} QubScope */
/** @typedef {'relevance' | 'year' | 'title'} QubSort */
/**
 * A search request, as every endpoint reads it.
 * @typedef {object} QubParams
 * @property {string} q
 * @property {QubScope} scope
 * @property {string[]} tags
 * @property {number | null} from
 * @property {number | null} to
 * @property {QubSort} sort
 * @property {'ASC' | 'DESC'} dir
 * @property {number} limit
 * @property {number} offset
 */

/** An MMS ID: Alma's numeric record id (99…8046 at QUB). @param {unknown} id */
export const isMmsId = (id) => /^99\d{6,20}$/.test(String(id ?? ''));

/** The record's permalink in QUB's catalogue (Primo VE full display). @param {string} mmsId */
export function qubRecordUrl(mmsId) {
  const u = new URL('/discovery/fulldisplay', QUB_PRIMO.origin);
  u.searchParams.set('docid', `alma${mmsId}`);
  u.searchParams.set('context', 'L');
  u.searchParams.set('vid', QUB_PRIMO.vid);
  u.searchParams.set('lang', 'en');
  return u.toString();
}

/** @param {string | null} v */
const year = (v) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 && n < 3000 ? n : null;
};

/**
 * Read a request's search parameters, clamped to what the endpoints allow.
 * @param {URLSearchParams} params
 * @returns {QubParams}
 */
export function readParams(params) {
  const g = (/** @type {string} */ k) => (params.get(k) || '').trim();
  const scopeRaw = g('scope');
  /** @type {QubScope} */
  const scope = scopeRaw === 'all' || scopeRaw === 'out' ? scopeRaw : 'in';
  const tags = [...new Set(g('tag').toUpperCase().split(/[\s,]+/).filter((t) => Object.hasOwn(QUB_TAGS, t)))].sort();
  const sortRaw = g('sort');
  /** @type {QubSort} */
  const sort = sortRaw === 'year' || sortRaw === 'title' ? sortRaw : 'relevance';
  const limit = Math.min(Math.max(parseInt(g('limit'), 10) || LIMITS.page, 1), LIMITS.maxPage);
  const offset = Math.max(parseInt(g('offset'), 10) || 0, 0);
  return { q: g('q').slice(0, 300), scope, tags, from: year(g('from')), to: year(g('to')), sort,
    dir: g('dir').toLowerCase() === 'desc' ? 'DESC' : 'ASC', limit, offset };
}

/** @type {Readonly<Record<string, string>>} */
const FIELD_COL = { title: 'title', author: 'author', subject: 'subjects', subjects: 'subjects', notes: 'notes' };
const cleanTerm = (/** @type {string} */ t) => t.replace(/["*^():{}]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The FTS5 MATCH text for the free text and the scope and tag filters, or null when there is
 * nothing to match (scope 'all', no tags, no text).
 * @param {Pick<QubParams, 'q' | 'scope' | 'tags'>} p
 * @returns {string | null}
 */
export function buildMatch({ q, scope, tags }) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const negatives = [];
  const re = /(-)?([a-zA-Z]+):"([^"]+)"|(-)?([a-zA-Z]+):(\S+)|(-)?"([^"]+)"|(-)?(\S+)/g;
  let m;
  let lastBare = false;
  while ((m = re.exec(q || '')) !== null) {
    let neg = false; let col = null; let val = '';
    if (m[2]) { neg = !!m[1]; col = FIELD_COL[m[2].toLowerCase()] ?? null; val = col ? m[3] ?? '' : `${m[2]} ${m[3]}`; }
    else if (m[5]) { neg = !!m[4]; col = FIELD_COL[m[5].toLowerCase()] ?? null; val = col ? m[6] ?? '' : `${m[5]} ${m[6]}`; }
    else if (m[8]) { neg = !!m[7]; val = m[8]; }
    else if (m[10]) { neg = !!m[9]; val = m[10]; }
    const term = cleanTerm(val);
    if (!term) continue;
    lastBare = !neg && !col && Boolean(m[10]) && term.length >= 2 && !term.includes(' ');
    const phrase = `"${term.replace(/"/g, '')}"`;
    const expr = col ? `${col}:${phrase}` : `{title author subjects notes}:${phrase}`;
    (neg ? negatives : parts).push(expr);
  }
  // a trailing bare word of two or more letters matches as a prefix, as the PRONI app's does
  if (lastBare && parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]}*`;
  if (scope !== 'all') parts.push(`facets:scope${scope}`);
  for (const t of tags) parts.push(`facets:tag${t.toLowerCase()}`);
  if (!parts.length) return null;
  return [parts.join(' AND '), ...negatives.map((n) => `NOT ${n}`)].join(' ');
}

/**
 * The base-table filters: the publication year range.
 * @param {Pick<QubParams, 'from' | 'to'>} p
 * @returns {{ where: string[], binds: number[] }}
 */
export function buildFilters({ from, to }) {
  /** @type {string[]} */
  const where = [];
  /** @type {number[]} */
  const binds = [];
  if (from !== null) { where.push('q.year >= ?'); binds.push(from); }
  if (to !== null) { where.push('q.year <= ?'); binds.push(to); }
  return { where, binds };
}

/**
 * The sort key for a sort; records with no year sort last either way.
 * @param {QubSort} sort @param {'ASC' | 'DESC'} [dir]
 */
export const sortKey = (sort, dir = 'ASC') => (sort === 'year' ? `coalesce(q.year, ${dir === 'DESC' ? -1 : 9999})`
  : sort === 'title' ? 'q.title' : 'bm25(qub_fts, 10.0, 4.0, 3.0, 1.0, 0.0)');

/** The tag letters of a stored tag string ('ABG' -> ['A','B','G']). @param {unknown} tags */
export const tagList = (tags) => String(tags || '').split('').filter((t) => Object.hasOwn(QUB_TAGS, t));

/** One CSV cell. @param {unknown} v */
export const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** One CSV row. @param {unknown[]} cells */
export const csvRow = (cells) => cells.map(csvCell).join(',') + '\r\n';
