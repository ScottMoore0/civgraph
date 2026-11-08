/**
 * The map catalogue from the records database (D1 civgraph-records, binding ELECTIONS_DB; data
 * design phase 3). It was the separate civgraph-catalogue database until phase 3 moved its two
 * tables into the records load (packages/loader/src/ingest-maps.mjs: maps, catalogue_parts).
 *
 *   GET /_api/catalogue                    the whole data/database/maps.json document
 *                                          ({ categories, timeSeriesChains, classes, c1s, maps }),
 *                                          in its own key and array order (ORDER BY ord)
 *   GET /_api/catalogue?visible=1          the same without hidden maps
 *   GET /_api/catalogue?id=<id> | ?slug=<slug>      one map record (404 when absent)
 *   GET /_api/catalogue?category=<c>[&visible=1]    { maps: [...] } of one category
 *   GET /_api/catalogue?view=pane|places|people     the catalogue pane's documents
 *                                          (data/catalogue/catalogue.json, places.json, people.json)
 *   GET /_api/catalogue?view=agent         the slim agent index (agent/maps-index.json)
 *
 * The document shape is the one dataService already expects, so its 68 synchronous readers of
 * the catalogue in memory never changed. The views answer the stored documents byte for byte.
 * Cached per dataset version (cachedJson, packages/api/src/handlers/_records.js).
 */
import { CATALOGUE_VIEWS, MAP_CACHE, mapRecord, mapsDocumentText, mapsInCategory, storedDocumentText } from '../_maps.js';
import { cachedJson, jsonResponse } from '../_records.js';
import { binding } from '../../../../config/src/config.js';
import { fromD1 } from '../../../../storage/src/d1.js';

const VERSION = 'catalogue-records-1';
const notFound = () => jsonResponse({ ok: false, error: 'Not found' }, 404);

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  const bound = binding(context.env, 'ELECTIONS_DB');
  if (!bound) return jsonResponse({ ok: false, error: 'ELECTIONS_DB binding not configured' }, 503);
  // through the storage adapter (packages/storage/); the SQL is named in queries/maps.js
  /** @type {import('../../../../storage/src/store.js').RecordStore} */
  const db = fromD1(bound);
  return cachedJson(context, VERSION, () => answer(db, new URL(context.request.url)), MAP_CACHE);
}

/**
 * @param {import('../../../../storage/src/store.js').RecordStore | D1Database} db
 * @param {URL} url
 */
export async function answer(db, url) {
  const p = url.searchParams;
  const view = p.get('view');
  const visibleOnly = p.get('visible') === '1';
  if (view) {
    const name = CATALOGUE_VIEWS[view];
    if (!name) return jsonResponse({ ok: false, error: `unknown view ${view}` }, 400);
    const text = await storedDocumentText(db, name);
    return text === null ? notFound() : jsonResponse(text);
  }
  if (p.get('id') || p.get('slug')) {
    const record = await mapRecord(db, { id: p.get('id'), slug: p.get('id') ? null : p.get('slug') });
    return record ? jsonResponse(record) : notFound();
  }
  if (p.get('category')) return jsonResponse(await mapsInCategory(db, /** @type {string} */ (p.get('category')), visibleOnly));
  const text = await mapsDocumentText(db, { visibleOnly });
  return text === null ? jsonResponse({ ok: false, error: 'catalogue not loaded' }, 503) : jsonResponse(text);
}
