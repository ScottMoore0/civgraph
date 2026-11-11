/**
 * Exact total count of records matching a PRONI search — same query grammar and
 * filters as /_api/proni/search. The app fetches this in parallel with the first
 * page, so results never wait on it; the count updates a moment later.
 *
 * Uncapped: it returns the true total for every query it can. A pathological
 * near-match-all query could exceed D1's limits, in which case it returns
 * { count: null } and the app keeps its "N+ loaded" fallback for that query.
 * Edge-cached, so each distinct query is counted at most once.
 */
import { buildMatch, buildFilters } from './_query.js';
import { binding } from '../../../../config/src/config.js';
import { PRONI } from '../../queries/proni.js';
import { CATALOGUE_IS_CLOSED, proniReader } from './_read.js';

const CACHE_VERSION = 'v4';

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  const cache = caches.default;
  const keyUrl = new URL(context.request.url);
  keyUrl.searchParams.set('_cv', CACHE_VERSION);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const resp = await handle(context);
  // A count that failed answers { count: null } with 200 so the app keeps its fallback; it is
  // not cached, so the next asker gets a real count rather than a day of nulls.
  if (resp.status === 200 && resp.headers.get('X-Proni-Count') !== 'failed') context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

/**
 * The count statement for a query: the plain join, or (CATALOGUE_IS_CLOSED) the index alone when
 * there are no filters and ext alone when the only filters are years.
 * @param {string | null} match
 * @param {{ where: string[], binds: unknown[] }} filters
 * @param {boolean} yearRange
 * @param {boolean} [closed]
 * @returns {{ sql: string, params: unknown[] }}
 */
export function countStatement(match, { where, binds }, yearRange, closed = CATALOGUE_IS_CLOSED) {
  if (closed && match && !where.length) return { sql: PRONI.countMatchOnly, params: [match] };
  if (closed && !match && where.length && where.every((w) => w.startsWith('ext.'))) {
    return { sql: PRONI.countYearsOnly(where), params: binds };
  }
  const jx = yearRange ? ' LEFT JOIN ext ON ext.ref = p.ref' : '';
  return { sql: PRONI.count(Boolean(match), jx, where), params: match ? [match, ...binds] : binds };
}

/** @param {import('../../types.js').ApiContext} context */
async function handle(context) {
  const url = new URL(context.request.url);
  const g = (/** @type {string} */ k) => (url.searchParams.get(k) || '').trim();
  const q = g('q');
  const fields = { title: g('title'), description: g('description'), ref: g('ref'), text: g('text'), dates: g('dates') };
  const from = parseInt(g('from'), 10); const to = parseInt(g('to'), 10);

  const json = (/** @type {unknown} */ b, s = 200, failed = false) => new Response(JSON.stringify(b), {
    status: s,
    headers: {
      'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
      'Cache-Control': failed ? 'no-store' : 'public, max-age=3600, s-maxage=86400',
      ...(failed ? { 'X-Proni-Count': 'failed' } : {}),
    },
  });

  const bound = binding(context.env, 'PRONI_DB');
  if (!bound) return json({ count: null, error: 'PRONI_DB binding not configured' }, 503);
  // Through the storage adapter (packages/storage/); the SQL is named in queries/proni.js. Reads
  // go to a nearby replica, with one retry on the primary, as search.js does.
  const db = proniReader(bound);

  const breakdown = g('breakdown') === '1'; // letter-browse: counts grouped by level
  const match = buildMatch(q, fields);
  const filters = buildFilters({ letter: g('letter'), from, to, top: g('top') === '1', level: g('level'), access: g('access') });
  // buildFilters matches a year range against the Extracted Dates table (ext), so a count with
  // from/to must join it. It used to read a joinExt flag buildFilters no longer returns, so the
  // join was never added and every from/to count failed in SQL ("no such column: ext...").
  const yearRange = Number.isFinite(from) || Number.isFinite(to);
  const jx = yearRange ? ' LEFT JOIN ext ON ext.ref = p.ref' : '';
  const { where, binds } = filters;
  if (!match && !where.length) return json({ count: 0, exact: true, levels: [] });

  try {
    if (breakdown) {
      const rows = /** @type {Array<{ level: string | null, n: number }>} */ (await db.all(PRONI.levelCounts(Boolean(match), jx, where), match ? [match, ...binds] : binds));
      const levels = rows.map((r) => ({ level: r.level || '', n: r.n })).filter((l) => l.n > 0);
      const total = levels.reduce((s, l) => s + l.n, 0);
      return json({ count: total, levels, exact: true });
    }

    const statement = countStatement(match, filters, yearRange);
    const results = /** @type {Array<{ n: number | null }>} */ (await db.all(statement.sql, statement.params));
    const n = (results && results[0] && results[0].n) != null ? results[0].n : null;
    return json({ count: n, exact: n != null });
  } catch (error) {
    // broad query hit a limit — let the app fall back to its loaded-so-far count
    return json({ count: null, exact: false, error: String(error && /** @type {Error} */ (error).message || error) }, 200, true);
  }
}
