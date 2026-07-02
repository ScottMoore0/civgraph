/**
 * PRONI catalogue search — full-text search over the ~1.5M-record PRONI
 * eCatalogue snapshot, backed by a Cloudflare D1 (SQLite + FTS5) database.
 *
 * Usage: GET /_api/proni/search?q=antrim%20minute&limit=25
 *
 * Requires a D1 binding named PRONI_DB (see the deploy runbook). The database
 * has a single FTS5 table `proni` (searchable: ref, title, dates; unindexed
 * metadata for display + linking into the browse hierarchy).
 */

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

// Turn free text into an FTS5 MATCH expression. FTS5 ANDs bare terms, so every
// typed word must appear; the final word is a prefix match for search-as-you-type.
// Non-alphanumeric characters (including the '/' in references) are treated as
// token separators, so "BG/1" becomes the terms bg AND 1.
function buildMatch(query) {
  const tokens = (query.toLowerCase().match(/[a-z0-9]+/g) || []).slice(0, 12);
  if (!tokens.length) return null;
  return tokens
    .map((t, i) => (i === tokens.length - 1 && t.length >= 2 ? `${t}*` : t))
    .join(' ');
}

// Bump when the D1 data changes (re-import) to invalidate the edge cache.
const CACHE_VERSION = 'v1';

// Search results over the static snapshot are deterministic, so edge-cache them
// (keyed by URL + version). Warm queries never touch D1.
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
  const query = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, MAX_LIMIT);

  const json = (body, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
        ...extraHeaders,
      },
    });

  if (query.length < 2) return json({ query, results: [] });

  const match = buildMatch(query);
  if (!match) return json({ query, results: [] });

  const db = context.env.PRONI_DB;
  if (!db) return json({ query, results: [], error: 'PRONI_DB binding not configured' }, 503);

  const mapRow = (r, exact) => ({
    ref: r.ref,
    slug: r.slug,
    title: r.title || r.ref,
    level: r.level || '',
    dates: r.dates || '',
    parent: r.parent || '',
    parentSlug: r.parentSlug || '',
    hasChildren: !!r.hasChildren,
    fond: r.fond || '',
    exact: !!exact,
    url: `/browse/#/proni/${encodeURIComponent(r.slug)}`,
  });

  try {
    const out = [];
    const seen = new Set();

    // Exact-reference fast path: a whitespace-free query is tried as a literal
    // reference via the unique index, so "BG/1" or "D1071" resolves to that
    // exact node even when full-text ranking would surface descendants first.
    if (!/\s/.test(query)) {
      const exact = await db.prepare(
        `SELECT ref, slug, title, level, dates, parent, parent_slug AS parentSlug,
                has_children AS hasChildren, fond
           FROM proni WHERE ref = ?1 LIMIT 1`
      ).bind(query.toUpperCase()).all();
      for (const r of exact.results || []) { out.push(mapRow(r, true)); seen.add(r.ref); }
    }

    // Full-text search (bm25-ranked) over the FTS index.
    const fts = await db.prepare(
      `SELECT p.ref, p.slug, p.title, p.level, p.dates, p.parent,
              p.parent_slug AS parentSlug, p.has_children AS hasChildren, p.fond,
              bm25(proni_fts) AS rank
         FROM proni_fts JOIN proni p ON p.rowid = proni_fts.rowid
        WHERE proni_fts MATCH ?1
        ORDER BY rank
        LIMIT ?2`
    ).bind(match, limit).all();
    for (const r of fts.results || []) { if (!seen.has(r.ref)) out.push(mapRow(r, false)); }

    const results = out.slice(0, limit);
    return json({ query, match, count: results.length, results });
  } catch (error) {
    return json({ query, results: [], error: String(error && error.message || error) }, 500);
  }
}
