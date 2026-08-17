/**
 * Serve the map catalogue from D1.
 *
 * WHY
 *
 * data/database/maps.json is a 1.4 MB static file that the browser fetches whole
 * on every page load, alongside a 4.15 MB render index. Nothing about the
 * catalogue needs to be a file: it is read-mostly structured data that the
 * application queries by id, slug and category, and shipping all 1,031 records
 * to draw one layer is the largest avoidable cost on the startup path.
 *
 * THE SHAPE IS DELIBERATE. With no query parameters this returns exactly the
 * document dataService already expects — { categories, timeSeriesChains,
 * classes, c1s, maps } — reassembled from the `maps` table and `catalogue_parts`.
 * That makes the client cutover a one-line change to the fetch URL rather than
 * an async refactor of the 68 synchronous call sites that read the catalogue
 * out of memory (getMapById alone has 51). Those call sites are the real reason
 * this could not simply be swapped, and keeping the document shape intact means
 * they never have to change at once.
 *
 * The parameterised forms are the point of the migration rather than a bonus:
 * ?id=, ?slug=, ?category= and ?visible=1 let later work fetch a slice instead
 * of the whole catalogue, which is what actually removes the startup cost.
 *
 * Each record is stored whole as JSON in `record`, with queried fields lifted
 * into columns beside it, so the reassembled document is byte-faithful to the
 * source. scripts/validate-catalogue-d1-parity.mjs asserts that.
 */
import { reportError } from '../_error.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Same policy as the static file it replaces: revalidate, do not pin.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ...(init.headers || {}),
    },
  });

export async function onRequestGet(context) {
  const db = context.env.CATALOGUE_DB;
  if (!db) {
    return json(
      { ok: false, error: 'CATALOGUE_DB binding not configured' },
      { status: 503 },
    );
  }

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  const slug = url.searchParams.get('slug');
  const category = url.searchParams.get('category');
  const visibleOnly = url.searchParams.get('visible') === '1';

  try {
    // --- single record -------------------------------------------------------
    if (id || slug) {
      const stmt = id
        ? db.prepare('SELECT record FROM maps WHERE id = ?1').bind(id)
        : db.prepare('SELECT record FROM maps WHERE slug = ?1').bind(slug);
      const row = await stmt.first();
      if (!row) return json({ ok: false, error: 'Not found' }, { status: 404 });
      return json(JSON.parse(row.record));
    }

    // --- a slice -------------------------------------------------------------
    if (category) {
      const sql = visibleOnly
        ? 'SELECT record FROM maps WHERE category = ?1 AND hidden = 0 ORDER BY ord'
        : 'SELECT record FROM maps WHERE category = ?1 ORDER BY ord';
      const { results } = await db.prepare(sql).bind(category).all();
      return json({ maps: (results || []).map((r) => JSON.parse(r.record)) });
    }

    // --- the whole document, in the shape dataService expects ---------------
    // ORDER BY ord, not by id: the catalogue's array order is meaningful and
    // sorting by id would silently reshuffle every list built from it.
    const sql = visibleOnly
      ? 'SELECT record FROM maps WHERE hidden = 0 ORDER BY ord'
      : 'SELECT record FROM maps ORDER BY ord';
    const [mapRows, partRows] = await Promise.all([
      db.prepare(sql).all(),
      db.prepare('SELECT key, value FROM catalogue_parts').all(),
    ]);

    const doc = {};
    for (const row of partRows.results || []) doc[row.key] = JSON.parse(row.value);
    doc.maps = (mapRows.results || []).map((r) => JSON.parse(r.record));

    return json(doc);
  } catch (error) {
    const reported = reportError(context.env, 'catalogue', error);
    return json({ ok: false, error: 'Catalogue query failed', ...reported }, { status: 500 });
  }
}
