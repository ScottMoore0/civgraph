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
 * the hash. sitemap.xml lists these URLs (scripts/build-sitemap.mjs).
 *
 * WHERE THE TITLES COME FROM
 *
 *   persons, sources, register-interests  D1 browse_* tables, the rows /_api/<type> serves
 *   elections (elections and contests)    D1 elections + constituencies + candidates
 *   maps, parties                         R2 data/browse/details/<type>/<slug>.json
 *
 * A record that is definitely absent answers 404 (with the shell, which says "not found");
 * a lookup that cannot be made (no binding, a failed query, a detail file under another
 * name) answers 200 with the generic Browse head, so an outage never turns real pages into
 * 404s. A record reached by another of its ids (a person by number, an election by key)
 * is redirected to its canonical slug, so each record is indexed once.
 *
 * Only these seven types are routed: _routes.json includes /browse/<type>/* for each, so
 * /browse/, browse.js and browse.css never invoke a Function.
 */
import { reportError } from './_api/_error.js';

export const SITE_ORIGIN = 'https://civgraph.net';
const SITE_NAME = 'Civgraph';
const DESCRIPTION_LIMIT = 300;

export const BROWSE_PAGE_TYPES = {
  persons: { singular: 'Person', table: 'browse_persons' },
  sources: { singular: 'Source', table: 'browse_sources' },
  'register-interests': { singular: 'Register interest', table: 'browse_register_interests' },
  elections: { singular: 'Election' },
  maps: { singular: 'Map', detailDir: 'maps' },
  parties: { singular: 'Party / label', detailDir: 'parties' },
  offices: { singular: 'Office', detailDir: 'offices' },
};

/** The same slug rule as browse.js and scripts/build-browse-indexes.mjs. */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

const htmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const numberText = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('en-GB').format(number) : '';
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "29 November 2024"; a year or year-month is shown as far as it goes. */
function dateText(value) {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(value || ''));
  if (!match) return String(value || '');
  const [, year, month, day] = match;
  if (!month) return year;
  const monthName = MONTHS[Number(month) - 1] || month;
  return day ? `${Number(day)} ${monthName} ${year}` : `${monthName} ${year}`;
}

/** Cut at a word boundary, so a description never ends mid-word. */
export function clip(text, limit = DESCRIPTION_LIMIT) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

const listText = (values, max = 4) => {
  const items = [...new Set((values || []).filter(Boolean))];
  if (!items.length) return '';
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
};

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** "Gerry Adams – Person – Civgraph"; elections already say what they are. */
export function pageTitle(type, title) {
  const singular = BROWSE_PAGE_TYPES[type]?.singular;
  return type === 'elections' || !singular
    ? `${title} – ${SITE_NAME}`
    : `${title} – ${singular} – ${SITE_NAME}`;
}

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
    title,
    description: clip(description || `${title} on Civgraph.`),
    slug: record.slug || slugify(record.id || record.key || title),
  };
}

async function lookupTableRecord(db, table, slug) {
  const row = await db
    .prepare(`SELECT record FROM ${table} WHERE key_norm = ?1 OR slug = ?1 OR id = ?1 LIMIT 1`)
    .bind(slug)
    .first();
  if (row?.record) return parseJson(row.record);
  // An old address (a source merged into another, a person's earlier id) redirects to the
  // record it now belongs to: the caller sends a 301 when the slugs differ.
  try {
    const aliased = await db
      .prepare(`SELECT record FROM ${table} WHERE slug = (SELECT slug FROM ${table}_aliases WHERE alias = ?1) LIMIT 1`)
      .bind(slug)
      .first();
    return aliased?.record ? parseJson(aliased.record) : null;
  } catch {
    return null;   // no aliases table yet
  }
}

/**
 * An election, an election's overall results, or one contest (a constituency or DEA).
 *
 * Election slugs are the key with "__" made "-" (dail-eireann__2024-11-29 ->
 * dail-eireann-2024-11-29); a contest adds the constituency's slug, and the NI Forum's
 * province-wide list is "regional-list". No election slug is a prefix of another, so the
 * longest match is the only match.
 */
async function lookupElection(db, slug) {
  const wanted = slug.toLowerCase();
  const election = await db
    .prepare(
      'SELECT key, display_title AS title, body, date, voting_system AS votingSystem, meta FROM elections '
      // A prefix test by substr, not LIKE: D1 refuses a LIKE whose pattern is a column
      // ("LIKE or GLOB pattern too complex").
      + "WHERE key = ?1 OR REPLACE(key, '__', '-') = ?1 "
      + "OR substr(?1, 1, LENGTH(REPLACE(key, '__', '-')) + 1) = REPLACE(key, '__', '-') || '-' "
      + 'ORDER BY LENGTH(key) DESC LIMIT 1'
    )
    .bind(wanted)
    .first();
  if (!election) return null;
  const meta = parseJson(election.meta || '') || {};
  const electionTitle = election.title || election.key;
  const electionSlug = slugify(election.key);
  const remainder = wanted === election.key || wanted === electionSlug ? '' : wanted.slice(electionSlug.length + 1);
  const when = election.date ? ` (${dateText(election.date)})` : '';

  if (!remainder) {
    const count = Array.isArray(meta.constituencies) ? meta.constituencies.length : 0;
    return {
      title: electionTitle,
      description: clip(meta.description || `${electionTitle}: ${election.body || 'election'}${when}${count ? `, ${numberText(count)} ${count === 1 ? 'constituency' : 'constituencies'}` : ''}. Results by constituency, candidates and parties on Civgraph.`),
      slug: electionSlug,
    };
  }
  if (remainder === 'overall-results') {
    return {
      title: `Overall results - ${electionTitle}`,
      description: clip(`Overall results for the ${electionTitle}${when}: seats and votes by party.`),
      slug: `${electionSlug}-overall-results`,
    };
  }

  const { results } = await db
    .prepare('SELECT seq, name, electorate, turnout_pct AS turnoutPct, seats_total AS seatsTotal, quota FROM constituencies WHERE election_key = ?1 ORDER BY seq')
    .bind(election.key)
    .all();
  const forum = /^northern-ireland-forum/.test(election.key);
  const contest = (results || []).find((row) => slugify(row.name) === remainder
    || (forum && remainder === 'regional-list' && slugify(row.name) === 'northern-ireland'));
  if (!contest) return null;
  const name = forum && remainder === 'regional-list' ? 'Regional List' : contest.name;
  const { results: elected } = await db
    .prepare('SELECT name, party, elected FROM candidates WHERE election_key = ?1 AND constituency_seq = ?2 ORDER BY first_prefs DESC')
    .bind(election.key, contest.seq)
    .all();
  const winners = (elected || [])
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
    slug: `${electionSlug}-${remainder}`,
  };
}

async function lookupDetailFile(bucket, dir, slug) {
  const object = await bucket.get(`data/browse/details/${dir}/${slug}.json`);
  if (!object) return undefined;   // the file is named by slug; another id may still render
  const detail = parseJson(await object.text());
  return detail?.item || undefined;
}

/**
 * @returns {Promise<{title:string, description:string, slug:string}|null|undefined>}
 *   the record's head; null when it certainly does not exist; undefined when that cannot
 *   be told, in which case the page is served with the generic head.
 */
export async function lookupBrowseRecord(env, type, slug) {
  const config = BROWSE_PAGE_TYPES[type];
  if (!config || !slug) return undefined;
  if (config.table) {
    if (!env?.ELECTIONS_DB) return undefined;
    const record = await lookupTableRecord(env.ELECTIONS_DB, config.table, slug);
    return record ? recordMeta(type, record) : null;
  }
  if (type === 'elections') {
    if (!env?.ELECTIONS_DB) return undefined;
    return lookupElection(env.ELECTIONS_DB, slug);
  }
  if (config.detailDir) {
    if (!env?.MAPS_BUCKET) return undefined;
    const item = await lookupDetailFile(env.MAPS_BUCKET, config.detailDir, slug);
    return item ? recordMeta(type, item) : undefined;
  }
  return undefined;
}

export function canonicalUrl(type, slug) {
  return `${SITE_ORIGIN}/browse/${type}/${encodeURIComponent(slug)}`;
}

/**
 * Put a record's head and hero into the Browse shell.
 *
 * String edits rather than HTMLRewriter so the same code runs under Node in
 * scripts/test-browse-pages.mjs. The shell is our own file (browse/index.html) and every
 * edit asserts nothing: a pattern that no longer matches leaves the shell as it was, which
 * still works, just without the record's head.
 */
export function renderBrowseShell(html, { title, description, canonical, kicker, heading }) {
  let out = html;
  if (title) out = out.replace(/<title>[^<]*<\/title>/i, `<title>${htmlEscape(title)}</title>`);
  if (description) {
    out = out.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${htmlEscape(description)}">`);
  }
  if (canonical) {
    const tags = [
      `<link rel="canonical" href="${htmlEscape(canonical)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${SITE_NAME}">`,
      `<meta property="og:url" content="${htmlEscape(canonical)}">`,
      title ? `<meta property="og:title" content="${htmlEscape(title)}">` : '',
      description ? `<meta property="og:description" content="${htmlEscape(description)}">` : '',
    ].filter(Boolean).join('\n  ');
    out = /<link\s+rel="canonical"[^>]*>/i.test(out)
      ? out.replace(/<link\s+rel="canonical"[^>]*>/i, tags)
      : out.replace(/<\/head>/i, `  ${tags}\n</head>`);
  }
  if (heading) {
    const hero = `<p class="browse-kicker">${htmlEscape(kicker || 'Browse')}</p>`
      + `<h1 class="browse-title">${htmlEscape(heading)}</h1>`
      + (description ? `<p class="browse-description">${htmlEscape(description)}</p>` : '');
    out = out.replace(/(<div id="browseHero" class="browse-hero">)(<\/div>)/, `$1${hero}$2`);
  }
  return out;
}

async function fetchShell(context, url) {
  const shellUrl = new URL('/browse/', url);
  if (context.env?.ASSETS?.fetch) return context.env.ASSETS.fetch(new Request(shellUrl));
  return fetch(shellUrl);
}

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The onRequestGet for /browse/<type>/*. */
export function browsePageHandler(type) {
  return async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const prefix = `/browse/${type}/`;
    const slug = decodePath(url.pathname.slice(prefix.length)).replace(/\/+$/, '').trim();
    if (!slug) return Response.redirect(`${url.origin}/browse/#/${type}`, 302);

    let found;
    try {
      found = await lookupBrowseRecord(context.env, type, slug);
    } catch (error) {
      reportError(context.env, `browse-page:${type}`, error);
      found = undefined;
    }

    // One URL per record: a person reached by number, an election by its key.
    if (found && found.slug && found.slug !== slug && found.slug.toLowerCase() !== slug.toLowerCase()) {
      return Response.redirect(`${url.origin}/browse/${type}/${encodeURIComponent(found.slug)}${url.search}`, 301);
    }

    const shell = await fetchShell(context, url);
    if (!shell.ok) return shell;
    const html = await shell.text();
    const page = found
      ? renderBrowseShell(html, {
        title: pageTitle(type, found.title),
        description: found.description,
        canonical: canonicalUrl(type, found.slug),
        kicker: BROWSE_PAGE_TYPES[type]?.singular || 'Browse',
        heading: found.title,
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
