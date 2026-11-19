/**
 * Projections: uniform swing from a base election, and the seats it gives. Pure:
 * unit test elections-app-lib.test.mjs. This is the app's projections hook: the swingometer
 * feeds it share changes typed by the reader, and a later poll average could feed it target
 * shares the same way (`deltasFromTargets`). No polling data is used or bundled: LucidTalk
 * files must never reach the site.
 *
 * Seats are estimates: first past the post goes to the largest share; a multi-seat STV contest
 * is allocated by Droop quotas of first preferences, then the largest remainders. Transfers are
 * not modelled, so STV seat estimates are labelled as such wherever they are shown.
 */

/** The swingometer's words about its base (keys of data/i18n/strings/elections.txt, R10). */
export const SWING_WORDS = Object.freeze({
  won: 'Won',
  base: "The swing starts from the seats each party won at this election. A seat moves only where the swing changes the estimate of a contest's result.",
  baseStv: "The estimate shares out each contest's seats by quotas of first preferences, without transfers.",
  resultLink: 'The full result is on the election page.',
});

/**
 * @typedef {{ area: string, seats: number, votes: Map<string, number>, won?: Map<string, number> }} BaseContest
 *   won: the seats each party actually won (the extract rows' seats), when the rows carry them
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
    const c = by.get(r.area) || { area: r.area, seats: 0, votes: new Map(), won: new Map() };
    c.votes.set(r.party, (c.votes.get(r.party) || 0) + (Number(r.votes) || 0));
    const won = Number(r.seats) || 0;
    if (won > 0) /** @type {Map<string, number>} */ (c.won).set(r.party, (c.won?.get(r.party) || 0) + won);
    if (!seatsOf) c.seats += won;
    by.set(r.area, c);
  }
  const out = [...by.values()];
  if (seatsOf) for (const c of out) c.seats = seatsOf.get(c.area) || 1;
  // A contest with no votes is kept when the rows say who won it (returned unopposed, or only the
  // winners on record, whose votes are not recorded): its seats count in the actual result and
  // never move (projectFromResult).
  return out.filter((c) => [...c.votes.values()].some((v) => v > 0) || (!seatsOf && !!c.won?.size));
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
  if (seats <= 1) { out.set(/** @type {[string, number]} */ (ranked[0])[0], 1); return out; }
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
  for (let i = 0; left > 0 && i < rem.length; i += 1, left -= 1) out.set(/** @type {[string, number]} */ (rem[i])[0], (out.get(/** @type {[string, number]} */ (rem[i])[0]) || 0) + 1);
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

/**
 * The seats of one contest moved from its actual result by a swing (the swingometer, 14 Nov 2026).
 * The model (`allocate`) is run on the base shares and on the moved ones, and only its change is
 * applied to the seats actually won: a party loses as many of its real seats as the model takes
 * from it, and those seats go to the parties the model gives seats to, the largest gain first
 * (then the larger moved share). With no change the answer is the actual result, so the
 * swingometer starts from the seats won, not from the model's estimate of them (under STV a
 * quota count of first preferences gave Sinn Féin 30 seats in 2022 against the 27 it won).
 * @param {Map<string, number>} won    seats actually won, by party
 * @param {Map<string, number>} before the model's seats at the base shares
 * @param {Map<string, number>} after  the model's seats at the moved shares
 * @param {Map<string, number>} shares the moved shares (%), to order equal gains
 * @returns {Map<string, number>}
 */
export function anchoredSeats(won, before, after, shares) {
  const out = new Map(won);
  /** @type {string[]} */
  const losers = [];
  let freed = 0;
  for (const [p, n] of before) {
    const take = Math.min(Math.max(0, n - (after.get(p) || 0)), out.get(p) || 0);
    if (!take) continue;
    out.set(p, (out.get(p) || 0) - take);
    freed += take;
    losers.push(p);
  }
  const gains = [...after].map(([p, n]) => /** @type {[string, number]} */ ([p, n - (before.get(p) || 0)])).filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1] || (shares.get(b[0]) || 0) - (shares.get(a[0]) || 0) || a[0].localeCompare(b[0]));
  for (const [p, g] of gains) {
    const give = Math.min(g, freed);
    if (!give) break;
    out.set(p, (out.get(p) || 0) + give);
    freed -= give;
  }
  // Seats taken that no gain claimed (the model gave a party a seat it did not hold) go back.
  for (let i = 0; freed > 0 && losers.length; i = (i + 1) % losers.length, freed -= 1) out.set(/** @type {string} */ (losers[i]), (out.get(/** @type {string} */ (losers[i])) || 0) + 1);
  for (const [p, n] of out) if (n <= 0) out.delete(p);
  return out;
}

/**
 * Uniform swing from the actual result: each contest's seats are its real seats moved by the
 * model's change (anchoredSeats). A contest without its seats won falls back to the model.
 * @param {BaseContest[]} contests
 * @param {Map<string, number>} deltas
 * @returns {{ seats: Map<string, number>, contests: Array<{ area: string, shares: Map<string, number>, seats: Map<string, number> }> }}
 */
export function projectFromResult(contests, deltas) {
  const base = project(contests, new Map()).contests;
  const moved = project(contests, deltas).contests;
  /** @type {Map<string, number>} */
  const total = new Map();
  const per = contests.map((c, i) => {
    const seats = c.won && c.won.size ? anchoredSeats(c.won, /** @type {(typeof base)[number]} */ (base[i]).seats, /** @type {(typeof moved)[number]} */ (moved[i]).seats, /** @type {(typeof moved)[number]} */ (moved[i]).shares) : /** @type {(typeof moved)[number]} */ (moved[i]).seats;
    for (const [p, n] of seats) total.set(p, (total.get(p) || 0) + n);
    return { area: c.area, shares: /** @type {(typeof moved)[number]} */ (moved[i]).shares, seats };
  });
  return { seats: total, contests: per };
}
