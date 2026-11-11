/**
 * Path-style Browse record pages: /browse/<type>/<slug>.
 *
 * WHY
 *
 * Browse is a single-page app routed in the hash (/browse/#/persons/gerry-adams-27771).
 * A search engine never sends the hash to the server and indexes everything after it as
 * one page, so 85,000 records were one URL titled "Browse - Civgraph". The build has long
 * written path-style `browseUrl`s (/browse/elections/<slug>) into the indexes and the
 * graph, but nothing served them: they were 404s.
 *
 * This serves the same Browse shell at those paths, with the record's own <title>, meta
 * description, canonical link and Open Graph tags, and its heading and summary already in
 * the hero, so a crawler that does not run JavaScript still sees what the page is. The
 * client reads the route from the path (browse.js parseRoute) and renders as it would from
 * the hash. sitemap.xml lists these URLs (scripts/build/build-sitemap.mjs).
 *
 * WHERE THE TITLES COME FROM
 *
 *   persons, sources, register-interests  D1 person_cards, sources, register_entries: the rows
 *                                         /_api/<type> serves (records tables, data design phase 2)
 *   elections (elections and contests)    D1 r_elections + contests + candidacies
 *   elections (grouped local years)       D1 election_cards, plus the year's static file
 *                                         /render/metadata/ni-local/<year>.json and the coverage
 *                                         file, for a server-rendered hero (grouped-year.js)
 *   parties                               D1 party_cards (and party_aliases for retired slugs)
 *   offices                               D1 office_cards (the facts model's office pages)
 *   maps                                  D1 map_cards (data design phase 3; R2 details/maps before)
 *
 * A record that is definitely absent answers 404 (with the shell, which says "not found");
 * a lookup that cannot be made (no binding, a failed query, a detail file under another
 * name) answers 200 with the generic Browse head, so an outage never turns real pages into
 * 404s. A record reached by another of its ids (a person by number, an election by key)
 * is redirected to its canonical slug, so each record is indexed once.
 *
 * Only these seven types are routed: _routes.json includes /browse/<type>/* for each, so
 * /browse/, browse.js and browse.css never invoke a Function.
 *
 * SERVER-RENDERED BODIES (behind a flag)
 *
 * For persons, sources and register-interests the whole page can instead be rendered on
 * the server from the same D1 row, in the shared shell (packages/ui/src/templates/records/).
 * That happens only when CIVGRAPH_SSR_RECORDS names the type, or for ?ssr=1 when
 * CIVGRAPH_SSR_PREVIEW is set; with neither, this file behaves exactly as before.
 */
import { reportError } from '../packages/api/src/handlers/_error.js';
import { browseMapRecord } from '../packages/api/src/handlers/_maps.js';
import { dateText, listText, numberText, slugify } from '../packages/core/src/format.js';
import { datasetVersion, htmlResponse } from '../packages/api/src/respond.js';
import { renderRecordPage, ssrMode } from '../packages/ui/src/templates/records/index.js';
import { withShareTags } from '../packages/ui/src/templates/share.js';
import { loadElectionPage, loadPersonContestSources } from '../packages/api/src/pages/election.js';
import { groupedYearHero, groupedYearKey } from '../packages/ui/src/templates/records/grouped-year.js';
import { resolveElectionSlugAlias } from '../packages/core/src/election-slug-aliases.js';
import { binding } from '../packages/config/src/config.js';
import { asStore } from '../packages/storage/src/d1.js';
import { CARDS } from '../packages/api/src/queries/cards.js';
import { ELECTION_PAGES, RECORD_PAGES } from '../packages/api/src/queries/pages.js';

// Retired election and contest slugs (packages/core/src/election-slug-aliases.js): lookupElection
// finds the record under its new slug and the handler's slug check answers 301.
export { slugify, resolveElectionSlugAlias };
export const SITE_ORIGIN = 'https://civgraph.net';
const SITE_NAME = 'Civgraph';
const DESCRIPTION_LIMIT = 300;

/**
 * @typedef {CivgraphEnv} Env
 * @typedef {import('../packages/storage/src/store.js').RecordStore} RecordStore
 * @typedef {import('../packages/ui/src/templates/records/person.js').PersonRecord} PersonRecord
 * @typedef {import('../packages/ui/src/templates/records/grouped-year.js').YearCard} YearCard
 * @typedef {import('../packages/ui/src/templates/records/grouped-year.js').YearFile} YearFile
 * @typedef {import('../packages/ui/src/templates/records/grouped-year.js').YearCoverage} YearCoverage
 *
 * @typedef {object} RecordHeadFields  what recordMeta reads from a record of any type
 * @property {string} [title]
 * @property {string} [name]
 * @property {string} [memberName]
 * @property {string} [slug]
 * @property {string} [id]
 * @property {string} [key]
 * @property {string} [electedBody]
 * @property {string} [date]
 * @property {number} [interestCount]
 * @property {string} [description]
 * @property {string} [subtitle]
 * @property {string | string[]} [provider]
 * @typedef {RecordHeadFields & PersonRecord & { nonCandidate?: boolean }} BrowseRecord
 *   a Browse record (a card or detail JSON from D1): the fields this file reads
 *
 * @typedef {{ key: string, slug: string, year: number, card: YearCard }} GroupedYear
 * @typedef {object} RecordHead  a record page's head: what the shell and the redirect need
 * @property {string} title
 * @property {string} description
 * @property {string} slug                 the canonical slug
 * @property {string} [electionKey]        an election or contest page: its election
 * @property {number} [contestSeq]         a contest page: its contest
 * @property {GroupedYear} [groupedYear]   a grouped local-election year
 */

/** @type {Record<string, { singular: string, table?: string, aliasTable?: string }>} */
export const BROWSE_PAGE_TYPES = {
  persons: { singular: 'Person', table: 'person_cards', aliasTable: 'person_aliases' },
  sources: { singular: 'Source', table: 'sources', aliasTable: 'source_aliases' },
  'register-interests': { singular: 'Register interest', table: 'register_entries', aliasTable: 'register_entries_aliases' },
  elections: { singular: 'Election' },
  maps: { singular: 'Map' },
  parties: { singular: 'Party / label' },
  offices: { singular: 'Office' },
};

const htmlEscape = (/** @type {unknown} */ value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * Cut at a word boundary, so a description never ends mid-word.
 * @param {unknown} text
 * @param {number} [limit]
 * @returns {string}
 */
export function clip(text, limit = DESCRIPTION_LIMIT) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * The parsed JSON of a D1 text column, or null.
 * @param {unknown} text
 * @returns {unknown}
 */
function parseJson(text) {
  try {
    return JSON.parse(/** @type {string} */ (text));
  } catch {
    return null;
  }
}

/** "Gerry Adams – Person – Civgraph"; elections already say what they are. */
/**
 * @param {string} type
 * @param {string} title
 * @returns {string}
 */
export function pageTitle(type, title) {
  const singular = BROWSE_PAGE_TYPES[type]?.singular;
  return type === 'elections' || !singular
    ? `${title} – ${SITE_NAME}`
    : `${title} – ${singular} – ${SITE_NAME}`;
}

/** @param {BrowseRecord} record */
function personDescription(record) {
  const name = record.name || record.title;
  const parties = listText((record.parties || []).map((party) => party.name), 3);
  const places = listText((record.constituencies || []).map((place) => place.name), 4);
  const stood = Number(record.totals?.stood) || (record.elections || []).length;
  const elected = Number(record.totals?.elected)
    || (record.elections || []).filter((row) => row.elected).length;
  const years = record.firstYear && record.lastYear
    ? (record.firstYear === record.lastYear ? ` in ${record.firstYear}` : ` between ${record.firstYear} and ${record.lastYear}`)
    : '';
  let sentence = `${name}${parties ? ` (${parties})` : ''}`;
  if (stood) {
    sentence += ` stood in ${numberText(stood)} ${stood === 1 ? 'election' : 'elections'}${years}`;
    if (places) sentence += ` in ${places}`;
    if (elected) sentence += `, elected ${numberText(elected)} ${elected === 1 ? 'time' : 'times'}`;
  } else if (places) {
    sentence += `: ${places}`;
  } else if (record.nonCandidate && record.subtitle) {
    // A registered non-candidate (a Northern Ireland Office minister): the office is the record.
    return `${sentence}: ${record.subtitle}. Offices and sources on Civgraph.`;
  }
  return `${sentence}. Election results, parties and sources on Civgraph.`;
}

/**
 * @param {string} type
 * @param {BrowseRecord} record
 * @returns {RecordHead}
 */
function recordMeta(type, record) {
  const title = record.title || record.name || record.memberName || record.slug;
  let description = '';
  if (type === 'persons') description = personDescription(record);
  else if (type === 'register-interests') {
    description = [
      `Register of interests entry for ${record.memberName || title}`,
      record.electedBody,
      record.date,
    ].filter(Boolean).join(', ');
    if (record.interestCount) description += `: ${numberText(record.interestCount)} declared ${record.interestCount === 1 ? 'interest' : 'interests'}`;
    description += '.';
  } else {
    description = record.description || record.subtitle || '';
    const provider = Array.isArray(record.provider) ? record.provider.join(', ') : record.provider;
    if (!description && provider) description = `${title}, published by ${provider}.`;
  }
  return {
    title: /** @type {string} */ (title),   // every record has at least its slug
    description: clip(description || `${title} on Civgraph.`),
    slug: /** @type {string} */ (record.slug || slugify(record.id || record.key || title)),
  };
}

/**
 * @param {RecordStore | D1Database} source
 * @param {string} table       the cards table (person_cards, sources, register_entries)
 * @param {string} slug
 * @param {string} [aliasTable]
 * @returns {Promise<BrowseRecord | null>}
 */
async function lookupTableRecord(source, table, slug, aliasTable = `${table}_aliases`) {
  const db = asStore(source);
  // Ordered, so a value that is one record's slug and another's id resolves the same way
  // whatever order the rows were loaded in (data design 4.3, query 7).
  const row = await db.first(CARDS.bySlug(table, 'card AS record'), [slug]);
  if (row?.record) return /** @type {BrowseRecord | null} */ (parseJson(row.record));
  // An old address (a source merged into another, a person's earlier id) redirects to the
  // record it now belongs to: the caller sends a 301 when the slugs differ.
  let aliased = null;
  try {
    aliased = await db.first(CARDS.byAlias(table, 'card AS record', aliasTable), [slug]);
  } catch {
    return null;   // no aliases table yet
  }
  if (aliased?.record) return /** @type {BrowseRecord | null} */ (parseJson(aliased.record));
  // A person's slug is their name and registry id. When a re-stamp retires the id (a merge) or
  // the name changes, the published slug is neither a record nor an alias; its id still is
  // (the person's own id, or a merged-away id in person_aliases), so the address is answered
  // through it and the caller's slug check sends the 301.
  const id = table === 'person_cards' ? /^[a-z0-9-]+-(\d+)$/.exec(String(slug))?.[1] : null;
  return id ? lookupTableRecord(db, table, id, aliasTable) : null;
}

/**
 * An election, an election's overall results, or one contest (a constituency or DEA).
 *
 * Election slugs are the key with "__" made "-" (dail-eireann__2024-11-29 ->
 * dail-eireann-2024-11-29); a contest adds the constituency's slug, and the NI Forum's
 * province-wide list is "regional-list". No election slug is a prefix of another, so the
 * longest match is the only match.
 */
/**
 * A grouped local-election year (ni-local-1946, ireland-local-1911): not an r_elections row but a
 * Browse card listing its council rounds. Null when there is no such year.
 * @param {RecordStore | D1Database} source
 * @param {string} slug
 * @returns {Promise<RecordHead | null>}
 */
export async function lookupGroupedYear(source, slug) {
  const grouped = groupedYearKey(slug);
  if (!grouped) return null;
  const row = await asStore(source).first(ELECTION_PAGES.groupedYear, [grouped.slug]);
  const card = /** @type {(YearCard & { slug?: string }) | null} */ (parseJson(row?.card || ''));
  if (!card) return null;
  const title = card.title || grouped.key;
  return {
    title,
    description: clip(card.description || `${title}: the council elections of ${grouped.year} on Civgraph.`),
    slug: card.slug || grouped.slug,
    groupedYear: { ...grouped, card },
  };
}

/**
 * @param {RecordStore | D1Database} source
 * @param {string} slug
 * @returns {Promise<RecordHead | null>}
 */
export async function lookupElection(source, slug) {
  const db = asStore(source);
  const wanted = resolveElectionSlugAlias(slug);
  // A grouped year first: its slug is no election's, and r_elections does not hold it.
  if (groupedYearKey(wanted)) {
    const year = await lookupGroupedYear(db, wanted);
    if (year) return year;
  }
  // r_elections.slug is the key with "__" made "-". A contest slug is its election's slug plus
  // the contest's own (contests.slug), so the election is the longest slug that prefixes it.
  const election = /** @type {{ key: string, slug: string | null, title: string | null, body: string | null, date: string | null, votingSystem: string | null, meta: string | null } | null} */ (
    await db.first(ELECTION_PAGES.electionOfSlug, [wanted]));
  if (!election) return null;
  const meta = /** @type {{ constituencies?: unknown, description?: string }} */ (parseJson(election.meta || '') || {});
  const electionTitle = election.title || election.key;
  const electionSlug = election.slug || slugify(election.key);
  const remainder = wanted === election.key || wanted === electionSlug ? '' : wanted.slice(electionSlug.length + 1);
  const when = election.date ? ` (${dateText(election.date)})` : '';

  if (!remainder) {
    const count = Array.isArray(meta.constituencies) ? meta.constituencies.length : 0;
    return {
      title: electionTitle,
      description: clip(meta.description || `${electionTitle}: ${election.body || 'election'}${when}${count ? `, ${numberText(count)} ${count === 1 ? 'constituency' : 'constituencies'}` : ''}. Results by constituency, candidates and parties on Civgraph.`),
      slug: electionSlug,
      electionKey: election.key,
    };
  }
  if (remainder === 'overall-results') {
    return {
      title: `Overall results - ${electionTitle}`,
      description: clip(`Overall results for the ${electionTitle}${when}: seats and votes by party.`),
      slug: `${electionSlug}-overall-results`,
      electionKey: election.key,
    };
  }

  const contest = /** @type {{ seq: number, name: string, slug: string, electorate: number | null, turnoutPct: number | null, seatsTotal: number | null, quota: number | null } | null} */ (
    await db.first(ELECTION_PAGES.contestOfSlug, [election.key, remainder]));
  if (!contest) return null;
  const forum = contest.slug === 'regional-list';
  const name = forum ? 'Regional List' : contest.name;
  const elected = /** @type {{ name: string, party: string | null, elected: number | boolean | string | null }[]} */ (
    await db.all(ELECTION_PAGES.contestWinners, [election.key, contest.seq]));
  const winners = elected
    .filter((row) => row.elected === 1 || row.elected === true || row.elected === '1')
    .map((row) => row.name);
  const facts = [
    contest.seatsTotal ? `${numberText(contest.seatsTotal)} ${Number(contest.seatsTotal) === 1 ? 'seat' : 'seats'}` : '',
    contest.electorate ? `electorate ${numberText(contest.electorate)}` : '',
    contest.turnoutPct ? `turnout ${contest.turnoutPct}%` : '',
    contest.quota ? `quota ${numberText(contest.quota)}` : '',
  ].filter(Boolean).join(', ');
  const description = `${name} result in the ${electionTitle}${when}${facts ? `: ${facts}` : ''}.`
    + `${winners.length ? ` Elected: ${listText(winners, 6)}.` : ''} Candidates and votes on Civgraph.`;
  return {
    title: `${name} - ${electionTitle}`,
    description: clip(description),
    slug: `${electionSlug}-${contest.slug}`,
    electionKey: election.key,
    contestSeq: contest.seq,
  };
}

/** A party's detail record from D1, following a retired slug to the party it is now. */
/**
 * @param {RecordStore | D1Database} source
 * @param {string} slug
 * @returns {Promise<BrowseRecord | null>}
 */
export async function lookupPartyRecord(source, slug) {
  const wanted = slug.toLowerCase();
  const row = await asStore(source).first(RECORD_PAGES.party, [wanted]);
  if (!row) return null;
  return /** @type {BrowseRecord | null} */ (parseJson(row.detail || '') || parseJson(row.card || ''));
}

/** An office's page record from D1 (office_cards, built by scripts/build/build-office-pages.mjs). */
/**
 * @param {RecordStore | D1Database} source
 * @param {string} slug
 * @returns {Promise<BrowseRecord | null>}
 */
export async function lookupOfficeRecord(source, slug) {
  const row = await asStore(source).first(RECORD_PAGES.office, [String(slug)]);
  if (!row) return null;
  return /** @type {BrowseRecord | null} */ (parseJson(row.detail || '') || parseJson(row.card || ''));
}

/**
 * A map's page record from D1 (map_cards, the Browse build's map pages): by slug, or by map id.
 * Null when it certainly does not exist; undefined when the table is empty (a database loaded
 * without the Browse build), so the page keeps the generic head rather than answering 404.
 * @param {RecordStore | D1Database} source
 * @param {string} slug
 * @returns {Promise<BrowseRecord | null | undefined>}
 */
export async function lookupMapRecord(source, slug) {
  const db = asStore(source);
  const row = await browseMapRecord(db, String(slug));
  if (row) return /** @type {BrowseRecord | null} */ (parseJson(row.detail || '') || parseJson(row.card || ''));
  const any = await db.first(RECORD_PAGES.anyMap);
  return any ? null : undefined;
}

/**
 * The whole browse_* record for a D1-backed type (persons, sources, register-interests):
 * the object, null when it certainly does not exist, undefined when that cannot be told.
 * @param {Env} env
 * @param {string} type
 * @param {string} slug
 * @returns {Promise<BrowseRecord | null | undefined>}
 */
export async function lookupBrowseTableRecord(env, type, slug) {
  const config = BROWSE_PAGE_TYPES[type];
  if (!config?.table || !slug || !binding(env, 'ELECTIONS_DB')) return undefined;
  return lookupTableRecord(/** @type {D1Database} */ (binding(env, 'ELECTIONS_DB')), config.table, slug, config.aliasTable);
}

/**
 * @param {Env} env
 * @param {string} type
 * @param {string} slug
 * @returns {Promise<RecordHead | null | undefined>}
 *   the record's head; null when it certainly does not exist; undefined when that cannot
 *   be told, in which case the page is served with the generic head.
 */
export async function lookupBrowseRecord(env, type, slug) {
  const config = BROWSE_PAGE_TYPES[type];
  if (!config || !slug) return undefined;
  if (config.table) {
    const record = await lookupBrowseTableRecord(env, type, slug);
    return record ? recordMeta(type, record) : record;
  }
  if (type === 'elections') {
    if (!binding(env, 'ELECTIONS_DB')) return undefined;
    return lookupElection(/** @type {D1Database} */ (binding(env, 'ELECTIONS_DB')), slug);
  }
  if (type === 'parties') {
    if (!binding(env, 'ELECTIONS_DB')) return undefined;
    const item = await lookupPartyRecord(/** @type {D1Database} */ (binding(env, 'ELECTIONS_DB')), slug);
    return item ? recordMeta(type, item) : null;
  }
  if (type === 'offices') {
    if (!binding(env, 'ELECTIONS_DB')) return undefined;
    try {
      const item = await lookupOfficeRecord(/** @type {D1Database} */ (binding(env, 'ELECTIONS_DB')), slug);
      return item ? recordMeta(type, item) : null;
    } catch {
      return undefined;   // a database without office_cards: the generic head
    }
  }
  if (type === 'maps') {
    if (!binding(env, 'ELECTIONS_DB')) return undefined;
    try {
      const item = await lookupMapRecord(/** @type {D1Database} */ (binding(env, 'ELECTIONS_DB')), slug);
      return item ? recordMeta(type, item) : item;
    } catch {
      return undefined;   // a database without map_cards: the generic head
    }
  }
  return undefined;
}

/**
 * @param {string} type
 * @param {string} slug
 * @returns {string}
 */
export function canonicalUrl(type, slug) {
  return `${SITE_ORIGIN}/browse/${type}/${encodeURIComponent(slug)}`;
}

/**
 * Put a record's head and hero into the Browse shell.
 *
 * String edits rather than HTMLRewriter so the same code runs under Node in
 * tests/functions/browse-pages.test.mjs. The shell is our own file (browse/index.html) and every
 * edit asserts nothing: a pattern that no longer matches leaves the shell as it was, which
 * still works, just without the record's head.
 * @param {string} html  the shell
 * @param {{ title?: string, description?: string, canonical?: string, kicker?: string, heading?: string, heroHtml?: string | null }} head
 * @returns {string}
 */
export function renderBrowseShell(html, { title, description, canonical, kicker, heading, heroHtml }) {
  let out = html;
  if (title) out = out.replace(/<title>[^<]*<\/title>/i, `<title>${htmlEscape(title)}</title>`);
  if (description) {
    out = out.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${htmlEscape(description)}">`);
  }
  if (canonical) {
    // The record's canonical, Open Graph and Twitter card in place of the shell's own (/browse/'s),
    // so a pasted record link previews as the record, with the share image (QA 2026-11-11, H1).
    out = withShareTags(out, {
      title: title || SITE_NAME,
      description,
      url: canonical,
      type: kicker === 'Person' ? 'profile' : 'website',
    });
  }
  if (heroHtml) {
    out = out.replace(/(<div id="browseHero" class="browse-hero">)(<\/div>)/, (_m, open, close) => `${open}${heroHtml}${close}`);
  } else if (heading) {
    const hero = `<p class="browse-kicker">${htmlEscape(kicker || 'Browse')}</p>`
      + `<h1 class="browse-title">${htmlEscape(heading)}</h1>`
      + (description ? `<p class="browse-description">${htmlEscape(description)}</p>` : '');
    out = out.replace(/(<div id="browseHero" class="browse-hero">)(<\/div>)/, `$1${hero}$2`);
  }
  return out;
}

/**
 * @param {FunctionContext} context
 * @param {URL} url
 */
async function fetchShell(context, url) {
  const shellUrl = new URL('/browse/', url);
  if (binding(context.env, 'ASSETS')?.fetch) return /** @type {NonNullable<Env['ASSETS']>} */ (binding(context.env, 'ASSETS')).fetch(new Request(shellUrl));
  return fetch(shellUrl);
}

/** A committed static JSON file (the grouped years' files), or null. */
/**
 * @param {FunctionContext} context
 * @param {URL} url
 * @param {string} pathname
 * @returns {Promise<unknown>}
 */
async function fetchStaticJson(context, url, pathname) {
  try {
    const assetUrl = new URL(pathname, url);
    const res = binding(context.env, 'ASSETS')?.fetch ? await /** @type {NonNullable<Env['ASSETS']>} */ (binding(context.env, 'ASSETS')).fetch(new Request(assetUrl)) : await fetch(assetUrl);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The server-rendered hero of a grouped year: its rounds, completeness, hatching and map link. */
/**
 * @param {FunctionContext} context
 * @param {URL} url
 * @param {GroupedYear} grouped
 * @returns {Promise<string>}
 */
async function groupedYearHeroHtml(context, url, grouped) {
  const [yearFile, coverage] = /** @type {[(YearFile & { key?: string }) | null, { years?: (YearCoverage & { key?: string })[] } | null]} */ (await Promise.all([
    fetchStaticJson(context, url, `/render/metadata/ni-local/${grouped.year}.json`),
    fetchStaticJson(context, url, '/render/metadata/ni-local-coverage.json'),
  ]));
  const year = yearFile && yearFile.key === grouped.key ? yearFile : null;
  const cover = (coverage?.years || []).find((y) => y.key === grouped.key) || null;
  return String(groupedYearHero({ card: grouped.card, yearFile: year, coverage: cover }));
}

/** @param {string} value */
function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The onRequestGet for /browse/<type>/*. */
/**
 * @param {string} type  a BROWSE_PAGE_TYPES key
 * @returns {(context: FunctionContext) => Promise<Response>}
 */
export function browsePageHandler(type) {
  return async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const prefix = `/browse/${type}/`;
    const slug = decodePath(url.pathname.slice(prefix.length)).replace(/\/+$/, '').trim();
    if (!slug) return Response.redirect(`${url.origin}/browse/#/${type}`, 302);

    const { ssr, preview } = ssrMode(context.env, type, url);
    /** @type {RecordHead | null | undefined} */
    let found;
    /** @type {object | null | undefined} */
    let record;
    try {
      if (ssr && type === 'elections') {
        found = await lookupBrowseRecord(context.env, type, slug);
        record = found ? await loadElectionPage(/** @type {D1Database} */ (binding(context.env, 'ELECTIONS_DB')), found) : found;
      } else if (ssr && type === 'parties') {
        record = binding(context.env, 'ELECTIONS_DB') ? await lookupPartyRecord(/** @type {D1Database} */ (binding(context.env, 'ELECTIONS_DB')), slug) : undefined;
        found = record ? recordMeta(type, record) : record;
      } else if (ssr) {
        record = await lookupBrowseTableRecord(context.env, type, slug);
        found = record ? recordMeta(type, record) : record;
        // A person's results cite their contests' sources (QA H5).
        const db = binding(context.env, 'ELECTIONS_DB');
        if (record && type === 'persons' && db) {
          const person = /** @type {PersonRecord} */ (record);
          person.contestSources = await loadPersonContestSources(/** @type {D1Database} */ (db), person.id ?? null).catch(() => []);
        }
      } else {
        found = await lookupBrowseRecord(context.env, type, slug);
      }
    } catch (error) {
      reportError(context.env, `browse-page:${type}`, error);
      found = undefined;
      record = undefined;
    }

    // One URL per record: a person reached by number, an election by its key.
    if (found && found.slug && found.slug !== slug && found.slug.toLowerCase() !== slug.toLowerCase()) {
      return Response.redirect(`${url.origin}/browse/${type}/${encodeURIComponent(found.slug)}${url.search}`, 301);
    }

    // The server-rendered page, when the flag asks for it and the record was found. A miss
    // or an outage falls through to the Browse shell below, as without the flag.
    if (ssr && record && found) {
      let body = null;
      try {
        body = renderRecordPage({
          type,
          record,
          meta: found,
          pageTitle: pageTitle(type, found.title),
          canonical: canonicalUrl(type, found.slug),
          preview,
        });
      } catch (error) {
        // A record the template cannot render still gets the Browse shell with its head.
        reportError(context.env, `browse-page-ssr:${type}`, error);
      }
      if (body !== null) {
        return htmlResponse(context.request, body, {
          cacheControl: preview ? 'private, no-store' : 'public, max-age=300',
          datasetVersion: await datasetVersion(binding(context.env, 'ELECTIONS_DB')),
        });
      }
    }

    const shell = await fetchShell(context, url);
    if (!shell.ok) return shell;
    const html = await shell.text();
    let heroHtml = null;
    if (found?.groupedYear) {
      try {
        heroHtml = await groupedYearHeroHtml(context, url, found.groupedYear);
      } catch (error) {
        reportError(context.env, 'browse-page:grouped-year', error);
      }
    }
    const page = found
      ? renderBrowseShell(html, {
        title: pageTitle(type, found.title),
        description: found.description,
        canonical: canonicalUrl(type, found.slug),
        kicker: BROWSE_PAGE_TYPES[type]?.singular || 'Browse',
        heading: found.title,
        heroHtml,
      })
      : html;
    return new Response(page, {
      status: found === null ? 404 : 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': found === null ? 'public, max-age=60' : 'public, max-age=300',
      },
    });
  };
}
