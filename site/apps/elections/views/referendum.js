/**
 * A referendum's overview (/elections/<referendum-slug>/, 14 Nov 2026): the proposal, the
 * electorate and turnout, each option's votes and share, the result in words, and the result in
 * every counting area (a table, linked to each area's page; its rows are the results map's data,
 * lib/referendum.js referendumAreas). No seats and no parties: the election template's words
 * ("Seats", "Party", "Candidates") do not apply. Called by views/election.js for a referendum.
 */
import { hbars } from '../lib/charts.js';
import { appUrl, electionSlug, esc, fmtDate, fmtInt, fmtPct } from '../lib/format.js';
import { partyChip } from '../lib/party.js';
import { REFERENDUM_WORDS as W, referendumAreas, referendumOptions, referendumTotals, resultWords } from '../lib/referendum.js';

/**
 * @param {HTMLElement} root
 * @param {{ detail: import('../lib/api.js').ElectionDetail, summary: import('../lib/api.js').SummaryAnswer,
 *   before: import('../lib/api.js').ElectionRow | null, after: import('../lib/api.js').ElectionRow | null,
 *   slugsByName: Map<string, string[]> }} data
 * @returns {string} the page title
 */
export function renderReferendum(root, { detail, summary, before, after, slugsByName }) {
  const key = detail.key;
  const rows = summary.results || [];
  const options = referendumOptions(detail.partySummary || []);
  const totals = referendumTotals(rows);
  const areas = referendumAreas(rows, options);
  const words = resultWords(options, (v) => fmtPct(v));
  const description = typeof detail['description'] === 'string' ? String(detail['description']) : '';
  const colourOf = new Map(options.map((o) => [o.option, o.colour]));
  const chart = options.some((o) => o.share !== null)
    ? hbars(options.map((o) => ({ label: o.option, value: o.share === null ? null : Math.round(o.share * 10) / 10, colour: o.colour })), { title: W.shareCaption, format: (v) => fmtPct(v), max: 100 })
    : '';
  const turnout = totals.turnout !== null ? fmtPct(totals.turnout)
    : totals.turnoutMedian !== null ? W.turnoutMedian.replace('{pct}', fmtPct(totals.turnoutMedian)).replace('{n}', fmtInt(totals.turnoutAreas)) : W.notRecorded;
  const refs = (detail.references || []).map((r) => `<li><a href="${esc(r.url)}" rel="noopener">${esc(r.label)}</a>${r.note ? ` <span class="el-muted">${esc(r.note)}</span>` : ''}</li>`).join('');

  const areaRows = areas.map((a) => {
    const cslug = slugsByName.get(a.name)?.shift() || null;
    const name = cslug ? `<a href="${appUrl.contest(key, cslug)}">${esc(a.name)}</a>` : esc(a.name);
    return `<tr${a.feature ? ` data-feature="${esc(a.feature)}"` : ''}><th scope="row">${name}</th>`
      + options.map((o) => `<td class="num">${fmtInt(a.votes[o.option])}</td><td class="num">${fmtPct(a.shares[o.option])}</td>`).join('')
      + `<td>${a.winner ? partyChip(a.winner, colourOf.get(a.winner)) : '—'}</td><td class="num">${fmtInt(a.majority)}</td><td class="num">${fmtPct(a.turnout)}</td></tr>`;
  }).join('');

  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › <a href="${appUrl.body(detail.bodySlug)}">${esc(detail.body)}</a> › ${esc(fmtDate(detail.date))}</nav>
    <header class="el-head">
      <h1>${esc(detail.title)}</h1>
      <p class="el-lead">${esc(fmtDate(detail.date))} · ${esc(W.referendum)}</p>
      <p class="el-nav">${before ? `<a href="${appUrl.election(before.key)}">← ${esc(before.displayTitle)}</a>` : ''}${after ? `<a href="${appUrl.election(after.key)}">${esc(after.displayTitle)} →</a>` : ''}</p>
    </header>
    ${description ? `<section aria-labelledby="el-proposal" class="el-proposal"><h2 id="el-proposal">${esc(W.proposal)}</h2><p>${esc(description)}</p></section>` : ''}
    ${words ? `<p class="cg-notice el-ref-result" data-result>${esc(words)}</p>` : ''}
    <dl class="cg-facts">
      <dt>${esc(W.electorate)}</dt><dd>${totals.electorate !== null ? fmtInt(totals.electorate) : esc(W.notRecorded)}</dd>
      ${totals.totalPoll !== null ? `<dt>${esc(W.totalPoll)}</dt><dd>${fmtInt(totals.totalPoll)}</dd>` : ''}
      <dt>${esc(W.validVotes)}</dt><dd>${fmtInt(detail.totals?.validPoll ?? totals.valid)}</dd>
      <dt>${esc(W.turnout)}</dt><dd>${esc(turnout)}</dd>
      <dt>Elsewhere</dt><dd><a href="/browse/elections/${esc(electionSlug(key))}">Browse record</a>${detail.interactiveUrl ? ` · <a href="${esc(detail.interactiveUrl)}">on the map</a>` : ''}</dd>
    </dl>
    <section aria-labelledby="el-ref-result"><h2 id="el-ref-result">${esc(W.result)}</h2>
      <div class="el-grid">
        <div class="cg-table-wrap"><table class="cg-table el-ref-options">
          <thead><tr><th scope="col">${esc(W.option)}</th><th scope="col" class="num">${esc(W.votes)}</th><th scope="col" class="num">${esc(W.share)}</th></tr></thead>
          <tbody>${options.map((o) => `<tr><th scope="row">${partyChip(o.option, o.colour)}</th><td class="num">${fmtInt(o.votes)}</td><td class="num">${fmtPct(o.share)}</td></tr>`).join('')}</tbody>
        </table></div>
        ${chart ? `<figure class="cg-chart">${chart}<figcaption>${esc(W.shareCaption)}</figcaption></figure>` : ''}
      </div>
    </section>
    ${areas.length > 1 ? `<section aria-labelledby="el-ref-areas"><h2 id="el-ref-areas">${esc(W.areas)}</h2>
      <p class="el-muted">${esc(W.areasNote)}</p>
      <div class="cg-table-wrap"><table class="cg-table cg-table--compact cg-table--sticky-first el-ref-areas">
        <caption class="el-sr">${esc(W.areas)}</caption>
        <thead><tr><th scope="col">${esc(W.area)}</th>${options.map((o) => `<th scope="col" class="num">${esc(W.optionVotes.replace('{option}', o.option))}</th><th scope="col" class="num">${esc(W.optionShare.replace('{option}', o.option))}</th>`).join('')}<th scope="col">${esc(W.result)}</th><th scope="col" class="num">${esc(W.majority)}</th><th scope="col" class="num">${esc(W.turnout)}</th></tr></thead>
        <tbody>${areaRows}</tbody>
      </table></div>
    </section>` : ''}
    <section aria-labelledby="el-sources"><h2 id="el-sources">Sources</h2>
      <p>${esc(W.sourcesNote)}</p>
      <ul class="cg-citations">${refs || '<li>No election-level references recorded.</li>'}</ul>
    </section>`;
  return detail.title;
}

/**
 * One counting area of a referendum (/elections/<referendum-slug>/<area-slug>/): its electorate,
 * poll and turnout, each option's votes and share, and its result in words; no seats, no
 * candidates. Called by views/contest.js for a referendum, with the page's sources section.
 * @param {{ detail: import('../lib/api.js').ElectionDetail, contest: Record<string, unknown>,
 *   rows: Array<{ name: string, party: string, colour: string, firstPrefs: number | null }>, sources: string }} data
 * @returns {string} the page's HTML
 */
export function referendumContestHtml({ detail, contest: c, rows, sources }) {
  const name = String(c['name'] || c['constituency'] || '');
  const valid = Number(c['validPoll'] ?? c['totalVotes']) || rows.reduce((s, r) => s + (r.firstPrefs || 0), 0) || null;
  const options = referendumOptions(rows.map((r) => ({ party: r.name || r.party, votes: r.firstPrefs, share: r.firstPrefs !== null && valid ? (100 * r.firstPrefs) / valid : null, colour: r.colour })));
  const words = resultWords(options, (v) => fmtPct(v));
  const ranked = options.map((o) => o.votes ?? 0).sort((a, b) => b - a);
  const majority = ranked.length >= 2 ? /** @type {number} */ (ranked[0]) - /** @type {number} */ (ranked[1]) : null;
  const num = (/** @type {unknown} */ v) => (Number(v) > 0 ? Number(v) : null);
  const turnout = num(c['turnoutPct']) ?? (num(c['totalPoll']) && num(c['electorate']) ? (100 * Number(c['totalPoll'])) / Number(c['electorate']) : null);
  const facts = [
    [W.electorate, num(c['electorate']) !== null ? fmtInt(c['electorate']) : null],
    [W.totalPoll, num(c['totalPoll']) !== null ? fmtInt(c['totalPoll']) : null],
    [W.spoiled, num(c['spoiled']) !== null ? fmtInt(c['spoiled']) : null],
    [W.validVotes, valid !== null ? fmtInt(valid) : null],
    [W.turnout, turnout !== null ? fmtPct(turnout) : null],
    [W.majority, majority !== null ? fmtInt(majority) : null],
  ].filter(([, v]) => v !== null);
  return `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › <a href="${appUrl.body(detail.bodySlug)}">${esc(detail.body)}</a> › <a href="${appUrl.election(detail.key)}">${esc(detail.title)}</a> › ${esc(name)}</nav>
    <header class="el-head">
      <h1>${esc(name)}</h1>
      <p class="el-lead"><a href="${appUrl.election(detail.key)}">${esc(detail.title)}</a> · ${esc(fmtDate(detail.date))}</p>
    </header>
    ${words ? `<p class="cg-notice el-ref-result" data-result>${esc(words)}</p>` : ''}
    <dl class="cg-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    <section aria-labelledby="el-result"><h2 id="el-result">${esc(W.result)}</h2>
      <div class="cg-table-wrap"><table class="cg-table el-ref-options">
        <thead><tr><th scope="col">${esc(W.option)}</th><th scope="col" class="num">${esc(W.votes)}</th><th scope="col" class="num">${esc(W.share)}</th></tr></thead>
        <tbody>${options.map((o) => `<tr><th scope="row">${partyChip(o.option, o.colour)}</th><td class="num">${fmtInt(o.votes)}</td><td class="num">${fmtPct(o.share)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
    ${sources}`;
}
