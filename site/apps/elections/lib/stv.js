/**
 * Readable STV counts (el-stv, 14 Nov 2026): what each count did, a plain sentence or two about
 * it, the transfers between candidates and between parties, the quota's formula and the margin of
 * the last seat. Pure (no DOM): tests/unit/elections-app-stv.test.mjs.
 *
 * Everything here is worked out from the count sheet (lib/count.js countSheet): each candidate's
 * total at each count and the change since the count before. The records hold each candidate's
 * net change per count, not who passed votes to whom. So:
 *   - a count where one candidate's votes were passed on is a transfer from that candidate to
 *     each candidate who gained (candidate-level);
 *   - a count where several candidates' votes were passed on together gives no split by source:
 *     it is shown as one pool and left out of the party-to-party table;
 *   - what a count did is "not recorded" when no candidate lost votes at it;
 *   - non-transferable votes are the source's figure where it gives one, else the votes passed on
 *     less the votes received, labelled as worked out.
 * Nothing is inferred beyond that, and no transfer is invented.
 *
 * Every sentence is a pattern keyed for translation in data/i18n/strings/elections.txt (R10): the
 * language runtime matches each by its wording, so a sentence is one text node.
 */
import { cellAt } from './count.js';
import { fmtInt } from './format.js';
import { siteNumber } from '../../../pkg/core/src/format.js';

/**
 * @typedef {import('./count.js').SheetRow} SheetRow
 * @typedef {ReturnType<typeof import('./count.js').countSheet>} Sheet
 * @typedef {{ id: string, name: string, party: string, colour: string, amount: number }} Mover
 * @typedef {{ id: string, name: string, party: string, colour: string, total: number | null, how: 'reached-elected' | 'reached' | 'declared' | 'no-quota' | 'elected' | 'excluded' }} Declared
 * @typedef {'first' | 'surplus' | 'exclusion' | 'mixed' | 'unrecorded' | 'quiet'} CountKind
 * @typedef {{
 *   stage: number, index: number, kind: CountKind, surpluses: Mover[], exclusions: Mover[], unknown: Mover[], gains: Mover[],
 *   distributed: number, received: number, nonTransferable: number, ntRecorded: boolean,
 *   electedHere: Declared[], excludedHere: Declared[], last: boolean,
 * }} CountEvent
 */

/** Every pattern this module writes (each a line of data/i18n/strings/elections.txt). */
export const STV_TEXT = Object.freeze({
  labelFirst: 'Count {count}: first preferences',
  labelSurplus: "Count {count}: distribution of {name}'s surplus ({n})",
  labelSurpluses: 'Count {count}: distribution of the surpluses of {names} ({n})',
  labelExclusion: 'Count {count}: exclusion of {name} ({n})',
  labelExclusions: 'Count {count}: exclusion of {names} ({n})',
  labelMixed: 'Count {count}: distribution of the surplus of {names} and exclusion of {others} ({n})',
  labelUnrecorded: 'Count {count}: what was distributed is not recorded',
  labelQuiet: 'Count {count}: no votes moved',
  labelOrderElected: 'Count {count}: {names} elected',
  labelOrderExcluded: 'Count {count}: exclusion of {names}',
  labelOrderBoth: 'Count {count}: exclusion of {others}; {names} elected',
  labelOrderNone: 'Count {count}: not recorded',
  firstCounted: 'The first preferences were counted.',
  quotaIs: 'The quota is {n} votes.',
  reached: '{name} reached the quota and was elected.',
  electedNoQuota: '{name} was elected without reaching the quota.',
  reachedOnly: '{name} reached the quota.',
  declaredElected: '{name} was declared elected.',
  electedPlain: '{name} was elected.',
  surplusOne: '{name} had {n} votes more than the quota, and these were passed on to the next preferences marked.',
  surplusMany: 'The surpluses of {names}, {n} votes in all, were passed on to the next preferences marked.',
  exclusionOne: '{name} was excluded, and their {n} votes were passed on to the next preferences marked.',
  exclusionMany: '{names} were excluded together, and their {n} votes were passed on to the next preferences marked.',
  pooled: "The source gives each candidate's gain, not whose votes it came from, so the votes passed on at this count are shown as one pool.",
  unrecorded: 'The source does not say whose votes were passed on at this count.',
  unknownMover: "The source does not say why {name}'s total fell by {n} at this count.",
  topGain: '{name} gained the most, {n} votes.',
  ntRecorded: '{n} votes could not be passed on, because no further preference was marked for a candidate still in the count.',
  ntDerived: '{n} votes did not pass to any candidate (worked out from the totals).',
  excludedOnly: '{name} was excluded.',
  quiet: 'No votes moved at this count.',
  lastCount: 'This was the last count.',
  orderOnly: 'The source gives the count at which each candidate was elected or excluded, but not the votes moved, so no transfers are shown.',
  droop: 'The quota is {n} votes: the valid poll of {total} divided by {k} (the {m} seats plus one), rounded down, plus one. This is the Droop quota.',
  droopDiffers: 'The source gives a quota of {n} votes. The Droop formula on the valid poll here gives {k}, so the count may have used another rule or another valid poll.',
  quotaNotGiven: 'The source gives no quota. The Droop formula on the valid poll here gives {n} votes.',
  margin: '{name} won the last seat ahead of {other} by {n} votes at count {count}.',
  marginTie: '{name} won the last seat level with {other} at count {count}.',
  quotas: '{n} quotas',
});

/**
 * A pattern with its values put in. A value missing from `params` leaves its placeholder.
 * @param {string} pattern @param {Record<string, string | number>} params
 */
export function fill(pattern, params) {
  return pattern.replace(/\{([a-zA-Z0-9_]+)\}/g, (all, k) => (params[k] === undefined ? all : String(params[k])));
}

/** Names as one list ("A, B, C"): a comma list translates without an English "and". @param {Array<{ name: string }>} xs */
export const nameList = (xs) => xs.map((x) => x.name).join(', ');

/** Below this a fractional vote is rounding, not a transfer. */
const EPS = 0.005;

/**
 * A candidate's change at a stage of the sheet: the difference of the totals when both counts give
 * one, else the transfer the source records; null at the first stage or when nothing is given.
 * @param {SheetRow} row @param {number[]} stages @param {number} index
 */
export function changeAt(row, stages, index) {
  if (index <= 0) return null;
  const k = cellAt(row, stages[index]);
  if (!k) return null;
  const prev = cellAt(row, stages[index - 1]);
  if (k.total !== null && prev && prev.total !== null) return k.total - prev.total;
  return k.transfers;
}

/** A candidate's total at a stage, or null. @param {SheetRow} row @param {number} stage */
export const totalAt = (row, stage) => cellAt(row, stage)?.total ?? null;

/** @param {SheetRow} r @param {number} amount @returns {Mover} */
const mover = (r, amount) => ({ id: r.id, name: r.name, party: r.party, colour: r.colour, amount });

/**
 * The first count at which a candidate's total reached the quota, or null (no quota, or never).
 * @param {SheetRow} row @param {number[]} stages @param {number | null} quota
 */
export function reachedQuotaAt(row, stages, quota) {
  if (!quota) return null;
  for (const stage of stages) {
    const total = totalAt(row, stage);
    if (total !== null && total >= quota - EPS) return stage;
  }
  return null;
}

/**
 * The count from which a candidate counts as elected: the count at which they reached the quota
 * (the rule of the count), else the count the source gives; null when not elected.
 * @param {SheetRow} row @param {number[]} stages @param {number | null} quota
 */
export function electedFrom(row, stages, quota) {
  if (!row.elected) return null;
  const reached = reachedQuotaAt(row, stages, quota);
  if (reached !== null && (row.electedAt === null || reached < row.electedAt)) return reached;
  return row.electedAt;
}

/**
 * What each count of a stage-by-stage sheet did ([] for any other kind of sheet).
 *
 * Sources write a count sheet in two ways, and both are read:
 *   - every candidate keeps a total to the end (Northern Ireland): a candidate whose total falls
 *     passed votes on, as a surplus when their total before was at or over the quota, else as an
 *     exclusion when they were not elected;
 *   - a candidate's column stops once they are excluded or reach the quota (the Dáil): an
 *     excluded candidate whose column stops passed all their votes on at the next count. An
 *     elected candidate whose column stops has a surplus (their total less the quota) waiting.
 *     A later count whose gains no other candidate's loss explains passed on a waiting surplus,
 *     the largest first (the rule of the count); when no quota is known the gains are its size.
 * @param {Sheet} sheet
 * @returns {CountEvent[]}
 */
export function countEvents(sheet) {
  if (sheet.kind !== 'stages') return [];
  const { stages, rows } = sheet;
  const quota = sheet.quota;
  /** Surpluses not yet passed on, of elected candidates whose column has stopped. */
  /** @type {Map<string, { row: SheetRow, amount: number | null }>} */
  const waiting = new Map();
  return stages.map((stage, index) => {
    /** @type {Mover[]} */ const surpluses = [];
    /** @type {Mover[]} */ const exclusions = [];
    /** @type {Mover[]} */ const unknown = [];
    /** @type {Mover[]} */ const gains = [];
    if (index > 0) {
      const prevStage = stages[index - 1];
      for (const r of rows) {
        const before = totalAt(r, prevStage);
        const now = totalAt(r, stage);
        if (before !== null && before > EPS && now === null && cellAt(r, stage)?.transfers == null) {
          // The column stops: an excluded candidate's votes all move now; an elected one's surplus waits.
          if (!r.elected) exclusions.push(mover(r, before));
          else waiting.set(r.id, { row: r, amount: quota ? Math.max(0, round2(before - quota)) : null });
          continue;
        }
        const t = changeAt(r, stages, index);
        if (t === null || Math.abs(t) < EPS) continue;
        if (t > 0) { gains.push(mover(r, t)); continue; }
        const lost = mover(r, -t);
        if (r.elected && ((quota && before !== null && before >= quota - EPS) || (r.electedAt !== null && r.electedAt < stage))) surpluses.push(lost);
        else if (!r.elected && (r.excludedAt === null || r.excludedAt <= stage)) exclusions.push(lost);
        else unknown.push(lost);
      }
      const gained = gains.reduce((s, x) => s + x.amount, 0);
      if (!surpluses.length && !exclusions.length && !unknown.length && gained > EPS && waiting.size) {
        // Gains no loss explains: a waiting surplus moved, the largest first.
        const queue = [...waiting.values()].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
        if (queue.length === 1 || queue.every((w) => w.amount !== null)) {
          let covered = 0;
          for (const w of queue) {
            const amount = w.amount ?? round2(gained);
            surpluses.push(mover(w.row, amount));
            waiting.delete(w.row.id);
            covered += amount;
            if (covered >= gained - 0.5) break;
          }
        }
      }
    }
    gains.sort((a, b) => b.amount - a.amount);
    const distributed = round2([...surpluses, ...exclusions, ...unknown].reduce((s, x) => s + x.amount, 0));
    const received = round2(gains.reduce((s, x) => s + x.amount, 0));
    const nt = sheet.nonTransferable.get(stage);
    const prevNt = index > 0 ? sheet.nonTransferable.get(stages[index - 1]) : null;
    let ntRecorded = false;
    let nonTransferable = 0;
    if (index > 0 && nt && nt.transfers !== null) { nonTransferable = nt.transfers; ntRecorded = true; }
    else if (index > 0 && nt && nt.total !== null && prevNt && prevNt.total !== null) { nonTransferable = nt.total - prevNt.total; ntRecorded = true; }
    else if (distributed - received > EPS) nonTransferable = distributed - received;
    nonTransferable = round2(Math.max(0, nonTransferable));
    /** @type {Declared[]} */
    const elected = [];
    for (const r of rows) {
      if (!r.elected) continue;
      const reached = reachedQuotaAt(r, stages, quota);
      /** @type {Declared['how'] | null} */
      let how = null;
      if (reached === stage) how = r.electedAt === null || r.electedAt <= stage ? 'reached-elected' : 'reached';
      else if (r.electedAt === stage) how = reached === null ? (quota ? 'no-quota' : 'elected') : 'declared';
      if (how) elected.push({ id: r.id, name: r.name, party: r.party, colour: r.colour, total: totalAt(r, stage), how });
    }
    const excluded = rows.filter((r) => !r.elected && r.excludedAt === stage)
      .map((r) => ({ id: r.id, name: r.name, party: r.party, colour: r.colour, total: totalAt(r, stage), how: /** @type {const} */ ('excluded') }));
    /** @type {CountKind} */
    let kind = 'quiet';
    if (index === 0) kind = 'first';
    else if (surpluses.length && exclusions.length) kind = 'mixed';
    else if (surpluses.length) kind = 'surplus';
    else if (exclusions.length) kind = 'exclusion';
    else if (unknown.length || gains.length) kind = 'unrecorded';
    return { stage, index, kind, surpluses, exclusions, unknown, gains, distributed, received, nonTransferable, ntRecorded, electedHere: elected, excludedHere: excluded, last: index === stages.length - 1 };
  });
}

/** @param {number} v */
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * The label of a count: what it did ("Count 3: distribution of Smith's surplus (412)").
 * @param {CountEvent} ev
 */
export function countLabel(ev) {
  const count = ev.stage;
  const n = fmtInt(ev.distributed);
  switch (ev.kind) {
    case 'first': return fill(STV_TEXT.labelFirst, { count });
    case 'surplus': return ev.surpluses.length === 1
      ? fill(STV_TEXT.labelSurplus, { count, name: ev.surpluses[0].name, n })
      : fill(STV_TEXT.labelSurpluses, { count, names: nameList(ev.surpluses), n });
    case 'exclusion': return ev.exclusions.length === 1
      ? fill(STV_TEXT.labelExclusion, { count, name: ev.exclusions[0].name, n })
      : fill(STV_TEXT.labelExclusions, { count, names: nameList(ev.exclusions), n });
    case 'mixed': return fill(STV_TEXT.labelMixed, { count, names: nameList(ev.surpluses), others: nameList(ev.exclusions), n });
    case 'unrecorded': return fill(STV_TEXT.labelUnrecorded, { count });
    default: return fill(STV_TEXT.labelQuiet, { count });
  }
}

/**
 * The plain sentences of a count: what moved, who gained most, what could not be passed on, who
 * was elected or excluded.
 * @param {CountEvent} ev @param {number | null} quota
 */
export function countSentences(ev, quota) {
  /** @type {string[]} */
  const out = [];
  if (ev.kind === 'first') {
    out.push(STV_TEXT.firstCounted);
    if (quota) out.push(fill(STV_TEXT.quotaIs, { n: fmtInt(quota) }));
  }
  const movers = ev.surpluses.length + ev.exclusions.length + ev.unknown.length;
  if (ev.surpluses.length === 1) out.push(fill(STV_TEXT.surplusOne, { name: ev.surpluses[0].name, n: fmtInt(ev.surpluses[0].amount) }));
  else if (ev.surpluses.length > 1) out.push(fill(STV_TEXT.surplusMany, { names: nameList(ev.surpluses), n: fmtInt(sum(ev.surpluses)) }));
  if (ev.exclusions.length === 1) out.push(fill(STV_TEXT.exclusionOne, { name: ev.exclusions[0].name, n: fmtInt(ev.exclusions[0].amount) }));
  else if (ev.exclusions.length > 1) out.push(fill(STV_TEXT.exclusionMany, { names: nameList(ev.exclusions), n: fmtInt(sum(ev.exclusions)) }));
  for (const u of ev.unknown) out.push(fill(STV_TEXT.unknownMover, { name: u.name, n: fmtInt(u.amount) }));
  if (ev.kind === 'unrecorded' && !ev.unknown.length) out.push(STV_TEXT.unrecorded);
  if (movers > 1) out.push(STV_TEXT.pooled);
  if (ev.gains.length && ev.index > 0) out.push(fill(STV_TEXT.topGain, { name: ev.gains[0].name, n: fmtInt(ev.gains[0].amount) }));
  if (ev.nonTransferable > 0) out.push(fill(ev.ntRecorded ? STV_TEXT.ntRecorded : STV_TEXT.ntDerived, { n: fmtInt(ev.nonTransferable) }));
  if (ev.kind === 'quiet') out.push(STV_TEXT.quiet);
  const movedOut = new Set([...ev.exclusions, ...ev.unknown].map((x) => x.id));
  for (const x of ev.excludedHere) if (!movedOut.has(x.id)) out.push(fill(STV_TEXT.excludedOnly, { name: x.name }));
  /** @type {Record<string, string>} */
  const said = { 'reached-elected': STV_TEXT.reached, reached: STV_TEXT.reachedOnly, declared: STV_TEXT.declaredElected, 'no-quota': STV_TEXT.electedNoQuota, elected: STV_TEXT.electedPlain };
  for (const x of ev.electedHere) out.push(fill(said[x.how], { name: x.name }));
  if (ev.last && ev.index > 0) out.push(STV_TEXT.lastCount);
  return out;
}

/** @param {Mover[]} xs */
const sum = (xs) => round2(xs.reduce((s, x) => s + x.amount, 0));

/**
 * The labels of a count-order sheet: who was elected or excluded at each count, and "not
 * recorded" for a count the source says nothing about. [] for any other kind.
 * @param {Sheet} sheet
 * @returns {Array<{ stage: number, label: string }>}
 */
export function orderLabels(sheet) {
  if (sheet.kind !== 'order') return [];
  const last = Math.max(1, ...sheet.rows.map((r) => Math.max(r.electedAt || 0, r.excludedAt || 0)));
  const out = [];
  for (let count = 1; count <= last; count += 1) {
    const elected = sheet.rows.filter((r) => r.elected && r.electedAt === count);
    const excluded = sheet.rows.filter((r) => !r.elected && r.excludedAt === count);
    let label;
    if (elected.length && excluded.length) label = fill(STV_TEXT.labelOrderBoth, { count, names: nameList(elected), others: nameList(excluded) });
    else if (elected.length) label = fill(STV_TEXT.labelOrderElected, { count, names: nameList(elected) });
    else if (excluded.length) label = fill(STV_TEXT.labelOrderExcluded, { count, names: nameList(excluded) });
    else label = fill(STV_TEXT.labelOrderNone, { count });
    out.push({ stage: count, label });
  }
  return out;
}

/**
 * The Droop quota: the valid poll divided by one more than the seats, rounded down, plus one.
 * @param {number} validPoll @param {number} seats
 */
export function droopQuota(validPoll, seats) {
  return Math.floor(validPoll / (seats + 1)) + 1;
}

/**
 * The quota's sentence: the formula with this contest's figures, and whether the source's quota
 * is what the formula gives. Null when the valid poll or the seats are not known.
 * @param {{ quota: number | null, validPoll: number | null, seats: number | null, rows?: Array<{ autoReturned: boolean }> }} sheet
 * @returns {{ formula: number, matches: boolean | null, sentence: string } | null}
 */
export function quotaExplained(sheet) {
  const { quota, validPoll } = sheet;
  // A member returned without a poll (the outgoing Ceann Comhairle) takes no seat of the count.
  const seats = sheet.seats === null ? null : sheet.seats - (sheet.rows || []).filter((r) => r.autoReturned).length;
  if (!validPoll || !seats || seats < 1) return null;
  const formula = droopQuota(validPoll, seats);
  if (quota === null || quota === undefined) return { formula, matches: null, sentence: fill(STV_TEXT.quotaNotGiven, { n: fmtInt(formula) }) };
  const matches = Math.abs(quota - formula) < EPS;
  const sentence = matches
    ? fill(STV_TEXT.droop, { n: fmtInt(quota), total: fmtInt(validPoll), k: fmtInt(seats + 1), m: fmtInt(seats) })
    : fill(STV_TEXT.droopDiffers, { n: fmtInt(quota), k: fmtInt(formula) });
  return { formula, matches, sentence };
}

/** A fraction of the quota to two places ("1.14"): never a percentage. @param {number} ratio */
export const quotaFraction = (ratio) => siteNumber(ratio, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A count of quotas, to two places ("1.14 quotas"): a fraction of the quota is never a percentage. @param {number} votes @param {number} quota */
export function inQuotas(votes, quota) {
  return fill(STV_TEXT.quotas, { n: quotaFraction(votes / quota) });
}

/**
 * @typedef {{ id: string, name: string, party: string, colour: string, total: number }} Standing
 * @typedef {{ lastElected: Standing, runnerUp: Standing, margin: number, stage: number }} Margin
 */

/**
 * The margin of the last seat: the votes between the last candidate elected and the runner-up, at
 * the last count at which the runner-up still held their votes. Only for a stage-by-stage sheet
 * with a losing candidate, where the last elected was not behind the runner-up (null otherwise).
 * @param {Sheet} sheet
 * @returns {Margin | null}
 */
export function lastSeatMargin(sheet) {
  if (sheet.kind !== 'stages') return null;
  const { stages } = sheet;
  const elected = sheet.rows.filter((r) => r.elected && !r.unopposed && !r.autoReturned);
  const losers = sheet.rows.filter((r) => !r.elected);
  if (!elected.length || !losers.length) return null;
  // The last count at which a candidate held votes they had not yet passed on.
  const standing = (/** @type {SheetRow} */ r) => {
    let at = -1;
    stages.forEach((stage, i) => {
      const total = totalAt(r, stage);
      const t = changeAt(r, stages, i);
      if (total !== null && total > EPS && !(t !== null && t < -EPS)) at = i;
    });
    return at;
  };
  let runner = null;
  let runnerAt = -1;
  for (const r of losers) {
    const at = standing(r);
    if (at < 0) continue;
    if (at > runnerAt || (at === runnerAt && runner && (totalAt(r, stages[at]) || 0) > (totalAt(runner, stages[at]) || 0))) { runner = r; runnerAt = at; }
  }
  if (!runner) return null;
  const stage = stages[runnerAt];
  const from = new Map(elected.map((r) => [r.id, electedFrom(r, stages, sheet.quota) ?? stages[stages.length - 1]]));
  const lastAt = Math.max(...from.values());
  const candidates = elected.filter((r) => from.get(r.id) === lastAt && totalAt(r, stage) !== null);
  if (!candidates.length) return null;
  const last = candidates.reduce((a, b) => (/** @type {number} */ (totalAt(b, stage)) < /** @type {number} */ (totalAt(a, stage)) ? b : a));
  const lastTotal = /** @type {number} */ (totalAt(last, stage));
  const runnerTotal = /** @type {number} */ (totalAt(runner, stage));
  // A last seat won from behind (a Seanad sub-panel rule, or a sheet the totals cannot explain)
  // has no margin the totals give.
  if (lastTotal < runnerTotal - EPS) return null;
  const pick = (/** @type {SheetRow} */ r, /** @type {number} */ total) => ({ id: r.id, name: r.name, party: r.party, colour: r.colour, total });
  return { lastElected: pick(last, lastTotal), runnerUp: pick(runner, runnerTotal), margin: round2(lastTotal - runnerTotal), stage };
}

/** The margin's sentence. @param {Margin} m */
export function marginSentence(m) {
  return Math.abs(m.margin) < EPS
    ? fill(STV_TEXT.marginTie, { name: m.lastElected.name, other: m.runnerUp.name, count: m.stage })
    : fill(STV_TEXT.margin, { name: m.lastElected.name, other: m.runnerUp.name, n: fmtInt(m.margin), count: m.stage });
}

/**
 * The contest's transfer matrix: one row a count after the first, from the candidate(s) whose
 * votes were passed on to each candidate who gained, and the non-transferable votes. A row whose
 * votes came from several candidates at once is marked pooled.
 * @param {CountEvent[]} events
 * @returns {Array<{ stage: number, label: string, from: Mover[], pooled: boolean, cells: Map<string, number>, nonTransferable: number, ntRecorded: boolean, distributed: number }>}
 */
export function contestMatrix(events) {
  return events.filter((ev) => ev.index > 0 && (ev.gains.length || ev.distributed > 0)).map((ev) => {
    const from = [...ev.surpluses, ...ev.exclusions, ...ev.unknown];
    return {
      stage: ev.stage,
      label: countLabel(ev),
      from,
      pooled: from.length !== 1,
      cells: new Map(ev.gains.map((g) => [g.id, g.amount])),
      nonTransferable: ev.nonTransferable,
      ntRecorded: ev.ntRecorded,
      distributed: ev.distributed,
    };
  });
}

/**
 * @typedef {{ party: string, colour: string }} PartyKey
 * @typedef {{ from: string, colour: string, distributed: number, transfers: number, to: Map<string, number>, nonTransferable: number }} PartyRow
 * @typedef {{ rows: PartyRow[], parties: PartyKey[], contests: number, contestsWithStages: number, contestsTotal: number, transfers: number, pooled: number }} PartyTransfers
 */

/**
 * The election-wide party-to-party transfers: only the counts that passed on one candidate's
 * votes (candidate-level transfers), summed by the party of the candidate passed on and the party
 * of each candidate who gained. A count that passed on several candidates' votes together is left
 * out and counted in `pooled`. `contests` is how many contests gave at least one such count.
 * @param {Sheet[]} sheets  every contest of the election (any kind)
 * @returns {PartyTransfers}
 */
export function partyTransfers(sheets) {
  /** @type {Map<string, PartyRow>} */
  const rows = new Map();
  /** @type {Map<string, { colour: string, received: number }>} */
  const into = new Map();
  let contests = 0;
  let contestsWithStages = 0;
  let transfers = 0;
  let pooled = 0;
  for (const sheet of sheets) {
    const events = countEvents(sheet);
    if (!events.length) continue;
    contestsWithStages += 1;
    let used = false;
    for (const ev of events) {
      if (ev.index === 0) continue;
      const from = [...ev.surpluses, ...ev.exclusions, ...ev.unknown];
      if (!from.length) continue;
      if (from.length > 1 || ev.unknown.length) { pooled += 1; continue; }
      used = true;
      transfers += 1;
      const src = from[0];
      let row = rows.get(src.party);
      if (!row) { row = { from: src.party, colour: src.colour, distributed: 0, transfers: 0, to: new Map(), nonTransferable: 0 }; rows.set(src.party, row); }
      row.distributed += src.amount;
      row.transfers += 1;
      row.nonTransferable += ev.nonTransferable;
      for (const g of ev.gains) {
        row.to.set(g.party, (row.to.get(g.party) || 0) + g.amount);
        const p = into.get(g.party) || { colour: g.colour, received: 0 };
        p.received += g.amount;
        into.set(g.party, p);
      }
    }
    if (used) contests += 1;
  }
  const parties = [...into.entries()].sort((a, b) => b[1].received - a[1].received).map(([party, p]) => ({ party, colour: p.colour }));
  const list = [...rows.values()].sort((a, b) => b.distributed - a.distributed);
  for (const r of list) { r.distributed = round2(r.distributed); r.nonTransferable = round2(r.nonTransferable); for (const [k, v] of r.to) r.to.set(k, round2(v)); }
  return { rows: list, parties, contests, contestsWithStages, contestsTotal: sheets.length, transfers, pooled };
}

/**
 * The closest last seats of an election, closest first.
 * @template {{ sheet: Sheet }} T
 * @param {T[]} contests
 * @param {number} [limit]
 * @returns {{ list: Array<T & { margin: Margin }>, covered: number, total: number }}
 */
export function closestSeats(contests, limit = 10) {
  /** @type {Array<T & { margin: Margin }>} */
  const withMargin = [];
  for (const c of contests) {
    const margin = lastSeatMargin(c.sheet);
    if (margin) withMargin.push({ ...c, margin });
  }
  withMargin.sort((a, b) => a.margin.margin - b.margin.margin);
  return { list: withMargin.slice(0, limit), covered: withMargin.length, total: contests.length };
}

/**
 * The stepper's count from the URL (?count=), or the first count when it names none of them.
 * @param {URLSearchParams} query @param {number[]} stages
 */
export function stepFromQuery(query, stages) {
  const n = Number(query.get('count'));
  return stages.includes(n) ? n : stages[0];
}

/**
 * The query string of a count: ?count=<n>, the other parameters kept; the first count has none.
 * @param {string} search @param {number} stage @param {number[]} stages
 */
export function stepSearch(search, stage, stages) {
  const q = new URLSearchParams(search);
  if (stage === stages[0] || !stages.includes(stage)) q.delete('count');
  else q.set('count', String(stage));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * The count a stepper control moves to from `current`.
 * @param {'first' | 'prev' | 'next' | 'last'} move @param {number} current @param {number[]} stages
 */
export function stepTo(move, current, stages) {
  const i = Math.max(0, stages.indexOf(current));
  if (move === 'first') return stages[0];
  if (move === 'last') return stages[stages.length - 1];
  if (move === 'prev') return stages[Math.max(0, i - 1)];
  return stages[Math.min(stages.length - 1, i + 1)];
}

/**
 * Each candidate's place at one count, for the stepper: the total, the change, and whether they
 * are elected (and at which count), excluded, or still in the count.
 * @param {Sheet} sheet @param {number} stage
 * @returns {Array<{ row: SheetRow, total: number | null, change: number | null, state: 'elected' | 'excluded' | 'continuing', here: boolean }>}
 */
export function standingAt(sheet, stage) {
  const i = sheet.stages.indexOf(stage);
  return sheet.rows.map((row) => {
    const total = totalAt(row, stage);
    const change = changeAt(row, sheet.stages, i);
    const from = electedFrom(row, sheet.stages, sheet.quota);
    const elected = from !== null && from <= stage;
    const excluded = !row.elected && row.excludedAt !== null && row.excludedAt <= stage;
    /** @type {'elected' | 'excluded' | 'continuing'} */
    const state = elected ? 'elected' : excluded ? 'excluded' : 'continuing';
    const here = (elected && from === stage) || (excluded && row.excludedAt === stage);
    return { row, total, change, state, here };
  });
}

/** Whether an election overview's URL opens its transfers (?transfers=1). @param {URLSearchParams} query */
export const transfersOpen = (query) => query.get('transfers') === '1';

/**
 * The query string of an election overview with its transfers open or closed, the other
 * parameters kept.
 * @param {string} search @param {boolean} open
 */
export function transfersSearch(search, open) {
  const q = new URLSearchParams(search);
  if (open) q.set('transfers', '1');
  else q.delete('transfers');
  const s = q.toString();
  return s ? `?${s}` : '';
}
