/**
 * Pivot tables (/elections/pivot/): DuckDB-WASM in the browser over the build-time Parquet
 * extracts (one per body). The whole state is in the URL; views can be saved in this browser
 * and the table or the filtered rows downloaded as CSV. Never queries live D1.
 */
import { extractsIndex, query, useBodies, DUCKDB_VERSION } from '../lib/duck.js';
import { esc, fmtInt } from '../lib/format.js';
import {
  DIMENSIONS, FILTERS, MEASURES, pivotCsv, pivotSql, pivotTable, queryFromState, stateFromQuery, whereSql,
} from '../lib/pivot.js';

const SAVED = 'civgraph.elections.pivotViews';

/** @returns {Array<{ name: string, query: string }>} */
function savedViews() {
  try { return JSON.parse(localStorage.getItem(SAVED) || '[]'); } catch { return []; }
}
/** @param {Array<{ name: string, query: string }>} views */
function storeViews(views) {
  try { localStorage.setItem(SAVED, JSON.stringify(views)); } catch { /* private mode: views last the session only */ }
}

/** @param {string} name @param {string} text @param {string} type */
function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const options = (/** @type {Record<string, { label: string }>} */ table, /** @type {string} */ selected, extra = '') =>
  extra + Object.entries(table).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(v.label)}</option>`).join('');

/**
 * @param {HTMLElement} root
 * @param {{ query: URLSearchParams }} route
 * @param {{ stale: () => boolean }} ctx
 */
export async function render(root, route, ctx) {
  const index = await extractsIndex().catch(() => null);
  if (!index) {
    root.innerHTML = `<h1>Pivot tables</h1><p class="cg-notice cg-notice--warning">The pivot extracts are not built here. They are made at build time from the records build (<code>node scripts/build/elections-app/data.mjs --extracts</code>) and stay private until the app is approved.</p>`;
    return 'Pivot tables';
  }
  /** @type {Array<{ body: string, slug: string, rows: number, elections: number }>} */
  const bodies = index.bodies;
  let state = stateFromQuery(route.query);
  state.bodies = state.bodies.filter((b) => bodies.some((x) => x.slug === b));
  if (!state.bodies.length) state.bodies = [bodies.find((x) => x.slug === 'northern-ireland-assembly')?.slug || bodies[0].slug];

  root.innerHTML = `
    <header class="el-head"><h1>Pivot tables</h1>
      <p class="el-lead">Every candidacy as a row: pick what goes down the side and across the top, what to count, and filter. Runs in your browser (DuckDB ${esc(DUCKDB_VERSION)}) over files built from the records, not the live database.</p></header>
    <form class="el-controls" id="pv-form" onsubmit="return false">
      <label>Bodies <select id="pv-bodies" multiple size="6">${bodies.slice().sort((a, b) => b.rows - a.rows).map((b) => `<option value="${esc(b.slug)}"${state.bodies.includes(b.slug) ? ' selected' : ''}>${esc(b.body)} (${fmtInt(b.rows)})</option>`).join('')}</select></label>
      <label>Rows <select id="pv-rows">${options(DIMENSIONS, state.rows)}</select></label>
      <label>Columns <select id="pv-cols">${options(DIMENSIONS, state.cols, `<option value="none"${state.cols === 'none' ? ' selected' : ''}>(none)</option>`)}</select></label>
      <label>Measure <select id="pv-measure">${options(MEASURES, state.measure)}</select></label>
      <label>From <input id="pv-from" type="number" inputmode="numeric" min="1800" max="2100" size="5" value="${state.from ?? ''}"></label>
      <label>To <input id="pv-to" type="number" inputmode="numeric" min="1800" max="2100" size="5" value="${state.to ?? ''}"></label>
      <label>Election <select id="pv-election"><option value="">All</option></select></label>
      <label>Party <select id="pv-party" multiple size="4"></select></label>
      <label>Outcome <select id="pv-outcome"><option value="">All</option>${['elected', 'elected unopposed', 'excluded', 'not elected'].map((o) => `<option${(state.filters.outcome || []).includes(o) ? ' selected' : ''}>${o}</option>`).join('')}</select></label>
    </form>
    <div class="el-controls">
      <button type="button" class="cg-button" id="pv-csv">Download table (CSV)</button>
      <button type="button" class="cg-button" id="pv-rows-csv">Download rows (CSV)</button>
      <button type="button" class="cg-button" id="pv-save">Save this view</button>
      <button type="button" class="cg-button cg-button--link" id="pv-link">Copy link</button>
    </div>
    <div id="pv-saved"></div>
    <p id="pv-status" class="el-muted" role="status">Loading DuckDB…</p>
    <div id="pv-out" class="cg-table-wrap el-pivot-wrap"></div>
    <p class="el-muted">Notes: party is the label on the ballot paper as recorded ("No party recorded" where none is known). Gender is recorded for about 2% of candidacies. Incumbency is derived: the person was elected to the same body at its previous general election or a by-election since. Unopposed returns have no votes, so they count in seats and candidates but not in votes or shares.</p>`;

  const $ = (/** @type {string} */ id) => /** @type {HTMLInputElement & HTMLSelectElement} */ (root.querySelector(`#${id}`));
  const status = $('pv-status');
  const out = /** @type {HTMLElement} */ (root.querySelector('#pv-out'));
  /** @type {ReturnType<typeof pivotTable> | null} */
  let table = null;

  const renderSaved = () => {
    const views = savedViews();
    /** @type {HTMLElement} */ (root.querySelector('#pv-saved')).innerHTML = views.length
      ? `<p class="el-muted">Saved views: ${views.map((v, i) => `<a href="/elections/pivot/?${esc(v.query)}">${esc(v.name)}</a> <button type="button" class="cg-button cg-button--link" data-del="${i}" aria-label="Delete saved view ${esc(v.name)}">×</button>`).join(' · ')}</p>` : '';
  };
  renderSaved();

  const fillFilterLists = async () => {
    const elections = await query('SELECT DISTINCT election_key AS k, election AS t, date FROM rows ORDER BY date DESC');
    const parties = await query('SELECT party AS p, COUNT(*) AS n FROM rows GROUP BY party ORDER BY n DESC LIMIT 200');
    const sel = state.filters.election || [];
    $('pv-election').innerHTML = `<option value="">All</option>${elections.map((e) => `<option value="${esc(e.k)}"${sel.includes(e.k) ? ' selected' : ''}>${esc(e.t)}</option>`).join('')}`;
    const ps = state.filters.party || [];
    $('pv-party').innerHTML = parties.map((p) => `<option value="${esc(p.p)}"${ps.includes(p.p) ? ' selected' : ''}>${esc(p.p)} (${fmtInt(p.n)})</option>`).join('');
  };

  const run = async () => {
    if (ctx.stale()) return;
    status.textContent = 'Working…';
    const started = performance.now();
    await useBodies(state.bodies);
    const data = /** @type {Array<{ r: string, c: string, v: number | null }>} */ (await query(pivotSql(state)));
    if (ctx.stale()) return;
    table = pivotTable(data, state);
    const m = MEASURES[/** @type {keyof typeof MEASURES} */ (state.measure)];
    const fmt = (/** @type {number | null} */ v) => (v === null ? '' : v.toLocaleString('en-GB', { maximumFractionDigits: table?.digits ?? 0, minimumFractionDigits: table?.digits ?? 0 }));
    const showTotal = table.additive && !(/** @type {any} */ (m).share);
    out.innerHTML = `<table class="cg-table cg-table--compact cg-table--sticky-first el-pivot">
      <caption class="el-sr">${esc(m.label)} by ${esc(DIMENSIONS[/** @type {keyof typeof DIMENSIONS} */ (state.rows)].label)}${state.cols === 'none' ? '' : ` and ${esc(DIMENSIONS[/** @type {keyof typeof DIMENSIONS} */ (state.cols)].label)}`}</caption>
      <thead><tr><th scope="col">${esc(DIMENSIONS[/** @type {keyof typeof DIMENSIONS} */ (state.rows)].label)}</th>${table.cols.map((c) => `<th scope="col" class="num">${esc(state.cols === 'none' ? m.label : c || '(blank)')}</th>`).join('')}${showTotal && table.cols.length > 1 ? '<th scope="col" class="num">Total</th>' : ''}</tr></thead>
      <tbody>${table.rows.map((r) => `<tr><th scope="row">${esc(r.key || '(blank)')}</th>${r.values.map((v) => `<td class="num">${fmt(v)}</td>`).join('')}${showTotal && table && table.cols.length > 1 ? `<td class="num">${fmt(r.total)}</td>` : ''}</tr>`).join('')}</tbody>
      ${showTotal ? `<tfoot><tr><th scope="row">Total</th>${table.totals.map((v) => `<td class="num">${fmt(v)}</td>`).join('')}${table.cols.length > 1 ? `<td class="num">${fmt(table.totals.reduce((s, v) => s + (v || 0), 0))}</td>` : ''}</tr></tfoot>` : ''}
    </table>`;
    status.textContent = `${fmtInt(table.rowCount)} rows × ${table.cols.length} columns${table.rowsCut ? ' (first 500 rows shown; the CSV has them all)' : ''} · ${Math.round(performance.now() - started)} ms`;
  };

  const readForm = () => {
    const multi = (/** @type {string} */ id) => [...$(id).selectedOptions].map((o) => o.value).filter(Boolean);
    const bodiesSel = multi('pv-bodies');
    const year = (/** @type {string} */ id) => { const n = Number($(id).value); return $(id).value && Number.isInteger(n) ? n : null; };
    /** @type {Record<string, string[]>} */
    const filters = {};
    const el = $('pv-election').value;
    if (el) filters.election = [el];
    const ps = multi('pv-party');
    if (ps.length) filters.party = ps;
    const oc = $('pv-outcome').value;
    if (oc) filters.outcome = [oc];
    for (const f of Object.keys(FILTERS)) if (!['election', 'party', 'outcome'].includes(f) && state.filters[f]) filters[f] = state.filters[f];
    state = { bodies: bodiesSel.length ? bodiesSel : state.bodies, rows: $('pv-rows').value, cols: $('pv-cols').value, measure: $('pv-measure').value, from: year('pv-from'), to: year('pv-to'), filters };
    history.replaceState(null, '', `/elections/pivot/?${queryFromState(state)}`);
  };

  const guard = (/** @type {() => Promise<void>} */ fn) => () => fn().catch((err) => {
    status.textContent = '';
    out.innerHTML = `<p class="cg-notice cg-notice--danger">The pivot could not run: ${esc(err?.message || err)}. DuckDB loads from cdn.jsdelivr.net; a blocked network stops it.</p>`;
    console.error(err);
  });

  const form = /** @type {HTMLFormElement} */ (root.querySelector('#pv-form'));
  let bodiesBefore = state.bodies.join(',');
  form.addEventListener('change', guard(async () => {
    readForm();
    if (state.bodies.join(',') !== bodiesBefore) {
      bodiesBefore = state.bodies.join(',');
      delete state.filters.election;
      delete state.filters.party;
      await useBodies(state.bodies);
      await fillFilterLists();
    }
    await run();
  }));
  $('pv-csv').addEventListener('click', () => { if (table) download(`civgraph-pivot-${state.rows}-${state.cols}-${state.measure}.csv`, pivotCsv(table, state)); });
  $('pv-rows-csv').addEventListener('click', guard(async () => {
    const rows = await query(`SELECT * FROM rows ${whereSql(state)} ORDER BY date, election_key, contest_seq LIMIT 200000`);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const cell = (/** @type {unknown} */ v) => { const x = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    download(`civgraph-candidacies-${state.bodies.join('+')}.csv`, `${[cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')}\n`);
  }));
  $('pv-save').addEventListener('click', () => {
    const name = window.prompt('Name this view', `${MEASURES[/** @type {keyof typeof MEASURES} */ (state.measure)].label} by ${state.rows}`);
    if (!name) return;
    storeViews([...savedViews().filter((v) => v.name !== name), { name, query: queryFromState(state) }]);
    renderSaved();
  });
  $('pv-link').addEventListener('click', () => { navigator.clipboard?.writeText(location.href).then(() => { status.textContent = 'Link copied.'; }, () => {}); });
  root.querySelector('#pv-saved')?.addEventListener('click', (e) => {
    const del = /** @type {HTMLElement} */ (e.target).closest?.('[data-del]');
    if (!del) return;
    const views = savedViews();
    views.splice(Number(del.getAttribute('data-del')), 1);
    storeViews(views);
    renderSaved();
  });

  await guard(async () => {
    await useBodies(state.bodies);
    await fillFilterLists();
    await run();
  })();
  return 'Pivot tables';
}
