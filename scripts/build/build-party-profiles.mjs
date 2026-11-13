#!/usr/bin/env node
/**
 * Party profiles for Browse: data/browse/party-profiles/<slug>.json, one per party record.
 *
 * Browse shows them on a party's page (browse/browse.js renderPartyProfilePanels): a summary
 * with the founding and lineage timeline, the leaders, a seats-and-votes chart and table for
 * every body the party contested, its most-elected members and the sources.
 *
 * Built from what is already built or curated; nothing here calls out to the web:
 *   data/browse/parties.json, details/parties/<slug>.json   the party records and the party
 *                                                            rows of every election's summary
 *   data/browse/elections.json                              each election's body, kind, seats
 *                                                            and valid poll
 *   data/browse/person-shards/*.json                        every candidacy: contests,
 *                                                            candidates and members
 *   data/browse/party-names.json                            ballot-paper label -> party
 *   data/elections/parties/party_registry.json              curated dates (owner-supplied)
 *   data/elections/parties/party-lineage.json               cited founding/split/rename events
 *   data/elections/parties/party-wikidata.json              Wikidata (CC0) facts, fetched by
 *                                                            scripts/ingest/wikipedia/fetch-party-wikidata.mjs
 *   the facts model (docs/facts-model.md, scripts/lib/facts-model.mjs):
 *     data/offices/                                         the party's offices and who held them
 *     data/elections/parties/party-events.json              cited founding, renaming, split ... events
 *   data/elections-source/data/elections_index.json         the party's own ballots (bodyType
 *     + render/metadata/elections-test2/<key>.json          "party-internal": leadership and
 *                                                            nomination contests) and their results
 *
 * Precedence for a date: the curated registry, then a cited lineage event, then Wikidata.
 * Every fact carries its source. Run after scripts/build/build-browse-indexes.mjs (npm run build:browse).
 *
 * Usage: node scripts/build/build-party-profiles.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BROWSE_DIR, ELECTION_BUNDLE_DIR } from '../../packages/loader/src/paths.mjs';
import { browsePartySlugResolver, formatSpan, indexFactsModel, loadFactsModel } from '../lib/facts-model.mjs';
import { isPartyInternalBody } from '../lib/election-names.mjs';
import { loadRegistry } from '../../packages/registries/src/index.mjs';
import { partyCharts } from '../../packages/registries/src/election-bodies.mjs';
import { firstGroup } from '../../packages/registries/src/browser/body-groups.mjs';

const ROOT = process.cwd();
const BROWSE = BROWSE_DIR;
const OUT_DIR = path.join(BROWSE, 'party-profiles');
const CHECK = process.argv.includes('--check');
const NOTABLE_LIMIT = 15;

/**
 * compact's result: a field that is null, undefined, '' or an empty array is dropped, so only a
 * number, a boolean or a non-empty string literal is sure to be there.
 * @template T
 * @typedef {[T] extends [number | boolean] ? true : [T] extends [string] ? (string extends T ? false : '' extends T ? false : true) : false} Kept
 */
/**
 * @template T
 * @typedef {{ [K in keyof T as Kept<T[K]> extends true ? K : never]: T[K] }
 *   & { [K in keyof T as Kept<T[K]> extends true ? never : K]?: Exclude<T[K], null | undefined> }} Compacted
 */
/** A party of parties.json. @typedef {{ slug: string, title?: string, previousSlugs?: string[] }} PartyItem */
/** An election's summary row for the party (details/parties/<slug>.json). @typedef {{ key: string, title?: string, date?: string, seats?: unknown, stood?: unknown, votes?: unknown, share?: unknown }} SummaryRow */
/** @typedef {{ seats?: unknown, validPoll?: unknown }} ElectionTotals */
/** An election of elections.json. @typedef {{ key: string, entryKind?: string, title?: string, date?: string, kind?: string, body?: string, totals?: ElectionTotals }} ElectionItem */
/**
 * A party of party_registry.json.
 * @typedef {{ id: string, name?: string, shortName?: string, aliases?: (string | { string?: string } | null)[], source?: string, founded?: string,
 *   foundedPrecision?: string, dissolved?: string, status?: string, splitFrom?: string | string[], predecessor?: string | string[], successor?: string | string[] }} RegistryEntity
 */
/** A related party of a lineage event, or the party it resolves to. @typedef {{ party?: string, slug?: string, title?: string, relation?: string }} RelatedParty */
/**
 * A cited event of party-lineage.json.
 * @typedef {{ party: string, kind?: string, date?: string, precision?: string, basis?: unknown, text?: string, note?: string,
 *   related?: RelatedParty[], citations?: unknown[] }} LineageEvent
 */
/** @typedef {{ events?: LineageEvent[], sources?: { irda?: string } }} LineageFile */
/** @typedef {{ date: string, precision?: string }} WdDate */
/** @typedef {{ civgraphSlug?: string, label?: string, qid?: string }} WdLink */
/** @typedef {{ name?: string, qid?: string, start?: { date?: string }, end?: { date?: string }, officeLabel?: string, office?: string }} WdLeader */
/**
 * A party's Wikidata match (party-wikidata.json).
 * @typedef {{ qid: string, label?: string, description?: string, enwiki?: string, inception?: WdDate & { refs?: { url?: string }[] }, dissolved?: WdDate,
 *   replaces?: WdLink[], replacedBy?: WdLink[], follows?: WdLink[], followedBy?: WdLink[], leaders?: WdLeader[], offices?: unknown,
 *   ideologies?: { label?: string, qid?: string }[], alignment?: { label?: string, qid?: string }[] }} WdMatch
 */
/** @typedef {{ matches?: Record<string, WdMatch>, retrieved?: string }} WikidataFile */
/** A candidacy of a person shard. @typedef {{ key?: string, party?: string, elected?: unknown, firstPrefs?: unknown, constituency?: string, year?: unknown, date?: string }} PersonElection */
/** A person of a person shard. @typedef {{ id: string | number, slug: string, name?: string, title?: string, elections?: PersonElection[] }} PersonItem */
/** A party-internal body of the elections index. @typedef {{ slug: string, name: string, bodyType?: string, partyId?: string, dates?: { date: string }[] }} IndexBody */
/**
 * A party ballot's bundle, the fields read.
 * @typedef {{ displayTitle?: string, results?: { constituency?: string, candidates?: { personId?: string, name?: string, firstPrefs?: unknown, votes?: unknown, elected?: unknown }[] }[] }} InternalBundle
 */
/** A dated fact with its source. @typedef {{ date: string, precision?: string, source: string, basis?: unknown, citations?: unknown[] }} DateFact */
/**
 * An election in a body's chart.
 * @typedef {{ key?: string, title?: string, date?: string, kind?: string, body?: string, contests?: number, candidates?: number, seats?: number,
 *   seatsTotal?: number, votes?: number, validPoll?: number, share?: number }} ElectionRow
 */
/** @typedef {{ id: string, label: string, note?: string, elections: ElectionRow[] }} BodyChart */
/**
 * A dated item of a party's timeline.
 * @typedef {{ date?: string, precision?: string, kind?: string, text?: string, source?: string, basis?: unknown, note?: string, related?: RelatedParty[],
 *   persons?: unknown[], citations?: unknown[], electionKey?: string }} TimelineItem
 */
/** @typedef {{ relation?: string, slug?: string, title?: string, label?: string, qid?: string, source?: string }} Relation */

/** @type {<T>(rel: string, fallback: T) => T} */
const readJson = (rel, fallback) => {
  const full = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : fallback;
};
const normalizeName = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * @template {object} T
 * @param {T} object
 * @returns {Compacted<T>}
 */
// object's own fields, less the empty ones
const compact = (object) => /** @type {Compacted<typeof object>} */ (Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''
  && !(Array.isArray(value) && !value.length))));
/** @type {(value: number, places?: number) => number | null} */
const round = (value, places = 2) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);
const num = (/** @type {unknown} */ value) => (value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

// The bodies a profile charts, in the order they are shown: the election-bodies registry's
// partyCharts (data/registries/election-bodies.json groups), then a chart for each body it gives
// one of its own (the Mayor of Limerick). A key's prefix is its body.
const BODY_GROUPS = partyCharts(loadRegistry('election-bodies'));
/** @type {(key: string) => { id: string, label: string, note?: string } | null} */
const bodyGroupOf = (key) => {
  const prefix = String(key).split('__')[0];
  if (/referendum/.test(prefix)) return null;
  // A party's own leadership and nomination ballots are listed under internalContests, never
  // charted as a body: a leadership won is not a seat, nor the party's whole vote 100% of a poll.
  if (isPartyInternalBody({ bodySlug: prefix })) return null;
  return firstGroup(BODY_GROUPS, prefix) || { id: prefix, label: prefix };
};

function readPersons() {
  const manifest = readJson(path.join(BROWSE, 'persons.json'), /** @type {{ shards?: { name: string }[] }} */ ({ shards: [] }));
  /** @type {PersonItem[]} */
  const persons = [];
  for (const shard of manifest.shards || []) {
    const data = readJson(path.join(BROWSE, 'person-shards', shard.name), /** @type {{ items?: PersonItem[] }} */ ({ items: [] }));
    persons.push(...(data.items || []));
  }
  return persons;
}

/**
 * @param {string} qid
 * @param {string} [label]
 */
function wikidataCitation(qid, label) {
  return { title: `Wikidata ${qid}${label ? ` (${label})` : ''}`, url: `https://www.wikidata.org/wiki/${qid}` };
}

function main() {
  // each file's shape, or its fallback
  const parties = readJson(path.join(BROWSE, 'parties.json'), /** @type {{ items?: PartyItem[] }} */ ({ items: [] })).items || [];
  const partyBySlug = new Map(parties.map((party) => [party.slug, party]));
  const partyNames = readJson(path.join(BROWSE, 'party-names.json'), /** @type {{ items?: Record<string, string> }} */ ({ items: {} })).items || {};
  const elections = (readJson(path.join(BROWSE, 'elections.json'), /** @type {{ items?: ElectionItem[] }} */ ({ items: [] })).items || [])
    .filter((entry) => !entry.entryKind || entry.entryKind === 'election');
  const electionByKey = new Map(elections.map((entry) => [entry.key, entry]));
  const registry = new Map((readJson('data/elections/parties/party_registry.json', /** @type {{ entities?: RegistryEntity[] }} */ ({ entities: [] })).entities || []).map((entry) => [entry.id, entry]));
  const lineage = readJson('data/elections/parties/party-lineage.json', /** @type {LineageFile} */ ({ events: [] }));
  const wikidata = readJson('data/elections/parties/party-wikidata.json', /** @type {WikidataFile} */ ({ matches: {} }));
  const persons = readPersons();
  const slugOfLabel = (/** @type {unknown} */ label) => partyNames[normalizeName(label)] || null;

  // The facts model: registry ids map to Browse slugs (several ids can fold into one slug).
  const factsModel = loadFactsModel(ROOT);
  const factsIndex = indexFactsModel(factsModel);
  const registryEntities = readJson('data/elections/parties/party_registry.json', /** @type {{ entities?: RegistryEntity[] }} */ ({ entities: [] })).entities || [];
  const slugOfParty = browsePartySlugResolver(registryEntities, partyNames, new Set(parties.map((p) => p.slug)));
  /** @type {Map<string, string[]>} */
  const registryIdsBySlug = new Map();
  for (const e of registryEntities) {
    const s = slugOfParty(e.id);
    if (!s) continue;
    if (!registryIdsBySlug.has(s)) registryIdsBySlug.set(s, []);
    // the key was set on the line before if it was missing
    /** @type {string[]} */ (registryIdsBySlug.get(s)).push(e.id);
  }
  const personById = new Map(persons.map((p) => [String(p.id), p]));
  const personRef = (/** @type {unknown} */ id) => {
    const p = personById.get(String(id));
    return p ? { personSlug: p.slug, name: p.name || p.title } : { name: `person ${id}` };
  };
  const shortCitation = (/** @type {{ title?: string, url?: string | null }} */ c) => compact({ title: c.title, url: c.url || undefined });
  // The party's own ballots: bodies the elections index declares party-internal.
  const electionIndex = readJson('data/elections-source/data/elections_index.json', /** @type {{ bodies?: IndexBody[] }} */ ({ bodies: [] }));
  const internalBodies = (electionIndex.bodies || []).filter((b) => b.bodyType === 'party-internal');
  const OFFICE_ORDER = ['party-leader', 'party-deputy-leader', 'party-president', 'party-vice-president', 'party-chair', 'party-vice-chair',
    'party-general-secretary', 'party-secretary', 'party-chief-whip', 'party-group-leader'];
  const officeRank = (/** @type {string} */ kind) => (OFFICE_ORDER.includes(kind) ? OFFICE_ORDER.indexOf(kind) : OFFICE_ORDER.length);
  /** @type {Record<string, string>} */
  const EVENT_TEXT = {
    founded: 'Founded.', dissolved: 'Dissolved.', renamed: 'Renamed.', 'merged-into': 'Merged into another party.',
    'split-from': 'Formed by a split.', split: 'Split.', 'began-organising-in-ni': 'Began organising in Northern Ireland.',
    'first-contested': 'First contested an election.', 'last-contested': 'Last contested an election.', suspended: 'Suspended.',
    're-formed': 'Re-formed.', registered: 'Registered.'
  };
  const titleOf = (/** @type {string} */ slug) => partyBySlug.get(slug)?.title || registry.get(slug)?.name || slug;

  // Candidacies by party and election, and each party's members.
  /** @type {Map<string, Map<string, { candidates: number, elected: number, votes: number, votesKnown: number, constituencies: Set<string> }>>} */
  const candidacies = new Map(); // slug -> key -> { candidates, elected, votes, constituencies:Set }
  /** @type {Map<string, Map<string, { slug: string, name?: string, elected: number, contests: number, years: number[], bodies: Set<string> }>>} */
  const members = new Map(); // slug -> personSlug -> stats
  for (const person of persons) {
    for (const row of person.elections || []) {
      const slug = slugOfLabel(row.party);
      if (!slug || !row.key) continue;
      // each Map key below was set on the line before if it was missing
      if (!candidacies.has(slug)) candidacies.set(slug, new Map());
      const byKey = /** @type {NonNullable<ReturnType<typeof candidacies.get>>} */ (candidacies.get(slug));
      if (!byKey.has(row.key)) byKey.set(row.key, { candidates: 0, elected: 0, votes: 0, votesKnown: 0, constituencies: new Set() });
      const cell = /** @type {NonNullable<ReturnType<typeof byKey.get>>} */ (byKey.get(row.key));
      cell.candidates += 1;
      if (row.elected) cell.elected += 1;
      // num() was not null on the test before
      if (num(row.firstPrefs) !== null) { cell.votes += /** @type {number} */ (num(row.firstPrefs)); cell.votesKnown += 1; }
      if (row.constituency) cell.constituencies.add(row.constituency);
      if (!members.has(slug)) members.set(slug, new Map());
      const byPerson = /** @type {NonNullable<ReturnType<typeof members.get>>} */ (members.get(slug));
      if (!byPerson.has(person.slug)) byPerson.set(person.slug, { slug: person.slug, name: person.name || person.title, elected: 0, contests: 0, years: [], bodies: new Set() });
      const member = /** @type {NonNullable<ReturnType<typeof byPerson.get>>} */ (byPerson.get(person.slug));
      member.contests += 1;
      const year = Number(row.year || String(row.date || '').slice(0, 4)) || null;
      if (year) member.years.push(year);
      if (row.elected) {
        member.elected += 1;
        const group = bodyGroupOf(row.key);
        if (group) member.bodies.add(group.label);
      }
    }
  }

  /** @type {Map<string, LineageEvent[]>} */
  const lineageByParty = new Map();
  for (const event of lineage.events || []) {
    if (!lineageByParty.has(event.party)) lineageByParty.set(event.party, []);
    // the key was set on the line before if it was missing
    /** @type {LineageEvent[]} */ (lineageByParty.get(event.party)).push(event);
  }

  if (!CHECK) {
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
  }

  let written = 0;
  let withHistory = 0;
  let withLeaders = 0;
  for (const party of parties) {
    const slug = party.slug;
    const detail = readJson(path.join(BROWSE, 'details', 'parties', `${slug}.json`), /** @type {{ item?: { relatedElections?: SummaryRow[] } }} */ ({ item: {} })).item || {};
    const entry = registry.get(slug);
    const wd = wikidata.matches?.[slug];
    const events = lineageByParty.get(slug) || [];
    const registryIds = registryIdsBySlug.get(slug) || [];

    // Elections: the party row of each election's summary, completed from the candidacies.
    /** @type {Map<string, { key: string, summary?: SummaryRow }>} */
    const byKey = new Map();
    for (const row of detail.relatedElections || []) byKey.set(row.key, { key: row.key, summary: row });
    for (const key of candidacies.get(slug)?.keys() || []) if (!byKey.has(key)) byKey.set(key, { key });
    /** @type {Map<string, BodyChart>} */
    const bodies = new Map();
    for (const { key, summary } of byKey.values()) {
      const group = bodyGroupOf(key);
      if (!group) continue;
      // an election missing from elections.json reads as one with no fields
      const election = electionByKey.get(key) || /** @type {Partial<ElectionItem>} */ ({});
      const cell = candidacies.get(slug)?.get(key);
      const seats = num(summary?.seats) ?? (cell ? cell.elected : null);
      const candidates = num(summary?.stood) || (cell ? cell.candidates : null);
      // An election returned unopposed carries a count of returns, not votes, in some summaries
      // (1921: 124 "votes" for 124 Sinn Féin members, a "valid poll" of 128). A poll under ten
      // votes a seat, or votes no more than the candidates, is that count: no votes, no share.
      const seatsTotal = num(election.totals?.seats);
      // the test before saw totals.validPoll, a number
      const pollIsReturns = num(election.totals?.validPoll) !== null && seatsTotal && /** @type {number} */ (num(/** @type {ElectionTotals} */ (election.totals).validPoll)) <= seatsTotal * 10;
      const rawVotes = num(summary?.votes) || (cell && cell.votesKnown ? cell.votes : null);
      const votes = pollIsReturns || (rawVotes && candidates && rawVotes <= candidates) ? null : rawVotes;
      const validPoll = pollIsReturns ? null : num(election.totals?.validPoll);
      const share = votes === null ? null : num(summary?.share) ?? (validPoll ? (votes / validPoll) * 100 : null);
      if (!bodies.has(group.id)) bodies.set(group.id, { id: group.id, label: group.label, note: group.note, elections: [] });
      // the key was set on the line before if it was missing
      /** @type {BodyChart} */ (bodies.get(group.id)).elections.push(compact({
        key,
        title: election.title || summary?.title || key,
        date: election.date || summary?.date,
        kind: election.kind === 'by-election' ? 'by-election' : undefined,
        body: election.body,
        contests: cell ? cell.constituencies.size : undefined,
        candidates: candidates || undefined,
        seats: seats ?? undefined,
        seatsTotal: num(election.totals?.seats) || undefined,
        votes: votes || undefined,
        validPoll: validPoll || undefined,
        share: share === null ? undefined : round(share, 2)
      }));
    }
    const bodyList = [...bodies.values()].map((body) => {
      body.elections.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const sum = (/** @type {'candidates' | 'seats' | 'votes'} */ field) => body.elections.reduce((total, row) => total + (Number(row[field]) || 0), 0);
      // A council round is many elections on one day; the chart takes one point per day.
      /** @type {Map<string, { date: string, seats: number, candidates: number, votes: number, validPoll: number, pollKnown: boolean, shares: number[], count: number }>} */
      const points = new Map();
      for (const row of body.elections) {
        if (row.kind === 'by-election' || !row.date) continue;
        const point = points.get(row.date) || { date: row.date, seats: 0, candidates: 0, votes: 0, validPoll: 0, pollKnown: true, shares: [], count: 0 };
        point.seats += Number(row.seats) || 0;
        point.candidates += Number(row.candidates) || 0;
        point.votes += Number(row.votes) || 0;
        if (row.validPoll) point.validPoll += row.validPoll; else point.pollKnown = false;
        if (row.share !== undefined) point.shares.push(row.share);
        point.count += 1;
        points.set(row.date, point);
      }
      const series = [...points.values()].map((point) => compact({
        date: point.date,
        seats: point.seats,
        candidates: point.candidates || undefined,
        votes: point.votes || undefined,
        share: point.count === 1 ? point.shares[0]
          : point.pollKnown && point.validPoll && point.votes ? round((point.votes / point.validPoll) * 100, 2) : undefined
      }));
      return compact({
        id: body.id,
        label: body.label,
        // a missing date compares as not before 1973
        note: body.id === 'councils-ni' && body.elections.some((row) => /** @type {string} */ (row.date) < '1973') ? body.note : undefined,
        totals: compact({ elections: body.elections.length, candidates: sum('candidates') || undefined, seats: sum('seats'), votes: sum('votes') || undefined }),
        series,
        elections: body.elections
      });
    }).sort((a, b) => BODY_GROUPS.findIndex((g) => g.id === a.id) - BODY_GROUPS.findIndex((g) => g.id === b.id));

    // Dates, each with its source.
    const registryCitation = entry?.source ? { title: `Civgraph party registry (${entry.source})` } : null;
    /** @type {DateFact | null} */
    const founded = entry?.founded && entry.source
      ? { date: entry.founded, precision: entry.foundedPrecision || 'day', source: 'registry', citations: [registryCitation] }
      : (() => {
        const event = events.find((e) => e.kind === 'founded' && e.date);
        // the find kept an event with a date
        if (event) return { date: /** @type {string} */ (event.date), precision: event.precision, source: 'lineage', basis: event.basis, citations: event.citations };
        if (wd?.inception) return { date: wd.inception.date, precision: wd.inception.precision, source: 'wikidata', citations: [wikidataCitation(wd.qid, wd.label), ...(wd.inception.refs || []).filter((r) => r.url).map((r) => ({ title: 'Reference given on Wikidata', url: r.url }))] };
        return null;
      })();
    /** @type {DateFact | null} */
    const dissolved = entry?.dissolved && entry.source
      ? { date: entry.dissolved, precision: 'day', source: 'registry', citations: [registryCitation] }
      : wd?.dissolved ? { date: wd.dissolved.date, precision: wd.dissolved.precision, source: 'wikidata', citations: [wikidataCitation(wd.qid, wd.label)] } : null;
    // No dissolution date is not proof a party still exists, so 'active' comes only from the registry.
    const status = entry?.status && entry.status !== 'unknown' && entry.source ? entry.status : dissolved ? 'dissolved' : undefined;
    /** @type {DateFact[]} */
    const otherFoundingDates = [];
    if (founded && wd?.inception && founded.source !== 'wikidata' && wd.inception.date.slice(0, 4) !== founded.date.slice(0, 4)) {
      otherFoundingDates.push({ date: wd.inception.date, source: 'wikidata', citations: [wikidataCitation(wd.qid, wd.label)] });
    }

    // Lineage: cited events, the registry's links, and Wikidata's follows / followed by.
    /** @type {TimelineItem[]} */
    const timeline = [];
    if (founded) timeline.push({ date: founded.date, precision: founded.precision, kind: 'founded', text: 'Founded.', source: founded.source, basis: founded.basis, citations: founded.citations });
    for (const event of events) {
      if (event.kind === 'founded' && founded?.source === 'lineage' && event.date === founded.date) {
        Object.assign(timeline[0], { text: event.text, related: event.related, note: event.note });
        continue;
      }
      timeline.push({ date: event.date, precision: event.precision, kind: event.kind, text: event.text, basis: event.basis, note: event.note, related: event.related, source: 'lineage', citations: event.citations });
    }
    if (dissolved) timeline.push({ date: dissolved.date, precision: dissolved.precision, kind: 'dissolved', text: 'Dissolved.', source: dissolved.source, citations: dissolved.citations });
    // Cited events from the facts model (party-events.json). One the timeline already holds
    // (the registry's founding day) gains the citation instead of appearing twice.
    const factEvents = registryIds.flatMap((id) => factsIndex.eventsByParty.get(id) || []);
    for (const event of factEvents) {
      const citations = (event.citations || []).map(shortCitation);
      const same = timeline.find((t) => t.kind === event.type && t.date && (String(t.date).startsWith(event.date) || event.date.startsWith(String(t.date))));
      if (same) {
        same.citations = [...(same.citations || []), ...citations];
        continue;
      }
      timeline.push(compact({
        date: event.date, precision: event.precision, kind: event.type,
        text: event.note ? `${EVENT_TEXT[event.type] || 'Event.'} ${event.note}` : (EVENT_TEXT[event.type] || 'Event.'),
        related: (event.relatedParties || []).map((r) => ({ party: r.partyId, relation: r.relation })),
        persons: (event.persons || []).map((p) => ({ ...personRef(p.personId), role: p.role })),
        source: 'party-events', citations
      }));
    }
    // a body is charted only with its elections
    const firstElection = bodyList.flatMap((b) => /** @type {ElectionRow[]} */ (b.elections)).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    const lastElection = bodyList.flatMap((b) => /** @type {ElectionRow[]} */ (b.elections)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (firstElection?.date) timeline.push({ date: firstElection.date, precision: 'day', kind: 'first-contest', text: `First contest in Civgraph's records: ${firstElection.title}.`, electionKey: firstElection.key, source: 'elections' });
    if (lastElection?.date && lastElection.key !== firstElection?.key) timeline.push({ date: lastElection.date, precision: 'day', kind: 'last-contest', text: `Latest contest in Civgraph's records: ${lastElection.title}.`, electionKey: lastElection.key, source: 'elections' });
    timeline.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const item of timeline) {
      if (item.related) item.related = item.related.map((r) => {
        // before this pass every related party names its party
        const target = partyBySlug.has(/** @type {string} */ (r.party)) ? r.party : slugOfParty(r.party);
        return compact({ slug: target || undefined, title: target ? titleOf(target) : titleOf(/** @type {string} */ (r.party)), relation: r.relation });
      });
    }

    /** @type {Relation[]} */
    const relations = [];
    /**
     * @param {string} relation
     * @param {{ slug?: string, title?: string, label?: string, qid?: string, source: string }} target
     */
    const addRelation = (relation, target) => {
      if (!target.title || relations.some((r) => (r.slug ? r.slug === target.slug : r.title === target.title))) return;
      relations.push(compact({ relation, ...target }));
    };
    for (const item of timeline) for (const r of item.related || []) {
      // every related party names its relation
      const relation = /split from|renamed from|stood as/.test(/** @type {string} */ (r.relation)) ? 'predecessor' : /split into|renamed/.test(/** @type {string} */ (r.relation)) ? 'successor' : 'related';
      addRelation(relation, { slug: r.slug, title: r.title, label: r.relation, source: 'lineage' });
    }
    for (const [field, relation] of /** @type {['splitFrom' | 'predecessor' | 'successor', string][]} */ ([['splitFrom', 'predecessor'], ['predecessor', 'predecessor'], ['successor', 'successor']])) {
      // filter(Boolean) dropped the missing
      for (const target of /** @type {string[]} */ ([entry?.[field]].flat().filter(Boolean))) {
        addRelation(relation, { slug: partyBySlug.has(target) ? target : undefined, title: titleOf(target), label: field === 'splitFrom' ? 'split from' : field, source: 'registry' });
      }
    }
    // Wikidata's replaces / replaced by is succession; its looser follows / followed by is
    // shown only as a related party, labelled as Wikidata states it.
    for (const [list, relation, label] of /** @type {[WdLink[] | undefined, string, string][]} */ ([[wd?.replaces, 'predecessor', 'replaces, per Wikidata'], [wd?.replacedBy, 'successor', 'replaced by, per Wikidata'],
      [wd?.follows, 'related', 'follows, per Wikidata'], [wd?.followedBy, 'related', 'followed by, per Wikidata']])) {
      for (const target of list || []) {
        addRelation(relation, { slug: target.civgraphSlug && partyBySlug.has(target.civgraphSlug) ? target.civgraphSlug : undefined, title: target.civgraphSlug ? titleOf(target.civgraphSlug) : target.label, qid: target.qid, label, source: 'wikidata' });
      }
    }

    // Leaders and officers from the facts model's tenures (each cited), leader first.
    const officerOffices = registryIds.flatMap((id) => factsIndex.officesByParty.get(id) || []);
    const officers = officerOffices.flatMap((office) => (factsIndex.tenuresByOffice.get(office.id) || []).map((t) => compact({
      office: office.name, officeSlug: office.id, kind: office.kind, ...personRef(t.personId),
      start: t.start, end: t.end, held: formatSpan(t.start, t.end), began: t.began || undefined, ended: t.ended || undefined,
      contestKey: t.contest || undefined, citations: (t.citations || []).map(shortCitation)
    }))).sort((a, b) => (officeRank(a.kind) - officeRank(b.kind))
      // every office has a name
      || /** @type {string} */ (a.office).localeCompare(/** @type {string} */ (b.office)) || 0);
    // The party's own ballots (leadership and nomination contests) and their results.
    // an undefined partyId is in no list
    const internalContests = internalBodies.filter((b) => registryIds.includes(/** @type {string} */ (b.partyId))).flatMap((b) => (b.dates || []).map((d) => {
      const key = `${b.slug}__${d.date}`;
      const bundle = readJson(path.join(ELECTION_BUNDLE_DIR, `${key}.json`), /** @type {InternalBundle | null} */ (null));
      // an election missing from elections.json reads as one with no fields
      const election = electionByKey.get(key) || /** @type {Partial<ElectionItem>} */ ({});
      return compact({
        key, body: b.name, date: d.date, title: election.title || bundle?.displayTitle || `${d.date} ${b.name}`,
        ballots: (bundle?.results || []).map((r) => compact({
          name: r.constituency,
          candidates: (r.candidates || []).map((c) => compact({
            ...(c.personId ? personRef(c.personId) : {}), name: c.name,
            votes: num(c.firstPrefs ?? c.votes) ?? undefined, elected: c.elected ? true : undefined
          }))
        }))
      });
    })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const leaders = (wd?.leaders || []).map((leader) => compact({
      name: leader.name, qid: leader.qid, start: leader.start?.date, end: leader.end?.date, office: leader.officeLabel, officeQid: leader.office
    }));
    const notable = [...(members.get(slug)?.values() || [])]
      .filter((member) => member.elected > 0)
      // a person row has a name or a title
      .sort((a, b) => (b.elected - a.elected) || (b.contests - a.contests) || /** @type {string} */ (a.name).localeCompare(/** @type {string} */ (b.name)))
      .slice(0, NOTABLE_LIMIT)
      .map((member) => ({
        slug: member.slug,
        name: member.name,
        elected: member.elected,
        contests: member.contests,
        firstYear: Math.min(...member.years),
        lastYear: Math.max(...member.years),
        bodies: [...member.bodies]
      }));

    /** @type {{ title: string, url?: string, use: string }[]} */
    const sources = [];
    if (registryCitation && (founded?.source === 'registry' || dissolved?.source === 'registry')) sources.push({ ...registryCitation, use: 'founding and dissolution dates' });
    if (events.length) sources.push({ title: lineage.sources?.irda || 'Party lineage research', use: 'lineage events (each event cites its documents)' });
    if (wd) sources.push({ title: `Wikidata ${wd.qid}, ${wd.label} (CC0, retrieved ${wikidata.retrieved})`, url: `https://www.wikidata.org/wiki/${wd.qid}`, use: [leaders.length ? 'leaders' : null, wd.ideologies?.length ? 'ideology' : null, founded?.source === 'wikidata' ? 'founding date' : null, dissolved?.source === 'wikidata' ? 'dissolution date' : null].filter(Boolean).join(', ') || 'identification' });
    if (bodyList.length) sources.push({ title: 'Civgraph election records', use: 'contests, candidates, seats and votes; each election\'s page lists the sources of its results' });

    const profile = compact({
      schemaVersion: 1,
      slug,
      title: party.title,
      founded: founded ? compact(founded) : undefined,
      dissolved: dissolved ? compact(dissolved) : undefined,
      otherFoundingDates,
      status,
      timeline: timeline.map(compact),
      relations,
      officers,
      internalContests,
      leaders,
      // leaders come only from wd
      leadersSource: leaders.length ? compact({ qid: /** @type {WdMatch} */ (wd).qid, offices: /** @type {WdMatch} */ (wd).offices, retrieved: wikidata.retrieved }) : undefined,
      ideologies: (wd?.ideologies || []).map((i) => ({ label: i.label, qid: i.qid })),
      alignment: (wd?.alignment || []).map((i) => ({ label: i.label, qid: i.qid })),
      wikidata: wd ? compact({ qid: wd.qid, label: wd.label, description: wd.description, enwiki: wd.enwiki, retrieved: wikidata.retrieved }) : undefined,
      bodies: bodyList,
      notableMembers: notable,
      sources
    });
    if (factEvents.length || officers.length) sources.push({ title: 'Civgraph facts model: offices, tenures and party events', use: 'leaders and officers, and dated events (each cites its source and page)' });
    if (!bodyList.length && !wd && !events.length && !founded && !officers.length && !factEvents.length) continue;
    if (timeline.some((t) => t.source !== 'elections')) withHistory += 1;
    if (leaders.length || officers.length) withLeaders += 1;
    written += 1;
    if (!CHECK) writeFileSync(path.join(OUT_DIR, `${slug}.json`), JSON.stringify(profile));
    // A folded label's old address opens its party, so its profile does too.
    for (const old of party.previousSlugs || []) if (!CHECK) writeFileSync(path.join(OUT_DIR, `${old}.json`), JSON.stringify(profile));
  }
  console.log(`${CHECK ? 'would write' : 'wrote'} ${written} party profiles (${withHistory} with dated history, ${withLeaders} with leaders) -> data/browse/party-profiles/`);
}

main();
