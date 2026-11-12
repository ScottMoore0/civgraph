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
  const qs = new URLSearchParams(/** @type {[string, string][]} */ (Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))).toString();
  const url = qs ? `${API}?${qs}` : API;
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
