/**
 * The STV parts of a contest page (el-stv, 14 Nov 2026): what each count did, the same count
 * stacked a count at a time for phones, the quota's formula and the last seat's margin, a
 * count-by-count stepper, the transfers between candidates, and the whole count as a flow.
 *
 * The derivations are lib/stv.js and lib/sankey.js (pure, tested); this module only writes HTML
 * and wires the stepper. views/contest.js puts `afterSheet` under the count sheet and `sections`
 * after the quota bars. Every word is keyed in data/i18n/strings/elections.txt (R10).
 */
import {
  contestMatrix, countEvents, countLabel, countSentences, fill, inQuotas, lastSeatMargin, marginSentence, orderLabels,
  quotaExplained, standingAt, stepFromQuery, stepSearch, stepTo, STV_TEXT,
} from '../lib/stv.js';
import { countSankey } from '../lib/sankey.js';
import { chartData } from '../lib/chart-data.js';
import { esc, fmtInt, fmtPct } from '../lib/format.js';
import { partyColour } from '../lib/party.js';

/**
 * @typedef {ReturnType<typeof import('../lib/count.js').countSheet>} Sheet
 * @typedef {import('../lib/stv.js').CountEvent} CountEvent
 */

/** The fixed words of these parts (each a line of data/i18n/strings/elections.txt). */
export const STV_VIEW_TEXT = Object.freeze({
  whatEachDid: 'What each count did',
  stackedCaption: 'Each candidate at this count: the change since the count before, and the votes held.',
  candidate: 'Candidate',
  change: 'Change',
  votes: 'Votes',
  stateElected: 'Elected',
  stateExcluded: 'Excluded',
  stateContinuing: 'Continuing',
  nonTransferable: 'Non-transferable',
  quotaAndLastSeat: 'The quota and the last seat',
  marginAt: 'At count {count}: {name} {n}, {other} {k}.',
  stepper: 'Count by count',
  stepperHelp: 'Step through the count with the buttons, or with the arrow keys while a button has focus.',
  stepperControls: 'Step through the counts',
  first: 'First count',
  prev: 'Previous count',
  next: 'Next count',
  last: 'Last count',
  position: 'Count {count} of {total}',
  linkHere: 'Link to this count',
  stepperCaption: 'Each candidate at the count shown, whether elected, excluded or still in the count: the change since the count before, the votes held, and how far they are towards the quota.',
  matrix: 'Transfers between candidates',
  matrixLead: 'Each row is a count after the first: whose votes were passed on, and how many each candidate received. A share is of the votes passed on at that count.',
  matrixPooled: 'A row marked "passed on together" moved several candidates\' votes at once: the source gives each candidate\'s gain, not whose votes it came from.',
  matrixDerived: 'A non-transferable figure marked * is worked out from the totals (the votes passed on less the votes received), because the source does not give it.',
  matrixCaption: 'Transfers at each count, from the candidate or candidates passed on to each candidate who gained.',
  count: 'Count',
  passedOn: 'Passed on',
  together: 'passed on together',
  workedOut: '*',
  sankey: 'The whole count as a flow',
  sankeyLead: 'Each column is a count. Colours are the parties\' colours; grey is non-transferable votes and votes passed on together. Every band is also in the table of transfers above, and every total in the count sheet.',
  sankeyRegion: 'The whole count as a flow (scrolls sideways)',
  matrixRegion: 'Transfers between candidates (scrolls sideways)',
  quotas: 'Quotas',
  flowData: 'Every transfer of the count',
  from: 'From',
  to: 'To',
});

/** @param {number} total @param {number | null} quota */
const quotaNote = (total, quota) => (quota ? `<span class="el-muted el-step__q">${esc(inQuotas(total, quota))}</span>` : '');

/** @param {'elected' | 'excluded' | 'continuing'} state @param {boolean} here */
function stateBadge(state, here) {
  if (state === 'elected') return `<span class="cg-badge cg-badge--success">${esc(STV_VIEW_TEXT.stateElected)}</span>`;
  if (state === 'excluded') return here ? `<span class="cg-badge cg-badge--danger">${esc(STV_VIEW_TEXT.stateExcluded)}</span>` : `<span class="el-muted">${esc(STV_VIEW_TEXT.stateExcluded)}</span>`;
  return `<span class="el-muted">${esc(STV_VIEW_TEXT.stateContinuing)}</span>`;
}

/** A change as "+12" or "−986", thousands kept. @param {number | null} v */
export function signed(v) {
  if (v === null || Math.abs(v) < 0.005) return '';
  const digits = Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2;
  return `${v > 0 ? '+' : '−'}${fmtInt(Number(Math.abs(v).toFixed(digits)))}`;
}

/**
 * The parts of the count sheet section: what each count did (a list), and on phones the count
 * stacked a count at a time instead of the wide grid. For a count-order sheet, the order.
 * @param {Sheet} sheet @param {CountEvent[]} events
 */
export function afterSheetHtml(sheet, events) {
  if (sheet.kind === 'order') {
    const labels = orderLabels(sheet);
    return labels.length ? `<h3 class="el-stv-h3">${esc(STV_VIEW_TEXT.whatEachDid)}</h3><p class="el-muted">${esc(STV_TEXT.orderOnly)}</p><ol class="el-count-labels">${labels.map((l) => `<li>${esc(l.label)}</li>`).join('')}</ol>` : '';
  }
  if (sheet.kind !== 'stages' || !events.length) return '';
  const list = `<div class="el-wide-only"><h3 class="el-stv-h3">${esc(STV_VIEW_TEXT.whatEachDid)}</h3><ol class="el-count-labels">${events.map((ev) => `<li>${esc(countLabel(ev))}</li>`).join('')}</ol></div>`;
  const stacked = events.map((ev) => {
    const rows = standingAt(sheet, ev.stage).filter((s) => s.total !== null && (s.total > 0.005 || (s.change !== null && Math.abs(s.change) > 0.005)));
    const nt = sheet.nonTransferable.get(ev.stage);
    return `<section class="el-stack-count"><h3>${esc(countLabel(ev))}</h3><table class="cg-table cg-table--compact"><caption class="el-sr">${esc(STV_VIEW_TEXT.stackedCaption)}</caption>
      <thead><tr><th scope="col">${esc(STV_VIEW_TEXT.candidate)}</th><th scope="col" class="num">${esc(STV_VIEW_TEXT.change)}</th><th scope="col" class="num">${esc(STV_VIEW_TEXT.votes)}</th></tr></thead>
      <tbody>${rows.map((s) => `<tr${s.state === 'elected' ? ' class="cg-elected"' : ''}><th scope="row">${esc(s.row.name)}${s.here ? ` ${stateBadge(s.state, true)}` : ''}</th><td class="num">${esc(signed(s.change))}</td><td class="num">${fmtInt(s.total)}</td></tr>`).join('')}
      ${ev.nonTransferable > 0 || (nt && nt.total) ? `<tr class="el-nt"><th scope="row">${esc(STV_VIEW_TEXT.nonTransferable)}</th><td class="num">${esc(signed(ev.index ? ev.nonTransferable : null))}${ev.ntRecorded || !ev.nonTransferable ? '' : esc(STV_VIEW_TEXT.workedOut)}</td><td class="num">${nt && nt.total !== null ? fmtInt(nt.total) : ''}</td></tr>` : ''}
      </tbody></table></section>`;
  }).join('');
  return `${list}<div class="el-stacked el-narrow-only">${stacked}</div>`;
}

/**
 * The quota's formula and the last seat's margin, for any STV contest with votes.
 * @param {Sheet} sheet
 */
export function quotaSectionHtml(sheet) {
  if (!['stages', 'single', 'order'].includes(sheet.kind)) return '';
  const q = quotaExplained(sheet);
  const m = lastSeatMargin(sheet);
  if (!q && !m) return '';
  return `<section aria-labelledby="el-quota-seat"><h2 id="el-quota-seat">${esc(STV_VIEW_TEXT.quotaAndLastSeat)}</h2>
    ${q ? `<p data-quota-formula="${q.matches === false ? 'differs' : q.matches === null ? 'none' : 'droop'}">${esc(q.sentence)}</p>` : ''}
    ${m ? `<p class="cg-notice" data-margin>${esc(marginSentence(m))} <span class="el-muted">${esc(fill(STV_VIEW_TEXT.marginAt, { count: m.stage, name: m.lastElected.name, n: fmtInt(m.lastElected.total), other: m.runnerUp.name, k: fmtInt(m.runnerUp.total) }))}</span></p>` : ''}
  </section>`;
}

/**
 * The stepper's frame; its body is drawn by `drawStep`.
 * @param {Sheet} sheet @param {number} stage
 */
function stepperHtml(sheet, stage) {
  const total = sheet.stages.length;
  return `<section aria-labelledby="el-stepper-h" class="el-stepper" data-stv-stepper>
    <h2 id="el-stepper-h">${esc(STV_VIEW_TEXT.stepper)}</h2>
    <p class="el-muted" id="el-stepper-help">${esc(STV_VIEW_TEXT.stepperHelp)}</p>
    <div class="el-stepper__bar" role="group" aria-label="${esc(STV_VIEW_TEXT.stepperControls)}" aria-describedby="el-stepper-help">
      <button type="button" class="cg-button" data-step="first">${esc(STV_VIEW_TEXT.first)}</button>
      <button type="button" class="cg-button" data-step="prev">${esc(STV_VIEW_TEXT.prev)}</button>
      <span class="el-stepper__pos" data-step-pos>${esc(fill(STV_VIEW_TEXT.position, { count: stage, total }))}</span>
      <button type="button" class="cg-button cg-button--primary" data-step="next">${esc(STV_VIEW_TEXT.next)}</button>
      <button type="button" class="cg-button" data-step="last">${esc(STV_VIEW_TEXT.last)}</button>
    </div>
    <div class="el-stepper__now" aria-live="polite" aria-atomic="true" data-step-now></div>
    <div class="cg-table-wrap"><table class="cg-table cg-table--compact el-stepper__table"><caption class="el-sr">${esc(STV_VIEW_TEXT.stepperCaption)}</caption>
      <thead><tr><th scope="col">${esc(STV_VIEW_TEXT.candidate)}</th><th scope="col" class="num">${esc(STV_VIEW_TEXT.change)}</th><th scope="col" class="num">${esc(STV_VIEW_TEXT.votes)}</th></tr></thead>
      <tbody>${sheet.rows.map((r) => `<tr data-id="${esc(r.id)}"><th scope="row"><span class="el-step__name">${esc(r.name)}</span> <span class="el-muted el-step__party">${esc(r.party)}</span> <span data-cell="state"></span>
        <span class="el-step__track" aria-hidden="true"><span class="el-step__fill" style="background:${esc(partyColour(r.colour))}"></span><span class="el-step__quota"></span></span></th>
        <td class="num" data-cell="change"></td><td class="num" data-cell="votes"></td></tr>`).join('')}</tbody></table></div>
    <p class="el-muted"><a href="" data-step-link>${esc(STV_VIEW_TEXT.linkHere)}</a></p>
  </section>`;
}

/**
 * The scale of the stepper's bars: the quota or the largest total, whichever is more.
 * @param {Sheet} sheet
 */
export function stepScale(sheet) {
  let max = sheet.quota || 0;
  for (const r of sheet.rows) for (const k of r.cells) if (k.total !== null && k.total > max) max = k.total;
  return max || 1;
}

/**
 * Draw one count into the stepper in place (rows keep their elements, so the bars move unless
 * the reader prefers reduced motion: elections.css gates the transition).
 * @param {HTMLElement} el  the stepper section
 * @param {Sheet} sheet @param {CountEvent[]} events @param {number} stage @param {string} pathname @param {string} search
 */
export function drawStep(el, sheet, events, stage, pathname, search) {
  const i = Math.max(0, sheet.stages.indexOf(stage));
  const ev = events[i];
  const scale = stepScale(sheet);
  const now = /** @type {HTMLElement} */ (el.querySelector('[data-step-now]'));
  now.innerHTML = `<h3>${esc(countLabel(ev))}</h3><p>${countSentences(ev, sheet.quota).map((s) => `<span>${esc(s)}</span>`).join(' ')}</p>`;
  /** @type {HTMLElement} */ (el.querySelector('[data-step-pos]')).textContent = fill(STV_VIEW_TEXT.position, { count: stage, total: sheet.stages.length });
  for (const s of standingAt(sheet, stage)) {
    const tr = el.querySelector(`tr[data-id="${CSS.escape(s.row.id)}"]`);
    if (!tr) continue;
    tr.classList.toggle('cg-elected', s.state === 'elected');
    tr.classList.toggle('el-step--out', s.state === 'excluded' && !s.here);
    /** @type {HTMLElement} */ (tr.querySelector('[data-cell="change"]')).textContent = signed(s.change);
    /** @type {HTMLElement} */ (tr.querySelector('[data-cell="votes"]')).innerHTML = s.total === null ? '' : `${fmtInt(s.total)} ${quotaNote(s.total, sheet.quota)}`;
    /** @type {HTMLElement} */ (tr.querySelector('[data-cell="state"]')).innerHTML = stateBadge(s.state, s.here);
    /** @type {HTMLElement} */ (tr.querySelector('.el-step__fill')).style.width = `${Math.max(0, Math.min(100, (100 * (s.total || 0)) / scale)).toFixed(2)}%`;
    /** @type {HTMLElement} */ (tr.querySelector('.el-step__quota')).style.left = sheet.quota ? `${Math.min(100, (100 * sheet.quota) / scale).toFixed(2)}%` : '-10px';
  }
  const first = sheet.stages[0];
  const lastStage = sheet.stages[sheet.stages.length - 1];
  for (const b of el.querySelectorAll('button[data-step]')) {
    const move = b.getAttribute('data-step');
    /** @type {HTMLButtonElement} */ (b).disabled = ((move === 'first' || move === 'prev') && stage === first) || ((move === 'next' || move === 'last') && stage === lastStage);
  }
  /** @type {HTMLAnchorElement} */ (el.querySelector('[data-step-link]')).href = `${pathname}${stepSearch(search, stage, sheet.stages)}#el-stepper-h`;
}

/**
 * The transfers between candidates: one row a count, with a stacked twin for phones.
 * @param {Sheet} sheet @param {CountEvent[]} events
 */
export function matrixHtml(sheet, events) {
  const rows = contestMatrix(events);
  if (!rows.length) return '';
  const gainers = sheet.rows.filter((r) => rows.some((m) => m.cells.has(r.id)));
  const anyNt = rows.some((m) => m.nonTransferable > 0);
  const anyPooled = rows.some((m) => m.pooled);
  const anyDerived = rows.some((m) => m.nonTransferable > 0 && !m.ntRecorded);
  const share = (/** @type {number} */ v, /** @type {number} */ of) => (of > 0 ? fmtPct((100 * v) / of) : '');
  const ntCell = (/** @type {typeof rows[number]} */ m) => (m.nonTransferable > 0 ? `${fmtInt(m.nonTransferable)}${m.ntRecorded ? '' : esc(STV_VIEW_TEXT.workedOut)}` : '');
  const table = `<div class="cg-table-wrap el-wide-only" tabindex="0" role="region" aria-label="${esc(STV_VIEW_TEXT.matrixRegion)}"><table class="cg-table cg-table--compact cg-table--sticky-first el-matrix">
    <caption class="el-sr">${esc(STV_VIEW_TEXT.matrixCaption)}</caption>
    <thead><tr><th scope="col">${esc(STV_VIEW_TEXT.count)}</th><th scope="col" class="num">${esc(STV_VIEW_TEXT.passedOn)}</th>${gainers.map((g) => `<th scope="col" class="num">${esc(g.name)}</th>`).join('')}${anyNt ? `<th scope="col" class="num">${esc(STV_VIEW_TEXT.nonTransferable)}</th>` : ''}</tr></thead>
    <tbody>${rows.map((m) => `<tr><th scope="row">${esc(m.label)}${m.pooled && m.from.length > 1 ? ` <span class="el-muted">(${esc(STV_VIEW_TEXT.together)})</span>` : ''}</th><td class="num">${fmtInt(m.distributed)}</td>${gainers.map((g) => {
      const v = m.cells.get(g.id);
      return `<td class="num">${v === undefined ? '' : `${fmtInt(v)}<span class="el-muted el-share">${esc(share(v, m.distributed))}</span>`}</td>`;
    }).join('')}${anyNt ? `<td class="num">${ntCell(m)}${m.nonTransferable > 0 ? `<span class="el-muted el-share">${esc(share(m.nonTransferable, m.distributed))}</span>` : ''}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
  const stacked = `<div class="el-narrow-only">${rows.map((m) => {
    const to = gainers.filter((g) => m.cells.has(g.id)).map((g) => ({ name: g.name, v: /** @type {number} */ (m.cells.get(g.id)) })).sort((a, b) => b.v - a.v);
    return `<section class="el-stack-count"><h3>${esc(m.label)}${m.pooled && m.from.length > 1 ? ` <span class="el-muted">(${esc(STV_VIEW_TEXT.together)})</span>` : ''}</h3><table class="cg-table cg-table--compact"><caption class="el-sr">${esc(STV_VIEW_TEXT.matrixCaption)}</caption>
      <thead><tr><th scope="col">${esc(STV_VIEW_TEXT.candidate)}</th><th scope="col" class="num">${esc(STV_VIEW_TEXT.votes)}</th><th scope="col" class="num">%</th></tr></thead>
      <tbody>${to.map((t) => `<tr><th scope="row">${esc(t.name)}</th><td class="num">${fmtInt(t.v)}</td><td class="num">${esc(share(t.v, m.distributed))}</td></tr>`).join('')}
      ${m.nonTransferable > 0 ? `<tr class="el-nt"><th scope="row">${esc(STV_VIEW_TEXT.nonTransferable)}</th><td class="num">${ntCell(m)}</td><td class="num">${esc(share(m.nonTransferable, m.distributed))}</td></tr>` : ''}</tbody></table></section>`;
  }).join('')}</div>`;
  return `<section aria-labelledby="el-matrix-h" id="el-matrix"><h2 id="el-matrix-h">${esc(STV_VIEW_TEXT.matrix)}</h2>
    <p class="el-muted">${esc(STV_VIEW_TEXT.matrixLead)}</p>
    ${anyPooled ? `<p class="el-muted">${esc(STV_VIEW_TEXT.matrixPooled)}</p>` : ''}${anyDerived ? `<p class="el-muted">${esc(STV_VIEW_TEXT.matrixDerived)}</p>` : ''}
    ${table}${stacked}</section>`;
}

/**
 * The flow's figures as rows (the chart-data table and CSV behind it): one row a transfer, from
 * the candidate passed on (or the pool, for several at once) to each candidate who gained and to
 * non-transferable.
 * @param {CountEvent[]} events
 * @returns {Array<[number, string, string, string, number]>}
 */
export function transferRows(events) {
  /** @type {Array<[number, string, string, string, number]>} */
  const rows = [];
  for (const m of contestMatrix(events)) {
    const ev = /** @type {CountEvent} */ (events.find((e) => e.stage === m.stage));
    const from = m.from.length === 1 ? m.from[0].name : `${m.from.map((f) => f.name).join(', ')} (${STV_VIEW_TEXT.together})`;
    for (const g of ev.gains) rows.push([m.stage, m.label, from, g.name, g.amount]);
    if (m.nonTransferable > 0) rows.push([m.stage, m.label, from, STV_VIEW_TEXT.nonTransferable, m.nonTransferable]);
  }
  return rows;
}

/**
 * Every STV part of a contest page, as HTML.
 * @param {Sheet} sheet @param {URLSearchParams} query @param {string} [file]  the CSV's file name for the flow's figures
 */
export function stvParts(sheet, query, file) {
  const events = countEvents(sheet);
  const stepper = sheet.kind === 'stages' && events.length > 1;
  const sankey = stepper ? countSankey(sheet, events) : '';
  const sections = [
    quotaSectionHtml(sheet),
    stepper ? stepperHtml(sheet, stepFromQuery(query, sheet.stages)) : '',
    stepper ? matrixHtml(sheet, events) : '',
    sankey ? `<section aria-labelledby="el-sankey-h"><h2 id="el-sankey-h">${esc(STV_VIEW_TEXT.sankey)}</h2><p class="el-muted">${esc(STV_VIEW_TEXT.sankeyLead)}</p>
      <figure class="cg-chart el-sankey-fig"><div class="el-sankey-wrap" tabindex="0" role="region" aria-label="${esc(STV_VIEW_TEXT.sankeyRegion)}">${sankey}</div>${chartData({
        id: 'transfers', caption: STV_VIEW_TEXT.flowData, file: file || 'civgraph-transfers',
        columns: [{ label: STV_VIEW_TEXT.count, num: true }, { label: STV_VIEW_TEXT.whatEachDid }, { label: STV_VIEW_TEXT.from }, { label: STV_VIEW_TEXT.to }, { label: STV_VIEW_TEXT.votes, num: true, format: fmtInt }],
        rows: transferRows(events),
      })}</figure></section>` : '',
  ].join('');
  return { events, afterSheet: afterSheetHtml(sheet, events), sections };
}

/**
 * Wire the stepper (if the page has one): its buttons, the arrow, Home and End keys while a
 * button has focus, and the URL (?count=), replaced so the history keeps one entry per page.
 * Every listener passes the view's signal (R8).
 * @param {HTMLElement} root @param {Sheet} sheet @param {CountEvent[]} events @param {URLSearchParams} query @param {AbortSignal} [signal]
 */
export function wireStepper(root, sheet, events, query, signal) {
  const el = /** @type {HTMLElement | null} */ (root.querySelector('[data-stv-stepper]'));
  if (!el) return;
  let stage = stepFromQuery(query, sheet.stages);
  const go = (/** @type {number} */ next, /** @type {boolean} */ keepFocus) => {
    if (next === stage && keepFocus) return;
    stage = next;
    const focused = keepFocus && document.activeElement instanceof HTMLButtonElement && el.contains(document.activeElement) ? document.activeElement : null;
    drawStep(el, sheet, events, stage, location.pathname, location.search);
    history.replaceState(history.state, '', `${location.pathname}${stepSearch(location.search, stage, sheet.stages)}${location.hash}`);
    // A button that is now disabled loses focus: move it to the nearest control still enabled.
    if (focused && focused.disabled) {
      const atEnd = next === sheet.stages[sheet.stages.length - 1];
      /** @type {HTMLButtonElement | null} */ (el.querySelector(`button[data-step="${atEnd ? 'prev' : 'next'}"]`))?.focus();
    }
  };
  drawStep(el, sheet, events, stage, location.pathname, location.search);
  el.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button[data-step]') : null;
    if (!b) return;
    go(stepTo(/** @type {'first' | 'prev' | 'next' | 'last'} */ (b.getAttribute('data-step')), stage, sheet.stages), true);
  }, { signal });
  el.addEventListener('keydown', (e) => {
    if (!(e.target instanceof HTMLButtonElement)) return;
    /** @type {Record<string, 'first' | 'prev' | 'next' | 'last'>} */
    const keys = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' };
    const move = keys[e.key];
    if (!move) return;
    e.preventDefault();
    go(stepTo(move, stage, sheet.stages), true);
  }, { signal });
}

