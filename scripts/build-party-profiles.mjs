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
 *                                                            scripts/fetch-party-wikidata.mjs
 *
 * Precedence for a date: the curated registry, then a cited lineage event, then Wikidata.
 * Every fact carries its source. Run after scripts/build-browse-indexes.mjs (npm run build:browse).
 *
 * Usage: node scripts/build-party-profiles.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BROWSE_DIR } from './records/paths.mjs';

const ROOT = process.cwd();
const BROWSE = BROWSE_DIR;
const OUT_DIR = path.join(BROWSE, 'party-profiles');
const CHECK = process.argv.includes('--check');
const NOTABLE_LIMIT = 15;

const readJson = (rel, fallback) => {
  const full = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : fallback;
};
const normalizeName = (value) => String(value || '').replace(/\s+/g, ' ').trim()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''
  && !(Array.isArray(value) && !value.length)));
const round = (value, places = 2) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);
const num = (value) => (value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

// The bodies a profile charts, in the order they are shown. A key's prefix is its body.
const BODY_GROUPS = [
  { id: 'westminster', label: 'House of Commons (Westminster)', test: (p) => p === 'house-of-commons-of-the-united-kingdom' },
  { id: 'stormont', label: 'Parliament of Northern Ireland (Stormont)', test: (p) => p === 'parliament-of-northern-ireland' },
  { id: 'ni-assembly', label: 'Northern Ireland Assembly', test: (p) => p === 'northern-ireland-assembly' },
  { id: 'ni-convention', label: 'Northern Ireland Constitutional Convention', test: (p) => p === 'northern-ireland-constitutional-convention' },
  { id: 'ni-forum', label: 'Northern Ireland Forum', test: (p) => p === 'northern-ireland-forum-for-political-dialogue' },
  { id: 'dail', label: 'Dáil Éireann', test: (p) => p === 'dail-eireann' },
  { id: 'seanad', label: 'Seanad Éireann', test: (p) => p.startsWith('seanad') },
  { id: 'european-ni', label: 'European Parliament (Northern Ireland)', test: (p) => p === 'european-parliament' },
  { id: 'european-ie', label: 'European Parliament (Ireland)', test: (p) => p === 'ireland-european' },
  { id: 'councils-ni', label: 'Councils in Northern Ireland', test: (p) => p.startsWith('local-government') || /council/.test(p),
    note: 'Before 1973 Civgraph holds the results of only some councils, so these rounds are not comparable with the district council elections from 1973.' },
  { id: 'councils-ie', label: 'Local elections in Ireland', test: (p) => p === 'ireland-local' },
  { id: 'president', label: 'President of Ireland', test: (p) => p === 'ireland-president' }
];
const bodyGroupOf = (key) => {
  const prefix = String(key).split('__')[0];
  if (/referendum/.test(prefix)) return null;
  return BODY_GROUPS.find((group) => group.test(prefix)) || { id: prefix, label: prefix };
};

function readPersons() {
  const manifest = readJson(path.join(BROWSE, 'persons.json'), { shards: [] });
  const persons = [];
  for (const shard of manifest.shards || []) {
    const data = readJson(path.join(BROWSE, 'person-shards', shard.name), { items: [] });
    persons.push(...(data.items || []));
  }
  return persons;
}

function wikidataCitation(qid, label) {
  return { title: `Wikidata ${qid}${label ? ` (${label})` : ''}`, url: `https://www.wikidata.org/wiki/${qid}` };
}

function main() {
  const parties = readJson(path.join(BROWSE, 'parties.json'), { items: [] }).items || [];
  const partyBySlug = new Map(parties.map((party) => [party.slug, party]));
  const partyNames = readJson(path.join(BROWSE, 'party-names.json'), { items: {} }).items || {};
  const elections = (readJson(path.join(BROWSE, 'elections.json'), { items: [] }).items || [])
    .filter((entry) => !entry.entryKind || entry.entryKind === 'election');
  const electionByKey = new Map(elections.map((entry) => [entry.key, entry]));
  const registry = new Map((readJson('data/elections/parties/party_registry.json', { entities: [] }).entities || []).map((entry) => [entry.id, entry]));
  const lineage = readJson('data/elections/parties/party-lineage.json', { events: [] });
  const wikidata = readJson('data/elections/parties/party-wikidata.json', { matches: {} });
  const persons = readPersons();
  const slugOfLabel = (label) => partyNames[normalizeName(label)] || null;
  const titleOf = (slug) => partyBySlug.get(slug)?.title || registry.get(slug)?.name || slug;

  // Candidacies by party and election, and each party's members.
  const candidacies = new Map(); // slug -> key -> { candidates, elected, votes, constituencies:Set }
  const members = new Map(); // slug -> personSlug -> stats
  for (const person of persons) {
    for (const row of person.elections || []) {
      const slug = slugOfLabel(row.party);
      if (!slug || !row.key) continue;
      if (!candidacies.has(slug)) candidacies.set(slug, new Map());
      const byKey = candidacies.get(slug);
      if (!byKey.has(row.key)) byKey.set(row.key, { candidates: 0, elected: 0, votes: 0, votesKnown: 0, constituencies: new Set() });
      const cell = byKey.get(row.key);
      cell.candidates += 1;
      if (row.elected) cell.elected += 1;
      if (num(row.firstPrefs) !== null) { cell.votes += num(row.firstPrefs); cell.votesKnown += 1; }
      if (row.constituency) cell.constituencies.add(row.constituency);
      if (!members.has(slug)) members.set(slug, new Map());
      const byPerson = members.get(slug);
      if (!byPerson.has(person.slug)) byPerson.set(person.slug, { slug: person.slug, name: person.name || person.title, elected: 0, contests: 0, years: [], bodies: new Set() });
      const member = byPerson.get(person.slug);
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

  const lineageByParty = new Map();
  for (const event of lineage.events || []) {
    if (!lineageByParty.has(event.party)) lineageByParty.set(event.party, []);
    lineageByParty.get(event.party).push(event);
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
    const detail = readJson(path.join(BROWSE, 'details', 'parties', `${slug}.json`), { item: {} }).item || {};
    const entry = registry.get(slug);
    const wd = wikidata.matches?.[slug];
    const events = lineageByParty.get(slug) || [];

    // Elections: the party row of each election's summary, completed from the candidacies.
    const byKey = new Map();
    for (const row of detail.relatedElections || []) byKey.set(row.key, { key: row.key, summary: row });
    for (const key of candidacies.get(slug)?.keys() || []) if (!byKey.has(key)) byKey.set(key, { key });
    const bodies = new Map();
    for (const { key, summary } of byKey.values()) {
      const group = bodyGroupOf(key);
      if (!group) continue;
      const election = electionByKey.get(key) || {};
      const cell = candidacies.get(slug)?.get(key);
      const seats = num(summary?.seats) ?? (cell ? cell.elected : null);
      const candidates = num(summary?.stood) || (cell ? cell.candidates : null);
      // An election returned unopposed carries a count of returns, not votes, in some summaries
      // (1921: 124 "votes" for 124 Sinn Féin members, a "valid poll" of 128). A poll under ten
      // votes a seat, or votes no more than the candidates, is that count: no votes, no share.
      const seatsTotal = num(election.totals?.seats);
      const pollIsReturns = num(election.totals?.validPoll) !== null && seatsTotal && num(election.totals.validPoll) <= seatsTotal * 10;
      const rawVotes = num(summary?.votes) || (cell && cell.votesKnown ? cell.votes : null);
      const votes = pollIsReturns || (rawVotes && candidates && rawVotes <= candidates) ? null : rawVotes;
      const validPoll = pollIsReturns ? null : num(election.totals?.validPoll);
      const share = votes === null ? null : num(summary?.share) ?? (validPoll ? (votes / validPoll) * 100 : null);
      if (!bodies.has(group.id)) bodies.set(group.id, { id: group.id, label: group.label, note: group.note, elections: [] });
      bodies.get(group.id).elections.push(compact({
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
      const sum = (field) => body.elections.reduce((total, row) => total + (Number(row[field]) || 0), 0);
      // A council round is many elections on one day; the chart takes one point per day.
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
        note: body.id === 'councils-ni' && body.elections.some((row) => row.date < '1973') ? body.note : undefined,
        totals: compact({ elections: body.elections.length, candidates: sum('candidates') || undefined, seats: sum('seats'), votes: sum('votes') || undefined }),
        series,
        elections: body.elections
      });
    }).sort((a, b) => BODY_GROUPS.findIndex((g) => g.id === a.id) - BODY_GROUPS.findIndex((g) => g.id === b.id));

    // Dates, each with its source.
    const registryCitation = entry?.source ? { title: `Civgraph party registry (${entry.source})` } : null;
    const founded = entry?.founded && entry.source
      ? { date: entry.founded, precision: entry.foundedPrecision || 'day', source: 'registry', citations: [registryCitation] }
      : (() => {
        const event = events.find((e) => e.kind === 'founded' && e.date);
        if (event) return { date: event.date, precision: event.precision, source: 'lineage', basis: event.basis, citations: event.citations };
        if (wd?.inception) return { date: wd.inception.date, precision: wd.inception.precision, source: 'wikidata', citations: [wikidataCitation(wd.qid, wd.label), ...(wd.inception.refs || []).filter((r) => r.url).map((r) => ({ title: 'Reference given on Wikidata', url: r.url }))] };
        return null;
      })();
    const dissolved = entry?.dissolved && entry.source
      ? { date: entry.dissolved, precision: 'day', source: 'registry', citations: [registryCitation] }
      : wd?.dissolved ? { date: wd.dissolved.date, precision: wd.dissolved.precision, source: 'wikidata', citations: [wikidataCitation(wd.qid, wd.label)] } : null;
    // No dissolution date is not proof a party still exists, so 'active' comes only from the registry.
    const status = entry?.status && entry.status !== 'unknown' && entry.source ? entry.status : dissolved ? 'dissolved' : undefined;
    const otherFoundingDates = [];
    if (founded && wd?.inception && founded.source !== 'wikidata' && wd.inception.date.slice(0, 4) !== founded.date.slice(0, 4)) {
      otherFoundingDates.push({ date: wd.inception.date, source: 'wikidata', citations: [wikidataCitation(wd.qid, wd.label)] });
    }

    // Lineage: cited events, the registry's links, and Wikidata's follows / followed by.
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
    const firstElection = bodyList.flatMap((b) => b.elections).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    const lastElection = bodyList.flatMap((b) => b.elections).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (firstElection?.date) timeline.push({ date: firstElection.date, precision: 'day', kind: 'first-contest', text: `First contest in Civgraph's records: ${firstElection.title}.`, electionKey: firstElection.key, source: 'elections' });
    if (lastElection?.date && lastElection.key !== firstElection?.key) timeline.push({ date: lastElection.date, precision: 'day', kind: 'last-contest', text: `Latest contest in Civgraph's records: ${lastElection.title}.`, electionKey: lastElection.key, source: 'elections' });
    timeline.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const item of timeline) {
      if (item.related) item.related = item.related.map((r) => compact({ slug: partyBySlug.has(r.party) ? r.party : undefined, title: titleOf(r.party), relation: r.relation }));
    }

    const relations = [];
    const addRelation = (relation, target) => {
      if (!target.title || relations.some((r) => (r.slug ? r.slug === target.slug : r.title === target.title))) return;
      relations.push(compact({ relation, ...target }));
    };
    for (const item of timeline) for (const r of item.related || []) {
      const relation = /split from|renamed from|stood as/.test(r.relation) ? 'predecessor' : /split into|renamed/.test(r.relation) ? 'successor' : 'related';
      addRelation(relation, { slug: r.slug, title: r.title, label: r.relation, source: 'lineage' });
    }
    for (const [field, relation] of [['splitFrom', 'predecessor'], ['predecessor', 'predecessor'], ['successor', 'successor']]) {
      for (const target of [entry?.[field]].flat().filter(Boolean)) {
        addRelation(relation, { slug: partyBySlug.has(target) ? target : undefined, title: titleOf(target), label: field === 'splitFrom' ? 'split from' : field, source: 'registry' });
      }
    }
    // Wikidata's replaces / replaced by is succession; its looser follows / followed by is
    // shown only as a related party, labelled as Wikidata states it.
    for (const [list, relation, label] of [[wd?.replaces, 'predecessor', 'replaces, per Wikidata'], [wd?.replacedBy, 'successor', 'replaced by, per Wikidata'],
      [wd?.follows, 'related', 'follows, per Wikidata'], [wd?.followedBy, 'related', 'followed by, per Wikidata']]) {
      for (const target of list || []) {
        addRelation(relation, { slug: target.civgraphSlug && partyBySlug.has(target.civgraphSlug) ? target.civgraphSlug : undefined, title: target.civgraphSlug ? titleOf(target.civgraphSlug) : target.label, qid: target.qid, label, source: 'wikidata' });
      }
    }

    const leaders = (wd?.leaders || []).map((leader) => compact({
      name: leader.name, qid: leader.qid, start: leader.start?.date, end: leader.end?.date, office: leader.officeLabel, officeQid: leader.office
    }));
    const notable = [...(members.get(slug)?.values() || [])]
      .filter((member) => member.elected > 0)
      .sort((a, b) => (b.elected - a.elected) || (b.contests - a.contests) || a.name.localeCompare(b.name))
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
      leaders,
      leadersSource: leaders.length ? compact({ qid: wd.qid, offices: wd.offices, retrieved: wikidata.retrieved }) : undefined,
      ideologies: (wd?.ideologies || []).map((i) => ({ label: i.label, qid: i.qid })),
      alignment: (wd?.alignment || []).map((i) => ({ label: i.label, qid: i.qid })),
      wikidata: wd ? compact({ qid: wd.qid, label: wd.label, description: wd.description, enwiki: wd.enwiki, retrieved: wikidata.retrieved }) : undefined,
      bodies: bodyList,
      notableMembers: notable,
      sources
    });
    if (!bodyList.length && !wd && !events.length && !founded) continue;
    if (timeline.some((t) => t.source !== 'elections')) withHistory += 1;
    if (leaders.length) withLeaders += 1;
    written += 1;
    if (!CHECK) writeFileSync(path.join(OUT_DIR, `${slug}.json`), JSON.stringify(profile));
    // A folded label's old address opens its party, so its profile does too.
    for (const old of party.previousSlugs || []) if (!CHECK) writeFileSync(path.join(OUT_DIR, `${old}.json`), JSON.stringify(profile));
  }
  console.log(`${CHECK ? 'would write' : 'wrote'} ${written} party profiles (${withHistory} with dated history, ${withLeaders} with leaders) -> data/browse/party-profiles/`);
}

main();
