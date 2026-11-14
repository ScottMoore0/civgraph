/**
 * An area page (/elections/area/<contest slug>/[?body=]): every contest held under one name, a
 * section per body, each with its party-share trend (the /maps/ chart), its members term by term,
 * its contests with a one-line verdict each, and its boundary maps (el-places, 14 Nov 2026).
 *
 * The derivations are lib/area.js and lib/verdict.js (pure, tested); this view only draws them.
 * The page says that contests are gathered by name, and where no boundary map is held.
 */
import { areaHistory, partyNames } from '../lib/api.js';
import { boundaryChanges, memberGrid, partyKeyFor, seriesOf, trendPoints } from '../lib/area.js';
import { appUrl, esc, fmtDate, fmtInt, fmtPct, positive } from '../lib/format.js';
import { partyChip } from '../lib/party.js';
import { areaUrl, layerMapUrl, personAppUrl } from '../lib/place-urls.js';
import { TEXT, fill } from '../lib/places-text.js';
import { trendChart, trendTable } from '../lib/trend.js';
import { chartData } from '../lib/chart-data.js';
import { contestVerdict } from '../lib/verdict.js';

/** @typedef {import('../lib/area.js').Series} Series */
/** @typedef {import('../lib/area.js').Member} Member */

/**
 * The area page's URL state: the contest slug and the body it is narrowed to. Pure.
 * @param {import('../lib/route.js').Route} route
 */
export function areaState(route) {
  return { slug: String(route.area || '').toLowerCase(), body: route.query.get('body') || null };
}

/** @param {HTMLElement} root @param {import('../lib/route.js').Route} route */
export async function render(root, route) {
  const { slug, body } = areaState(route);
  const [history, names] = await Promise.all([areaHistory(slug), partyNames().catch(() => ({}))]);
  const all = seriesOf(history, partyKeyFor(names));
  const shown = body ? all.filter((s) => s.bodySlug === body) : all;
  if (!shown.length) throw Object.assign(new Error('area not found'), { status: 404 });
  const name = history.name;
  const width = Math.min(root.clientWidth || 640, 960);
  const one = shown.length === 1 ? shown[0] : null;

  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › ${one ? `<a href="${appUrl.body(one.bodySlug)}">${esc(one.body)}</a> › ` : ''}${esc(name)}</nav>
    <header class="el-head">
      <h1>${esc(name)}</h1>
      <p class="el-lead">${shown.map((s) => `${esc(s.body)} ${s.firstYear === s.lastYear ? s.firstYear : `${s.firstYear}–${s.lastYear}`}`).join(' · ')}</p>
    </header>
    <p class="cg-notice">${esc(TEXT.areaIdentity)}</p>
    ${all.length > 1 ? `<nav class="el-area-bodies" aria-label="${esc(TEXT.areaBodies)}"><h2 class="el-sr">${esc(body ? TEXT.otherBodies : TEXT.areaBodies)}</h2><ul class="el-chips">${all.map((s) => `<li><a class="el-chip" href="${areaUrl(slug, s.bodySlug)}"${s.bodySlug === body ? ' aria-current="page"' : ''}>${esc(s.body)}</a></li>`).join('')}${body ? `<li><a class="el-chip" href="${areaUrl(slug)}">${esc(fill(TEXT.allContestsHere, { name }))}</a></li>` : ''}</ul></nav>` : ''}
    ${shown.map((s, i) => seriesHtml(s, i, width)).join('')}`;
  return name;
}

/** One body's series. @param {Series} s @param {number} i @param {number} width */
function seriesHtml(s, i, width) {
  const id = `el-series-${i}`;
  const referendum = s.contests.every((m) => m.referendum);
  const chart = referendum ? null : trendChart(trendPoints(s), { width, ariaLabel: `${TEXT.areaTrend}: ${s.body}` });
  const grid = referendum ? null : memberGrid(s);
  const maps = boundaryChanges(s);
  return `<section class="el-series" aria-labelledby="${id}">
    <h2 id="${id}">${esc(s.body)} <span class="el-muted">${s.firstYear === s.lastYear ? s.firstYear : `${s.firstYear}–${s.lastYear}`}</span></h2>
    ${s.mapped ? '' : `<p class="el-muted">${esc(TEXT.areaNoMaps)}</p>`}
    ${referendum ? '' : chart ? chartHtml(chart, `${id}-trend`) : `<p class="el-muted">${esc(TEXT.areaNoChart)}</p>`}
    ${grid && grid.rows.length ? gridHtml(grid, `${id}-members`) : ''}
    ${contestsHtml(s, `${id}-contests`)}
    ${maps.length ? `<h3 id="${id}-maps">${esc(TEXT.areaBoundaries)}</h3><ul class="el-list">${maps.map((b) => `<li><a href="${appUrl.contest(b.model.contest.electionKey, b.model.contest.contestSlug)}">${esc(b.model.contest.displayTitle)}</a>: ${esc(b.previous ? fill(TEXT.boundaryChanged, { map: b.mapName, previous: b.previous }) : fill(TEXT.boundaryFirst, { map: b.mapName }))}${b.layerId ? ` · <a href="${esc(layerMapUrl(b.layerId))}">${esc(TEXT.areaOnMap)}</a>` : ''}</li>`).join('')}</ul>` : ''}
  </section>`;
}

/** @param {NonNullable<ReturnType<typeof trendChart>>} chart @param {string} id */
function chartHtml(chart, id) {
  const table = trendTable(chart.model);
  return `<h3 id="${id}">${esc(TEXT.areaTrend)}</h3>
    <figure class="cg-chart el-trend">
      <ul class="el-trend-legend">${table.parties.map((p) => `<li>${partyChip(p.party, p.colour)}</li>`).join('')}</ul>
      ${chart.svg}
      <figcaption class="el-muted">${esc(TEXT.areaTrendNote)}</figcaption>
    </figure>
    ${chartData({
      id,
      caption: TEXT.areaTrend,
      file: `civgraph-${id}`,
      columns: [{ label: TEXT.colElection, format: (v) => fmtDate(v) }, ...table.parties.map((p) => ({ label: p.party, num: true, format: (/** @type {import('../lib/chart-data.js').Cell} */ v) => (v === null || v === undefined ? '—' : fmtPct(v)), csv: (/** @type {import('../lib/chart-data.js').Cell} */ v) => (typeof v === 'number' ? Number(v.toFixed(2)) : '') }))],
      rows: table.rows.map((r) => [r.date, ...r.shares]),
    })}`;
}

/** @param {ReturnType<typeof memberGrid>} grid @param {string} id */
function gridHtml(grid, id) {
  /** @param {{ member: Member, isNew: boolean }} cell */
  const inner = (cell) => {
    const url = personAppUrl(cell.member);
    const who = url ? `<a href="${esc(url)}">${esc(cell.member.name)}</a>` : esc(cell.member.name);
    return `${who}${cell.isNew ? ` <span class="cg-badge">${esc(TEXT.areaMembersNew)}</span>` : ''}<br>${partyChip(cell.member.party, cell.member.colour)}`;
  };
  /** @param {{ member: Member, isNew: boolean } | null} cell */
  const cellHtml = (cell) => (cell ? `<td class="el-member${cell.isNew ? ' el-member--new' : ''}">${inner(cell)}</td>` : '<td class="el-member el-member--empty">—</td>');
  const head = grid.columns === 1 ? `<th scope="col">${esc(TEXT.areaMembers)}</th>`
    : Array.from({ length: grid.columns }, (_, i) => `<th scope="col">${esc(fill(TEXT.colSeat, { n: i + 1 }))}</th>`).join('');
  return `<h3 id="${id}">${esc(TEXT.areaMembers)}</h3>
    <div class="cg-table-wrap" tabindex="0" role="region" aria-labelledby="${id}"><table class="cg-table cg-table--compact cg-table--sticky-first el-members">
      <thead><tr><th scope="col">${esc(TEXT.colElection)}</th>${head}</tr></thead>
      <tbody>${grid.rows.map((r) => `<tr${r.byElection ? ' class="el-members__by"' : ''}><th scope="row"><a href="${appUrl.contest(r.model.contest.electionKey, r.model.contest.contestSlug)}">${esc(String(r.model.contest.year))}</a>${r.byElection ? ` <span class="el-muted">${esc(TEXT.byElection)}</span>` : ''}</th>${
        r.byElection ? `<td colspan="${grid.columns}" class="el-member">${inner(r.byElection)}</td>`
          : r.cells.length ? r.cells.map(cellHtml).join('') : `<td colspan="${grid.columns}" class="el-muted">${esc(TEXT.noneElected)}</td>`}</tr>`).join('')}</tbody>
    </table></div>`;
}

/** @param {Series} s @param {string} id */
function contestsHtml(s, id) {
  const rows = [...s.contests].reverse();
  return `<h3 id="${id}">${esc(TEXT.areaContests)}</h3>
    <div class="cg-table-wrap" tabindex="0" role="region" aria-labelledby="${id}"><table class="cg-table cg-table--compact el-area-contests">
      <thead><tr><th scope="col">${esc(TEXT.colElection)}</th><th scope="col">${esc(TEXT.colKind)}</th><th scope="col" class="num">${esc(TEXT.colSeats)}</th><th scope="col" class="num">${esc(TEXT.colTurnout)}</th><th scope="col">${esc(TEXT.colResult)}</th></tr></thead>
      <tbody>${rows.map((m) => `<tr><th scope="row"><a href="${appUrl.contest(m.contest.electionKey, m.contest.contestSlug)}">${esc(m.contest.displayTitle)}</a><br><span class="el-muted">${esc(fmtDate(m.contest.date))}</span></th>`
        + `<td>${m.referendum ? '' : esc(m.byElection ? TEXT.byElection : TEXT.general)}</td><td class="num">${fmtInt(m.seats)}</td><td class="num">${fmtPct(positive(m.contest.turnoutPct))}</td>`
        + `<td>${esc(contestVerdict(m, fmtInt))}</td></tr>`).join('')}</tbody>
    </table></div>`;
}
