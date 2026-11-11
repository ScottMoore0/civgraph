/**
 * The Elections app's reads of the records API. The app calls /_api/elections, the alias the
 * site's own pages use (packages/api/src/v1/v1.js: /_api stays for good; /api/v1 runs the same
 * handlers). Answers are cached for the page's life. Pivot tables never come through here: they
 * read the build-time extracts (lib/pivot-data.js), never live D1.
 */

const API = '/_api/elections';
/** @type {Map<string, Promise<any>>} */
const cache = new Map();

/** GET a JSON answer of the elections API, once per URL. */
/** @param {Record<string, string | number | null | undefined>} params @returns {Promise<any>} */
export function getJson(params) {
  const qs = new URLSearchParams(/** @type {[string, string][]} */ (Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))).toString();
  const url = qs ? `${API}?${qs}` : API;
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { headers: { Accept: 'application/json' } }).then(async (res) => {
      if (!res.ok) {
        const err = new Error(`${res.status} ${url}`);
        /** @type {any} */ (err).status = res.status;
        throw err;
      }
      return res.json();
    }).catch((err) => { cache.delete(url); throw err; }));
  }
  return /** @type {Promise<any>} */ (cache.get(url));
}

/** Every election (key, body, bodySlug, displayTitle, kind, votingSystem, contestStatus, date, year, layerId, ...). */
export const electionIndex = () => getJson({}).then((j) => j.elections || []);
/** One body's elections, the same columns (much smaller than the whole index). */
export const bodyElections = (/** @type {string} */ bodySlug) => getJson({ body: bodySlug }).then((j) => j.elections || []);
/** One election's Browse detail item: partySummary, totals, previousKey, resultEntries, references. */
export const electionDetail = (/** @type {string} */ key) => getJson({ view: 'detail', key }).then((j) => j.item);
/** One election's summary: a results row per contest (winner, leading candidate, turnout, seats, valid poll). */
export const electionSummary = (/** @type {string} */ key) => getJson({ view: 'summary', key });
/** One contest with candidates (counts in each), count rows and the feature match. */
export const contestResult = (/** @type {string} */ key, /** @type {string} */ contestSlug) => getJson({ key, contest: contestSlug });
/** One contest's citations. */
export const contestCitations = (/** @type {string} */ key, /** @type {string} */ contestSlug) => getJson({ view: 'citations', key, contest: contestSlug });
/** One election's provenance shard (status and primary source per contest). */
export const electionProvenance = (/** @type {string} */ key) => getJson({ view: 'provenance', key });
