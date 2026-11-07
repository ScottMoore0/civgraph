/**
 * Version 1 of the public API: /api/v1/*.
 *
 * REFACTOR-PLAN.md item 5. Each route is the existing /_api route, delegated to unchanged
 * (functions/_lib/api/delegate.js): the same handler module, the same parameters, the same
 * answer, byte for byte. /_api/* stays as it is, for good, as the alias the site's own pages
 * call; /api/v1/* is the address to publish and keep stable.
 *
 * THE CONTRACT. A v1 route's parameters and answer shape do not change incompatibly. Adding a
 * parameter, a view or a field is compatible; removing or renaming one, or changing a type or a
 * meaning, is a v2 (a new file beside this one, with its own table), and v1 keeps answering.
 * tests/functions/api-v1.test.mjs holds every route here to its legacy handler and every /_api
 * route file to a decision: in v1, or in EXCLUDED with a reason.
 *
 * Adding a route: import the handler module, add a row (legacy path, summary, parameters), and
 * the test, the index document and the router pick it up. A handler under a catch-all file
 * ([[path]].js) is `catchAll: true`, and the segments after the route reach it as params.path.
 */
import * as catalogue from '../../_api/catalogue/index.js';
import * as dataIndex from '../../_api/data-index/index.js';
import * as elections from '../../_api/elections/index.js';
import * as graph from '../../_api/graph/index.js';
import * as layers from '../../_api/layers/[[path]].js';
import * as parties from '../../_api/parties/index.js';
import * as persons from '../../_api/persons/index.js';
import * as proniCount from '../../_api/proni/count.js';
import * as proniExport from '../../_api/proni/export.js';
import * as proniNode from '../../_api/proni/node.js';
import * as proniSearch from '../../_api/proni/search.js';
import * as registerInterests from '../../_api/register-interests/index.js';
import * as search from '../../_api/search.js';
import * as sources from '../../_api/sources/index.js';
import * as spatial from '../../_api/spatial.js';
import * as stats from '../../_api/stats/index.js';
import * as votes from '../../_api/votes/index.js';
import { jsonAnswer } from './delegate.js';
import { CONTRACTS } from './contracts/v1.js';
import { openApiDocument } from './openapi.js';
import { API, SITE } from '../config.js';

export const VERSION = 'v1';
export const PREFIX = API.prefix(VERSION);
export const LEGACY_PREFIX = API.legacyPrefix;

/**
 * @typedef {object} V1Route
 * @property {any} module            the /_api handler module
 * @property {string} legacy         its /_api path
 * @property {string} summary
 * @property {string[]} parameters   the query parameters it reads
 * @property {boolean} [catchAll]    a catch-all route: the segments after it reach the handler
 */
/**
 * @param {any} module
 * @param {string} legacy
 * @param {string} summary
 * @param {string[]} [parameters]
 * @param {{ catchAll?: boolean }} [extra]
 * @returns {Readonly<V1Route>}
 */
const route = (module, legacy, summary, parameters = [], extra = {}) => Object.freeze({ module, legacy, summary, parameters, ...extra });

/** v1 route (path under /api/v1) -> its handler and legacy path. */
export const ROUTES = Object.freeze({
  elections: route(elections, '/_api/elections', 'Elections, contests, candidates and counts',
    ['body', 'key', 'slug', 'constituency', 'constituencyName', 'contest', 'format', 'lite', 'view', 'decade', 'q', 'limit', 'offset']),
  persons: route(persons, '/_api/persons', 'People: search, list and one record with candidacies and votes',
    ['slug', 'q', 'limit', 'offset', 'facets', 'view', 'body', 'decade', 'elected', 'party', 'sort']),
  parties: route(parties, '/_api/parties', 'Parties: the list, one party, its profile, ballot-label folds',
    ['slug', 'view']),
  sources: route(sources, '/_api/sources', 'Catalogued sources and their citations',
    ['slug', 'q', 'limit', 'offset', 'provider', 'category', 'publicationStatus', 'view', 'sort']),
  'register-interests': route(registerInterests, '/_api/register-interests', 'Registers of members\' interests',
    ['slug', 'q', 'limit', 'offset', 'memberName', 'electedBody', 'category', 'view', 'sort']),
  votes: route(votes, '/_api/votes', 'Parliamentary divisions and how members voted',
    ['view', 'division', 'shard', 'person', 'party', 'body', 'term']),
  graph: route(graph, '/_api/graph', 'The semantic graph: entities and statements',
    ['entity', 'browse', 'slug', 'q', 'limit', 'offset', 'related', 'view']),
  stats: route(stats, '/_api/stats', 'Headline counts of the records'),
  catalogue: route(catalogue, '/_api/catalogue', 'The map catalogue',
    ['id', 'slug', 'category', 'visible', 'view']),
  layers: route(layers, '/_api/layers', 'Map layers: the full metadata, the startup index, each layer record and its duplicate-id sidecar',
    ['view'], { catchAll: true }),
  search: route(search, '/_api/search', 'Map features by name', ['q', 'limit']),
  spatial: route(spatial, '/_api/spatial', 'Map features of one map in a bounding box', ['mapId', 'bbox']),
  'data-index': route(dataIndex, '/_api/data-index', 'The published files on data.civgraph.net, by prefix',
    ['prefix', 'cursor', 'limit']),
  'proni/node': route(proniNode, '/_api/proni/node', 'PRONI eCatalogue: the fonds, or one node with its ancestors and children', ['ref']),
  'proni/search': route(proniSearch, '/_api/proni/search', 'PRONI eCatalogue full-text search',
    ['q', 'fields', 'letter', 'from', 'to', 'top', 'level', 'access', 'sort', 'dir', 'limit', 'offset']),
  'proni/count': route(proniCount, '/_api/proni/count', 'PRONI eCatalogue: the number of matches, by level',
    ['q', 'fields', 'letter', 'from', 'to', 'top', 'level', 'access']),
  'proni/export': route(proniExport, '/_api/proni/export', 'PRONI eCatalogue: matches as CSV',
    ['q', 'fields', 'letter', 'from', 'to', 'top', 'level', 'access']),
});

/**
 * /_api route files deliberately NOT in the public versioned API, with why. The test fails on
 * any /_api route that is in neither list.
 */
export const EXCLUDED = Object.freeze({
  '/_api/auth/status': 'the signed-in contributor\'s session; part of the contribution workflow, not data',
  '/_api/contributions/*': 'the authenticated contribution workflow (submit, review, intake); writes, not a public data API',
  '/_api/rum': 'browser performance telemetry (POST); not data',
});

/** The /api/v1 index document: what v1 holds and where each route came from. */
export function indexDocument() {
  return {
    api: SITE.name,
    version: VERSION,
    status: 'stable',
    compatibility: 'Routes, parameters and answer shapes in v1 change only compatibly (additions). An incompatible change is a new version; v1 keeps answering.',
    legacyPrefix: LEGACY_PREFIX,
    openapi: `${PREFIX}/openapi.json`,
    methods: ['GET', 'HEAD'],
    endpoints: Object.entries(ROUTES).map(([path, r]) => ({
      path: `${PREFIX}/${path}`,
      legacy: r.legacy,
      summary: r.summary,
      parameters: r.parameters,
      ...(r.catchAll ? { subpaths: true } : {}),
    })),
  };
}

/** The OpenAPI 3.1 document of v1: the route table and the contracts (contracts/v1.js). */
export const openApi = () => openApiDocument({ version: VERSION, prefix: PREFIX, routes: ROUTES, contracts: CONTRACTS }, SITE);

export const V1 = Object.freeze({
  version: VERSION,
  prefix: PREFIX,
  legacyPrefix: LEGACY_PREFIX,
  routes: ROUTES,
  contracts: CONTRACTS,
  index: () => jsonAnswer(indexDocument()),
  /** Documents about the version, served at <prefix>/<name> before any route is matched. */
  documents: Object.freeze({ 'openapi.json': () => jsonAnswer(openApi()) }),
  /**
   * The version that replaces this one, once it exists ({ version, prefix, routes }); null
   * while v1 is current. With a successor, every v1 answer for a route the successor also
   * serves carries `Link: <successor path>; rel="successor-version"` (delegate.js).
   */
  successor: null,
  /** An HTTP date for a `Sunset` header: only by the owner's decision. null: no sunset. */
  sunset: null,
});
