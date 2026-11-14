/**
 * The home page's search (el-places, 14 Nov 2026): places, people, parties and elections, as the
 * reader types. The matching is lib/search.js (pure, tested); this module wires it.
 *
 * Loads lazily: the place index and the party list are read on the first keystroke (about 35 KB
 * and 60 KB compressed), the elections index is the home page's own, and people are asked of the
 * persons API, a moment after typing stops, with each newer search superseding the older. The
 * query is kept in the address (?q=), so a search can be linked and survives going back.
 */
import { areaIndex, partyList, personSearch } from '../lib/api.js';
import { appUrl, esc, fmtDate } from '../lib/format.js';
import { latestRun } from '../lib/lifecycle.js';
import { areaUrl, partyBrowseUrl, personAppUrl } from '../lib/place-urls.js';
import { TEXT, fill } from '../lib/places-text.js';
import { partyChip } from '../lib/party.js';
import { buildSearchIndex, rankPersons, searchIndex } from '../lib/search.js';
import { siteNumber, yearSpan } from '../../../pkg/core/src/format.js';

/** @typedef {import('../lib/search.js').SearchIndex} SearchIndex */
/** @typedef {import('../lib/api.js').ElectionRow} ElectionRow */
/** @typedef {import('../lib/api.js').PersonCard} PersonCard */

/** How long typing must pause before people are searched, ms. */
const PEOPLE_DELAY = 220;

/** The query of a home URL's ?q=. Pure. @param {URLSearchParams} query */
export function searchState(query) {
  return { q: (query.get('q') || '').slice(0, 120) };
}

/** The address of the home page with a query (none when empty). Pure. @param {string} pathname @param {string} q */
export function searchHref(pathname, q) {
  return q.trim() ? `${pathname}?q=${encodeURIComponent(q.trim())}` : pathname;
}

/** The search form (its ids are the home page's, which the browser specs use). */
export function searchFormHtml() {
  return `<form class="el-search" role="search" onsubmit="return false">
      <label for="el-q">${esc(TEXT.searchLabel)}</label>
      <input id="el-q" type="search" placeholder="${esc(TEXT.searchPlaceholder)}" autocomplete="off" aria-describedby="el-search-status">
    </form>
    <p id="el-search-status" class="el-muted" aria-live="polite"></p>
    <div id="el-results" class="el-results"></div>`;
}

/** The place and party index once built (the API client caches the answers it is built from). @type {SearchIndex | null} */
let builtIndex = null;

/** The place and party index, read and built on the first search. @returns {Promise<SearchIndex>} */
async function placeIndex() {
  if (builtIndex) return builtIndex;
  const [areas, parties] = await Promise.all([areaIndex(), partyList()]);
  builtIndex = buildSearchIndex({ areas, parties });
  return builtIndex;
}

/**
 * Wire the search form drawn by searchFormHtml() inside `root`.
 * @param {HTMLElement} root
 * @param {{ elections: ElectionRow[], query: URLSearchParams }} opts
 * @param {Pick<import('../app.js').ViewContext, 'signal' | 'onDispose'>} ctx  the home view's: leaving it ends the search
 */
export function mountSearch(root, { elections, query }, ctx) {
  const { signal } = ctx;
  const input = /** @type {HTMLInputElement} */ (root.querySelector('#el-q'));
  const out = /** @type {HTMLElement} */ (root.querySelector('#el-results'));
  const status = /** @type {HTMLElement} */ (root.querySelector('#el-search-status'));
  const runs = latestRun();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  ctx.onDispose(() => clearTimeout(timer));
  const electionIndex = buildSearchIndex({ elections });

  const run = async () => {
    const text = input.value;
    const token = runs.start();
    clearTimeout(timer);
    history.replaceState(history.state, '', searchHref(location.pathname, text));
    const local = searchIndex(electionIndex, text, { limit: 10 });
    if (!local.query.length) { out.innerHTML = ''; status.textContent = ''; return; }
    const places = await placeIndex().then((i) => searchIndex(i, text)).catch(() => ({ places: [], parties: [] }));
    if (!runs.isLatest(token) || signal.aborted) return;
    /** @type {PersonCard[] | null} */
    let people = null;
    const draw = (/** @type {boolean} */ failed) => {
      out.innerHTML = resultsHtml({ places: places.places, parties: places.parties, elections: local.elections, people, failed });
      const n = places.places.length + places.parties.length + local.elections.length + (people?.length || 0);
      status.textContent = people === null && !failed ? TEXT.searchLoading : n ? fill(TEXT.searchFound, { n: siteNumber(n) }) : TEXT.searchNone;
    };
    draw(false);
    timer = setTimeout(async () => {
      try {
        const found = await personSearch(local.query.join(' '));
        if (!runs.isLatest(token) || signal.aborted) return;
        people = rankPersons(found, local.query);
        draw(false);
      } catch {
        if (!runs.isLatest(token) || signal.aborted) return;
        people = [];
        draw(true);
      }
    }, PEOPLE_DELAY);
  };
  input.addEventListener('input', () => { void run(); }, { signal: ctx.signal });
  const { q } = searchState(query);
  if (q) { input.value = q; void run(); }
}

/**
 * The grouped results.
 * @param {{ places: import('../lib/search.js').PlaceHit[], parties: import('../lib/search.js').PartyHit[], elections: import('../lib/search.js').ElectionHit[], people: PersonCard[] | null, failed: boolean }} r
 */
function resultsHtml({ places, parties, elections, people, failed }) {
  /** @param {string} title @param {string} id @param {string[]} items */
  const group = (title, id, items) => (items.length ? `<section class="el-results__group" aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2><ul class="el-list">${items.join('')}</ul></section>` : '');
  const peopleItems = (people || []).map((p) => {
    const url = personAppUrl({ personSlug: p.slug });
    const span = yearSpan(p.firstYear ?? null, p.lastYear ?? null);
    return `<li><a href="${esc(String(url))}">${esc(p.title)}</a>${span ? ` <span class="el-muted">${esc(span)}${p.bodies?.length ? ` · ${esc(p.bodies.slice(0, 3).join(', '))}` : ''}</span>` : ''}</li>`;
  });
  return group(TEXT.searchPlaces, 'el-results-places', places.map((p) => `<li><a href="${areaUrl(p.slug)}">${esc(p.name)}</a> <span class="el-muted">${p.bodies.slice(0, 3).map((b) => `${esc(b.body)} ${b.firstYear === b.lastYear ? b.firstYear : `${b.firstYear}–${b.lastYear}`}`).join(' · ')}${p.bodies.length > 3 ? ' …' : ''}</span></li>`))
    + (people === null ? `<p class="el-muted">${esc(TEXT.searchLoading)}</p>` : failed ? `<p class="el-muted">${esc(TEXT.searchPeopleFailed)}</p>` : group(TEXT.searchPeople, 'el-results-people', peopleItems))
    + group(TEXT.searchParties, 'el-results-parties', parties.map((p) => `<li><a href="${esc(partyBrowseUrl(p.slug))}">${partyChip(p.title, p.colour)}</a></li>`))
    + group(TEXT.searchElections, 'el-results-elections', elections.map((e) => `<li><a href="${appUrl.election(e.key)}">${esc(e.title)}</a> <span class="el-muted">${esc(fmtDate(e.date))}</span></li>`));
}
