/**
 * A person's career across bodies (el-places, 14 Nov 2026): their candidacies (the persons API's
 * view=candidacies, from the candidacies table the area pages also read), each with its share
 * from the person's record, and the other people Civgraph holds under the same name. Pure:
 * the unit test elections-app-places.test.mjs.
 */
import { candidateReturnWithoutPoll } from '../../../pkg/core/src/unopposed.mjs';
import { foldText } from './search.js';

/** @typedef {import('./api.js').PersonCandidaciesAnswer['candidacies'][number]} Candidacy */
/** @typedef {import('./api.js').PersonRecordAnswer['person']} PersonRecord */
/** @typedef {import('./api.js').PersonCard} PersonCard */

/**
 * @typedef {object} CareerRow
 * @property {string} date
 * @property {string} electionKey
 * @property {string} electionTitle
 * @property {string} body
 * @property {string} contest
 * @property {string} contestSlug
 * @property {string} party
 * @property {string | null} colour  the party's colour as the candidacy records it
 * @property {number | null} votes
 * @property {number | null} share
 * @property {'elected' | 'unopposed' | 'auto-returned' | 'not-elected'} outcome
 */

/**
 * The person's candidacies, oldest first, with the share the record gives each.
 * @param {Candidacy[]} candidacies
 * @param {PersonRecord['elections']} [recordElections]
 * @returns {CareerRow[]}
 */
export function careerRows(candidacies, recordElections = []) {
  /** @type {Map<string, number | null>} */
  const shares = new Map();
  for (const e of recordElections || []) shares.set(`${e.key}|${foldText(e.constituency)}`, typeof e.share === 'number' ? e.share : null);
  return candidacies.map((c) => {
    const without = candidateReturnWithoutPoll(/** @type {Record<string, unknown>} */ (c));
    const votes = typeof c.firstPrefs === 'number' ? c.firstPrefs : null;
    return {
      date: c.date,
      electionKey: c.electionKey,
      electionTitle: String(c.electionTitle || c.electionKey),
      body: String(c.body || ''),
      contest: c.contest,
      contestSlug: String(c.contestSlug || ''),
      party: String(c.party || ''),
      colour: typeof c.colour === 'string' ? c.colour : null,
      votes,
      share: shares.get(`${c.electionKey}|${foldText(c.contest)}`) ?? null,
      outcome: /** @type {CareerRow['outcome']} */ (without || (c.elected ? 'elected' : 'not-elected')),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The career in figures: how many candidacies, how many won, the years and the bodies.
 * @param {CareerRow[]} rows
 */
export function careerSummary(rows) {
  const years = rows.map((r) => Number(r.date.slice(0, 4))).filter(Number.isFinite);
  return {
    stood: rows.length,
    elected: rows.filter((r) => r.outcome !== 'not-elected').length,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    bodies: [...new Set(rows.map((r) => r.body).filter(Boolean))],
  };
}

/**
 * The other people Civgraph holds under exactly this name (folded): the persons data keeps
 * people who share a name apart, each with their own record.
 * @param {PersonCard[]} found  a name search's answer
 * @param {{ slug: string, title: string }} self
 */
export function namesakes(found, self) {
  const name = foldText(self.title);
  return found.filter((p) => p.slug !== self.slug && foldText(p.title || p.name) === name);
}
