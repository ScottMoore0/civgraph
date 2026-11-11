/**
 * Results maps (/elections/map/?e=<election>&mode=winner|turnout|share|swing&party=&vs=<election>):
 * choropleths on the map package's own layers, and small multiples of a body's elections on
 * the same boundaries. Winner and turnout come from the election summary (the records API);
 * party shares and swing from the pivot extracts (DuckDB), so those two modes need the extracts.
 */
import { electionContests, electionDetail, electionIndex, electionSummary, must } from '../lib/api.js';
import { appUrl, electionSlug, esc, fmtPct, partyColour } from '../lib/format.js';
import { areaMap, idle, layerRecord } from '../lib/maplibre.js';
import { areaRows, diverging, divergingLegend, partyShares, sequential, sequentialLegend } from '../lib/scales.js';

/** Party colours of an election, from its party summary. */
async function colourOf(/** @type {string} */ key) {
  const d = await electionDetail(key);
  return new Map((d.partySummary || []).map((/** @type {any} */ p) => [p.party, partyColour(p.colour)]));
}

/** Area -> party -> votes of an election, from the extracts. */
async function extractVotes(/** @type {string} */ bodySlug, /** @type {string} */ key) {
  const { useBodies, query } = await import('../lib/duck.js');
  await useBodies([bodySlug]);
  const k = key.replace(/'/g, "''");
  return /** @type {Array<{ area: string, party: string, votes: number, valid: number }>} */ (await query(
    `SELECT area, party, SUM(COALESCE(votes, 0)) AS votes, MAX(valid_poll) AS valid FROM rows WHERE election_key = '${k}' GROUP BY area, party`,
  ));
}

/**
 * The map data of one election in one mode: feature -> colour, feature -> text, legend, table rows.
 * @param {{ key: string, bodySlug: string }} el
 * @param {string} mode
 * @param {{ party?: string, vs?: { key: string } | null }} opt
 */
export async function mapData(el, mode, opt = {}) {
  const [summary, contests] = await Promise.all([electionSummary(el.key), electionContests(el.key)]);
  const areas = areaRows(summary, contests).filter((a) => a.feature);
  /** @type {Map<string, string>} */
  const colours = new Map();
  /** @type {Map<string, string>} */
  const labels = new Map();
  /** @type {Array<{ colour: string, label: string }>} */
  let legend = [];
  /** @type {Array<[string, string]>} */
  const table = [];
  if (mode === 'winner') {
    const pc = await colourOf(el.key);
    const used = new Map();
    for (const a of areas) {
      const party = (a.seats > 1 ? a.winnerParty : a.leadingParty || a.winnerParty) || 'Unknown';
      const c = pc.get(party) || partyColour(null);
      colours.set(/** @type {string} */ (a.feature), c);
      used.set(party, c);
      const text = `${a.name}: ${a.seats > 1 ? `${party} (most seats)` : `${a.leadingName || ''} (${party})`}${a.unopposed ? ', unopposed' : ''}`;
      labels.set(/** @type {string} */ (a.feature), text);
      table.push([a.name, a.seats > 1 ? `${party} (most seats)` : `${party}${a.unopposed ? ' (unopposed)' : ''}`]);
    }
    legend = [...used].map(([label, colour]) => ({ colour, label }));
  } else if (mode === 'turnout') {
    const vals = areas.map((a) => a.turnout).filter((v) => v !== null);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    for (const a of areas) {
      const c = sequential(a.turnout, min, max);
      if (c) colours.set(/** @type {string} */ (a.feature), c);
      labels.set(/** @type {string} */ (a.feature), `${a.name}: turnout ${a.turnout === null ? 'not recorded' : fmtPct(a.turnout)}`);
      table.push([a.name, a.turnout === null ? 'not recorded' : fmtPct(a.turnout)]);
    }
    legend = vals.length ? sequentialLegend(min, max, (v) => fmtPct(v, 0)) : [];
  } else {
    const party = opt.party || '';
    const now = partyShares(await extractVotes(el.bodySlug, el.key), party);
    const before = mode === 'swing' && opt.vs ? partyShares(await extractVotes(el.bodySlug, opt.vs.key), party) : null;
    const values = new Map();
    for (const a of areas) {
      const s = now.get(a.name);
      const v = before ? (s !== undefined && before.has(a.name) ? s - /** @type {number} */ (before.get(a.name)) : null) : (s ?? null);
      values.set(a.name, v);
    }
    const vals = [...values.values()].filter((v) => v !== null);
    const limit = Math.max(1, ...vals.map((v) => Math.abs(v)));
    const min = before ? 0 : Math.min(...vals);
    const max = before ? 0 : Math.max(...vals);
    for (const a of areas) {
      const v = values.get(a.name);
      const c = before ? diverging(v, limit) : sequential(v, min, max);
      if (c) colours.set(/** @type {string} */ (a.feature), c);
      const text = v === null ? 'no votes recorded' : before ? `${v > 0 ? '+' : ''}${v.toFixed(1)} points` : fmtPct(v);
      labels.set(/** @type {string} */ (a.feature), `${a.name}: ${party} ${text}`);
      table.push([a.name, text]);
    }
    legend = vals.length ? (before ? divergingLegend(limit, (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`) : sequentialLegend(min, max, (v) => fmtPct(v, 0))) : [];
  }
  return { colours, labels, legend, table, matched: areas.length, total: (summary.results || []).length };
}

const legendHtml = (/** @type {Array<{ colour: string, label: string }>} */ legend) => `<div class="el-legend">${legend.map((l) => `<span class="cg-party"><span class="cg-party__swatch" style="--party-colour:${esc(l.colour)}" aria-hidden="true"></span>${esc(l.label)}</span>`).join('')}</div>`;

/**
 * @param {HTMLElement} root
 * @param {{ query: URLSearchParams }} route
 * @param {{ stale: () => boolean, navigate: (href: string, o?: any) => Promise<void> }} ctx
 */
export async function render(root, route, ctx) {
  const index = (await electionIndex()).filter((/** @type {any} */ e) => e.layerId && e.contestType === 'election');
  const q = route.query;
  const want = q.get('e') || 'northern-ireland-assembly-2022-05-05';
  const el = must(index.find((e) => electionSlug(e.key) === want || e.key === want) || index.at(-1), 'election');
  const mode = ['winner', 'turnout', 'share', 'swing'].includes(q.get('mode') || '') ? /** @type {string} */ (q.get('mode')) : 'winner';
  const sameLayer = index.filter((/** @type {any} */ e) => e.layerId === el.layerId && e.key !== el.key && e.bodySlug === el.bodySlug);
  const detail = await electionDetail(el.key);
  const parties = (detail.partySummary || []).filter((/** @type {any} */ p) => p.votes > 0).map((/** @type {any} */ p) => p.party);
  const party = q.get('party') && parties.includes(q.get('party')) ? /** @type {string} */ (q.get('party')) : parties[0] || '';
  const vs = sameLayer.find((/** @type {any} */ e) => electionSlug(e.key) === q.get('vs')) || sameLayer.filter((/** @type {any} */ e) => e.date < el.date).at(-1) || null;
  const url = (/** @type {Record<string, string>} */ o) => `/elections/map/?${new URLSearchParams({ e: electionSlug(el.key), mode, ...(party ? { party } : {}), ...(vs ? { vs: electionSlug(vs.key) } : {}), ...o })}`;

  const bodies = [...new Map(index.map((/** @type {any} */ e) => [e.bodySlug, e.body])).entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1])));
  root.innerHTML = `
    <header class="el-head"><h1>Results maps</h1><p class="el-lead"><a href="${appUrl.election(el.key)}">${esc(el.displayTitle)}</a> on the ${esc(el.layerId)} boundaries.</p></header>
    <form class="el-controls" id="mp-form" onsubmit="return false">
      <label>Body <select id="mp-body">${bodies.map(([s, n]) => `<option value="${esc(s)}"${s === el.bodySlug ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Election <select id="mp-e">${index.filter((/** @type {any} */ e) => e.bodySlug === el.bodySlug).map((/** @type {any} */ e) => `<option value="${esc(electionSlug(e.key))}"${e.key === el.key ? ' selected' : ''}>${esc(e.displayTitle)}</option>`).join('')}</select></label>
      <label>Show <select id="mp-mode">${[['winner', 'Winner'], ['turnout', 'Turnout'], ['share', 'Party share'], ['swing', 'Change in party share']].map(([v, l]) => `<option value="${v}"${v === mode ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${mode === 'share' || mode === 'swing' ? `<label>Party <select id="mp-party">${parties.map((/** @type {string} */ p) => `<option${p === party ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
      ${mode === 'swing' ? `<label>Since <select id="mp-vs">${sameLayer.map((/** @type {any} */ e) => `<option value="${esc(electionSlug(e.key))}"${vs && e.key === vs.key ? ' selected' : ''}>${esc(e.displayTitle)}</option>`).join('')}</select></label>` : ''}
    </form>
    ${mode === 'swing' && !vs ? '<p class="cg-notice cg-notice--warning">No other election of this body used the same boundaries, so there is no like-for-like change to map. The notional results view carries results across boundary changes.</p>' : ''}
    <div id="mp-map" class="el-map" role="img" aria-label="Map of ${esc(el.displayTitle)}"></div>
    <div id="mp-legend"></div>
    <p id="mp-status" class="el-muted" role="status">Loading the map…</p>
    <details><summary>The figures as a table</summary><div id="mp-table"></div></details>
    <section aria-labelledby="mp-sm"><h2 id="mp-sm">Small multiples</h2>
      <p class="el-muted">The winner in every ${esc(el.body)} election on these boundaries.</p>
      <button type="button" class="cg-button" id="mp-sm-go">Draw ${sameLayer.length + 1} maps</button>
      <div id="mp-sm-out" class="el-multiples"></div></section>`;

  const form = /** @type {HTMLFormElement} */ (root.querySelector('#mp-form'));
  form.addEventListener('change', (e) => {
    const t = /** @type {HTMLSelectElement} */ (e.target);
    if (t.id === 'mp-body') {
      const first = index.filter((/** @type {any} */ x) => x.bodySlug === t.value).at(-1);
      if (first) ctx.navigate(`/elections/map/?e=${encodeURIComponent(electionSlug(first.key))}&mode=winner`, { replace: true, keepScroll: true });
      return;
    }
    const o = /** @type {Record<string, string>} */ ({});
    if (t.id === 'mp-e') { o.e = t.value; delete o.vs; }
    if (t.id === 'mp-mode') o.mode = t.value;
    if (t.id === 'mp-party') o.party = t.value;
    if (t.id === 'mp-vs') o.vs = t.value;
    ctx.navigate(url(o), { replace: true, keepScroll: true });
  });

  const status = /** @type {HTMLElement} */ (root.querySelector('#mp-status'));
  try {
    const rec = await layerRecord(String(el.layerId));
    const data = await mapData(el, mode === 'swing' && !vs ? 'share' : mode, { party, vs });
    if (ctx.stale()) return el.displayTitle;
    const map = await areaMap(/** @type {HTMLElement} */ (root.querySelector('#mp-map')), rec, { colours: data.colours, labels: data.labels });
    /** @type {HTMLElement} */ (root.querySelector('#mp-legend')).innerHTML = legendHtml(data.legend);
    /** @type {HTMLElement} */ (root.querySelector('#mp-table')).innerHTML = `<table class="cg-table cg-table--compact"><thead><tr><th scope="col">Area</th><th scope="col">Value</th></tr></thead><tbody>${data.table.map(([a, v]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
    await idle(map);
    status.textContent = `${data.matched} of ${data.total} contests drawn${data.matched < data.total ? ' (the rest have no matching map area)' : ''}.`;
  } catch (err) {
    status.textContent = '';
    /** @type {HTMLElement} */ (root.querySelector('#mp-map')).innerHTML = `<p class="cg-notice cg-notice--danger">The map could not load: ${esc(/** @type {Error} */ (err)?.message || err)}</p>`;
  }

  /** @type {HTMLElement} */ (root.querySelector('#mp-sm-go')).addEventListener('click', async () => {
    const out = /** @type {HTMLElement} */ (root.querySelector('#mp-sm-out'));
    out.innerHTML = '';
    const rec = await layerRecord(String(el.layerId));
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-9999px;width:320px;height:360px';
    document.body.append(holder);
    const series = [...sameLayer, el].sort((x, y) => (x.date < y.date ? -1 : 1));
    for (const e of series) {
      if (ctx.stale()) break;
      const data = await mapData(e, 'winner');
      holder.innerHTML = '';
      const m = await areaMap(holder, rec, { colours: data.colours, interactive: false, preserve: true });
      await idle(m);
      const src = m.getCanvas().toDataURL('image/png');
      m.remove();
      out.insertAdjacentHTML('beforeend', `<figure class="cg-chart"><a href="${url({ e: electionSlug(e.key), mode: 'winner' })}"><img src="${src}" alt="Winners, ${esc(e.displayTitle)}: ${esc(data.table.map(([a, v]) => `${a} ${v}`).join('; '))}" width="320" height="360" loading="lazy"></a><figcaption>${esc(e.displayTitle)}</figcaption></figure>`);
    }
    holder.remove();
  });
  return `Map: ${el.displayTitle}`;
}
