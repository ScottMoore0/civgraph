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

/**
 * @typedef {{ key: string, body: string, bodySlug: string, displayTitle: string, kind?: string | null, contestType?: string | null,
 *   votingSystem?: string | null, contestStatus?: string | null, date: string, year?: number | null, layerId?: string | null }} ElectionRow
 * @typedef {{ party: string, seats: number, stood: number, votes: number, share: number, colour: string }} PartyRow
 * @typedef {{ key: string, title: string, body: string, bodySlug: string, date: string, kind?: string | null, contestType?: string | null,
 *   votingSystem?: string | null, contestStatus?: string | null, previousKey?: string | null, partySummary?: PartyRow[],
 *   totals?: { seats?: number, validPoll?: number }, resultEntries?: Array<{ key?: string, resultName?: string, resultKind?: string }>,
 *   references?: Array<{ label: string, url: string, note?: string }>, interactiveUrl?: string | null, layerId?: string | null }} ElectionDetail
 * @typedef {{ constituency: string, seatsTotal?: number, seatsWon?: number, validPoll?: number | null, quota?: number | null,
 *   winnerParty?: string | null, winnerName?: string | null, leadingParty?: string | null, leadingName?: string | null,
 *   leadingVotes?: number | null, turnoutPct?: number | null, majority?: number | null, candidateCount?: number, featureName?: string | null }} SummaryRow
 */

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
export const electionIndex = () => getJson({}).then((j) => j.elections || []);
/** One body's elections, the same columns (much smaller than the whole index). */
export const bodyElections = (/** @type {string} */ bodySlug) => /** @type {Promise<ElectionRow[]>} */ (getJson({ body: bodySlug }).then((j) => j.elections || []));
/** One election's Browse detail item: partySummary, totals, previousKey, resultEntries, references. */
export const electionDetail = (/** @type {string} */ key) => /** @type {Promise<ElectionDetail>} */ (getJson({ view: 'detail', key }).then((j) => j.item));
/** One election's summary: a results row per contest (winner, leading candidate, turnout, seats, valid poll). */
export const electionSummary = (/** @type {string} */ key) => /** @type {Promise<{ results?: SummaryRow[] }>} */ (getJson({ view: 'summary', key }));
/** One election's contests as Browse items (each with its map feature: featureName, matched). */
export const electionContests = (/** @type {string} */ key) => getJson({ view: 'contests', key });
/** One contest with candidates (counts in each), count rows and the feature match. */
export const contestResult = (/** @type {string} */ key, /** @type {string} */ contestSlug) => getJson({ key, contest: contestSlug });
/**
 * One contest's citations (view=citations&key=&constituency=<seq>, the original sources of QA H5),
 * each with title, publisher, url, archiveUrl, kind, basis, checked (0/1), scope, match and
 * checkNote (which figures the source was checked for).
 */
export const contestCitations = (/** @type {string} */ key, /** @type {number} */ seq) => getJson({ view: 'citations', key, constituency: seq });
/** One election's provenance shard (status and primary source per contest). */
export const electionProvenance = (/** @type {string} */ key) => getJson({ view: 'provenance', key });
