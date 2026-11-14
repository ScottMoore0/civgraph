/**
 * A contest (/elections/<election-slug>/<contest-slug>/): the full count sheet where the records
 * hold stage totals, the transfers of each stage, quota progress, an honest "Returned unopposed",
 * and the contest's sources with what each one covers.
 */
import { contestCitations, contestResult, electionDetail } from '../lib/api.js';
import { quotaBars } from '../lib/charts.js';
import { cellAt, countSheet, fptpMajority, quotaProgress } from '../lib/count.js';
import {
  appUrl, electionSlug, esc, fmtDate, fmtDelta, fmtInt, fmtPct, isStv, num, systemName,
} from '../lib/format.js';
import { NOTE, contestLimits, limitHtml, votesMissingNote, winnersOnly } from '../lib/limits.js';
import { partyChip } from '../lib/party.js';
import { CHART_TEXT, chartData } from '../lib/chart-data.js';
import { METHOD_NOTE, methodLink, methodNote } from '../lib/methods.js';
import { checkedFact, comparedOn } from '../lib/checked.js';
import { areaContextSection, contestLinker, mountAreaContext } from './area-context.js';
import { embedOfferSection, mountEmbedOffer } from './embed-offer.js';
import { personAppUrl } from '../lib/place-urls.js';
import { mountContestNav } from './contest-nav.js';
import { STV_VIEW_TEXT, stvParts, wireStepper } from './stv-contest.js';
import { quotaFraction } from '../lib/stv.js';

/** @type {Record<string, string>} */
const KIND_NOTE = {
  stages: 'The full count, stage by stage, as the sources give it.',
  order: 'The sources give the first preferences and the count at which each candidate was elected or excluded, but not the totals at each count, so no transfers are shown.',
  single: '',
  unopposed: 'No poll was held: the members below were returned unopposed.',
  none: 'No votes are recorded for this contest in the sources Civgraph holds; only the candidates are known.',
};

/** @param {HTMLElement} root @param {import('../lib/route.js').Route} route @param {import('../app.js').ViewContext} ctx */
export async function render(root, route, ctx) {
  const eslug = /** @type {string} */ (route.election);
  const cslug = /** @type {string} */ (route.contest);
  const detail = await electionDetail(eslug);
  const result = await contestResult(detail.key, cslug);
  const cites = await contestCitations(detail.key, Number(result.constituency?.seq)).catch(() => ({ citations: [] }));
  const c = result.constituency || {};
  const stv = isStv(detail.votingSystem);
  const sheet = countSheet(/** @type {Array<Record<string, unknown>>} */ (result.candidates || []), {
    quota: c.quota, validPoll: c.validPoll ?? c.totalVotes, seatsTotal: c.seatsTotal, nonTransferable: c.nonTransferable,
    contestStatus: c.contestStatus || detail.contestStatus,
  });
  const valid = sheet.validPoll;
  const share = (/** @type {number | null} */ v) => (v !== null && valid ? (100 * v) / valid : null);
  // EL2: each limit of this contest's data, noted on it (lib/limits.js). Without its losers a
  // contest has no runner-up, so no majority.
  const limits = contestLimits(sheet, c);
  const votesNote = votesMissingNote(limits.votesMissing, fmtInt);
  const majority = !stv && !limits.losersMissing ? (num(c.majority) ?? fptpMajority(sheet)) : null;
  const turnout = num(c.turnoutPct) ?? (num(c.totalPoll) !== null && num(c.electorate) ? (100 * Number(c.totalPoll)) / Number(c.electorate) : null);
  // Figures this page works out, rather than reads: each says so beside it (lib/methods.js).
  const derived = {
    turnout: turnout !== null && num(c.turnoutPct) === null,
    majority: majority !== null && num(c.majority) === null,
    valid: valid !== null && num(c.validPoll) === null && num(c.totalVotes) === null,
  };
  const how = (/** @type {boolean} */ on, /** @type {import('../lib/methods.js').MethodId} */ id, /** @type {string} */ sentence) => (on ? methodNote(id, [sentence], 'el-muted el-method el-method--fact') : '');
  const title = `${c.name || c.constituency} – ${detail.title}`;
  // A contest whose sources name only the winners has its own note (limits), not the kind's.
  const kindNote = winnersOnly(c) ? '' : KIND_NOTE[sheet.kind];

  const facts = [
    ['Seats', fmtInt(c.seatsTotal)],
    ['System', esc(systemName(detail.votingSystem))],
    num(c.electorate) !== null ? ['Electorate', fmtInt(c.electorate)] : null,
    sheet.kind !== 'unopposed' && num(c.totalPoll) !== null ? ['Total poll', fmtInt(c.totalPoll)] : null,
    sheet.kind !== 'unopposed' && num(c.spoiled) !== null ? ['Spoiled ballots', fmtInt(c.spoiled)] : null,
    sheet.kind !== 'unopposed' && valid !== null ? ['Valid poll', `${fmtInt(valid)}${how(derived.valid, 'shares', METHOD_NOTE.validDerived)}`] : null,
    sheet.kind !== 'unopposed' && turnout !== null ? ['Turnout', `${fmtPct(turnout)}${how(derived.turnout, 'turnout', METHOD_NOTE.turnoutDerived)}`] : null,
    stv && sheet.quota !== null ? ['Quota', fmtInt(sheet.quota)] : null,
    majority !== null && sheet.kind !== 'unopposed' ? ['Majority', `${fmtInt(majority)}${valid ? ` (${fmtPct((100 * majority) / valid)})` : ''}${how(derived.majority, 'majority', METHOD_NOTE.majorityDerived)}`] : null,
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
      [...sheet.rows].sort((a, b) => (b.firstPrefs ?? -1) - (a.firstPrefs ?? -1)).map((r) => `<tr${r.elected ? ' class="cg-elected"' : ''}><th scope="row">${personLink(r)}</th><td>${partyChip(r.party, r.colour)}</td><td class="num">${limits.votesMissing && r.firstPrefs === null && !r.unopposed && !r.autoReturned ? `<span class="el-muted">${esc(NOTE.votesNotRecorded)}</span>` : fmtInt(r.firstPrefs)}</td><td class="num">${fmtPct(share(r.firstPrefs))}</td><td>${outcome(r, sheet.kind === 'order')}</td></tr>`).join('')
    }</tbody></table></div>`;
  }

  // el-stv: what each count did, the stepper, the transfers and the whole count as a flow (views/stv-contest.js).
  const stvp = stv ? stvParts(sheet, route.query, `${electionSlug(detail.key)}-${cslug}-transfers`) : null;
  const quota = stv && sheet.quota && (sheet.kind === 'stages' || sheet.kind === 'single' || sheet.kind === 'order') ? quotaProgress(sheet) : [];
  const citations = (cites.citations || []).map((c) => ({ ...c, checked: c.checked === 1, check: c.checkNote ?? null }));
  const quotaData = quota.length ? chartData({
    id: 'quota', caption: CHART_TEXT.quotaProgress, file: `${electionSlug(detail.key)}-${cslug}-quota`,
    columns: [{ label: CHART_TEXT.candidate }, { label: CHART_TEXT.votes, num: true, format: fmtInt }, { label: STV_VIEW_TEXT.quotas, num: true, format: (v) => (v === null || v === undefined ? '' : quotaFraction(Number(v))), csv: (v) => (v === null || v === undefined ? '' : Number(Number(v).toFixed(4))) }],
    // el-stv: in quotas, as the bars are, never as a percentage.
    rows: quota.map((r) => [r.name, r.total, r.ratio]),
  }) : '';

  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › <a href="${appUrl.body(detail.bodySlug)}">${esc(detail.body)}</a> › <a href="${appUrl.election(detail.key)}">${esc(detail.title)}</a> › ${esc(c.name || c.constituency)}</nav>
    <header class="el-head">
      <h1>${esc(c.name || c.constituency)}</h1>
      <p class="el-lead"><a href="${appUrl.election(detail.key)}">${esc(detail.title)}</a> · ${esc(fmtDate(detail.date))}</p>
    </header>
    <dl class="cg-facts">${/** @type {string[][]} */ (facts).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}${checkedFact(citations)}</dl>
    ${kindNote ? `<p class="cg-notice${sheet.kind === 'none' ? ' cg-notice--warning' : ''}">${esc(kindNote)}</p>` : ''}
    ${limits.notes.map((l) => limitHtml(l, esc, 'cg-notice', l.id === 'losers' ? methodLink('losers') : '')).join('')}${votesNote ? limitHtml(votesNote, esc) : ''}
    <section aria-labelledby="el-result"><h2 id="el-result">${sheet.kind === 'stages' ? 'Count sheet' : 'Result'}</h2>${table}${stvp ? stvp.afterSheet : ''}</section>
    ${quota.length ? `<section aria-labelledby="el-quota"><h2 id="el-quota">Progress to the quota</h2><figure class="cg-chart">${quotaBars(quota, /** @type {number} */ (sheet.quota))}<figcaption>Each candidate's votes at ${sheet.kind === 'stages' ? 'their last count' : 'the first count'}, against the quota of ${fmtInt(sheet.quota)}. ${methodLink('majority')}</figcaption>${quotaData}</figure></section>` : ''}
    ${stvp ? stvp.sections : ''}
    ${areaContextSection()}
    ${embedOfferSection({ election: electionSlug(detail.key), contest: cslug, title })}
    <section aria-labelledby="el-sources"><h2 id="el-sources">Sources</h2>
      ${citations.length ? `<p>Every figure on this page is from the sources below. Each says what it covers.</p><ol class="cg-citations el-cites">${citations.map(citation).join('')}</ol>`
        : '<p class="cg-notice cg-notice--warning">No source is recorded for this contest yet.</p>'}
      <p class="el-muted"><a href="/browse/elections/${esc(electionSlug(detail.key))}-${esc(cslug)}">Browse record</a>${detail.interactiveUrl && detail.layerId ? ` · <a href="${esc(detail.interactiveUrl)}">on the map</a>` : ''}</p>
    </section>`;
  // el-context: the area in the census (filled after the page draws), and the embed panel when on.
  const feature = /** @type {{ layerId?: string | null, featureName?: string | null } | null} */ (result.feature);
  mountAreaContext(root, { layerId: feature?.layerId || detail.layerId, area: feature?.featureName || String(c.name || c.constituency || ''), date: detail.date }, ctx, { linkFor: contestLinker(detail.key, detail.resultEntries || []) });
  mountEmbedOffer(root, ctx);
  // Arrows to the contests before and after this one under the same name (el-places).
  void mountContestNav(root, { electionKey: detail.key, contestSlug: cslug, seq: Number(c.seq), name: String(c.name || c.constituency), bodySlug: detail.bodySlug, stale: ctx.stale });
  if (stvp) wireStepper(root, sheet, stvp.events, route.query, ctx);
  return title;
}

/** @param {import('../lib/count.js').SheetRow} r */
function personLink(r) {
  // The person's career in the app (el-places), which links on to their Browse page.
  const url = personAppUrl(r);
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
/** @param {{ url?: string | null, title?: string | null, archiveUrl?: string | null, publisher?: string | null, scope?: string | null, basis?: string | null, check?: string | null, checked?: boolean, accessed?: string | null }} ci */
export function citation(ci) {
  const link = ci.url ? `<a href="${esc(ci.url)}" rel="noopener">${esc(ci.title || ci.url)}</a>` : esc(ci.title || 'Untitled source');
  const archive = ci.archiveUrl ? ` (<a href="${esc(ci.archiveUrl)}" rel="noopener">archived copy</a>)` : '';
  const bits = [
    ci.publisher ? esc(ci.publisher) : '',
    ci.scope ? `covers ${esc(ci.scope)}` : '',
    ci.basis ? esc(ci.basis) : '',
  ].filter(Boolean).join(' · ');
  const check = ci.check ? `<div class="el-check">${ci.checked ? '<span class="cg-badge cg-badge--success">checked</span> ' : '<span class="cg-badge">not checked</span> '}${esc(ci.check)}${comparedOn(ci)}</div>`
    : ci.checked ? `<div class="el-check"><span class="cg-badge cg-badge--success">checked</span>${comparedOn(ci)}</div>` : '';
  return `<li>${link}${archive}${bits ? `<div class="el-muted">${bits}</div>` : ''}${check}</li>`;
}
