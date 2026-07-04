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

const CACHE_VERSION = 'v4';

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

async function handle(context) {
  const url = new URL(context.request.url);
  const g = (k) => (url.searchParams.get(k) || '').trim();
  const q = g('q');
  const fields = { title: g('title'), description: g('description'), ref: g('ref'), text: g('text'), dates: g('dates') };
  const from = parseInt(g('from'), 10); const to = parseInt(g('to'), 10);

  const json = (b, s = 200) => new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'Access-Control-Allow-Origin': '*' },
  });

  const db = context.env.PRONI_DB;
  if (!db) return json({ count: null, error: 'PRONI_DB binding not configured' }, 503);

  const breakdown = g('breakdown') === '1'; // letter-browse: counts grouped by level
  const match = buildMatch(q, fields);
  const { where, binds, joinExt } = buildFilters({ letter: g('letter'), from, to, top: g('top') === '1', level: g('level'), access: g('access') });
  const jx = joinExt ? ' LEFT JOIN ext ON ext.ref = p.ref' : ''; // only when a year range is filtered
  if (!match && !where.length) return json({ count: 0, exact: true, levels: [] });

  try {
    if (breakdown) {
      let bsql, barr;
      if (match) {
        const w = where.length ? ' AND ' + where.join(' AND ') : '';
        bsql = `SELECT p.level AS level, COUNT(*) AS n FROM proni_fts f JOIN proni p ON p.rowid = f.rowid${jx} WHERE proni_fts MATCH ?${w} GROUP BY p.level`;
        barr = [match, ...binds];
      } else {
        bsql = `SELECT p.level AS level, COUNT(*) AS n FROM proni p${jx} WHERE ${where.join(' AND ')} GROUP BY p.level`;
        barr = binds;
      }
      const rows = await db.prepare(bsql).bind(...barr).all();
      const levels = (rows.results || []).map((r) => ({ level: r.level || '', n: r.n })).filter((l) => l.n > 0);
      const total = levels.reduce((s, l) => s + l.n, 0);
      return json({ count: total, levels, exact: true });
    }

    let sql, bindArr;
    if (match) {
      const w = where.length ? ' AND ' + where.join(' AND ') : '';
      sql = `SELECT COUNT(*) AS n FROM proni_fts f JOIN proni p ON p.rowid = f.rowid${jx} WHERE proni_fts MATCH ?${w}`;
      bindArr = [match, ...binds];
    } else {
      sql = `SELECT COUNT(*) AS n FROM proni p${jx} WHERE ${where.join(' AND ')}`;
      bindArr = binds;
    }
    const { results } = await db.prepare(sql).bind(...bindArr).all();
    const n = (results && results[0] && results[0].n) != null ? results[0].n : null;
    return json({ count: n, exact: n != null });
  } catch (error) {
    // broad query hit a limit — let the app fall back to its loaded-so-far count
    return json({ count: null, exact: false, error: String(error && error.message || error) });
  }
}
