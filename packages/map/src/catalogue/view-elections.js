/**
 * The Elections section: filter by kind, place and years; every election as a row that opens it
 * on the map in one click, on one collapsible shelf per body (Dáil, Westminster, ...), as the map
 * sections are laid out (Phelim Birch's review, 2026-10-11). Rendering only; `c` is the controller.
 */
import { icon } from './icons.js';
import { ELECTION_SHELF_COLOURS } from '../colours.mjs';
import { esc, plural, shortDate, ESCOPE_SHORT } from './util.js';
import { sliderHtml } from './slider.js';
import { extrasHtml, aboutHtml } from './view-maps.js';
import { PeopleSearch } from './search.js';
import electionBodies from '../../../registries/src/browser/election-bodies.mjs';
import electionGroups from '../../../registries/src/browser/election-groups.mjs';
import { siteNumber } from '../../../core/src/format.js';
/** @typedef {import('./index.js').CatalogueNext} CatalogueNext */
/** @typedef {import('./catalogue-types.d.ts').CatalogueRowElection} CatalogueRowElection */
/** A shelf of elections (BODY_GROUPS). @typedef {{ id: string, label: string, bodies: string[], icon: string, colour: string }} BodyGroup */

// Browse's slug for an election: its key lower-cased, runs of other characters as '-'
// (dail-eireann__2024-11-29 -> dail-eireann-2024-11-29). Browse routes live in the hash.
/** @param {string} key */
const browseSlug = (key) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** What a row calls each body: short, and the same everywhere. */
/** @type {Record<string, string>} */
export const BODY_SHORT = {
  'dail-eireann': 'Dáil',
  'house-of-commons-of-the-united-kingdom': 'Westminster',
  'northern-ireland-assembly': 'NI Assembly',
  'parliament-of-northern-ireland': 'NI Parliament',
  // Filed a council each under one slug, so not one body the election-bodies registry can name.
  'local-government': 'NI local',
  // The pre-1973 council rounds, one entry a year (packages/map/src/ni-local-groups.mjs).
  'ni-local-elections': 'NI local',
  // Before 1921, the island's council elections of the year ("1911 Irish local elections").
  'irish-local-elections': 'Irish local',
  'european-parliament': 'European (NI)',
  'ireland-referendum': 'Referendum',
  'ireland-european': 'European (Ireland)',
  'ireland-president': 'Presidential',
  'northern-ireland-constitutional-convention': 'NI Convention',
  'northern-ireland-forum-for-political-dialogue': 'NI Forum',
  'northern-ireland-referendum': 'Referendum (NI)',
  // The bodies the election-bodies registry describes (data/registries/election-bodies.json): the
  // Mayor of Limerick and the Irish local elections (ireland-local).
  ...Object.fromEntries(Object.entries(/** @type {Record<string, { shortLabel?: string }>} */ (electionBodies)).filter(([, b]) => b.shortLabel).map(([id, b]) => [id, b.shortLabel])),
};
/** @param {CatalogueRowElection} e */
export const bodyShort = (e) => BODY_SHORT[e.bodySlug] || e.body;

/** The shelves: the four Northern Ireland devolved bodies share one, as do the two European
 * Parliament constituencies and the two referendum series. They are the election-bodies registry's
 * catalogueShelves (data/registries/election-bodies.json groups), each with every body on it: the
 * NI local shelf takes the pre-1973 councils (the councils registry's pre1973Council flag), and a
 * body the registry puts on a shelf joins it (the Mayor of Limerick, beside the Irish local
 * elections of the same day). */
export const BODY_GROUPS = electionGroups.shelves.map(({ id, label, bodies, icon }) => ({
  id, label, bodies: [...bodies], icon, colour: ELECTION_SHELF_COLOURS[/** @type {keyof typeof ELECTION_SHELF_COLOURS} */ (id)],
}));
/** @param {string} slug */
export const groupOfBody = (slug) => BODY_GROUPS.find((g) => g.bodies.includes(slug))?.id || '';

/** @param {CatalogueNext} c */
export function toolbarHtml(c) {
  const f = c.efilters;
  /** @param {'ekind' | 'escope'} group @param {string} value @param {string} label @param {number} [count] */
  const chip = (group, value, label, count) => `<button type="button" class="cn-fchip" data-cn-filter="${group}" data-value="${esc(value)}" aria-pressed="${String(f[group] === value)}">${esc(label)}${count !== undefined ? ` <span class="cn-count">${siteNumber(count)}</span>` : ''}</button>`;
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

/** @param {CatalogueNext} c */
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
  const body = shelves.map(({ g, es }) => shelfHtml(c, g, es, shelves.length === 1)).join('');
  // A search that names a body or a year ("Dáil 2020") wants the election: parties and people
  // that share a word follow it instead of pushing it down.
  return c.electionsFirst ? `${banner}${summary}${body}${extras}` : `${extras}${banner}${summary}${body}`;
}

/** Elections on their body's shelf, in BODY_GROUPS' order, newest first, as the list and the
 * contents menu both show them. */
/** @param {CatalogueRowElection[]} list */
export function shelvesOf(list) {
  return BODY_GROUPS.map((g) => ({ g, es: list.filter((e) => g.bodies.includes(e.bodySlug)) })).filter((x) => x.es.length);
}

/** @param {CatalogueNext} c @param {BodyGroup} g @param {CatalogueRowElection[]} es @param {boolean} alone */
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

/** Above a person's elections: who, how many, how many won, their page, and the way back. The
 * counts are of the elections listed, and say how many the filters hide (UX review 2026-10-31, M6:
 * the banner said 25 where search said 26, with nothing to say the by-election was filtered out). */
/** @param {CatalogueNext} c */
function personBannerHtml(c) {
  // The banner is drawn only for a person.
  const p = /** @type {import('./index.js').CataloguePerson} */ (c.person);
  const shown = c.visibleElections().filter((e) => p.contests.has(e.key));
  const won = shown.filter((e) => p.contests.get(e.key)?.won).length;
  const hidden = p.contests.size - shown.length;
  const hiddenBy = [...p.contests.keys()].filter((key) => !shown.some((e) => e.key === key) && c.electionByKey?.get(key)?.kind === 'by-election').length;
  const hiddenNote = hidden
    ? ` (${hiddenBy === hidden ? plural(hidden, 'by-election') : plural(hidden, 'election')} hidden by the filters)`
    : '';
  return `<div class="cn-person-banner" role="status">${icon('user')}
    <span><strong>${esc(p.name)}</strong> stood in ${plural(shown.length, c.efilters.ekind === 'general' ? 'general election' : 'election')} here and won ${won}${hiddenNote}.
    <a href="${esc(PeopleSearch.url(p.row))}" data-cn-open-page="candidate:${esc(PeopleSearch.slug(p.row))}">Their page</a></span>
    <button type="button" class="cn-btn cn-btn--small" data-cn-act="clear-person">${icon('x')}<span>All elections</span></button>
  </div>`;
}

/** @param {CatalogueRowElection} e */
function seatsText(e) {
  if (e.subtitle) return e.subtitle;
  if (!e.seats) return '';
  return plural(e.seats, e.contestType === 'referendum' ? 'count area' : 'constituency', e.contestType === 'referendum' ? 'count areas' : 'constituencies');
}

// What the description is about, in the title's own terms: "About these elections" for the
// Republic's local elections (one title for every council), "About this referendum", and so on.
/** @param {CatalogueRowElection} e */
function aboutLabel(e) {
  const title = String(e.title || '');
  if (/\bplebiscite\b/i.test(title)) return 'About this plebiscite';
  if (/\breferendum\b/i.test(title) || e.contestType === 'referendum') return 'About this referendum';
  if (/\brecall petition\b/i.test(title)) return 'About this recall petition';
  if (/\belections\b/i.test(title)) return 'About these elections';
  return 'About this election';
}

/** @param {CatalogueNext} c @param {CatalogueRowElection} e */
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
      <a class="cn-iconbtn" href="/browse/elections/${encodeURIComponent(browseSlug(e.key))}" aria-label="${esc(e.title)}: results page" title="Results page: candidates, votes and sources">${icon('file-text')}</a>
      <button type="button" class="cn-add" data-cn-election-toggle="${esc(e.key)}" aria-pressed="false" aria-label="${esc(e.title)}: open on the map">${icon('plus', 'cn-icon cn-when-off')}${icon('check', 'cn-icon cn-when-on')}<span class="cn-when-off">Open</span><span class="cn-when-on">On map</span></button>
    </span>
    ${e.about ? `<details class="cn-erow__about"><summary>${esc(aboutLabel(e))}</summary>${aboutHtml(e.about)}</details>` : ''}
  </li>`;
}
