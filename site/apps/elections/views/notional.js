/**
 * Notional results (/elections/notional/?e=<election>&method=population|areal): a past election's
 * votes carried onto new boundaries by the weights of scripts/build/elections-app/notional_weights.py
 * (site/apps/elections/notional/<old>__<new>.json), with a projection from shares the reader
 * types (lib/project.js, the projections hook). Every figure here is an ESTIMATE and says so.
 */
import { electionDetail, electionIndex, must } from '../lib/api.js';
import { parliamentArc, seatBar } from '../lib/charts.js';
import { appUrl, electionSlug, esc, fmtDelta, fmtInt, fmtPct, isStv } from '../lib/format.js';
import { partyChip, partyColour } from '../lib/party.js';
import { areaMap, idle, layerRecord } from '../lib/maplibre.js';
import { allocate, deltasFromTargets, nationalShares, project } from '../lib/project.js';
import { NOTIONAL_METHOD } from '../state-machines.js';

export const PAIRS = ['pc-2008__pc-2023'];
/** "BELFAST SOUTH AND MID DOWN" -> "Belfast South and Mid Down" (the boundary files' names are upper case). */
export const titleCase = (/** @type {string} */ s) => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/ (And|Of|The) /g, (m) => m.toLowerCase());
const fold = (/** @type {unknown} */ s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * Notional votes in each new area: sum over old areas of weight(old -> new) x votes(old).
 * @param {Array<{ area: string, party: string, votes: number }>} rows  the base election's votes by area and party
 * @param {Array<[string, string, number]>} weights  [old area, new area, share of old in new]
 * @returns {{ areas: Map<string, Map<string, number>>, unmatched: string[] }}
 */
export function notionalVotes(rows, weights) {
  /** @type {Map<string, Array<[string, number]>>} */
  const byOld = new Map();
  for (const [o, n, w] of weights) {
    if (!byOld.has(fold(o))) byOld.set(fold(o), []);
    /** @type {Array<[string, number]>} */ (byOld.get(fold(o))).push([n, w]);
  }
  /** @type {Map<string, Map<string, number>>} */
  const areas = new Map();
  const unmatched = new Set();
  for (const r of rows) {
    const to = byOld.get(fold(r.area));
    if (!to) { unmatched.add(r.area); continue; }
    for (const [n, w] of to) {
      if (!areas.has(n)) areas.set(n, new Map());
      const m = /** @type {Map<string, number>} */ (areas.get(n));
      m.set(r.party, (m.get(r.party) || 0) + w * (Number(r.votes) || 0));
    }
  }
  return { areas, unmatched: [...unmatched] };
}

/**
 * @param {HTMLElement} root
 * @param {import('../lib/route.js').Route} route
 * @param {import('../app.js').ViewContext} ctx
 */
export async function render(root, route, ctx) {
  const pair = PAIRS[0];
  const res = await fetch(`/apps/elections/notional/${pair}.json`, { signal: ctx.signal });
  if (!res.ok) throw new Error(`notional weights ${pair}: ${res.status}`);
  const W = await res.json();
  const index = (await electionIndex()).filter((e) => W.old.layers.includes(e.layerId) && e.kind === 'general');
  const q = route.query;
  const el = must(index.find((e) => electionSlug(e.key) === q.get('e')) || index.at(-1), 'election');
  /** EL-11: population- or area-weighted (a toggle; the URL picks the state). */
  const method = NOTIONAL_METHOD.start(q.get('method') === 'areal' ? 'areal' : 'population').state();
  const detail = await electionDetail(el.key);
  const colours = new Map((detail.partySummary || []).map((p) => [p.party, partyColour(p.colour)]));
  const { queryBodies } = await import('../lib/duck.js');
  const k = el.key.replace(/'/g, "''");
  const rows = /** @type {Array<{ area: string, party: string, votes: number, seats: number }>} */ (await queryBodies([el.bodySlug],
    `SELECT area, party, SUM(COALESCE(votes, 0)) AS votes, SUM(seats) AS seats FROM rows WHERE election_key = '${k}' GROUP BY area, party`,
  ));
  if (ctx.stale()) return 'Notional results';
  const seatsPerArea = Math.max(1, Math.round(rows.reduce((s, r) => s + (Number(r.seats) || 0), 0) / Math.max(1, new Set(rows.map((r) => r.area)).size)));
  const { areas, unmatched } = notionalVotes(rows, W.weights[method]);
  const contests = [...areas].map(([area, votes]) => ({ area, seats: seatsPerArea, votes }));
  const base = nationalShares(contests);
  const stv = isStv(el.votingSystem);
  const parties = [...base].sort((a, b) => b[1] - a[1]).filter(([, s]) => s >= 0.5).map(([p]) => p);
  /** @type {Map<string, number>} */
  const targets = new Map();
  for (const p of parties) { const v = Number(q.get(`t.${p}`)); if (q.get(`t.${p}`) && Number.isFinite(v)) targets.set(p, v); }

  const perArea = contests.map((c) => {
    const all = [...c.votes.values()].reduce((s, v) => s + v, 0);
    const shares = new Map([...c.votes].map(([p, v]) => [p, all ? (100 * v) / all : 0]));
    return { area: c.area, all, shares, seats: allocate(shares, c.seats) };
  }).sort((a, b) => a.area.localeCompare(b.area));
  /** @type {Map<string, number>} */
  const notionalSeats = new Map();
  for (const a of perArea) for (const [p, n] of a.seats) notionalSeats.set(p, (notionalSeats.get(p) || 0) + n);

  root.innerHTML = `
    <header class="el-head"><h1>Notional results</h1>
      <p class="el-lead">The <a href="${appUrl.election(el.key)}">${esc(el.displayTitle)}</a> as if it had been fought on the ${esc(W.new.label)}.</p></header>
    <p class="cg-notice cg-notice--warning el-estimate"><strong>Estimates.</strong> Each old constituency's votes are shared out to the new ones ${method === 'population' ? 'by where its 2021 residents live' : 'by land area'}, so every figure on this page is an estimate${stv ? ', and multi-member seats are allocated by quotas of first preferences without transfers' : ''}. Not an official notional result.</p>
    <form class="el-controls" id="nt-form" onsubmit="return false">
      <label>Base election <select id="nt-e">${index.map((e) => `<option value="${esc(electionSlug(e.key))}"${e.key === el.key ? ' selected' : ''}>${esc(e.displayTitle)}</option>`).join('')}</select></label>
      <label>Method <select id="nt-method"><option value="population"${method === 'population' ? ' selected' : ''}>Population-weighted (2021 residents)</option><option value="areal"${method === 'areal' ? ' selected' : ''}>Area-weighted</option></select></label>
    </form>
    ${unmatched.length ? `<p class="cg-notice cg-notice--warning">Not carried over (no matching old boundary): ${esc(unmatched.join(', '))}.</p>` : ''}
    <div class="el-grid">
      <figure class="cg-chart" id="nt-chart"></figure>
      <div id="nt-map" class="el-map" role="img" aria-label="Map of notional winners (estimate)"></div>
    </div>
    <h2>Notional result by new constituency (estimate)</h2>
    <div class="cg-table-wrap"><table class="cg-table cg-table--compact"><thead><tr><th scope="col">New constituency</th><th scope="col" class="num">Notional votes</th><th scope="col">${stv ? 'Notional seats' : 'Notional winner'}</th><th scope="col">Top shares</th></tr></thead>
      <tbody>${perArea.map((a) => `<tr><th scope="row">${esc(titleCase(a.area))}</th><td class="num">${fmtInt(Math.round(a.all))}</td><td>${[...a.seats].map(([p, n]) => `${partyChip(p, colours.get(p))}${n > 1 ? ` ×${n}` : ''}`).join(' ')}</td><td>${[...a.shares].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([p, s]) => `${esc(p)} ${fmtPct(s)}`).join(', ')}</td></tr>`).join('')}</tbody></table></div>
    <h2 id="nt-proj">Projection from shares you set</h2>
    <p class="el-muted">Type a share for any party (the others keep theirs) to project seats on the new boundaries by uniform swing from the notional result. No poll is built in.</p>
    <div class="cg-table-wrap"><table class="cg-table cg-table--compact"><thead><tr><th scope="col">Party</th><th scope="col" class="num">Notional share</th><th scope="col">Your share (%)</th><th scope="col" class="num">Notional seats</th><th scope="col" class="num">Projected seats</th></tr></thead>
      <tbody>${parties.map((p) => `<tr><th scope="row">${partyChip(p, colours.get(p))}</th><td class="num">${fmtPct(base.get(p))}</td><td><input type="number" step="0.1" min="0" max="100" size="5" data-target="${esc(p)}" value="${targets.has(p) ? targets.get(p) : ''}" aria-label="Your share for ${esc(p)}"></td><td class="num">${notionalSeats.get(p) || 0}</td><td class="num" data-proj="${esc(p)}"></td></tr>`).join('')}</tbody></table></div>
    <h2>Method and sources</h2>
    <ul class="cg-citations">${Object.entries(W.methods).map(([m, t]) => `<li><strong>${esc(m)}</strong>: ${esc(t)}</li>`).join('')}${W.sources.map((/** @type {string} */ s) => `<li>${esc(s)}</li>`).join('')}<li>Base votes: the <a href="${appUrl.election(el.key)}">${esc(el.displayTitle)}</a> (each contest's sources are on its page).</li></ul>`;

  const total = [...notionalSeats.values()].reduce((s, n) => s + n, 0);
  const chartParties = [...notionalSeats].map(([party, seats]) => ({ party, seats, colour: colours.get(party) })).sort((a, b) => b.seats - a.seats);
  /** @type {HTMLElement} */ (root.querySelector('#nt-chart')).innerHTML = `${total >= 30 ? parliamentArc(chartParties, { title: `Notional seats (estimate): ${chartParties.map((p) => `${p.party} ${p.seats}`).join(', ')}` }) : seatBar(chartParties, { title: 'Notional seats (estimate)' })}<figcaption>Notional seats on the new boundaries (estimate).</figcaption>`;

  const drawProjection = () => {
    const resP = project(contests, deltasFromTargets(base, targets));
    for (const p of parties) {
      const cell = root.querySelector(`[data-proj="${CSS.escape(p)}"]`);
      if (cell) cell.textContent = targets.size ? `${resP.seats.get(p) || 0} (${fmtDelta((resP.seats.get(p) || 0) - (notionalSeats.get(p) || 0))})` : '';
    }
  };
  drawProjection();
  const listen = { signal: ctx.signal };
  // On the shared root, so it must go with the view (listen.signal): left behind, a later visit
  // would run two of these.
  root.addEventListener('input', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const p = t.getAttribute('data-target');
    if (!p) return;
    if (t.value === '' || !Number.isFinite(Number(t.value))) targets.delete(p); else targets.set(p, Number(t.value));
    const u = new URLSearchParams({ e: electionSlug(el.key), method });
    for (const [party, v] of targets) u.set(`t.${party}`, String(v));
    history.replaceState(null, '', `/elections/notional/?${u}`);
    drawProjection();
  }, listen);
  root.querySelector('#nt-form')?.addEventListener('change', (e) => {
    const t = /** @type {HTMLSelectElement} */ (e.target);
    const u = new URLSearchParams({ e: t.id === 'nt-e' ? t.value : electionSlug(el.key), method: t.id === 'nt-method' ? t.value : method });
    ctx.navigate(`/elections/notional/?${u}`, { keepScroll: true });
  }, listen);

  try {
    const rec = await layerRecord(W.new.layer);
    /** @type {Map<string, string>} */
    const fills = new Map();
    /** @type {Map<string, string>} */
    const labels = new Map();
    for (const a of perArea) {
      const top = [...a.seats].sort((x, y) => y[1] - x[1])[0]?.[0];
      if (top) fills.set(a.area.toUpperCase(), colours.get(top) || partyColour(null));
      labels.set(a.area.toUpperCase(), `${titleCase(a.area)}: ${[...a.seats].map(([p, n]) => `${p}${n > 1 ? ` ×${n}` : ''}`).join(', ')} (estimate)`);
    }
    const holder = /** @type {HTMLElement} */ (root.querySelector('#nt-map'));
    // One map per visit: removed when the view is left (ctx.signal), so a change of base
    // election or method, which renders the view again, never leaves a WebGL context behind.
    const map = await areaMap(holder, rec, { colours: fills, labels, signal: ctx.signal });
    idle(map, 15000, ctx.signal).then(() => { if (!ctx.stale()) holder.setAttribute('data-ready', 'true'); });
  } catch (err) {
    /** @type {HTMLElement} */ (root.querySelector('#nt-map')).innerHTML = `<p class="cg-notice cg-notice--danger">The map could not load: ${esc(/** @type {Error} */ (err)?.message || err)}</p>`;
  }
  return `Notional results: ${el.displayTitle}`;
}
