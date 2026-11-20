/**
 * An electoral area in its census context (el-context, 14 Nov 2026): a component any page about an
 * area can include. It reads the census figures (lib/api.js censusAreas), works out the area's
 * indicators, ranks and most similar areas (lib/census-context.js, pure) and draws them, citing
 * each census table by its code. Not a route.
 *
 * HOOK for area pages (el-places): put areaContextSection() in the page and call
 *   mountAreaContext(root, { layerId, area, date }, ctx, { linkFor })
 * after drawing it: layerId is the election's map layer (detail.layerId), area the contest's
 * feature name (or its name), date the election's date (the census nearest it is used), and
 * linkFor(areaName) an optional link for a similar area (its area page), or null. The contest page
 * includes it today.
 */
import { censusAreas } from '../lib/api.js';
import { CONTEXT_TEXT, SET_NAMES, areaContext, displayName } from '../lib/census-context.js';
import { esc, fmtInt, fmtPct } from '../lib/format.js';

export { contestLinker } from '../lib/census-context.js';
import { CENSUS_CONTEXT } from '../state-machines.js';

/** Every fixed text of the component (keys of data/i18n/strings/elections.txt). */
export const AREA_TEXT = Object.freeze({
  heading: 'The area in the census',
  loading: 'Loading the census figures…',
  failed: 'The census figures could not be loaded.',
  notHeld: 'Not yet held: Civgraph holds no census figures on these boundaries yet.',
  noArea: 'This area is not among the census areas held for these boundaries.',
  indicator: 'Indicator',
  thisArea: 'This area',
  rank: 'Rank',
  all: 'Northern Ireland',
  table: 'Census table',
  similar: 'Areas most like it',
  similarLead: 'The closest by the shares in the table, each measured against its spread across all the areas.',
  rankNote: 'Ranks count from the highest (1). They compare areas of one census on one set of boundaries only.',
  licence: 'NISRA census data: Open Government Licence v3.0.',
  source: 'Source:',
});
/** Patterns with numbers or names ({year}, {n}, {set}, {rank}, {years}). */
const PATTERNS = Object.freeze({
  lead: 'Census {year}, ranked among the {n} {set}.',
  rankOf: '{rank} of {n}',
  others: 'Also held for these boundaries: census {years}.',
});

/** Every text and pattern, for the key test. */
export const AREA_STRINGS = Object.freeze([...Object.values(AREA_TEXT), ...Object.values(PATTERNS), ...CONTEXT_TEXT, ...Object.values(SET_NAMES)]);

/** The component's markup, empty until mounted. @param {string} [id] its heading's id */
export function areaContextSection(id = 'el-census') {
  return `<section aria-labelledby="${esc(id)}" class="el-census" data-el-census><h2 id="${esc(id)}">${esc(AREA_TEXT.heading)}</h2><div data-el-census-body aria-live="polite"><p class="el-loading">${esc(AREA_TEXT.loading)}</p></div></section>`;
}

/**
 * Fill the component in `root` (the first [data-el-census] in it).
 * @param {HTMLElement} root
 * @param {{ layerId?: string | null | undefined, area?: string | null, date?: string | null }} where
 * @param {{ stale: () => boolean }} ctx the view's context (a stale view is left alone)
 * @param {{ linkFor?: (area: string) => string | null }} [opts]
 * @returns {Promise<string>} the state it settled in
 */
export async function mountAreaContext(root, where, ctx, opts = {}) {
  const box = /** @type {HTMLElement | null} */ (root.querySelector('[data-el-census]'));
  const body = /** @type {HTMLElement | null} */ (root.querySelector('[data-el-census-body]'));
  const run = CENSUS_CONTEXT.start();
  if (!box || !body) return run.state();
  box.dataset['state'] = run.state();
  try {
    const data = /** @type {import('../lib/census-context.js').CensusData} */ (await censusAreas());
    if (ctx.stale()) return run.state();
    const c = areaContext(data, where);
    body.innerHTML = areaContextHtml(c, data, opts.linkFor);
    box.dataset['state'] = run.to(c.status);
  } catch (err) {
    if (ctx.stale()) return run.state();
    body.innerHTML = `<p class="cg-notice cg-notice--danger">${esc(AREA_TEXT.failed)}</p>`;
    box.dataset['state'] = run.to('failed');
    console.error(err);
  }
  return run.state();
}

/**
 * The context as HTML.
 * @param {import('../lib/census-context.js').AreaContext} c
 * @param {import('../lib/census-context.js').CensusData} data
 * @param {(area: string) => string | null} [linkFor]
 */
export function areaContextHtml(c, data, linkFor) {
  if (c.status === 'not-held') return `<p class="cg-notice">${esc(AREA_TEXT.notHeld)}</p>`;
  if (c.status === 'no-area') return `<p class="cg-notice">${esc(AREA_TEXT.noArea)}</p>`;
  const n = Object.keys(c.census.areas).length;
  const lead = PATTERNS.lead.replace('{year}', String(c.census.year)).replace('{n}', fmtInt(n)).replace('{set}', SET_NAMES[c.set.id] || c.set.id);
  const value = (/** @type {import('../lib/census-context.js').IndicatorRow} */ r, /** @type {number | null} */ v) => (r.kind === 'count' ? fmtInt(v) : fmtPct(v));
  // Each row cites its census table by code (its title on hover and for screen readers).
  const rows = c.rows.map((r) => `<tr><th scope="row">${esc(r.label)}<div class="el-muted">${esc(r.base)} · ${esc(AREA_TEXT.table)} <abbr title="${esc(r.table.title)}">${esc(r.table.code)}</abbr></div></th>`
    + `<td class="num">${value(r, r.value)}</td>`
    + `<td class="num">${esc(PATTERNS.rankOf.replace('{rank}', fmtInt(r.rank)).replace('{n}', fmtInt(r.of)))}</td>`
    + `<td class="num">${value(r, r.ni)}</td></tr>`).join('');
  const similar = c.similar.map((s) => {
    const href = linkFor ? linkFor(s.name) : null;
    const name = displayName(s.name);
    return `<li>${href ? `<a href="${esc(href)}">${esc(name)}</a>` : esc(name)}</li>`;
  }).join('');
  const others = c.others.length ? `<p class="el-muted">${esc(PATTERNS.others.replace('{years}', c.others.join(', ')))}</p>` : '';
  return `<p class="el-lead">${esc(lead)}</p>
    <div class="cg-table-wrap"><table class="cg-table cg-table--compact el-census-table">
      <caption class="el-sr">${esc(AREA_TEXT.heading)}</caption>
      <thead><tr><th scope="col">${esc(AREA_TEXT.indicator)}</th><th scope="col" class="num">${esc(AREA_TEXT.thisArea)}</th><th scope="col" class="num">${esc(AREA_TEXT.rank)}</th><th scope="col" class="num">${esc(AREA_TEXT.all)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="el-muted">${esc(AREA_TEXT.rankNote)}</p>
    <h3>${esc(AREA_TEXT.similar)}</h3>
    <p class="el-muted">${esc(AREA_TEXT.similarLead)}</p>
    <ol class="el-list">${similar}</ol>
    ${others}
    <p class="el-muted">${esc(AREA_TEXT.source)} ${esc(c.census.source)}, ${esc(c.census.geography)}. <a href="${esc(data.licenceUrl)}" rel="noopener">${esc(AREA_TEXT.licence)}</a></p>`;
}
