/**
 * Colour scales and the per-area data of the map views. Pure: tests/unit/elections-app-lib.test.mjs.
 * Sequential: one hue, light to dark (turnout, a party's share). Diverging: two hues around a
 * neutral midpoint (swing). Both are checked by eye in the light and dark themes; every map also
 * has the figures as a table.
 */

const SEQ = ['#eef4fb', '#c9dcf0', '#9cc0e3', '#6a9fd2', '#3e7cbd', '#1f5a9c', '#0d3b6e'];
const DIV_NEG = ['#7a1f1f', '#b3412f', '#de7a5b', '#f3bfa8'];
const DIV_POS = ['#b6d7ee', '#6fa8d6', '#2f73b3', '#163f73'];
const MID = '#efefef';

/**
 * A sequential colour for v in [min, max], in SEQ.length steps.
 * @param {number | null} v @param {number} min @param {number} max
 */
export function sequential(v, min, max) {
  if (v === null || !Number.isFinite(v)) return null;
  const t = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0.5;
  return SEQ[Math.min(SEQ.length - 1, Math.floor(t * SEQ.length))];
}

/**
 * A diverging colour for v around 0, saturating at ±limit.
 * @param {number | null} v @param {number} limit
 */
export function diverging(v, limit) {
  if (v === null || !Number.isFinite(v)) return null;
  if (Math.abs(v) < limit / 20) return MID;
  const t = Math.min(1, Math.abs(v) / limit);
  const i = Math.min(3, Math.floor(t * 4));
  return v < 0 ? DIV_NEG[3 - i] : DIV_POS[i];
}

/** Legend stops of a sequential scale: [{ colour, label }]. */
export function sequentialLegend(/** @type {number} */ min, /** @type {number} */ max, /** @type {(v: number) => string} */ fmt) {
  return SEQ.map((colour, i) => ({ colour, label: fmt(min + ((max - min) * (i + 0.5)) / SEQ.length) }));
}

/** Legend stops of a diverging scale. */
export function divergingLegend(/** @type {number} */ limit, /** @type {(v: number) => string} */ fmt) {
  return [...DIV_NEG.map((colour, i) => ({ colour, label: fmt(-limit * (1 - i / 4)) })), { colour: MID, label: fmt(0) }, ...DIV_POS.map((colour, i) => ({ colour, label: fmt((limit * (i + 1)) / 4) }))];
}

/**
 * Per-area rows of an election: the summary's results joined to the contests' map features by
 * contest name. Each row: { name, feature (upper-case label), seats, winnerParty, leadingParty,
 * turnout, validPoll, unopposed }.
 * @param {{ results?: any[] }} summary
 * @param {{ items?: any[] }} contests  /_api/elections?view=contests
 */
export function areaRows(summary, contests) {
  /** @type {Map<string, string[]>} */
  const features = new Map();
  for (const it of contests.items || []) {
    if (it.entryKind && it.entryKind !== 'election-constituency-result') continue;
    const name = it.constituency || it.resultName;
    const feat = it.featureName || it.resultMetadata?.featureName;
    if (!name || !feat || it.matched === false) continue;
    if (!features.has(name)) features.set(name, []);
    /** @type {string[]} */ (features.get(name)).push(String(feat).toUpperCase());
  }
  return (summary.results || []).map((r) => {
    const valid = Number(r.validPoll) || 0;
    const turnout = Number(r.turnoutPct) || 0;
    return {
      name: r.constituency,
      feature: features.get(r.constituency)?.shift() || (r.featureName ? String(r.featureName).toUpperCase() : null),
      seats: Number(r.seatsTotal) || 1,
      winnerParty: r.winnerParty || null,
      leadingParty: r.leadingParty || null,
      leadingName: r.leadingName || null,
      turnout: turnout > 0 ? turnout : null,
      validPoll: valid > 0 ? valid : null,
      unopposed: !(valid > 0) && !(Number(r.leadingVotes) > 0),
    };
  });
}

/**
 * A party's share per area, and the change from another election in the same areas (by name).
 * @param {Array<{ area: string, party: string, votes: number, valid: number }>} rows  from the extracts
 * @param {string} party
 * @returns {Map<string, number>} area -> share (%)
 */
export function partyShares(rows, party) {
  /** @type {Map<string, { p: number, all: number }>} */
  const by = new Map();
  for (const r of rows) {
    const a = by.get(r.area) || { p: 0, all: 0 };
    a.all += Number(r.votes) || 0;
    if (r.party === party) a.p += Number(r.votes) || 0;
    by.set(r.area, a);
  }
  const out = new Map();
  for (const [area, a] of by) if (a.all > 0) out.set(area, (100 * a.p) / a.all);
  return out;
}

/**
 * Butler swing from A to B between two elections: the average of one party's gain and the
 * other's loss, in points (positive: towards the first party).
 * @param {{ a1: number, b1: number }} before shares of party 1 and party 2 before
 * @param {{ a2: number, b2: number }} after
 */
export function butlerSwing({ a1, b1 }, { a2, b2 }) {
  return ((a2 - a1) - (b2 - b1)) / 2;
}
