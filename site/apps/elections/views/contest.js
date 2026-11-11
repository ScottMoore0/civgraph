/**
 * A contest (/elections/<election-slug>/<contest-slug>/): the full count sheet where the records
 * hold stage totals, the transfers of each stage, quota progress, an honest "Returned unopposed",
 * and the contest's sources with what each one covers.
 */
import { contestCitations, contestResult, electionDetail } from '../lib/api.js';
import { quotaBars, transferFlow } from '../lib/charts.js';
import { cellAt, countSheet, fptpMajority, quotaProgress, transferStages } from '../lib/count.js';
import {
  appUrl, electionSlug, esc, fmtDate, fmtDelta, fmtInt, fmtPct, isStv, num, personUrl, systemName,
} from '../lib/format.js';
import { partyChip } from '../lib/party.js';

/** @type {Record<string, string>} */
const KIND_NOTE = {
  stages: 'The full count, stage by stage, as the sources give it.',
  order: 'The sources give the first preferences and the count at which each candidate was elected or excluded, but not the totals at each count, so no transfers are shown.',
  single: '',
  unopposed: 'No poll was held: the members below were returned unopposed.',
  none: 'No votes are recorded for this contest in the sources Civgraph holds; only the candidates are known.',
};

/** @param {HTMLElement} root @param {import('../lib/route.js').Route} route */
export async function render(root, route) {
  const eslug = /** @type {string} */ (route.election);
  const cslug = /** @type {string} */ (route.contest);
  const detail = await electionDetail(eslug);
  const result = await contestResult(detail.key, cslug);
  const cites = await contestCitations(detail.key, Number(result.constituency?.seq)).catch(() => ({ citations: [] }));
  const c = result.constituency || {};
  const stv = isStv(detail.votingSystem);
  const sheet = countSheet(result.candidates || [], {
    quota: c.quota, validPoll: c.validPoll ?? c.totalVotes, seatsTotal: c.seatsTotal, nonTransferable: c.nonTransferable,
    contestStatus: c.contestStatus || detail.contestStatus,
  });
  const valid = sheet.validPoll;
  const share = (/** @type {number | null} */ v) => (v !== null && valid ? (100 * v) / valid : null);
  const majority = !stv ? (num(c.majority) ?? fptpMajority(sheet)) : null;
  const turnout = num(c.turnoutPct) ?? (num(c.totalPoll) !== null && num(c.electorate) ? (100 * Number(c.totalPoll)) / Number(c.electorate) : null);
  const title = `${c.name || c.constituency} – ${detail.title}`;

  const facts = [
    ['Seats', fmtInt(c.seatsTotal)],
    ['System', esc(systemName(detail.votingSystem))],
    num(c.electorate) !== null ? ['Electorate', fmtInt(c.electorate)] : null,
    sheet.kind !== 'unopposed' && num(c.totalPoll) !== null ? ['Total poll', fmtInt(c.totalPoll)] : null,
    sheet.kind !== 'unopposed' && num(c.spoiled) !== null ? ['Spoiled ballots', fmtInt(c.spoiled)] : null,
    sheet.kind !== 'unopposed' && valid !== null ? ['Valid poll', fmtInt(valid)] : null,
    sheet.kind !== 'unopposed' && turnout !== null ? ['Turnout', fmtPct(turnout)] : null,
    stv && sheet.quota !== null ? ['Quota', fmtInt(sheet.quota)] : null,
    majority !== null && sheet.kind !== 'unopposed' ? ['Majority', `${fmtInt(majority)}${valid ? ` (${fmtPct((100 * majority) / valid)})` : ''}`] : null,
  ].filter(Boolean);

  let table = '';
  if (sheet.kind === 'unopposed' || sheet.kind === 'none') {
    table = `<table class="cg-table el-sheet"><thead><tr><th scope="col">Candidate</th><th scope="col">Party</th><th scope="col">Result</th></tr></thead><tbody>${
      sheet.rows.map((r) => `<tr${r.elected ? ' class="cg-elected"' : ''}><th scope="row">${personLink(r)}</th><td>${partyChip(r.party, r.colour)}</td><td>${r.elected ? (sheet.kind === 'unopposed' ? '<span class="cg-badge cg-badge--success">Returned unopposed</span>' : '<span class="cg-badge cg-badge--success">Elected</span>') : esc(r.status || 'Not elected')}${sheet.kind === 'none' ? ' <span class="el-muted">votes not recorded</span>' : ''}</td></tr>`).join('')
    }</tbody></table>`;
  } else if (sheet.kind === 'stages') {
    const stages = sheet.stages;
    const nt = sheet.nonTransferable;
    table = `<div class="cg-table-wrap el-sheet-wrap"><table class="cg-table cg-table--compact cg-table--sticky-first el-sheet">
      <caption class="el-sr">Count sheet: each candidate's total at each count, with the transfer received (+) or distributed (−) above it.</caption>
      <thead><tr><th scope="col">Candidate</th><th scope="col">Party</th>${stages.map((s) => `<th scope="col" class="num">Count ${s}</th>`).join('')}<th scope="col">Outcome</th></tr></thead>
      <tbody>${sheet.rows.map((r) => `<tr${r.elected ? ' class="cg-elected"' : ''}><th scope="row">${personLink(r)}</th><td>${partyChip(r.party, r.colour)}</td>${
        stages.map((s, i) => {
          const k = cellAt(r, s);
          if (!k || k.total === null) return '<td class="num el-blank"></td>';
          const prev = i ? cellAt(r, stages[i - 1]) : null;
          const t = i ? (k.transfers ?? (prev && prev.total !== null ? k.total - prev.total : null)) : null;
          const done = (r.excludedAt !== null && s > r.excludedAt) || (r.elected && r.electedAt !== null && s > r.electedAt && t === 0);
          return `<td class="num${done ? ' el-done' : ''}${r.electedAt === s ? ' el-at-elected' : ''}${r.excludedAt === s ? ' el-at-excluded' : ''}">${t ? `<span class="el-transfer ${t > 0 ? 'cg-delta--positive' : 'cg-delta--negative'}">${fmtDelta(t, Number.isInteger(t) ? 0 : 2)}</span>` : ''}${fmtInt(k.total)}</td>`;
        }).join('')
      }<td>${outcome(r)}</td></tr>`).join('')}
      ${nt.size ? `<tr class="el-nt"><th scope="row">Non-transferable</th><td></td>${stages.map((s) => { const v = nt.get(s); return `<td class="num">${v && v.total !== null ? fmtInt(v.total) : ''}</td>`; }).join('')}<td></td></tr>` : ''}
      </tbody></table></div>`;
  } else {
    table = `<div class="cg-table-wrap"><table class="cg-table el-sheet"><thead><tr><th scope="col">Candidate</th><th scope="col">Party</th><th scope="col" class="num">${stv ? 'First preferences' : 'Votes'}</th><th scope="col" class="num">Share</th><th scope="col">Outcome</th></tr></thead><tbody>${
      [...sheet.rows].sort((a, b) => (b.firstPrefs ?? -1) - (a.firstPrefs ?? -1)).map((r) => `<tr${r.elected ? ' class="cg-elected"' : ''}><th scope="row">${personLink(r)}</th><td>${partyChip(r.party, r.colour)}</td><td class="num">${fmtInt(r.firstPrefs)}</td><td class="num">${fmtPct(share(r.firstPrefs))}</td><td>${outcome(r, sheet.kind === 'order')}</td></tr>`).join('')
    }</tbody></table></div>`;
  }

  const flows = transferStages(sheet);
  const quota = stv && sheet.quota && (sheet.kind === 'stages' || sheet.kind === 'single' || sheet.kind === 'order') ? quotaProgress(sheet) : [];
  const citations = (cites.citations || []).map((/** @type {any} */ c) => ({ ...c, checked: c.checked === 1 || c.checked === true, check: c.checkNote ?? c.check ?? null }));

  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › <a href="${appUrl.body(detail.bodySlug)}">${esc(detail.body)}</a> › <a href="${appUrl.election(detail.key)}">${esc(detail.title)}</a> › ${esc(c.name || c.constituency)}</nav>
    <header class="el-head">
      <h1>${esc(c.name || c.constituency)}</h1>
      <p class="el-lead"><a href="${appUrl.election(detail.key)}">${esc(detail.title)}</a> · ${esc(fmtDate(detail.date))}</p>
    </header>
    <dl class="cg-facts">${/** @type {string[][]} */ (facts).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    ${KIND_NOTE[sheet.kind] ? `<p class="cg-notice${sheet.kind === 'none' ? ' cg-notice--warning' : ''}">${esc(KIND_NOTE[sheet.kind])}</p>` : ''}
    <section aria-labelledby="el-result"><h2 id="el-result">${sheet.kind === 'stages' ? 'Count sheet' : 'Result'}</h2>${table}</section>
    ${quota.length ? `<section aria-labelledby="el-quota"><h2 id="el-quota">Progress to the quota</h2><figure class="cg-chart">${quotaBars(quota, /** @type {number} */ (sheet.quota))}<figcaption>Each candidate's votes at ${sheet.kind === 'stages' ? 'their last count' : 'the first count'}, against the quota of ${fmtInt(sheet.quota)}.</figcaption></figure></section>` : ''}
    ${flows.length ? `<section aria-labelledby="el-flows"><h2 id="el-flows">Transfers, count by count</h2>
      <p class="el-muted">The sources give each candidate's gain or loss at each count, not who passed votes to whom. Where several candidates were distributed at one count, their votes are drawn as one pool.</p>
      ${flows.map((st, i) => `<details class="el-flow-stage"${i < 2 ? ' open' : ''}><summary>Count ${st.stage}: ${st.kind === 'surplus' ? 'surplus of' : 'votes of'} ${esc(st.from.map((f) => f.name).join(', '))} (${fmtInt(st.distributed)})</summary><figure class="cg-chart">${transferFlow(st)}</figure>
        <table class="cg-table cg-table--compact"><caption class="el-sr">Transfers at count ${st.stage}</caption><thead><tr><th scope="col">Received by</th><th scope="col" class="num">Votes</th></tr></thead><tbody>${st.to.map((t) => `<tr><th scope="row">${esc(t.name)}</th><td class="num">${fmtInt(t.amount)}</td></tr>`).join('')}${st.nonTransferable ? `<tr><th scope="row">Non-transferable</th><td class="num">${fmtInt(st.nonTransferable)}</td></tr>` : ''}</tbody></table></details>`).join('')}
    </section>` : ''}
    <section aria-labelledby="el-sources"><h2 id="el-sources">Sources</h2>
      ${citations.length ? `<p>Every figure on this page is from the sources below. Each says what it covers.</p><ol class="cg-citations el-cites">${citations.map(citation).join('')}</ol>`
        : '<p class="cg-notice cg-notice--warning">No source is recorded for this contest yet.</p>'}
      <p class="el-muted"><a href="/browse/elections/${esc(electionSlug(detail.key))}-${esc(cslug)}">Browse record</a>${detail.interactiveUrl && detail.layerId ? ` · <a href="${esc(detail.interactiveUrl)}">on the map</a>` : ''}</p>
    </section>`;
  return title;
}

/** @param {import('../lib/count.js').SheetRow} r */
function personLink(r) {
  const url = personUrl(r.name, r.personId);
  return url ? `<a href="${esc(url)}">${esc(r.name)}</a>` : esc(r.name);
}

/** @param {import('../lib/count.js').SheetRow} r @param {boolean} [order] */
function outcome(r, order = true) {
  if (r.unopposed) return '<span class="cg-badge cg-badge--success">Returned unopposed</span>';
  if (r.autoReturned) return '<span class="cg-badge cg-badge--success">Returned automatically</span> <span class="el-muted">outgoing Ceann Comhairle, no poll for this seat</span>';
  if (r.elected) return `<span class="cg-badge cg-badge--success">Elected</span>${order && r.electedAt ? ` <span class="el-muted">count ${r.electedAt}</span>` : ''}`;
  if (r.excludedAt) return `Excluded${order ? ` <span class="el-muted">count ${r.excludedAt}</span>` : ''}`;
  return esc(r.status && !/^not elected$/i.test(r.status) ? r.status : 'Not elected');
}

/** One citation: title (linked), publisher, what it covers and how it was checked. */
/** @param {{ url?: string | null, title?: string | null, archiveUrl?: string | null, publisher?: string | null, scope?: string | null, basis?: string | null, check?: string | null, checked?: boolean }} ci */
export function citation(ci) {
  const link = ci.url ? `<a href="${esc(ci.url)}" rel="noopener">${esc(ci.title || ci.url)}</a>` : esc(ci.title || 'Untitled source');
  const archive = ci.archiveUrl ? ` (<a href="${esc(ci.archiveUrl)}" rel="noopener">archived copy</a>)` : '';
  const bits = [
    ci.publisher ? esc(ci.publisher) : '',
    ci.scope ? `covers ${esc(ci.scope)}` : '',
    ci.basis ? esc(ci.basis) : '',
  ].filter(Boolean).join(' · ');
  const check = ci.check ? `<div class="el-check">${ci.checked ? '<span class="cg-badge cg-badge--success">checked</span> ' : '<span class="cg-badge">not checked</span> '}${esc(ci.check)}</div>`
    : ci.checked ? '<div class="el-check"><span class="cg-badge cg-badge--success">checked</span></div>' : '';
  return `<li>${link}${archive}${bits ? `<div class="el-muted">${bits}</div>` : ''}${check}</li>`;
}
