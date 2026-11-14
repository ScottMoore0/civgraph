/**
 * The whole count as one flow (a Sankey), as an SVG string (no DOM, no library). One column a
 * count; one block a candidate's votes at that count; a band from count to count for the votes a
 * candidate kept, and a band for each transfer. Pure: tests/unit/elections-app-stv.test.mjs.
 *
 * Honest by construction: it draws only what lib/stv.js countEvents reads from the count sheet.
 * A count that passed on one candidate's votes draws a band from that candidate to each candidate
 * who gained; a count that passed on several candidates' votes together draws them into one grey
 * pool between the columns and out of it, since the sheet does not say whose votes went where.
 * Non-transferable votes gather in their own block at the foot.
 *
 * Legible on a phone: the drawing is made at its natural size in pixels (12 px text) and the page
 * scrolls it sideways in a focusable region below 48rem, rather than shrinking the text. Colour is
 * never the only signal: every block is named at the first and last count, the elected are marked
 * in words, every band and block has a title, and the page gives the same transfers as a table.
 */
import { esc, fmtInt } from './format.js';
import { partyColour } from './party.js';
import { electionsAppColours } from '../../../pkg/registries/src/browser/colour-palettes.mjs';
import { electedFrom, totalAt } from './stv.js';

/**
 * @typedef {ReturnType<typeof import('./count.js').countSheet>} Sheet
 * @typedef {import('./stv.js').CountEvent} CountEvent
 */

/** The words of the drawing (keys of data/i18n/strings/elections.txt). */
export const SANKEY_TEXT = Object.freeze({
  title: 'The whole count as a flow',
  desc: 'Each column is a count and each block a candidate\'s votes at that count. Bands carry the votes a candidate kept from one count to the next, and the votes passed on to other candidates.',
  count: 'Count {count}',
  elected: '{name} (elected)',
  nonTransferable: 'Non-transferable',
  pool: 'Passed on together',
  kept: '{name} kept {n}',
  moved: '{name} to {other}: {n}',
  pooled: '{n} votes passed on together at count {count}',
  block: '{name}: {n} at count {count}',
});

/** @param {string} pattern @param {Record<string, string | number>} p */
const fill = (pattern, p) => pattern.replace(/\{(\w+)\}/g, (all, k) => (p[k] === undefined ? all : String(p[k])));

const NODE_W = 10;
const LEFT = 150;
const RIGHT = 180;
const TOP = 28;
const GAP = 4;
const EPS = 0.005;

/**
 * The votes each candidate holds at each count: the sheet's total where it gives one; for an
 * elected candidate whose column has stopped, their last total less any surplus passed on since.
 * @param {Sheet} sheet @param {CountEvent[]} events
 * @returns {Map<string, number[]>}
 */
export function heldVotes(sheet, events) {
  /** @type {Map<string, number[]>} */
  const held = new Map();
  for (const row of sheet.rows) {
    /** @type {number[]} */
    const list = [];
    sheet.stages.forEach((stage, i) => {
      const total = totalAt(row, stage);
      if (total !== null) { list.push(Math.max(0, total)); return; }
      if (i === 0 || !row.elected) { list.push(0); return; }
      const moved = events[i].surpluses.find((s) => s.id === row.id)?.amount || 0;
      list.push(Math.max(0, list[i - 1] - moved));
    });
    held.set(row.id, list);
  }
  return held;
}

/**
 * The whole count as an SVG Sankey, or '' when the sheet has fewer than two counts.
 * @param {Sheet} sheet @param {CountEvent[]} events
 */
export function countSankey(sheet, events) {
  const S = sheet.stages.length;
  if (sheet.kind !== 'stages' || S < 2 || events.length !== S) return '';
  const held = heldVotes(sheet, events);
  const rows = sheet.rows;
  const nt = [0];
  for (let i = 1; i < S; i += 1) nt.push(nt[i - 1] + events[i].nonTransferable);
  const colGap = Math.max(64, Math.min(110, (1000 - LEFT - RIGHT) / (S - 1)));
  const W = Math.round(LEFT + (S - 1) * colGap + NODE_W + RIGHT);
  const x = (/** @type {number} */ i) => LEFT + i * colGap;
  const poll = Math.max(1, ...sheet.stages.map((_, i) => rows.reduce((s, r) => s + (/** @type {number[]} */ (held.get(r.id))[i] || 0), 0) + nt[i]));
  const slots = rows.length + 1;
  const chartH = Math.max(260, slots * 22);
  const scale = (chartH - GAP * (slots - 1)) / poll;
  const H = TOP + chartH + 16;

  // Each block's top at each count: candidates in the sheet's order, non-transferable last.
  /** @type {Map<string, number[]>} */
  const top = new Map();
  /** @type {number[]} */
  const ntTop = [];
  for (let i = 0; i < S; i += 1) {
    let y = TOP;
    for (const r of rows) {
      const v = /** @type {number[]} */ (held.get(r.id))[i];
      if (!top.has(r.id)) top.set(r.id, []);
      /** @type {number[]} */ (top.get(r.id))[i] = y;
      if (v > EPS) y += v * scale + GAP;
    }
    ntTop.push(y);
  }
  // Where the next band leaves (out) and arrives (in) on each block.
  const outY = (/** @type {string} */ id, /** @type {number} */ i) => /** @type {number[]} */ (top.get(id))[i];
  /** @type {Map<string, number>} */ const outUsed = new Map();
  /** @type {Map<string, number>} */ const inUsed = new Map();
  const take = (/** @type {Map<string, number>} */ used, /** @type {string} */ key, /** @type {number} */ base, /** @type {number} */ h) => {
    const at = base + (used.get(key) || 0);
    used.set(key, (used.get(key) || 0) + h);
    return at;
  };
  const band = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ h, /** @type {string} */ fill, /** @type {number} */ opacity, /** @type {string} */ title) => {
    const mx = (x0 + x1) / 2;
    return `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} L${x1.toFixed(1)},${(y1 + h).toFixed(1)} C${mx.toFixed(1)},${(y1 + h).toFixed(1)} ${mx.toFixed(1)},${(y0 + h).toFixed(1)} ${x0.toFixed(1)},${(y0 + h).toFixed(1)} Z" fill="${esc(fill)}" fill-opacity="${opacity}"><title>${esc(title)}</title></path>`;
  };
  const byId = new Map(rows.map((r) => [r.id, r]));
  /** @type {string[]} */
  const parts = [];
  for (let i = 1; i < S; i += 1) {
    const ev = events[i];
    const x0 = x(i - 1) + NODE_W;
    const x1 = x(i);
    // Votes kept: each candidate's block to their block at the next count.
    for (const r of rows) {
      const h = /** @type {number[]} */ (held.get(r.id));
      const kept = Math.min(h[i - 1], h[i]);
      if (kept <= EPS) continue;
      const k = `${r.id}@${i - 1}`;
      const hk = kept * scale;
      parts.push(band(x0, take(outUsed, k, outY(r.id, i - 1), hk), x1, take(inUsed, `${r.id}@${i}`, outY(r.id, i), hk), hk, partyColour(r.colour), 0.22,
        fill(SANKEY_TEXT.kept, { name: r.name, n: fmtInt(kept) })));
    }
    if (nt[i - 1] > EPS) {
      const hk = nt[i - 1] * scale;
      parts.push(band(x0, take(outUsed, `nt@${i - 1}`, ntTop[i - 1], hk), x1, take(inUsed, `nt@${i}`, ntTop[i], hk), hk, electionsAppColours.nonTransferable, 0.22, SANKEY_TEXT.nonTransferable));
    }
    const from = [...ev.surpluses, ...ev.exclusions, ...ev.unknown];
    const targets = ev.gains.map((g) => ({ id: g.id, name: g.name, colour: g.colour, amount: g.amount, nt: false }));
    if (ev.nonTransferable > EPS) targets.push({ id: 'nt', name: SANKEY_TEXT.nonTransferable, colour: electionsAppColours.nonTransferable, amount: ev.nonTransferable, nt: true });
    const arrive = (/** @type {{ id: string, nt: boolean }} */ t, /** @type {number} */ hh) => (t.nt ? take(inUsed, `nt@${i}`, ntTop[i], hh) : take(inUsed, `${t.id}@${i}`, outY(t.id, i), hh));
    if (from.length === 1) {
      const src = from[0];
      const srcRow = byId.get(src.id);
      for (const t of targets) {
        const hh = t.amount * scale;
        parts.push(band(x0, take(outUsed, `${src.id}@${i - 1}`, outY(src.id, i - 1), hh), x1, arrive(t, hh), hh, partyColour(srcRow?.colour), 0.5,
          fill(SANKEY_TEXT.moved, { name: src.name, other: t.name, n: fmtInt(t.amount) })));
      }
    } else if (from.length > 1) {
      // Several candidates passed on together: into one pool between the columns, and out of it.
      const total = from.reduce((s, f) => s + f.amount, 0);
      const px = (x0 + x1) / 2 - 3;
      const sumTargets = targets.reduce((s, t) => s + t.amount, 0);
      const ph = Math.max(total, sumTargets) * scale;
      const pyTop = Math.min(...from.map((f) => outY(f.id, i - 1)));
      const title = fill(SANKEY_TEXT.pooled, { n: fmtInt(total), count: ev.stage });
      let into = pyTop;
      for (const f of from) {
        const hh = f.amount * scale;
        parts.push(band(x0, take(outUsed, `${f.id}@${i - 1}`, outY(f.id, i - 1), hh), px, into, hh, partyColour(byId.get(f.id)?.colour), 0.5, title));
        into += hh;
      }
      parts.push(`<rect x="${px.toFixed(1)}" y="${pyTop.toFixed(1)}" width="6" height="${Math.max(1, ph).toFixed(1)}" fill="${esc(electionsAppColours.pooledTransfer)}"><title>${esc(title)}</title></rect>`);
      let outOf = pyTop;
      for (const t of targets) {
        const hh = t.amount * scale;
        parts.push(band(px + 6, outOf, x1, arrive(t, hh), hh, electionsAppColours.pooledTransfer, 0.4,
          fill(SANKEY_TEXT.moved, { name: SANKEY_TEXT.pool, other: t.name, n: fmtInt(t.amount) })));
        outOf += hh;
      }
    }
  }
  // Blocks, column headings and names.
  /** @type {string[]} */
  const blocks = [];
  for (let i = 0; i < S; i += 1) {
    blocks.push(`<text x="${(x(i) + NODE_W / 2).toFixed(1)}" y="14" text-anchor="middle" font-size="11" fill="currentColor">${esc(fill(SANKEY_TEXT.count, { count: sheet.stages[i] }))}</text>`);
    for (const r of rows) {
      const v = /** @type {number[]} */ (held.get(r.id))[i];
      if (v <= EPS) continue;
      blocks.push(`<rect x="${x(i)}" y="${outY(r.id, i).toFixed(1)}" width="${NODE_W}" height="${Math.max(1, v * scale).toFixed(1)}" fill="${esc(partyColour(r.colour))}"><title>${esc(fill(SANKEY_TEXT.block, { name: r.name, n: fmtInt(v), count: sheet.stages[i] }))}</title></rect>`);
    }
    if (nt[i] > EPS) blocks.push(`<rect x="${x(i)}" y="${ntTop[i].toFixed(1)}" width="${NODE_W}" height="${Math.max(1, nt[i] * scale).toFixed(1)}" fill="${esc(electionsAppColours.nonTransferable)}"><title>${esc(SANKEY_TEXT.nonTransferable)}: ${esc(fmtInt(nt[i]))}</title></rect>`);
  }
  /** @type {string[]} */
  const labels = [];
  const side = (/** @type {number} */ i, /** @type {'start' | 'end'} */ anchor) => {
    const lx = anchor === 'end' ? x(i) - 6 : x(i) + NODE_W + 6;
    let last = -Infinity;
    const items = rows.map((r) => ({ r, v: /** @type {number[]} */ (held.get(r.id))[i] })).filter((o) => o.v > EPS)
      .map((o) => ({ text: anchor === 'start' && electedFrom(o.r, sheet.stages, sheet.quota) !== null ? fill(SANKEY_TEXT.elected, { name: o.r.name }) : o.r.name, mid: outY(o.r.id, i) + (o.v * scale) / 2 }));
    if (nt[i] > EPS) items.push({ text: SANKEY_TEXT.nonTransferable, mid: ntTop[i] + (nt[i] * scale) / 2 });
    for (const it of items) {
      const y = Math.max(last + 13, it.mid + 4);
      last = y;
      if (Math.abs(y - 4 - it.mid) > 3) labels.push(`<line x1="${(anchor === 'end' ? lx + 2 : lx - 2).toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${(anchor === 'end' ? x(i) : x(i) + NODE_W).toFixed(1)}" y2="${it.mid.toFixed(1)}" stroke="currentColor" stroke-opacity="0.4" stroke-width="0.75"/>`);
      labels.push(`<text x="${lx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="12" fill="currentColor">${esc(it.text)}</text>`);
    }
    return last;
  };
  const lowLeft = side(0, 'end');
  const lowRight = side(S - 1, 'start');
  const height = Math.ceil(Math.max(H, lowLeft + 8, lowRight + 8));
  return `<svg viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-labelledby="el-sankey-title el-sankey-desc" class="el-sankey"><title id="el-sankey-title">${esc(SANKEY_TEXT.title)}</title><desc id="el-sankey-desc">${esc(SANKEY_TEXT.desc)}</desc>${parts.join('')}${blocks.join('')}${labels.join('')}</svg>`;
}
