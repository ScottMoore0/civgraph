/**
 * The response contracts of /api/v1: one JSON Schema per route and variant (REFACTOR-PLAN.md
 * item 5, slice API-2). These schemas ARE the frozen surface of v1.
 *
 * What a schema promises: the fields it names in `required` are there, with the types it gives,
 * in every answer of that variant. Fields it does not name may come and go; a client must
 * ignore fields it does not know. Deep record bodies (an election bundle, a person's record, a
 * layer's style) are promised at their top level only: the frozen surface is the envelope and
 * the identifying fields of each item, not every field of every record.
 *
 * How it is held:
 *   - tests/functions/api-v1-contracts.test.mjs validates real answers of every variant (over
 *     the records build when present, over fixtures otherwise) and every route's error answers;
 *   - the same test compares these schemas with tests/functions/api-v1-contracts.baseline.json
 *     by incompatibilities() (functions/_lib/api/json-schema.js): a dropped required field, a
 *     widened type or a removed variant fails. Additions pass; to take them into the baseline,
 *     run the test with API_CONTRACT_BASELINE=write and commit the file.
 *   - /api/v1/openapi.json (functions/_lib/api/openapi.js) publishes them.
 *
 * A variant is chosen by its `when`, the first that matches in table order:
 *   `param: '*'`        the parameter is given, non-empty;
 *   `param: ''`         the parameter is absent or empty;
 *   `param: 'value'`    the parameter equals that value;
 *   `path: 'pattern'`   (catch-all routes) the segments after the route: '' none, '<id>' one,
 *                       '<id>/duplicates' two with that second segment.
 * `errors` is the shape of the route's JSON error answers (4xx and 5xx). Two envelopes exist in
 * v1, `{ error }` and `{ ok: false, error }`; they stay as they are (functions/README.md, "v2
 * candidates").
 */

// ------------------------------------------------------------------ schema helpers

const str = Object.freeze({ type: 'string' });
const num = Object.freeze({ type: 'number' });
const int = Object.freeze({ type: 'integer' });
const bool = Object.freeze({ type: 'boolean' });
const object = Object.freeze({ type: 'object' });
/** @param {Record<string, any>} properties @param {string[]} [required] every property unless given */
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
/** @param {any} [items] */
const arr = (items) => (items === undefined ? { type: 'array' } : { type: 'array', items });
/** @param {any} values */
const dict = (values) => ({ type: 'object', additionalProperties: values });
/** @param {...string} types */
const either = (...types) => ({ type: types });

const ERROR = obj({ error: str });
const OK_FALSE_ERROR = obj({ ok: { const: false }, error: str });

/** A Browse list page (functions/_api/_browse-index.js). */
const page = (/** @type {string} */ key, /** @type {any} */ item) => obj({
  [key]: arr(item), total: num, count: num, limit: num, offset: num,
  applied: obj({ filters: arr(), sort: {} }),
});

const PERSON = obj({ id: str, slug: str, type: str, title: str, name: str, browseUrl: str, parties: arr(), elections: arr() }, ['id', 'slug', 'type', 'title', 'name', 'browseUrl']);
const PARTY = obj({ id: str, slug: str, type: str, title: str, colour: str, browseUrl: str });
const SOURCE = obj({ id: str, slug: str, type: str, title: str, browseUrl: str });
const REGISTER_ENTRY = obj({ id: str, slug: str, type: str, title: str, memberName: str });
const VOTES_PERSON = obj({ schemaVersion: num, personId: num, terms: arr(), divisions: arr() });
const STATEMENT = obj({ id: str, propertyId: str, propertyLabel: str, valueType: str });
const ENTITY = obj({ entityId: str, summary: either('object', 'null'), statements: arr(STATEMENT), total: num });
const MAP = obj({ id: str, name: str, slug: str, category: str });
const LAYER = obj({ id: str, sourceMapId: str, name: str, category: str, renderer: str, geometryType: str });
const CONTEST = obj({ constituency: object, feature: either('object', 'null'), candidates: arr(), counts: arr(), animationPayload: either('object', 'null') });
const PRONI_CHILD = obj({ ref: str, slug: str, title: str, level: str, dates: str, hasChildren: bool });
const PRONI_ROW = obj({ ref: str, slug: str, title: str, level: str, dates: str, parent: str, hasChildren: bool, fond: str, description: str, descTruncated: bool, exact: bool, url: str });

/**
 * @typedef {object} Variant
 * @property {string} name
 * @property {Record<string, string>} when
 * @property {string} summary
 * @property {any} [schema]          the JSON answer's schema (absent for a non-JSON answer)
 * @property {string} [contentType]  when the answer is not JSON
 *
 * @typedef {object} Contract
 * @property {any} errors            the JSON error answers' schema (null: errors are text)
 * @property {Variant[]} variants
 */

/** @param {string} name @param {Record<string, string>} when @param {string} summary @param {any} schema @returns {Variant} */
const v = (name, when, summary, schema) => ({ name, when, summary, schema });

/** @type {Readonly<Record<string, Contract>>} */
export const CONTRACTS = Object.freeze({
  elections: {
    errors: ERROR,
    variants: [
      v('record', { view: 'record' }, 'One Browse election record: an election\'s detail item or a contest\'s', obj({ item: object })),
      v('manifest', { view: 'manifest' }, 'Every election the map app can show',
        obj({ schemaVersion: num, generatedAt: str, totals: obj({ elections: num, loadable: num }), elections: arr(obj({ key: str, body: str, date: str, displayTitle: str, loadable: bool })) })),
      v('summary', { view: 'summary' }, 'One election\'s summary', obj({ key: str, body: str, date: str, displayTitle: str, results: arr() })),
      v('provenance', { view: 'provenance' }, 'Where each contest\'s figures came from', obj({ schemaVersion: num, key: str, contests: object })),
      v('list', { view: 'list' }, 'The Browse list of elections, or a page of it',
        obj({ schemaVersion: num, total: num, items: arr(obj({ slug: str, title: str, date: str, body: str, kind: str, interactiveUrl: str }, ['slug', 'title'])) })),
      v('detail', { view: 'detail' }, 'One election\'s Browse detail', obj({ schemaVersion: num, item: object })),
      v('contests', { view: 'contests' }, 'One election\'s contests as Browse items', obj({ schemaVersion: num, items: arr(object) })),
      v('index', { key: '' }, 'Every election, by date then key',
        obj({ elections: arr(obj({ key: str, body: str, bodySlug: str, displayTitle: str, date: str, year: num })), count: num })),
      v('contest-by-slug', { key: '*', contest: '*' }, 'One contest found by its Browse slug: candidates and counts', CONTEST),
      v('contest-by-name', { key: '*', constituencyName: '*' }, 'One contest found by its name', CONTEST),
      v('contest', { key: '*', constituency: '*' }, 'One contest by its sequence number', CONTEST),
      v('bundle', { key: '*', format: 'bundle' }, 'The election bundle (the static file\'s shape); lite=1 leaves out the counts',
        obj({ schemaVersion: num, key: str, body: str, date: str, displayTitle: str, loadable: bool })),
      v('election', { key: '*' }, 'One election with its constituencies',
        obj({ election: obj({ key: str, body: str, date: str, displayTitle: str }), constituencies: arr(obj({ seq: num, name: str })), matchedCount: num, unmatchedCount: num })),
    ],
  },
  persons: {
    errors: ERROR,
    variants: [
      v('facets', { facets: '1' }, 'The People filter options', obj({ facets: obj({ body: arr(), decade: arr(), elected: arr(), party: arr() }) })),
      v('candidacies', { slug: '*', view: 'candidacies' }, 'Every candidacy of one person, in date order',
        obj({ slug: str, personId: str, total: num, candidacies: arr(obj({ electionKey: str, electionSlug: str, date: str, contest: str, name: str, elected: bool })) })),
      v('votes', { slug: '*', view: 'votes' }, 'One person\'s parliamentary votes', VOTES_PERSON),
      v('record', { slug: '*' }, 'One person', obj({ person: PERSON, record: PERSON })),
      v('list', {}, 'A page of people, searched (q), filtered and sorted', page('persons', PERSON)),
    ],
  },
  parties: {
    errors: ERROR,
    variants: [
      v('names', { view: 'names' }, 'Ballot label -> party slug', obj({ schemaVersion: num, items: dict(str) })),
      v('folds', { view: 'folds' }, 'The curated ballot-label folds', obj({ schemaVersion: num, total: num, folds: arr() })),
      v('profile', { slug: '*', view: 'profile' }, 'One party\'s profile', obj({ schemaVersion: num, slug: str, title: str })),
      v('record', { slug: '*' }, 'One party', obj({ schemaVersion: num, item: PARTY })),
      v('list', {}, 'Every party, in source order', obj({ schemaVersion: num, total: num, items: arr(PARTY) })),
    ],
  },
  sources: {
    errors: ERROR,
    variants: [
      v('detail', { slug: '*', view: 'detail' }, 'One source\'s full record', obj({ schemaVersion: num, item: object })),
      v('record', { slug: '*' }, 'One source', obj({ source: SOURCE, record: SOURCE })),
      v('list', {}, 'A page of sources, searched, filtered and sorted', page('sources', SOURCE)),
    ],
  },
  'register-interests': {
    errors: ERROR,
    variants: [
      v('record', { slug: '*' }, 'One register entry', obj({ 'register-interest': REGISTER_ENTRY, record: REGISTER_ENTRY })),
      v('list', {}, 'A page of register entries, searched, filtered and sorted', page('register-interests', REGISTER_ENTRY)),
    ],
  },
  votes: {
    errors: ERROR,
    variants: [
      v('index', { view: 'index' }, 'What the votes data holds', obj({ schemaVersion: num, shards: num, bodies: dict(object), persons: num, parties: num })),
      v('division', { division: '*' }, 'One division with its votes', obj({ id: str, body: str, date: str, title: str, votes: arr() })),
      v('shard', { shard: '*' }, 'One shard of divisions', obj({ schemaVersion: num, shard: num, divisions: object })),
      v('person', { person: '*' }, 'One member\'s votes', VOTES_PERSON),
      v('party', { party: '*' }, 'One party\'s cohesion', obj({ schemaVersion: num, slug: str, labels: arr(str), terms: arr() })),
    ],
  },
  graph: {
    errors: ERROR,
    variants: [
      v('manifest', { view: 'manifest' }, 'The graph manifest, its exports pointing at downloads',
        obj({ schemaVersion: num, entities: obj({ total: num }), statements: obj({ total: num }), exports: object, api: str, downloads: str })),
      v('search', { q: '*' }, 'Entities by name', obj({ items: arr(obj({ entityId: str, slug: str, label: str, types: arr() }, ['entityId', 'label', 'types'])) })),
      v('entity', { entity: '*' }, 'One entity\'s statements (related=1 adds reverse and source statements)', ENTITY),
      v('slug', { slug: '*' }, 'The same, by the entity\'s readable slug', ENTITY),
      v('browse', { browse: '*' }, 'The same, by a Browse record key (type:key)', ENTITY),
    ],
  },
  stats: {
    errors: ERROR,
    variants: [
      v('counts', {}, 'Headline counts', obj({
        elections: num, electionContests: num, candidacies: num, people: num, cataloguedSources: num,
        parties: num, registerEntries: num, divisions: num, graphEntities: num, version: str,
      })),
    ],
  },
  catalogue: {
    errors: OK_FALSE_ERROR,
    variants: [
      v('pane', { view: 'pane' }, 'The catalogue pane', obj({ schemaVersion: num, shelves: arr(), maps: object })),
      v('places', { view: 'places' }, 'The catalogue\'s places', obj({ schemaVersion: num, maps: arr(), places: arr() })),
      v('people', { view: 'people' }, 'The catalogue\'s people', obj({ schemaVersion: num, parties: arr(), constituencies: arr(), people: arr() })),
      v('agent', { view: 'agent' }, 'The slim agent index of maps', obj({ count: num, maps: arr(), dataOverlays: arr() })),
      v('record-by-id', { id: '*' }, 'One map record', MAP),
      v('record-by-slug', { slug: '*' }, 'One map record, by slug', MAP),
      v('category', { category: '*' }, 'The maps of one category', obj({ maps: arr(MAP) })),
      v('document', {}, 'The whole catalogue (visible=1: without hidden maps)', obj({ categories: arr(), timeSeriesChains: arr(), maps: arr(MAP) })),
    ],
  },
  layers: {
    errors: ERROR,
    variants: [
      v('index', { path: '', view: 'index' }, 'The map app\'s startup index', obj({ schemaVersion: num, capabilities: object, categories: arr(), layers: arr(LAYER) })),
      v('document', { path: '' }, 'The full render metadata', obj({ schemaVersion: num, categories: arr(), layers: arr(LAYER) })),
      v('duplicates', { path: '<id>/duplicates' }, 'One layer\'s duplicate-feature-id sidecar',
        obj({ layerId: str, sourceMapId: str, featureCount: num, duplicateFeatureIds: arr() })),
      v('layer', { path: '<id>' }, 'One layer\'s full record', obj({ ...LAYER.properties, minzoom: num, maxzoom: num }, [...LAYER.required, 'minzoom', 'maxzoom'])),
    ],
  },
  search: {
    errors: ERROR,
    variants: [v('results', {}, 'Map features whose name contains q, best first', obj({ results: arr(obj({ score: int })) }))],
  },
  spatial: {
    errors: ERROR,
    variants: [v('features', { mapId: '*' }, 'One map\'s features in the bounding box', obj({ features: arr() }))],
  },
  'data-index': {
    errors: OK_FALSE_ERROR,
    variants: [
      v('listing', {}, 'One level of the published files under a prefix (the approved prefixes at the root)', obj({
        ok: { const: true }, scope: str, prefix: str, folders: arr(obj({ prefix: str, name: str })), files: arr(obj({ key: str, name: str, size: num, url: str })), truncated: bool, cursor: either('string', 'null'),
      })),
    ],
  },
  'proni/node': {
    errors: ERROR,
    variants: [
      v('node', { ref: '*' }, 'One catalogue node with its ancestors and children', obj({
        item: obj({ ref: str, slug: str, title: str, level: str, dates: str, description: str, access: str, hasChildren: bool, fond: str, extractedDates: either('object', 'null') }),
        ancestors: arr(obj({ ref: str, slug: str, title: str })),
        children: arr(PRONI_CHILD),
      })),
      v('roots', {}, 'The top-level fonds', obj({ roots: arr(PRONI_CHILD), count: int })),
    ],
  },
  'proni/search': {
    errors: ERROR,
    variants: [v('results', {}, 'A page of matches (one more than limit, to show there is a next page)', obj({ query: str, results: arr(PRONI_ROW), count: int }))],
  },
  'proni/count': {
    errors: ERROR,
    variants: [v('count', {}, 'How many records match (exact when known)', obj({ count: either('integer', 'null'), exact: bool }))],
  },
  'proni/export': {
    errors: null,
    variants: [{ name: 'csv', when: {}, summary: 'Every match as CSV, streamed', contentType: 'text/csv' }],
  },
});

/** Does one `path` pattern match the segments after a catch-all route? */
function pathMatches(/** @type {string} */ pattern, /** @type {string[]} */ rest) {
  const want = pattern ? pattern.split('/') : [];
  return want.length === rest.length && want.every((w, i) => (/^<.+>$/.test(w) ? rest[i] !== '' : w === rest[i]));
}

/**
 * The variant of a route that answers a request: the first whose `when` matches.
 * @param {string} route        a v1 route key
 * @param {URL|string} url      the request URL (its query is what matters)
 * @param {string[]} [rest]     a catch-all route's segments after it
 * @returns {Variant|null}
 */
export function variantFor(route, url, rest = []) {
  const contract = CONTRACTS[route];
  if (!contract) return null;
  const params = new URL(String(url), 'https://civgraph.net').searchParams;
  return contract.variants.find(({ when }) => Object.entries(when).every(([key, want]) => {
    if (key === 'path') return pathMatches(want, rest);
    const got = (params.get(key) || '').trim();
    if (want === '*') return got !== '';
    return got === want;
  })) || null;
}
