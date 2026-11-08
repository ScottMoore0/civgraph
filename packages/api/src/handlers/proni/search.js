/**
 * PRONI catalogue search over Cloudflare D1 (SQLite + FTS5). Powers both the
 * Browse tab search box and the "Civgraph PRONI Search" app.
 *
 * GET /_api/proni/search
 *   q       free text with operators: "phrase", -exclude, +require,
 *           title: ref: date: description: text:  (field-scoped)
 *   title,description,ref,text,dates   per-field boxes (advanced search)
 *   from,to    year range (inclusive), matched against parsed start/end year
 *   letter     A-Z: reference begins with this letter
 *   sort       relevance|ref|title|date|level   dir=asc|desc
 *   limit,offset   infinite scroll
 *
 * FTS index covers ref,title,dates,description. Base table has parsed
 * start_year/end_year for date filtering.
 */
import { buildMatch, buildFilters } from './_query.js';
import { reportError } from '../_error.js';
import { binding } from '../../../../config/src/config.js';
import { fromD1 } from '../../../../storage/src/d1.js';
import { PRONI } from '../../queries/proni.js';

const CACHE_VERSION = 'v10';
const MAX_LIMIT = 60;
const DEFAULT_LIMIT = 25;
const DESC_PREVIEW = 160; // trimmed list preview — full text is fetched on the record page

/** @typedef {import('../../../../types/index.js').ApiV1.ProniSearchResultsAnswer} ProniSearchResultsAnswer */
/**
 * A row of the search list (queries/proni.js searchCols).
 * @typedef {object} ProniSearchRow
 * @property {string} ref
 * @property {string} slug
 * @property {string | null} title
 * @property {string | null} level
 * @property {string | null} dates
 * @property {string | null} access
 * @property {string | null} digitalRecord
 * @property {string | null} parent
 * @property {string | null} parentSlug
 * @property {number | null} hasChildren
 * @property {string | null} fond
 * @property {number | null} startYear
 * @property {number | null} endYear
 * @property {string | null} descPreview
 * @property {number | null} descLen
 */

/** @type {Readonly<Record<string, string>>} */
const ORDER = {
  relevance: 'bm25(proni_fts)',
  ref: 'p.ref',
  title: 'p.title',
  date: 'ext.ext_start_year',
  level: 'p.level',
};


/**
 * @param {ProniSearchRow} r
 * @param {boolean} exact
 * @returns {ProniSearchResultsAnswer['results'][number]}
 */
function mapRow(r, exact) {
  const desc = r.descPreview || '';
  const truncated = (r.descLen || 0) > DESC_PREVIEW;
  return {
    ref: r.ref, slug: r.slug, title: r.title || r.ref, level: r.level || '',
    dates: r.dates || '', access: r.access || '', digitalRecord: r.digitalRecord || '',
    parent: r.parent || '', parentSlug: r.parentSlug || '', hasChildren: !!r.hasChildren,
    fond: r.fond || '', startYear: r.startYear ?? null, endYear: r.endYear ?? null,
    description: truncated ? desc.slice(0, DESC_PREVIEW) : desc,
    descTruncated: truncated,
    exact: !!exact,
    url: `/browse/#/proni/${encodeURIComponent(r.slug)}`,
  };
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'Access-Control-Allow-Origin': '*' };

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  const cache = caches.default;
  const keyUrl = new URL(context.request.url);
  keyUrl.searchParams.set('_cv', CACHE_VERSION);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Second tier: Workers KV is replicated to every edge, so a query answered
  // anywhere is fast everywhere (the per-PoP cache above only helps locally).
  // Feature-detected — no-op until a PRONI_KV binding is added.
  const kv = binding(context.env, 'PRONI_KV');
  const kvKey = `search:${CACHE_VERSION}:${keyUrl.search}`;
  if (kv) {
    const cached = await kv.get(kvKey);
    if (cached) {
      const resp = new Response(cached, { headers: JSON_HEADERS });
      context.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }
  }

  const resp = await handle(context);
  if (resp.status === 200) {
    context.waitUntil(cache.put(cacheKey, resp.clone()));
    if (kv) context.waitUntil(resp.clone().text().then((b) => kv.put(kvKey, b, { expirationTtl: 86400 })));
  }
  return resp;
}

/** @param {import('../../types.js').ApiContext} context */
async function handle(context) {
  const url = new URL(context.request.url);
  const g = (/** @type {string} */ k) => (url.searchParams.get(k) || '').trim();
  const q = g('q');
  const fields = { title: g('title'), description: g('description'), ref: g('ref'), text: g('text'), dates: g('dates') };
  const from = parseInt(g('from'), 10); const to = parseInt(g('to'), 10);
  const letter = g('letter').slice(0, 1).toUpperCase();
  const sort = g('sort') || 'relevance';
  const dir = g('dir').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(g('limit'), 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(parseInt(g('offset'), 10) || 0, 0);

  const json = (/** @type {unknown} */ b, s = 200) => new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'Access-Control-Allow-Origin': '*' },
  });

  const bound = binding(context.env, 'PRONI_DB');
  if (!bound) return json({ results: [], error: 'PRONI_DB binding not configured' }, 503);

  const top = g('top') === '1'; // letter-browse: top-level records only, alphabetical
  const level = g('level'); const access = g('access');
  const match = buildMatch(q, fields);
  const hasFilters = letter || top || level || access || Number.isFinite(from) || Number.isFinite(to);
  if (!match && !hasFilters) return json({ query: q, results: [], count: 0 });

  // WHERE fragments shared by both modes
  const { where, binds } = buildFilters({ letter, from, to, top, level, access });

  // Serve reads from a nearby D1 replica when replication is enabled (falls back
  // to the primary otherwise; harmless where withSession is unavailable).
  // Through the storage adapter (packages/storage/); the SQL is named in queries/proni.js.
  /** @type {import('../../../../storage/src/store.js').RecordStore} */
  const rdb = fromD1(bound, { session: 'first-unconstrained' });

  try {
    /** @type {ReturnType<typeof mapRow>[]} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();

    // exact-ref fast path (page 1 only, no explicit sort)
    if (!offset && q && !/\s/.test(q) && !q.includes(':') && sort === 'relevance') {
      const ex = /** @type {ProniSearchRow[]} */ (await rdb.all(PRONI.exactRef(DESC_PREVIEW), [q.toUpperCase()]));
      for (const r of ex) { out.push(mapRow(r, true)); seen.add(r.ref); }
    }

    let sql, bindArr;
    if (match) {
      // Ties broken by ref, so a page boundary never repeats or skips a record (data design 4.3, query 9).
      const order = top ? 'p.ref ASC' : (sort === 'relevance' ? 'bm25(proni_fts), p.ref' : `${ORDER[sort] || 'p.ref'} ${dir}, p.ref`);
      sql = PRONI.searchMatched(DESC_PREVIEW, where, order, sort === 'relevance');
      bindArr = [match, ...binds, limit, offset];
    } else {
      const order = top ? 'p.ref ASC' : `${ORDER[sort] && sort !== 'relevance' ? ORDER[sort] : 'p.ref'} ${dir}, p.ref`;
      sql = PRONI.searchFiltered(DESC_PREVIEW, where, order);
      bindArr = [...binds, limit, offset];
    }
    const results = /** @type {ProniSearchRow[]} */ (await rdb.all(sql, bindArr));
    for (const r of results) { if (!seen.has(r.ref)) out.push(mapRow(r, false)); }

    return json({ query: q, match, sort, dir, letter, from: from || null, to: to || null, offset, limit, count: out.length, results: out.slice(0, limit + 1) });
  } catch (error) {
    return json({ query: q, results: [], error: 'Search failed', ...reportError(context.env, 'proni-search', error) }, 500);
  }
}
