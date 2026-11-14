/**
 * The Elections app's reads of the records API. The app calls /_api/elections, the alias the
 * site's own pages use (packages/api/src/v1/v1.js: /_api stays for good; /api/v1 runs the same
 * handlers). Answers are cached for the page's life. Pivot tables never come through here: they
 * read the build-time extracts (lib/duck.js), never live D1.
 *
 * The answer types are generated from the v1 contracts (packages/api/src/v1/contracts/v1.js ->
 * packages/types/generated/api-v1.d.ts, npm run build:types), not written here: what the app
 * reads is what the contract promises (tests/functions/api-v1-contracts.test.mjs holds it).
 *
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsIndexAnswer} IndexAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsIndexOfBodyAnswer} IndexOfBodyAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsDetailAnswer} DetailAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsSummaryAnswer} SummaryAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsContestsAnswer} ContestsAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsContestBySlugAnswer} ContestAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsCitationsContestAnswer} CitationsAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsProvenanceAnswer} ProvenanceAnswer
 * @typedef {IndexAnswer['elections'][number]} ElectionRow    one election of the index
 * @typedef {DetailAnswer['item']} ElectionDetail             an election's Browse detail item
 * @typedef {NonNullable<ElectionDetail['partySummary']>[number]} PartyRow
 * @typedef {SummaryAnswer['results'][number]} SummaryRow    one contest's row of an election summary
 * @typedef {CitationsAnswer['citations'][number]} Citation  one original source of a contest
 */

const API = '/_api/elections';
/** @type {Map<string, Promise<unknown>>} */
const cache = new Map();

/** GET a JSON answer of the elections API, once per URL. */
/** @param {Record<string, string | number | null | undefined>} params @returns {Promise<unknown>} */
export function getJson(params) {
  return fetchOnce(API, params);
}

/** GET a JSON answer of a records route, once per URL (the cache above). */
/** @param {string} base @param {Record<string, string | number | null | undefined>} params @returns {Promise<unknown>} */
function fetchOnce(base, params) {
  const qs = new URLSearchParams(/** @type {[string, string][]} */ (Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))).toString();
  const url = qs ? `${base}?${qs}` : base;
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { headers: { Accept: 'application/json' } }).then(async (res) => {
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { status: res.status });
      return res.json();
    }).catch((err) => { cache.delete(url); throw err; }));
  }
  return /** @type {Promise<unknown>} */ (cache.get(url));
}

/**
 * A value, or a 404 error (the app shell shows "Not found").
 * @template T
 * @param {T | null | undefined} value
 * @param {string} what
 * @returns {T}
 */
export function must(value, what) {
  if (value === null || value === undefined) throw Object.assign(new Error(`${what} not found`), { status: 404 });
  return value;
}

/** Every election (key, body, bodySlug, displayTitle, kind, votingSystem, contestStatus, date, year, layerId, ...). @returns {Promise<ElectionRow[]>} */
export const electionIndex = () => getJson({}).then((j) => /** @type {IndexAnswer} */ (j).elections || []);
/** One body's elections, the same columns (much smaller than the whole index). @returns {Promise<ElectionRow[]>} */
export const bodyElections = (/** @type {string} */ bodySlug) => getJson({ body: bodySlug }).then((j) => /** @type {IndexOfBodyAnswer} */ (j).elections || []);
/** One election's Browse detail item: partySummary, totals, previousKey, resultEntries, references. @returns {Promise<ElectionDetail>} */
export const electionDetail = (/** @type {string} */ key) => getJson({ view: 'detail', key }).then((j) => /** @type {DetailAnswer} */ (j).item);
/** One election's summary: a results row per contest (winner, leading candidate, turnout, seats, valid poll). @returns {Promise<SummaryAnswer>} */
export const electionSummary = (/** @type {string} */ key) => /** @type {Promise<SummaryAnswer>} */ (getJson({ view: 'summary', key }));
/** One election's contests as Browse items (each with its map feature: featureName, matched). @returns {Promise<ContestsAnswer>} */
export const electionContests = (/** @type {string} */ key) => /** @type {Promise<ContestsAnswer>} */ (getJson({ view: 'contests', key }));
/** One contest with candidates (counts in each), count rows and the feature match. @returns {Promise<ContestAnswer>} */
export const contestResult = (/** @type {string} */ key, /** @type {string} */ contestSlug) => /** @type {Promise<ContestAnswer>} */ (getJson({ key, contest: contestSlug }));
/**
 * One contest's citations (view=citations&key=&constituency=<seq>, the original sources of QA H5),
 * each with title, publisher, url, archiveUrl, kind, basis, checked (0/1), scope, match and
 * checkNote (which figures the source was checked for).
 * @returns {Promise<CitationsAnswer>}
 */
export const contestCitations = (/** @type {string} */ key, /** @type {number} */ seq) => /** @type {Promise<CitationsAnswer>} */ (getJson({ view: 'citations', key, constituency: seq }));
/** One election's provenance shard (status and primary source per contest). @returns {Promise<ProvenanceAnswer>} */
export const electionProvenance = (/** @type {string} */ key) => /** @type {Promise<ProvenanceAnswer>} */ (getJson({ view: 'provenance', key }));
/**
 * One election's bundle without its count groups (format=bundle&lite=1, the bundle variant of v1):
 * every contest with its candidates, their first preferences, whether elected and their totals at
 * each count, and the contest's valid poll, ballots cast and spoilt ballots. The results map reads
 * it (lib/map-modes.js bundleAreas); v1 promises its top level, and the contests are typed by
 * core's ContestResult.
 * @returns {Promise<ApiV1Bundle>}
 */
export const electionBundle = (/** @type {string} */ key) => /** @type {Promise<ApiV1Bundle>} */ (getJson({ key, format: 'bundle', lite: 1 }));
/**
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsBundleAnswer
 *   & { results?: import('../../../pkg/core/src/election-domain.mjs').ContestResult[] }} ApiV1Bundle
 */

/** el-context (14 Nov 2026): the static files of the census context and the widget's licences. */
/** @type {Map<string, Promise<unknown>>} */
const files = new Map();
/**
 * A static JSON file of the app, once per page (not the records API: the census figures and the
 * widget's licences are build outputs committed with the app).
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export function appFile(path) {
  if (!files.has(path)) {
    files.set(path, fetch(path, { headers: { Accept: 'application/json' } }).then(async (res) => {
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${path}`), { status: res.status });
      return res.json();
    }).catch((err) => { files.delete(path); throw err; }));
  }
  return /** @type {Promise<unknown>} */ (files.get(path));
}
/** The census figures of the area context (census/ni-areas.json, scripts/build/elections-app/census-context.mjs). */
export const censusAreas = () => appFile('/apps/elections/census/ni-areas.json');
/** The licences the widget names (embed/licences.json, scripts/build/elections-app/embed-licences.mjs). */
export const embedLicences = () => appFile('/apps/elections/embed/licences.json');

// ------------------------------------------------------------------ places, people and parties
// (el-places, 14 Nov 2026): the area pages, the search, the person page and the party links. The
// persons and parties answers come from their own routes of the same records API.

/**
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsAreaIndexAnswer} AreaIndexAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.ElectionsAreaHistoryAnswer} AreaHistoryAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.PersonsListAnswer} PersonsListAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.PersonsRecordAnswer} PersonRecordAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.PersonsCandidaciesAnswer} PersonCandidaciesAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.PartiesListAnswer} PartiesListAnswer
 * @typedef {import('../../../packages/types/index.js').ApiV1.PartiesNamesAnswer} PartyNamesAnswer
 * @typedef {AreaIndexAnswer['areas'][number]} AreaRow           one place of the area index
 * @typedef {AreaHistoryAnswer['contests'][number]} AreaContest  one contest of an area's history
 * @typedef {AreaContest['candidates'][number]} AreaCandidate
 * @typedef {PersonsListAnswer['persons'][number]} PersonCard
 * @typedef {PartiesListAnswer['items'][number]} PartyCard
 */

/** A records route other than elections (persons, parties), read the same way. */
/** @param {'persons' | 'parties'} route @param {Record<string, string | number | null | undefined>} params */
const getRoute = (route, params) => fetchOnce(`/_api/${route}`, params);

/** Every place contests were held: a contest slug within a body (the place search). @returns {Promise<AreaRow[]>} */
export const areaIndex = () => getJson({ view: 'area-index' }).then((j) => /** @type {AreaIndexAnswer} */ (j).areas || []);
/** Every contest held under one contest slug, in every body, oldest first, with candidates. @returns {Promise<AreaHistoryAnswer>} */
export const areaHistory = (/** @type {string} */ slug) => /** @type {Promise<AreaHistoryAnswer>} */ (getJson({ view: 'area-history', slug }));
/** People whose record matches the words (the persons API folds accents), most seats won first. @returns {Promise<PersonCard[]>} */
export const personSearch = (/** @type {string} */ q, limit = 40) => getRoute('persons', { q, limit, sort: 'elected' }).then((j) => /** @type {PersonsListAnswer} */ (j).persons || []);
/** One person's record (the Browse card: parties, elections with shares, relatives). @returns {Promise<PersonRecordAnswer>} */
export const personRecord = (/** @type {string} */ slug) => /** @type {Promise<PersonRecordAnswer>} */ (getRoute('persons', { slug }));
/** Every candidacy of one person, in date order, with its contest's slug. @returns {Promise<PersonCandidaciesAnswer>} */
export const personCandidacies = (/** @type {string} */ slug) => /** @type {Promise<PersonCandidaciesAnswer>} */ (getRoute('persons', { slug, view: 'candidacies' }));
/** Every party (about 600). @returns {Promise<PartyCard[]>} */
export const partyList = () => getRoute('parties', {}).then((j) => /** @type {PartiesListAnswer} */ (j).items || []);
/** Every name a party is known by, folded, to its slug (about 40 KB). @returns {Promise<Record<string, string>>} */
export const partyNames = () => getRoute('parties', { view: 'names' }).then((j) => /** @type {PartyNamesAnswer} */ (j).items || {});
