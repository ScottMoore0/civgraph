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
// proni.* columns are qualified because the item query LEFT JOINs the Extracted
// Dates "Additional Data" table (ext), which also has a `ref` column.
const itemCols =
  'proni.ref, proni.slug, proni.title, proni.level, proni.dates, proni.description, '
  + 'proni.access, proni.digital_record AS digitalRecord, proni.has_children AS hasChildren, proni.fond, '
  + 'ext.ext_display, ext.ext_start_year, ext.ext_end_year, ext.ext_circa, ext.ext_estimated, ext.ext_bound, ext.ext_undated';

function mapChild(r) {
  return {
    ref: r.ref, slug: r.slug, title: r.title || r.ref,
    level: r.level || '', dates: r.dates || '', hasChildren: !!r.hasChildren,
  };
}

// The immediate parent of a reference is its '/'-prefix minus the last segment
// ('' for a top-level fond). Siblings are all records that share that parent.
function parentRef(ref) {
  const anc = ancestorRefs(ref);
  return anc.length ? anc[anc.length - 1] : '';
}

// First / Previous / Next / Last navigation across siblings (same parent),
// in NATURAL numeric order of the last reference segment — so …/2 comes before
// …/10, not after it. The segment is the part of the reference after the parent
// prefix; the sort key is (CAST(segment AS INTEGER), segment) so numeric parts
// sort numerically and any letter suffixes (e.g. 56C) break ties as text.
async function siblingNav(db, ref) {
  const parent = parentRef(ref);
  const seg = "substr(ref, CASE WHEN ?1 = '' THEN 1 ELSE length(?1) + 2 END)";
  const asc = `ORDER BY CAST(${seg} AS INTEGER) ASC, ${seg} ASC`;
  const desc = `ORDER BY CAST(${seg} AS INTEGER) DESC, ${seg} DESC`;
  const lt = `(CAST(${seg} AS INTEGER), ${seg}) < (?2, ?3)`;
  const gt = `(CAST(${seg} AS INTEGER), ${seg}) > (?2, ?3)`;
  const le = `(CAST(${seg} AS INTEGER), ${seg}) <= (?2, ?3)`;
  const curSeg = parent === '' ? ref : ref.slice(parent.length + 1);
  const curInt = parseInt(curSeg, 10) || 0;
  const rows = await db.batch([
    db.prepare(`SELECT ref FROM proni WHERE parent = ?1 ${asc} LIMIT 1`).bind(parent),
    db.prepare(`SELECT ref FROM proni WHERE parent = ?1 ${desc} LIMIT 1`).bind(parent),
    db.prepare(`SELECT ref FROM proni WHERE parent = ?1 AND ${lt} ${desc} LIMIT 1`).bind(parent, curInt, curSeg),
    db.prepare(`SELECT ref FROM proni WHERE parent = ?1 AND ${gt} ${asc} LIMIT 1`).bind(parent, curInt, curSeg),
    db.prepare('SELECT COUNT(*) AS n FROM proni WHERE parent = ?1').bind(parent),
    db.prepare(`SELECT COUNT(*) AS n FROM proni WHERE parent = ?1 AND ${le}`).bind(parent, curInt, curSeg),
  ]);
  const one = (r) => ((r.results || [])[0] || {});
  return {
    parent,
    first: one(rows[0]).ref || null,
    last: one(rows[1]).ref || null,
    prev: one(rows[2]).ref || null,
    next: one(rows[3]).ref || null,
    total: one(rows[4]).n || 0,
    position: one(rows[5]).n || 0,
  };
}

// Bump when the underlying D1 data changes (re-import) to invalidate the edge
// cache without a manual purge — it is folded into the cache key.
const CACHE_VERSION = 'v5';

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

    const itemRow = await db.prepare(`SELECT ${itemCols} FROM proni LEFT JOIN ext ON ext.ref = proni.ref WHERE proni.ref = ?1 LIMIT 1`).bind(ref).all();
    const item = (itemRow.results || [])[0];
    if (!item) return json({ error: 'not found', ref }, 404);

    const kseg = 'substr(ref, length(?1) + 2)'; // ?1 (a real record ref) is never ''
    const kids = await db.prepare(
      `SELECT ${childCols} FROM proni WHERE parent = ?1 ORDER BY CAST(${kseg} AS INTEGER), ${kseg}`
    ).bind(ref).all();

    const nav = await siblingNav(db, ref);

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
        // Civgraph "Additional Data" — Extracted Dates (null if the ext row is not
        // yet loaded / no match). ext_undated is 0/1 on a matched row, null if none.
        extractedDates: item.ext_undated != null ? {
          display: item.ext_display || '',
          startYear: item.ext_start_year, endYear: item.ext_end_year,
          circa: !!item.ext_circa, estimated: !!item.ext_estimated,
          bound: item.ext_bound || '', undated: !!item.ext_undated,
        } : null,
      },
      ancestors,
      nav,
      children: (kids.results || []).map(mapChild),
    });
  } catch (error) {
    return json({ error: String(error && error.message || error), ref }, 500);
  }
}
