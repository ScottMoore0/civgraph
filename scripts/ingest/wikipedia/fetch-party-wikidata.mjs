#!/usr/bin/env node
/**
 * Match Civgraph's parties to Wikidata (CC0) and keep the facts the party profiles use:
 * inception and dissolution dates, the leaders' terms, ideology and political alignment,
 * predecessors and successors, and the English Wikipedia article.
 *
 * Output: data/elections/parties/party-wikidata.json, a committed input to
 * scripts/build/build-party-profiles.mjs (the build never calls Wikidata).
 *
 * MATCHING. Civgraph's parties carry no Wikidata or Wikipedia ids, so a party is matched by
 * name, and only when the match is unambiguous:
 *   - a Wikidata item whose English or Irish label or alias is exactly the party's name,
 *     full name or short name (folded for accents, case and punctuation);
 *   - that is a political party (P31 Q7278, or described as a party);
 *   - in Ireland or the United Kingdom (P17, or its description says so);
 *   - whose inception and dissolution, where Wikidata has them, overlap the years the party
 *     appears in Civgraph's elections.
 * Exactly one candidate passing all four is a match. Anything else is written to `uncertain`
 * with its candidates and is not used: an owner adds a confirmed pairing to
 * data/elections/parties/party-wikidata-overrides.json ({ "<slug>": "Q123" }, or null to
 * refuse a match) and re-runs this script.
 *
 * LEADERS. Wikidata models a party leader as the holder (P39) of an office item such as
 * "Leader of Fianna Fáil" (Q16257756). The office is found by its exact English label
 * ("Leader of <party>", "President of <party>", ...) or by P2388/P2389 links to the party.
 * A term wholly inside another holder's term on the same office is dropped and reported:
 * Wikidata lists some deputy leaders under the leader's office (Fianna Fáil, 1995-2002).
 *
 * Politeness: one request at a time, a pause between requests and maxlag=5. No User-Agent of
 * ours is sent (crawlHeaders(), owner rule 13 Nov 2026: the fetch default applies), and no
 * personal identifiers.
 *
 * Usage: node scripts/ingest/wikipedia/fetch-party-wikidata.mjs [--limit N]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { crawlHeaders } from '../../../packages/config/src/node.mjs';

const ROOT = process.cwd();
const OUT = 'data/elections/parties/party-wikidata.json';
const OVERRIDES = 'data/elections/parties/party-wikidata-overrides.json';
const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const PAUSE_MS = 400;
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const POLITICAL_PARTY = 'Q7278';
// Ireland, Northern Ireland, the UK, the UK of Great Britain and Ireland, the Irish Free State,
// the island of Ireland, Great Britain.
const COUNTRIES = new Set(['Q27', 'Q26', 'Q145', 'Q174193', 'Q31747', 'Q22890', 'Q23666', 'Q215530']);
const PLACE_WORDS = /\b(irish|ireland|northern ireland|ulster|british|united kingdom|uk|great britain|england|scotland|wales|belfast|dublin)\b/i;
// arch-ok R6: Browse slugs this lookup skips, not a registry list: referendum answers and the Ceann Comhairle are not in the party registry, and it files non-party as a party
const NOT_PARTIES = new Set(['independent', 'independent-other', 'yes', 'no', 'ceann-comhairle-speaker', 'non-party']);
const OFFICE_TITLES = ['Leader of', 'Leader of the', 'President of', 'President of the', 'Chairman of', 'Chairman of the', 'Chairperson of', 'Party Leader of'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = (rel, fallback) => (existsSync(path.join(ROOT, rel)) ? JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')) : fallback);
const fold = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

let requestCount = 0;
async function getJson(url, init = {}) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(PAUSE_MS * Math.min(attempt + 1, 4));
    requestCount += 1;
    let response;
    try {
      response = await fetch(url, { ...init, headers: crawlHeaders({ Accept: 'application/json', ...(init.headers || {}) }) });
    } catch (error) {
      // A dropped connection is retried after a pause, like a 5xx.
      await sleep(5000);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const wait = Number(response.headers.get('retry-after')) || 5;
      await sleep(wait * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} ${url.slice(0, 160)}`);
    const body = await response.json();
    if (body?.error?.code === 'maxlag') { await sleep(10000); continue; } // the servers are lagged: wait, as maxlag asks
    return body;
  }
  throw new Error(`gave up: ${url.slice(0, 160)}`);
}

const api = (params) => getJson(`${API}?${new URLSearchParams({ format: 'json', maxlag: '5', ...params })}`);
const sparql = (query) => getJson(`${SPARQL}?${new URLSearchParams({ query, format: 'json' })}`, { headers: { Accept: 'application/sparql-results+json' } });

async function getEntities(ids, props = 'labels|aliases|descriptions|claims|sitelinks') {
  const out = {};
  const list = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 50) {
    const body = await api({ action: 'wbgetentities', ids: list.slice(i, i + 50).join('|'), props, languages: 'en|ga', sitefilter: 'enwiki' });
    Object.assign(out, body.entities || {});
  }
  return out;
}

const claimIds = (entity, prop) => (entity?.claims?.[prop] || [])
  .filter((claim) => claim.rank !== 'deprecated')
  .map((claim) => claim.mainsnak?.datavalue?.value?.id).filter(Boolean);

function wikidataTime(snak) {
  const value = snak?.datavalue?.value;
  if (!value?.time) return null;
  const precision = value.precision >= 11 ? 'day' : value.precision === 10 ? 'month' : 'year';
  const [, year, month, day] = value.time.match(/^[+-](\d{4})-(\d{2})-(\d{2})/) || [];
  if (!year) return null;
  const date = precision === 'day' ? `${year}-${month}-${day}` : precision === 'month' ? `${year}-${month}` : year;
  return { date, precision };
}

function claimRefs(claim) {
  const refs = [];
  for (const reference of claim.references || []) {
    const snaks = reference.snaks || {};
    const url = snaks.P854?.[0]?.datavalue?.value;
    const statedIn = snaks.P248?.[0]?.datavalue?.value?.id;
    if (url || statedIn) refs.push(Object.fromEntries(Object.entries({ url, statedIn }).filter(([, v]) => v)));
  }
  return refs;
}

/** The best-ranked dated statement: preferred rank first, then the one with references. */
function bestTime(entity, prop) {
  const claims = (entity?.claims?.[prop] || []).filter((claim) => claim.rank !== 'deprecated' && wikidataTime(claim.mainsnak));
  if (!claims.length) return null;
  claims.sort((a, b) => (Number(b.rank === 'preferred') - Number(a.rank === 'preferred'))
    || (claimRefs(b).length - claimRefs(a).length));
  const chosen = claims[0];
  const others = claims.slice(1).map((claim) => wikidataTime(claim.mainsnak).date).filter((d) => d !== wikidataTime(chosen.mainsnak).date);
  return { ...wikidataTime(chosen.mainsnak), refs: claimRefs(chosen), ...(others.length ? { otherValues: [...new Set(others)] } : {}) };
}

const yearOf = (time) => (time?.date ? Number(time.date.slice(0, 4)) : null);

function entityNames(entity) {
  const names = [];
  for (const lang of ['en', 'ga']) {
    if (entity.labels?.[lang]) names.push(entity.labels[lang].value);
    for (const alias of entity.aliases?.[lang] || []) names.push(alias.value);
  }
  return names;
}

// Civgraph often titles a party by its ballot-paper form ("Irish Labour", "NI Labour",
// "Conservative"), so "<name> Party" and the spelled-out "Northern Ireland" are tried too.
function candidatesFor(party) {
  const names = [];
  for (const name of [party.title, party.registryName, party.shortName]) {
    if (!name || fold(name).length < 3) continue;
    const spelled = name.replace(/^NI\b/, 'Northern Ireland');
    names.push(name, spelled);
    if (!/\bparty$/i.test(name)) names.push(`${name} Party`, `${spelled} Party`);
  }
  return [...new Set(names)];
}

async function main() {
  const registry = readJson('data/elections/parties/party_registry.json', { entities: [] }).entities || [];
  const registryById = new Map(registry.map((entry) => [entry.id, entry]));
  const browse = readJson('data/browse/parties.json', { items: [] }).items || [];
  const overrides = readJson(OVERRIDES, {});
  const parties = browse.filter((party) => {
    if (ONLY) return party.slug === ONLY;
    if (NOT_PARTIES.has(party.slug) || /^independent/.test(party.slug)) return false;
    const entry = registryById.get(party.slug);
    if (entry) return entry.type === 'party';
    return !party.ballotLabel && (party.relatedElectionCount || 0) >= 2;
  }).slice(0, LIMIT).map((party) => ({
    slug: party.slug,
    title: party.title,
    shortName: party.shortName,
    registryName: registryById.get(party.slug)?.name,
    firstYear: party.firstYear,
    lastYear: party.lastYear
  }));
  console.log(`${parties.length} parties to match`);

  // 1. Search each name and gather candidate items.
  const searchHits = new Map();
  for (const party of parties) {
    const ids = new Set();
    if (typeof overrides[party.slug] === 'string') ids.add(overrides[party.slug]);
    for (const name of candidatesFor(party)) {
      const body = await api({ action: 'wbsearchentities', search: name, language: 'en', uselang: 'en', type: 'item', limit: '10' });
      for (const hit of body.search || []) ids.add(hit.id);
    }
    searchHits.set(party.slug, [...ids]);
  }
  const candidateEntities = await getEntities([...searchHits.values()].flat());

  // 2. Score the candidates.
  const matches = {};
  const uncertain = [];
  const unmatched = [];
  for (const party of parties) {
    const override = overrides[party.slug];
    if (override === null) { unmatched.push({ slug: party.slug, title: party.title, reason: 'refused by override' }); continue; }
    const wanted = new Set(candidatesFor(party).map(fold));
    const scored = [];
    for (const qid of searchHits.get(party.slug) || []) {
      const entity = candidateEntities[qid];
      if (!entity || entity.missing !== undefined) continue;
      const description = entity.descriptions?.en?.value || '';
      // "Communist Party" in a description of a system of government is not a party.
      const isParty = claimIds(entity, 'P31').includes(POLITICAL_PARTY)
        || /\bpolitical (party|group|movement|organi[sz]ation)\b|\bparty (in|of)\b|^(former |defunct )?[\w' -]*party$/i.test(description);
      // A party of Great Britain only ("Green Party of England and Wales") is not an Irish one,
      // unless Civgraph's own name for the party says so.
      const britainOnly = /\b(england|wales|welsh|scotland|scottish)\b/i.test(`${entity.labels?.en?.value || ''} ${description}`)
        && !/\b(england|wales|welsh|scotland|scottish)\b/i.test(party.title);
      const inPlace = !britainOnly && (claimIds(entity, 'P17').some((id) => COUNTRIES.has(id)) || PLACE_WORDS.test(description));
      const nameMatch = entityNames(entity).some((name) => wanted.has(fold(name)));
      const inception = bestTime(entity, 'P571');
      const dissolved = bestTime(entity, 'P576');
      const inYears = (!inception || !party.lastYear || yearOf(inception) <= party.lastYear + 1)
        && (!dissolved || !party.firstYear || yearOf(dissolved) >= party.firstYear - 1);
      if (ONLY) console.log(qid, entity.labels?.en?.value, { isParty, britainOnly, inPlace, nameMatch, inYears });
      scored.push({ qid, label: entity.labels?.en?.value, description, isParty, inPlace, nameMatch, inYears });
    }
    const passing = scored.filter((c) => c.isParty && c.inPlace && c.nameMatch && c.inYears);
    if (typeof override === 'string') {
      matches[party.slug] = { qid: override, matchBasis: 'owner override' };
    } else if (passing.length === 1) {
      matches[party.slug] = { qid: passing[0].qid, matchBasis: 'exact name; political party; Ireland/UK; years overlap' };
    } else {
      const near = (passing.length ? passing : scored.filter((c) => (c.nameMatch && c.isParty) || (c.isParty && c.inPlace))).slice(0, 6);
      (near.length ? uncertain : unmatched).push({
        slug: party.slug,
        title: party.title,
        years: [party.firstYear, party.lastYear],
        reason: passing.length > 1 ? 'more than one item passes every test' : near.length ? 'no candidate passes every test' : 'no political-party candidate found',
        candidates: near.map(({ qid, label, description, isParty, inPlace, nameMatch, inYears }) => ({ qid, label, description, isParty, inPlace, nameMatch, inYears }))
      });
    }
  }

  // One Wikidata item for two Civgraph parties (the Workers' Party and Sinn Féin The Workers'
  // Party are one item there): the party whose name is the item's label, else the one with
  // more candidacies, keeps it; the other is listed as uncertain.
  const bySlugCount = new Map(browse.map((party) => [party.slug, party.occurrenceCount || 0]));
  const byQid = new Map();
  for (const [slug, match] of Object.entries(matches)) {
    if (!byQid.has(match.qid)) byQid.set(match.qid, []);
    byQid.get(match.qid).push(slug);
  }
  for (const [qid, slugs] of byQid) {
    if (slugs.length < 2) continue;
    const label = fold(candidateEntities[qid]?.labels?.en?.value);
    const ranked = [...slugs].sort((a, b) => (Number(fold(parties.find((p) => p.slug === b).title) === label) - Number(fold(parties.find((p) => p.slug === a).title) === label))
      || (bySlugCount.get(b) - bySlugCount.get(a)));
    for (const slug of ranked.slice(1)) {
      if (matches[slug].matchBasis === 'owner override') continue;
      const party = parties.find((p) => p.slug === slug);
      uncertain.push({ slug, title: party.title, years: [party.firstYear, party.lastYear], reason: `same Wikidata item as ${ranked[0]}`, candidates: [{ qid, label: candidateEntities[qid]?.labels?.en?.value, description: candidateEntities[qid]?.descriptions?.en?.value }] });
      delete matches[slug];
    }
  }

  // 3. Full records for the matched items.
  const matchedEntities = await getEntities(Object.values(matches).map((m) => m.qid));

  // 4. Leader offices: exact English labels, plus P2388/P2389 links.
  // A label alone is not enough: "Leader of the Labour Party" is the label of the British,
  // Irish and Dutch offices alike. An office found by label is kept only when it links to the
  // party (P2389, P361, P642) or is the one item with that label and links to no other body.
  const labelToSlugs = new Map();
  for (const [slug, match] of Object.entries(matches)) {
    const entity = matchedEntities[match.qid];
    const names = [...new Set([entity?.labels?.en?.value, entity?.sitelinks?.enwiki?.title, parties.find((p) => p.slug === slug)?.title].filter(Boolean))];
    for (const name of names) {
      for (const title of OFFICE_TITLES) {
        const label = `${title} ${name.replace(/^the /i, '')}`;
        if (!labelToSlugs.has(label)) labelToSlugs.set(label, new Set());
        labelToSlugs.get(label).add(slug);
      }
    }
  }
  const qidToSlug = new Map(Object.entries(matches).map(([slug, m]) => [m.qid, slug]));
  const officeBySlug = new Map();
  const labelHits = new Map();
  const labelList = [...labelToSlugs.keys()];
  for (let i = 0; i < labelList.length; i += 120) {
    const values = labelList.slice(i, i + 120).map((label) => `${JSON.stringify(label)}@en`).join(' ');
    const body = await sparql(`SELECT ?pos ?l WHERE { VALUES ?l { ${values} } ?pos rdfs:label ?l . }`);
    for (const b of body.results?.bindings || []) {
      if (!labelHits.has(b.l.value)) labelHits.set(b.l.value, new Set());
      labelHits.get(b.l.value).add(b.pos.value.split('/').pop());
    }
  }
  const officeEntities = await getEntities([...labelHits.values()].flatMap((set) => [...set]), 'labels|claims');
  const rejectedOffices = [];
  for (const [label, qids] of labelHits) {
    for (const slug of labelToSlugs.get(label)) {
      const partyQid = matches[slug].qid;
      for (const qid of qids) {
        const links = ['P2389', 'P361', 'P642'].flatMap((prop) => claimIds(officeEntities[qid], prop));
        // ...and it must be an office in Ireland or the UK ("President of Labour Party" is the
        // Indonesian Labour Party's).
        const local = ['P17', 'P1001'].some((prop) => claimIds(officeEntities[qid], prop).some((id) => COUNTRIES.has(id)));
        const ok = links.includes(partyQid) || (qids.size === 1 && labelToSlugs.get(label).size === 1 && !links.length && local);
        if (!ok) { rejectedOffices.push({ slug, office: qid, label, links }); continue; }
        if (!officeBySlug.has(slug)) officeBySlug.set(slug, new Set());
        officeBySlug.get(slug).add(qid);
      }
    }
  }
  const partyValues = [...qidToSlug.keys()].map((q) => `wd:${q}`).join(' ');
  const linked = await sparql(`SELECT ?party ?pos WHERE { VALUES ?party { ${partyValues} } { ?pos wdt:P2389 ?party } UNION { ?party wdt:P2388 ?pos } }`);
  for (const b of linked.results?.bindings || []) {
    const slug = qidToSlug.get(b.party.value.split('/').pop());
    if (!officeBySlug.has(slug)) officeBySlug.set(slug, new Set());
    officeBySlug.get(slug).add(b.pos.value.split('/').pop());
  }
  // A party chairman is not its leader where Wikidata also has a leader's office (the
  // Conservative Party has both); a chairman's office is kept only when it is the only one.
  for (const [slug, set] of officeBySlug) {
    const chair = [...set].filter((qid) => /^chair/i.test(officeEntities[qid]?.labels?.en?.value || ''));
    if (chair.length && chair.length < set.size) for (const qid of chair) { set.delete(qid); rejectedOffices.push({ slug, office: qid, label: officeEntities[qid]?.labels?.en?.value, reason: 'chairman beside a leader office' }); }
  }
  const allOffices = [...new Set([...officeBySlug.values()].flatMap((set) => [...set]))];
  const holders = new Map();
  for (let i = 0; i < allOffices.length; i += 60) {
    const values = allOffices.slice(i, i + 60).map((q) => `wd:${q}`).join(' ');
    const body = await sparql(`SELECT ?pos ?person ?personLabel ?start ?startPrec ?end ?endPrec WHERE {
      VALUES ?pos { ${values} }
      ?person p:P39 ?st . ?st ps:P39 ?pos .
      FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
      OPTIONAL { ?st pqv:P580 ?sv . ?sv wikibase:timeValue ?start ; wikibase:timePrecision ?startPrec }
      OPTIONAL { ?st pqv:P582 ?ev . ?ev wikibase:timeValue ?end ; wikibase:timePrecision ?endPrec }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
    for (const b of body.results?.bindings || []) {
      const pos = b.pos.value.split('/').pop();
      if (!holders.has(pos)) holders.set(pos, []);
      const time = (value, prec) => (value ? wikidataTime({ datavalue: { value: { time: `+${value.slice(0, 10)}T00:00:00Z`.replace('++', '+'), precision: Number(prec) } } }) : null);
      holders.get(pos).push({
        qid: b.person.value.split('/').pop(),
        name: b.personLabel.value,
        start: time(b.start?.value, b.startPrec?.value),
        end: time(b.end?.value, b.endPrec?.value)
      });
    }
  }

  // 5. Labels of every item a profile names (ideologies, offices, predecessors, successors).
  const referenced = new Set([...allOffices]);
  for (const match of Object.values(matches)) {
    const entity = matchedEntities[match.qid];
    for (const prop of ['P1142', 'P1387', 'P155', 'P156', 'P1365', 'P1366', 'P807', 'P749']) for (const id of claimIds(entity, prop)) referenced.add(id);
  }
  const labelEntities = await getEntities([...referenced], 'labels|sitelinks');
  const labelOf = (qid) => labelEntities[qid]?.labels?.en?.value || null;

  const droppedTerms = [];
  for (const [slug, match] of Object.entries(matches)) {
    const entity = matchedEntities[match.qid];
    if (!entity) continue;
    const links = (prop) => claimIds(entity, prop).map((qid) => ({ qid, label: labelOf(qid), civgraphSlug: qidToSlug.get(qid) || undefined })).filter((x) => x.label);
    const offices = [...(officeBySlug.get(slug) || [])];
    const leaders = [];
    for (const office of offices) {
      const terms = holders.get(office) || [];
      for (const term of terms) {
        // Only a fully dated term can sit inside another, and only inside a term with a
        // known start (an undated term would otherwise swallow every other).
        const s = term.start?.date;
        const e = term.end?.date;
        // A term that hands over to (or takes over from) another holder on the same day is a link
        // in the succession, so it stays even when a mis-dated statement spans it: Wikidata gives
        // Michael Ancram, the deputy leader, the Conservative leadership 2001-2005, which swallowed
        // Michael Howard's 2003-2005 term although Howard handed over to David Cameron on 6 Dec 2005.
        const handover = Boolean(s && e) && terms.some((other) => other.qid !== term.qid
          && ((other.start?.date && other.start.date === e) || (other.end?.date && other.end.date === s)));
        const inside = Boolean(s && e) && !handover && terms.some((other) => other.qid !== term.qid && other.start?.date
          && other.start.date <= s && (other.end?.date || '9999') >= e
          && !(other.start.date === s && other.end?.date === e));
        if (inside) { droppedTerms.push({ slug, office, officeLabel: labelOf(office), ...term }); continue; }
        leaders.push({ ...term, office, officeLabel: labelOf(office) });
      }
    }
    leaders.sort((a, b) => String(a.start?.date || '').localeCompare(String(b.start?.date || '')));
    Object.assign(match, {
      label: entity.labels?.en?.value,
      description: entity.descriptions?.en?.value,
      enwiki: entity.sitelinks?.enwiki?.title || undefined,
      inception: bestTime(entity, 'P571') || undefined,
      dissolved: bestTime(entity, 'P576') || undefined,
      ideologies: links('P1142'),
      alignment: links('P1387'),
      // replaces / replaced by (P1365/P1366) is organisational succession; follows / followed
      // by (P155/P156) is used more loosely on Wikidata (Sinn Féin 'followed by' Aontú), so the
      // profiles show it only as a related party.
      replaces: links('P1365'),
      replacedBy: links('P1366'),
      follows: links('P155'),
      followedBy: links('P156'),
      offices: offices.map((qid) => ({ qid, label: labelOf(qid) })),
      leaders
    });
  }

  const output = {
    schemaVersion: 1,
    retrieved: new Date().toISOString().slice(0, 10),
    source: 'Wikidata (https://www.wikidata.org), CC0 1.0. Fetched by scripts/ingest/wikipedia/fetch-party-wikidata.mjs.',
    matchRule: 'Exact English or Irish label/alias match on the party name, a political party, in Ireland or the UK, years overlapping the party\'s elections; exactly one such item. Uncertain matches are listed and not used; confirm them in party-wikidata-overrides.json.',
    counts: { parties: parties.length, matched: Object.keys(matches).length, uncertain: uncertain.length, unmatched: unmatched.length, requests: requestCount },
    matches,
    uncertain,
    unmatched,
    droppedLeaderTerms: droppedTerms,
    rejectedOffices
  };
  // --only <slug> prints one party's scoring and writes nothing.
  if (ONLY) { console.log(JSON.stringify(output.matches[ONLY] || output.uncertain[0] || output.unmatched[0]).slice(0, 400)); return; }
  writeFileSync(path.join(ROOT, OUT), `${JSON.stringify(output, null, 1)}\n`);
  console.log(`matched ${output.counts.matched}/${parties.length}; uncertain ${uncertain.length}; unmatched ${unmatched.length}; ${requestCount} requests -> ${OUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
