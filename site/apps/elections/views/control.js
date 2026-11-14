/**
 * Council control over time (/elections/control/, stream el-bodies). Two views of one table
 * (lib/tables.js, lib/control.js):
 *   ?council=<id>   one council: a timeline chart and table of its seats by party after each
 *                   election and the recorded changes between, with its predecessors' timelines;
 *   ?year=<yyyy>    every council in a year: who controlled what (the default: the latest year).
 * Where the composition is not recorded, each place says so; nothing is filled in.
 */
import { TEXT, fill } from '../lib/bodies-text.js';
import {
  controlChart, controlText, councilCsv, councilGroups, largestParty, partyName, predecessorChain, queryFromState, seatsText,
  stateFromQuery, yearCounts, yearCsv, yearRange, yearView,
} from '../lib/control.js';
import { appUrl, esc, fmtDate, fmtInt } from '../lib/format.js';
import { partyChip } from '../lib/party.js';
import { controlTable, downloadText } from '../lib/tables.js';

const BASE = '/elections/control/';

/** @typedef {import('../lib/tables.js').Council} Council @typedef {import('../lib/tables.js').ControlTable} Table @typedef {import('../lib/tables.js').TimelineEntry} Entry */

/**
 * @param {HTMLElement} root
 * @param {import('../lib/route.js').Route} route
 * @param {import('../app.js').ViewContext} ctx
 */
export async function render(root, route, ctx) {
  const table = await controlTable();
  if (ctx.stale()) return TEXT.ccTitle;
  if (!table) {
    root.innerHTML = `<header class="el-head"><h1>${esc(TEXT.ccTitle)}</h1><p class="el-lead">${esc(TEXT.ccLead)}</p></header><p class="cg-notice cg-notice--warning">${esc(TEXT.ccUnavailable)}</p>`;
    return TEXT.ccTitle;
  }
  const state = stateFromQuery(route.query);
  const range = yearRange(table);
  const picker = `<label>${esc(TEXT.council)} <select id="cc-council" name="cc-council">${state.council ? '' : `<option value="" selected>${esc(TEXT.allCouncils)}</option>`}${councilGroups(table).map(([label, list]) => `<optgroup label="${esc(label)}">${list.map((c) => `<option value="${esc(c.id)}"${c.id === state.council ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  const notes = `<h2>${esc(TEXT.aboutFigures)}</h2><ul class="el-notes"><li>${esc(TEXT.ccNoteWhole)}</li><li>${esc(TEXT.ccNoteChanges)}</li><li>${esc(TEXT.ccNoteMissing)}</li>${state.council ? '' : `<li>${esc(TEXT.ccNoteYear)}</li>`}</ul>`;
  const go = async (/** @type {string} */ query, /** @type {string} */ focusId) => {
    await ctx.navigate(`${BASE}${query ? `?${query}` : ''}`, { replace: true, keepScroll: true });
    document.getElementById(focusId)?.focus();
  };
  const listen = { signal: ctx.signal };

  if (state.council) {
    const council = table.councils.find((c) => c.id === state.council);
    if (!council) throw Object.assign(new Error('council not found'), { status: 404 });
    const preds = predecessorChain(table, council);
    const aldermen = council.aldermen ? table.councils.find((c) => c.id === council.aldermen) : null;
    const link = (/** @type {{ id: string, name: string, held: boolean }} */ l) => (l.held ? `<a href="${BASE}?council=${encodeURIComponent(l.id)}">${esc(l.name)}</a>` : `${esc(l.name)} <span class="el-muted">(${esc(TEXT.noElections)})</span>`);
    const first = council.timeline[0]?.date || '';
    const last = council.timeline.at(-1)?.date || '';
    root.innerHTML = `
      <nav class="el-crumbs" aria-label="${esc(TEXT.breadcrumb)}"><a href="${appUrl.home()}">${esc(TEXT.elections)}</a> › <a href="${BASE}">${esc(TEXT.ccTitle)}</a></nav>
      <header class="el-head"><h1>${esc(council.name)}: ${esc(TEXT.ccTitle)}</h1><p class="el-lead">${esc(first.slice(0, 4))}–${esc(last.slice(0, 4))}</p></header>
      <form class="el-controls" id="cc-form" onsubmit="return false">${picker}</form>
      ${aldermen ? `<p class="cg-notice">${esc(TEXT.aldermen)} <a href="${BASE}?council=${encodeURIComponent(aldermen.id)}">${esc(aldermen.name)}</a></p>` : ''}
      ${council.predecessors.length ? `<p><strong>${esc(TEXT.predecessors)}:</strong> ${council.predecessors.map(link).join(', ')}</p>` : ''}
      ${council.successors.length ? `<p><strong>${esc(TEXT.successors)}:</strong> ${council.successors.map(link).join(', ')}</p>` : ''}
      <h2>${esc(TEXT.chartTitle)}</h2>
      <figure class="cg-chart el-ctl-figure">${controlChart(council, table.parties)}<figcaption class="el-muted">${esc(TEXT.majorityLine)}. ${esc(TEXT.partCouncil)}: <span class="el-ctl-key el-ctl-key--part" aria-hidden="true"></span> · ${esc(TEXT.missingSeats)}: <span class="el-ctl-key el-ctl-key--missing" aria-hidden="true"></span></figcaption></figure>
      <h2>${esc(TEXT.timelineHeading)}</h2>
      <p><button type="button" class="cg-button" id="cc-csv">${esc(TEXT.csv)}</button></p>
      ${timelineTable(council, table)}
      ${preds.map((p) => `<section class="el-ctl-pred"><h2>${esc(TEXT.predecessors)}: <a href="${BASE}?council=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h2><figure class="cg-chart el-ctl-figure">${controlChart(p, table.parties)}</figure></section>`).join('')}
      ${notes}`;
    root.querySelector('#cc-csv')?.addEventListener('click', () => downloadText(`civgraph-council-control-${council.id}.csv`, councilCsv(council, table.parties)), listen);
    root.querySelector('#cc-council')?.addEventListener('change', (e) => {
      const id = /** @type {HTMLSelectElement} */ (e.target).value;
      go(queryFromState({ council: id, year: null }), 'cc-council');
    }, listen);
    return `${council.name}: ${TEXT.ccTitle}`;
  }

  const year = Math.min(range.last, Math.max(range.first, state.year ?? range.last));
  const rows = yearView(table, year);
  const counts = yearCounts(rows);
  const chip = (/** @type {string | null} */ p) => partyChip(partyName(table.parties, p), p ? table.parties[p]?.colour : null);
  root.innerHTML = `
    <header class="el-head"><h1>${esc(TEXT.ccTitle)}, ${year}</h1><p class="el-lead">${esc(TEXT.ccLead)}</p></header>
    <form class="el-controls" id="cc-form" onsubmit="return false">
      <label>${esc(TEXT.year)} <input id="cc-year" name="cc-year" type="number" inputmode="numeric" min="${range.first}" max="${range.last}" value="${year}"></label>
      <button type="button" class="cg-button" id="cc-prev"${year <= range.first ? ' disabled' : ''}>${esc(TEXT.previousYear)}</button>
      <button type="button" class="cg-button" id="cc-next"${year >= range.last ? ' disabled' : ''}>${esc(TEXT.nextYear)}</button>
      ${picker}
    </form>
    <p id="cc-summary" role="status"><span>${esc(fill(counts.councils === 1 ? TEXT.ccSummaryOne : TEXT.ccSummary, { n: fmtInt(counts.councils), year }))}</span> <span>${esc(fill(TEXT.ccKinds, { n: fmtInt(counts.majority), k: fmtInt(counts.noc), m: fmtInt(counts.other) }))}</span></p>
    ${rows.length ? `<p><button type="button" class="cg-button" id="cc-csv">${esc(TEXT.csv)}</button></p>
    <div class="cg-table-wrap" tabindex="0" role="region" aria-label="${esc(`${TEXT.ccTitle}, ${year}`)}"><table class="cg-table cg-table--compact">
      <thead><tr><th scope="col">${esc(TEXT.council)}</th><th scope="col">${esc(TEXT.control)}</th><th scope="col">${esc(TEXT.largestParty)}</th><th scope="col">${esc(TEXT.seatsByParty)}</th><th scope="col">${esc(TEXT.asOf)}</th></tr></thead>
      <tbody>${rows.map(({ council, entry, election }) => {
        const big = largestParty(entry.composition);
        return `<tr><th scope="row"><a href="${BASE}?council=${encodeURIComponent(council.id)}">${esc(council.name)}</a></th>`
          + `<td>${esc(controlText(entry.control, table.parties))}</td><td>${big ? chip(big) : '—'}</td>`
          + `<td>${entry.composition ? esc(seatsText(entry.composition, table.parties)) + (entry.missing ? ` <span class="el-muted">· ${esc(TEXT.missingSeats)} ${fmtInt(entry.missing)}</span>` : '') : `<span class="el-muted">${esc(TEXT.compositionNotRecorded)}</span>`}</td>`
          + `<td class="el-nowrap">${election.election ? `<a href="${appUrl.election(election.election)}">${esc(fmtDate(election.date))}</a>` : esc(fmtDate(election.date))}${entry !== election ? ` <span class="el-muted">(${esc(fmtDate(entry.date))})</span>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="el-muted">${esc(TEXT.ccNone)}</p>`}
    ${notes}`;
  const toYear = (/** @type {number} */ y, /** @type {string} */ focusId) => go(queryFromState({ council: '', year: Math.min(range.last, Math.max(range.first, y)) }), focusId);
  root.querySelector('#cc-prev')?.addEventListener('click', () => toYear(year - 1, 'cc-prev'), listen);
  root.querySelector('#cc-next')?.addEventListener('click', () => toYear(year + 1, 'cc-next'), listen);
  root.querySelector('#cc-year')?.addEventListener('change', (e) => {
    const v = /** @type {HTMLInputElement} */ (e.target).value;
    if (/^\d{4}$/.test(v)) toYear(Number(v), 'cc-year');
  }, listen);
  root.querySelector('#cc-council')?.addEventListener('change', (e) => {
    const id = /** @type {HTMLSelectElement} */ (e.target).value;
    if (id) go(queryFromState({ council: id, year: null }), 'cc-council');
  }, listen);
  root.querySelector('#cc-csv')?.addEventListener('click', () => downloadText(`civgraph-council-control-${year}.csv`, yearCsv(rows, table.parties, year)), listen);
  return `${TEXT.ccTitle}, ${year}`;
}

/**
 * A council's timeline as a table: each election (the seats it filled, whole council or part)
 * and each recorded change, with the composition and control after it.
 * @param {Council} council @param {Table} table
 */
function timelineTable(council, table) {
  const chip = (/** @type {string | null | undefined} */ p) => partyChip(partyName(table.parties, p), p ? table.parties[p]?.colour : null);
  const row = (/** @type {Entry} */ e) => {
    const date = e.election ? `<a href="${appUrl.election(e.election)}">${esc(fmtDate(e.date))}</a>` : esc(fmtDate(e.date));
    let event = '';
    let change = '';
    if (e.type === 'election') {
      event = `${esc(TEXT.election)} <span class="el-muted">(${esc(e.whole ? TEXT.wholeCouncil : TEXT.partCouncil)})</span>`;
      change = esc(seatsText(e.seats, table.parties));
    } else {
      const area = e.area ? (e.election && e.contest ? ` <a href="${appUrl.contest(e.election, e.contest)}">${esc(e.area)}</a>` : ` ${esc(e.area)}`) : '';
      event = `${esc(e.type === 'co-option' ? TEXT.coOption : TEXT.byElection)}${area}`;
      change = e.departingKnown
        ? `${chip(e.loss)} → ${chip(e.gain)}${e.departing ? ` <span class="el-muted">(${esc(e.departing)})</span>` : ''}`
        : `${chip(e.gain)} <span class="el-muted">${esc(TEXT.departingUnknown)}</span>`;
    }
    const comp = e.composition ? `${esc(seatsText(e.composition, table.parties))}${e.missing ? ` <span class="el-muted">· ${esc(TEXT.missingSeats)} ${fmtInt(e.missing)}</span>` : ''}` : `<span class="el-muted">${esc(TEXT.compositionNotRecorded)}</span>`;
    return `<tr><td class="el-nowrap">${date}</td><th scope="row">${event}</th><td>${change}</td><td>${comp}</td><td>${esc(e.composition ? controlText(e.control, table.parties) : '—')}</td></tr>`;
  };
  return `<div class="cg-table-wrap" tabindex="0" role="region" aria-label="${esc(`${council.name}: ${TEXT.ccTitle}`)}"><table class="cg-table cg-table--compact el-ctl-table">
    <thead><tr><th scope="col">${esc(TEXT.date)}</th><th scope="col">${esc(TEXT.event)}</th><th scope="col">${esc(TEXT.seats)}</th><th scope="col">${esc(TEXT.composition)}</th><th scope="col">${esc(TEXT.control)}</th></tr></thead>
    <tbody>${council.timeline.map(row).join('')}</tbody></table></div>`;
}
