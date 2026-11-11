/**
 * The Civgraph Elections app's data model at build time: pure functions over the records build's
 * rows (contests, candidacies, r_elections), shared by the Phase 0 audit and the pivot extracts
 * (scripts/build/elections-app/data.mjs). No I/O here; tests/unit/elections-app-model.test.mjs.
 *
 * Conventions read from the records (audit, 11 Nov 2026):
 * - an unopposed return is a candidacy whose status is "Elected unopposed" (the `unopposed`
 *   column is never filled), or any candidacy in an election whose contest_status is
 *   "uncontested" that has no votes;
 * - stage-by-stage counts are candidacies' meta.counts arrays; a contest "has stages" when any
 *   candidate has more than one count with a total;
 * - "No party recorded" is the explicit no-label marker; an empty label is the same;
 * - party ids (candidacies.party_id) are never filled: the party is the label, folded through
 *   party_label_map (lowercased label -> party slug).
 */

export const NO_PARTY = 'No party recorded';

/** @param {unknown} v */
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** @param {unknown} v */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {string | null | undefined} text
 * @returns {any}
 */
export function parseMeta(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

/** @param {{ status?: string | null }} cand */
export const isUnopposedStatus = (cand) => /unopposed/i.test(String(cand?.status || ''));

/**
 * A candidacy's first-preference votes, or null when there was no poll for it: an unopposed or
 * auto-returned row carries 0 in 252 older rows (packages/core/src/unopposed.mjs, QA H4).
 * @param {{ status?: string | null, first_prefs?: number | null }} cand
 */
export function votesOf(cand) {
  const v = num(cand?.first_prefs);
  if (!v && /unopposed|auto[- ]?returned/i.test(String(cand?.status || ''))) return null;
  return v;
}

/** @param {string | null | undefined} label */
export const hasPartyLabel = (label) => !!label && String(label).trim() !== '' && label !== NO_PARTY;

/**
 * Fold a ballot label the way party_label_map stores it (build-browse-indexes.mjs normalizeName:
 * accents dropped, lowercase, every run of non-alphanumerics one space).
 */
export const foldLabel = (/** @type {unknown} */ label) => String(label || '').replace(/\s+/g, ' ').trim()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The stages (count numbers) a candidacy's counts carry with a total.
 * @param {any} meta
 */
export function stagesOf(meta) {
  const counts = Array.isArray(meta?.counts) ? meta.counts : [];
  return counts.filter((/** @type {any} */ c) => isNum(num(c?.total))).length;
}

/**
 * Facts about one contest, from its row, parsed meta and candidacies.
 * @param {{ electorate?: number | null, turnout_pct?: number | null, quota?: number | null, seats_total?: number | null }} contest
 * @param {any} contestMeta
 * @param {Array<{ status?: string | null, first_prefs?: number | null, party_label?: string | null, person_id?: string | null, gender?: string | null, meta: any }>} cands
 * @param {{ contestStatus?: string | null, labelMap?: Map<string, string> }} [opts]
 */
export function contestFacts(contest, contestMeta, cands, opts = {}) {
  const labelMap = opts.labelMap || new Map();
  let stages = 0;
  let transfers = false;
  let order = false;
  let votes = false;
  let unopposedCands = 0;
  let labelled = 0;
  let linkedParty = 0;
  let persons = 0;
  let gender = 0;
  for (const c of cands) {
    const s = stagesOf(c.meta);
    if (s > stages) stages = s;
    // Transfers: a non-zero transfer field, or a total that changes between stages (some
    // sources give the running totals only).
    let prev = null;
    for (const k of (Array.isArray(c.meta?.counts) ? c.meta.counts : [])) {
      const t = num(k?.transfers);
      const total = num(k?.total);
      if (t !== null && t !== 0) transfers = true;
      if (prev !== null && total !== null && total !== prev) transfers = true;
      if (total !== null) prev = total;
    }
    if (votesOf(c) !== null) votes = true;
    if ((num(c.meta?.electedAt) || 0) > 1 || (num(c.meta?.excludedAt) || 0) > 1) order = true;
    if (isUnopposedStatus(c)) unopposedCands += 1;
    if (hasPartyLabel(c.party_label)) {
      labelled += 1;
      if (labelMap.has(foldLabel(c.party_label))) linkedParty += 1;
    }
    if (c.person_id) persons += 1;
    if (c.gender === 'M' || c.gender === 'F') gender += 1;
  }
  const n = cands.length;
  const unopposed = n > 0 && !votes
    && (unopposedCands > 0 || opts.contestStatus === 'uncontested');
  // A count padded to several stages with unchanged totals (the scraper-style "synthetic
  // stages" of some Irish sources) carries the order of election and exclusion, not stage
  // totals: it is one stage of figures here.
  if (!transfers) stages = Math.min(stages, 1);
  return {
    candidates: n,
    votes,
    stages,
    hasStages: stages > 1,
    transfers,
    order: order || stages > 1,
    electorate: isNum(num(contest.electorate)),
    turnout: isNum(num(contest.turnout_pct)),
    quota: isNum(num(contest.quota)),
    validPoll: isNum(num(contestMeta?.validPoll)),
    spoiled: isNum(num(contestMeta?.spoiled)),
    seats: isNum(num(contest.seats_total)),
    unopposed,
    labelled,
    linkedParty,
    persons,
    gender,
  };
}

/** The decade label ("1920s") of a year. */
export const decadeOf = (/** @type {number | null | undefined} */ year) => (isNum(year) ? `${Math.floor(Number(year) / 10) * 10}s` : 'undated');

/**
 * A fresh tally for the audit.
 * @returns {Tally}
 */
export function emptyTally() {
  return {
    elections: 0, byElections: 0, referendums: 0, withPrevious: 0, systems: {},
    contests: 0, withCandidates: 0, votes: 0, stages: 0, order: 0, transfers: 0, electorate: 0, turnout: 0,
    quota: 0, validPoll: 0, spoiled: 0, seats: 0, unopposed: 0,
    candidacies: 0, labelled: 0, linkedParty: 0, persons: 0, gender: 0,
    provenance: { verified: 0, cited: 0, recorded: 0, none: 0 },
  };
}
/**
 * @typedef {{
 *   elections: number, byElections: number, referendums: number, withPrevious: number, systems: Record<string, number>,
 *   contests: number, withCandidates: number, votes: number, stages: number, order: number, transfers: number,
 *   electorate: number, turnout: number, quota: number, validPoll: number, spoiled: number, seats: number, unopposed: number,
 *   candidacies: number, labelled: number, linkedParty: number, persons: number, gender: number,
 *   provenance: { verified: number, cited: number, recorded: number, none: number },
 * }} Tally
 */

/**
 * Add one election (its row) to a tally.
 * @param {Tally} t
 * @param {{ kind?: string | null, contest_type?: string | null, voting_system?: string | null, previous_key?: string | null }} el
 */
export function tallyElection(t, el) {
  t.elections += 1;
  if (el.kind === 'by-election') t.byElections += 1;
  if (el.contest_type && el.contest_type !== 'election') t.referendums += 1;
  if (el.previous_key) t.withPrevious += 1;
  const sys = el.voting_system || 'unknown';
  t.systems[sys] = (t.systems[sys] || 0) + 1;
}

/**
 * Add one contest's facts to a tally.
 * @param {Tally} t
 * @param {ReturnType<typeof contestFacts>} f
 * @param {string | null | undefined} provenanceStatus
 */
export function tallyContest(t, f, provenanceStatus) {
  t.contests += 1;
  if (f.candidates > 0) t.withCandidates += 1;
  for (const k of /** @type {const} */ (['votes', 'order', 'transfers', 'electorate', 'turnout', 'quota', 'validPoll', 'spoiled', 'seats', 'unopposed'])) {
    if (f[k]) t[k] += 1;
  }
  if (f.hasStages) t.stages += 1;
  t.candidacies += f.candidates;
  t.labelled += f.labelled;
  t.linkedParty += f.linkedParty;
  t.persons += f.persons;
  t.gender += f.gender;
  const p = /** @type {'verified' | 'cited' | 'recorded' | 'none'} */ (['verified', 'cited', 'recorded'].includes(String(provenanceStatus)) ? provenanceStatus : 'none');
  t.provenance[p] += 1;
}

/** A share as a whole percentage string ("—" for 0 of 0). */
export const pct = (/** @type {number} */ part, /** @type {number} */ whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '—');

// ------------------------------------------------------------------ pivot extract rows

/**
 * The columns of the pivot extract (one row per candidacy), in order. Dimensions first, then
 * measures. Kept in step with site/apps/elections/pivot.js FIELDS.
 */
export const EXTRACT_COLUMNS = Object.freeze([
  // dimensions
  'election_key', 'election_slug', 'election', 'body', 'body_slug', 'kind', 'voting_system', 'date', 'year', 'decade',
  'contest_seq', 'area', 'area_slug', 'candidate', 'person_id', 'party', 'party_slug', 'gender', 'incumbent',
  'outcome', 'unopposed',
  // measures
  'votes', 'share', 'final_votes', 'transfers_received', 'seats', 'stages', 'electorate', 'turnout_pct', 'quota', 'valid_poll',
]);

/**
 * The outcome of a candidacy in words: elected, elected unopposed, excluded, not elected.
 * @param {{ elected?: number | boolean | null, status?: string | null, excluded?: number | boolean | null }} c
 */
export function outcomeOf(c) {
  if (isUnopposedStatus(c)) return 'elected unopposed';
  if (c.elected === 1 || c.elected === true) return 'elected';
  if (c.excluded === 1 || c.excluded === true) return 'excluded';
  return 'not elected';
}

/**
 * Transfers a candidacy received over the count (positive transfers only), or null without stages.
 * @param {any} meta
 */
export function transfersReceived(meta) {
  const counts = Array.isArray(meta?.counts) ? meta.counts : [];
  if (counts.length < 2) return null;
  let sum = 0;
  let any = false;
  for (const c of counts) {
    const t = num(c?.transfers);
    if (t !== null) { any = true; if (t > 0) sum += t; }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

/**
 * One extract row per candidacy.
 * @param {{ key: string, slug: string, display_title?: string | null, body?: string | null, body_slug: string, kind?: string | null, voting_system?: string | null, date: string, year?: number | null }} el
 * @param {{ seq: number, name: string, slug: string, electorate?: number | null, turnout_pct?: number | null, quota?: number | null, meta: any }} contest
 * @param {{ name?: string | null, person_id?: string | null, party_label?: string | null, gender?: string | null, first_prefs?: number | null, final_votes?: number | null, elected?: number | null, excluded?: number | null, status?: string | null, meta: any }} c
 * @param {{ labelMap?: Map<string, string>, incumbents?: Set<string>, unopposed?: boolean, stages?: number }} [opts]
 */
export function extractRow(el, contest, c, opts = {}) {
  const labelMap = opts.labelMap || new Map();
  const party = hasPartyLabel(c.party_label) ? String(c.party_label) : NO_PARTY;
  const valid = num(contest.meta?.validPoll) ?? num(contest.meta?.totalVotes);
  const votes = votesOf(c);
  const share = votes !== null && valid ? Math.round((10000 * votes) / valid) / 100 : null;
  const elected = c.elected === 1 || isUnopposedStatus(c);
  return {
    election_key: el.key,
    election_slug: el.slug,
    election: el.display_title || el.key,
    body: el.body || el.body_slug,
    body_slug: el.body_slug,
    kind: el.kind || '',
    voting_system: el.voting_system || '',
    date: el.date,
    year: num(el.year) ?? num(String(el.date).slice(0, 4)),
    decade: decadeOf(num(el.year) ?? num(String(el.date).slice(0, 4))),
    contest_seq: contest.seq,
    area: contest.name,
    area_slug: contest.slug,
    candidate: c.name || '',
    person_id: c.person_id || null,
    party,
    party_slug: labelMap.get(foldLabel(party)) || null,
    gender: c.gender === 'M' || c.gender === 'F' ? c.gender : null,
    incumbent: c.person_id && opts.incumbents ? opts.incumbents.has(String(c.person_id)) : null,
    outcome: outcomeOf(c),
    unopposed: !!opts.unopposed,
    votes,
    share,
    final_votes: num(c.final_votes),
    transfers_received: transfersReceived(c.meta),
    seats: elected ? 1 : 0,
    stages: opts.stages ?? stagesOf(c.meta),
    electorate: num(contest.electorate),
    turnout_pct: num(contest.turnout_pct),
    quota: num(contest.quota),
    valid_poll: valid,
  };
}

/**
 * The person ids elected at an election (for the incumbency of the next one).
 * @param {Array<{ person_id?: string | null, elected?: number | null, status?: string | null }>} cands
 */
export function electedPersons(cands) {
  const out = new Set();
  for (const c of cands) if (c.person_id && (c.elected === 1 || isUnopposedStatus(c))) out.add(String(c.person_id));
  return out;
}

/** CSV text of rows over columns (RFC 4180 quoting; null -> empty). */
export function toCsv(/** @type {string[]} */ columns, /** @type {Array<Record<string, unknown>>} */ rows) {
  const cell = (/** @type {unknown} */ v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
