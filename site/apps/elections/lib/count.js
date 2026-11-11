/**
 * The count sheet of one contest, from the elections API's candidates (each with its counts:
 * [{ count, total, transfers, status }]) and the contest row. Pure (no DOM):
 * tests/unit/elections-app-lib.test.mjs.
 *
 * Kinds (docs/tasks/elections-app-data-audit.md, "What each view can show"):
 *   'stages'    real stage-by-stage totals: the full sheet, transfers and the flow diagram;
 *   'order'     the count at which each candidate was elected or excluded, but totals padded
 *               unchanged across stages (some Irish sources): first preferences plus the order;
 *   'single'    one round of votes (first past the post, or a one-count STV result);
 *   'unopposed' no poll: the members returned unopposed (packages/core/src/unopposed.mjs);
 *   'none'      no votes recorded and not known to be unopposed ("votes not recorded").
 * (state-machines.js SHEET_KINDS, EL-12; whether a contest was unopposed is core's one rule.)
 */
import { candidateReturnWithoutPoll, contestPollStatus } from '../../../pkg/core/src/unopposed.mjs';
import { num } from './format.js';

/**
 * @typedef {{ count: number, total: number | null, transfers: number | null, status: string }} Cell
 * @typedef {{ id: string, name: string, party: string, colour: string, personId: string | null,
 *   firstPrefs: number | null, finalVotes: number | null, elected: boolean, unopposed: boolean, autoReturned: boolean,
 *   electedAt: number | null, excludedAt: number | null, status: string, cells: Cell[] }} SheetRow
 * @typedef {{ id: string, name: string, party: string, colour: string, amount: number }} Flow
 * @typedef {import('../state-machines.js').SheetKind} SheetKind
 * @typedef {import('../state-machines.js').StageKind} StageKind
 */

/**
 * @param {Array<any>} candidates
 * @param {{ quota?: number | null, validPoll?: number | null, seatsTotal?: number | null, nonTransferable?: any[], contestStatus?: string | null }} contest
 */
export function countSheet(candidates, contest = {}) {
  const stageSet = new Set();
  /** @type {SheetRow[]} */
  const rows = (candidates || []).map((c) => {
    /** @type {Cell[]} */
    const cells = (Array.isArray(c.counts) ? c.counts : []).map((/** @type {any} */ k) => ({
      count: Number(k.count), total: num(k.total), transfers: num(k.transfers), status: String(k.status || ''),
    })).filter((/** @type {Cell} */ k) => Number.isFinite(k.count)).sort((/** @type {Cell} */ a, /** @type {Cell} */ b) => a.count - b.count);
    for (const k of cells) if (k.total !== null) stageSet.add(k.count);
    // packages/core/src/unopposed.mjs (QA H4): an "Elected unopposed" or auto-returned (Ceann
    // Comhairle) seat had no poll; 252 older rows carry 0 votes for it.
    const returned = candidateReturnWithoutPoll(c);
    const unopposed = returned === 'unopposed';
    const autoReturned = returned === 'auto-returned';
    const noPoll = returned !== null;
    return {
      id: String(c.id ?? c.name),
      name: String(c.name || ''),
      party: String(c.party || 'No party recorded'),
      colour: c.colour || '',
      personId: c.personId ? String(c.personId) : null,
      firstPrefs: noPoll && !num(c.firstPrefs) ? null : num(c.firstPrefs),
      finalVotes: num(c.finalVotes),
      elected: c.elected === 1 || c.elected === true || noPoll,
      unopposed,
      autoReturned,
      electedAt: num(c.electedAt),
      excludedAt: num(c.excludedAt),
      status: String(c.status || ''),
      cells,
    };
  });
  const stages = [...stageSet].sort((a, b) => a - b);
  // Real stages: some candidate's total changes between stages, or a transfer is recorded.
  let moving = false;
  for (const r of rows) {
    let prev = null;
    for (const k of r.cells) {
      if (k.total === null) continue;
      if ((prev !== null && k.total !== prev) || (k.transfers !== null && k.transfers !== 0 && k.count > 1)) moving = true;
      prev = k.total;
    }
  }
  const votes = rows.some((r) => r.firstPrefs !== null);
  const ordered = rows.some((r) => (r.electedAt || 0) > 1 || (r.excludedAt || 0) > 1);
  /** @type {SheetKind} */
  let kind = 'single';
  if (!votes) {
    kind = contestPollStatus({ candidates: candidates || [], contestStatus: contest.contestStatus }) === 'unopposed' ? 'unopposed' : 'none';
  } else if (stages.length > 1 && moving) kind = 'stages';
  else if (ordered) kind = 'order';

  // Non-transferable votes per stage, where the source records them.
  const ntByCount = new Map();
  for (const k of Array.isArray(contest.nonTransferable) ? contest.nonTransferable : []) {
    const c = num(k?.count);
    if (c !== null) ntByCount.set(c, { total: num(k.total), transfers: num(k.transfers) });
  }
  const sorted = [...rows].sort((a, b) => {
    // elected first (in order of election), then the rest by their last total / first preferences
    if (a.elected !== b.elected) return a.elected ? -1 : 1;
    if (a.elected && b.elected) return (a.electedAt ?? 99) - (b.electedAt ?? 99) || (b.firstPrefs ?? 0) - (a.firstPrefs ?? 0);
    return (b.excludedAt ?? 999) - (a.excludedAt ?? 999) || (b.firstPrefs ?? 0) - (a.firstPrefs ?? 0);
  });
  return {
    kind,
    stages: kind === 'stages' ? stages : stages.slice(0, 1),
    rows: sorted,
    quota: num(contest.quota),
    validPoll: num(contest.validPoll) ?? (votes ? rows.reduce((s, r) => s + (r.firstPrefs || 0), 0) : null),
    nonTransferable: ntByCount,
    seats: num(contest.seatsTotal),
  };
}

/** The cell of a row at a stage (or null). */
export const cellAt = (/** @type {SheetRow} */ row, /** @type {number} */ stage) => row.cells.find((k) => k.count === stage) || null;

/**
 * The transfers at each stage after the first: who was distributed (negative transfers) and who
 * gained (positive), plus non-transferable where recorded. The records hold each candidate's
 * net transfer per stage, not who-to-whom flows, so this is as far as a diagram can honestly go.
 * @param {ReturnType<typeof countSheet>} sheet
 */
export function transferStages(sheet) {
  if (sheet.kind !== 'stages') return [];
  const out = [];
  for (const stage of sheet.stages.slice(1)) {
    /** @type {Flow[]} */
    const from = [];
    /** @type {Flow[]} */
    const to = [];
    for (const r of sheet.rows) {
      const k = cellAt(r, stage);
      if (!k) continue;
      let t = k.transfers;
      if (t === null) {
        const prev = cellAt(r, stage - 1);
        t = prev && prev.total !== null && k.total !== null ? k.total - prev.total : null;
      }
      if (t === null || Math.abs(t) < 1e-9) continue;
      (t < 0 ? from : to).push({ id: r.id, name: r.name, party: r.party, colour: r.colour, amount: Math.abs(t) });
    }
    if (!from.length && !to.length) continue;
    const distributed = from.reduce((s, x) => s + x.amount, 0);
    const received = to.reduce((s, x) => s + x.amount, 0);
    const nt = sheet.nonTransferable.get(stage);
    const nonTransferable = nt?.transfers ?? (distributed > received ? Math.round((distributed - received) * 100) / 100 : 0);
    /** @type {StageKind} */
    const kind = from.some((f) => sheet.rows.find((r) => r.id === f.id)?.elected) ? 'surplus' : 'exclusion';
    out.push({ stage, kind, from, to, distributed, received, nonTransferable });
  }
  return out;
}

/**
 * Each candidate's progress to the quota at the last stage they have (0..1+), for the quota bars.
 * @param {ReturnType<typeof countSheet>} sheet
 */
export function quotaProgress(sheet) {
  if (!sheet.quota) return [];
  return sheet.rows.map((r) => {
    // The highest total a candidate reached: an excluded candidate's total drops to 0 after
    // their votes are distributed, and an elected one's falls back to the quota after a surplus.
    const totals = r.cells.filter((k) => k.total !== null && (sheet.kind === 'stages' || k.count === 1)).map((k) => /** @type {number} */ (k.total));
    const total = totals.length ? Math.max(...totals) : r.firstPrefs;
    const first = r.firstPrefs;
    return { id: r.id, name: r.name, party: r.party, colour: r.colour, first, total, ratio: total !== null ? total / /** @type {number} */ (sheet.quota) : null, elected: r.elected };
  });
}

/** The majority of a first-past-the-post contest (winner minus runner-up), or null. */
/** @param {{ rows: SheetRow[], seats: number | null }} sheet */
export function fptpMajority(sheet) {
  const votes = /** @type {number[]} */ (sheet.rows.map((r) => r.firstPrefs).filter((v) => v !== null)).sort((a, b) => b - a);
  if (votes.length < 2 || sheet.seats !== 1) return null;
  return votes[0] - votes[1];
}
