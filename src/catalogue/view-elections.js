/**
 * The Elections section: filter by kind, place and years; every election as a row that opens it
 * on the map in one click, on one collapsible shelf per body (Dáil, Westminster, ...), as the map
 * sections are laid out (Phelim Birch's review, 2026-10-11). Rendering only; `c` is the controller.
 */
import { icon } from './icons.js';
import { esc, plural, shortDate, ESCOPE_SHORT } from './util.js';
import { sliderHtml } from './slider.js';
import { extrasHtml, aboutHtml } from './view-maps.js';
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
  // The pre-1973 council rounds, one entry a year (src/ni-local-groups.mjs).
  'ni-local-elections': 'NI local',
  // Before 1921, the island's council elections of the year ("1911 Irish local elections").
  'irish-local-elections': 'Irish local',
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
  { id: 'dail', label: 'Dáil', bodies: ['dail-eireann'], icon: 'dail', colour: '#169b62' },
  { id: 'westminster', label: 'Westminster', bodies: ['house-of-commons-of-the-united-kingdom'], icon: 'westminster', colour: '#2f5da8' },
  { id: 'ni-devolved', label: 'NI Devolved', bodies: ['northern-ireland-assembly', 'parliament-of-northern-ireland', 'northern-ireland-constitutional-convention', 'northern-ireland-forum-for-political-dialogue'], icon: 'ni-devolved', colour: '#c84b8f' },
  { id: 'ni-local', label: 'NI local', bodies: ['local-government', 'ni-local-elections', 'belfast-county-borough-council', 'belfast-county-borough-council-aldermen', 'strabane-urban-district-council', 'londonderry-county-borough-council', 'armagh-county-council', 'armagh-urban-district-council', 'keady-urban-district-council', 'lurgan-borough-council', 'lurgan-rural-district-council', 'portadown-borough-council', 'armagh-rural-district-council', 'newry-no-2-rural-district-council', 'tandragee-rural-district-council', 'moira-rural-district-council', 'aghalee-rural-district-council', 'tandragee-urban-district-council', 'castleblayney-no-2-rural-district-council', 'londonderry-county-borough-council-aldermen', 'antrim-town-commissioners', 'aughnacloy-town-commissioners', 'ballycastle-urban-district-council', 'ballyclare-urban-district-council', 'ballymena-borough-council', 'ballymoney-urban-district-council', 'banbridge-urban-district-council', 'bangor-borough-council', 'carrickfergus-borough-council', 'coleraine-borough-council', 'cookstown-urban-district-council', 'donaghadee-urban-district-council', 'downpatrick-urban-district-council', 'dromore-urban-district-council', 'dungannon-urban-district-council', 'enniskillen-borough-council', 'enniskillen-borough-council-aldermen', 'gilford-town-commissioners', 'holywood-urban-district-council', 'kilkeel-urban-district-council', 'larne-borough-council', 'limavady-urban-district-council', 'lisburn-borough-council', 'newcastle-urban-district-council', 'newry-urban-district-council', 'newtownabbey-urban-district-council', 'newtownards-borough-council', 'omagh-urban-district-council', 'portrush-urban-district-council', 'portstewart-urban-district-council', 'warrenpoint-urban-district-council', 'whitehead-urban-district-council', 'antrim-county-council', 'down-county-council', 'fermanagh-county-council', 'londonderry-county-council', 'tyrone-county-council', 'antrim-rural-district-council', 'ballycastle-rural-district-council', 'ballymena-rural-district-council', 'ballymoney-rural-district-council', 'banbridge-rural-district-council', 'belfast-rural-district-council', 'castlederg-rural-district-council', 'castlereagh-rural-district-council', 'clogher-rural-district-council', 'coleraine-rural-district-council', 'cookstown-rural-district-council', 'dungannon-rural-district-council', 'east-down-rural-district-council', 'enniskillen-rural-district-council', 'hillsborough-rural-district-council', 'irvinestown-rural-district-council', 'larne-rural-district-council', 'limavady-rural-district-council', 'lisburn-rural-district-council', 'lisnaskea-rural-district-council', 'londonderry-rural-district-council', 'magherafelt-rural-district-council', 'newry-no-1-rural-district-council', 'north-down-rural-district-council', 'omagh-rural-district-council', 'south-down-rural-district-council', 'strabane-rural-district-council'], icon: 'ni-local', colour: '#e07b2a' },
  { id: 'irish-local', label: 'Irish local', bodies: ['ireland-local'], icon: 'irish-local', colour: '#0b8a6a' },
  // Before partition the councils were elected so differently, and so often, that their years
  // have a shelf of their own (Phelim Birch's review, 11 Nov 2026).
  { id: 'pre-partition-local', label: 'Pre-partition local', bodies: ['irish-local-elections'], icon: 'irish-local', colour: '#7a8597' },
  { id: 'european', label: 'European', bodies: ['european-parliament', 'ireland-european'], icon: 'european', colour: '#2f8fce' },
  { id: 'referendum', label: 'Referendum', bodies: ['ireland-referendum', 'northern-ireland-referendum'], icon: 'referendum', colour: '#8a63d2' },
  { id: 'presidential', label: 'Presidential', bodies: ['ireland-president'], icon: 'presidential', colour: '#c08a3e' },
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
  const body = shelves.map(({ g, es }) => shelfHtml(c, g, es, shelves.length === 1)).join('');
  // A search that names a body or a year ("Dáil 2020") wants the election: parties and people
  // that share a word follow it instead of pushing it down.
  return c.electionsFirst ? `${banner}${summary}${body}${extras}` : `${extras}${banner}${summary}${body}`;
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

/** Above a person's elections: who, how many, how many won, their page, and the way back. The
 * counts are of the elections listed, and say how many the filters hide (UX review 2026-10-31, M6:
 * the banner said 25 where search said 26, with nothing to say the by-election was filtered out). */
function personBannerHtml(c) {
  const p = c.person;
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

function seatsText(e) {
  if (e.subtitle) return e.subtitle;
  if (!e.seats) return '';
  return plural(e.seats, e.contestType === 'referendum' ? 'count area' : 'constituency', e.contestType === 'referendum' ? 'count areas' : 'constituencies');
}

// What the description is about, in the title's own terms: "About these elections" for the
// Republic's local elections (one title for every council), "About this referendum", and so on.
function aboutLabel(e) {
  const title = String(e.title || '');
  if (/\bplebiscite\b/i.test(title)) return 'About this plebiscite';
  if (/\breferendum\b/i.test(title) || e.contestType === 'referendum') return 'About this referendum';
  if (/\brecall petition\b/i.test(title)) return 'About this recall petition';
  if (/\belections\b/i.test(title)) return 'About these elections';
  return 'About this election';
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
    ${e.about ? `<details class="cn-erow__about"><summary>${esc(aboutLabel(e))}</summary>${aboutHtml(e.about)}</details>` : ''}
  </li>`;
}
