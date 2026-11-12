/**
 * The page-types registry (REG-7): the record types with a page of their own, at
 * /browse/<type>/<slug>. One declaration for everything that serves or links to those pages:
 *
 *   functions/_browse-page.js        BROWSE_PAGE_TYPES: the head, title and redirects of a record page
 *   packages/ui/src/templates/records/index.js  SSR_RECORD_TYPES: the types rendered on the server (`ssr`)
 *   site/browse/browse.js            PATH_ROUTE_TYPES: the Browse app's records that navigate to their path
 *   scripts/build/build-sitemap.mjs  the record pages in the sitemaps
 *   the map app                      its links to a record's page (recordPagePath)
 *
 * The URLs are a public surface (docs/ARCHITECTURE-RULES.md R13): a type is only ever added.
 * Pure data, served to Browse at /pkg/ui/src/page-types.mjs (packages/served.json).
 */

/**
 * @typedef {object} PageType
 * @property {string} id           the type's path segment, /browse/<id>/<slug>, and its Browse index (data/browse/<id>.json)
 * @property {string} singular     what one record is called (a page title's middle part)
 * @property {string} [crumb]      a server-rendered page's breadcrumb: the type's list
 * @property {string} [table]      the D1 table its card rows are read from by slug
 * @property {string} [aliasTable] the D1 table of its retired slugs
 * @property {boolean} [ssr]       rendered on the server when the deployment turns it on (templates/records/index.js)
 */

/** In the order BROWSE_PAGE_TYPES has always listed them. @type {readonly PageType[]} */
export const PAGE_TYPES = Object.freeze([
  { id: 'persons', singular: 'Person', crumb: 'People', table: 'person_cards', aliasTable: 'person_aliases', ssr: true },
  { id: 'sources', singular: 'Source', crumb: 'Sources', table: 'sources', aliasTable: 'source_aliases', ssr: true },
  { id: 'register-interests', singular: 'Register interest', crumb: 'Register of interests', table: 'register_entries', aliasTable: 'register_entries_aliases', ssr: true },
  // From the records tables (data design phase 2): an election page is assembled from several
  // rows (packages/api/src/pages/election.js loadElectionPage), a party from party_cards.
  { id: 'elections', singular: 'Election', crumb: 'Elections', ssr: true },
  { id: 'maps', singular: 'Map' },
  { id: 'parties', singular: 'Party / label', crumb: 'Parties', ssr: true },
  { id: 'offices', singular: 'Office' },
].map((type) => Object.freeze(type)));

/**
 * The page type with this id, or null.
 * @param {unknown} id
 * @returns {PageType | null}
 */
export function pageType(id) {
  return PAGE_TYPES.find((type) => type.id === id) || null;
}

/** The page types' ids, in registry order. */
export const PAGE_TYPE_IDS = Object.freeze(PAGE_TYPES.map((type) => type.id));

/**
 * The path of a record's page.
 * @param {string} type  a page type id
 * @param {string} slug
 * @returns {string}
 */
export function recordPagePath(type, slug) {
  return `/browse/${type}/${encodeURIComponent(slug)}`;
}
