/**
 * An STV election's party-to-party transfers and closest last seats, on its overview (el-stv,
 * 14 Nov 2026). They need every contest's count, which is large (the election bundle, up to about
 * 300 KB compressed), so they are read only when the reader opens them (state-machines.js
 * STV_TRANSFERS); ?transfers=1 opens them at once, so the view can be shared.
 *
 * The derivations are lib/stv.js (partyTransfers, closestSeats: pure, tested); this module only
 * writes HTML and wires the opening. Every word is keyed in data/i18n/strings/elections.txt (R10).
 */
import { electionBundle } from '../lib/api.js';
import { countSheet } from '../lib/count.js';
import { esc, fmtInt, fmtPct, appUrl } from '../lib/format.js';
import { partyChip } from '../lib/party.js';
import { closestSeats, fill, marginSentence, partyTransfers, transfersSearch } from '../lib/stv.js';
import { STV_TRANSFERS } from '../state-machines.js';

/**
 * @typedef {ReturnType<typeof countSheet>} Sheet
 * @typedef {import('../lib/stv.js').PartyTransfers} PartyTransfers
 */

/** The words of this section (each a line of data/i18n/strings/elections.txt). */
export const STV_ELECTION_TEXT = Object.freeze({
  heading: 'Transfers and close seats',
  open: 'Show the transfers between parties and the closest last seats',
  loading: 'Working out the transfers…',
  failed: 'The counts could not be read. Close and open this section to try again.',
  partiesHeading: 'Transfers between parties',
  covers: 'Built from {n} of the {total} contests, from the {k} counts that passed on one candidate\'s votes.',
  coversOne: 'Built from {n} of the {total} contests, from the {k} count that passed on one candidate\'s votes.',
  pooledLeftOut: '{n} counts that passed on several candidates\' votes together are left out: the source gives each candidate\'s gain, not whose votes it came from.',
  pooledLeftOutOne: '{n} count that passed on several candidates\' votes together is left out: the source gives each candidate\'s gain, not whose votes it came from.',
  noStages: '{n} contests have no stage-by-stage count in the sources Civgraph holds, so they give no transfers.',
  noStagesOne: '{n} contest has no stage-by-stage count in the sources Civgraph holds, so it gives no transfers.',
  caveat: 'Each share is of the votes a party\'s candidates passed on. Where those votes could go depended on which candidates were still in the count, so a share is not a measure of preference.',
  none: 'No count of this election passed on one candidate\'s votes, so there are no transfers between parties to show.',
  from: 'From',
  passedOn: 'Votes passed on',
  transfers: 'Counts',
  nonTransferable: 'Non-transferable',
  tableCaption: 'Transfers between parties: each row the votes passed on by a party\'s candidates, and the share each party\'s candidates received.',
  region: 'Transfers between parties (scrolls sideways)',
  toParty: 'To',
  share: 'Share',
  votes: 'Votes',
  closestHeading: 'The closest last seats',
  closestCovers: 'Margins are given for {n} of the {total} contests: those with a stage-by-stage count and a losing candidate.',
  closestNone: 'No contest of this election has a stage-by-stage count with a losing candidate, so no margins can be given.',
});

/** The section's frame (closed). @param {boolean} open */
export function electionStvHtml(open) {
  return `<section aria-labelledby="el-stv-election-h" data-stv-election>
    <h2 id="el-stv-election-h">${esc(STV_ELECTION_TEXT.heading)}</h2>
    <details class="el-stv-load"${open ? ' open' : ''}><summary>${esc(STV_ELECTION_TEXT.open)}</summary>
      <div class="el-stv-body" aria-live="polite"></div></details>
  </section>`;
}

/**
 * The transfers between parties as HTML: a table, and a list per party for phones.
 * @param {PartyTransfers} pt
 */
export function partyTransfersHtml(pt) {
  const noStages = pt.contestsTotal - pt.contestsWithStages;
  const notes = [
    pt.rows.length ? fill(pt.transfers === 1 ? STV_ELECTION_TEXT.coversOne : STV_ELECTION_TEXT.covers, { n: fmtInt(pt.contests), total: fmtInt(pt.contestsTotal), k: fmtInt(pt.transfers) }) : STV_ELECTION_TEXT.none,
    pt.pooled ? fill(pt.pooled === 1 ? STV_ELECTION_TEXT.pooledLeftOutOne : STV_ELECTION_TEXT.pooledLeftOut, { n: fmtInt(pt.pooled) }) : '',
    noStages ? fill(noStages === 1 ? STV_ELECTION_TEXT.noStagesOne : STV_ELECTION_TEXT.noStages, { n: fmtInt(noStages) }) : '',
  ].filter(Boolean);
  const head = `<h3>${esc(STV_ELECTION_TEXT.partiesHeading)}</h3><p class="el-muted" data-stv-coverage>${notes.map((s) => `<span>${esc(s)}</span>`).join(' ')}</p>`;
  if (!pt.rows.length) return head;
  const anyNt = pt.rows.some((r) => r.nonTransferable > 0);
  const pct = (/** @type {number} */ v, /** @type {number} */ of) => (of > 0 ? fmtPct((100 * v) / of) : '');
  const table = `<div class="cg-table-wrap el-wide-only" tabindex="0" role="region" aria-label="${esc(STV_ELECTION_TEXT.region)}"><table class="cg-table cg-table--compact cg-table--sticky-first el-party-matrix">
    <caption class="el-sr">${esc(STV_ELECTION_TEXT.tableCaption)}</caption>
    <thead><tr><th scope="col">${esc(STV_ELECTION_TEXT.from)}</th><th scope="col" class="num">${esc(STV_ELECTION_TEXT.passedOn)}</th><th scope="col" class="num">${esc(STV_ELECTION_TEXT.transfers)}</th>${pt.parties.map((p) => `<th scope="col" class="num">${esc(p.party)}</th>`).join('')}${anyNt ? `<th scope="col" class="num">${esc(STV_ELECTION_TEXT.nonTransferable)}</th>` : ''}</tr></thead>
    <tbody>${pt.rows.map((r) => `<tr><th scope="row">${partyChip(r.from, r.colour)}</th><td class="num">${fmtInt(r.distributed)}</td><td class="num">${fmtInt(r.transfers)}</td>${pt.parties.map((p) => {
      const v = r.to.get(p.party);
      return `<td class="num">${v === undefined ? '' : `${esc(pct(v, r.distributed))}<span class="el-muted el-share">${fmtInt(v)}</span>`}</td>`;
    }).join('')}${anyNt ? `<td class="num">${r.nonTransferable > 0 ? `${esc(pct(r.nonTransferable, r.distributed))}<span class="el-muted el-share">${fmtInt(r.nonTransferable)}</span>` : ''}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
  const stacked = `<div class="el-narrow-only">${pt.rows.map((r) => {
    const to = [...r.to.entries()].sort((a, b) => b[1] - a[1]);
    const colour = (/** @type {string} */ party) => pt.parties.find((p) => p.party === party)?.colour || '';
    return `<section class="el-stack-count"><h4>${partyChip(r.from, r.colour)} <span class="el-muted">${esc(fmtInt(r.distributed))}</span></h4><table class="cg-table cg-table--compact"><caption class="el-sr">${esc(STV_ELECTION_TEXT.tableCaption)}</caption>
      <thead><tr><th scope="col">${esc(STV_ELECTION_TEXT.toParty)}</th><th scope="col" class="num">${esc(STV_ELECTION_TEXT.share)}</th><th scope="col" class="num">${esc(STV_ELECTION_TEXT.votes)}</th></tr></thead>
      <tbody>${to.map(([party, v]) => `<tr><th scope="row">${partyChip(party, colour(party))}</th><td class="num">${esc(pct(v, r.distributed))}</td><td class="num">${fmtInt(v)}</td></tr>`).join('')}
      ${r.nonTransferable > 0 ? `<tr class="el-nt"><th scope="row">${esc(STV_ELECTION_TEXT.nonTransferable)}</th><td class="num">${esc(pct(r.nonTransferable, r.distributed))}</td><td class="num">${fmtInt(r.nonTransferable)}</td></tr>` : ''}</tbody></table></section>`;
  }).join('')}</div>`;
  return `${head}<p class="el-muted">${esc(STV_ELECTION_TEXT.caveat)}</p>${table}${stacked}`;
}

/**
 * The closest last seats as HTML: one sentence a contest, linked to its page.
 * @param {{ list: Array<{ name: string, href: string | null, margin: import('../lib/stv.js').Margin }>, covered: number, total: number }} closest
 */
export function closestSeatsHtml(closest) {
  const head = `<h3>${esc(STV_ELECTION_TEXT.closestHeading)}</h3>`;
  if (!closest.list.length) return `${head}<p class="el-muted">${esc(STV_ELECTION_TEXT.closestNone)}</p>`;
  return `${head}<p class="el-muted">${esc(fill(STV_ELECTION_TEXT.closestCovers, { n: fmtInt(closest.covered), total: fmtInt(closest.total) }))}</p>
    <ol class="el-closest">${closest.list.map((c) => `<li>${c.href ? `<a href="${esc(c.href)}">${esc(c.name)}</a>` : esc(c.name)}: <span>${esc(marginSentence(c.margin))}</span></li>`).join('')}</ol>`;
}

/**
 * The contests of an election bundle as count sheets, with their names and contest URLs.
 * @param {Array<Record<string, unknown>>} results  the bundle's results
 * @param {string} key  the election key
 * @param {Map<string, string[]>} slugsByName  views/election.js contestSlugs (a fresh copy: it is consumed)
 * @param {unknown} contestStatus  the election's contest status
 */
export function bundleSheets(results, key, slugsByName, contestStatus) {
  return results.map((r) => {
    const name = String(r.constituency || '');
    const slug = slugsByName.get(name)?.shift() || null;
    const sheet = countSheet(/** @type {Array<Record<string, unknown>>} */ (r.candidates || []), {
      quota: r.quota, validPoll: r.validPoll ?? r.totalVotes, seatsTotal: r.seatsTotal, nonTransferable: r.nonTransferable, contestStatus: r.contestStatus || contestStatus,
    });
    return { sheet, name, href: slug ? appUrl.contest(key, slug) : null };
  });
}

/**
 * Wire the section: read the bundle the first time it is opened (or at once with ?transfers=1),
 * and keep ?transfers=1 in the URL while it is open.
 * @param {HTMLElement} root
 * @param {{ key: string, contestStatus?: unknown }} detail
 * @param {Map<string, string[]>} slugsByName
 * @param {{ signal: AbortSignal, stale: () => boolean }} ctx
 */
export function wireElectionStv(root, detail, slugsByName, ctx) {
  const section = root.querySelector('[data-stv-election]');
  const details = /** @type {HTMLDetailsElement | null} */ (section?.querySelector('details') || null);
  const body = /** @type {HTMLElement | null} */ (section?.querySelector('.el-stv-body') || null);
  if (!details || !body) return;
  const run = STV_TRANSFERS.start();
  const load = async () => {
    if (run.state() === 'loading' || run.state() === 'shown') return;
    run.to('loading');
    body.innerHTML = `<p class="el-muted">${esc(STV_ELECTION_TEXT.loading)}</p>`;
    try {
      const bundle = await electionBundle(detail.key);
      if (ctx.stale()) return;
      const contests = bundleSheets(/** @type {Array<Record<string, unknown>>} */ (bundle.results || []), detail.key, slugsByName, detail.contestStatus);
      body.innerHTML = partyTransfersHtml(partyTransfers(contests.map((c) => c.sheet))) + closestSeatsHtml(closestSeats(contests, 10));
      run.to('shown');
    } catch {
      if (ctx.stale()) return;
      body.innerHTML = `<p class="cg-notice cg-notice--warning">${esc(STV_ELECTION_TEXT.failed)}</p>`;
      run.to('failed');
    }
  };
  details.addEventListener('toggle', () => {
    history.replaceState(history.state, '', `${location.pathname}${transfersSearch(location.search, details.open)}${location.hash}`);
    if (details.open) load();
  }, { signal: ctx.signal });
  if (details.open) load();
}
