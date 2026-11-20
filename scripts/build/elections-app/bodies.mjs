/**
 * The Elections app's by-election tracker and council-control tables, read from the local records
 * build (stream el-bodies, 14 Nov 2026). data.mjs --extracts writes them beside the pivot extracts
 * (byelections-<sha256:12>.json, control-<sha256:12>.json, listed in index.json `tables`), and
 * data.mjs --check rebuilds them in memory to compare. What they claim: bodies-model.mjs.
 *
 * Besides the records build it reads, all in the repository:
 *   data/registries/councils.json         the councils, their ids, names, predecessors and successors;
 *   data/offices/offices.json, data/offices/tenures/councils.json   council seats filled by co-option;
 *   data/elections-source/data/elections/ireland-local/<date>/_index.json   which council each
 *                                         contest of the Republic's local elections belongs to (the
 *                                         records build does not carry it).
 * Every field written is one the records API already serves (names, parties, votes, dates, notes)
 * or a registry's: no address, agent or occupation is read.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTables, districtCouncilId, irishCouncilUnits } from './bodies-model.mjs';
import { foldLabel, hasPartyLabel, isUnopposedStatus, num, parseMeta, votesOf } from './model.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readJson = (/** @type {string} */ rel) => JSON.parse(readFileSync(path.join(REPO, rel), 'utf8'));

/** The schema of both tables (index.json `tables`); a change old pages cannot read is a 2. */
export const TABLES_SCHEMA = 1;

/** @typedef {import('./bodies-model.mjs').El} El @typedef {import('./bodies-model.mjs').RegistryCouncil} RegistryCouncil */
/** @typedef {import('@civgraph/storage/node').SqliteHandle} SqliteHandle */

/**
 * Which council each contest file of the Republic's local elections belongs to, from the source
 * files' indexes (source_file -> printed council name).
 * @returns {Map<string, string>}
 */
function irishCouncilByFile() {
  const root = 'data/elections-source/data/elections/ireland-local';
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!existsSync(path.join(REPO, root))) return out;
  // Sorted, so the tables come out the same on every system.
  for (const date of readdirSync(path.join(REPO, root)).sort()) {
    const rel = `${root}/${date}/_index.json`;
    if (!existsSync(path.join(REPO, rel))) continue;
    for (const r of /** @type {Array<{ council?: string, file?: string }>} */ (readJson(rel))) {
      if (r.council && r.file) out.set(`${root}/${date}/${r.file}`, r.council);
    }
  }
  return out;
}


/**
 * Both tables from the records build.
 * @param {SqliteHandle} db
 * @returns {{ byelections: Record<string, unknown>, control: Record<string, unknown> }}
 */
export function bodiesTables(db) {
  /** @type {RegistryCouncil[]} */
  const registry = readJson('data/registries/councils.json').councils;
  const councilById = new Map(registry.map((r) => [r.id, r]));
  /** body slugs that are each one council (the pre-1973 Northern Ireland councils) */
  const councilBodies = new Set(registry.filter((r) => r.bodySlug === r.id).map((r) => r.id));

  const labelMap = new Map(/** @type {Array<{ label: string, party_slug: string }>} */ (/** @type {unknown} */ (db.prepare('SELECT label, party_slug FROM party_label_map').all())).map((r) => [r.label, r.party_slug]));
  const partyKey = (/** @type {unknown} */ label) => (hasPartyLabel(/** @type {string | null} */ (label)) ? labelMap.get(foldLabel(label)) || `label:${foldLabel(label)}` : null);
  /** @type {Map<string, Map<string, number>>} labels and colours seen per party key */
  const labelsSeen = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const coloursSeen = new Map();
  const see = (/** @type {Map<string, Map<string, number>>} */ m, /** @type {string} */ k, /** @type {unknown} */ v) => {
    if (!v) return;
    if (!m.has(k)) m.set(k, new Map());
    const inner = /** @type {Map<string, number>} */ (m.get(k));
    inner.set(String(v), (inner.get(String(v)) || 0) + 1);
  };

  const irishFiles = irishCouncilByFile();
  const printed = [...new Set([...irishFiles.entries()].map(([file, name]) => `${name}\u0000${file.split('/').at(-2)}`))].map((s) => {
    const [name, date] = /** @type {[string, string]} */ (s.split('\u0000'));
    return { name, date };
  });
  const irish = irishCouncilUnits(registry, printed);

  const elections = /** @type {Array<{ key: string, body_slug: string, body: string | null, kind: string | null, contest_status: string | null, date: string }>} */ (/** @type {unknown} */ (db.prepare(
    "SELECT key, body_slug, body, kind, contest_status, date FROM r_elections WHERE coalesce(contest_type, 'election') = 'election' ORDER BY body_slug, date, key",
  ).all()));
  const contestsOf = db.prepare('SELECT seq, name, slug, source_file, seats_total, electorate, turnout_pct, majority, majority_pct, meta FROM contests WHERE election_key = ? ORDER BY seq');
  const featureOf = db.prepare('SELECT contest_seq, layer_id, feature_id, matched FROM contest_features WHERE election_key = ?');
  const candsOf = db.prepare('SELECT contest_seq, person_id, name, party_label, colour, first_prefs, elected, status FROM candidacies WHERE election_key = ? ORDER BY contest_seq, ord');

  /** @type {El[]} */
  const els = [];
  /** @type {Map<string, { name: string, body: string, bodyName: string, council: boolean }>} */
  const units = new Map();
  for (const el of elections) {
    /** @type {Map<number, Array<Record<string, unknown>>>} */
    const cands = new Map();
    for (const c of /** @type {Array<Record<string, unknown>>} */ (candsOf.all(el.key))) {
      const seq = Number(c['contest_seq']);
      if (!cands.has(seq)) cands.set(seq, []);
      /** @type {Array<Record<string, unknown>>} */ (cands.get(seq)).push(c);
    }
    /** The map feature each contest matched: a seat's identity across spellings of its name. */
    const features = new Map(/** @type {Array<Record<string, unknown>>} */ (featureOf.all(el.key)).filter((f) => f['matched'] === 1 && f['layer_id'] && f['feature_id']).map((f) => [Number(f['contest_seq']), `${f['layer_id']}#${f['feature_id']}`]));
    /** @type {Map<string, El>} */
    const byUnit = new Map();
    for (const row of /** @type {Array<Record<string, unknown>>} */ (contestsOf.all(el.key))) {
      const meta = parseMeta(/** @type {string | null} */ (row['meta']));
      let unit = el.body_slug;
      let unitName = el.body || el.body_slug;
      let council = councilBodies.has(el.body_slug);
      if (el.body_slug === 'local-government') {
        const id = meta.localBody ? districtCouncilId(registry, String(meta.localBody), el.date) : null;
        if (id) { unit = id; unitName = /** @type {RegistryCouncil} */ (councilById.get(id)).name; }
        council = true;
      } else if (el.body_slug === 'ireland-local') {
        const printedName = irishFiles.get(String(row['source_file'] || ''));
        if (printedName) {
          unit = irish.unitOf(printedName, el.date);
          unitName = councilById.get(unit)?.name || printedName;
        }
        council = true;
      } else if (council) {
        unitName = councilById.get(el.body_slug)?.name || unitName;
      }
      if (!units.has(unit)) units.set(unit, { name: unitName, body: el.body_slug, bodyName: el.body || el.body_slug, council });
      if (!byUnit.has(unit)) byUnit.set(unit, { key: el.key, body: el.body_slug, unit, council, kind: el.kind || '', date: el.date, contests: [] });
      const list = cands.get(Number(row['seq'])) || [];
      const anyVotes = list.some((c) => votesOf(/** @type {any} */ (c)) !== null);
      const unopposed = list.length > 0 && !anyVotes && (list.some((c) => isUnopposedStatus(/** @type {any} */ (c))) || el.contest_status === 'uncontested');
      /** @type {El} */ (byUnit.get(unit)).contests.push({
        seq: Number(row['seq']),
        name: String(row['name']),
        slug: String(row['slug']),
        keys: [features.get(Number(row['seq'])), String(row['slug'])].filter((k) => typeof k === 'string'),
        seats: num(row['seats_total']),
        electorate: num(row['electorate']),
        turnout: num(row['turnout_pct']) || null,
        majority: num(row['majority']) || null,
        majorityPct: num(row['majority_pct']) || null,
        validPoll: num(meta.validPoll) ?? num(meta.totalVotes),
        unopposed,
        notes: Array.isArray(meta.contestNotes) ? meta.contestNotes : [],
        cands: list.map((c) => {
          const party = partyKey(c['party_label']);
          if (party) { see(labelsSeen, party, c['party_label']); see(coloursSeen, party, c['colour']); }
          return {
            name: String(c['name'] || ''),
            personId: c['person_id'] ? String(c['person_id']) : null,
            party,
            votes: votesOf(/** @type {any} */ (c)),
            elected: c['elected'] === 1 || isUnopposedStatus(/** @type {any} */ (c)) || /^elected/i.test(String(c['status'] || '')),
          };
        }),
      });
    }
    els.push(...byUnit.values());
  }

  // Council seats filled by co-option (offices' tenures that began "co-opted").
  /** @type {Array<{ id: string, institution?: string }>} */
  const offices = readJson('data/offices/offices.json').offices;
  const institutionOf = new Map(offices.map((o) => [o.id, o.institution]));
  /** @type {Array<{ personId: string, officeId: string, start: string | null, startBy?: string, began: string | null, note?: string }>} */
  const tenures = readJson('data/offices/tenures/councils.json').tenures;
  const nameOf = db.prepare('SELECT display_name FROM persons WHERE person_id = ?');
  const coOptions = tenures.filter((t) => t.began === 'co-opted' && (t.start || t.startBy)).map((t) => {
    const date = /** @type {string} */ (t.start || t.startBy);
    const institution = institutionOf.get(t.officeId);
    const generation = date >= '2015-04-01' ? '2014' : '1973';
    const council = registry.find((r) => /** @type {any} */ (r).officesInstitution === institution && r.generation === generation)
      || registry.find((r) => /** @type {any} */ (r).officesInstitution === institution);
    const unit = council ? council.id : t.officeId;
    if (!units.has(unit)) units.set(unit, { name: council ? council.name : t.officeId, body: council ? council.bodySlug : 'local-government', bodyName: council ? council.name : t.officeId, council: true });
    const person = /** @type {{ display_name?: string } | undefined} */ (nameOf.get(t.personId));
    return { unit, body: council ? council.bodySlug : 'local-government', date, name: String(person?.display_name || ''), personId: t.personId, party: null, note: t.note || null };
  });

  const { rows, timelines } = buildTables(els, { coOptions });

  // The parties the tables name: the registry's short name, else the label most used for it.
  const partyNames = new Map(/** @type {Array<{ party_id: string, name: string | null, short_name: string | null }>} */ (/** @type {unknown} */ (db.prepare('SELECT party_id, name, short_name FROM parties').all())).map((p) => [p.party_id, p.short_name || p.name || p.party_id]));
  const top = (/** @type {Map<string, number> | undefined} */ m) => (m ? [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null : null);
  /** @type {Set<string>} */
  const used = new Set();
  const use = (/** @type {string | null | undefined} */ p) => { if (p) used.add(p); };
  for (const r of rows) {
    for (const w of r.winners) use(w.party);
    for (const c of r.candidates) use(c.party);
    use(r.defending?.party);
  }
  for (const tl of timelines.values()) for (const e of tl) { for (const [p] of [...(e.seats || []), ...(e.composition || [])]) use(p); use(e.gain); use(e.loss); }
  const parties = Object.fromEntries([...used].sort().map((p) => [p, { name: partyNames.get(p) || top(labelsSeen.get(p)) || p, colour: top(coloursSeen.get(p)) }]));

  const unitsJson = Object.fromEntries([...units.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, u]) => [id, { name: u.name, body: u.body, bodyName: u.bodyName, council: u.council }]));

  /** Predecessor and successor links of a council, each with whether it has a timeline here. */
  const links = (/** @type {Array<{ id: string }> | undefined} */ list) => (list || []).map((x) => ({ id: x.id, name: councilById.get(x.id)?.name || units.get(x.id)?.name || x.id, held: timelines.has(x.id) }));
  /** @type {Map<string, string[]>} Irish councils before 2014 that a council of the registry took in */
  const irishPredecessors = new Map();
  for (const [id, u] of irish.units) {
    if (!u.predecessorOf) continue;
    if (!irishPredecessors.has(u.predecessorOf)) irishPredecessors.set(u.predecessorOf, []);
    /** @type {string[]} */ (irishPredecessors.get(u.predecessorOf)).push(id);
  }
  const councils = [...timelines.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, timeline]) => {
    const r = councilById.get(id);
    const u = units.get(id);
    const aldermen = registry.find((x) => x.aldermenOf === id);
    return {
      id,
      name: r?.name || u?.name || id,
      body: u?.body || r?.bodySlug || id,
      generation: r?.generation || (u?.body === 'ireland-local' ? 'pre-2014' : ''),
      jurisdiction: r?.jurisdiction || (u?.body === 'ireland-local' ? 'ireland' : 'northern-ireland'),
      aldermen: aldermen && timelines.has(aldermen.id) ? aldermen.id : null,
      aldermenOf: r?.aldermenOf || null,
      predecessors: [...links(r?.predecessors), ...(irishPredecessors.get(id) || []).map((p) => ({ id: p, name: units.get(p)?.name || p, held: timelines.has(p) }))],
      successors: [...links(r?.successors), ...(irish.units.get(id)?.predecessorOf ? links([{ id: /** @type {string} */ (irish.units.get(id)?.predecessorOf) }]) : [])],
      timeline,
    };
  });

  return {
    byelections: {
      schemaVersion: TABLES_SCHEMA,
      note: 'Civgraph Elections by-election tracker: every by-election and recorded co-option, built from the records build by scripts/build/elections-app/data.mjs --extracts (bodies-model.mjs says what it claims).',
      parties,
      units: unitsJson,
      rows,
    },
    control: {
      schemaVersion: TABLES_SCHEMA,
      note: 'Civgraph Elections council control: each council\'s seats by party after each election, and changes between elections where the records hold them; built by scripts/build/elections-app/data.mjs --extracts (bodies-model.mjs says what it claims).',
      parties,
      councils,
    },
  };
}

