/**
 * Shared query handler for the browse indexes held in D1.
 *
 * Three indexes moved out of static shards for the same reason, so they get one
 * implementation rather than three near-identical ones. The leading underscore keeps this
 * file out of the route table; only the thin endpoints beside it are routed.
 *
 *   /_api/persons             browse_persons             11,960
 *   /_api/register-interests  browse_register_interests   5,064
 *   /_api/sources             browse_sources             40,327
 *
 * WHY THEY MOVED. All three were sharded because a single file breached Cloudflare Pages'
 * 25 MB per-file limit -- a scaling response that kept them deployable without changing
 * what they are: blobs you scan. browse.js resolves a deep link with
 * findItem(data.items, id), so opening ONE source at #/sources/<slug> required all 51 MB
 * first. For persons the same shape failed outright on 2026-08-23: the reader still
 * expected `payload.items` after the index became a manifest, silently resolved to [],
 * and every person link on the site stopped working with no error.
 *
 * A scanned blob cannot tell a miss from an empty index. These endpoints can: a lookup
 * that finds nothing returns 404, and that distinction is the point.
 */
import { reportError } from './_error.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const json = (body, status = 200, cacheable = true, version = '') => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheable && status === 200
      ? 'public, max-age=3600, s-maxage=86400'
      : 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Browse-Index-Version': version,
  },
});

const parse = (row) => {
  if (!row) return null;
  try { return JSON.parse(row.record); } catch { return null; }
};

const clampLimit = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
};

/**
 * @param {object} options
 * @param {string} options.table   physical table name
 * @param {string} options.key     response key for the collection, e.g. "persons"
 * @param {string} options.version cache version; bump on RESPONSE SHAPE changes, not data
 * @param {Record<string,string>} [options.filters] query param -> column, for exact match
 */
export function browseIndexHandler({ table, key, version, filters = {} }) {
  return async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const slug = url.searchParams.get('slug');
    const query = (url.searchParams.get('q') || '').trim();
    const limit = clampLimit(url.searchParams.get('limit'));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const db = context.env.ELECTIONS_DB;
    if (!db) return json({ error: 'ELECTIONS_DB binding not configured' }, 503, false, version);

    try {
      // One record. The operation the shards were worst at, and the one worth being
      // exact about: a miss is 404, not an empty list, so a caller can tell "no such
      // record" from "the index failed to load".
      //
      // Three ways, because the client's key is not always the stored slug: app.js
      // strips a "name:" prefix when deriving an entity key, so it asks for
      // "simon-harris" while the row is "name-simon-harris". Matching slug alone would
      // 404 every person and send the client back to scanning shards -- working
      // visibly while doing the exact thing this endpoint exists to stop.
      if (slug) {
        const row = await db
          .prepare(`SELECT record FROM ${table} WHERE key_norm = ?1 OR slug = ?1 OR id = ?1 LIMIT 1`)
          .bind(slug)
          .first();
        const record = parse(row);
        if (!record) return json({ error: 'not found', slug }, 404, false, version);
        return json({ [key.replace(/s$/, '')]: record, record }, 200, true, version);
      }

      // Exact-match filters, declared per entity. Repeated params are ORed, because a
      // party or a body is known by several names across a century and accepting one
      // would silently undercount.
      const where = [];
      const binds = [];
      /** Append a bind and return its 1-based placeholder, so the two cannot drift. */
      const bind = (value) => `?${binds.push(value)}`;

      for (const [param, column] of Object.entries(filters)) {
        const values = url.searchParams.getAll(param).map((v) => v.trim()).filter(Boolean);
        if (!values.length) continue;
        where.push(`${column} IN (${values.map(bind).join(', ')})`);
      }

      if (query) where.push(`title_norm LIKE ${bind(`%${query.toLowerCase()}%`)}`);

      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      // The COUNT runs with the filter binds only; the page adds limit/offset after them,
      // so the two statements deliberately do not share a bind list.
      const pageBinds = [...binds, limit, offset];
      const [rows, total] = await Promise.all([
        db.prepare(`SELECT record FROM ${table} ${clause} ORDER BY ord LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`)
          .bind(...pageBinds).all(),
        db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${clause}`).bind(...binds).first(),
      ]);
      const records = (rows.results || []).map(parse).filter(Boolean);
      return json({ [key]: records, total: total?.n ?? records.length, limit, offset }, 200, true, version);
    } catch (error) {
      return json({ error: `${key} query failed`, ...reportError(context.env, key, error) }, 500, false, version);
    }
  };
}
