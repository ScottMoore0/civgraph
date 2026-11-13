/**
 * The graph's linked-data identifiers as web addresses (owner decision PG14, 13 Nov 2026).
 *
 * The semantic graph mints every entity id as `cg:<kind>:<slug>` (scripts/lib/graph-entity-id.mjs).
 * Its JSON-LD context expands the `cg:` prefix to `<site origin>/id/`
 * (scripts/build/graph/build-semantic-graph.mjs), so `cg:person:a-a-gillespie-148709` is
 * https://civgraph.net/id/person:a-a-gillespie-148709. That address answers with a 303 See Other
 * to the record's page (functions/id/[[path]].js, packages/api/src/pages/id.js).
 *
 * Pure: no I/O, so the build, the Function and the tests share it.
 */

/** Where the identifiers live, under the site origin. */
export const ID_PATH = '/id/';

/**
 * The IRI the JSON-LD context gives the `cg:` prefix, for a site origin.
 * @param {string} origin  e.g. https://civgraph.net (SITE.origin)
 * @returns {string}
 */
export function idBase(origin) {
  return `${origin}${ID_PATH}`;
}

/**
 * The id kinds that name no record: the graph's property terms (`cg:property:...`) and its
 * statement ids (`cg:statement:...`). They are not entities, so no page answers for them.
 */
export const NON_RECORD_ID_KINDS = Object.freeze(['property', 'statement']);

// <kind>:<slug>: a kind is lower-case words joined by hyphens; a slug is what makeEntityId writes
// (lower-case letters, digits and hyphens), with dots and underscores allowed for older ids.
const ID_REST = /^([a-z]+(?:-[a-z]+)*):([a-z0-9][a-z0-9._-]{0,199})$/;

/**
 * The entity id an /id/ address names, and its kind; null for anything else.
 * A client may send the colon percent-encoded (`/id/person%3Aa-a-gillespie-148709`).
 * @param {string} pathname  the URL's path
 * @returns {{ id: string, kind: string } | null}
 */
export function entityIdFromIdPath(pathname) {
  if (!pathname.startsWith(ID_PATH)) return null;
  let rest;
  try {
    rest = decodeURIComponent(pathname.slice(ID_PATH.length));
  } catch {
    return null;
  }
  const match = ID_REST.exec(rest);
  return match ? { id: `cg:${rest}`, kind: /** @type {string} */ (match[1]) } : null;
}

/**
 * The page an entity's identifier leads to: the record's own page when the graph gives it one at
 * a path the site serves (/browse/<type>/<slug>, for a path-style type), otherwise Browse's page
 * for the entity, which shows any entity the graph holds.
 * @param {string} entityId
 * @param {{ browseUrl?: unknown } | null | undefined} summary  the entity's graph summary
 * @param {readonly string[]} pageTypes  the path-style record types (PAGE_TYPE_IDS, packages/ui/src/page-types.mjs)
 * @returns {string}  a site-relative path
 */
export function entityPagePath(entityId, summary, pageTypes) {
  const url = typeof summary?.browseUrl === 'string' ? summary.browseUrl : '';
  const match = /^\/browse\/([a-z-]+)\/[^/?#\\]+$/.exec(url);
  if (match && pageTypes.includes(/** @type {string} */ (match[1]))) return url;
  return `/browse/#/entities/${encodeURIComponent(entityId)}`;
}
