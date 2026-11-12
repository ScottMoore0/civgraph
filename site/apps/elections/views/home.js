/**
 * Home (/elections/) and one body's elections (/elections/body/<slug>/), from the elections index.
 */
import { bodyElections, electionIndex } from '../lib/api.js';
import { appUrl, esc, fmtDate } from '../lib/format.js';
import { foldSearchText, siteNumber } from '../../../pkg/core/src/format.js';
import { ELECTIONS_HOME_ORDER, electionsHomeGroup } from '../../../pkg/registries/src/browser/election-group-lists.mjs';

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
  if (route.view === 'body') return renderBody(root, await bodyElections(String(route.body)), /** @type {string} */ (route.body));
  const all = await electionIndex();
  /** @type {Map<string, { slug: string, name: string, n: number, by: number, from: string, to: string }>} */
  const bodies = new Map();
  for (const e of all) {
    const b = bodies.get(e.bodySlug) || { slug: e.bodySlug, name: e.body || e.bodySlug, n: 0, by: 0, from: e.date, to: e.date };
    b.n += 1;
    if (e.kind === 'by-election') b.by += 1;
    if (e.date < b.from) b.from = e.date;
    if (e.date > b.to) b.to = e.date;
    bodies.set(e.bodySlug, b);
  }
  /** @type {Map<string, Array<{ slug: string, name: string, n: number, by: number, from: string, to: string }>>} */
  const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const b of bodies.values()) groups.get(bodyGroup(b.slug))?.push(b);
  const recent = all.filter((e) => e.kind !== 'by-election' && e.contestType === 'election').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  root.innerHTML = `
    <header class="el-head">
      <h1>Civgraph Elections</h1>
      <p class="el-lead">${siteNumber(all.length)} elections and referendums in Ireland and Northern Ireland, 1801 to today: seats and votes, full count sheets with transfers where the sources give them, and the source behind every figure.</p>
      <p class="cg-notice cg-notice--warning el-preview">Preview: this app is not yet public. Figures come from the same records as Browse.</p>
    </header>
    <form class="el-search" role="search" onsubmit="return false">
      <label for="el-q">Find an election</label>
      <input id="el-q" type="search" placeholder="e.g. 2024 general election, Belfast 1946, Antrim" autocomplete="off">
    </form>
    <div id="el-results" class="el-results" aria-live="polite"></div>
    <section aria-labelledby="el-recent"><h2 id="el-recent">Recent general elections</h2>
      <ul class="el-cards">${recent.map((e) => `<li><a class="cg-card" href="${appUrl.election(e.key)}"><span class="cg-card__title">${esc(e.displayTitle)}</span><span class="cg-card__meta">${esc(fmtDate(e.date))} · ${esc(e.body)}</span></a></li>`).join('')}</ul>
    </section>
    ${[...groups].filter(([, bs]) => bs.length).map(([g, bs]) => `
      <section aria-label="${esc(g)}"><h2>${esc(g)}</h2>
        <table class="cg-table cg-table--compact el-bodies"><thead><tr><th scope="col">Body</th><th scope="col">Years</th><th scope="col" class="num">Elections</th><th scope="col" class="num">By-elections</th></tr></thead>
        <tbody>${bs.sort((a, b) => b.n - a.n).map((b) => `<tr><th scope="row"><a href="${appUrl.body(b.slug)}">${esc(b.name)}</a></th><td>${b.from.slice(0, 4)}–${b.to.slice(0, 4)}</td><td class="num">${b.n - b.by}</td><td class="num">${b.by || ''}</td></tr>`).join('')}</tbody></table>
      </section>`).join('')}`;
  const input = /** @type {HTMLInputElement} */ (root.querySelector('#el-q'));
  const out = /** @type {HTMLElement} */ (root.querySelector('#el-results'));
  const fold = (/** @type {unknown} */ s) => foldSearchText(s || '');
  input.addEventListener('input', () => {
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    if (!words.length) { out.innerHTML = ''; return; }
    const hits = all.filter((e) => { const t = fold(`${e.displayTitle} ${e.body} ${e.date}`); return words.every((w) => t.includes(w)); });
    out.innerHTML = `<p>${siteNumber(hits.length)} found${hits.length > 50 ? ', the first 50 shown' : ''}.</p><ul class="el-list">${hits.slice(0, 50).map((e) => `<li><a href="${appUrl.election(e.key)}">${esc(e.displayTitle)}</a> <span class="el-muted">${esc(fmtDate(e.date))}</span></li>`).join('')}</ul>`;
  }, { signal: ctx.signal });
  return '';
}

/** @param {HTMLElement} root @param {import('../lib/api.js').ElectionRow[]} all @param {string} slug */
function renderBody(root, all, slug) {
  const list = all.filter((e) => e.bodySlug === slug).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!list.length) { throw Object.assign(new Error('body not found'), { status: 404 }); }
  const name = list[0].body || slug;
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
    <p class="el-lead">${siteNumber(list.length)} elections, ${String(list.at(-1)?.date).slice(0, 4)}–${list[0].date.slice(0, 4)}.</p>
    ${[...decades].map(([d, es]) => `<section><h2>${esc(d)}</h2><ul class="el-list">${es.map((e) => `<li><a href="${appUrl.election(e.key)}">${esc(e.displayTitle)}</a> <span class="el-muted">${esc(fmtDate(e.date))}${e.contestStatus === 'uncontested' ? ' · unopposed' : ''}</span></li>`).join('')}</ul></section>`).join('')}`;
  return name;
}
