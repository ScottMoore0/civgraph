/**
 * The Maps section: filters, then every series as one row whose editions are chips that add their
 * map in one click. A row opens in place for its editions as a dated list, each with its own tools,
 * and the facts, versions and parts of the one chosen; maps still to be added show on request, row
 * by row. Rendering only: the controller
 * (index.js) owns state and behaviour, and is passed in as `c`.
 */
import { icon, SHELF_LOOK, SHELF_ICON_IN, FLAT_SECTIONS } from './icons.js';
import { esc, plural, span, inkOn, longDate, mapDate, SCOPE_SHORT, shortProvider, yearOf, orderShelfRows, otherRowsLast } from './util.js';
import { SECTIONS, unitWord } from './index.js';
import { sliderHtml } from './slider.js';
import { PeopleSearch } from './search.js';
import { MAP_COLOURS } from '../views/colours.mjs';
import { creditLine } from '../../../core/src/credits.mjs';
import { rowActionKind, rowCount, datedList, comparable, rowEditions } from './row-model.mjs';
import { siteNumber } from '../../../core/src/format.js';
import { setHidden } from '../state-helpers.mjs';

/** @typedef {import('./index.js').CatalogueNext} CatalogueNext */
/** @typedef {import('./index.js').VisibleShelf} VisibleShelf */
/** @typedef {import('./index.js').PlaceGroup} PlaceGroup */
/** @typedef {import('./catalogue-types.d.ts').CatalogueRow} CatalogueRow */
/** @typedef {import('./catalogue-types.d.ts').CatalogueRowMember} CatalogueRowMember */
/** @typedef {import('./catalogue-types.d.ts').CatalogueMapRec} CatalogueMapRec */
/** @typedef {import('./catalogue-types.d.ts').CatalogueShelf} CatalogueShelf */
/** @typedef {import('./catalogue-types.d.ts').CatalogueSubject} CatalogueSubject */
/** @typedef {import('./catalogue-types.d.ts').CatalogueAbout} CatalogueAbout */
/** @typedef {import('./catalogue-types.d.ts').CatalogueSearchRecord} CatalogueSearchRecord */
/** @typedef {import('./search.js').PersonRow} PersonRow */
/** @typedef {import('./catalogue-types.d.ts').CataloguePeopleDoc} CataloguePeopleDoc */
/** @typedef {import('./index.js').LngLat} LngLat */
/** The editions a search matched or a point is in (a row's hit). @typedef {{ members?: string[] } | null | undefined} RowHit */
const FALLBACK = MAP_COLOURS.catalogueFallback;
/** @param {CatalogueNext} c @param {CatalogueRow} s @param {string} id */
const colourOf = (c, s, id) => c.rec(id).color || s.color || FALLBACK;

/** Where (one of all, NI, ROI, Ireland) and kind (boundaries or data, or neither for both) share a
 * row; the years slider sits below. "What's here?" and "On the map" are built but not shown yet. */
/** @param {CatalogueNext} c */
export function toolbarHtml(c) {
  const f = c.filters;
  /** @param {'scope'} group @param {string} value @param {string} label */
  const chip = (group, value, label) => `<button type="button" class="cn-fchip" data-cn-filter="${group}" data-value="${esc(value)}" aria-pressed="${String(f[group] === value)}">${esc(label)}</button>`;
  const active = c.activeFilterCount('maps');
  const { i, j } = c.yearRange('maps');
  return `<div class="cn-toolbar" data-cn-toolbar="maps"${c.filtersOpen ? ' data-open' : ''}>
    <button type="button" class="cn-filters-toggle" data-cn-act="filters" aria-expanded="${c.filtersOpen}">${icon('sliders')}Filters${active ? ` <span class="cn-badge">${active}</span>` : ''}</button>
    <span class="cn-tally" data-cn-tally aria-hidden="true"></span>
    <div class="cn-filters">
      <div class="cn-frow">
        <span class="cn-fgroup" role="group" aria-label="Where"><span class="cn-label">Where</span>${chip('scope', '', 'All')}${chip('scope', 'Northern Ireland', SCOPE_SHORT['Northern Ireland'])}${chip('scope', 'Republic of Ireland', SCOPE_SHORT['Republic of Ireland'])}${chip('scope', 'Ireland', SCOPE_SHORT.Ireland)}</span>
      </div>
      ${providerFilterHtml(c.providerChoices())}
      ${sliderHtml('maps', c.mapBins, i, j, c.yearState('maps'))}
      <label class="cn-check" data-cn-undated-wrap${c.yearRange('maps').narrowed ? '' : ' hidden'}><input type="checkbox" id="cn-undated" data-cn-undated${c.filters.undated ? ' checked' : ''}> Include undated maps</label>
    </div>
    ${keyHtml()}
  </div>`;
}

/** One provider of the filter's list (CatalogueNext.providerChoices). @typedef {{ id: string, full: string, short: string, count: number, chosen: boolean }} ProviderChoice */

/** What the closed Provider filter says: "All", or the chosen providers' short names.
 * @param {ProviderChoice[]} choices */
function providerSummary(choices) {
  const chosen = choices.filter((p) => p.chosen);
  if (!chosen.length) return 'All';
  return chosen.length <= 2 ? chosen.map((p) => p.short).join(', ') : `${chosen.length} chosen`;
}

/**
 * The Provider filter (Phelim Birch's notes, 19 Nov 2026): a list of the section's providers, each a
 * checkbox with how many rows it is credited on under the other filters; several may be chosen, and
 * a row shows when it credits any of them. Combines with Where and Years.
 * @param {ProviderChoice[]} choices
 */
export function providerFilterHtml(choices) {
  if (!choices.length) return '';
  const chosen = choices.filter((p) => p.chosen).length;
  return `<div class="cn-frow"><div class="cn-fgroup cn-prov" role="group" aria-label="Provider"><span class="cn-label" id="cn-prov-label">Provider</span>
    <details class="cn-prov__box" data-cn-providers><summary class="cn-fchip cn-prov__summary" aria-describedby="cn-prov-label"><span data-cn-provider-summary>${esc(providerSummary(choices))}</span>${icon('chevron-down', 'cn-icon cn-prov__chev')}</summary>
      <div class="cn-prov__panel">
        <ul class="cn-prov__list" role="list">${choices.map((p) => `<li><label class="cn-prov__item${p.count || p.chosen ? '' : ' cn-prov__item--none'}" title="${esc(p.full)}"><input type="checkbox" data-cn-provider="${esc(p.id)}"${p.chosen ? ' checked' : ''}><span class="cn-prov__name">${esc(p.full)}${p.short !== p.full ? ` <span class="cn-muted">(${esc(p.short)})</span>` : ''}</span><span class="cn-count" data-cn-provider-count="${esc(p.id)}">${p.count}</span></label></li>`).join('')}</ul>
        <button type="button" class="cn-link" data-cn-act="clear-providers"${chosen ? '' : ' hidden'}>Clear providers</button>
      </div>
    </details></div></div>`;
}

/**
 * The Provider filter brought up to date in place (counts, ticks, summary), so an open list keeps
 * its place and focus while a box is ticked.
 * @param {ParentNode} bar @param {ProviderChoice[]} choices
 */
export function updateProviderFilter(bar, choices) {
  const box = bar.querySelector('[data-cn-providers]');
  if (!box) return;
  const summary = box.querySelector('[data-cn-provider-summary]');
  if (summary) summary.textContent = providerSummary(choices);
  for (const p of choices) {
    const count = box.querySelector(`[data-cn-provider-count="${CSS.escape(p.id)}"]`);
    if (count) count.textContent = String(p.count);
    const input = /** @type {HTMLInputElement | null} */ (box.querySelector(`[data-cn-provider="${CSS.escape(p.id)}"]`));
    if (input && input.checked !== p.chosen) input.checked = p.chosen;
    input?.closest('.cn-prov__item')?.classList.toggle('cn-prov__item--none', !p.count && !p.chosen);
  }
  const clear = /** @type {HTMLElement | null} */ (box.querySelector('[data-cn-act="clear-providers"]'));
  if (clear) setHidden(clear, !choices.some((p) => p.chosen));
}

/** @param {CatalogueNext} c */
export function resultsHtml(c) {
  if (c.here) return hereHtml(c);
  const shelves = c.visibleShelves();
  const total = shelves.reduce((n, x) => n + x.count, 0);
  // Maps counted as the section's tab counts them (tabCounts): every map a row can add, its council
  // maps included, so the line under the tabs and the tab itself give the same figure (QA
  // 2026-11-11, M3: "324 maps" here beside "Boundaries 343" on the tab), named for its section.
  const maps = shelves.reduce((n, x) => n + x.subjects.reduce((m, y) => m + y.series.reduce((k, s) => k + s.members.length + (s.local?.length || 0), 0), 0), 0);
  const sectionLabel = SECTIONS.find(([id]) => id === c.section)?.[2] || '';
  const summary = c.query
    ? (total ? `${plural(total, 'series', 'series')} match “${esc(c.query)}”${c.activeFilterCount('maps') ? ' with these filters' : ''}.` : '')
    : `${plural(total, 'series', 'series')}, ${plural(maps, 'map')}${sectionLabel ? ` in ${esc(sectionLabel)}` : ''}${c.activeFilterCount('maps') ? ', filtered' : ''}.`;
  const empty = !total ? `<p class="cn-empty" role="status">${c.query ? `No maps match “${esc(c.query)}”${c.activeFilterCount('maps') ? ' with these filters' : ''}.` : 'No maps match these filters.'}
    ${c.activeFilterCount('maps') ? ' <button type="button" class="cn-link" data-cn-act="clear-filters">Clear the filters</button>' : ''}${c.otherTabHint()}</p>` : '';
  // "Westminster 2019" on the Maps tab: the election comes first, as a way across to it.
  const elections = c.query && c.electionsFirst ? c.tabCounts().elections : 0;
  const toElections = elections
    ? `<p class="cn-summary cn-summary--elections"><button type="button" class="cn-btn" data-cn-tab="elections">${icon('vote')}<span>${plural(elections, 'election')} match “${esc(c.query)}”</span></button></p>`
    : '';
  return `${toElections}<div data-cn-extras>${c.query ? extrasHtml(c) : ''}</div>
    ${summary ? `<p class="cn-summary cn-summary--count" role="status">${summary}</p>` : ''}
    ${empty}
    ${shelves.map((x) => shelfHtml(c, x, shelves.length === 1)).join('')}
    ${total ? keyHtml('cn-keyfoot') : ''}`;
}

/** What the chip dots mean: in the filters, or at the foot of the list when the filters fold away. */
function keyHtml(cls = 'cn-key') {
  return `<p class="${cls}"><span class="cn-key__item"><span class="cn-chip__dot cn-chip__dot--part" aria-hidden="true"></span>Incomplete</span><span class="cn-key__item"><span class="cn-chip__dot cn-chip__dot--todo" aria-hidden="true"></span>To be added</span></p>`;
}

// A shelf can go by another name inside one section: under Boundaries, "People & Places" holds
// the census and statistical areas. The Contents drawer uses the same name (shelfName), so its
// entry and the heading it scrolls to agree.
/** @type {Record<string, Record<string, string>>} */
const SHELF_NAME_IN = { boundaries: { 'people-and-places': 'Census & Statistical Areas' } };
/** @param {string} section @param {{ id: string, name: string }} sh */
export const shelfName = (section, sh) => SHELF_NAME_IN[section]?.[sh.id] || sh.name;

/** @param {CatalogueNext} c @param {VisibleShelf} shelf @param {boolean} [alone] */
function shelfHtml(c, { sh, subjects, count }, alone = false) {
  const [look, col] = SHELF_LOOK[sh.id] || ['map', FALLBACK];
  const ic = SHELF_ICON_IN[c.section]?.[sh.id] || look;
  if (FLAT_SECTIONS.has(c.section)) {
    return `<section class="cn-shelf cn-shelf--bare" id="cn-shelf-${esc(sh.id)}" data-cn-section="${esc(sh.id)}">${flatHtml(c, subjects, sh)}</section>`;
  }
  sh = { ...sh, name: shelfName(c.section, sh) };
  // Shelves start closed (Phelim Birch's review, 2026-10-11); a search, or a section with one
  // shelf, opens them.
  const open = c.opened.has(sh.id) || Boolean(c.query) || alone;
  return `<section class="cn-shelf" id="cn-shelf-${esc(sh.id)}" data-cn-section="${esc(sh.id)}" style="--shelf:${col}" aria-labelledby="cn-shelf-h-${esc(sh.id)}">
    <h3 class="cn-shelf__head" id="cn-shelf-h-${esc(sh.id)}"><button type="button" class="cn-shelf__toggle" data-cn-shelf="${esc(sh.id)}" aria-expanded="${open}">
      <span class="cn-shelf__icon">${icon(ic)}</span><span class="cn-shelf__name">${esc(sh.name)}</span><span class="cn-count">${plural(count, 'series', 'series')}</span>${icon('chevron-down', 'cn-icon cn-shelf__chev')}</button></h3>
    <div class="cn-shelf__body"${open ? '' : ' hidden'}>
      ${sh.flat ? flatHtml(c, subjects, sh) : subjects.map((x) => subjectHtml(c, x, subjects.length > 1)).join('')}
    </div>
  </section>`;
}

/** A small section lists its series straight, without the subheadings a large one needs. */
/** @param {CatalogueNext} c @param {VisibleShelf['subjects']} subjects @param {Partial<CatalogueShelf>} [sh] */
function flatHtml(c, subjects, sh = {}) {
  // A shelf may bring some rows to the top or send some to the end, whichever subject they sit in.
  const rows = subjects.flatMap((x) => x.series);
  const ordered = c.query ? rows : orderShelfRows(rows, sh);
  return `<div class="cn-subject cn-subject--flat">
    <ul class="cn-list" role="list">${ordered.map((s) => seriesRowHtml(c, s)).join('')}</ul>
  </div>`;
}

/** @param {CatalogueNext} c @param {VisibleShelf['subjects'][number]} subject @param {boolean} [heading] */
function subjectHtml(c, { sub, series }, heading = true) {
  // A shelf showing one subject (Elections & Representation under Places & routes: only
  // "Current") needs no heading for it.
  return `<div class="cn-subject" id="cn-subject-${esc(sub.id)}" data-cn-subject="${esc(sub.id)}">
    ${heading ? `<h4 class="cn-subject__head">${esc(sub.name)} <span class="cn-count">${series.length}</span></h4>` : ''}
    <ul class="cn-list" role="list">${(c.query ? series : otherRowsLast(series)).map((s) => seriesRowHtml(c, s)).join('')}</ul>
  </div>`;
}

/**
 * One series. `hit` (optional) marks editions that matched a search or cover a point.
 * @param {CatalogueNext} c
 * @param {CatalogueRow} s
 * @param {RowHit} [hit]
 */
export function seriesRowHtml(c, s, hit = c.hitFor(s)) {
  const editions = rowEditions(s);
  const todo = s.todo || [];
  const local = s.local || [];
  const drawable = s.members.length > 0;
  // One map (its other versions, such as Townlands' 1844 Valuation, wait in the opened row):
  // the row acts on that map; a row of several acts on itself (row-model.mjs).
  /** @type {import('./row-model.mjs').RowActionKind} */
  const actsOn = rowActionKind(s);
  const single = actsOn === 'map';
  const open = drawable && c.expanded.has(s.id);
  // A row with no scope finds no short name.
  const meta = [SCOPE_SHORT[/** @type {string} */ (s.scope)] || s.scope, span(s.years)].filter(Boolean).map((t) => `<span>${esc(t)}</span>`);
  // Dated editions of one map count "32 Counties · 6 editions" from the latest complete edition.
  const counted = rowCount(s, (id) => c.rec(id));
  const tally = [
    counted ? [counted.features ? `${siteNumber(counted.features)} ${unitWord(counted.unit, counted.features)}` : '', plural(counted.editions, 'edition')].filter(Boolean).join(' · ') : '',
    !counted && editions.length > 1 ? plural(editions.length, s.arrangement === 'editions' ? 'edition' : 'map') : '',
    local.length ? plural(local.length, 'council map') : '',
  ].filter(Boolean);
  const allTodo = !drawable || s.members.every((m) => c.rec(m.id).status === 'placeholder');
  if (allTodo) meta.push('<span class="cn-badge cn-badge--todo">To be added</span>');
  else if (s.status?.incomplete) meta.push('<span class="cn-badge cn-badge--warn">Incomplete</span>');
  // A row of census figures says which areas they are counted by ("by Ward 2014").
  const by = s.kind === 'Statistics' && single ? /\bby ([^,)]+)\)?\s*$/.exec(c.rec(s.members[0].id).name || '')?.[1] : '';
  const who = single ? c.mapSummary(s.members[0].id, { date: false, short: true }) : creditLine((s.provider || []).map(shortProvider), s.derivedFrom || []);
  const second = [by ? `by ${by}` : '', who, ...tally].filter(Boolean);
  const credit = second.length ? `<span class="cn-row__credit">${second.map((t, k) => `<span class="cn-row__item">${esc(t)}${k < second.length - 1 ? '<span class="cn-row__dot" aria-hidden="true"> ·</span>' : ''}</span>`).join(' ')}</span>` : '';
  const text = `<span class="cn-row__text"><span class="cn-row__name">${esc(s.name)}</span><span class="cn-row__meta">${meta.join('<span class="cn-row__dot" aria-hidden="true">·</span>')}</span>${credit}</span>`;
  // A series with nothing to draw yet is a heading and its list of maps to come: nothing to open.
  const tip = single ? c.mapSummary(s.members[0].id) : '';
  const title = drawable
    ? `<button type="button" class="cn-row__title" data-cn-expand="${esc(s.id)}" aria-expanded="${open}" aria-controls="cn-panel-${esc(s.id)}"${tip ? ` title="${esc(tip)}"` : ''}>${text}${icon('chevron-down', 'cn-icon cn-row__chev')}</button>`
    : `<div class="cn-row__title cn-row__title--static">${text}</div>`;
  const localHits = localHitsOf(c, s, hit);
  const chips = !single || todo.length || localHits.length;
  const ends = actsOn === 'row' ? rowActionsHtml(c, s) : single ? mapActionsHtml(c, s, s.members[0]) : '';
  return `<li class="cn-row${open ? ' cn-row--open' : ''}${drawable ? '' : ' cn-row--todo'}" data-cn-series="${esc(s.id)}" style="--c:${s.color || FALLBACK}">
    <span class="cn-row__stripe" aria-hidden="true"></span>
    <span class="cn-row__thumb">${s.thumb ? c.thumb(s.thumb) : `<span class="cn-thumb-none" aria-hidden="true">${icon('map')}</span>`}</span>
    ${title}
    ${ends ? `<span class="cn-row__end" role="group" aria-label="${esc(s.name)}: actions">${ends}</span>` : ''}
    ${chips ? `<div class="cn-chips" role="group" aria-label="${esc(s.name)}: ${s.arrangement === 'editions' ? 'editions' : 'maps'}">${chipsHtml(c, s, single ? [] : editions, hit)}</div>` : ''}
    ${open ? `<div class="cn-panel" id="cn-panel-${esc(s.id)}" data-cn-panel="${esc(s.id)}">${panelHtml(c, s)}</div>` : ''}
  </li>`;
}

/**
 * A row of several maps acts on itself: a link to the row, its citation, and Compare (two of its
 * editions, chosen from a menu) when it has two to compare.
 * @param {CatalogueNext} c @param {CatalogueRow} s
 */
function rowActionsHtml(c, s) {
  const pair = comparable(s, (id) => c.rec(id)).length >= 2;
  return `<button type="button" class="cn-iconbtn" data-cn-act="row-link" data-series="${esc(s.id)}" aria-label="Copy a link to ${esc(s.name)}" title="Copy link">${icon('link')}</button>
      <button type="button" class="cn-iconbtn" data-cn-act="row-cite" data-series="${esc(s.id)}" aria-label="Cite ${esc(s.name)}" title="Cite">${icon('quote')}</button>
      ${pair ? `<button type="button" class="cn-iconbtn" data-cn-act="row-compare" data-series="${esc(s.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Compare two editions of ${esc(s.name)}" title="Compare two editions">${icon('columns')}</button>` : ''}`;
}

/**
 * A row of one map acts on that map: Add, then Zoom, Download and Details.
 * @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} m
 */
function mapActionsHtml(c, s, m) {
  if (c.rec(m.id).status === 'placeholder') return '';
  return `${addButtonHtml(c, s, m)}${mapToolsHtml(c, m.id, s.name)}`;
}

/**
 * A map's own tools, each where it applies: Zoom (it has an extent), Download (it has files) and
 * Details (it has a page). Every map, version and part in a row has them beside its chip.
 * @param {CatalogueNext} c @param {string} id @param {string} label @param {{ small?: boolean }} [options]
 */
export function mapToolsHtml(c, id, label, { small = false } = {}) {
  const cls = `cn-iconbtn${small ? ' cn-iconbtn--sm' : ''}`;
  return `${c.boundsOf(id) ? `<button type="button" class="${cls}" data-cn-act="zoom" data-map="${esc(id)}" aria-label="Zoom to ${esc(label)}" title="Zoom to">${icon('maximize')}</button>` : ''}${c.downloadsFor(id).length ? `<button type="button" class="${cls}" data-cn-act="downloads" data-map="${esc(id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Download ${esc(label)}" title="Download">${icon('download')}</button>` : ''}${c.full(id) ? `<button type="button" class="${cls}" data-cn-act="details" data-map="${esc(id)}" aria-label="Details of ${esc(label)}" title="Details">${icon('info')}</button>` : ''}`;
}

/** @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} m */
function addButtonHtml(c, s, m) {
  const col = colourOf(c, s, m.id);
  const name = s.members.length > 1 ? `${s.name}, ${m.label}` : s.name;
  return `<button type="button" class="cn-add" data-cn-toggle="${esc(m.id)}" data-series="${esc(s.id)}" aria-pressed="false" aria-label="${esc(name)}: on the map" style="--c:${col};--on:${inkOn(col)}">${icon('plus', 'cn-icon cn-when-off')}${icon('check', 'cn-icon cn-when-on')}<span class="cn-when-off">Add</span><span class="cn-when-on">On map</span></button>`;
}

/** A series' council maps that a search or "What's here?" found: they show on the row; the rest
 * wait in the opened row.
 * @param {CatalogueNext} c @param {CatalogueRow} s @param {RowHit} hit */
function localHitsOf(c, s, hit) {
  const hits = new Set(hit?.members || []);
  return (c.query || c.here) ? (s.local || []).filter((m) => hits.has(m.id)) : [];
}

/** The editions as chips; the maps still to be added join them, in date order, when asked for.
 * With years chosen, the maps in those years come first (Counties before 1930: 1927, 1922, 1915).
 * @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember[]} editions @param {RowHit} hit */
function chipsHtml(c, s, editions, hit) {
  const hits = new Set(hit?.members || []);
  if (c.yearRange('maps').narrowed) editions = [...editions.filter((m) => c.editionInYears(m.id)), ...editions.filter((m) => !c.editionInYears(m.id))];
  const todo = s.todo || [];
  const showTodo = c.showTodo.has(s.id);
  let items = editions.map((m) => ({ m, todo: false }));
  if (showTodo) {
    items = [...items, ...todo.map((m) => ({ m, todo: true }))];
    if (s.arrangement === 'editions') items.sort((a, b) => String(c.rec(b.m.id).date).localeCompare(String(c.rec(a.m.id).date)));
  }
  // The chips a search matched come first. Every chip is drawn; the controller then keeps the
  // row to one line by measuring it (fitChips), hiding the chips that would wrap behind
  // "+N more", which turns into "Hide" once the full set is showing.
  if (hits.size && !showTodo) items = [...items.filter((x) => hits.has(x.m.id)), ...items.filter((x) => !hits.has(x.m.id))];
  const expandedChips = c.moreChips.has(s.id);
  const dimByPeriod = Boolean(c.searchPeriod && hits.size);
  /** @param {CatalogueRowMember} m */
  const chip = (m) => chipHtml(c, s, m, { hit: hits.has(m.id) && (c.query || c.here), out: !c.editionInYears(m.id) || (dimByPeriod && !hits.has(m.id)) });
  return items.map(({ m, todo: isTodo }) => (isTodo ? todoChipHtml(c, m) : chip(m))).join('')
    + localHitsOf(c, s, hit).map(chip).join('')
    + (todo.length ? `<button type="button" class="cn-chip cn-chip--todo-toggle" data-cn-todo="${esc(s.id)}" aria-pressed="${showTodo}">${icon(showTodo ? 'x' : 'plus')}${showTodo ? 'Hide' : 'Show'} ${todo.length} to be added</button>` : '')
    // With the maps to be added showing, every chip shows: nothing to fold away.
    + (showTodo ? ''
      : expandedChips
        ? `<button type="button" class="cn-chip cn-chip--more" data-cn-fewer="${esc(s.id)}" aria-expanded="true" aria-label="Hide the extra maps of ${esc(s.name)}">Hide</button>`
        : `<button type="button" class="cn-chip cn-chip--more" data-cn-more="${esc(s.id)}" aria-expanded="false" hidden>+0 more</button>`);
}

/** @param {CatalogueNext} c @param {CatalogueRowMember} m */
function todoChipHtml(c, m) {
  const tip = c.mapSummary(m.id);
  return `<span class="cn-chip cn-chip--todo" title="${esc(tip ? `${tip}: to be added` : 'To be added')}, not yet on the map"><span class="cn-chip__dot" aria-hidden="true"></span><span class="cn-chip__label">${esc(m.label)}</span></span>`;
}

/**
 * @param {CatalogueNext} c
 * @param {CatalogueRow} s
 * @param {CatalogueRowMember} m
 * @param {{ hit?: unknown, out?: boolean, label?: string }} [options]  hit: whatever marks the chip a match, tested for truth
 */
export function chipHtml(c, s, m, { hit = false, out = false, label = m.label } = {}) {
  const r = c.rec(m.id);
  const col = colourOf(c, s, m.id);
  const versions = s.members.filter((x) => x.of === m.id).length;
  const tip = [[c.mapSummary(m.id), r.status === 'incomplete' ? 'incomplete' : ''].filter(Boolean).join(' · '), r.note].filter(Boolean).join('\n');
  if (r.status === 'placeholder') {
    return `<span class="cn-chip cn-chip--todo" title="${esc(tip)}: to be added, not yet on the map"><span class="cn-chip__dot" aria-hidden="true"></span><span class="cn-chip__label">${esc(label)}</span></span>`;
  }
  return `<button type="button" class="cn-chip${hit ? ' cn-chip--hit' : ''}${out ? ' cn-chip--out' : ''}${r.status === 'incomplete' ? ' cn-chip--part' : ''}" data-cn-toggle="${esc(m.id)}" data-series="${esc(s.id)}" aria-pressed="false" aria-label="${esc(`${s.name}, ${label}`)}" title="${esc(tip)}" style="--c:${col};--on:${inkOn(col)}"><span class="cn-chip__dot" aria-hidden="true"></span>${icon('check', 'cn-icon cn-chip__check')}<span class="cn-chip__label">${esc(label)}</span>${versions ? `<span class="cn-chip__more" aria-hidden="true">+${versions}</span>` : ''}</button>`;
}

/**
 * What a row or an election is (data/catalogue/descriptions.json): its paragraphs, then its links.
 * @param {CatalogueAbout | undefined} about
 * @param {{ heading?: string }} [options]
 */
export function aboutHtml(about, { heading = '' } = {}) {
  if (!about?.text?.length) return '';
  const links = (about.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`);
  return `<div class="cn-about">${heading ? `<span class="cn-label">${esc(heading)}</span>` : ''}${about.text.map((p) => `<p>${esc(p)}</p>`).join('')}${links.length ? `<p class="cn-about__links">${links.join('<span aria-hidden="true"> · </span>')}</p>` : ''}</div>`;
}

/**
 * The opened row: what it is; for a row of several maps, its maps as a dated list (newest first),
 * each with its chip and tools, the chosen one opened for its facts, versions and parts; for a row
 * of one map, that map's facts, versions and parts. The map's timeline is the slider under the map
 * (Phelim Birch's notes, 19 Nov 2026: no second timeline in the row).
 * @param {CatalogueNext} c
 * @param {CatalogueRow} s
 */
export function panelHtml(c, s) {
  const sel = c.selectedMember(s);
  const list = datedList(s, (id) => c.rec(id));
  if (list.length > 1) return `${aboutHtml(s.about)}${datedListHtml(c, s, list, sel)}`;
  // A single map with no facts, versions, parts or council maps draws no empty block (its grid gap
  // left a band of empty space under the description: Phelim Birch, 19 Nov 2026).
  const edition = editionHtml(c, s, sel).trim();
  return `${aboutHtml(s.about)}${edition ? `<div class="cn-ed">${edition}</div>` : ''}`;
}

/**
 * What the chosen map of a row holds: its facts, its versions, its parts and council maps.
 * @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} sel
 */
function editionHtml(c, s, sel) {
  const r = c.rec(sel.id);
  // Descriptions are hidden until people write standard ones (Phelim Birch's review, 2026-10-06);
  // the text stays in the data.
  return `${factsHtml(c, sel, r)}
      ${r.status === 'placeholder' ? '<p class="cn-muted">Listed so you know it is coming: it cannot be drawn yet.</p>' : ''}
      ${versionsHtml(c, s, sel)}
      ${partsHtml(c, s, sel, r)}
      ${localHtml(c, s, sel)}`;
}

/**
 * A row's maps, one line each: the map's date, its chip (on and off the map), its tools, and a
 * button that opens its facts, versions and parts beneath it.
 * @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember[]} list @param {CatalogueRowMember} sel
 */
function datedListHtml(c, s, list, sel) {
  const chosen = sel.of || sel.id;
  return `<ul class="cn-dlist" aria-label="${esc(s.name)}: ${s.arrangement === 'editions' ? 'editions' : 'maps'}">${list.map((m) => {
    const r = c.rec(m.id);
    const when = r.date ? mapDate(r) : '';
    const open = m.id === chosen;
    const label = `${s.name}, ${m.label}`;
    const todo = r.status === 'placeholder';
    return `<li class="cn-dlist__item${open ? ' cn-dlist__item--open' : ''}" style="--c:${colourOf(c, s, m.id)}">
      <span class="cn-dlist__line">
        <span class="cn-dlist__when">${when && when !== m.label ? esc(when) : ''}</span>
        <span class="cn-dlist__chip">${chipHtml(c, s, m)}</span>
        <span class="cn-dlist__acts">${todo ? '<span class="cn-badge cn-badge--todo">To be added</span>' : mapToolsHtml(c, m.id, label, { small: true })}<button type="button" class="cn-iconbtn cn-iconbtn--sm cn-dlist__more" data-cn-select="${esc(s.id)}|${esc(m.id)}" aria-expanded="${open}" aria-label="${esc(m.label)}: facts, versions and parts" title="Facts, versions and parts">${icon('chevron-down')}</button></span>
      </span>
      ${open ? `<div class="cn-ed">${editionHtml(c, s, sel)}</div>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

/** @param {CatalogueNext} _c @param {CatalogueRowMember} _sel @param {CatalogueMapRec} r */
function factsHtml(_c, _sel, r) {
  // Each fact the record has, as [label, text].
  const rows = /** @type {Array<[string, string]>} */ ([
    r.date && ['Date', r.dateNote ? `${mapDate(r)} (${r.dateNote})` : mapDate(r)],
    r.licence && ['Licence', r.licence],
    r.status && r.status !== 'ready' && ['Status', r.status === 'placeholder' ? 'To be added: listed, not yet drawn' : 'Incomplete'],
    r.note && ['Note', r.note],
  ].filter(Boolean)).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`);
  if (r.orders?.length) {
    // Orders that took effect on the same terms are listed together, once.
    /** @type {Map<string, { purposes: Array<[string, string]>, made: string[] }>} */
    const groups = new Map();
    for (const o of r.orders) {
      const k = JSON.stringify(o.purposes || []);
      if (!groups.has(k)) groups.set(k, { purposes: o.purposes || [], made: [] });
      /** @type {{ made: string[] }} */ (groups.get(k)).made.push(`<b>${esc(o.divisions)}</b>, made ${esc(longDate(o.made))}`);
    }
    rows.splice(1, 0, `<dt>${r.orders.length > 1 ? 'Orders' : 'Order'}</dt><dd><ul class="cn-orders">${[...groups.values()].map((g) => `<li>${g.made.join('; ')}<ul>${g.purposes.map(([what, when]) => `<li>${esc(what)}: ${esc(when)}</li>`).join('')}</ul></li>`).join('')}</ul>${r.ordersSource ? `<span class="cn-orders__src">${esc(r.ordersSource)}</span>` : ''}</dd>`);
  }
  return rows.length ? `<dl class="cn-facts">${rows.join('')}</dl>` : '';
}

/** @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} sel */
function versionsHtml(c, s, sel) {
  const base = sel.of || sel.id;
  const all = s.members.filter((m) => m.id === base || m.of === base);
  if (all.length < 2) return '';
  return `<div class="cn-sub"><span class="cn-label">Versions</span><ul class="cn-vlist">${all.map((m) => {
    const label = m.of ? m.label : (m.version || `${m.label} (main)`);
    return `<li class="cn-vlist__item">${c.rec(m.id).status === 'placeholder'
      ? `<span class="cn-vlist__name">${esc(label)}</span><span class="cn-badge cn-badge--todo">To be added</span>`
      : itemHtml(c, chipHtml(c, s, m, { label }), m.id, `${s.name}, ${label}`)}</li>`;
  }).join('')}</ul></div>`;
}

/**
 * A series' council maps (one council's copy of a national map), beside the county maps.
 * @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} sel
 */
function localHtml(c, s, sel) {
  const base = sel ? sel.of || sel.id : null;
  const local = (s.local || []).filter((m) => !m.of || m.of === base);
  if (!local.length) return '';
  return `<div class="cn-sub"><span class="cn-label">Council maps · ${local.length}</span>
    <div class="cn-chips">${local.map((m) => localItemHtml(c, s, m)).join('')}</div></div>`;
}

/** @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} sel @param {CatalogueMapRec} r */
function partsHtml(c, s, sel, r) {
  return partsGroupHtml(c, s, sel, r) + countiesHtml(c, s, sel, r);
}

/**
 * The same map split by county (`counties`, from another map's county parts): one button each.
 * @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} sel @param {CatalogueMapRec} r
 */
function countiesHtml(c, s, sel, r) {
  if (!r.counties?.length) return '';
  const key = `${sel.id}:counties`;
  const shown = c.moreParts.has(key) ? r.counties : r.counties.slice(0, 12);
  const col = colourOf(c, s, sel.id);
  return `<div class="cn-sub"><span class="cn-label">By county · ${r.counties.length}</span>
    <div class="cn-chips">${shown.map((p) => itemHtml(c, `<button type="button" class="cn-chip" data-cn-toggle="${esc(p.id)}" aria-pressed="false" aria-label="${esc(`${s.name}: County ${p.label}`)}" title="${esc(`County ${p.label}`)}" style="--c:${col};--on:${inkOn(col)}"><span class="cn-chip__dot" aria-hidden="true"></span>${icon('check', 'cn-icon cn-chip__check')}<span class="cn-chip__label">${esc(p.label)}</span></button>`, p.id, `County ${p.label}`)).join('')}
    ${r.counties.length > shown.length ? `<button type="button" class="cn-chip cn-chip--more" data-cn-more-parts="${esc(key)}">+${r.counties.length - shown.length} more</button>` : ''}</div></div>`;
}

/** A council map: its chip and tools. @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} m */
function localItemHtml(c, s, m) {
  const label = `${s.name}, ${m.label}`;
  return itemHtml(c, chipHtml(c, s, m), m.id, label);
}

/**
 * One version, part, county map or council map: its chip, then its own Zoom, Download and Details,
 * each where it applies.
 * @param {CatalogueNext} c @param {string} chip @param {string} id @param {string} label
 */
function itemHtml(c, chip, id, label) {
  const tools = mapToolsHtml(c, id, label, { small: true });
  return tools ? `<span class="cn-item">${chip}${tools}</span>` : chip;
}

/** @param {CatalogueNext} c @param {CatalogueRow} s @param {CatalogueRowMember} sel @param {CatalogueMapRec} r */
function partsGroupHtml(c, s, sel, r) {
  if (!r.parts?.length) return '';
  const all = c.moreParts.has(sel.id);
  const shown = all ? r.parts : r.parts.slice(0, 12);
  const col = colourOf(c, s, sel.id);
  return `<div class="cn-sub"><span class="cn-label">Parts · ${r.parts.length}</span>
    <div class="cn-chips">${shown.map((p) => itemHtml(c, `<button type="button" class="cn-chip" data-cn-toggle="${esc(p.id)}" aria-pressed="false" aria-label="${esc(`${r.name || sel.label}: ${p.label}`)}" title="${esc(p.label)}" style="--c:${col};--on:${inkOn(col)}"><span class="cn-chip__dot" aria-hidden="true"></span>${icon('check', 'cn-icon cn-chip__check')}<span class="cn-chip__label">${esc(p.label)}</span></button>`, p.id, p.label)).join('')}
    ${r.parts.length > shown.length ? `<button type="button" class="cn-chip cn-chip--more" data-cn-more-parts="${esc(sel.id)}">+${r.parts.length - shown.length} more</button>` : ''}</div>
    ${r.parts.length > 1 ? `<div><button type="button" class="cn-link" data-cn-act="add-parts" data-map="${esc(sel.id)}">Add all ${r.parts.length} parts</button></div>` : ''}</div>`;
}

/* ---------------------------------------------------------------- search: places and people */

/**
 * What a search finds besides maps: places (Maps only), people, and parties.
 * @param {CatalogueNext} c
 * @param {{ places?: boolean }} [options]
 */
export function extrasHtml(c, { places = true } = {}) {
  const x = c.extras;
  const addresses = places ? addressesHtml(c) : '';
  if (!x) return addresses;
  if (x.loading) return `${addresses}<p class="cn-summary" role="status">Looking for ${places ? 'places and ' : ''}people…</p>`;
  return `${addresses}${places && x.places?.length ? placesHtml(c, x.places) : ''}${x.persons?.length ? personsHtml(c, x.persons) : ''}${x.people?.length ? peopleHtml(c, x.people) : ''}`;
}

// Who to credit for each source of address results (their terms ask for it).
/** @type {Record<string, string>} */
const ADDRESS_CREDIT = {
  photon: 'Addresses © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, found by <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>',
  nominatim: 'Addresses © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, found by <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a>',
  'postcodes.io': 'Postcode from <a href="https://postcodes.io" target="_blank" rel="noopener">postcodes.io</a> (ONS, Royal Mail and OS data © Crown copyright and database right)',
};

/** Addresses and postcodes for the query (index.js loadAddresses), with their credit; or, while
 * suggestions are paused, the note that Enter searches.
 * @param {CatalogueNext} c */
function addressesHtml(c) {
  const a = c.addresses;
  if (!a) return '';
  const note = a.paused && !a.searched
    ? '<p class="cn-address-note" role="status">Address suggestions paused — press Enter to search addresses.</p>'
    : '';
  if (a.loading) return `${note}<p class="cn-summary cn-address-loading" role="status">Looking for addresses…</p>`;
  if (!a.results?.length) {
    if (a.searched) return `<p class="cn-address-note" role="status">${a.failed ? 'The address search did not answer. Try again in a moment.' : `No address in Ireland matches “${esc(a.query)}”.`}</p>`;
    return note;
  }
  return `${note}<section class="cn-block cn-block--addresses" aria-labelledby="cn-addresses-h">
    <h3 class="cn-block__head" id="cn-addresses-h">${icon('map-pin')}<span>Addresses</span><span class="cn-count">${a.results.length}</span></h3>
    <ul class="cn-addresses">${a.results.map((r, i) => `<li><button type="button" class="cn-address" data-cn-address="${i}">${icon('map-pin')}<span class="cn-address__main"><span class="cn-address__name">${esc(r.name)}</span>${r.detail ? `<span class="cn-muted">${esc(r.detail)}</span>` : ''}</span></button></li>`).join('')}</ul>
    <p class="cn-address-credit">${ADDRESS_CREDIT[/** @type {string} */ (a.source)] || ADDRESS_CREDIT.photon}</p>
  </section>`;
}

/** Everyone who stood, by name: their main party and constituency, years, contests and wins, a
 * link to their page, and the elections they stood in, here in the Elections tab.
 * @param {CatalogueNext} c @param {Array<{ row: PersonRow }>} results */
function personsHtml(c, results) {
  const limit = c.limits.persons ? results.length : 6;
  // People were found, so the people index is loaded.
  const { parties, constituencies } = /** @type {CataloguePeopleDoc} */ (c.peopleDoc);
  return `<section class="cn-block" aria-labelledby="cn-persons-h">
    <h3 class="cn-block__head" id="cn-persons-h">${icon('user')}<span>People</span><span class="cn-count">${results.length >= 200 ? '200+' : results.length}</span></h3>
    <ul class="cn-people">${results.slice(0, limit).map(({ row }) => {
      const years = row[4] === row[5] ? String(row[4]) : `${row[4]}–${row[5]}`;
      const meta = [parties[row[2]], constituencies[row[3]], years, `${plural(row[6], 'contest')}, ${row[7]} won`].filter(Boolean);
      return `<li class="cn-person cn-person--row">${icon('user')}<span class="cn-person__main"><a class="cn-person__name" href="${esc(PeopleSearch.url(row))}" data-cn-open-page="candidate:${esc(PeopleSearch.slug(row))}">${esc(row[1])}</a><span class="cn-muted">${esc(meta.join(' · '))}</span></span>
        <button type="button" class="cn-btn cn-btn--small" data-cn-person="${esc(row[0])}" aria-label="Elections ${esc(row[1])} stood in">${icon('vote')}<span>Elections</span></button></li>`;
    }).join('')}</ul>
    ${results.length > limit ? `<button type="button" class="cn-link" data-cn-act="show-all" data-what="persons">Show ${results.length >= 200 ? 'the first 200' : `all ${results.length}`}</button>` : ''}
  </section>`;
}

/** @param {CatalogueNext} c @param {CatalogueSearchRecord} record */
function placeThumb(c, record) {
  const t = record.featureThumbnail;
  if (t?.url) return `<img src="${esc(t.url)}" alt="" loading="lazy" decoding="async">`;
  if (t?.bbox && c.ui._buildFeatureLocatorSvg) return c.ui._buildFeatureLocatorSvg(t.bbox, t.colour);
  return icon('map-pin');
}

/** What kind of geography a place's map is: "2012 Ward", "1993 District Electoral Area". The year
 * is the one the map is known by (its name: Wards 2012), else its date's.
 * @param {CatalogueNext} c @param {CatalogueSearchRecord} record */
function placeKind(c, record) {
  // A place's record is a feature of a map, so it names its map.
  const r = c.rec(/** @type {string} */ (record.mapId)) || {};
  const name = r.name || record.subtitle || '';
  const year = yearOf(name) || yearOf(r.date);
  // The map's own unit, else its series', else what its name calls the areas, less any date.
  const s = c.seriesById?.get(/** @type {string} */ (c.seriesOfMap?.get(/** @type {string} */ (record.mapId))));
  const what = r.unit || s?.unit
    || name.replace(/\s*\([^)]*\)/g, '').replace(/\b\d{1,2} [A-Z][a-z]{2} \d{4}\b|\b\d{4}\b/g, '').replace(/\s{2,}/g, ' ').trim();
  return [year, what ? unitWord(what, 1) : ''].filter(Boolean).join(' ') || name;
}

/** @param {CatalogueNext} c @param {PlaceGroup[]} groups */
function placesHtml(c, groups) {
  const all = Boolean(c.limits.places);
  const limit = all ? groups.length : 5;
  const toggle = groups.length > 5
    ? `<button type="button" class="cn-link cn-block__toggle" data-cn-act="toggle-all" data-what="places" aria-expanded="${all}">${all ? 'Hide' : `Show all ${groups.length}`}</button>`
    : '';
  return `<section class="cn-block cn-block--places" aria-labelledby="cn-places-h">
    <h3 class="cn-block__head cn-block__head--sticky" id="cn-places-h">${icon('map-pin')}<span>Places</span><span class="cn-count">${groups.length}</span>${toggle}</h3>
    <ul class="cn-places">${groups.slice(0, limit).map((g) => {
      const kinds = [...new Set(g.items.map(({ record }) => placeKind(c, record)))];
      const kind = kinds.length > 2 ? `${kinds.slice(0, 2).join(', ')} +${kinds.length - 2}` : kinds.join(', ');
      return `<li class="cn-place"><details${groups.length === 1 ? ' open' : ''}>
      <summary><span class="cn-place__thumb">${placeThumb(c, g.items[0].record)}</span><span class="cn-place__name">${esc(g.name)}</span><span class="cn-place__kind">${esc(kind)}</span>${icon('chevron-down', 'cn-icon cn-place__chev')}</summary>
      <ul class="cn-place__list">${g.items.map(({ record }) => `<li class="cn-place__item">
        <span class="cn-place__thumb">${placeThumb(c, record)}</span>
        <button type="button" class="cn-link cn-place__map" data-catalogue-search-action="open-feature-detail" data-map-id="${esc(record.mapId)}" data-feature-id="${esc(record.featureId || record.id)}" data-feature-name="${esc(record.title)}" data-feature-bbox="${esc((record.bbox || []).join(','))}">${esc(record.subtitle || record.mapId)}</button>
        <span class="cn-place__kind">${esc(placeKind(c, record))}</span>
        ${c.ui.renderCatalogueSearchActionStrip ? c.ui.renderCatalogueSearchActionStrip(record) : ''}
      </li>`).join('')}</ul></details></li>`;
    }).join('')}</ul>
  </section>`;
}

/** @param {CatalogueNext} c @param {CatalogueSearchRecord[]} records */
function peopleHtml(c, records) {
  const limit = c.limits.people ? records.length : 5;
  /** @type {Record<string, string>} */
  const ic = { person: 'user', party: 'flag', source: 'file-text' };
  const kinds = [['person', 'People'], ['party', 'Parties'], ['source', 'Sources']].filter(([t]) => records.some((r) => r.type === t)).map(([, l]) => l);
  const heading = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1].toLowerCase()}` : kinds[0] || 'People';
  return `<section class="cn-block" aria-labelledby="cn-people-h">
    <h3 class="cn-block__head" id="cn-people-h">${icon(records[0]?.type === 'party' ? 'flag' : 'user')}<span>${esc(heading)}</span><span class="cn-count">${records.length}</span></h3>
    <ul class="cn-people">${records.slice(0, limit).map((r) => {
      // A party or person opens its page in the pane; a source still goes to Browse.
      const page = (r.type === 'party' || r.type === 'person') && r.slug ? ` data-cn-open-page="${r.type === 'party' ? 'party' : 'candidate'}:${esc(r.slug)}"` : '';
      return `<li class="cn-person">${icon(ic[r.type] || 'file-text')}<a class="cn-person__name" href="${esc(r.url)}"${page}>${esc(r.title)}</a><span class="cn-muted">${esc([r.typeLabel, r.subtitle].filter(Boolean).join(' · '))}</span></li>`;
    }).join('')}</ul>
    ${records.length > limit ? `<button type="button" class="cn-link" data-cn-act="show-all" data-what="people">Show all ${records.length}</button>` : ''}
  </section>`;
}

/* ---------------------------------------------------------------- what's here */

/** @param {CatalogueNext} c */
function hereHtml(c) {
  // Drawn only while a point is chosen.
  const { lng, lat } = /** @type {LngLat} */ (c.here);
  const hit = c.hereResult();
  /** @type {Map<string, Array<{ s: CatalogueRow, members: string[] }>>} */
  const shelves = new Map();
  for (const { s, members } of hit.series) {
    if (!shelves.has(s.shelf)) shelves.set(s.shelf, []);
    /** @type {Array<{ s: CatalogueRow, members: string[] }>} */ (shelves.get(s.shelf)).push({ s, members });
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
