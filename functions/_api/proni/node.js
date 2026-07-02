/**
 * PRONI browse node — serves the catalogue hierarchy from D1 (binding PRONI_DB),
 * so the browse UI never depends on static shard files.
 *
 *   GET /_api/proni/node            -> { roots: [...] }   (top-level fonds, for the landing)
 *   GET /_api/proni/node?ref=BG/1   -> { item, ancestors, children }  (one node)
 *
 * A node's children are `WHERE parent = ref`; its breadcrumb ancestors are the
 * cumulative '/'-prefixes of the reference (every one is a real record after the
 * container-title enrichment pass).
 */

function ancestorRefs(ref) {
  const parts = String(ref).split('/');
  const out = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}

const childCols =
  'ref, slug, title, level, dates, has_children AS hasChildren';
const itemCols =
  'ref, slug, title, level, dates, description, access, digital_record AS digitalRecord, has_children AS hasChildren, fond';

function mapChild(r) {
  return {
    ref: r.ref, slug: r.slug, title: r.title || r.ref,
    level: r.level || '', dates: r.dates || '', hasChildren: !!r.hasChildren,
  };
}

// Bump when the underlying D1 data changes (re-import) to invalidate the edge
// cache without a manual purge — it is folded into the cache key.
const CACHE_VERSION = 'v1';

// The PRONI data is a static snapshot, so responses are safe to edge-cache
// aggressively. Serve from Cloudflare's cache when warm; otherwise compute and
// store. Keyed by URL + CACHE_VERSION so a data change is a one-line bust.
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
  const ref = (url.searchParams.get('ref') || '').trim();

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });

  const db = context.env.PRONI_DB;
  if (!db) return json({ error: 'PRONI_DB binding not configured' }, 503);

  try {
    if (!ref) {
      const { results } = await db.prepare(
        `SELECT ${childCols}, fond FROM proni WHERE parent = '' ORDER BY ref`
      ).all();
      return json({ roots: (results || []).map(mapChild), count: (results || []).length });
    }

    const itemRow = await db.prepare(`SELECT ${itemCols} FROM proni WHERE ref = ?1 LIMIT 1`).bind(ref).all();
    const item = (itemRow.results || [])[0];
    if (!item) return json({ error: 'not found', ref }, 404);

    const kids = await db.prepare(
      `SELECT ${childCols} FROM proni WHERE parent = ?1 ORDER BY ref`
    ).bind(ref).all();

    const ancRefs = ancestorRefs(ref);
    let ancestors = [];
    if (ancRefs.length) {
      const placeholders = ancRefs.map((_, i) => `?${i + 1}`).join(',');
      const anc = await db.prepare(
        `SELECT ref, slug, title FROM proni WHERE ref IN (${placeholders})`
      ).bind(...ancRefs).all();
      const byRef = new Map((anc.results || []).map((a) => [a.ref, a]));
      ancestors = ancRefs
        .map((r) => byRef.get(r))
        .filter(Boolean)
        .map((a) => ({ ref: a.ref, slug: a.slug, title: a.title || a.ref }));
    }

    return json({
      item: {
        ref: item.ref, slug: item.slug, title: item.title || item.ref,
        level: item.level || '', dates: item.dates || '',
        description: item.description || '', access: item.access || '',
        digitalRecord: item.digitalRecord || '',
        hasChildren: !!item.hasChildren, fond: item.fond || '',
      },
      ancestors,
      children: (kids.results || []).map(mapChild),
    });
  } catch (error) {
    return json({ error: String(error && error.message || error), ref }, 500);
  }
}
