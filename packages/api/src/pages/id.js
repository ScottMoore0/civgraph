/**
 * GET /id/<kind>:<slug>: the graph's linked-data identifiers (owner decision PG14, 13 Nov 2026).
 *
 * The JSON-LD export names every entity by an IRI under https://civgraph.net/id/
 * (packages/core/src/graph-iri.js). Each answers with a 303 See Other, the linked-data answer for
 * "this names a thing, and here is a page about it":
 *
 *   an entity with its own record page (/browse/persons/<slug>, /browse/elections/<slug>, ...)
 *       -> that page
 *   any other entity the graph holds (bodies, providers, candidatures, dates, map categories...)
 *       -> Browse's page for it, /browse/#/entities/<id>
 *   an id the graph published and no longer has (a renamed contest, a merged person)
 *       -> the page of the entity it became (graph_browse_keys "alias:<id>")
 *   a property term or a statement id, an id the graph never had, or not an id at all -> 404
 *
 * When the lookup cannot be made (no binding, a failed query), a well-formed id still goes to
 * Browse's entity page, which looks the id up itself, so an outage never turns an id into a 404.
 */
import { binding } from '../../../config/src/config.js';
import { asStore } from '../../../storage/src/d1.js';
import { entityIdFromIdPath, entityPagePath, NON_RECORD_ID_KINDS } from '../../../core/src/graph-iri.js';
import { PAGE_TYPE_IDS } from '../../../ui/src/page-types.mjs';
import { parseJson } from '../handlers/_records.js';
import { reportError } from '../handlers/_error.js';
import { GRAPH } from '../queries/graph.js';

/** @typedef {import('../types.js').ApiContext} ApiContext */
/** @typedef {import('../../../storage/src/store.js').RecordStore} RecordStore */

/**
 * A 303 to a page of this site.
 * @param {URL} url  the request's URL (its origin is kept, so a preview deployment stays on itself)
 * @param {string} path  a site-relative path
 */
function seeOther(url, path) {
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(path, url.origin).toString(), 'Cache-Control': 'public, max-age=3600' },
  });
}

function notFound() {
  return new Response('No such Civgraph identifier.\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

/**
 * The entity an id names, following a retired id to the entity it became; null if neither.
 * @param {RecordStore} db
 * @param {string} id
 * @returns {Promise<{ entityId: string, summary: { browseUrl?: unknown } | null } | null>}
 */
export async function findEntity(db, id) {
  let entityId = id;
  let row = /** @type {{ summary: string | null } | null} */ (await db.first(GRAPH.entity, [entityId]));
  if (!row) {
    const alias = /** @type {{ entity_id: string } | null} */ (await db.first(GRAPH.browseKey, [`alias:${id}`]));
    if (!alias?.entity_id) return null;
    entityId = alias.entity_id;
    row = /** @type {{ summary: string | null } | null} */ (await db.first(GRAPH.entity, [entityId]));
    if (!row) return null;
  }
  return { entityId, summary: /** @type {{ browseUrl?: unknown } | null} */ (parseJson(row.summary)) };
}

/**
 * @param {ApiContext} context
 * @returns {Promise<Response>}
 */
export async function serveIdRedirect(context) {
  const url = new URL(context.request.url);
  const parsed = entityIdFromIdPath(url.pathname);
  if (!parsed || NON_RECORD_ID_KINDS.includes(parsed.kind)) return notFound();
  const fallback = entityPagePath(parsed.id, null, PAGE_TYPE_IDS);
  const bound = binding(context.env, 'ELECTIONS_DB');
  if (!bound) return seeOther(url, fallback);
  try {
    const found = await findEntity(asStore(bound), parsed.id);
    if (!found) return notFound();
    return seeOther(url, entityPagePath(found.entityId, found.summary, PAGE_TYPE_IDS));
  } catch (error) {
    reportError(context.env, 'id', error);
    return seeOther(url, fallback);
  }
}
