/**
 * Browse persons served from D1 (binding ELECTIONS_DB).
 *
 *   GET /_api/persons?slug=<slug>          -> { person }         one record
 *   GET /_api/persons?q=<text>&limit=N     -> { persons, total } name search
 *   GET /_api/persons?limit=N&offset=M     -> paged index
 *
 * 11,960 records. This is the endpoint that replaced a 24 MB shard scan: on 2026-08-23
 * the client still expected `payload.items` after the index became a manifest, silently
 * resolved to [], and every person link on the site stopped working with no error.
 *
 * NOTE: party filtering is NOT a column here. A person's parties live in a nested array
 * inside the record, and the client matches them against a party's aliases; that query
 * stays in the party branch below rather than being flattened into a column, because the
 * alias set is the party's property, not the person's.
 */
import { browseIndexHandler } from '../_browse-index.js';
import { reportError } from '../_error.js';

const base = browseIndexHandler({
  table: 'browse_persons',
  key: 'persons',
  version: 'persons-3',
});

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const parties = url.searchParams.getAll('party').map((v) => v.trim()).filter(Boolean);
  if (!parties.length) return base(context);

  const db = context.env.ELECTIONS_DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'ELECTIONS_DB binding not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  try {
    // `parties` is a nested array inside the record, so this walks it with json_each
    // rather than needing a join table. A full scan of ~12,000 rows is acceptable and
    // avoids a second schema to keep in sync.
    //
    // REPEATED `party` PARAMS ARE THE NORMAL CASE: a party is known by several names
    // across a century -- canonical name, title, observed names, known aliases -- and the
    // client matches on all of them. Accepting one name would silently drop candidates
    // who stood under an earlier name of the same party.
    const placeholders = parties.map((_, i) => `?${i + 1}`).join(', ');
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
    const persons = (results || []).map((row) => {
      try { return JSON.parse(row.record); } catch { return null; }
    }).filter(Boolean);
    return new Response(JSON.stringify({ persons, count: persons.length, parties }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'persons query failed', ...reportError(context.env, 'persons', error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
