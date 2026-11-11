/**
 * Compare two elections (/elections/compare/?a=<election>&b=<election>): seats and votes by
 * party side by side with the change, and contest by contest where the two share contest names.
 * Defaults to an election and the one before it.
 */
import { bodyElections, electionDetail, electionIndex, electionSummary, must } from '../lib/api.js';
import { parliamentArc, seatBar } from '../lib/charts.js';
import { appUrl, electionSlug, esc, fmtDelta, fmtInt, fmtPct, partyChip, summaryHasVotes } from '../lib/format.js';
import { partyRows } from './election.js';

/** @param {any} d */
const seatChart = (d) => {
  const ps = (d.partySummary || []).filter((/** @type {any} */ p) => p.seats > 0).map((/** @type {any} */ p) => ({ party: p.party, seats: p.seats, colour: p.colour }));
  const n = ps.reduce((/** @type {number} */ s, /** @type {{ seats: number }} */ p) => s + p.seats, 0);
  return n >= 30 ? parliamentArc(ps, { title: `${d.title}: ${n} seats` }) : seatBar(ps, { title: `${d.title}: ${n} seats` });
};

/**
 * @param {HTMLElement} root
 * @param {{ query: URLSearchParams }} route
 * @param {{ navigate: (href: string, o?: any) => Promise<void> }} ctx
 */
export async function render(root, route, ctx) {
  const index = (await electionIndex()).filter((/** @type {any} */ e) => e.contestType === 'election');
  const find = (/** @type {string | null} */ s) => (s ? index.find((/** @type {any} */ e) => electionSlug(e.key) === s || e.key === s) : null);
  const b = must(find(route.query.get('b')) || index.filter((e) => e.bodySlug === 'northern-ireland-assembly').at(-1) || index.at(-1), 'election');
  const bDetail = await electionDetail(b.key);
  const a = find(route.query.get('a')) || (bDetail.previousKey ? find(bDetail.previousKey) : null) || b;
  if (!a) throw new Error('no election to compare');
  const [aDetail, aSum, bSum, aBody] = await Promise.all([electionDetail(a.key), electionSummary(a.key), electionSummary(b.key), bodyElections(a.bodySlug)]);
  const bBody = a.bodySlug === b.bodySlug ? aBody : await bodyElections(b.bodySlug);
  const votesA = (aSum.results || []).some(summaryHasVotes);
  const votesB = (bSum.results || []).some(summaryHasVotes);
  const rows = partyRows(bDetail.partySummary || [], aDetail.partySummary || [], { votes: votesB, prevVotes: votesA });
  const prev = new Map((aDetail.partySummary || []).map((/** @type {any} */ p) => [p.party, p]));
  /** @type {Map<string, any>} */
  const aBy = new Map((aSum.results || []).map((/** @type {any} */ r) => [r.constituency, r]));
  const shared = (bSum.results || []).filter((/** @type {any} */ r) => aBy.has(r.constituency));
  const sameLayer = a.layerId && a.layerId === b.layerId;
  const picker = (/** @type {string} */ id, /** @type {any[]} */ list, /** @type {any} */ sel) => `<select id="${id}">${list.map((e) => `<option value="${esc(electionSlug(e.key))}"${e.key === sel.key ? ' selected' : ''}>${esc(e.displayTitle)}</option>`).join('')}</select>`;
  const bodies = [...new Map(index.map((/** @type {any} */ e) => [e.bodySlug, e.body])).entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1])));

  root.innerHTML = `
    <header class="el-head"><h1>Compare elections</h1></header>
    <form class="el-controls" id="cmp-form" onsubmit="return false">
      <label>Body <select id="cmp-body-a">${bodies.map(([s, n]) => `<option value="${esc(s)}"${s === a.bodySlug ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Earlier ${picker('cmp-a', aBody, a)}</label>
      <label>Body <select id="cmp-body-b">${bodies.map(([s, n]) => `<option value="${esc(s)}"${s === b.bodySlug ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Later ${picker('cmp-b', bBody, b)}</label>
    </form>
    ${a.bodySlug !== b.bodySlug ? '<p class="cg-notice cg-notice--warning">These are elections to different bodies: the parties are matched by their ballot labels only.</p>' : ''}
    <div class="el-grid">
      <figure class="cg-chart">${seatChart(aDetail)}<figcaption><a href="${appUrl.election(a.key)}">${esc(aDetail.title)}</a></figcaption></figure>
      <figure class="cg-chart">${seatChart(bDetail)}<figcaption><a href="${appUrl.election(b.key)}">${esc(bDetail.title)}</a></figcaption></figure>
    </div>
    <h2>Parties</h2>
    <div class="cg-table-wrap"><table class="cg-table cg-table--compact">
      <thead><tr><th scope="col">Party</th><th scope="col" class="num">Seats, earlier</th><th scope="col" class="num">Seats, later</th><th scope="col" class="num">±</th>${votesA && votesB ? '<th scope="col" class="num">Share, earlier</th><th scope="col" class="num">Share, later</th><th scope="col" class="num">± pts</th>' : ''}</tr></thead>
      <tbody>${rows.map((p) => { const q = /** @type {any} */ (prev.get(p.party)); return `<tr><th scope="row">${partyChip(p.party, p.colour)}</th><td class="num">${fmtInt(q?.seats ?? 0)}</td><td class="num">${fmtInt(p.seats)}</td><td class="num">${fmtDelta(p.seatChange)}</td>${votesA && votesB ? `<td class="num">${fmtPct(q?.share ?? 0)}</td><td class="num">${fmtPct(p.share)}</td><td class="num">${fmtDelta(p.shareChange, 1)}</td>` : ''}</tr>`; }).join('')}</tbody>
    </table></div>
    ${!(votesA && votesB) ? '<p class="el-muted">Vote shares are compared only when both elections have recorded votes.</p>' : ''}
    <h2>Contest by contest</h2>
    ${shared.length ? `<p class="el-muted">${shared.length} contests have the same name in both elections${sameLayer ? ' and the same boundaries' : '; the boundaries may differ'}. ${sameLayer ? `<a href="/elections/map/?e=${encodeURIComponent(electionSlug(b.key))}&amp;mode=swing&amp;vs=${encodeURIComponent(electionSlug(a.key))}">Map the change</a>.` : ''}</p>
    <div class="cg-table-wrap"><table class="cg-table cg-table--compact"><thead><tr><th scope="col">Contest</th><th scope="col">Earlier</th><th scope="col">Later</th><th scope="col" class="num">Turnout ±</th></tr></thead><tbody>${shared.map((/** @type {any} */ r) => {
      const o = aBy.get(r.constituency);
      const w = (/** @type {any} */ x) => (x.seatsTotal > 1 ? `${esc(x.winnerParty || '—')} (most seats)` : `${esc(x.leadingName || x.winnerName || '—')} (${esc(x.leadingParty || x.winnerParty || '')})`);
      const changed = (o.seatsTotal > 1 ? o.winnerParty : o.leadingParty || o.winnerParty) !== (r.seatsTotal > 1 ? r.winnerParty : r.leadingParty || r.winnerParty);
      const t = Number(r.turnoutPct) > 0 && Number(o.turnoutPct) > 0 ? fmtDelta(r.turnoutPct - o.turnoutPct, 1) : '';
      return `<tr${changed ? ' class="el-changed"' : ''}><th scope="row">${esc(r.constituency)}</th><td>${w(o)}</td><td>${w(r)}${changed ? ' <span class="cg-badge cg-badge--warning">changed</span>' : ''}</td><td class="num">${t}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="el-muted">No contest has the same name in both elections (boundaries changed). See the notional results view.</p>'}`;

  root.querySelector('#cmp-form')?.addEventListener('change', async (e) => {
    const t = /** @type {HTMLSelectElement} */ (e.target);
    const u = new URLSearchParams({ a: electionSlug(a.key), b: electionSlug(b.key) });
    if (t.id === 'cmp-a') u.set('a', t.value);
    if (t.id === 'cmp-b') u.set('b', t.value);
    if (t.id === 'cmp-body-a' || t.id === 'cmp-body-b') {
      const list = await bodyElections(t.value);
      const last = list.filter((/** @type {any} */ x) => x.kind !== 'by-election').at(-1) || list.at(-1);
      if (last) u.set(t.id === 'cmp-body-a' ? 'a' : 'b', electionSlug(last.key));
    }
    ctx.navigate(`/elections/compare/?${u}`, { replace: true, keepScroll: true });
  });
  return `Compare: ${aDetail.title} and ${bDetail.title}`;
}
