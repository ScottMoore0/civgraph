/**
 * The facts model: offices and tenures, party events, and affiliation over time
 * (docs/facts-model.md). One loader and one set of rules, shared by the validator
 * (scripts/check/rules/facts-model.mjs), the Browse build (scripts/build/build-browse-indexes.mjs,
 * scripts/build/build-party-profiles.mjs) and the tests (tests/facts/).
 *
 *   data/offices/offices.json                          institutions and offices
 *   data/offices/tenures/*.json                        who held them, when
 *   data/elections/parties/party-events.json           founded, dissolved, renamed, split ...
 *   data/elections/persons/affiliations.json           party / independent / group / whip intervals
 *   data/elections/persons/non-candidate-persons.json  people who never stood, in their own id block
 *   data/elections/persons/honours.json                peerages, knighthoods, the Privy Council,
 *                                                      lieutenancies, and seats in appointed or
 *                                                      indirectly chosen bodies (memberships)
 *
 * Internal contests (leadership elections, nomination contests) are not here: they are
 * ordinary elections under data/elections-source with a `party-internal` body.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The facts documents (packages/types, generated from data/schemas). A missing file reads as
 * the empty document loadFactsModel gives it, so each is Partial.
 * @typedef {import('../../packages/types/index.js').OfficesDocument} OfficesDocument
 * @typedef {import('../../packages/types/index.js').TenuresDocument} TenuresDocument
 * @typedef {import('../../packages/types/index.js').PartyEventsDocument} PartyEventsDocument
 * @typedef {import('../../packages/types/index.js').AffiliationsDocument} AffiliationsDocument
 * @typedef {import('../../packages/types/index.js').NonCandidatePersonsDocument} NonCandidatePersonsDocument
 * @typedef {import('../../packages/types/index.js').HonoursDocument} HonoursDocument
 * @typedef {import('../../packages/types/index.js').Institution} Institution
 * @typedef {import('../../packages/types/index.js').Office} Office
 * @typedef {import('../../packages/types/index.js').Tenure} Tenure
 * @typedef {PartyEventsDocument['events'][number]} PartyEvent
 * @typedef {AffiliationsDocument['affiliations'][number]} Affiliation
 * @typedef {NonCandidatePersonsDocument['persons'][number]} NonCandidatePerson
 * @typedef {HonoursDocument['honours'][number]} Honour
 *
 * @typedef {object} FactsModel
 * @property {Partial<OfficesDocument>} officesDoc
 * @property {Record<string, Partial<TenuresDocument>>} tenureDocs  by file name
 * @property {Partial<PartyEventsDocument>} eventsDoc
 * @property {Partial<AffiliationsDocument>} affiliationsDoc
 * @property {Partial<NonCandidatePersonsDocument>} nonCandidatesDoc
 * @property {Partial<HonoursDocument>} [honoursDoc]
 * @property {Institution[]} institutions
 * @property {Office[]} offices
 * @property {Tenure[]} tenures
 * @property {PartyEvent[]} events
 * @property {Affiliation[]} affiliations
 * @property {NonCandidatePerson[]} nonCandidates
 * @property {Honour[]} [honours]
 */

export const FACT_PATHS = {
  offices: 'data/offices/offices.json',
  tenuresDir: 'data/offices/tenures',
  partyEvents: 'data/elections/parties/party-events.json',
  affiliations: 'data/elections/persons/affiliations.json',
  nonCandidates: 'data/elections/persons/non-candidate-persons.json',
  honours: 'data/elections/persons/honours.json',
  schemas: 'data/schemas',
};

export const NONCANDIDATE_BLOCK = { from: 900001, to: 999999 };

/**
 * @template T
 * @param {string} file
 * @param {T} fallback  what a missing file reads as
 * @returns {T}
 */
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

/**
 * Every facts file under `root`, parsed; a missing file reads as empty.
 * @returns {FactsModel}
 */
export function loadFactsModel(root = process.cwd()) {
  const at = (/** @type {string} */ rel) => path.join(root, rel);
  /** @type {Partial<OfficesDocument>} */
  const officesDoc = readJson(at(FACT_PATHS.offices), { institutions: [], offices: [] });
  /** @type {Record<string, Partial<TenuresDocument>>} */
  const tenureDocs = {};
  const dir = at(FACT_PATHS.tenuresDir);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      tenureDocs[name] = readJson(path.join(dir, name), { tenures: [] });
    }
  }
  /** @type {Partial<PartyEventsDocument>} */
  const eventsDoc = readJson(at(FACT_PATHS.partyEvents), { events: [] });
  /** @type {Partial<AffiliationsDocument>} */
  const affiliationsDoc = readJson(at(FACT_PATHS.affiliations), { affiliations: [] });
  /** @type {Partial<NonCandidatePersonsDocument>} */
  const nonCandidatesDoc = readJson(at(FACT_PATHS.nonCandidates), { persons: [] });
  /** @type {Partial<HonoursDocument>} */
  const honoursDoc = readJson(at(FACT_PATHS.honours), { honours: [] });
  return {
    officesDoc, tenureDocs, eventsDoc, affiliationsDoc, nonCandidatesDoc, honoursDoc,
    institutions: officesDoc.institutions || [],
    offices: officesDoc.offices || [],
    tenures: Object.values(tenureDocs).flatMap((doc) => doc.tenures || []),
    events: eventsDoc.events || [],
    affiliations: affiliationsDoc.affiliations || [],
    nonCandidates: nonCandidatesDoc.persons || [],
    honours: honoursDoc.honours || [],
  };
}

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * The precision a date string carries: year, month or day.
 * @param {string | null | undefined} date
 * @returns {'day' | 'month' | 'year' | null}
 */
export function precisionOf(date) {
  const m = DATE.exec(String(date || ''));
  if (!m) return null;
  return m[3] ? 'day' : m[2] ? 'month' : 'year';
}

/**
 * a <= b, comparing only as far as the less precise of the two goes ("1974" vs "1974-05").
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function notAfter(a, b) {
  if (!a || !b) return true;
  const n = Math.min(a.length, b.length);
  return a.slice(0, n) <= b.slice(0, n);
}

/** "1974-05-28" -> "28 May 1974"; "1974-05" -> "May 1974"; "1974" -> "1974". */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** @param {string | null | undefined} date */
export function formatFactDate(date) {
  const m = DATE.exec(String(date || ''));
  if (!m) return '';
  if (m[3]) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (m[2]) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return m[1];
}

/**
 * "1972-03 to 1974-01" as a reader's span: "March 1972 – January 1974", "from 1998", "until May
 * 1987". Where a source shows only that the person was in post by a date (startBy), and not when
 * they began, the span says so: "in post by June 1972", "in post by 1974 – 1983".
 * @param {string | null | undefined} start
 * @param {string | null | undefined} end
 * @param {{ startBy?: string | null }} [options]
 */
export function formatSpan(start, end, { startBy = null } = {}) {
  const a = formatFactDate(start) || (startBy ? `in post by ${formatFactDate(startBy)}` : '');
  const b = formatFactDate(end);
  if (a && b) return `${a} – ${b}`;
  if (a) return start ? `from ${a}` : a;
  if (b) return `until ${b}`;
  return '';
}

/**
 * The rules a JSON schema cannot state: ids unique, references resolve, a date's precision is
 * the precision it carries, a start comes before its end, registered people stay in their
 * block. `refs` supplies what lives outside the facts files (any may be omitted to skip it):
 *   personIds   Set of person ids in data/elections/persons/person_registry.json
 *   candidateOfficialIds  Map official id -> candidate person id (registered people must not share one)
 *   partyIds    Set of party_registry.json ids
 *   electionKeys  Set of "<body>__<date>" keys under data/elections-source
 * Returns a list of error strings; empty means valid.
 * @param {FactsModel} model
 * @param {{ personIds?: Set<string>, candidateOfficialIds?: Map<string, string>, partyIds?: Set<string>, electionKeys?: Set<string> }} [refs]
 * @returns {string[]}
 */
export function checkFactsModel(model, refs = {}) {
  /** @type {string[]} */
  const errors = [];
  const err = (/** @type {string} */ msg) => errors.push(msg);
  const unique = (/** @type {{ id: string }[]} */ rows, /** @type {string} */ what) => {
    /** @type {Set<string>} */
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.id)) err(`${what}: duplicate id ${row.id}`);
      seen.add(row.id);
    }
    return seen;
  };
  const institutionIds = unique(model.institutions, 'institution');
  const officeIds = unique(model.offices, 'office');
  unique(model.tenures, 'tenure');
  unique(model.events, 'party event');
  unique(model.affiliations, 'affiliation');
  unique(model.honours || [], 'honour');
  /** @type {Set<string>} */
  const registered = new Set();
  for (const p of model.nonCandidates) {
    const n = Number(p.personId);
    if (!(n >= NONCANDIDATE_BLOCK.from && n <= NONCANDIDATE_BLOCK.to)) err(`non-candidate ${p.personId}: outside the registered block ${NONCANDIDATE_BLOCK.from}-${NONCANDIDATE_BLOCK.to}`);
    if (registered.has(p.personId)) err(`non-candidate ${p.personId}: listed twice`);
    registered.add(p.personId);
    for (const o of p.officialPersonIds || []) {
      const holder = refs.candidateOfficialIds?.get(o);
      if (holder) err(`non-candidate ${p.personId} (${p.displayName}) shares ${o} with candidate ${holder}: merge them instead`);
    }
  }
  const knownPerson = (/** @type {string | undefined} */ id) => !refs.personIds || refs.personIds.has(String(id)) || registered.has(String(id));
  const knownParty = (/** @type {string} */ id) => !refs.partyIds || refs.partyIds.has(id);
  /**
   * @param {Record<string, unknown>} row
   * @param {string} what
   * @param {[string, string][]} pairs  [date field, its precision field]
   */
  const dates = (row, what, pairs) => {
    for (const [field, prec] of pairs) {
      const value = /** @type {string | null | undefined} */ (row[field]);
      if (value === null || value === undefined) {
        if (row[prec] !== null && row[prec] !== undefined) err(`${what}: ${prec} without a ${field}`);
        continue;
      }
      if (precisionOf(value) !== row[prec]) err(`${what}: ${field} ${value} is ${precisionOf(value)}-precise, recorded as ${row[prec]}`);
    }
  };
  for (const inst of model.institutions) {
    if (inst.partyId && !knownParty(inst.partyId)) err(`institution ${inst.id}: unknown party ${inst.partyId}`);
  }
  for (const office of model.offices) {
    if (!institutionIds.has(office.institution)) err(`office ${office.id}: unknown institution ${office.institution}`);
    if (office.partyId && !knownParty(office.partyId)) err(`office ${office.id}: unknown party ${office.partyId}`);
    dates(office, `office ${office.id}`, [['start', 'startPrecision'], ['end', 'endPrecision']]);
  }
  for (const t of model.tenures) {
    const what = `tenure ${t.id}`;
    if (!officeIds.has(t.officeId)) err(`${what}: unknown office ${t.officeId}`);
    if (!knownPerson(t.personId)) err(`${what}: unknown person ${t.personId}`);
    for (const f of /** @type {const} */ (['predecessor', 'successor'])) if (t[f] && !knownPerson(t[f])) err(`${what}: unknown ${f} ${t[f]}`);
    if (!t.start && !t.end && !t.startBy) err(`${what}: neither a start nor an end`);
    dates(t, what, [['start', 'startPrecision'], ['end', 'endPrecision']]);
    if (!notAfter(t.start, t.end)) err(`${what}: ends (${t.end}) before it starts (${t.start})`);
    if (t.startBy && t.start) err(`${what}: both a start and an in-post-by date`);
    if (!notAfter(t.startBy, t.end)) err(`${what}: ends (${t.end}) before the date it was in post by (${t.startBy})`);
    if (t.contest && refs.electionKeys && !refs.electionKeys.has(t.contest)) err(`${what}: unknown contest ${t.contest}`);
    if (!(t.citations || []).length) err(`${what}: no citation`);
  }
  for (const e of model.events) {
    const what = `party event ${e.id}`;
    if (!knownParty(e.partyId)) err(`${what}: unknown party ${e.partyId}`);
    for (const r of e.relatedParties || []) if (!knownParty(r.partyId)) err(`${what}: unknown related party ${r.partyId}`);
    for (const p of e.persons || []) if (!knownPerson(p.personId)) err(`${what}: unknown person ${p.personId}`);
    if (precisionOf(e.date) !== e.precision) err(`${what}: date ${e.date} recorded as ${e.precision}`);
  }
  for (const a of model.affiliations) {
    const what = `affiliation ${a.id}`;
    if (!knownPerson(a.personId)) err(`${what}: unknown person ${a.personId}`);
    if (a.partyId && !knownParty(a.partyId)) err(`${what}: unknown party ${a.partyId}`);
    if (!a.partyId && !a.label) err(`${what}: neither a party nor a label`);
    if (!a.start && !a.end) err(`${what}: neither a start nor an end`);
    dates(a, what, [['start', 'startPrecision'], ['end', 'endPrecision']]);
    if (!notAfter(a.start, a.end)) err(`${what}: ends (${a.end}) before it starts (${a.start})`);
    if (Boolean(a.start) !== Boolean(a.startEvent) && a.start) err(`${what}: a start without a start event`);
    if (a.end && !a.endEvent) err(`${what}: an end without an end event`);
  }
  for (const h of model.honours || []) {
    const what = `honour ${h.id}`;
    if (!knownPerson(h.personId)) err(`${what}: unknown person ${h.personId}`);
    if (!h.start && !h.end && !h.startBy) err(`${what}: no date`);
    dates(h, what, [['start', 'startPrecision'], ['end', 'endPrecision']]);
    if (!notAfter(h.start, h.end)) err(`${what}: ends (${h.end}) before it starts (${h.start})`);
    if (h.startBy && h.start) err(`${what}: both a start and an in-post-by date`);
    if (!(h.citations || []).length) err(`${what}: no citation`);
  }
  return errors;
}

/**
 * Validate every document against its JSON schema (data/schemas). Returns error strings.
 * @param {FactsModel} model
 * @returns {Promise<string[]>}
 */
export async function schemaErrors(model, root = process.cwd()) {
  const { default: Ajv } = await import('ajv');
  const ajv = new Ajv({ allErrors: true, jsonPointers: true });
  const dir = path.join(root, FACT_PATHS.schemas);
  for (const name of ['citation', 'offices', 'tenures', 'party-events', 'affiliations', 'non-candidate-persons', 'honours']) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(dir, `${name}.schema.json`), 'utf8')), name);
  }
  /** @type {string[]} */
  const errors = [];
  const run = (/** @type {string} */ schema, /** @type {unknown} */ doc, /** @type {string} */ label) => {
    if (!ajv.validate(schema, doc)) {
      for (const e of (ajv.errors || []).slice(0, 20)) errors.push(`${label}${e.dataPath || ''}: ${e.message}${/** @type {{ allowedValues?: string[] }} */ (e.params)?.allowedValues ? ` (${/** @type {{ allowedValues: string[] }} */ (e.params).allowedValues.join(', ')})` : ''}`);
    }
  };
  run('offices', model.officesDoc, FACT_PATHS.offices);
  for (const [name, doc] of Object.entries(model.tenureDocs)) run('tenures', doc, `${FACT_PATHS.tenuresDir}/${name}`);
  run('party-events', model.eventsDoc, FACT_PATHS.partyEvents);
  run('affiliations', model.affiliationsDoc, FACT_PATHS.affiliations);
  run('non-candidate-persons', model.nonCandidatesDoc, FACT_PATHS.nonCandidates);
  if (model.honoursDoc) run('honours', model.honoursDoc, FACT_PATHS.honours);
  return errors;
}

/**
 * Folded as build-browse-indexes.mjs normalizeName folds the party-names.json keys.
 * @param {string | null | undefined} value
 */
export function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * party_registry.json id -> the Browse party slug (data/browse/parties.json), or null. Browse
 * keys parties by label, the registry by identity, and the two coincide for most parties
 * (uup, alliance, fianna-fail); otherwise the registry entity's name and aliases are looked up
 * in party-names.json (label -> slug), as a candidacy's label is.
 * @param {{ id: string, name?: string, shortName?: string, aliases?: (string | { string?: string } | null)[] }[]} registryEntities
 *   party_registry.json entities
 * @param {Record<string, string>} partyNames  party-names.json: folded label -> Browse slug
 * @param {Set<string>} browseSlugs
 * @returns {(id: string | null | undefined) => string | null}
 */
export function browsePartySlugResolver(registryEntities, partyNames, browseSlugs) {
  const byId = new Map(registryEntities.map((e) => [e.id, e]));
  /** @type {Map<string, string | null>} */
  const cache = new Map();
  return (id) => {
    if (!id) return null;
    if (cache.has(id)) return /** @type {string | null} */ (cache.get(id));
    let slug = browseSlugs.has(id) ? id : null;
    const e = byId.get(id);
    if (!slug && e) {
      for (const label of [e.name, e.shortName, ...(e.aliases || []).map((a) => (typeof a === 'string' ? a : a?.string))]) {
        const hit = partyNames[normalizeLabel(label)];
        if (hit && browseSlugs.has(hit)) { slug = hit; break; }
      }
    }
    cache.set(id, slug);
    return slug;
  };
}

/**
 * Lookups the Browse build uses: tenures by person and by office, events and leaders by party.
 * @param {FactsModel} model
 */
export function indexFactsModel(model) {
  const officeById = new Map(model.offices.map((o) => [o.id, o]));
  const institutionById = new Map(model.institutions.map((i) => [i.id, i]));
  /**
   * Rows grouped by an id field, or by what `key(row)` returns; rows without one are left out.
   * @template R
   * @param {R[]} rows
   * @param {keyof R | ((row: R) => string | null | undefined)} key  every key used is a string id
   * @returns {Map<string, R[]>}
   */
  const by = (rows, key) => {
    /** @type {Map<string, R[]>} */
    const map = new Map();
    for (const row of rows) {
      const k = /** @type {string | null | undefined} */ (typeof key === 'function' ? key(row) : row[key]);
      if (k === null || k === undefined) continue;
      if (!map.has(k)) map.set(k, []);
      /** @type {R[]} */ (map.get(k)).push(row);
    }
    return map;
  };
  // By start, else end; at the same date a tenure that only ends there comes before one that
  // starts there (Faulkner's leadership ending January 1974 before West's beginning).
  /** @typedef {{ start?: string | null, end?: string | null }} Dated */
  const sortByStart = (/** @type {Dated} */ a, /** @type {Dated} */ b) => String(a.start || a.end || '').slice(0, 7).localeCompare(String(b.start || b.end || '').slice(0, 7))
    || (a.start ? 1 : 0) - (b.start ? 1 : 0) || String(a.start || a.end || '').localeCompare(String(b.start || b.end || ''));
  const tenuresByPerson = by(model.tenures, 'personId');
  const tenuresByOffice = by(model.tenures, 'officeId');
  for (const list of [...tenuresByPerson.values(), ...tenuresByOffice.values()]) list.sort(sortByStart);
  const affiliationsByPerson = by(model.affiliations, 'personId');
  for (const list of affiliationsByPerson.values()) list.sort(sortByStart);
  const honoursByPerson = by(model.honours || [], 'personId');
  for (const list of honoursByPerson.values()) list.sort((a, b) => String(a.start || a.startBy || a.end || '').localeCompare(String(b.start || b.startBy || b.end || '')));
  const eventsByParty = by(model.events, 'partyId');
  for (const list of eventsByParty.values()) list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // A party's offices (leader, chair ...), through the institution or the office's own partyId.
  const officesByParty = by(model.offices, (o) => o.partyId || institutionById.get(o.institution)?.partyId);
  return { officeById, institutionById, tenuresByPerson, tenuresByOffice, affiliationsByPerson, honoursByPerson, eventsByParty, officesByParty };
}
