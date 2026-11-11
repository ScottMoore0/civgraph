/**
 * Projections: uniform swing from a base election, and the seats it gives. Pure:
 * tests/unit/elections-app-lib.test.mjs. This is the app's projections hook: the swingometer
 * feeds it share changes typed by the reader, and a later poll average could feed it target
 * shares the same way (`deltasFromTargets`). No polling data is used or bundled: LucidTalk
 * files must never reach the site.
 *
 * Seats are estimates: first past the post goes to the largest share; a multi-seat STV contest
 * is allocated by Droop quotas of first preferences, then the largest remainders. Transfers are
 * not modelled, so STV seat estimates are labelled as such wherever they are shown.
 */

/**
 * @typedef {{ area: string, seats: number, votes: Map<string, number> }} BaseContest
 */

/**
 * Contests of the base election from the extract rows (area, party, votes, seats won).
 * @param {Array<{ area: string, party: string, votes: number | null, seats?: number }>} rows
 * @param {Map<string, number>} [seatsOf] area -> seats (default: the seats won in the rows)
 * @returns {BaseContest[]}
 */
export function baseContests(rows, seatsOf) {
  /** @type {Map<string, BaseContest>} */
  const by = new Map();
  for (const r of rows) {
    const c = by.get(r.area) || { area: r.area, seats: 0, votes: new Map() };
    c.votes.set(r.party, (c.votes.get(r.party) || 0) + (Number(r.votes) || 0));
    if (!seatsOf) c.seats += Number(r.seats) || 0;
    by.set(r.area, c);
  }
  const out = [...by.values()];
  if (seatsOf) for (const c of out) c.seats = seatsOf.get(c.area) || 1;
  return out.filter((c) => [...c.votes.values()].some((v) => v > 0));
}

/** Each party's share of all votes in the contests (%). */
export function nationalShares(/** @type {BaseContest[]} */ contests) {
  /** @type {Map<string, number>} */
  const t = new Map();
  let all = 0;
  for (const c of contests) for (const [p, v] of c.votes) { t.set(p, (t.get(p) || 0) + v); all += v; }
  return new Map([...t].map(([p, v]) => [p, all ? (100 * v) / all : 0]));
}

/** Deltas (points) that move the base national shares to target shares. */
export function deltasFromTargets(/** @type {Map<string, number>} */ base, /** @type {Map<string, number>} */ targets) {
  return new Map([...targets].map(([p, t]) => [p, t - (base.get(p) || 0)]));
}

/**
 * Seats of one contest from party shares (%): FPTP or Droop quota plus largest remainders.
 * @param {Map<string, number>} shares
 * @param {number} seats
 * @returns {Map<string, number>}
 */
export function allocate(shares, seats) {
  const out = new Map();
  const ranked = [...shares].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return out;
  if (seats <= 1) { out.set(ranked[0][0], 1); return out; }
  const quota = 100 / (seats + 1);
  let left = seats;
  /** @type {Array<[string, number]>} */
  const rem = [];
  for (const [p, s] of ranked) {
    const n = Math.min(left, Math.floor(s / quota));
    if (n) out.set(p, n);
    left -= n;
    rem.push([p, s - n * quota]);
  }
  rem.sort((a, b) => b[1] - a[1]);
  for (let i = 0; left > 0 && i < rem.length; i += 1, left -= 1) out.set(rem[i][0], (out.get(rem[i][0]) || 0) + 1);
  return out;
}

/**
 * Uniform swing: add each party's delta (points) to its share in every contest, floor at zero,
 * renormalise, and allocate the seats.
 * @param {BaseContest[]} contests
 * @param {Map<string, number>} deltas
 * @returns {{ seats: Map<string, number>, contests: Array<{ area: string, shares: Map<string, number>, seats: Map<string, number> }> }}
 */
export function project(contests, deltas) {
  /** @type {Map<string, number>} */
  const total = new Map();
  const per = contests.map((c) => {
    const all = [...c.votes.values()].reduce((s, v) => s + v, 0);
    const raw = new Map([...c.votes].map(([p, v]) => [p, Math.max(0, (all ? (100 * v) / all : 0) + (deltas.get(p) || 0))]));
    const sum = [...raw.values()].reduce((s, v) => s + v, 0) || 1;
    const shares = new Map([...raw].map(([p, v]) => [p, (100 * v) / sum]));
    const seats = allocate(shares, c.seats);
    for (const [p, n] of seats) total.set(p, (total.get(p) || 0) + n);
    return { area: c.area, shares, seats };
  });
  return { seats: total, contests: per };
}
