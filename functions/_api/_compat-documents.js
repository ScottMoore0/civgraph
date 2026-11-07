/**
 * The map and catalogue documents that were static files, answered from the records database in
 * their identical bytes (data design phase 3, PHASE3.md). These URLs are public (llms.txt and the
 * /maps/ page's dataset markup advertise the first two), so they stay; only their source moved.
 *
 *   /data/database/maps.json       maps + catalogue_parts, written as the file was
 *                                  (JSON.stringify(doc, null, 2) and a newline)
 *   /agent/maps-index.json         document_parts 'agent/maps-index.json'
 *   /data/catalogue/catalogue.json, places.json, people.json   document_parts 'catalogue/...'
 *
 * Pages serves a static file in preference to a Function, so scripts/build/clean-for-pages.sh removes
 * these files from the deployment; _routes.json includes exactly these paths
 * (scripts/check/rules/routes-manifest.mjs reads ROUTE_PATTERNS).
 */
import { MAP_CACHE, mapsDocumentText, storedDocumentText } from './_maps.js';
import { cachedJson, jsonResponse } from './_records.js';
import { binding } from '../_lib/config.js';

const VERSION = 'compat-documents-1';

export const COMPAT_DOCUMENTS = {
  '/data/database/maps.json': { maps: true },
  '/agent/maps-index.json': { name: 'agent/maps-index.json' },
  '/data/catalogue/catalogue.json': { name: 'catalogue/catalogue.json' },
  '/data/catalogue/places.json': { name: 'catalogue/places.json' },
  '/data/catalogue/people.json': { name: 'catalogue/people.json' },
};

/** A Pages handler for these paths: the document, or Pages' own answer for any other path. */
export async function onCompatDocument(context) {
  const doc = COMPAT_DOCUMENTS[new URL(context.request.url).pathname];
  const db = binding(context.env, 'ELECTIONS_DB');
  if (!doc || !db) return context.next();
  const resp = await cachedJson(context, VERSION, async () => {
    const text = doc.maps ? await mapsDocumentText(db, { pretty: true }) : await storedDocumentText(db, doc.name);
    return text === null ? jsonResponse({ error: 'not found' }, 404) : jsonResponse(text);
  }, MAP_CACHE);
  // Not loaded (a database without the phase-3 tables): whatever Pages has at the path.
  return resp.status === 404 ? context.next() : resp;
}
