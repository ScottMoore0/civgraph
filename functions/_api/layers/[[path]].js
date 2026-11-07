/**
 * The map layers from the records database (data design phase 3): what the static files
 * render/metadata/maps-test.json, maps-test-index.json, layer-details-test2/ and
 * duplicate-feature-ids/ held, answered from the `layers` tables (scripts/records/ingest-maps.mjs).
 *
 *   GET /_api/layers                      the full render metadata (maps-test.json's shape)
 *   GET /_api/layers?view=index           the map app's startup index (maps-test-index.json's
 *                                         shape; each entry's detailUrl and duplicateFeatureIdsUrl
 *                                         name the two routes below)
 *   GET /_api/layers/<id>                 one layer's full record (its layer-details file)
 *   GET /_api/layers/<id>/duplicates      its duplicate-feature-id sidecar
 *
 * <id> may be any spelling of a layer id (layer_aliases: -vector and its retired spelling with a
 * further -test suffix, likewise -raster and -alias; renamed prefixes): another spelling answers 301 to the live id, so each record has one URL. The old
 * file URLs answer 301 to these (functions/render/metadata/[[path]].js). Cached per dataset
 * version (cachedJson).
 */
import { MAP_CACHE, layerIndexDocument, layerRow, layersDocumentText, resolveLayerId } from '../_maps.js';
import { cachedJson, jsonResponse } from '../_records.js';

const VERSION = 'layers-1';
const notFound = () => jsonResponse({ error: 'not found' }, 404);

export function matchLayersPath(parts) {
  const clean = parts.filter((p) => p !== '');
  if (!clean.length) return { kind: 'collection' };
  if (clean.length === 1) return { kind: 'layer', id: clean[0] };
  if (clean.length === 2 && clean[1] === 'duplicates') return { kind: 'duplicates', id: clean[0] };
  return null;
}

export async function onRequestGet(context) {
  const db = context.env?.ELECTIONS_DB;
  if (!db) return jsonResponse({ error: 'ELECTIONS_DB binding not configured' }, 503);
  const parts = [].concat(context.params?.path || []).map((p) => decodeURIComponent(p));
  const route = matchLayersPath(parts);
  if (!route) return notFound();
  const url = new URL(context.request.url);
  return cachedJson(context, VERSION, () => answer(db, route, url), MAP_CACHE);
}

export async function answer(db, route, url) {
  if (route.kind === 'collection') {
    const view = url.searchParams.get('view');
    if (view === 'index') {
      const doc = await layerIndexDocument(db);
      return doc ? jsonResponse(doc) : jsonResponse({ error: 'layers not loaded' }, 503);
    }
    if (view && view !== 'full') return jsonResponse({ error: `unknown view ${view}` }, 400);
    const text = await layersDocumentText(db);
    return text === null ? jsonResponse({ error: 'layers not loaded' }, 503) : jsonResponse(text);
  }
  const resolved = await resolveLayerId(db, route.id);
  if (!resolved) return notFound();
  if (resolved.alias) {
    const target = `/_api/layers/${encodeURIComponent(resolved.id)}${route.kind === 'duplicates' ? '/duplicates' : ''}`;
    return new Response(null, { status: 301, headers: { Location: target, 'Cache-Control': 'public, max-age=86400' } });
  }
  const row = await layerRow(db, resolved.id);
  if (!row) return notFound();
  if (route.kind === 'duplicates') return row.duplicates ? jsonResponse(row.duplicates) : notFound();
  return jsonResponse(row.record);
}
