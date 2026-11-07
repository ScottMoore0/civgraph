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
import { binding } from '../../_lib/config.js';
import { fromD1 } from '../../_lib/storage/d1.js';
import { PRONI } from '../../_lib/queries/proni.js';

function ancestorRefs(ref) {
  const parts = String(ref).split('/');
  const out = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}


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
  const curSeg = parent === '' ? ref : ref.slice(parent.length + 1);
  const curInt = parseInt(curSeg, 10) || 0;
  const rows = await db.batch([
    { sql: PRONI.firstSibling, params: [parent] },
    { sql: PRONI.lastSibling, params: [parent] },
    { sql: PRONI.previousSibling, params: [parent, curInt, curSeg] },
    { sql: PRONI.nextSibling, params: [parent, curInt, curSeg] },
    { sql: PRONI.siblingCount, params: [parent] },
    { sql: PRONI.siblingPosition, params: [parent, curInt, curSeg] },
  ]);
  const one = (/** @type {Record<string, any>[]} */ r) => (r[0] || {});
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
const CACHE_VERSION = 'v7';

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

  const bound = binding(context.env, 'PRONI_DB');
  if (!bound) return json({ error: 'PRONI_DB binding not configured' }, 503);
  // through the storage adapter (functions/_lib/storage/); the SQL is named in queries/proni.js
  const db = fromD1(bound);

  try {
    if (!ref) {
      const results = await db.all(PRONI.roots);
      return json({ roots: results.map(mapChild), count: results.length });
    }

    const itemRow = await db.all(PRONI.item, [ref]);
    const item = itemRow[0];
    if (!item) return json({ error: 'not found', ref }, 404);

    const kids = await db.all(PRONI.children, [ref]);

    const nav = await siblingNav(db, ref);

    const ancRefs = ancestorRefs(ref);
    let ancestors = [];
    if (ancRefs.length) {
      // order-free: keyed into a Map by ref and read back in ancestor order
      const anc = await db.all(PRONI.ancestors(ancRefs.length), ancRefs);
      const byRef = new Map(anc.map((a) => [a.ref, a]));
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
      children: kids.map(mapChild),
    });
  } catch (error) {
    return json({ error: String(error && error.message || error), ref }, 500);
  }
}
