/**
 * Seat apportionment: the textbook methods that turn votes into seats for lists (parties, or
 * candidates standing alone). Pure, no DOM, no I/O; served to the Elections app at
 * /pkg/core/src/apportionment.mjs (packages/served.json). Tests: tests/unit/apportionment.test.mjs.
 *
 *   highestAverages(lists, seats, 'dhondt')        D'Hondt: divisors 1, 2, 3, ...
 *   highestAverages(lists, seats, 'sainte-lague')  Sainte-Laguë (Webster): divisors 1, 3, 5, ...
 *   largestRemainder(lists, seats)                 Hare quota (votes / seats), then the largest remainders
 *   plurality(lists)                               the list with the most votes (first past the post)
 *
 * A list may carry a cap (the most seats it can take: 1 for a candidate standing alone). Ties are
 * broken by the larger vote total, then by the list id, so a result never depends on input order.
 * Quotients are compared exactly (cross-multiplied), never as rounded floating-point numbers.
 */

/**
 * A list standing for seats: its id, its votes, and the most seats it can take (no cap if absent).
 * @typedef {{ id: string, votes: number, cap?: number }} SeatList
 * @typedef {'dhondt' | 'sainte-lague'} DivisorMethod
 */

/** The methods' divisor for a list that holds `held` seats. @param {DivisorMethod} method @param {number} held */
export function divisor(method, held) {
  return method === 'sainte-lague' ? 2 * held + 1 : held + 1;
}

/** The lists that can take seats: positive votes, sorted by votes then id. @param {readonly SeatList[]} lists */
function standing(lists) {
  return lists.filter((l) => Number(l.votes) > 0 && (l.cap === undefined || l.cap > 0))
    .map((l) => ({ id: String(l.id), votes: Number(l.votes), cap: l.cap === undefined ? Infinity : l.cap }))
    .sort((a, b) => b.votes - a.votes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Seats by a highest-averages method.
 * @param {readonly SeatList[]} lists
 * @param {number} seats
 * @param {DivisorMethod} [method]
 * @returns {Map<string, number>} list id -> seats won (lists that won none are left out)
 */
export function highestAverages(lists, seats, method = 'dhondt') {
  const live = standing(lists);
  /** @type {Map<string, number>} */
  const held = new Map(live.map((l) => [l.id, 0]));
  for (let s = 0; s < seats; s += 1) {
    /** @type {{ id: string, votes: number, cap: number } | null} */
    let best = null;
    let bestDiv = 1;
    for (const l of live) {
      const h = /** @type {number} */ (held.get(l.id));
      if (h >= l.cap) continue;
      const d = divisor(method, h);
      // l.votes / d > best.votes / bestDiv, exactly; on a tie the earlier list (more votes, then id) keeps it.
      if (!best || l.votes * bestDiv > best.votes * d) { best = l; bestDiv = d; }
    }
    if (!best) break;
    held.set(best.id, /** @type {number} */ (held.get(best.id)) + 1);
  }
  return new Map([...held].filter(([, n]) => n > 0));
}

/**
 * Seats by the largest-remainder method with the Hare quota (pure proportional representation).
 * Each list first takes its whole quotas (up to its cap); the seats left go one each to the largest
 * remainders, in further rounds while capped lists leave seats over.
 * @param {readonly SeatList[]} lists
 * @param {number} seats
 * @returns {Map<string, number>}
 */
export function largestRemainder(lists, seats) {
  const live = standing(lists);
  const total = live.reduce((s, l) => s + l.votes, 0);
  /** @type {Map<string, number>} */
  const held = new Map();
  if (!total || seats <= 0) return held;
  let left = seats;
  for (const l of live) {
    // votes / (total / seats) = votes * seats / total, in whole seats.
    const whole = Math.min(l.cap, Math.floor((l.votes * seats) / total), left);
    held.set(l.id, whole);
    left -= whole;
  }
  while (left > 0) {
    // Remainder of each list still under its cap: votes * seats - held * total (in units of 1/total quota).
    const open = live.filter((l) => /** @type {number} */ (held.get(l.id)) < l.cap)
      .map((l) => ({ l, rem: l.votes * seats - /** @type {number} */ (held.get(l.id)) * total }))
      .sort((a, b) => b.rem - a.rem || b.l.votes - a.l.votes || (a.l.id < b.l.id ? -1 : a.l.id > b.l.id ? 1 : 0));
    if (!open.length) break;
    for (const { l } of open) {
      if (left <= 0) break;
      held.set(l.id, /** @type {number} */ (held.get(l.id)) + 1);
      left -= 1;
    }
  }
  return new Map([...held].filter(([, n]) => n > 0));
}

/**
 * The list with the most votes (first past the post), or null when no list has a vote.
 * @param {readonly SeatList[]} lists
 * @returns {string | null}
 */
export function plurality(lists) {
  const live = standing(lists);
  return live.length ? live[0].id : null;
}
