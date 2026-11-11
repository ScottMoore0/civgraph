/**
 * An election overview (/elections/<election-slug>/): seats and votes by party with the change
 * since the previous election, a seat chart, turnout, and every contest. Reads the election's
 * Browse detail (party summary, totals, contests) and summary (one row per contest); the
 * previous election's detail for the change.
 */
import { bodyElections, electionDetail, electionSummary } from '../lib/api.js';
import { hbars, parliamentArc, seatBar } from '../lib/charts.js';
import {
  appUrl, electionSlug, esc, fmtDate, fmtDelta, fmtInt, fmtPct, isStv, median, num, partyChip, positive, summaryHasVotes, summaryUnopposed, systemName,
} from '../lib/format.js';

/**
 * The party table rows with change against the previous election.
 * @param {Array<{ party: string, seats: number, stood: number, votes: number, share: number, colour: string }>} parties
 * @param {Array<{ party: string, seats: number, share: number }> | null} previous
 * @param {{ votes: boolean, prevVotes: boolean }} has
 */
export function partyRows(parties, previous, has) {
  const prev = new Map((previous || []).map((p) => [p.party, p]));
  const rows = parties.map((p) => {
    const q = prev.get(p.party);
    return {
      ...p,
      seatChange: previous ? (num(p.seats) || 0) - (num(q?.seats) || 0) : null,
      shareChange: previous && has.votes && has.prevVotes ? (num(p.share) || 0) - (num(q?.share) || 0) : null,
      isNew: !!previous && !q,
    };
  });
  // Parties that stood last time and not now: shown with their losses.
  const gone = previous ? previous.filter((q) => !parties.some((p) => p.party === q.party) && (num(q.seats) || 0) > 0)
    .map((q) => ({ party: q.party, seats: 0, stood: 0, votes: 0, share: 0, colour: /** @type {any} */ (q).colour, seatChange: -(num(q.seats) || 0), shareChange: has.votes && has.prevVotes ? -(num(q.share) || 0) : null, isNew: false, gone: true })) : [];
  return [...rows, ...gone].sort((a, b) => (b.seats || 0) - (a.seats || 0) || (b.votes || 0) - (a.votes || 0));
}

export async function render(root, route) {
  const slug = /** @type {string} */ (route.election);
  const [detail, summary] = await Promise.all([electionDetail(slug), electionSummary(slug)]);
  const index = await bodyElections(detail.bodySlug);
  const key = detail.key;
  const results = summary.results || [];
  const prevKey = detail.previousKey || null;
  const prevAny = prevKey ? await electionDetail(prevKey).catch(() => null) : null;
  // Change is shown between general elections only: a by-election's "previous election" is the
  // body's last general election, a different set of seats.
  const prevDetail = prevAny && detail.kind !== 'by-election' && prevAny.kind !== 'by-election' ? prevAny : null;
  const sameBody = index.filter((e) => e.bodySlug === detail.bodySlug).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const pos = sameBody.findIndex((e) => e.key === key);
  const before = pos > 0 ? sameBody[pos - 1] : null;
  const after = pos >= 0 && pos < sameBody.length - 1 ? sameBody[pos + 1] : null;

  const parties = (detail.partySummary || []).filter((p) => p.party);
  const withVotes = results.filter(summaryHasVotes).length;
  const unopposed = results.filter(summaryUnopposed).length;
  const votes = withVotes > 0;
  const prevVotes = !!prevDetail && (num(prevDetail.totals?.validPoll) || 0) > 0;
  const rows = partyRows(parties, prevDetail ? prevDetail.partySummary || [] : null, { votes, prevVotes });
  const seats = num(detail.totals?.seats) ?? parties.reduce((s, p) => s + (p.seats || 0), 0);
  const turnouts = results.map((r) => positive(r.turnoutPct)).filter((v) => v !== null);
  const turnoutMedian = median(turnouts);
  const referendum = detail.contestType && detail.contestType !== 'election';

  const chartParties = parties.filter((p) => p.seats > 0).map((p) => ({ party: p.party, seats: p.seats, colour: p.colour }));
  const seatChart = referendum ? '' : seats >= 30 ? parliamentArc(chartParties, { title: `${seats} seats: ${chartParties.map((p) => `${p.party} ${p.seats}`).join(', ')}` })
    : seatBar(chartParties, { title: `${seats} seats: ${chartParties.map((p) => `${p.party} ${p.seats}`).join(', ')}` });
  const shareChart = votes && !referendum ? hbars(parties.filter((p) => p.votes > 0).sort((a, b) => b.share - a.share).slice(0, 12).map((p) => ({ label: p.party, value: Math.round(p.share * 10) / 10, colour: p.colour })),
    { title: 'Share of the vote by party', format: (v) => fmtPct(v) }) : '';

  const voteNote = !votes ? '<p class="el-muted">No votes are recorded for this election: every seat was returned unopposed or only the members returned are known.</p>'
    : withVotes < results.length ? `<p class="el-muted">Votes are recorded in ${withVotes} of ${results.length} contests${unopposed ? ` (${unopposed} returned unopposed)` : ''}; shares are of the votes cast where there was a poll.</p>` : '';

  // A contest's own URL: the detail's result entries, paired with the summary's rows by name
  // (both list the contests in the same order; same-named contests are taken in turn).
  const slugsByName = contestSlugs(detail.resultEntries || []);
  const contestRows = results.map((r) => {
    const cslug = slugsByName.get(r.constituency)?.shift() || null;
    const name = cslug ? `<a href="${appUrl.contest(key, cslug)}">${esc(r.constituency)}</a>` : esc(r.constituency);
    const un = summaryUnopposed(r);
    const polled = summaryHasVotes(r);
    const result = un ? `<span class="cg-badge">Returned unopposed</span> <span class="el-muted">${esc(r.winnerName || '')}</span>`
      : !polled ? `${esc(r.winnerName || '—')} <span class="el-muted">votes not recorded</span>`
      : (r.seatsTotal || 1) > 1 ? `${partyChip(r.winnerParty, null)} <span class="el-muted">most seats; top: ${esc(r.leadingName || '—')}</span>`
        : `${esc(r.leadingName || r.winnerName || '—')} <span class="el-muted">${esc(r.leadingParty || r.winnerParty || '')}</span>`;
    return `<tr><th scope="row">${name}</th><td class="num">${fmtInt(r.seatsTotal)}</td><td>${result}</td>`
      + `<td class="num">${polled ? fmtInt(r.validPoll) : '—'}</td><td class="num">${fmtPct(positive(r.turnoutPct))}</td>`
      + `<td class="num">${!polled ? '—' : isStv(detail.votingSystem) ? fmtInt(positive(r.quota)) : fmtInt(positive(r.majority))}</td></tr>`;
  }).join('');

  const refs = (detail.references || []).map((r) => `<li><a href="${esc(r.url)}" rel="noopener">${esc(r.label)}</a>${r.note ? ` <span class="el-muted">${esc(r.note)}</span>` : ''}</li>`).join('');

  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › <a href="${appUrl.body(detail.bodySlug)}">${esc(detail.body)}</a> › ${esc(fmtDate(detail.date))}</nav>
    <header class="el-head">
      <h1>${esc(detail.title)}</h1>
      <p class="el-lead">${esc(fmtDate(detail.date))} · ${esc(detail.kind === 'by-election' ? 'by-election' : detail.kind || '')} · ${esc(systemName(detail.votingSystem))}</p>
      <p class="el-nav">${before ? `<a href="${appUrl.election(before.key)}">← ${esc(before.displayTitle)}</a>` : ''}${after ? `<a href="${appUrl.election(after.key)}">${esc(after.displayTitle)} →</a>` : ''}</p>
    </header>
    <dl class="cg-facts">
      <dt>Seats</dt><dd>${fmtInt(seats)}</dd>
      <dt>Contests</dt><dd>${fmtInt(results.length)}${unopposed ? ` (${unopposed} returned unopposed)` : ''}</dd>
      ${votes ? `<dt>Valid votes</dt><dd>${fmtInt(detail.totals?.validPoll)}</dd>` : ''}
      <dt>Turnout</dt><dd>${turnouts.length ? `median ${fmtPct(turnoutMedian)} across ${turnouts.length} contest${turnouts.length === 1 ? '' : 's'} (range ${fmtPct(Math.min(...turnouts))}–${fmtPct(Math.max(...turnouts))})` : 'not recorded'}</dd>
      ${prevAny ? `<dt>Previous</dt><dd><a href="${appUrl.election(prevKey)}">${esc(prevAny.title)}</a></dd>` : ''}
      <dt>Elsewhere</dt><dd><a href="/browse/elections/${esc(electionSlug(key))}">Browse record</a>${detail.interactiveUrl && detail.layerId ? ` · <a href="${esc(detail.interactiveUrl)}">on the map</a>` : ''} · <a href="/elections/map/?e=${encodeURIComponent(electionSlug(key))}">results map</a> · <a href="/elections/pivot/?body=${encodeURIComponent(detail.bodySlug)}&amp;election=${encodeURIComponent(key)}">pivot</a></dd>
    </dl>
    ${voteNote}
    <div class="el-grid">
      ${seatChart ? `<figure class="cg-chart el-seatchart">${seatChart}<figcaption>Seats won${prevDetail ? ' (the table gives the change since the previous election)' : ''}.</figcaption></figure>` : ''}
      ${shareChart ? `<figure class="cg-chart">${shareChart}<figcaption>Share of the vote${withVotes < results.length ? ' in contests with a poll' : ''}.</figcaption></figure>` : ''}
    </div>
    <section aria-labelledby="el-parties"><h2 id="el-parties">${referendum ? 'Result' : 'Parties'}</h2>
      <div class="cg-table-wrap"><table class="cg-table el-parties">
        <thead><tr><th scope="col">Party</th><th scope="col" class="num">Seats</th>${prevDetail ? '<th scope="col" class="num">±</th>' : ''}<th scope="col" class="num">Candidates</th>${votes ? '<th scope="col" class="num">Votes</th><th scope="col" class="num">Share</th>' : ''}${votes && prevVotes ? '<th scope="col" class="num">± pts</th>' : ''}</tr></thead>
        <tbody>${rows.map((p) => `<tr${p.gone ? ' class="el-gone"' : ''}><th scope="row">${partyChip(p.party, p.colour)}${p.isNew ? ' <span class="cg-badge">new</span>' : ''}${p.gone ? ' <span class="el-muted">(did not stand)</span>' : ''}</th>`
          + `<td class="num">${fmtInt(p.seats)}</td>${prevDetail ? `<td class="num ${deltaClass(p.seatChange)}">${fmtDelta(p.seatChange)}</td>` : ''}<td class="num">${p.gone ? '' : fmtInt(p.stood)}</td>`
          + `${votes ? `<td class="num">${p.gone ? '' : fmtInt(p.votes)}</td><td class="num">${p.gone ? '' : fmtPct(p.share)}</td>` : ''}${votes && prevVotes ? `<td class="num ${deltaClass(p.shareChange)}">${fmtDelta(p.shareChange, 1)}</td>` : ''}</tr>`).join('')}</tbody>
      </table></div>
      ${prevDetail && votes && !prevVotes ? '<p class="el-muted">No vote change is given: the previous election has no recorded votes.</p>' : ''}
    </section>
    <section aria-labelledby="el-contests"><h2 id="el-contests">Contests</h2>
      <div class="cg-table-wrap"><table class="cg-table cg-table--compact el-contests">
        <thead><tr><th scope="col">Contest</th><th scope="col" class="num">Seats</th><th scope="col">Result</th><th scope="col" class="num">Valid poll</th><th scope="col" class="num">Turnout</th><th scope="col" class="num">${isStv(detail.votingSystem) ? 'Quota' : 'Majority'}</th></tr></thead>
        <tbody>${contestRows}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="el-sources"><h2 id="el-sources">Sources</h2>
      <p>Each contest page lists the sources of its own figures. For the election as a whole:</p>
      <ul class="cg-citations">${refs || '<li>No election-level references recorded.</li>'}</ul>
    </section>`;
  return detail.title;
}

/**
 * Contest slugs by contest name, from an election detail's result entries (the overall entry
 * left out). A key is "<election key>::<contest slug>".
 * @param {Array<{ key?: string, resultName?: string, resultKind?: string }>} entries
 */
export function contestSlugs(entries) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const e of entries) {
    if (e.resultKind && e.resultKind !== 'constituency-result') continue;
    const slug = String(e.key || '').split('::')[1];
    if (!slug || !e.resultName) continue;
    if (!out.has(e.resultName)) out.set(e.resultName, []);
    /** @type {string[]} */ (out.get(e.resultName)).push(slug);
  }
  return out;
}

const deltaClass = (v) => (v > 0 ? 'cg-delta--positive' : v < 0 ? 'cg-delta--negative' : '');
