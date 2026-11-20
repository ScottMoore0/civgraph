/**
 * Results maps (/elections/map/; its URL state: lib/map-state.js): choropleths on the map
 * package's own layers in seven modes (lib/map-modes.js: winning party, poll-topper, a party's
 * share, swing, margin, turnout, spoilt ballots), a close-contests filter with a sortable list,
 * and small multiples of a body's elections on the same boundaries. Every mode reads the
 * election's bundle (lib/api.js electionBundle), so none needs the pivot extracts.
 *
 * Colour is never the only signal: the key names every colour, each area has its words (on hover
 * or tap, and in the table under the map), and an area with no figure is hatched.
 */
import { electionBundle, electionDetail, electionIndex, must } from '../lib/api.js';
import { appUrl, electionSlug, esc, fmtInt, fmtPct } from '../lib/format.js';
import { areaMap, idle, layerRecord } from '../lib/maplibre.js';
import { MAP_PATTERNS, MAP_TEXT, NO_DATA, bundleAreas, closeContests, fill, isClose, modeFigures, sortRows, stripeImage } from '../lib/map-modes.js';
import { mapStateQuery, parseMapState } from '../lib/map-state.js';
import { electionsAppColours } from '../../../pkg/registries/src/browser/colour-palettes.mjs';
import { MAP_MODES, MAP_STATUS, MULTIPLES, mapModeShown } from '../state-machines.js';
import { CHART_TEXT, chartData } from '../lib/chart-data.js';
import { METHOD_NOTE, methodNote } from '../lib/methods.js';

/** The view's fixed words and patterns (keyed in data/i18n/strings/elections.txt; R10). */
export const VIEW_TEXT = Object.freeze({
  title: 'Results maps',
  lead: 'Boundaries: {boundaries}.',
  body: 'Body',
  election: 'Election',
  show: 'Show',
  party: 'Party',
  vs: 'Compared with',
  otherBoundaries: '{election} (other boundaries)',
  close: 'Close contests',
  under: 'Margin under',
  unit: 'Counted in',
  clear: 'Show every contest',
  noVs: 'No other election of this body used the same boundaries, so there is no like-for-like change to map. The notional results view carries results across boundary changes.',
  noParty: 'No party has recorded votes in this election, so there is no share to map: the winners are shown instead.',
  boundaries: '{election} was fought on other boundaries, so its contests are not the same areas: there is no like-for-like swing, and the share in this election is shown instead. The notional results view carries results across boundary changes.',
  mapLabel: 'Map of {election}: {key}',
  loading: 'Loading the map…',
  drawn: '{n} of {total} contests drawn.',
  drawnSome: '{n} of {total} contests drawn (the rest have no matching map area).',
  failed: 'The map could not load: {error}',
  contest: 'Contest',
  closeSummary: '{n} of {total} contests had a margin under {limit}.',
  closeNone: 'No contest had a margin under {limit}.',
  closeCaption: 'Contests with a margin under {limit}, sorted by {column}',
  elected: 'Last elected',
  runnerUp: 'Runner-up',
  marginVotes: 'Margin (votes)',
  marginPct: 'Margin (% of the valid poll)',
  count: 'At count',
  multiples: 'Small multiples',
  multiplesLead: 'The winners in every {body} election on these boundaries.',
  multiplesDraw: 'Draw {n} maps',
  multiplesAlt: 'Winners, {election}: {figures}',
  multiplesFailed: 'The maps could not be drawn: {error}',
  ascending: 'ascending',
  limitVotes: '{n} votes',
  limitPct: '{pct} of the valid poll',
  descending: 'descending',
});

/** The election default when the URL names none. */
const DEFAULT_ELECTION = 'northern-ireland-assembly-2022-05-05';

/**
 * The data behind a map (lib/chart-data.js, el-tables): each area's figure in the words the map gives it.
 * @param {string} id @param {string} caption @param {string} heading @param {Array<[string, string]>} rows @param {string} file
 */
const mapTable = (id, caption, heading, rows, file) => chartData({ id, caption, file, columns: [{ label: CHART_TEXT.area }, { label: heading }], rows });

/** The note beside a map's worked-out figures, by mode (lib/methods.js). @param {string} mode */
const mapMethod = (mode) => (mode === 'swing' ? methodNote('swing', [METHOD_NOTE.mapSwing, METHOD_NOTE.labelsAsPrinted])
  : mode === 'share' ? methodNote('shares', [METHOD_NOTE.mapShare, METHOD_NOTE.labelsAsPrinted])
    : mode === 'turnout' ? methodNote('turnout', [METHOD_NOTE.mapTurnout])
      : mode === 'margin' ? methodNote('majority', [MAP_TEXT.marginMethod])
        : mode === 'spoilt' ? methodNote('turnout', [MAP_TEXT.spoiltMethod]) : '');

/** Whether the page is in the dark theme (the shell's data-theme, else the system's). */
function darkPage() {
  const theme = document.documentElement.dataset['theme'];
  return theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/** The control to focus again after the view renders itself anew for a change it made. */
let refocus = '';

/**
 * The map data of one election in one mode: feature -> colour, feature -> words, feature -> pattern
 * and the pattern images, the key, the table, and the figures (with each contest's margin).
 * @param {{ key: string }} el
 * @param {import('../state-machines.js').MapMode} mode
 * @param {{ party?: string, vs?: { key: string, displayTitle?: string } | null, under?: number | null, unit?: import('../lib/map-modes.js').MarginUnit, dark?: boolean }} [opt]
 */
export async function mapData(el, mode, opt = {}) {
  const [bundle, before] = await Promise.all([
    electionBundle(el.key),
    mode === 'swing' && opt.vs ? electionBundle(opt.vs.key) : Promise.resolve(null),
  ]);
  const areas = bundleAreas(bundle);
  const result = modeFigures(areas, mode, { party: opt.party, before: before ? bundleAreas(before) : null, beforeTitle: opt.vs?.displayTitle, dark: opt.dark });
  const filtering = opt.under !== null && opt.under !== undefined;
  /** @type {Map<string, string>} */
  const colours = new Map();
  /** @type {Map<string, string>} */
  const labels = new Map();
  /** @type {Map<string, string>} */
  const patterns = new Map();
  /** @type {Array<[string, string]>} */
  const table = [];
  for (const f of result.figures) {
    table.push([f.name, f.text]);
    if (!f.feature) continue;
    labels.set(f.feature, fill(MAP_PATTERNS.label, { area: f.name, value: f.text }));
    // Outside the filter: the outline alone.
    if (filtering && !isClose(f.margin, /** @type {number} */ (opt.under), opt.unit || 'votes')) continue;
    if (f.pattern) patterns.set(f.feature, f.pattern);
    else if (f.colour) colours.set(f.feature, f.colour);
  }
  /** @type {Map<string, { width: number, height: number, data: Uint8Array }>} */
  const images = new Map();
  for (const id of new Set(patterns.values())) {
    images.set(id, id === NO_DATA ? stripeImage([electionsAppColours.noDataHatch], { gap: true }) : stripeImage(result.patterns.get(id) || []));
  }
  const legend = filtering ? [...result.legend, { kind: /** @type {const} */ ('empty'), colours: [], label: MAP_TEXT.filteredOut }] : result.legend;
  const drawn = result.figures.filter((f) => f.feature).length;
  return { colours, labels, patterns, images, legend, title: result.title, table, figures: result.figures, matched: drawn, total: result.figures.length };
}

/**
 * The key as HTML: its title, then each colour with its words.
 * @param {string} title @param {import('../lib/map-modes.js').LegendItem[]} legend
 */
export function legendHtml(title, legend) {
  const swatch = (/** @type {import('../lib/map-modes.js').LegendItem} */ l) => {
    if (l.kind === 'none') return '<span class="cg-legend__swatch cg-legend__swatch--none" aria-hidden="true"></span>';
    if (l.kind === 'empty') return '<span class="cg-legend__swatch cg-legend__swatch--empty" aria-hidden="true"></span>';
    if (l.kind === 'split') return `<span class="cg-legend__swatch cg-legend__swatch--split" style="--legend-colour:${esc(l.colours[0])};--legend-colour-2:${esc(l.colours[1] || l.colours[0])}" aria-hidden="true"></span>`;
    return `<span class="cg-legend__swatch" style="--legend-colour:${esc(l.colours[0])}" aria-hidden="true"></span>`;
  };
  return `<ul class="cg-legend el-map-key" aria-label="${esc(title)}"><li class="cg-legend__title" aria-hidden="true">${esc(title)}</li>${legend.map((l) => `<li class="cg-legend__item">${swatch(l)}${esc(l.label)}</li>`).join('')}</ul>`;
}

/**
 * The close contests as a table sorted by `sort`, its sortable columns' headers buttons.
 * @param {ReturnType<typeof closeContests>} rows
 * @param {import('../lib/map-state.js').MapState['sort']} sort
 * @param {string} limit the filter in words
 */
export function closeTableHtml(rows, sort, limit) {
  const sorted = sortRows(rows, sort.key, sort.dir);
  const head = (/** @type {string} */ label, /** @type {import('../lib/map-state.js').SortKey | null} */ key, num = false) => {
    const cls = num ? ' class="num"' : '';
    if (!key) return `<th scope="col"${cls}>${esc(label)}</th>`;
    const on = sort.key === key;
    return `<th scope="col"${cls} aria-sort="${on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="el-sort" data-sort="${key}">${esc(label)}</button></th>`;
  };
  const column = sort.key === 'name' ? VIEW_TEXT.contest : sort.key === 'votes' ? VIEW_TEXT.marginVotes : VIEW_TEXT.marginPct;
  return `<table class="cg-table cg-table--compact" data-table-hook="el-maps-close">
    <caption class="el-sr">${esc(fill(VIEW_TEXT.closeCaption, { limit, column }))} (${esc(sort.dir === 'asc' ? VIEW_TEXT.ascending : VIEW_TEXT.descending)})</caption>
    <thead><tr>${head(VIEW_TEXT.contest, 'name')}${head(VIEW_TEXT.elected, null)}${head(VIEW_TEXT.runnerUp, null)}${head(VIEW_TEXT.marginVotes, 'votes', true)}${head(VIEW_TEXT.marginPct, 'pct', true)}${head(VIEW_TEXT.count, null, true)}</tr></thead>
    <tbody>${sorted.map((r) => `<tr><th scope="row">${esc(r.name)}</th><td>${esc(r.winner)}</td><td>${esc(r.runnerUp)}</td><td class="num">${esc(fmtInt(r.votes))}</td><td class="num">${esc(fmtPct(r.pct, 2))}</td><td class="num">${r.count === null ? '—' : esc(fmtInt(r.count))}</td></tr>`).join('')}</tbody>
  </table>`;
}

/** The filter in words: "500 votes" or "2% of the valid poll". @param {number} under @param {import('../lib/map-modes.js').MarginUnit} unit */
const limitText = (under, unit) => (unit === 'pct' ? fill(VIEW_TEXT.limitPct, { pct: fmtPct(under, under % 1 ? 1 : 0) }) : fill(VIEW_TEXT.limitVotes, { n: fmtInt(under) }));

/**
 * @param {HTMLElement} root
 * @param {import('../lib/route.js').Route} route
 * @param {import('../app.js').ViewContext} ctx
 */
export async function render(root, route, ctx) {
  const index = (await electionIndex()).filter((e) => e.layerId && e.contestType === 'election');
  const st = parseMapState(route.query);
  const want = st.e || DEFAULT_ELECTION;
  const el = must(index.find((e) => electionSlug(e.key) === want || e.key === want) || index.at(-1), 'election');
  const mode = st.mode;
  const others = index.filter((e) => e.bodySlug === el.bodySlug && e.key !== el.key);
  const sameLayer = others.filter((e) => e.layerId === el.layerId);
  const detail = await electionDetail(el.key);
  const parties = (detail.partySummary || []).filter((p) => p.votes > 0).map((p) => p.party);
  const party = st.party && parties.includes(st.party) ? st.party : parties[0] || '';
  const vs = others.find((e) => electionSlug(e.key) === st.vs) || sameLayer.filter((e) => e.date < el.date).at(-1) || sameLayer.at(-1) || null;
  const shown = mapModeShown(mode, { party: !!party, vs: !!vs, sameBoundaries: !vs || vs.layerId === el.layerId });
  /** @param {Partial<import('../lib/map-state.js').MapState>} patch */
  const urlOf = (patch) => `/elections/map/?${mapStateQuery({ ...st, e: electionSlug(el.key), ...patch })}`;
  const rec = await layerRecord(String(el.layerId)).catch(() => null);
  const boundaries = rec ? [rec.category, rec.name].filter(Boolean).map(String).join(', ') : '';

  const bodies = [...new Map(index.map((e) => [e.bodySlug, e.body])).entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1])));
  const option = (/** @type {string} */ value, /** @type {string} */ label, /** @type {boolean} */ on) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const notice = (/** @type {string} */ text) => `<p class="cg-notice cg-notice--warning">${esc(text)}</p>`;
  const filtering = st.under !== null;
  root.innerHTML = `
    <header class="el-head"><h1>${esc(VIEW_TEXT.title)}</h1><p class="el-lead"><a href="${appUrl.election(el.key)}">${esc(el.displayTitle)}</a>${boundaries ? `. ${esc(fill(VIEW_TEXT.lead, { boundaries }))}` : ''}</p></header>
    <form class="el-controls" id="mp-form" onsubmit="return false">
      <label>${esc(VIEW_TEXT.body)} <select id="mp-body">${bodies.map(([s, n]) => option(String(s), String(n), s === el.bodySlug)).join('')}</select></label>
      <label>${esc(VIEW_TEXT.election)} <select id="mp-e">${index.filter((e) => e.bodySlug === el.bodySlug).map((e) => option(electionSlug(e.key), e.displayTitle, e.key === el.key)).join('')}</select></label>
      <label>${esc(VIEW_TEXT.show)} <select id="mp-mode">${MAP_MODES.map((m) => option(m.mode, m.label, m.mode === mode)).join('')}</select></label>
      ${mode === 'share' || mode === 'swing' ? `<label>${esc(VIEW_TEXT.party)} <select id="mp-party">${parties.map((p) => option(p, p, p === party)).join('')}</select></label>` : ''}
      ${mode === 'swing' && others.length ? `<label>${esc(VIEW_TEXT.vs)} <select id="mp-vs">${vs ? '' : option('', '—', true)}${others.map((e) => option(electionSlug(e.key), e.layerId === el.layerId ? e.displayTitle : fill(VIEW_TEXT.otherBoundaries, { election: e.displayTitle }), !!vs && e.key === vs.key)).join('')}</select></label>` : ''}
      <fieldset class="el-map-filter"><legend>${esc(VIEW_TEXT.close)}</legend>
        <label>${esc(VIEW_TEXT.under)} <input id="mp-under" type="number" inputmode="decimal" min="0" step="any" value="${st.under === null ? '' : esc(String(st.under))}"></label>
        <label>${esc(VIEW_TEXT.unit)} <select id="mp-unit">${option('votes', MAP_TEXT.votes, st.unit === 'votes')}${option('pct', MAP_TEXT.pctValid, st.unit === 'pct')}</select></label>
        ${filtering ? `<button type="button" class="cg-button" id="mp-clear">${esc(VIEW_TEXT.clear)}</button>` : ''}
      </fieldset>
    </form>
    ${shown.reason === 'no-vs' ? notice(VIEW_TEXT.noVs) : ''}
    ${shown.reason === 'no-party' ? notice(VIEW_TEXT.noParty) : ''}
    ${shown.reason === 'boundaries' && vs ? notice(fill(VIEW_TEXT.boundaries, { election: vs.displayTitle })) : ''}
    <div id="mp-map" class="el-map" role="img" aria-label="${esc(fill(VIEW_TEXT.mapLabel, { election: el.displayTitle, key: MAP_MODES.find((m) => m.mode === shown.mode)?.label || '' }))}"></div>
    <div id="mp-legend"></div>
    <p id="mp-status" class="el-muted" role="status" data-state="loading">${esc(VIEW_TEXT.loading)}</p>
    ${filtering ? `<section aria-labelledby="mp-close-h" id="mp-close"><h2 id="mp-close-h">${esc(VIEW_TEXT.close)}</h2><div id="mp-close-out"></div></section>` : ''}
    <div id="mp-table"></div>
    <section aria-labelledby="mp-sm"><h2 id="mp-sm">${esc(VIEW_TEXT.multiples)}</h2>
      <p class="el-muted">${esc(fill(VIEW_TEXT.multiplesLead, { body: el.body }))}</p>
      <button type="button" class="cg-button" id="mp-sm-go">${esc(fill(VIEW_TEXT.multiplesDraw, { n: sameLayer.length + 1 }))}</button>
      <div id="mp-sm-out" class="el-multiples"></div></section>`;

  const listen = { signal: ctx.signal };
  const form = /** @type {HTMLFormElement} */ (root.querySelector('#mp-form'));
  /** Re-render at a new state, keeping the control that changed it focused. @param {string} href @param {string} id */
  const go = (href, id) => { refocus = id; ctx.navigate(href, { replace: true, keepScroll: true }); };
  form.addEventListener('change', (e) => {
    const t = /** @type {HTMLSelectElement | HTMLInputElement} */ (e.target);
    if (t.id === 'mp-body') {
      const latest = index.filter((x) => x.bodySlug === t.value).at(-1);
      if (latest) go(`/elections/map/?${mapStateQuery({ ...st, e: electionSlug(latest.key), party: null, vs: null })}`, t.id);
      return;
    }
    if (t.id === 'mp-e') go(urlOf({ e: t.value, vs: null }), t.id);
    if (t.id === 'mp-mode') go(urlOf({ mode: /** @type {import('../state-machines.js').MapMode} */ (t.value) }), t.id);
    if (t.id === 'mp-party') go(urlOf({ party: t.value }), t.id);
    if (t.id === 'mp-vs') go(urlOf({ vs: t.value }), t.id);
    if (t.id === 'mp-under' || t.id === 'mp-unit') {
      const under = Number(/** @type {HTMLInputElement} */ (root.querySelector('#mp-under')).value);
      const unit = /** @type {HTMLSelectElement} */ (root.querySelector('#mp-unit')).value === 'pct' ? 'pct' : 'votes';
      // A new unit or limit starts the list in its own default order (closest first).
      go(`/elections/map/?${mapStateQuery({ ...st, e: electionSlug(el.key), under: under > 0 ? under : null, unit, sort: { key: unit === 'pct' ? 'pct' : 'votes', dir: 'asc' } })}`, t.id);
    }
  }, listen);
  root.querySelector('#mp-clear')?.addEventListener('click', () => {
    go(urlOf({ under: null }), 'mp-under');
  }, listen);
  if (refocus) {
    /** @type {HTMLElement | null} */ (root.querySelector(`#${refocus}`))?.focus();
    refocus = '';
  }

  // EL-08: the small multiples, one drawing at a time. The button works while the main map loads.
  const button = /** @type {HTMLButtonElement} */ (root.querySelector('#mp-sm-go'));
  const out = /** @type {HTMLElement} */ (root.querySelector('#mp-sm-out'));
  const multiples = MULTIPLES.start();
  ctx.onDispose(() => { if (multiples.state() === 'drawing') multiples.to('aborted'); });
  button.addEventListener('click', async () => {
    // A second click while drawing is refused (the table has no drawing -> drawing).
    if (!MULTIPLES.can(multiples.state(), 'drawing')) return;
    multiples.to('drawing');
    button.disabled = true;
    out.setAttribute('aria-busy', 'true');
    out.dataset['state'] = 'drawing';
    out.innerHTML = '';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-9999px;width:320px;height:360px';
    document.body.append(holder);
    ctx.onDispose(() => holder.remove());
    try {
      const layer = await layerRecord(String(el.layerId));
      const series = [...sameLayer, el].sort((x, y) => (x.date < y.date ? -1 : 1));
      for (const e of series) {
        if (ctx.stale()) break;
        const data = await mapData(e, 'winner', { dark: darkPage() });
        if (ctx.stale()) break;
        holder.innerHTML = '';
        // Each off-screen map is removed once drawn, or by the signal when the view is left.
        const m = await areaMap(holder, layer, { colours: data.colours, patterns: data.patterns, images: data.images, interactive: false, preserve: true, signal: ctx.signal });
        if (!m) break;
        try {
          await idle(m, 15000, ctx.signal);
          if (ctx.stale()) break;
          const src = m.getCanvas().toDataURL('image/png');
          const alt = fill(VIEW_TEXT.multiplesAlt, { election: e.displayTitle, figures: data.table.map(([a, v]) => `${a} ${v}`).join('; ') });
          out.insertAdjacentHTML('beforeend', `<figure class="cg-chart"><a href="${urlOf({ e: electionSlug(e.key), mode: 'winner' })}"><img src="${src}" alt="${esc(alt)}" width="320" height="360" loading="lazy"></a><figcaption>${esc(e.displayTitle)}</figcaption>${mapTable(`winners-${electionSlug(e.key)}`, fill(CHART_TEXT.winnersOf, { name: e.displayTitle }), data.title, data.table, `${electionSlug(e.key)}-winners`)}</figure>`);
        } finally {
          m.remove();
        }
      }
      if (multiples.state() === 'drawing') multiples.to(ctx.stale() ? 'aborted' : 'done');
    } catch (err) {
      if (multiples.state() === 'drawing') multiples.to(ctx.stale() ? 'aborted' : 'failed');
      if (!ctx.stale()) out.innerHTML = `<p class="cg-notice cg-notice--danger">${esc(fill(VIEW_TEXT.multiplesFailed, { error: String(/** @type {Error} */ (err)?.message || err) }))}</p>`;
    } finally {
      holder.remove();
      out.removeAttribute('aria-busy');
      out.dataset['state'] = multiples.state();
      button.disabled = multiples.state() === 'aborted';
    }
  }, listen);

  // EL-09: the status line, loading until the map is drawn or fails.
  const status = /** @type {HTMLElement} */ (root.querySelector('#mp-status'));
  const statusRun = MAP_STATUS.start();
  try {
    const data = await mapData(el, shown.mode, { party, vs, under: st.under, unit: st.unit, dark: darkPage() });
    if (ctx.stale()) return el.displayTitle;
    /** @type {HTMLElement} */ (root.querySelector('#mp-legend')).innerHTML = legendHtml(data.title, data.legend);
    // The figures as a table (and CSV) first: they stand even where the map cannot draw.
    /** @type {HTMLElement} */ (root.querySelector('#mp-table')).innerHTML = mapMethod(shown.mode)
      + mapTable('map', fill(CHART_TEXT.mapFigures, { name: el.displayTitle }), data.title, data.table, `${electionSlug(el.key)}-${shown.mode}${shown.mode === 'share' || shown.mode === 'swing' ? `-${party}` : ''}`);
    if (filtering) {
      const under = /** @type {number} */ (st.under);
      const limit = limitText(under, st.unit);
      const rows = closeContests(data.figures, under, st.unit);
      const outEl = /** @type {HTMLElement} */ (root.querySelector('#mp-close-out'));
      let sort = st.sort;
      const draw = () => {
        outEl.innerHTML = `<p>${esc(fill(rows.length ? VIEW_TEXT.closeSummary : VIEW_TEXT.closeNone, { n: fmtInt(rows.length), total: fmtInt(data.total), limit }))}</p>${rows.length ? `<div class="cg-table-wrap">${closeTableHtml(rows, sort, limit)}</div>` : ''}`;
      };
      draw();
      // Sorting changes the list and the URL only: the map stays as it is.
      outEl.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('button[data-sort]') : null);
        if (!b) return;
        const key = /** @type {import('../lib/map-state.js').SortKey} */ (b.dataset['sort']);
        sort = { key, dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' };
        history.replaceState(null, '', urlOf({ sort }));
        draw();
        /** @type {HTMLElement | null} */ (outEl.querySelector(`button[data-sort="${key}"]`))?.focus();
      }, listen);
    }
    if (!rec) throw new Error(String(el.layerId));
    // One map per visit, removed when the view is left (ctx.signal): every change of the form
    // renders the view again, so the previous map and its WebGL context go first.
    const map = await areaMap(/** @type {HTMLElement} */ (root.querySelector('#mp-map')), rec, { colours: data.colours, labels: data.labels, patterns: data.patterns, images: data.images, signal: ctx.signal });
    if (ctx.stale()) return el.displayTitle;
    await idle(map, 15000, ctx.signal);
    if (ctx.stale()) return el.displayTitle;
    status.dataset['state'] = statusRun.to('drawn');
    status.textContent = fill(data.matched < data.total ? VIEW_TEXT.drawnSome : VIEW_TEXT.drawn, { n: data.matched, total: data.total });
  } catch (err) {
    if (ctx.stale()) return el.displayTitle;
    status.dataset['state'] = statusRun.to('failed');
    status.textContent = '';
    /** @type {HTMLElement} */ (root.querySelector('#mp-map')).innerHTML = `<p class="cg-notice cg-notice--danger">${esc(fill(VIEW_TEXT.failed, { error: String(/** @type {Error} */ (err)?.message || err) }))}</p>`;
  }
  return `Map: ${el.displayTitle}`;
}
