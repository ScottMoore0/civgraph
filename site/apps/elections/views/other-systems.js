/**
 * "Same votes, other systems" on an election's page (el-context, 14 Nov 2026): a closed panel that,
 * when the reader opens it, loads the election's votes and shows the seats under other systems
 * (lib/other-systems.js), marked as illustrative arithmetic with a methods note. Not a route: the
 * election view includes it (otherSystemsSection) and wires it (mountOtherSystems).
 */
import { electionBundle } from '../lib/api.js';
import { seatBar } from '../lib/charts.js';
import { esc, fmtDelta, fmtInt, fmtPct, isStv } from '../lib/format.js';
import { compareSystems, rowShown, systemsOffered } from '../lib/other-systems.js';
import { partyChip } from '../lib/party.js';
import { OTHER_SYSTEMS } from '../state-machines.js';

/** Every fixed text of the panel (keys of data/i18n/strings/elections.txt). */
export const SYSTEMS_TEXT = Object.freeze({
  heading: 'Same votes, other systems',
  lead: 'Illustrative arithmetic, not a prediction: the seats the same votes would give under other ways of counting them.',
  open: 'Work out the seats under other systems',
  loading: 'Working it out…',
  failed: 'The votes of this election could not be loaded.',
  system: 'Other systems are worked out only for elections counted by STV or by first past the post.',
  blockVote: 'Not worked out: this election used the block vote, where each voter had several votes, so its votes are not first preferences.',
  noVotes: 'Not worked out: no contest of this election has all its votes recorded.',
  party: 'Party',
  firstPrefs: 'First preferences',
  votes: 'Votes',
  share: 'Share',
  total: 'Total',
  folded: 'Parties with no seat under any system and under 1% of the vote are left out of the table, not the arithmetic.',
  method: 'How it is worked out',
  mSame: 'Every party keeps exactly the votes it won: no tactical voting, no change of candidates, the same constituencies.',
  mFirst: 'Only first preferences are used: the transfers of an STV count are left out.',
  mDhondt: "D'Hondt gives each seat in turn to the list with the most votes divided by 1, 2, 3 and so on (one more than the seats it holds).",
  mSainte: 'Sainte-Laguë does the same with the divisors 1, 3, 5 and so on, which is kinder to smaller lists.',
  mPr: 'Pure PR shares out all the seats as one area: each list gets a seat for every full quota of votes (all the votes divided by the seats), and the seats left go to the largest remainders.',
  mFptp: 'First past the post gives each constituency to the candidate with the most first preferences.',
  mLists: 'A party is the label on the ballot paper as recorded. A candidate with no party, or with a label beginning "Independent", stands alone and can win one seat at most.',
  mTies: 'A tie goes to the list with more votes.',
  chartsCaption: 'Seats under each system, in the order of the table.',
});

/** Column headings (the actual system's name is the registry's, from the view). */
const COLUMN = Object.freeze({
  dhondtByArea: "D'Hondt, by constituency",
  sainteByArea: 'Sainte-Laguë, by constituency',
  dhondtAll: "D'Hondt, all seats as one area",
  sainteAll: 'Sainte-Laguë, all seats as one area',
  fptp: 'First past the post',
  pr: 'Pure PR, all seats as one area',
  actual: 'Actual seats',
});
/** Sentences with numbers ({n}, {k}): the singular and the plural wording. */
const KEPT = Object.freeze(['{n} seat returned without a poll, or in a contest whose votes are not all recorded, keeps its actual result under every system.', '{n} seats returned without a poll, or in contests whose votes are not all recorded, keep their actual result under every system.']);
const SCOPE_AREA = 'In multi-member contests, D\'Hondt and Sainte-Laguë share out each constituency\'s own seats.';
const SCOPE_ALL = 'Every contest elects one member, so D\'Hondt and Sainte-Laguë by constituency would repeat first past the post: here they share out all the seats as one area.';

/** Every text and pattern, for the key test. */
export const SYSTEMS_STRINGS = Object.freeze([...Object.values(SYSTEMS_TEXT), ...Object.values(COLUMN), ...KEPT, SCOPE_AREA, SCOPE_ALL]);

/**
 * The panel's markup (closed until the reader opens it), or '' for an election it cannot work from
 * (a list or ordinal system, the block vote).
 * @param {string | null | undefined} votingSystem @param {ReadonlyArray<{ seatsTotal?: unknown }>} contests the summary's rows
 */
export function otherSystemsSection(votingSystem, contests) {
  if (!systemsOffered(votingSystem, contests)) return '';
  return `<section aria-labelledby="el-systems" class="el-systems"><h2 id="el-systems">${esc(SYSTEMS_TEXT.heading)}</h2>
    <p class="cg-notice cg-notice--warning">${esc(SYSTEMS_TEXT.lead)}</p>
    <details data-el-systems><summary>${esc(SYSTEMS_TEXT.open)}</summary><div data-el-systems-body aria-live="polite"></div></details>
  </section>`;
}

/**
 * Wire the panel: the first opening loads the election's votes and draws the comparison.
 * @param {HTMLElement} root the view root
 * @param {{ key: string, votingSystem?: string | null, partySummary?: Array<{ party: string, colour?: string | null }> | null }} detail
 * @param {import('../app.js').ViewContext} ctx
 */
export function mountOtherSystems(root, detail, ctx) {
  const box = /** @type {HTMLDetailsElement | null} */ (root.querySelector('[data-el-systems]'));
  const body = /** @type {HTMLElement | null} */ (root.querySelector('[data-el-systems-body]'));
  if (!box || !body) return;
  const run = OTHER_SYSTEMS.start();
  box.dataset.state = run.state();
  const colours = new Map((detail.partySummary || []).map((p) => [p.party, String(p.colour || '')]));
  box.addEventListener('toggle', async () => {
    if (!box.open || (run.state() !== 'idle' && run.state() !== 'failed')) return;
    box.dataset.state = run.to('loading');
    body.innerHTML = `<p class="el-loading">${esc(SYSTEMS_TEXT.loading)}</p>`;
    try {
      const bundle = await electionBundle(detail.key);
      if (ctx.stale()) return;
      const results = /** @type {import('../lib/other-systems.js').BundleResult[]} */ (Array.isArray(bundle.results) ? bundle.results : []);
      const cmp = compareSystems(results, detail.votingSystem, colours);
      body.innerHTML = systemsHtml(cmp, isStv(detail.votingSystem));
      box.dataset.state = run.to(cmp.applicable ? 'shown' : 'not-applicable');
    } catch (err) {
      if (ctx.stale()) return;
      body.innerHTML = `<p class="cg-notice cg-notice--danger">${esc(SYSTEMS_TEXT.failed)}</p>`;
      box.dataset.state = run.to('failed');
      console.error(err);
    }
  }, { signal: ctx.signal });
}

/**
 * The comparison as HTML: the table, a seat bar per system, the methods note.
 * @param {import('../lib/other-systems.js').SystemsComparison} cmp
 * @param {boolean} stv
 */
export function systemsHtml(cmp, stv) {
  if (!cmp.applicable) {
    const why = cmp.reason === 'block-vote' ? SYSTEMS_TEXT.blockVote : cmp.reason === 'no-votes' ? SYSTEMS_TEXT.noVotes : SYSTEMS_TEXT.system;
    return `<p class="cg-notice">${esc(why)}</p>`;
  }
  const columnHeading = (/** @type {import('../lib/other-systems.js').SystemId} */ id) => (
    id === 'actual' ? COLUMN.actual
      : id === 'fptp' ? COLUMN.fptp
        : id === 'pr' ? COLUMN.pr
          : id === 'dhondt' ? (cmp.singleMember ? COLUMN.dhondtAll : COLUMN.dhondtByArea)
            : (cmp.singleMember ? COLUMN.sainteAll : COLUMN.sainteByArea));
  const shown = cmp.rows.filter((r) => rowShown(r));
  const folded = shown.length < cmp.rows.length;
  const cell = (/** @type {import('../lib/other-systems.js').SystemsRow} */ r, /** @type {import('../lib/other-systems.js').SystemId} */ id) => {
    const n = r.seats[id];
    if (id === 'actual') return `<td class="num">${fmtInt(n)}</td>`;
    const d = n - r.seats.actual;
    return `<td class="num">${fmtInt(n)}${d ? ` <span class="el-muted ${d > 0 ? 'cg-delta--positive' : 'cg-delta--negative'}">(${fmtDelta(d)})</span>` : ''}</td>`;
  };
  const table = `<div class="cg-table-wrap"><table class="cg-table cg-table--compact el-systems-table">
    <caption class="el-sr">${esc(SYSTEMS_TEXT.heading)}</caption>
    <thead><tr><th scope="col">${esc(SYSTEMS_TEXT.party)}</th><th scope="col" class="num">${esc(stv ? SYSTEMS_TEXT.firstPrefs : SYSTEMS_TEXT.votes)}</th><th scope="col" class="num">${esc(SYSTEMS_TEXT.share)}</th>${cmp.columns.map((id) => `<th scope="col" class="num">${esc(columnHeading(id))}</th>`).join('')}</tr></thead>
    <tbody>${shown.map((r) => `<tr><th scope="row">${partyChip(r.party, r.colour)}</th><td class="num">${fmtInt(r.votes)}</td><td class="num">${fmtPct(r.share)}</td>${cmp.columns.map((id) => cell(r, id)).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">${esc(SYSTEMS_TEXT.total)}</th><td class="num">${fmtInt(cmp.votes)}</td><td></td>${cmp.columns.map((id) => `<td class="num">${fmtInt(cmp.rows.reduce((s, r) => s + r.seats[id], 0))}</td>`).join('')}</tr></tfoot>
  </table></div>`;
  const bars = `<figure class="cg-chart"><div class="el-systems-bars">${cmp.columns.map((id) => {
    const parties = shown.map((r) => ({ party: r.party, seats: r.seats[id], colour: r.colour }));
    const title = `${columnHeading(id)}: ${parties.filter((p) => p.seats).map((p) => `${p.party} ${p.seats}`).join(', ')}`;
    return `<div><p class="el-muted">${esc(columnHeading(id))}</p>${seatBar(parties, { title })}</div>`;
  }).join('')}</div><figcaption>${esc(SYSTEMS_TEXT.chartsCaption)}</figcaption></figure>`;
  const kept = cmp.keptSeats ? `<p class="el-muted">${esc((cmp.keptSeats === 1 ? /** @type {string} */ (KEPT[0]) : /** @type {string} */ (KEPT[1])).replace('{n}', fmtInt(cmp.keptSeats)))}</p>` : '';
  const method = `<details class="el-systems-method"><summary>${esc(SYSTEMS_TEXT.method)}</summary><ul>
    <li>${esc(SYSTEMS_TEXT.mSame)}</li>
    ${stv ? `<li>${esc(SYSTEMS_TEXT.mFirst)}</li>` : ''}
    <li>${esc(cmp.singleMember ? SCOPE_ALL : SCOPE_AREA)}</li>
    <li>${esc(SYSTEMS_TEXT.mDhondt)}</li>
    <li>${esc(SYSTEMS_TEXT.mSainte)}</li>
    ${cmp.columns.includes('fptp') ? `<li>${esc(SYSTEMS_TEXT.mFptp)}</li>` : ''}
    <li>${esc(SYSTEMS_TEXT.mPr)}</li>
    <li>${esc(SYSTEMS_TEXT.mLists)}</li>
    <li>${esc(SYSTEMS_TEXT.mTies)}</li>
  </ul></details>`;
  return `${table}${folded ? `<p class="el-muted">${esc(SYSTEMS_TEXT.folded)}</p>` : ''}${kept}${bars}${method}`;
}
