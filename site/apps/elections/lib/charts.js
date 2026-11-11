/**
 * Hand-written SVG charts of the Elections app, as strings (no DOM, no library): the parliament
 * arc, a seat bar, horizontal bars, quota bars and the transfer flow of one count stage. Every
 * chart has a <title> and a text equivalent beside it in the page (a table). Colours are the
 * party colours of the records; everything else uses currentColor and the chart tokens.
 * tests/unit/elections-app-lib.test.mjs.
 */
import { esc, fmtInt, fmtPct, inkOn, partyColour } from './format.js';

/**
 * Seat positions of a parliament arc for n seats: rows of a half-annulus, each row's seats
 * proportional to its radius, ordered left to right by angle.
 * @param {number} n
 * @returns {{ rows: number, points: Array<{ x: number, y: number, a: number, row: number }>, dot: number }}
 */
export function arcLayout(n) {
  if (n <= 0) return { rows: 0, points: [], dot: 0 };
  const rows = n < 4 ? 1 : Math.max(1, Math.round(Math.sqrt(n) / 2));
  const inner = rows === 1 ? 1 : 0.42;
  const radii = Array.from({ length: rows }, (_, i) => (rows === 1 ? 1 : inner + (i * (1 - inner)) / (rows - 1)));
  const sum = radii.reduce((s, r) => s + r, 0);
  const counts = radii.map((r) => Math.max(1, Math.floor((n * r) / sum)));
  let left = n - counts.reduce((s, c) => s + c, 0);
  for (let i = rows - 1; left > 0; i = (i - 1 + rows) % rows) { counts[i] += 1; left -= 1; }
  for (let i = rows - 1; left < 0; i = (i - 1 + rows) % rows) { if (counts[i] > 1) { counts[i] -= 1; left += 1; } }
  /** @type {Array<{ x: number, y: number, a: number, row: number }>} */
  const points = [];
  let spacing = Infinity;
  radii.forEach((r, row) => {
    const s = counts[row];
    if (s > 1) spacing = Math.min(spacing, (Math.PI * r) / (s - 1));
    for (let j = 0; j < s; j += 1) {
      const a = s === 1 ? Math.PI / 2 : Math.PI - (Math.PI * j) / (s - 1);
      points.push({ x: r * Math.cos(a), y: r * Math.sin(a), a, row });
    }
  });
  const gap = rows > 1 ? (1 - inner) / (rows - 1) : 0.5;
  const dot = Math.min(gap, Number.isFinite(spacing) ? spacing : 0.5) * 0.42;
  points.sort((p, q) => q.a - p.a || p.row - q.row);
  return { rows, points, dot };
}

/**
 * A parliament arc of parties' seats ([{ party, seats, colour }], in the order to draw them).
 * @param {Array<{ party: string, seats: number, colour?: string }>} parties
 * @param {{ title?: string, majority?: boolean }} [opts]
 */
export function parliamentArc(parties, opts = {}) {
  const seats = parties.flatMap((p) => Array.from({ length: Math.max(0, p.seats | 0) }, () => p));
  const n = seats.length;
  const { points, dot } = arcLayout(n);
  const W = 400;
  const H = 215;
  const R = 190;
  const cx = W / 2;
  const cy = 200;
  const title = opts.title || `${n} seats`;
  const circles = points.map((pt, i) => {
    const p = seats[i];
    return `<circle cx="${(cx + pt.x * R).toFixed(1)}" cy="${(cy - pt.y * R).toFixed(1)}" r="${(dot * R).toFixed(2)}" fill="${esc(partyColour(p.colour))}"><title>${esc(p.party)}</title></circle>`;
  }).join('');
  const half = Math.floor(n / 2) + 1;
  const label = opts.majority === false || n < 3 ? '' : `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="22" font-weight="700" fill="currentColor">${n}</text><text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="11" fill="currentColor">majority ${half}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" class="el-arc"><title>${esc(title)}</title>${circles}${label}</svg>`;
}

/**
 * One stacked bar of seats by party, for a small body or a single contest.
 * @param {Array<{ party: string, seats: number, colour?: string }>} parties
 * @param {{ title?: string }} [opts]
 */
export function seatBar(parties, opts = {}) {
  const total = parties.reduce((s, p) => s + Math.max(0, p.seats), 0);
  if (!total) return '';
  const W = 400;
  let x = 0;
  const parts = parties.filter((p) => p.seats > 0).map((p) => {
    const w = (W * p.seats) / total;
    const fill = partyColour(p.colour);
    const text = w > 26 ? `<text x="${(x + w / 2).toFixed(1)}" y="20" text-anchor="middle" font-size="12" fill="${inkOn(fill)}">${p.seats}</text>` : '';
    const out = `<g><rect x="${x.toFixed(1)}" y="4" width="${w.toFixed(1)}" height="24" fill="${esc(fill)}"><title>${esc(p.party)}: ${p.seats}</title></rect>${text}</g>`;
    x += w;
    return out;
  }).join('');
  const title = opts.title || `${total} seats`;
  return `<svg viewBox="0 0 ${W} 32" role="img" aria-label="${esc(title)}" class="el-seatbar"><title>${esc(title)}</title>${parts}</svg>`;
}

/**
 * Horizontal bars: [{ label, value, colour, note? }], scaled to max (default the largest).
 * @param {Array<{ label: string, value: number | null, colour?: string, note?: string }>} rows
 * @param {{ max?: number, format?: (v: number) => string, title?: string, marker?: { value: number, label: string } }} [opts]
 */
export function hbars(rows, opts = {}) {
  const fmt = opts.format || ((v) => fmtInt(v));
  const max = opts.max || Math.max(1, ...rows.map((r) => r.value || 0), opts.marker?.value || 0);
  const W = 560;
  const L = 170;
  const B = 22;
  const H = rows.length * B + 8 + (opts.marker ? 14 : 0);
  const top = opts.marker ? 14 : 0;
  const bars = rows.map((r, i) => {
    const y = top + i * B + 4;
    const w = r.value ? ((W - L - 70) * r.value) / max : 0;
    const label = r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label;
    return `<g><text x="${L - 6}" y="${y + 13}" text-anchor="end" font-size="12" fill="currentColor">${esc(label)}<title>${esc(r.label)}</title></text>`
      + `<rect x="${L}" y="${y + 2}" width="${Math.max(0, w).toFixed(1)}" height="${B - 8}" rx="2" fill="${esc(partyColour(r.colour))}"><title>${esc(r.label)}: ${esc(r.value === null ? '—' : fmt(r.value))}</title></rect>`
      + `<text x="${L + Math.max(0, w) + 5}" y="${y + 13}" font-size="12" fill="currentColor">${esc(r.value === null ? (r.note || '—') : fmt(r.value))}</text></g>`;
  }).join('');
  const marker = opts.marker
    ? `<g class="el-marker"><line x1="${L + ((W - L - 70) * opts.marker.value) / max}" x2="${L + ((W - L - 70) * opts.marker.value) / max}" y1="10" y2="${H}" stroke="currentColor" stroke-dasharray="3 3"/><text x="${L + ((W - L - 70) * opts.marker.value) / max}" y="9" text-anchor="middle" font-size="11" fill="currentColor">${esc(opts.marker.label)}</text></g>`
    : '';
  const title = opts.title || 'Bar chart';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" class="el-hbars"><title>${esc(title)}</title>${bars}${marker}</svg>`;
}

/**
 * The flow of one count stage: the candidate(s) distributed on the left, the candidates who
 * gained and non-transferable on the right, band widths proportional to votes. When several
 * candidates are distributed at once their votes are drawn as one pool (the records do not say
 * whose votes went where).
 * @param {{ stage: number, kind: string, from: Array<{ name: string, colour?: string, amount: number }>, to: Array<{ name: string, colour?: string, amount: number }>, nonTransferable: number, distributed: number }} st
 */
export function transferFlow(st) {
  const W = 560;
  const targets = [...st.to].sort((a, b) => b.amount - a.amount);
  if (st.nonTransferable > 0) targets.push({ name: 'Non-transferable', colour: '#9aa0a6', amount: st.nonTransferable });
  const total = Math.max(st.distributed, targets.reduce((s, t) => s + t.amount, 0), 1);
  const gap = 6;
  const H = Math.max(120, targets.length * 26 + 20);
  const usable = H - 20 - gap * Math.max(0, targets.length - 1);
  const scale = usable / total;
  const fromH = Math.max(4, st.distributed * scale);
  const fromY = 10 + (usable - fromH) / 2;
  const fromColour = st.from.length === 1 ? partyColour(st.from[0].colour) : '#6b7280';
  const fromName = st.from.length === 1 ? st.from[0].name : `${st.from.length} candidates`;
  let y = 10;
  let fy = fromY;
  const xL = 150;
  const xR = 390;
  const bands = targets.map((t) => {
    const h = Math.max(1.5, t.amount * scale);
    const fh = (t.amount / Math.max(st.distributed, 1)) * fromH;
    const path = `M${xL},${fy.toFixed(1)} C${(xL + xR) / 2},${fy.toFixed(1)} ${(xL + xR) / 2},${y.toFixed(1)} ${xR},${y.toFixed(1)} L${xR},${(y + h).toFixed(1)} C${(xL + xR) / 2},${(y + h).toFixed(1)} ${(xL + xR) / 2},${(fy + fh).toFixed(1)} ${xL},${(fy + fh).toFixed(1)} Z`;
    const out = `<path d="${path}" fill="${esc(partyColour(t.colour))}" fill-opacity="0.45"><title>${esc(t.name)}: +${esc(fmtInt(t.amount))}</title></path>`
      + `<rect x="${xR}" y="${y.toFixed(1)}" width="10" height="${h.toFixed(1)}" fill="${esc(partyColour(t.colour))}"/>`
      + `<text x="${xR + 16}" y="${(y + h / 2 + 4).toFixed(1)}" font-size="12" fill="currentColor">${esc(t.name)} +${esc(fmtInt(t.amount))}</text>`;
    y += h + gap;
    fy += fh;
    return out;
  }).join('');
  const title = `Count ${st.stage}: ${st.kind === 'surplus' ? 'surplus of' : 'votes of'} ${fromName} (${fmtInt(st.distributed)}) transferred`;
  const left = `<rect x="${xL - 10}" y="${fromY.toFixed(1)}" width="10" height="${fromH.toFixed(1)}" fill="${esc(fromColour)}"/>`
    + `<text x="${xL - 16}" y="${(fromY + fromH / 2 - 2).toFixed(1)}" text-anchor="end" font-size="12" fill="currentColor">${esc(fromName)}</text>`
    + `<text x="${xL - 16}" y="${(fromY + fromH / 2 + 12).toFixed(1)}" text-anchor="end" font-size="11" fill="currentColor">${st.kind === 'surplus' ? 'surplus' : 'excluded'} ${esc(fmtInt(st.distributed))}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" class="el-flow"><title>${esc(title)}</title>${left}${bands}</svg>`;
}

/**
 * Quota bars: each candidate's votes at their last stage against the quota (1.0).
 * @param {Array<{ name: string, colour?: string, first: number | null, total: number | null, ratio: number | null, elected: boolean }>} rows
 * @param {number} quota
 */
export function quotaBars(rows, quota) {
  const max = Math.max(1.05, ...rows.map((r) => r.ratio || 0));
  return hbars(rows.map((r) => ({ label: r.name, value: r.total, colour: r.colour })), {
    max: max * quota,
    marker: { value: quota, label: `quota ${fmtInt(quota)}` },
    title: 'Votes at the last count against the quota',
    format: (v) => `${fmtInt(v)} (${fmtPct((100 * v) / quota, 0)} of quota)`,
  });
}
