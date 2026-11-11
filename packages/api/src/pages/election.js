/**
 * The data of one server-rendered election page (data design stage D.8, frontend-plan F3b): the
 * loader the election templates (packages/ui/src/templates/records/election.js) render from. It
 * reads D1 once per page; templates never query (PKG-1 moved it here from the template module).
 */
import { parseJson, withoutMarkers } from '../handlers/_records.js';
import { asStore } from '../../../storage/src/d1.js';
import { ELECTION_PAGES } from '../queries/pages.js';
import { ELECTIONS_API } from '../queries/elections.js';

/**
 * The rows the ELECTION_PAGES queries return (their SELECT lists, over RecordsDb's tables).
 * @typedef {import('../../../types/index.js').RecordsDb.RElectionsRow} RElectionsRow
 * @typedef {import('../../../types/index.js').RecordsDb.ContestsRow} ContestsRow
 * @typedef {import('../../../types/index.js').RecordsDb.CandidaciesRow} CandidaciesRow
 * @typedef {import('../../../types/index.js').RecordsDb.CitationsRow} CitationsRow
 * @typedef {Pick<RElectionsRow, 'key' | 'slug' | 'body' | 'date' | 'kind' | 'meta'> & { title: RElectionsRow['display_title'], votingSystem: RElectionsRow['voting_system'] }} ElectionPageRow
 * @typedef {{ description?: string, [key: string]: unknown }} ElectionPageMeta  r_elections.meta, parsed
 * @typedef {Omit<ElectionPageRow, 'meta'> & { meta: ElectionPageMeta }} ElectionPageElection
 *   the election, its meta parsed (loader markers dropped)
 * @typedef {Pick<ContestsRow, 'seq' | 'name' | 'slug' | 'electorate' | 'quota' | 'meta'> & { seatsTotal: ContestsRow['seats_total'], turnoutPct: ContestsRow['turnout_pct'], sourceFile: ContestsRow['source_file'] }} ElectionPageContest
 * @typedef {Pick<CandidaciesRow, 'ord' | 'name' | 'colour' | 'elected' | 'status'> & { personId: CandidaciesRow['person_id'], party: CandidaciesRow['party_label'], partyAsPrinted: CandidaciesRow['party_as_printed'], firstPrefs: CandidaciesRow['first_prefs'], finalVotes: CandidaciesRow['final_votes'] }} ElectionPageCandidate
 * @typedef {Pick<CitationsRow, 'title' | 'publisher' | 'url'> & { host?: CitationsRow['host'], kind?: CitationsRow['kind'] }} ElectionPageCitation
 * @typedef {ElectionPageCitation & { contests: number }} ElectionPageSource  an election's source, with how many of its contests cite it
 * @typedef {Pick<ContestsRow, 'seq' | 'name' | 'slug'> & { seatsTotal: ContestsRow['seats_total'], winnerParty: ContestsRow['winner_party'], winnerName: ContestsRow['winner_name'] }} ElectionPageContestItem
 * @typedef {{ kind: 'contest', election: ElectionPageElection, contest: ElectionPageContest, candidates: ElectionPageCandidate[], citations: ElectionPageCitation[] }
 *   | { kind: 'overall' | 'election', election: ElectionPageElection, contests: ElectionPageContestItem[], sources?: ElectionPageSource[] }} ElectionPage
 */

/**
 * Everything one election page needs, or null. `meta` is lookupElection's answer for the slug.
 * @param {import('../../../storage/src/store.js').RecordStore | D1Database} source
 * @param {{ slug: string, electionKey?: string | null, contestSeq?: number | null } | null | undefined} meta
 * @returns {Promise<ElectionPage | null>}
 */
export async function loadElectionPage(source, meta) {
  if (!meta?.electionKey) return null;
  const db = asStore(source);
  const e = /** @type {ElectionPageRow | null} */ (/** @type {unknown} */ (await db.first(ELECTION_PAGES.election, [meta.electionKey])));
  if (!e) return null;
  const election = { ...e, meta: /** @type {ElectionPageMeta} */ (withoutMarkers(parseJson(e.meta, {}))) };
  if (Number.isInteger(meta.contestSeq)) {
    // meta.contestSeq is the seq of a contest lookupElection found, so its row is there.
    const [contest, candidates] = /** @type {[ElectionPageContest, ElectionPageCandidate[]]} */ (/** @type {unknown} */ (await Promise.all([
      db.first(ELECTION_PAGES.contest, [e.key, meta.contestSeq]),
      db.all(ELECTION_PAGES.candidates, [e.key, meta.contestSeq]),
    ])));
    const provenance = /** @type {ElectionPageCitation[]} */ (contest?.sourceFile
      ? await db.all(ELECTION_PAGES.citations, [String(contest.sourceFile).replace(/^data\/elections-source\/data\/elections\//, '')])
      : []);
    return { kind: 'contest', election, contest, candidates, citations: provenance };
  }
  const [contests, sources] = /** @type {[ElectionPageContestItem[], ElectionPageSource[]]} */ (/** @type {unknown} */ (await Promise.all([
    db.all(ELECTION_PAGES.contests, [e.key]),
    // The original sources of the results (QA H5): each contest's citations, most cited first.
    db.all(ELECTIONS_API.electionCitations, [e.key]),
  ])));
  return { kind: /-overall-results$/.test(meta.slug) ? 'overall' : 'election', election, contests, sources };
}

/**
 * The citations of every contest a person stood in (QA H5), for the person page's Sources.
 * @param {import('../../../storage/src/store.js').RecordStore | D1Database} source
 * @param {string | number | null | undefined} personId
 * @returns {Promise<Array<{ electionKey: string, seq: number, constituency: string, citations: ElectionPageCitation[] }>>}
 */
export async function loadPersonContestSources(source, personId) {
  if (personId === null || personId === undefined || personId === '') return [];
  const rows = /** @type {Array<ElectionPageCitation & { electionKey: string, seq: number, constituency: string }>} */ (/** @type {unknown} */ (await asStore(source).all(ELECTIONS_API.personCitations, [String(personId)])));
  /** @type {Map<string, { electionKey: string, seq: number, constituency: string, citations: ElectionPageCitation[] }>} */
  const byContest = new Map();
  for (const { electionKey, seq, constituency, ...citation } of rows) {
    const id = `${electionKey}|${seq}`;
    if (!byContest.has(id)) byContest.set(id, { electionKey, seq, constituency, citations: [] });
    byContest.get(id)?.citations.push(citation);
  }
  return [...byContest.values()];
}
