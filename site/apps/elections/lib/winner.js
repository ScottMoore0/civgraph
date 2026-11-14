/**
 * Who won a contest, from its row of the election summary. Pure (no DOM): tests/unit/elections-app-fixes.test.mjs.
 *
 * A single seat goes to the elected candidate's party. A multi-member seat has no one winner: the
 * party with the most seats "won the most seats", and where two or more parties share the top
 * count it is a tie (North Antrim 2022: five parties, one seat each). The summary's winnerParty
 * names one of the tied parties, so it is never read alone for a multi-member seat: the row's
 * seatsByParty (party -> seats, scripts/build/build-test2-election-summaries.mjs, 14 Nov 2026)
 * decides. A summary built before that field falls back to winnerParty as "most seats", as before.
 *
 * The words are keyed for translation in data/i18n/strings/elections.txt (R10).
 */

/** Every fixed wording (keys of data/i18n/strings/elections.txt). */
export const WINNER_WORDS = Object.freeze({
  mostSeats: 'most seats',
  tied: 'Tied',
  tiedOne: 'tied, {n} seat each',
  tiedMany: 'tied, {n} seats each',
});

/**
 * @typedef {'single' | 'most' | 'tie' | 'none'} WinnerKind
 *   single  one seat: its winner;  most  one party has the most seats;  tie  several share the top count;
 *   none    nobody known
 * @typedef {{ kind: WinnerKind, parties: string[], seats: number | null, name: string | null }} ContestWinner
 * @typedef {{ seatsTotal?: number | null, winnerParty?: string | null, winnerName?: string | null, leadingParty?: string | null,
 *   leadingName?: string | null, seatsWon?: number | null, seatsByParty?: unknown }} WinnerRow
 */

/**
 * The winner of one contest.
 * @param {WinnerRow} row
 * @returns {ContestWinner}
 */
export function contestWinner(row) {
  const seats = Number(row.seatsTotal) || 1;
  if (seats <= 1) {
    // The elected candidate's party (winnerParty: the leader on the first count where nobody is
    // marked elected), and their name where the summary names exactly one.
    const party = row.winnerParty || row.leadingParty;
    const name = Number(row.seatsWon) === 1 ? row.winnerName : row.leadingName || row.winnerName;
    return party ? { kind: 'single', parties: [String(party)], seats: 1, name: name ? String(name) : null } : { kind: 'none', parties: [], seats: null, name: name ? String(name) : null };
  }
  const by = row.seatsByParty && typeof row.seatsByParty === 'object' ? Object.entries(/** @type {Record<string, unknown>} */ (row.seatsByParty)) : [];
  const won = by.map(([p, n]) => /** @type {[string, number]} */ ([p, Number(n) || 0])).filter(([, n]) => n > 0);
  if (won.length) {
    const top = Math.max(...won.map(([, n]) => n));
    const parties = won.filter(([, n]) => n === top).map(([p]) => p);
    return { kind: parties.length > 1 ? 'tie' : 'most', parties, seats: top, name: null };
  }
  return row.winnerParty ? { kind: 'most', parties: [String(row.winnerParty)], seats: null, name: null } : { kind: 'none', parties: [], seats: null, name: null };
}

/**
 * The tie's wording: "tied, 2 seats each".
 * @param {number | null} seats @param {(n: number) => string} fmt
 */
export function tiedWords(seats, fmt) {
  const n = seats ?? 0;
  return (n === 1 ? WINNER_WORDS.tiedOne : WINNER_WORDS.tiedMany).replace('{n}', fmt(n));
}

/**
 * The winner as plain text (map labels, the figures table, Compare): "DUP", "DUP (most seats)",
 * "Alliance, DUP (tied, 2 seats each)".
 * @param {ContestWinner} w @param {(n: number) => string} fmt
 */
export function winnerText(w, fmt) {
  if (w.kind === 'none') return '—';
  if (w.kind === 'single') return w.parties[0];
  if (w.kind === 'tie') return `${w.parties.join(', ')} (${tiedWords(w.seats, fmt)})`;
  return `${w.parties[0]} (${WINNER_WORDS.mostSeats})`;
}

/**
 * Whether the winner changed between two contests: a different party, or a tie that is not the
 * same tie (the same parties tied either side is no change).
 * @param {ContestWinner} a @param {ContestWinner} b
 */
export function winnerChanged(a, b) {
  if (a.kind === 'none' || b.kind === 'none') return false;
  const key = (/** @type {ContestWinner} */ w) => `${w.kind === 'tie' ? 'tie' : 'one'}:${[...w.parties].sort().join('|')}`;
  return key(a) !== key(b);
}

/**
 * The overview's Result cell of a polled contest (HTML): the winner's name and party for a
 * single seat; for a multi-member seat the party with the most seats, or every tied party, as
 * chips, with the candidate top of the poll.
 * @param {WinnerRow} row
 * @param {(party: string) => string} chip  a party chip (lib/party.js partyChip with the election's colour)
 * @param {(v: unknown) => string} esc @param {(n: number) => string} fmt
 */
export function winnerCellHtml(row, chip, esc, fmt) {
  const w = contestWinner(row);
  if (w.kind === 'single' || w.kind === 'none') return `${esc(w.name || '—')} <span class="el-muted">${esc(w.parties[0] || '')}</span>`;
  const chips = w.parties.map(chip).join(' ');
  return `${chips} <span class="el-muted" data-winner="${w.kind}">${esc(w.kind === 'tie' ? tiedWords(w.seats, fmt) : WINNER_WORDS.mostSeats)}; top: ${esc(row.leadingName || '—')}</span>`;
}

