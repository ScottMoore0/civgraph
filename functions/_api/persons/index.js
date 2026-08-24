/**
 * Browse persons served from D1 (binding ELECTIONS_DB), mirroring the elections endpoint.
 *
 *   GET /_api/persons?slug=<slug>        -> { person }            one person, whole record
 *   GET /_api/persons?q=<text>&limit=N   -> { persons, count }    name search
 *   GET /_api/persons?party=A&party=B     -> { persons, count }    everyone who stood for it
 *                                                                  (repeat for party aliases)
 *   GET /_api/persons?limit=N&offset=M   -> { persons, total }    paged index for Browse
 *
 * WHY THIS EXISTS
 *
 * The persons index shipped as three static shards totalling 24 MB, because a single
 * persons.json had reached 25.18 MB and breached Cloudflare Pages' 25 MB per-file limit.
 * Sharding kept it deployable without changing what it is: a blob you scan.
 *
 * Resolving ONE person therefore meant fetching shards until a match. On 2026-08-23 that
 * failed completely -- the index had become a manifest with no `items` array while
 * app/src/app.js still read `payload.items`, so it resolved to [], every person link in
 * the election panes silently did nothing, and no test or validator caught it. A point
 * lookup against a scanned blob has no good failure mode: it cannot report a miss,
 * because it cannot tell a miss from an empty index.
 *
 * A query can. `?slug=` returns kilobytes and 404s honestly when the person is absent.
 *
 * WHY THE ELECTIONS DATABASE. These are election people. The index is a derived
 * aggregate over candidatures, and this database already holds `candidates` with a
 * `person_id` column and a `cand_person` index.
 *
 * The static shards still exist and still feed the semantic graph build. This endpoint
 * does not remove them; it removes the need for the CLIENT to read them.
 */
import { reportError } from '../_error.js';

// Bump when the RESPONSE SHAPE changes, not just when the data does. It is part of the
// edge cache key and responses carry s-maxage, so a shape change without a bump keeps
// serving the old shape to clean URLs while cache-busted ones show the new one.
const CACHE_VERSION = 'persons-1';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const json = (body, status = 200, cacheable = true) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheable && status === 200
      ? 'public, max-age=3600, s-maxage=86400'
      : 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Persons-Cache-Version': CACHE_VERSION,
  },
});

/** The stored record is the whole original document; hand it back as an object. */
const parse = (row) => {
  if (!row) return null;
  try { return JSON.parse(row.record); } catch { return null; }
};

const clampLimit = (raw, fallback = DEFAULT_LIMIT) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), MAX_LIMIT);
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const slug = url.searchParams.get('slug');
  const query = (url.searchParams.get('q') || '').trim();
  // getAll: a party is sent as several aliases (see the party branch below).
  const parties = url.searchParams.getAll('party').map((v) => v.trim()).filter(Boolean);
  const limit = clampLimit(url.searchParams.get('limit'));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const db = context.env.ELECTIONS_DB;
  if (!db) return json({ error: 'ELECTIONS_DB binding not configured' }, 503, false);

  try {
    // One person. The operation that was broken, and the one worth being exact about:
    // a miss is a 404, not an empty list, so the caller can tell "no such person" from
    // "the index failed to load".
    if (slug) {
      const row = await db.prepare('SELECT record FROM browse_persons WHERE slug = ?1').bind(slug).first();
      const person = parse(row);
      if (!person) return json({ error: 'person not found', slug }, 404, false);
      return json({ person });
    }

    // Name search. name_norm is stored lower-cased because SQLite's LIKE folds case for
    // ASCII only, and these names carry fadas -- "Dáil" and "dáil" would not match.
    if (query) {
      const { results } = await db
        .prepare(`SELECT record FROM browse_persons
                  WHERE name_norm LIKE ?1
                  ORDER BY CASE WHEN name_norm LIKE ?2 THEN 0 ELSE 1 END, ord
                  LIMIT ?3`)
        .bind(`%${query.toLowerCase()}%`, `${query.toLowerCase()}%`, limit)
        .all();
      const persons = (results || []).map(parse).filter(Boolean);
      return json({ persons, count: persons.length, query });
    }

    // Everyone who stood for a party. `parties` is a nested array inside the record, so
    // this walks it with json_each rather than needing a join table. A full scan of
    // ~12,000 rows is acceptable here and avoids a second schema to keep in sync.
    //
    // REPEATED `party` PARAMS ARE THE NORMAL CASE, not an edge case: a party is known by
    // several names across a century -- canonical name, title, observed names, known
    // aliases -- and the client's summary builder matches on all of them. Accepting one
    // name would silently drop candidates who stood under an earlier name of the same
    // party, which is exactly the kind of quiet undercount this data cannot afford.
    if (parties.length) {
      const placeholders = parties.map((_, index) => `?${index + 1}`).join(', ');
      const { results } = await db
        .prepare(`SELECT record FROM browse_persons
                  WHERE EXISTS (
                    SELECT 1 FROM json_each(browse_persons.record, '$.parties')
                    WHERE json_extract(value, '$.name') IN (${placeholders})
                  )
                  ORDER BY ord
                  LIMIT ?${parties.length + 1}`)
        .bind(...parties, limit)
        .all();
      const persons = (results || []).map(parse).filter(Boolean);
      return json({ persons, count: persons.length, parties });
    }

    // Paged index for Browse. `ord` preserves the order of the source index; ORDER BY
    // slug would silently reshuffle the whole list.
    const [rows, total] = await Promise.all([
      db.prepare('SELECT record FROM browse_persons ORDER BY ord LIMIT ?1 OFFSET ?2').bind(limit, offset).all(),
      db.prepare('SELECT COUNT(*) AS n FROM browse_persons').first(),
    ]);
    const persons = (rows.results || []).map(parse).filter(Boolean);
    return json({ persons, total: total?.n ?? persons.length, limit, offset });
  } catch (error) {
    return json({ error: 'Persons query failed', ...reportError(context.env, 'persons', error) }, 500, false);
  }
}
