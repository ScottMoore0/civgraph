/**
 * The Elections section: filter by kind, place and years; every election as a row that opens it
 * on the map in one click, on one collapsible shelf per body (Dáil, Westminster, ...), as the map
 * sections are laid out (Phelim Birch's review, 2026-10-11). Rendering only; `c` is the controller.
 */
import { icon } from './icons.js';
import { esc, plural, shortDate, ESCOPE_SHORT } from './util.js';
import { sliderHtml } from './slider.js';
import { extrasHtml } from './view-maps.js';
import { PeopleSearch } from './search.js';

// Browse's slug for an election: its key lower-cased, runs of other characters as '-'
// (dail-eireann__2024-11-29 -> dail-eireann-2024-11-29). Browse routes live in the hash.
const browseSlug = (key) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** What a row calls each body: short, and the same everywhere. */
export const BODY_SHORT = {
  'dail-eireann': 'Dáil',
  'house-of-commons-of-the-united-kingdom': 'Westminster',
  'northern-ireland-assembly': 'NI Assembly',
  'parliament-of-northern-ireland': 'NI Parliament',
  'local-government': 'NI local',
  'european-parliament': 'European (NI)',
  'ireland-referendum': 'Referendum',
  'ireland-local': 'Irish local',
  'ireland-european': 'European (Ireland)',
  'ireland-president': 'Presidential',
  'northern-ireland-constitutional-convention': 'NI Convention',
  'northern-ireland-forum-for-political-dialogue': 'NI Forum',
  'northern-ireland-referendum': 'Referendum (NI)',
};
export const bodyShort = (e) => BODY_SHORT[e.bodySlug] || e.body;

/** The shelves: the four Northern Ireland devolved bodies share one, as do the two European
 * Parliament constituencies and the two referendum series. */
export const BODY_GROUPS = [
  { id: 'dail', label: 'Dáil', bodies: ['dail-eireann'], icon: 'landmark', colour: '#169b62' },
  { id: 'westminster', label: 'Westminster', bodies: ['house-of-commons-of-the-united-kingdom'], icon: 'landmark', colour: '#2f5da8' },
  { id: 'ni-devolved', label: 'NI Devolved', bodies: ['northern-ireland-assembly', 'parliament-of-northern-ireland', 'northern-ireland-constitutional-convention', 'northern-ireland-forum-for-political-dialogue'], icon: 'landmark', colour: '#c84b8f' },
  { id: 'ni-local', label: 'NI local', bodies: ['local-government'], icon: 'building', colour: '#e07b2a' },
  { id: 'irish-local', label: 'Irish local', bodies: ['ireland-local'], icon: 'building', colour: '#0b8a6a' },
  { id: 'european', label: 'European', bodies: ['european-parliament', 'ireland-european'], icon: 'flag', colour: '#2f8fce' },
  { id: 'referendum', label: 'Referendum', bodies: ['ireland-referendum', 'northern-ireland-referendum'], icon: 'vote', colour: '#8a63d2' },
  { id: 'presidential', label: 'Presidential', bodies: ['ireland-president'], icon: 'user', colour: '#c08a3e' },
];
export const groupOfBody = (slug) => BODY_GROUPS.find((g) => g.bodies.includes(slug))?.id || '';

export function toolbarHtml(c) {
  const f = c.efilters;
  const chip = (group, value, label, count) => `<button type="button" class="cn-fchip" data-cn-filter="${group}" data-value="${esc(value)}" aria-pressed="${String(f[group] === value)}">${esc(label)}${count !== undefined ? ` <span class="cn-count">${count.toLocaleString('en-GB')}</span>` : ''}</button>`;
  const { i, j } = c.yearRange('elections');
  const active = c.activeFilterCount('elections');
  return `<div class="cn-toolbar" data-cn-toolbar="elections"${c.filtersOpen ? ' data-open' : ''}>
    <button type="button" class="cn-filters-toggle" data-cn-act="filters" aria-expanded="${c.filtersOpen}">${icon('sliders')}Filters${active ? ` <span class="cn-badge">${active}</span>` : ''}</button>
    <div class="cn-filters">
      <div class="cn-frow">
        <span class="cn-fgroup" role="group" aria-label="Kind"><span class="cn-label">Kind</span>${chip('ekind', 'general', 'General elections')}${chip('ekind', 'by-election', 'By-elections')}${chip('ekind', '', 'All')}</span>
        <span class="cn-fgroup" role="group" aria-label="Where"><span class="cn-label">Where</span>${chip('escope', 'Northern Ireland', ESCOPE_SHORT['Northern Ireland'])}${chip('escope', 'Republic of Ireland', ESCOPE_SHORT['Republic of Ireland'])}${chip('escope', 'Ireland', ESCOPE_SHORT.Ireland)}</span>
      </div>
      ${sliderHtml('elections', c.electionBins, i, j, c.yearState('elections'))}
    </div>
  </div>`;
}

export function resultsHtml(c) {
  const list = c.visibleElections();
  const extras = `<div data-cn-extras>${c.query ? extrasHtml(c, { places: false }) : ''}</div>`;
  const banner = c.person ? personBannerHtml(c) : '';
  // General elections are the default; say how many by-elections that leaves out, and offer them.
  const byHidden = c.efilters.ekind === 'general' && !c.person ? c.byElectionsHidden() : 0;
  const showBy = byHidden ? ` <button type="button" class="cn-link" data-cn-filter="ekind" data-value="">Show ${plural(byHidden, 'by-election')} too</button>` : '';
  if (!list.length) {
    return `${extras}${banner}<p class="cn-empty" role="status">${c.query ? `No general elections match “${esc(c.query)}”` : 'No elections match these filters'}.${showBy}
      ${c.activeFilterCount('elections') ? ' <button type="button" class="cn-link" data-cn-act="clear-filters">Clear the filters</button>' : ''}${c.otherTabHint()}</p>`;
  }
  const summary = c.person ? '' : `<p class="cn-summary" role="status">${plural(list.length, c.efilters.ekind === 'general' ? 'general election' : c.efilters.ekind === 'by-election' ? 'by-election' : 'election')}${c.query ? ` match “${esc(c.query)}”` : ''}${c.activeFilterCount('elections') ? ', filtered' : ''}. Open one to draw it on the map with its results.${showBy}</p>`;
  const shelves = shelvesOf(list);
  return `${extras}${banner}${summary}${shelves.map(({ g, es }) => shelfHtml(c, g, es, shelves.length === 1)).join('')}`;
}

/** Elections on their body's shelf, in BODY_GROUPS' order, newest first, as the list and the
 * contents menu both show them. */
export function shelvesOf(list) {
  return BODY_GROUPS.map((g) => ({ g, es: list.filter((e) => g.bodies.includes(e.bodySlug)) })).filter((x) => x.es.length);
}

function shelfHtml(c, g, es, alone) {
  const id = `e-${g.id}`;
  const open = c.opened.has(id) || Boolean(c.query) || Boolean(c.person) || alone;
  return `<section class="cn-shelf" id="cn-shelf-${id}" data-cn-section="${id}" style="--shelf:${g.colour}" aria-labelledby="cn-shelf-h-${id}">
    <h3 class="cn-shelf__head" id="cn-shelf-h-${id}"><button type="button" class="cn-shelf__toggle" data-cn-shelf="${id}" aria-expanded="${open}">
      <span class="cn-shelf__icon">${icon(g.icon)}</span><span class="cn-shelf__name">${esc(g.label)}</span><span class="cn-count">${plural(es.length, 'election')}</span>${icon('chevron-down', 'cn-icon cn-shelf__chev')}</button></h3>
    <div class="cn-shelf__body"${open ? '' : ' hidden'}>
      <ul class="cn-list" role="list">${es.map((e) => rowHtml(c, e)).join('')}</ul>
    </div>
  </section>`;
}

/** Above a person's elections: who, how many, how many won, their page, and the way back. */
function personBannerHtml(c) {
  const p = c.person;
  const won = [...p.contests.values()].filter((x) => x.won).length;
  return `<div class="cn-person-banner" role="status">${icon('user')}
    <span><strong>${esc(p.name)}</strong> stood in ${plural(p.contests.size, 'election')} here and won ${won}.
    <a href="${esc(PeopleSearch.url(p.row))}">Their page</a></span>
    <button type="button" class="cn-btn cn-btn--small" data-cn-act="clear-person">${icon('x')}<span>All elections</span></button>
  </div>`;
}

function seatsText(e) {
  if (e.subtitle) return e.subtitle;
  if (!e.seats) return '';
  return plural(e.seats, e.contestType === 'referendum' ? 'count area' : 'constituency', e.contestType === 'referendum' ? 'count areas' : 'constituencies');
}

export function rowHtml(c, e) {
  const note = c.electionHits?.get(e.key);
  const stood = c.person?.contests.get(e.key);
  const meta = [
    `<span class="cn-badge">${esc(bodyShort(e))}</span>`,
    seatsText(e) && `<span>${esc(seatsText(e))}</span>`,
    e.kind === 'by-election' && '<span class="cn-badge">By-election</span>',
    e.mapless && '<span class="cn-badge" title="No map of these constituencies yet: opens the results">Results only</span>',
    note && `<span>${esc(note)}</span>`,
    stood && `<span class="cn-person-note">${esc([stood.place, stood.party].filter(Boolean).join(' · '))}${stood.place || stood.party ? ' · ' : ''}<strong>${stood.won ? 'Elected' : 'Not elected'}</strong></span>`,
  ].filter(Boolean);
  return `<li class="cn-erow" data-cn-election="${esc(e.key)}">
    <span class="cn-erow__thumb">${c.thumb(e.thumb)}</span>
    <span class="cn-erow__date">${esc(shortDate(e.date))}</span>
    <span class="cn-erow__main"><span class="cn-erow__title">${esc(e.title)}</span><span class="cn-erow__meta">${meta.join('')}</span></span>
    <span class="cn-erow__end">
      <a class="cn-iconbtn" href="/browse/#/elections/${encodeURIComponent(browseSlug(e.key))}" aria-label="${esc(e.title)}: results page" title="Results page: candidates, votes and sources">${icon('file-text')}</a>
      <button type="button" class="cn-add" data-cn-election-toggle="${esc(e.key)}" aria-pressed="false" aria-label="${esc(e.title)}: open on the map">${icon('plus', 'cn-icon cn-when-off')}${icon('check', 'cn-icon cn-when-on')}<span class="cn-when-off">Open</span><span class="cn-when-on">On map</span></button>
    </span>
  </li>`;
}
