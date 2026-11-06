/**
 * /data/graph/** -- the semantic graph files.
 *
 *   manifest.json     answered from D1 (the graph's own manifest, as built)
 *   exports/<file>    the R2 copy while it is there (the 90-day dual run: the go-live does not
 *                     depend on the bulk downloads having been published); without one, 301 to
 *                     the bulk downloads (https://data.civgraph.net/downloads/<file>.gz, and
 *                     downloads/manifest.json for the exports manifest), which records:downloads
 *                     writes from the local build and an approved upload publishes
 *   anything else     the R2 copy, as before, for the 90-day dual run (owner decision,
 *                     2026-11-06); after it, 410. Record pages now ask /_api/graph instead.
 *
 * FALLS THROUGH ON AN R2 MISS (context.next()), DELIBERATELY: a Pages SPA fallback answering a
 * missing asset with index.html at 200 caused two outages; Pages' own 404 is the honest answer.
 */
import { cachedJson, documentBody, jsonResponse } from '../../_api/_records.js';

const VERSION = 'data-graph-1';
export const DOWNLOADS_ORIGIN = 'https://data.civgraph.net/downloads';

/** Where an export moved to in the bulk downloads. */
export function downloadsUrl(file) {
  return file === 'manifest.json' ? `${DOWNLOADS_ORIGIN}/manifest.json` : `${DOWNLOADS_ORIGIN}/${encodeURIComponent(file)}.gz`;
}

export async function onRequestGet(context) {
  const parts = (context.params.path || []).map(decodeURIComponent);
  if (parts[0] === 'exports' && parts.length >= 2) {
    const file = parts[parts.length - 1];
    const copy = context.env.MAPS_BUCKET ? await context.env.MAPS_BUCKET.get(`data/graph/${parts.join('/')}`) : null;
    if (copy) return r2Response(copy);
    return Response.redirect(downloadsUrl(file), 301);
  }
  const db = context.env.ELECTIONS_DB;
  if (db && parts.length === 1 && parts[0] === 'manifest.json') {
    const resp = await cachedJson(context, VERSION, async () => {
      const doc = await documentBody(db, 'graph/manifest.json');
      return doc ? jsonResponse(doc) : jsonResponse({ error: 'not found' }, 404);
    });
    if (resp.status === 200 || resp.status === 304) return resp;
  }
  const bucket = context.env.MAPS_BUCKET;
  if (!bucket) return context.next();
  const obj = await bucket.get(`data/graph/${parts.join('/')}`);
  if (!obj) return context.next();
  return r2Response(obj);
}

function r2Response(obj) {
  return new Response(obj.body, {
    headers: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
