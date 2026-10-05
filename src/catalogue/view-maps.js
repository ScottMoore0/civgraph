/**
 * The Maps section: filters, then every series as one row whose editions are chips that add their
 * map in one click. A row opens in place for its timeline, facts, versions, parts and the rest of
 * its actions; maps still to be added show on request, row by row. Rendering only: the controller
 * (index.js) owns state and behaviour, and is passed in as `c`.
 */
import { icon, SHELF_LOOK } from './icons.js';
import { esc, plural, span, inkOn, longDate, SCOPE_SHORT } from './util.js';
import { sliderHtml } from './slider.js';
import { PeopleSearch } from './search.js';

const FALLBACK = '#7a8699';
const colourOf = (c, s, id) => c.rec(id).color || s.color || FALLBACK;

/** Where (one of all, NI, ROI, Ireland) and kind (boundaries or data, or neither for both) share a
 * row; the years slider sits below. "What's here?" and "On the map" are built but not shown yet. */
export function toolbarHtml(c) {
  const f = c.filters;
  const chip = (group, value, label) => `<button type="button" class="cn-fchip" data-cn-filter="${group}" data-value="${esc(value)}" aria-pressed="${String(f[group] === value)}">${esc(label)}</button>`;
  const active = c.activeFilterCount('maps');
  const { i, j } = c.yearRange('maps');
  return `<div class="cn-toolbar" data-cn-toolbar="maps"${c.filtersOpen ? ' data-open' : ''}>
    <button type="button" class="cn-filters-toggle" data-cn-act="filters" aria-expanded="${c.filtersOpen}">${icon('sliders')}Filters${active ? ` <span class="cn-badge">${active}</span>` : ''}</button>
    <div class="cn-filters">
      <div class="cn-frow">
        <span class="cn-fgroup" role="group" aria-label="Where"><span class="cn-label">Where</span>${chip('scope', '', 'All')}${chip('scope', 'Northern Ireland', SCOPE_SHORT['Northern Ireland'])}${chip('scope', 'Republic of Ireland', SCOPE_SHORT['Republic of Ireland'])}${chip('scope', 'Ireland', SCOPE_SHORT.Ireland)}</span>
        <span class="cn-fgroup" role="group" aria-label="Kind"><span class="cn-label">Kind</span>${chip('kind', 'Boundary', 'Boundaries')}${chip('kind', 'Dataset', 'Data')}</span>
      </div>
      ${sliderHtml('maps', c.mapBins, c.mapCounts(), i, j, 'dated map')}
    </div>
  </div>`;
}

export function resultsHtml(c) {
  if (c.here) return hereHtml(c);
  const shelves = c.visibleShelves();
  const total = shelves.reduce((n, x) => n + x.count, 0);
  const maps = shelves.reduce((n, x) => n + x.subjects.reduce((m, y) => m + y.series.reduce((k, s) => k + s.members.length, 0), 0), 0);
  const summary = c.query
    ? (total ? `${plural(total, 'series', 'series')} match “${esc(c.query)}”${c.activeFilterCount('maps') ? ' with these filters' : ''}.` : '')
    : `${plural(total, 'series', 'series')}, ${plural(maps, 'map')}${c.activeFilterCount('maps') ? ', filtered' : ''}.`;
  const empty = !total ? `<p class="cn-empty" role="status">${c.query ? `No maps match “${esc(c.query)}”${c.activeFilterCount('maps') ? ' with these filters' : ''}.` : 'No maps match these filters.'}
    ${c.activeFilterCount('maps') ? ' <button type="button" class="cn-link" data-cn-act="clear-filters">Clear the filters</button>' : ''}${c.otherTabHint()}</p>` : '';
  return `<div data-cn-extras>${c.query ? extrasHtml(c) : ''}</div>
    ${summary ? `<p class="cn-summary" role="status">${summary}</p>` : ''}
    ${empty}
    ${shelves.map((x) => shelfHtml(c, x)).join('')}`;
}

function shelfHtml(c, { sh, subjects, count }) {
  const [ic, col] = SHELF_LOOK[sh.id] || ['map', FALLBACK];
  const open = !c.collapsed.has(sh.id) || Boolean(c.query);
  return `<section class="cn-shelf" id="cn-shelf-${esc(sh.id)}" data-cn-section="${esc(sh.id)}" style="--shelf:${col}" aria-labelledby="cn-shelf-h-${esc(sh.id)}">
    <h3 class="cn-shelf__head" id="cn-shelf-h-${esc(sh.id)}"><button type="button" class="cn-shelf__toggle" data-cn-shelf="${esc(sh.id)}" aria-expanded="${open}">
      <span class="cn-shelf__icon">${icon(ic)}</span><span class="cn-shelf__name">${esc(sh.name)}</span><span class="cn-count">${plural(count, 'series', 'series')}</span>${icon('chevron-down', 'cn-icon cn-shelf__chev')}</button></h3>
    <div class="cn-shelf__body"${open ? '' : ' hidden'}>
      ${subjects.map((x) => subjectHtml(c, x)).join('')}
    </div>
  </section>`;
}

function subjectHtml(c, { sub, series }) {
  return `<div class="cn-subject" id="cn-subject-${esc(sub.id)}" data-cn-subject="${esc(sub.id)}">
    <h4 class="cn-subject__head">${esc(sub.name)} <span class="cn-count">${series.length}</span></h4>
    <ul class="cn-list" role="list">${series.map((s) => seriesRowHtml(c, s)).join('')}</ul>
  </div>`;
}

/** One series. `hit` (optional) marks editions that matched a search or cover a point. */
export function seriesRowHtml(c, s, hit = c.hitFor(s)) {
  const editions = s.members.filter((m) => !m.of);
  const versions = s.members.length - editions.length;
  const todo = s.todo || [];
  const drawable = s.members.length > 0;
  const single = s.members.length === 1;
  const open = drawable && c.expanded.has(s.id);
  const meta = [
    SCOPE_SHORT[s.scope] || s.scope,
    span(s.years),
    editions.length > 1 ? plural(editions.length, s.arrangement === 'editions' ? 'edition' : 'map') : '',
    versions ? plural(versions, 'other version') : '',
  ].filter(Boolean).map((t) => `<span>${esc(t)}</span>`);
  if (!drawable) meta.push('<span class="cn-badge cn-badge--todo">To be added</span>');
  else if (s.status?.incomplete) meta.push('<span class="cn-badge cn-badge--warn">Incomplete</span>');
  if (single) {
    const from = c.providerLine(s.members[0].id);
    if (from) meta.push(`<span>${esc(from)}</span>`);
  }
  const text = `<span class="cn-row__text"><span class="cn-row__name">${esc(s.name)}</span><span class="cn-row__meta">${meta.join('<span class="cn-row__dot" aria-hidden="true">·</span>')}</span></span>`;
  // A series with nothing to draw yet is a heading and its list of maps to come: nothing to open.
  const title = drawable
    ? `<button type="button" class="cn-row__title" data-cn-expand="${esc(s.id)}" aria-expanded="${open}" aria-controls="cn-panel-${esc(s.id)}">${text}${icon('chevron-down', 'cn-icon cn-row__chev')}</button>`
    : `<div class="cn-row__title cn-row__title--static">${text}</div>`;
  const chips = !single || todo.length;
  return `<li class="cn-row${open ? ' cn-row--open' : ''}${drawable ? '' : ' cn-row--todo'}" data-cn-series="${esc(s.id)}" style="--c:${s.color || FALLBACK}">
    <span class="cn-row__stripe" aria-hidden="true"></span>
    <span class="cn-row__thumb">${s.thumb ? c.thumb(s.thumb) : `<span class="cn-thumb-none" aria-hidden="true">${icon('map')}</span>`}</span>
    ${title}
    <span class="cn-row__end">
      ${single ? addButtonHtml(c, s, s.members[0]) : ''}
      ${drawable ? `<button type="button" class="cn-iconbtn" data-cn-menu="${esc(s.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More for ${esc(s.name)}" title="More: download, link, cite, compare">${icon('ellipsis')}</button>` : ''}
    </span>
    ${chips ? `<div class="cn-chips" role="group" aria-label="${esc(s.name)}: ${s.arrangement === 'editions' ? 'editions' : 'maps'}">${chipsHtml(c, s, single ? [] : editions, hit)}</div>` : ''}
    ${open ? `<div class="cn-panel" id="cn-panel-${esc(s.id)}" data-cn-panel="${esc(s.id)}">${panelHtml(c, s)}</div>` : ''}
  </li>`;
}

function addButtonHtml(c, s, m) {
  const col = colourOf(c, s, m.id);
  const name = s.members.length > 1 ? `${s.name}, ${m.label}` : s.name;
  return `<button type="button" class="cn-add" data-cn-toggle="${esc(m.id)}" data-series="${esc(s.id)}" aria-pressed="false" aria-label="${esc(name)}: on the map" style="--c:${col};--on:${inkOn(col)}">${icon('plus', 'cn-icon cn-when-off')}${icon('check', 'cn-icon cn-when-on')}<span class="cn-when-off">Add</span><span class="cn-when-on">On map</span></button>`;
}

/** The editions as chips; the maps still to be added join them, in date order, when asked for. */
function chipsHtml(c, s, editions, hit) {
  const hits = new Set(hit?.members || []);
  const todo = s.todo || [];
  const showTodo = c.showTodo.has(s.id);
  let items = editions.map((m) => ({ m, todo: false }));
  if (showTodo) {
    items = [...items, ...todo.map((m) => ({ m, todo: true }))];
    if (s.arrangement === 'editions') items.sort((a, b) => String(c.rec(b.m.id).date).localeCompare(String(c.rec(a.m.id).date)));
  } else if (!c.moreChips.has(s.id)) {
    // As many chips as fit two short lines, the ones a search matched first. Opening a row does
    // not spill every chip: its timeline shows all the editions; "+N more" shows every chip.
    const ordered = hits.size ? [...editions.filter((m) => hits.has(m.id)), ...editions.filter((m) => !hits.has(m.id))] : editions;
    const keep = new Set();
    let used = 0;
    for (const m of ordered) {
      const w = m.label.length + 5;
      if (keep.size >= 2 && (used + w > 70 || keep.size >= 9)) break;
      keep.add(m.id);
      used += w;
    }
    items = items.filter((x) => keep.has(x.m.id));
  }
  const dimByPeriod = Boolean(c.searchPeriod && hits.size);
  const rest = editions.length - items.filter((x) => !x.todo).length;
  return items.map(({ m, todo: isTodo }) => (isTodo ? todoChipHtml(c, m)
    : chipHtml(c, s, m, { hit: hits.has(m.id) && (c.query || c.here), out: !c.editionInYears(m.id) || (dimByPeriod && !hits.has(m.id)) }))).join('')
    + (rest > 0 ? `<button type="button" class="cn-chip cn-chip--more" data-cn-more="${esc(s.id)}" aria-label="Show ${rest} more of ${esc(s.name)}">+${rest} more</button>` : '')
    + (todo.length ? `<button type="button" class="cn-chip cn-chip--todo-toggle" data-cn-todo="${esc(s.id)}" aria-pressed="${showTodo}">${icon(showTodo ? 'x' : 'plus')}${showTodo ? 'Hide' : 'Show'} ${todo.length} to be added</button>` : '');
}

function todoChipHtml(c, m) {
  const r = c.rec(m.id);
  const tip = [r.name || m.label, r.date ? longDate(r.date) : ''].filter(Boolean).join(' · ');
  return `<span class="cn-chip cn-chip--todo" title="${esc(tip)}: to be added, not yet on the map"><span class="cn-chip__dot" aria-hidden="true"></span><span class="cn-chip__label">${esc(m.label)}</span></span>`;
}

export function chipHtml(c, s, m, { hit = false, out = false, label = m.label } = {}) {
  const r = c.rec(m.id);
  const col = colourOf(c, s, m.id);
  const versions = s.members.filter((x) => x.of === m.id).length;
  const tip = [label, r.date && r.date !== label ? longDate(r.date) : '', c.providerLine(m.id), r.status === 'incomplete' ? 'incomplete' : ''].filter(Boolean).join(' · ');
  if (r.status === 'placeholder') {
    return `<span class="cn-chip cn-chip--todo" title="${esc(tip)}: to be added, not yet on the map"><span class="cn-chip__dot" aria-hidden="true"></span><span class="cn-chip__label">${esc(label)}</span></span>`;
  }
  return `<button type="button" class="cn-chip${hit ? ' cn-chip--hit' : ''}${out ? ' cn-chip--out' : ''}" data-cn-toggle="${esc(m.id)}" data-series="${esc(s.id)}" aria-pressed="false" aria-label="${esc(`${s.name}, ${label}`)}" title="${esc(tip)}" style="--c:${col};--on:${inkOn(col)}"><span class="cn-chip__dot" aria-hidden="true"></span>${icon('check', 'cn-icon cn-chip__check')}<span class="cn-chip__label">${esc(label)}</span>${versions ? `<span class="cn-chip__more" aria-hidden="true">+${versions}</span>` : ''}</button>`;
}

/** The opened row: timeline or list, then the chosen edition's facts and every action. */
export function panelHtml(c, s) {
  const editions = s.members.filter((m) => !m.of);
  const sel = c.selectedMember(s);
  const r = c.rec(sel.id);
  const dated = editions.filter((m) => c.decimalYear(c.rec(m.id).date) !== null);
  const timeline = s.arrangement === 'editions' && dated.length >= 2;
  return `${timeline ? timelineHtml(c, s, dated, sel) : ''}
    ${!timeline && s.members.length > 1 ? memberListHtml(c, s, sel) : ''}
    <div class="cn-ed">
      ${factsHtml(c, sel, r)}
      ${r.description ? `<p class="cn-desc">${esc(r.description)}</p>${r.description.length > 320 ? '<button type="button" class="cn-link" data-cn-act="more-text">Read more</button>' : ''}` : ''}
      ${versionsHtml(c, s, sel)}
      ${partsHtml(c, s, sel, r)}
      ${actionsHtml(c, s, sel, r)}
    </div>`;
}

function timelineHtml(c, s, dated, sel) {
  const pts = dated.map((m) => ({ m, t: c.decimalYear(c.rec(m.id).date) })).sort((a, b) => a.t - b.t);
  const min = pts[0].t;
  const max = pts[pts.length - 1].t;
  const width = Math.max(240, pts.length * 46);
  const selBase = sel.of || sel.id;
  let last = -Infinity;
  const ticks = pts.map(({ m, t }) => {
    const pct = max === min ? 50 : ((t - min) / (max - min)) * 100;
    const px = (pct / 100) * width;
    const show = px - last >= 40 || m.id === selBase;
    if (show) last = px;
    const label = m.label.length <= 6 ? m.label : String(Math.floor(t));
    return `<button type="button" class="cn-tick" style="left:${pct.toFixed(2)}%;--c:${colourOf(c, s, m.id)}" data-cn-select="${esc(s.id)}|${esc(m.id)}" data-cn-dot="${esc(m.id)}" aria-pressed="${m.id === selBase}" aria-label="${esc(m.label)}" title="${esc(`${m.label} · ${c.providerLine(m.id) || ''}`)}"><span class="cn-tick__dot" aria-hidden="true"></span><span class="cn-tick__label" aria-hidden="true">${show ? esc(label) : ''}</span></button>`;
  }).join('');
  return `<div class="cn-tl" role="group" aria-label="${esc(s.name)} on a timeline: choose an edition"><div class="cn-tl__track" style="min-width:${width}px"><span class="cn-tl__axis" aria-hidden="true"></span>${ticks}</div></div>`;
}

function memberListHtml(c, s, sel) {
  return `<ul class="cn-mlist" aria-label="${esc(s.name)}: choose a map">${s.members.map((m) => {
    const r = c.rec(m.id);
    return `<li class="cn-mlist__item${m.of ? ' cn-mlist__item--version' : ''}" style="--c:${colourOf(c, s, m.id)}">
      <button type="button" class="cn-mlist__name" data-cn-select="${esc(s.id)}|${esc(m.id)}" aria-current="${m.id === sel.id}">${esc(m.label)}</button>
      ${r.status === 'placeholder' ? '<span class="cn-badge cn-badge--todo">To be added</span>' : addButtonHtml(c, s, m)}
    </li>`;
  }).join('')}</ul>`;
}

function factsHtml(c, sel, r) {
  const rows = [
    r.date && ['Date', longDate(r.date)],
    r.licence && ['Licence', r.licence],
    r.status && r.status !== 'ready' && ['Status', r.status === 'placeholder' ? 'To be added: listed, not yet drawn' : 'Incomplete'],
    r.note && ['Note', r.note],
  ].filter(Boolean);
  return rows.length ? `<dl class="cn-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
}

function versionsHtml(c, s, sel) {
  const base = sel.of || sel.id;
  const others = s.members.filter((m) => m.id !== sel.id && (m.id === base || m.of === base));
  if (!others.length) return '';
  return `<div class="cn-sub"><span class="cn-label">Other versions of this edition</span><div class="cn-chips">${others.map((m) => chipHtml(c, s, m, { label: m.of ? m.label : `${m.label} (main)` })).join('')}</div></div>`;
}

function partsHtml(c, s, sel, r) {
  if (!r.parts?.length) return '';
  const all = c.moreParts.has(sel.id);
  const shown = all ? r.parts : r.parts.slice(0, 12);
  const col = colourOf(c, s, sel.id);
  return `<div class="cn-sub"><span class="cn-label">Parts · ${r.parts.length}</span>
    <div class="cn-chips">${shown.map((p) => `<button type="button" class="cn-chip" data-cn-toggle="${esc(p.id)}" aria-pressed="false" aria-label="${esc(`${r.name || sel.label}: ${p.label}`)}" title="${esc(p.label)}" style="--c:${col};--on:${inkOn(col)}"><span class="cn-chip__dot" aria-hidden="true"></span>${icon('check', 'cn-icon cn-chip__check')}<span class="cn-chip__label">${esc(p.label)}</span></button>`).join('')}
    ${r.parts.length > shown.length ? `<button type="button" class="cn-chip cn-chip--more" data-cn-more-parts="${esc(sel.id)}">+${r.parts.length - shown.length} more</button>` : ''}</div>
    ${r.parts.length > 1 ? `<div><button type="button" class="cn-link" data-cn-act="add-parts" data-map="${esc(sel.id)}">Add all ${r.parts.length} parts</button></div>` : ''}</div>`;
}

function actionsHtml(c, s, sel, r) {
  if (r.status === 'placeholder') return '<p class="cn-muted">Listed so you know it is coming: it cannot be drawn yet.</p>';
  const col = colourOf(c, s, sel.id);
  const others = s.members.filter((m) => m.id !== sel.id && c.rec(m.id).status !== 'placeholder');
  const full = c.full(sel.id);
  return `<div class="cn-actions">
    <button type="button" class="cn-btn cn-btn--primary" data-cn-toggle="${esc(sel.id)}" data-series="${esc(s.id)}" aria-pressed="false" style="--c:${col};--on:${inkOn(col)}">${icon('plus', 'cn-icon cn-when-off')}${icon('x', 'cn-icon cn-when-on')}<span class="cn-when-off">Add to map</span><span class="cn-when-on">Remove from map</span></button>
    <button type="button" class="cn-btn" data-cn-visibility="${esc(sel.id)}" hidden>${icon('eye-off')}<span>Hide</span></button>
    ${r.bounds ? `<button type="button" class="cn-btn" data-cn-act="zoom" data-map="${esc(sel.id)}">${icon('maximize')}<span>Zoom to</span></button>` : ''}
    ${full ? `<button type="button" class="cn-btn" data-cn-act="details" data-map="${esc(sel.id)}">${icon('info')}<span>Details</span></button>` : ''}
    ${c.downloadsFor(sel.id).length ? `<button type="button" class="cn-btn" data-cn-act="downloads" data-map="${esc(sel.id)}" aria-haspopup="menu" aria-expanded="false">${icon('download')}<span>Download</span>${icon('chevron-down')}</button>` : ''}
    <button type="button" class="cn-btn" data-cn-act="copy-link" data-map="${esc(sel.id)}">${icon('link')}<span>Copy link</span></button>
    <button type="button" class="cn-btn" data-cn-act="cite" data-map="${esc(sel.id)}" data-series="${esc(s.id)}">${icon('quote')}<span>Cite</span></button>
    ${others.length ? `<button type="button" class="cn-btn" data-cn-act="compare" data-map="${esc(sel.id)}" data-series="${esc(s.id)}" aria-haspopup="menu" aria-expanded="false">${icon('columns')}<span>Compare</span>${icon('chevron-down')}</button>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- search: places and people */

/** What a search finds besides maps: places (Maps only), people, and parties. */
export function extrasHtml(c, { places = true } = {}) {
  const x = c.extras;
  if (!x) return '';
  if (x.loading) return `<p class="cn-summary" role="status">Looking for ${places ? 'places and ' : ''}people…</p>`;
  return `${places && x.places?.length ? placesHtml(c, x.places) : ''}${x.persons?.length ? personsHtml(c, x.persons) : ''}${x.people?.length ? peopleHtml(c, x.people) : ''}`;
}

/** Everyone who stood, by name: their main party and constituency, years, contests and wins, a
 * link to their page, and the elections they stood in, here in the Elections tab. */
function personsHtml(c, results) {
  const limit = c.limits.persons ? results.length : 6;
  const { parties, constituencies } = c.peopleDoc;
  return `<section class="cn-block" aria-labelledby="cn-persons-h">
    <h3 class="cn-block__head" id="cn-persons-h">${icon('user')}<span>People</span><span class="cn-count">${results.length >= 200 ? '200+' : results.length}</span></h3>
    <ul class="cn-people">${results.slice(0, limit).map(({ row }) => {
      const years = row[4] === row[5] ? String(row[4]) : `${row[4]}–${row[5]}`;
      const meta = [parties[row[2]], constituencies[row[3]], years, `${plural(row[6], 'contest')}, ${row[7]} won`].filter(Boolean);
      return `<li class="cn-person cn-person--row">${icon('user')}<span class="cn-person__main"><a class="cn-person__name" href="${esc(PeopleSearch.url(row))}">${esc(row[1])}</a><span class="cn-muted">${esc(meta.join(' · '))}</span></span>
        <button type="button" class="cn-btn cn-btn--small" data-cn-person="${esc(row[0])}" aria-label="Elections ${esc(row[1])} stood in">${icon('vote')}<span>Elections</span></button></li>`;
    }).join('')}</ul>
    ${results.length > limit ? `<button type="button" class="cn-link" data-cn-act="show-all" data-what="persons">Show ${results.length >= 200 ? 'the first 200' : `all ${results.length}`}</button>` : ''}
  </section>`;
}

function placeThumb(c, record) {
  const t = record.featureThumbnail;
  if (t?.url) return `<img src="${esc(t.url)}" alt="" loading="lazy" decoding="async">`;
  if (t?.bbox && c.ui._buildFeatureLocatorSvg) return c.ui._buildFeatureLocatorSvg(t.bbox, t.colour);
  return icon('map-pin');
}

function placesHtml(c, groups) {
  const limit = c.limits.places ? groups.length : 5;
  return `<section class="cn-block" aria-labelledby="cn-places-h">
    <h3 class="cn-block__head" id="cn-places-h">${icon('map-pin')}<span>Places</span><span class="cn-count">${groups.length}</span></h3>
    <ul class="cn-places">${groups.slice(0, limit).map((g) => `<li class="cn-place"><details${groups.length === 1 ? ' open' : ''}>
      <summary><span class="cn-place__thumb">${placeThumb(c, g.items[0].record)}</span><span class="cn-place__name">${esc(g.name)}</span><span class="cn-muted">on ${plural(g.items.length, 'map')}</span>${icon('chevron-down', 'cn-icon cn-place__chev')}</summary>
      <ul class="cn-place__list">${g.items.map(({ record }) => `<li class="cn-place__item">
        <span class="cn-place__thumb">${placeThumb(c, record)}</span>
        <button type="button" class="cn-link cn-place__map" data-catalogue-search-action="open-feature-detail" data-map-id="${esc(record.mapId)}" data-feature-id="${esc(record.featureId || record.id)}" data-feature-name="${esc(record.title)}" data-feature-bbox="${esc((record.bbox || []).join(','))}">${esc(record.subtitle || record.mapId)}</button>
        ${c.ui.renderCatalogueSearchActionStrip ? c.ui.renderCatalogueSearchActionStrip(record) : ''}
      </li>`).join('')}</ul></details></li>`).join('')}</ul>
    ${groups.length > limit ? `<button type="button" class="cn-link" data-cn-act="show-all" data-what="places">Show all ${groups.length} places</button>` : ''}
  </section>`;
}

function peopleHtml(c, records) {
  const limit = c.limits.people ? records.length : 5;
  const ic = { person: 'user', party: 'flag', source: 'file-text' };
  const kinds = [['person', 'People'], ['party', 'Parties'], ['source', 'Sources']].filter(([t]) => records.some((r) => r.type === t)).map(([, l]) => l);
  const heading = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1].toLowerCase()}` : kinds[0] || 'People';
  return `<section class="cn-block" aria-labelledby="cn-people-h">
    <h3 class="cn-block__head" id="cn-people-h">${icon(records[0]?.type === 'party' ? 'flag' : 'user')}<span>${esc(heading)}</span><span class="cn-count">${records.length}</span></h3>
    <ul class="cn-people">${records.slice(0, limit).map((r) => `<li class="cn-person">${icon(ic[r.type] || 'file-text')}<a class="cn-person__name" href="${esc(r.url)}">${esc(r.title)}</a><span class="cn-muted">${esc([r.typeLabel, r.subtitle].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>
    ${records.length > limit ? `<button type="button" class="cn-link" data-cn-act="show-all" data-what="people">Show all ${records.length}</button>` : ''}
  </section>`;
}

/* ---------------------------------------------------------------- what's here */

function hereHtml(c) {
  const { lng, lat } = c.here;
  const hit = c.hereResult();
  const shelves = new Map();
  for (const { s, members } of hit.series) {
    if (!shelves.has(s.shelf)) shelves.set(s.shelf, []);
    shelves.get(s.shelf).push({ s, members });
  }
  const places = hit.places.slice(0, c.limits.here ? 400 : 30);
  return `<div class="cn-here__head"><h3>What's here</h3><button type="button" class="cn-btn" data-cn-act="close-here">${icon('x')}<span>Back to all maps</span></button></div>
    <p class="cn-summary">At ${lat.toFixed(4)}, ${lng.toFixed(4)}. A map is listed when its extent covers the point; most boundary maps cover all of their jurisdiction.</p>
    ${c.placesReady ? (places.length ? `<section class="cn-block"><h3 class="cn-block__head">${icon('map-pin')}<span>Places at this point</span><span class="cn-count">${hit.places.length}</span></h3>
      <div class="cn-chips">${places.map((p) => `<button type="button" class="cn-chip" data-cn-goto="${esc(p.seriesId || '')}" data-map="${esc(p.map)}"${p.seriesId ? '' : ' disabled'} title="${esc(p.mapName || '')}"><span class="cn-chip__label">${esc(p.name)}</span></button>`).join('')}</div>
      ${hit.places.length > places.length ? `<button type="button" class="cn-link" data-cn-act="show-all" data-what="here">Show all ${hit.places.length}</button>` : ''}</section>` : '')
      : '<p class="cn-summary" role="status">Looking up the places at this point…</p>'}
    ${hit.series.length ? [...shelves.entries()].map(([shelfId, rows]) => {
      const sh = c.shelfById.get(shelfId);
      const [ic, col] = SHELF_LOOK[shelfId] || ['map', FALLBACK];
      return `<section class="cn-shelf" style="--shelf:${col}"><h3 class="cn-shelf__head"><span class="cn-shelf__toggle" style="cursor:default"><span class="cn-shelf__icon">${icon(ic)}</span><span class="cn-shelf__name">${esc(sh?.name || shelfId)}</span><span class="cn-count">${rows.length}</span></span></h3>
        <ul class="cn-list" role="list">${rows.map(({ s, members }) => seriesRowHtml(c, s, { members })).join('')}</ul></section>`;
    }).join('') : '<p class="cn-empty">No map in the catalogue covers this point with these filters.</p>'}`;
}
