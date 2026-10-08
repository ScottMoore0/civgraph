/**
 * The year filter: two handles on one track that snap to decades (1830, 1840 ...), and two boxes
 * for typing an exact first and last year (Phelim Birch's review, 2026-10-06). The handles and
 * the boxes set the same two years; a readout gives the range and how many maps (or elections)
 * it holds.
 *
 * Decades are fixed once from all the data (decadeDomain), so the handles keep their meaning
 * while other filters change only the count.
 */
import { esc, plural } from './util.js';

const FLOOR = 1800;

/** The steps the handles run over: one per decade from the earliest to the latest year, with
 * anything before 1800 gathered into one first step. */
export function decadeDomain(years) {
  const ys = years.filter(Number.isFinite);
  if (!ys.length) return [];
  const bins = [];
  if (ys.some((y) => y < FLOOR)) bins.push({ label: `Before ${FLOOR}`, start: -Infinity, end: FLOOR - 1 });
  const first = Math.max(FLOOR, Math.floor(Math.min(...ys) / 10) * 10);
  const last = Math.floor(Math.max(...ys) / 10) * 10;
  for (let d = first; d <= last; d += 10) bins.push({ label: String(d), start: d, end: d + 9 });
  return bins;
}

export function binCounts(bins, years) {
  const counts = bins.map(() => 0);
  for (const y of years) {
    if (!Number.isFinite(y)) continue;
    const i = bins.findIndex((b) => y >= b.start && y <= b.end);
    if (i >= 0) counts[i] += 1;
  }
  return counts;
}

/** Index of the step a stored filter year falls in; the ends when unset. */
export function indexOf(bins, year, fallback) {
  if (year === null || year === undefined || year === '') return fallback;
  const i = bins.findIndex((b) => year >= b.start && year <= b.end);
  if (i >= 0) return i;
  return year < (bins[0]?.start ?? 0) ? 0 : fallback;
}

/** The year a handle at step i stands for: the decade's first year; the first step, no limit. */
export function stepYear(bins, i, end) {
  if (end === 'from' && i === 0) return null;
  if (end === 'to' && i === bins.length - 1) return null;
  return Number.isFinite(bins[i].start) ? bins[i].start : FLOOR - 1;
}

/** st: { from, to, min, max, total, noun } -- from/to are the chosen years, or null for no limit. */
function readout(bins, st) {
  const a = st.from ?? (Number.isFinite(bins[0]?.start) ? bins[0].start : `before ${FLOOR}`);
  const b = st.to ?? st.max;
  return `${a === b ? a : `${a} – ${b}`} · ${plural(st.total, st.noun)}`;
}

export function sliderHtml(key, bins, i, j, st) {
  if (!bins.length) return '';
  const last = bins.length - 1;
  const narrowed = st.from !== null || st.to !== null;
  const box = (end, value, label, hint) => `<input type="number" inputmode="numeric" class="cn-years__box" data-cn-year="${end}" data-key="${esc(key)}" min="${st.min}" max="${st.max}" step="1" value="${value ?? ''}" placeholder="${esc(hint)}" aria-label="${esc(label)}">`;
  return `<div class="cn-years" data-cn-slider="${esc(key)}">
    <div class="cn-years__head">
      <span class="cn-label">Years</span>
      <output class="cn-years__out" data-cn-years-out>${esc(readout(bins, st))}</output>
      <button type="button" class="cn-link" data-cn-act="years-reset" data-key="${esc(key)}"${narrowed ? '' : ' hidden'}>All years</button>
    </div>
    <div class="cn-range">
      <input type="range" min="0" max="${last}" step="1" value="${i}" data-cn-range="from" data-key="${esc(key)}" aria-label="Earliest year" aria-valuetext="${esc(bins[i].label)}">
      <input type="range" min="0" max="${last}" step="1" value="${j}" data-cn-range="to" data-key="${esc(key)}" aria-label="Latest year" aria-valuetext="${esc(bins[j].label)}">
    </div>
    <div class="cn-years__boxes">${box('from', st.from, 'First year', 'From')}<span aria-hidden="true">–</span>${box('to', st.to, 'Last year', 'To')}</div>
  </div>`;
}

/** Bring a slider already on the page up to date without replacing it (a handle may be held,
 * or a year half typed). */
export function updateSlider(el, bins, i, j, st) {
  if (!el) return;
  const out = el.querySelector('[data-cn-years-out]');
  if (out) out.textContent = readout(bins, st);
  const [a, b] = el.querySelectorAll('input[type="range"]');
  if (a && Number(a.value) !== i) a.value = String(i);
  if (b && Number(b.value) !== j) b.value = String(j);
  a?.setAttribute('aria-valuetext', bins[i].label);
  b?.setAttribute('aria-valuetext', bins[j].label);
  for (const [end, v] of [['from', st.from], ['to', st.to]]) {
    const box = el.querySelector(`[data-cn-year="${end}"]`);
    if (box && document.activeElement !== box) box.value = v ?? '';
  }
  const reset = el.querySelector('[data-cn-act="years-reset"]');
  if (reset) reset.hidden = st.from === null && st.to === null;
}
