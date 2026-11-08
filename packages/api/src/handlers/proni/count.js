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
import { fromD1 } from '../../../../storage/src/d1.js';
import { PRONI } from '../../queries/proni.js';

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
  if (resp.status === 200) context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

/** @param {import('../../types.js').ApiContext} context */
async function handle(context) {
  const url = new URL(context.request.url);
  const g = (/** @type {string} */ k) => (url.searchParams.get(k) || '').trim();
  const q = g('q');
  const fields = { title: g('title'), description: g('description'), ref: g('ref'), text: g('text'), dates: g('dates') };
  const from = parseInt(g('from'), 10); const to = parseInt(g('to'), 10);

  const json = (/** @type {unknown} */ b, s = 200) => new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'Access-Control-Allow-Origin': '*' },
  });

  const bound = binding(context.env, 'PRONI_DB');
  if (!bound) return json({ count: null, error: 'PRONI_DB binding not configured' }, 503);
  // through the storage adapter (packages/storage/); the SQL is named in queries/proni.js
  /** @type {import('../../../../storage/src/store.js').RecordStore} */
  const db = fromD1(bound);

  const breakdown = g('breakdown') === '1'; // letter-browse: counts grouped by level
  const match = buildMatch(q, fields);
  // buildFilters no longer returns joinExt (_query.js says why), so jx is always '' here; the
  // cast keeps this line as it runs. LANDING.md (nia-s2a) notes what that means for from/to.
  const { where, binds, joinExt } = /** @type {ReturnType<typeof buildFilters> & { joinExt?: boolean }} */ (buildFilters({ letter: g('letter'), from, to, top: g('top') === '1', level: g('level'), access: g('access') }));
  const jx = joinExt ? ' LEFT JOIN ext ON ext.ref = p.ref' : ''; // only when a year range is filtered
  if (!match && !where.length) return json({ count: 0, exact: true, levels: [] });

  try {
    if (breakdown) {
      const rows = /** @type {Array<{ level: string | null, n: number }>} */ (await db.all(PRONI.levelCounts(Boolean(match), jx, where), match ? [match, ...binds] : binds));
      const levels = rows.map((r) => ({ level: r.level || '', n: r.n })).filter((l) => l.n > 0);
      const total = levels.reduce((s, l) => s + l.n, 0);
      return json({ count: total, levels, exact: true });
    }

    const results = /** @type {Array<{ n: number | null }>} */ (await db.all(PRONI.count(Boolean(match), jx, where), match ? [match, ...binds] : binds));
    const n = (results && results[0] && results[0].n) != null ? results[0].n : null;
    return json({ count: n, exact: n != null });
  } catch (error) {
    // broad query hit a limit — let the app fall back to its loaded-so-far count
    return json({ count: null, exact: false, error: String(error && /** @type {Error} */ (error).message || error) });
  }
}
