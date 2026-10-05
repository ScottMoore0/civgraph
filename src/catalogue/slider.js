/**
 * The year filter: two handles on one track, moving a decade at a time, with a readout of the
 * range and how many maps (or elections) it holds.
 *
 * Decades are fixed once from all the data (decadeDomain), so the handles keep their meaning while
 * other filters change only the counts (binCounts).
 */
import { esc, plural } from './util.js';

const FLOOR = 1800;

/** The decades the slider runs over: one per decade from the earliest to the latest year, with
 * anything before 1800 gathered into one first step. */
export function decadeDomain(years) {
  const ys = years.filter(Number.isFinite);
  if (!ys.length) return [];
  const bins = [];
  if (ys.some((y) => y < FLOOR)) bins.push({ label: `Before ${FLOOR}`, start: -Infinity, end: FLOOR - 1 });
  const first = Math.max(FLOOR, Math.floor(Math.min(...ys) / 10) * 10);
  const last = Math.floor(Math.max(...ys) / 10) * 10;
  for (let d = first; d <= last; d += 10) bins.push({ label: `${d}s`, start: d, end: d + 9 });
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

/** Index of the decade a stored filter year falls in; the ends when unset. */
export function indexOf(bins, year, fallback) {
  if (year === null || year === undefined || year === '') return fallback;
  const i = bins.findIndex((b) => year >= b.start && year <= b.end);
  return i >= 0 ? i : fallback;
}

function readout(bins, counts, from, to, noun) {
  const total = counts.slice(from, to + 1).reduce((a, b) => a + b, 0);
  const range = from === to ? bins[from].label : `${bins[from].label} – ${bins[to].label}`;
  return `${range} · ${plural(total, noun)}`;
}

export function sliderHtml(key, bins, counts, from, to, noun) {
  if (!bins.length) return '';
  const last = bins.length - 1;
  const narrowed = from > 0 || to < last;
  return `<div class="cn-years" data-cn-slider="${esc(key)}">
    <div class="cn-years__head">
      <span class="cn-label">Years</span>
      <output class="cn-years__out" data-cn-years-out>${esc(readout(bins, counts, from, to, noun))}</output>
      <button type="button" class="cn-link" data-cn-act="years-reset" data-key="${esc(key)}"${narrowed ? '' : ' hidden'}>All years</button>
    </div>
    <div class="cn-range">
      <input type="range" min="0" max="${last}" step="1" value="${from}" data-cn-range="from" data-key="${esc(key)}" aria-label="Earliest decade" aria-valuetext="${esc(bins[from].label)}">
      <input type="range" min="0" max="${last}" step="1" value="${to}" data-cn-range="to" data-key="${esc(key)}" aria-label="Latest decade" aria-valuetext="${esc(bins[to].label)}">
    </div>
    <div class="cn-years__ends" aria-hidden="true"><span>${esc(bins[0].label)}</span><span>${esc(bins[last].label)}</span></div>
  </div>`;
}

/** Bring a slider already on the page up to date without replacing it (a handle may be held). */
export function updateSlider(el, bins, counts, from, to, noun) {
  if (!el) return;
  const out = el.querySelector('[data-cn-years-out]');
  if (out) out.textContent = readout(bins, counts, from, to, noun);
  const [a, b] = el.querySelectorAll('input[type="range"]');
  if (a && Number(a.value) !== from) a.value = String(from);
  if (b && Number(b.value) !== to) b.value = String(to);
  a?.setAttribute('aria-valuetext', bins[from].label);
  b?.setAttribute('aria-valuetext', bins[to].label);
  const reset = el.querySelector('[data-cn-act="years-reset"]');
  if (reset) reset.hidden = !(from > 0 || to < bins.length - 1);
}
