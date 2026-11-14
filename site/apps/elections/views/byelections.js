/**
 * The by-election and vacancy tracker (/elections/byelections/, stream el-bodies): every
 * by-election on file, in every body, and the council seats filled by co-option, with filters,
 * sorting, a summary line and a CSV of the filtered list. The state is in the address
 * (lib/byelections.js); a change of filter redraws the list in place, so focus stays where it was.
 */
import { NONE, PAGE, byElectionsCsv, bodyOptions, filterRows, partyOptions, partyShare, queryFromState, sortRows, stateFromQuery, summarise, areaUrl } from '../lib/byelections.js';
import { TEXT, fill } from '../lib/bodies-text.js';
import { appUrl, esc, fmtDate, fmtInt, fmtPct, personUrl } from '../lib/format.js';
import { partyChip } from '../lib/party.js';
import { byElectionsTable, downloadText } from '../lib/tables.js';

const BASE = '/elections/byelections/';

/** @typedef {import('../lib/byelections.js').State} State @typedef {import('../lib/tables.js').ByElectionRow} Row */

/**
 * @param {HTMLElement} root
 * @param {import('../lib/route.js').Route} route
 * @param {import('../app.js').ViewContext} ctx
 */
export async function render(root, route, ctx) {
  const table = await byElectionsTable();
  if (ctx.stale()) return TEXT.beTitle;
  const head = `<header class="el-head"><h1>${esc(TEXT.beTitle)}</h1><p class="el-lead">${esc(TEXT.beLead)}</p></header>`;
  if (!table) {
    root.innerHTML = `${head}<p class="cg-notice cg-notice--warning">${esc(TEXT.beUnavailable)}</p>`;
    return TEXT.beTitle;
  }
  let state = stateFromQuery(route.query);
  const parties = partyOptions(table);
  const bodies = bodyOptions(table);
  const opt = (/** @type {string} */ value, /** @type {string} */ label, /** @type {boolean} */ on) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const partySelect = (/** @type {string} */ id, /** @type {string} */ selected) => `<select id="${id}" name="${id}">${opt('', TEXT.any, !selected)}${opt(NONE, TEXT.notRecordedOption, selected === NONE)}${parties.map((p) => opt(p.key, p.name, p.key === selected)).join('')}</select>`;

  root.innerHTML = `${head}
    <form class="el-controls el-be-form" id="be-form" onsubmit="return false">
      <label>${esc(TEXT.body)} <select id="be-body" name="be-body">${opt('', TEXT.any, !state.body)}${bodies.map((b) => opt(b.key, `${b.name} (${fmtInt(b.count)})`, b.key === state.body)).join('')}</select></label>
      <label>${esc(TEXT.area)} <input id="be-area" name="be-area" type="search" value="${esc(state.area)}" autocomplete="off"></label>
      <label>${esc(TEXT.winningParty)} ${partySelect('be-win', state.win)}</label>
      <label>${esc(TEXT.defendingParty)} ${partySelect('be-def', state.def)}</label>
      <label>${esc(TEXT.result)} <select id="be-result" name="be-result">${opt('', TEXT.any, !state.result)}${opt('held', TEXT.held, state.result === 'held')}${opt('gained', TEXT.gained, state.result === 'gained')}${opt('unknown', TEXT.notRecordedOption, state.result === 'unknown')}</select></label>
      <label>${esc(TEXT.unopposed)} <select id="be-unopposed" name="be-unopposed">${opt('', TEXT.any, !state.unopposed)}${opt('yes', TEXT.yes, state.unopposed === 'yes')}${opt('no', TEXT.no, state.unopposed === 'no')}</select></label>
      <label>${esc(TEXT.type)} <select id="be-type" name="be-type">${opt('', TEXT.any, !state.type)}${opt('by-election', TEXT.byElections, state.type === 'by-election')}${opt('co-option', TEXT.coOptions, state.type === 'co-option')}</select></label>
      <label>${esc(TEXT.fromYear)} <input id="be-from" name="be-from" type="number" inputmode="numeric" min="1800" max="2100" value="${state.from ?? ''}"></label>
      <label>${esc(TEXT.toYear)} <input id="be-to" name="be-to" type="number" inputmode="numeric" min="1800" max="2100" value="${state.to ?? ''}"></label>
      <label class="el-be-stand">${esc(TEXT.partiesStanding)} <select id="be-stand" name="be-stand" multiple size="4">${parties.map((p) => opt(p.key, p.name, state.stand.includes(p.key))).join('')}</select></label>
      <label>${esc(TEXT.sortBy)} <select id="be-sort" name="be-sort">${opt('date', TEXT.date, state.sort === 'date')}${opt('turnout', TEXT.turnout, state.sort === 'turnout')}${opt('majority', TEXT.majority, state.sort === 'majority')}${opt('share', TEXT.partyShare, state.sort === 'share')}</select></label>
      <label>${esc(TEXT.shareOf)} <select id="be-party" name="be-party">${opt('', TEXT.any, !state.party)}${parties.map((p) => opt(p.key, p.name, p.key === state.party)).join('')}</select></label>
      <label>${esc(TEXT.order)} <select id="be-dir" name="be-dir">${opt('desc', TEXT.descending, state.dir === 'desc')}${opt('asc', TEXT.ascending, state.dir === 'asc')}</select></label>
      <p class="el-be-actions"><a href="${BASE}" id="be-reset">${esc(TEXT.reset)}</a> <button type="button" class="cg-button" id="be-csv">${esc(TEXT.csv)}</button></p>
    </form>
    <p class="el-be-summary" id="be-summary" role="status"></p>
    <div id="be-results"></div>
    <h2>${esc(TEXT.aboutFigures)}</h2>
    <ul class="el-notes">
      <li>${esc(TEXT.beNoteWhat)}</li>
      <li>${esc(TEXT.beNoteDefending)}</li>
      <li>${esc(TEXT.beNoteHeld)}</li>
      <li>${esc(TEXT.beNoteCoOption)}</li>
    </ul>`;

  const form = /** @type {HTMLFormElement} */ (root.querySelector('#be-form'));
  const summary = /** @type {HTMLElement} */ (root.querySelector('#be-summary'));
  const results = /** @type {HTMLElement} */ (root.querySelector('#be-results'));
  const value = (/** @type {string} */ id) => /** @type {HTMLInputElement | HTMLSelectElement} */ (form.querySelector(`#${id}`)).value;
  /** @type {Row[]} */
  let filtered = [];

  /** The state the form shows (the rows shown start again from one page). @returns {State} */
  const readForm = () => stateFromQuery(new URLSearchParams(queryFromState({
    body: value('be-body'), area: value('be-area'), win: value('be-win'), def: value('be-def'),
    stand: [.../** @type {HTMLSelectElement} */ (form.querySelector('#be-stand')).selectedOptions].map((o) => o.value),
    from: /^\d{4}$/.test(value('be-from')) ? Number(value('be-from')) : null,
    to: /^\d{4}$/.test(value('be-to')) ? Number(value('be-to')) : null,
    result: /** @type {State['result']} */ (value('be-result')), unopposed: /** @type {State['unopposed']} */ (value('be-unopposed')),
    type: /** @type {State['type']} */ (value('be-type')), sort: /** @type {State['sort']} */ (value('be-sort')),
    dir: /** @type {State['dir']} */ (value('be-dir')), party: value('be-party'), n: PAGE,
  })));

  const name = (/** @type {string | null | undefined} */ p) => (p ? table.parties[p]?.name || p : null);
  const chip = (/** @type {string | null | undefined} */ p) => partyChip(name(p), p ? table.parties[p]?.colour : null);
  /** @param {Row} r */
  const rowHtml = (r) => {
    const unit = table.units[r.unit];
    const bodyCell = unit?.council ? `<a href="/elections/control/?council=${encodeURIComponent(r.unit)}">${esc(unit.name)}</a>` : `<a href="${appUrl.body(r.body)}">${esc(unit?.name || r.body)}</a>`;
    const href = areaUrl(r) || (r.election && r.contest ? appUrl.contest(r.election, r.contest) : null);
    const area = r.area ? (href ? `<a href="${href}">${esc(r.area)}</a>` : esc(r.area)) : '—';
    const winners = r.winners.map((w) => {
      const url = personUrl(w.name, w.personId);
      return `<span class="el-be-winner">${url ? `<a href="${esc(url)}">${esc(w.name)}</a>` : esc(w.name)} ${chip(w.party)}</span>`;
    }).join('') + (r.type === 'co-option' ? ` <span class="cg-badge">${esc(TEXT.coOpted)}</span>` : r.unopposed ? ` <span class="cg-badge">${esc(TEXT.unopposed)}</span>` : '');
    const def = r.defending
      ? `${r.defending.party ? chip(r.defending.party) : `<span class="el-muted">${esc(TEXT.notRecorded)}</span>`} <span class="el-muted el-be-departing">${esc(r.defending.name)} (${esc(r.defending.basis === 'seat' ? TEXT.basisSeat : TEXT.basisCause)})</span>`
      : `<span class="el-muted">${esc(TEXT.notRecorded)}</span>`;
    const result = r.result === 'held' ? `<span class="cg-badge cg-badge--success">${esc(TEXT.held)}</span>`
      : r.result === 'gained' ? `<span class="cg-badge cg-badge--warning">${esc(TEXT.gained)}</span>` : '<span class="el-muted">—</span>';
    const share = state.sort === 'share' && state.party ? `<td class="num">${fmtPct(partyShare(r, state.party))}</td>` : '';
    return `<tr><td class="el-nowrap">${esc(fmtDate(r.date))}</td><td>${bodyCell}</td><th scope="row">${area}</th><td>${winners}</td><td>${def}</td><td>${result}</td>`
      + `<td class="num">${r.turnout ? fmtPct(r.turnout) : '—'}</td><td class="num">${r.majority ? `${fmtInt(r.majority)}${r.majorityPct ? ` <span class="el-muted">(${fmtPct(r.majorityPct)})</span>` : ''}` : '—'}</td>${share}</tr>`;
  };

  const draw = () => {
    filtered = sortRows(filterRows(table.rows, state), state);
    const c = summarise(filtered);
    const parts = [
      fill(c.byElections === 1 ? TEXT.beSummaryOne : TEXT.beSummary, { n: fmtInt(c.byElections), m: fmtInt(c.changed) }),
      fill(TEXT.beHeld, { n: fmtInt(c.held) }),
      c.unknown ? fill(TEXT.beUnknown, { n: fmtInt(c.unknown) }) : '',
      c.coOptions ? fill(c.coOptions === 1 ? TEXT.beCoOptionOne : TEXT.beCoOption, { n: fmtInt(c.coOptions) }) : '',
    ].filter(Boolean);
    summary.innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join(' ');
    if (!filtered.length) {
      results.innerHTML = `<p class="el-muted">${esc(TEXT.noMatch)}</p>`;
      return;
    }
    const shown = filtered.slice(0, state.n);
    const shareHead = state.sort === 'share' && state.party ? `<th scope="col" class="num">${esc(TEXT.share)}: ${esc(name(state.party) || '')}</th>` : '';
    results.innerHTML = `<div class="cg-table-wrap" tabindex="0" role="region" aria-label="${esc(TEXT.beTitle)}"><table class="cg-table cg-table--compact el-be-table">
      <thead><tr><th scope="col">${esc(TEXT.date)}</th><th scope="col">${esc(TEXT.body)}</th><th scope="col">${esc(TEXT.area)}</th><th scope="col">${esc(TEXT.winner)}</th><th scope="col">${esc(TEXT.defending)}</th><th scope="col">${esc(TEXT.result)}</th><th scope="col" class="num">${esc(TEXT.turnout)}</th><th scope="col" class="num">${esc(TEXT.majority)}</th>${shareHead}</tr></thead>
      <tbody>${shown.map(rowHtml).join('')}</tbody></table></div>
      <p class="el-muted">${esc(fill(TEXT.showing, { n: fmtInt(shown.length), total: fmtInt(filtered.length) }))}</p>
      ${filtered.length > shown.length ? `<button type="button" class="cg-button" id="be-more">${esc(TEXT.more)}</button>` : ''}`;
  };

  const listen = { signal: ctx.signal };
  const update = () => {
    state = readForm();
    history.replaceState(null, '', `${BASE}${queryFromState(state) ? `?${queryFromState(state)}` : ''}`);
    draw();
  };
  form.addEventListener('change', () => { update(); }, listen);
  form.addEventListener('input', (e) => { if (/** @type {HTMLElement} */ (e.target).id === 'be-area') update(); }, listen);
  results.addEventListener('click', (e) => {
    if (!(e.target instanceof HTMLElement) || e.target.id !== 'be-more') return;
    const first = state.n;
    state = { ...state, n: state.n + PAGE };
    history.replaceState(null, '', `${BASE}?${queryFromState(state)}`);
    draw();
    // Keyboard users carry on from the first new row.
    /** @type {HTMLElement | null} */ (results.querySelector(`tbody tr:nth-child(${first + 1}) a`))?.focus();
  }, listen);
  root.querySelector('#be-csv')?.addEventListener('click', () => { downloadText('civgraph-by-elections.csv', byElectionsCsv(filtered, table)); }, listen);
  draw();
  return TEXT.beTitle;
}
