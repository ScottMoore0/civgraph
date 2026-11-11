/**
 * Results by area: one national contest's figures broken down by the areas the votes were counted
 * in (the presidential elections by Dáil constituency, data/elections/president-constituency-results).
 * An area result is a breakdown of the national candidacies, never a candidacy of its own: its
 * candidates carry the national candidate's id (nationalCandidateId) and no person id, and the
 * manifest files the areas as a geography mode of the election (dataKind 'area-results'), which the
 * person scripts and the records tables of candidacies never read.
 *
 * Pure: scripts/build/build-test2-election-manifest.mjs reads the files and summarises the count
 * sheets these functions make with election-domain's summarizeResult, as it does every contest.
 */

/**
 * One staged area file (data/elections/<dir>/<date>/<area>.json).
 * @typedef {object} AreaFile
 * @property {string} constituency
 * @property {{ sourceMapId?: string, feature?: string | null, features?: string[] }} [map]
 * @property {{ electorate?: number | null, total_poll?: number | null, spoiled?: number | null, valid_poll?: number | null, turnout_pct?: number | null }} [meta]
 * @property {Array<{ name: string, party?: string, counts: Array<number | null> }>} candidates
 * @property {Array<number | null>} [non_transferable]  cumulative, by count (null at the first)
 * @property {string} [note]
 * @property {unknown} [erratum]
 * @property {Array<{ label: string, url?: string, note?: string }>} [references]
 */

/**
 * The national candidate an area's candidate is a breakdown of.
 * @typedef {{ id: string, name: string, party: string, colour: string }} NationalCandidate
 */

/** Colours for candidates whose party gives none of their own, in the order they are handed out. */
export const CANDIDATE_PALETTE = Object.freeze([
  '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2', '#bcbd22', '#393b79', '#637939', '#843c39'
]);

/** Party labels that say nothing about who a candidate is (several stand under each). */
const SHARED_LABELS = /^(independent|non[- ]?party|no label|)$/i;
const GREY = /^#?(6b7280|9ca3af|b8b8b8|b0bec5|808080|999999|cccccc|d1d5db)$/i;

/**
 * A distinct colour for each national candidate, for a map coloured by who led in each area: the
 * party's colour where the candidate's party has one no other candidate already took, otherwise the
 * next palette colour. In national order (the winner first), so the colours are stable.
 * @param {NationalCandidate[]} candidates
 * @returns {Map<string, string>} candidate id -> colour
 */
export function areaCandidateColours(candidates) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const used = new Set();
  let next = 0;
  const fresh = () => {
    while (next < CANDIDATE_PALETTE.length && used.has(CANDIDATE_PALETTE[next])) next += 1;
    return CANDIDATE_PALETTE[next++ % CANDIDATE_PALETTE.length];
  };
  for (const candidate of candidates) {
    const own = String(candidate.colour || '').toLowerCase();
    const colour = own && !GREY.test(own) && !SHARED_LABELS.test(String(candidate.party || '').trim()) && !used.has(own) ? own : fresh();
    used.add(colour);
    out.set(String(candidate.id), colour);
  }
  return out;
}

/**
 * The last count a candidate has a figure at (1-based), or 0.
 * @param {Array<number | null>} counts
 */
function lastCount(counts) {
  let last = 0;
  counts.forEach((value, index) => { if (value !== null && value !== undefined) last = index + 1; });
  return last;
}

/**
 * An area file as a count sheet (the Constituency.countInfo / countGroup shape every contest file
 * has), for summarizeResult. Nobody is elected in an area; a candidate with no figure at the last
 * count was excluded after the last count they have. Each candidate takes the national candidate's
 * id, party and the map colour given.
 * @param {AreaFile} area
 * @param {(name: string) => NationalCandidate | null | undefined} nationalFor
 * @param {Map<string, string>} colours  national candidate id -> colour
 * @returns {{ constituency: string, Constituency: { countInfo: Record<string, string>, countGroup: Array<Record<string, string | number>> }, unmatchedCandidates: string[] }}
 */
export function areaCountSheet(area, nationalFor, colours) {
  const numCounts = Math.max(1, ...area.candidates.map((c) => c.counts.length));
  /** @type {Array<Record<string, string | number>>} */
  const countGroup = [];
  /** @type {string[]} */
  const unmatchedCandidates = [];
  let row = 0;
  area.candidates.forEach((candidate, index) => {
    const national = nationalFor(candidate.name);
    if (!national) unmatchedCandidates.push(candidate.name);
    const id = national ? String(national.id) : `area-${index + 1}`;
    const last = lastCount(candidate.counts);
    const excluded = last > 0 && last < numCounts;
    const [firstname, ...rest] = String(candidate.name).split(' ');
    let previous = null;
    for (let i = 0; i < numCounts; i += 1) {
      const total = candidate.counts[i];
      if (total === null || total === undefined) continue;
      countGroup.push({
        Candidate_Id: id,
        Candidate_First_Pref_Votes: String(candidate.counts[0] ?? ''),
        Count_Number: String(i + 1),
        Firstname: firstname,
        Surname: rest.join(' '),
        candidateName: national?.name || candidate.name,
        Party_Name: national?.party || candidate.party || '',
        Party_Colour: colours.get(id) || national?.colour || '',
        Status: excluded ? 'Excluded' : '',
        Occurred_On_Count: excluded ? String(last + 1) : '',
        Total_Votes: String(total),
        Transfers: String(i === 0 || previous === null ? 0 : total - previous),
        id: row++
      });
      previous = total;
    }
  });
  let previousNt = 0;
  (area.non_transferable || []).forEach((value, i) => {
    if (value === null || value === undefined) return;
    countGroup.push({
      Candidate_Id: '', Count_Number: String(i + 1), Firstname: '', Surname: '', candidateName: 'Non-transferable',
      Party_Name: '', Party_Colour: '', Status: '', Occurred_On_Count: '',
      Total_Votes: String(value), Transfers: String(value - previousNt), id: row++
    });
    previousNt = value;
  });
  const meta = area.meta || {};
  const text = (/** @type {unknown} */ v) => (v === null || v === undefined ? '' : String(v));
  return {
    constituency: area.constituency,
    Constituency: {
      countInfo: {
        Constituency_Name: area.constituency,
        Constituency_Number: '',
        Number_Of_Seats: '',
        Quota: '',
        Spoiled: text(meta.spoiled),
        Total_Electorate: text(meta.electorate),
        Total_Poll: text(meta.total_poll),
        Turnout_Pct: text(meta.turnout_pct),
        Valid_Poll: text(meta.valid_poll)
      },
      countGroup
    },
    unmatchedCandidates
  };
}

/**
 * The features of its map an area names: one, or (an area whose later counts were reported for two
 * together) several.
 * @param {AreaFile} area
 * @returns {string[]}
 */
export function areaFeatureNames(area) {
  if (area.map?.feature) return [area.map.feature];
  return Array.isArray(area.map?.features) ? area.map.features.filter(Boolean) : [];
}

/**
 * One election's results by area as the API's view=areas answers them (packages/api/src/handlers/
 * elections/index.js): the area geography's facts, the national candidates (each the one candidacy
 * a person has in the election, with its person id) and, per area, every candidate's figure at each
 * count. An area's candidate is named by the national candidate's id.
 * @param {{ key: string, displayTitle?: string | null, body?: string | null, date?: string | null }} election
 * @param {Array<Record<string, any>> | null | undefined} modes  the bundle's geographyModes
 * @param {Array<{ id: unknown, name: unknown, party: unknown, personId: unknown, colour?: unknown }>} nationalCandidates  the national contest's candidacies
 */
export function areaResultsAnswer(election, modes, nationalCandidates) {
  const mode = (modes || []).find((m) => m?.dataKind === 'area-results') || null;
  const base = { key: election.key, title: election.displayTitle || null, body: election.body || null, date: election.date || null };
  if (!mode) return { ...base, areaLabel: null, areas: [] };
  const colourById = new Map();
  for (const result of mode.results || []) for (const c of result.candidates || []) if (!colourById.has(String(c.id))) colourById.set(String(c.id), c.colour);
  const numCounts = Number(mode.numCounts) || Math.max(1, ...(mode.results || []).flatMap((r) => r.countNumbers || [1]));
  const slug = (/** @type {unknown} */ v) => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    ...base,
    areaLabel: mode.label || null,
    countingBasis: mode.countingBasis || null,
    sourceMapId: mode.sourceMapId || null,
    numCounts,
    note: mode.note || null,
    references: mode.references || [],
    candidates: nationalCandidates.map((c) => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      party: c.party == null ? null : String(c.party),
      personId: c.personId == null || c.personId === '' ? null : String(c.personId),
      colour: colourById.get(String(c.id)) || (c.colour == null ? null : String(c.colour)),
    })),
    areas: (mode.results || []).map((/** @type {Record<string, any>} */ r) => ({
      name: String(r.constituency || ''),
      slug: slug(r.constituency),
      featureName: r.featureName || null,
      matched: Boolean(r.matched),
      ...(Array.isArray(r.reportedFor) ? { reportedFor: r.reportedFor } : {}),
      electorate: r.electorate ?? null,
      totalPoll: r.totalPoll ?? null,
      spoiled: r.spoiled ?? null,
      validPoll: r.validPoll ?? null,
      turnoutPct: r.turnoutPct ?? null,
      leadingName: r.leadingName || null,
      leadingPct: r.leadingPct ?? null,
      notes: (r.contestNotes || []).map((/** @type {{ text?: string }} */ n) => n.text).filter(Boolean),
      references: r.references || [],
      candidates: (r.candidates || []).map((/** @type {Record<string, any>} */ c) => {
        /** @type {Array<number | null>} */
        const counts = Array.from({ length: numCounts }, () => null);
        for (const count of c.counts || []) if (count?.count >= 1 && count.count <= numCounts) counts[count.count - 1] = count.total ?? null;
        return {
          id: String(c.nationalCandidateId ?? c.id ?? ''),
          firstPrefs: c.firstPrefs ?? null,
          share: r.validPoll && c.firstPrefs != null ? Math.round((c.firstPrefs / r.validPoll) * 10000) / 100 : null,
          counts,
          excludedAt: c.excluded ? (c.decidedAt ?? c.excludedAt ?? null) : null,
        };
      }),
      nonTransferable: Array.from({ length: numCounts }, (_, i) => (r.nonTransferable || []).find((/** @type {{ count: number }} */ n) => n.count === i + 1)?.total ?? null),
    })),
  };
}
