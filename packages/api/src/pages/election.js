/**
 * The data of one server-rendered election page (data design stage D.8, frontend-plan F3b): the
 * loader the election templates (packages/ui/src/templates/records/election.js) render from. It
 * reads D1 once per page; templates never query (PKG-1 moved it here from the template module).
 */
import { parseJson, withoutMarkers } from '../handlers/_records.js';
import { asStore } from '../../../storage/src/d1.js';
import { ELECTION_PAGES } from '../queries/pages.js';

/** Everything one election page needs, or null. `meta` is lookupElection's answer for the slug. */
export async function loadElectionPage(source, meta) {
  if (!meta?.electionKey) return null;
  const db = asStore(source);
  const e = await db.first(ELECTION_PAGES.election, [meta.electionKey]);
  if (!e) return null;
  const election = { ...e, meta: withoutMarkers(parseJson(e.meta, {})) };
  if (Number.isInteger(meta.contestSeq)) {
    const [contest, candidates] = await Promise.all([
      db.first(ELECTION_PAGES.contest, [e.key, meta.contestSeq]),
      db.all(ELECTION_PAGES.candidates, [e.key, meta.contestSeq]),
    ]);
    const provenance = contest?.sourceFile
      ? await db.all(ELECTION_PAGES.citations, [String(contest.sourceFile).replace(/^data\/elections-source\/data\/elections\//, '')])
      : [];
    return { kind: 'contest', election, contest, candidates, citations: provenance };
  }
  const contests = await db.all(ELECTION_PAGES.contests, [e.key]);
  return { kind: /-overall-results$/.test(meta.slug) ? 'overall' : 'election', election, contests };
}
