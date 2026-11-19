/**
 * Home (/elections/) and one body's elections (/elections/body/<slug>/), from the elections index.
 */
import { bodyElections, electionIndex } from '../lib/api.js';
import { appUrl, esc, fmtDate } from '../lib/format.js';
import { siteNumber } from '../../../pkg/core/src/format.js';
import { mountSearch, searchFormHtml } from './search-box.js';
import { ELECTIONS_HOME_ORDER, alsoListedUnderBody, electionsHomeGroup } from '../../../pkg/registries/src/browser/election-group-lists.mjs';
import { alsoListedSources, bodyListing, bodySummaries } from '../lib/body-list.js';

/**
 * The group a body belongs to on the home page: the election-bodies registry's electionsHome groups
 * (data/registries/election-bodies.json), in their display order.
 * @param {string} slug
 */
export function bodyGroup(slug) {
  return electionsHomeGroup(slug);
}
const GROUP_ORDER = ELECTIONS_HOME_ORDER;

/** @param {HTMLElement} root @param {import('../lib/route.js').Route} route @param {import('../app.js').ViewContext} ctx */
export async function render(root, route, ctx) {
  if (route.view === 'body') {
    const slug = String(route.body);
    // The elections filed under another body that this body's page lists too (the registry's alsoListed).
    const keys = alsoListedUnderBody(slug);
    const [own, ...others] = await Promise.all([bodyElections(slug), ...[...alsoListedSources(keys, slug).keys()].map((body) => bodyElections(body))]);
    return renderBody(root, bodyListing(own.filter((e) => e.bodySlug === slug), others.flat(), keys), slug);
  }
  const all = await electionIndex();
  const bodies = bodySummaries(all, alsoListedUnderBody);
  /** @type {Map<string, Array<import('../lib/body-list.js').BodySummary>>} */
  const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const b of bodies.values()) groups.get(bodyGroup(b.slug))?.push(b);
  const recent = all.filter((e) => e.kind !== 'by-election' && e.contestType === 'election').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  root.innerHTML = `
    <header class="el-head">
      <h1>Civgraph Elections</h1>
      <p class="el-lead">${siteNumber(all.length)} elections and referendums in Ireland and Northern Ireland, 1801 to today: seats and votes, full count sheets with transfers where the sources give them, and the source behind every figure.</p>
      <p class="cg-notice cg-notice--warning el-preview">Preview: this app is not yet public. Figures come from the same records as Browse.</p>
    </header>
    ${searchFormHtml()}
    <section aria-labelledby="el-recent"><h2 id="el-recent">Recent general elections</h2>
      <ul class="el-cards">${recent.map((e) => `<li><a class="cg-card" href="${appUrl.election(e.key)}"><span class="cg-card__title">${esc(e.displayTitle)}</span><span class="cg-card__meta">${esc(fmtDate(e.date))} · ${esc(e.body)}</span></a></li>`).join('')}</ul>
    </section>
    ${[...groups].filter(([, bs]) => bs.length).map(([g, bs]) => `
      <section aria-label="${esc(g)}"><h2>${esc(g)}</h2>
        <div class="cg-table-wrap"><table class="cg-table cg-table--compact el-bodies"><thead><tr><th scope="col">Body</th><th scope="col">Years</th><th scope="col" class="num">Elections</th><th scope="col" class="num">By-elections</th></tr></thead>
        <tbody>${bs.sort((a, b) => b.n - a.n).map((b) => `<tr><th scope="row"><a href="${appUrl.body(b.slug)}">${esc(b.name)}</a></th><td>${b.from.slice(0, 4)}–${b.to.slice(0, 4)}</td><td class="num">${b.n - b.by}</td><td class="num">${b.by || ''}</td></tr>`).join('')}</tbody></table></div>
      </section>`).join('')}`;
  // The search: places, people, parties and elections (views/search-box.js, el-places).
  mountSearch(root, { elections: all, query: route.query }, ctx);
  return '';
}

/**
 * One body's elections, newest first by decade; an election filed under another body (listed here
 * too) names that body after its date.
 * @param {HTMLElement} root @param {import('../lib/api.js').ElectionRow[]} list @param {string} slug
 */
function renderBody(root, list, slug) {
  const own = list.find((e) => e.bodySlug === slug);
  if (!own) { throw Object.assign(new Error('body not found'), { status: 404 }); }
  const name = own.body || slug;
  /** @type {Map<string, import('../lib/api.js').ElectionRow[]>} */
  const decades = new Map();
  for (const e of list) {
    const d = `${Math.floor(Number(e.year || e.date.slice(0, 4)) / 10) * 10}s`;
    if (!decades.has(d)) decades.set(d, []);
    /** @type {import('../lib/api.js').ElectionRow[]} */ (decades.get(d)).push(e);
  }
  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › ${esc(name)}</nav>
    <h1>${esc(name)}</h1>
    <p class="el-lead">${siteNumber(list.length)} elections, ${String(list.at(-1)?.date).slice(0, 4)}–${/** @type {(typeof list)[number]} */ (list[0]).date.slice(0, 4)}.</p>
    ${[...decades].map(([d, es]) => `<section><h2>${esc(d)}</h2><ul class="el-list">${es.map((e) => `<li><a href="${appUrl.election(e.key)}">${esc(e.displayTitle)}</a> <span class="el-muted">${esc(fmtDate(e.date))}${e.bodySlug !== slug ? ` · ${esc(e.body || e.bodySlug)}` : ''}${e.contestStatus === 'uncontested' ? ' · unopposed' : ''}</span></li>`).join('')}</ul></section>`).join('')}`;
  return name;
}
