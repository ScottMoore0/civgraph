/**
 * Swingometer (/elections/swing/?e=<election>&d.<party>=<points>): uniform swing from a base
 * election's first preferences, with the seats it would give (lib/project.js). Reads the pivot
 * extracts. Every projected figure is an estimate and says so; no polling data is used.
 */
import { electionDetail, electionIndex } from '../lib/api.js';
import { parliamentArc, seatBar } from '../lib/charts.js';
import { appUrl, electionSlug, esc, fmtDelta, fmtPct, isStv, partyChip, partyColour } from '../lib/format.js';
import { baseContests, nationalShares, project } from '../lib/project.js';

/**
 * @param {HTMLElement} root
 * @param {{ query: URLSearchParams }} route
 * @param {{ stale: () => boolean }} ctx
 */
export async function render(root, route, ctx) {
  const q = route.query;
  const index = (await electionIndex()).filter((/** @type {any} */ e) => e.contestType === 'election' && e.kind !== 'by-election');
  const want = q.get('e') || 'northern-ireland-assembly-2022-05-05';
  const el = index.find((/** @type {any} */ e) => electionSlug(e.key) === want || e.key === want) || index.at(-1);
  const detail = await electionDetail(el.key);
  const { useBodies, query } = await import('../lib/duck.js');
  await useBodies([el.bodySlug]);
  const k = el.key.replace(/'/g, "''");
  const rows = /** @type {Array<{ area: string, party: string, votes: number, seats: number }>} */ (await query(
    `SELECT area, party, SUM(COALESCE(votes, 0)) AS votes, SUM(seats) AS seats FROM rows WHERE election_key = '${k}' GROUP BY area, party`,
  ));
  if (ctx.stale()) return 'Swingometer';
  const contests = baseContests(rows);
  const base = nationalShares(contests);
  const colours = new Map((detail.partySummary || []).map((/** @type {any} */ p) => [p.party, partyColour(p.colour)]));
  const parties = [...base].sort((a, b) => b[1] - a[1]).filter(([, s]) => s >= 0.5).map(([p]) => p);
  /** @type {Map<string, number>} */
  const deltas = new Map();
  for (const p of parties) { const v = Number(q.get(`d.${p}`)); if (q.get(`d.${p}`) && Number.isFinite(v)) deltas.set(p, Math.max(-30, Math.min(30, v))); }
  const baseSeats = project(contests, new Map()).seats;
  const stv = isStv(el.votingSystem);
  const bodies = [...new Map(index.map((/** @type {any} */ e) => [e.bodySlug, e.body])).entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1])));

  root.innerHTML = `
    <header class="el-head"><h1>Swingometer</h1>
      <p class="el-lead">Move each party's share from the <a href="${appUrl.election(el.key)}">${esc(el.displayTitle)}</a> and see the seats under uniform swing.</p></header>
    <p class="cg-notice el-estimate">These are estimates, not forecasts: every contest moves by the same points.${stv ? ' Seats in multi-member contests are allocated by quotas of first preferences, without transfers.' : ''} No polling data is used.</p>
    <form class="el-controls" id="sw-form" onsubmit="return false">
      <label>Body <select id="sw-body">${bodies.map(([s, n]) => `<option value="${esc(s)}"${s === el.bodySlug ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Base election <select id="sw-e">${index.filter((/** @type {any} */ e) => e.bodySlug === el.bodySlug).map((/** @type {any} */ e) => `<option value="${esc(electionSlug(e.key))}"${e.key === el.key ? ' selected' : ''}>${esc(e.displayTitle)}</option>`).join('')}</select></label>
      <button type="button" class="cg-button" id="sw-reset">Reset</button>
    </form>
    ${contests.length ? '' : '<p class="cg-notice cg-notice--warning">This election has no recorded votes to swing.</p>'}
    <div class="el-grid">
      <div><table class="cg-table cg-table--compact"><thead><tr><th scope="col">Party</th><th scope="col" class="num">Base share</th><th scope="col">Change (points)</th><th scope="col" class="num">New share</th></tr></thead>
        <tbody>${parties.map((p) => `<tr><th scope="row">${partyChip(p, colours.get(p))}</th><td class="num">${fmtPct(base.get(p))}</td>
          <td><input type="range" min="-15" max="15" step="0.5" value="${deltas.get(p) || 0}" data-party="${esc(p)}" aria-label="Change in ${esc(p)} share, points"> <output data-out="${esc(p)}">${fmtDelta(deltas.get(p) || 0, 1)}</output></td>
          <td class="num" data-new="${esc(p)}"></td></tr>`).join('')}</tbody></table></div>
      <div><figure class="cg-chart" id="sw-chart"></figure><div id="sw-seats"></div></div>
    </div>
    <details><summary>Projected result in each contest</summary><div id="sw-contests"></div></details>`;

  const draw = () => {
    const res = project(contests, deltas);
    const total = [...res.seats.values()].reduce((s, n) => s + n, 0);
    const order = [...new Set([...parties, ...res.seats.keys()])].filter((p) => (res.seats.get(p) || 0) + (baseSeats.get(p) || 0) > 0);
    const chartParties = order.map((p) => ({ party: p, seats: res.seats.get(p) || 0, colour: colours.get(p) })).filter((p) => p.seats > 0).sort((a, b) => b.seats - a.seats);
    /** @type {HTMLElement} */ (root.querySelector('#sw-chart')).innerHTML = `${total >= 30 ? parliamentArc(chartParties, { title: `Projected seats (estimate): ${chartParties.map((p) => `${p.party} ${p.seats}`).join(', ')}` }) : seatBar(chartParties, { title: 'Projected seats (estimate)' })}<figcaption>Projected seats (estimate).</figcaption>`;
    /** @type {HTMLElement} */ (root.querySelector('#sw-seats')).innerHTML = `<table class="cg-table cg-table--compact"><thead><tr><th scope="col">Party</th><th scope="col" class="num">Base</th><th scope="col" class="num">Projected</th><th scope="col" class="num">±</th></tr></thead><tbody>${order.sort((a, b) => (res.seats.get(b) || 0) - (res.seats.get(a) || 0)).map((p) => `<tr><th scope="row">${partyChip(p, colours.get(p))}</th><td class="num">${baseSeats.get(p) || 0}</td><td class="num">${res.seats.get(p) || 0}</td><td class="num">${fmtDelta((res.seats.get(p) || 0) - (baseSeats.get(p) || 0))}</td></tr>`).join('')}</tbody></table>
      <p class="el-muted">Base seats here are this model run with no change${stv ? ' (quota allocation of first preferences), which can differ from the seats actually won after transfers' : ''}; the actual result is on the <a href="${appUrl.election(el.key)}">election page</a>.</p>`;
    /** @type {HTMLElement} */ (root.querySelector('#sw-contests')).innerHTML = `<table class="cg-table cg-table--compact"><thead><tr><th scope="col">Contest</th><th scope="col">Projected seats</th></tr></thead><tbody>${res.contests.map((c) => `<tr><th scope="row">${esc(c.area)}</th><td>${[...c.seats].map(([p, n]) => `${esc(p)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}</td></tr>`).join('')}</tbody></table>`;
    const sum = parties.reduce((s, p) => s + Math.max(0, (base.get(p) || 0) + (deltas.get(p) || 0)), 0) + [...base].filter(([p]) => !parties.includes(p)).reduce((s, [, v]) => s + v, 0);
    for (const p of parties) {
      const cell = root.querySelector(`[data-new="${CSS.escape(p)}"]`);
      if (cell) cell.textContent = fmtPct((100 * Math.max(0, (base.get(p) || 0) + (deltas.get(p) || 0))) / (sum || 1));
    }
  };
  const sync = () => {
    const u = new URLSearchParams({ e: electionSlug(el.key) });
    for (const [p, v] of deltas) if (v) u.set(`d.${p}`, String(v));
    history.replaceState(null, '', `/elections/swing/?${u}`);
  };
  root.querySelector('#sw-form')?.addEventListener('change', (e) => {
    const t = /** @type {HTMLSelectElement} */ (e.target);
    if (t.id === 'sw-e') location.assign(`/elections/swing/?e=${encodeURIComponent(t.value)}`);
    if (t.id === 'sw-body') { const last = index.filter((/** @type {any} */ x) => x.bodySlug === t.value).at(-1); if (last) location.assign(`/elections/swing/?e=${encodeURIComponent(electionSlug(last.key))}`); }
  });
  root.querySelector('#sw-reset')?.addEventListener('click', () => {
    deltas.clear();
    for (const input of root.querySelectorAll('input[type=range]')) /** @type {HTMLInputElement} */ (input).value = '0';
    for (const o of root.querySelectorAll('output')) o.textContent = '0.0';
    sync();
    draw();
  });
  root.addEventListener('input', (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const p = t.getAttribute('data-party');
    if (!p) return;
    deltas.set(p, Number(t.value));
    const out = root.querySelector(`[data-out="${CSS.escape(p)}"]`);
    if (out) out.textContent = fmtDelta(Number(t.value), 1);
    sync();
    draw();
  });
  draw();
  return 'Swingometer';
}
