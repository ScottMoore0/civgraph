/**
 * The committed registries as rows: persons (person_registry.json), the names they stood under
 * (name_registry.json attestations), merges (person_id_merges.csv + person_id_confirmed_merges.csv),
 * reference facts (reference-offices/relations/dates.json), parties (party_registry.json), their
 * names and party-lineage.json events. Read straight from data/elections/: these are sources.
 *
 * Each row keeps the registry entry verbatim in `meta` (or `value`), with the queried fields
 * lifted into columns.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TableWriter, bool, int, readJson, transaction, txt } from './db.mjs';
import { REPO_ROOT } from './paths.mjs';

/**
 * A person of data/elections/persons/person_registry.json, as the loader reads it.
 * @typedef {{ personId?: string | number, id?: string | number, displayName?: string, name?: string,
 *   firstYear?: unknown, lastYear?: unknown, provisional?: boolean | null, candidacies?: unknown, [key: string]: unknown }} RegistryPerson
 */
/**
 * data/elections/persons/name_registry.json: the name strings and who bore each.
 * @typedef {{ names?: { id: string, string: string }[], attestations?: { nameId: string, personId?: string | number | null,
 *   candidacies?: unknown, firstYear?: unknown, lastYear?: unknown }[] }} NameRegistry
 */
/**
 * A party alias: a bare string, or the object form (`string`; older files have `name`).
 * @typedef {string | { string?: string, name?: string, corrupted?: boolean, from?: string, until?: string, bodies?: string[] }} PartyAlias
 */
/** @typedef {Omit<import('../../types/index.js').PartiesRegistryTypes.Entity, 'aliases'> & { aliases?: PartyAlias[] }} RegistryParty */
/**
 * An event of data/elections/parties/party-lineage.json, as the loader reads it.
 * @typedef {{ party?: string, date?: string, kind?: string, related?: unknown, into?: unknown, from?: unknown, [key: string]: unknown }} LineageEvent
 */

/**
 * A small RFC 4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return (body || []).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * The person-id merges: person_id_confirmed_merges.csv (confirmed) first, then the merge log
 * person_id_merges.csv; the first row for a drop id wins. Read by this ingest (person_merges)
 * and by the published-address ledger (scripts/lib/person-address-ledger.mjs), so both follow
 * merges the same way.
 * @param {string} [root]  the repository root
 * @returns {{ drop: string, keep: string, confirmed: number, rest: Record<string, string> }[]}
 */
export function readPersonMerges(root = REPO_ROOT) {
  /** @type {{ drop: string, keep: string, confirmed: number, rest: Record<string, string> }[]} */
  const rows = [];
  const seen = new Set();
  for (const [file, confirmed] of /** @type {[string, number][]} */ ([['person_id_confirmed_merges.csv', 1], ['person_id_merges.csv', 0]])) {
    const full = path.join(root, 'data', 'elections', 'persons', file);
    if (!existsSync(full)) continue;
    for (const row of parseCsv(readFileSync(full, 'utf8'))) {
      if (!row.drop || seen.has(row.drop)) continue;
      seen.add(row.drop);
      const { keep, drop, ...rest } = row;
      rows.push({ drop, keep, confirmed, rest });
    }
  }
  return rows;
}

/**
 * @param {import('../../storage/src/sqlite.mjs').SqliteHandle} db
 * @param {{ root?: string }} [options]
 */
export function ingestRegistries(db, { root = REPO_ROOT } = {}) {
  const at = (/** @type {string[]} */ ...p) => path.join(root, 'data', 'elections', ...p);
  return transaction(db, () => {
    /** @type {Record<string, number>} */
    const out = {};
    /** @type {{ entities?: RegistryPerson[] }} */
    const registry = readJson(at('persons', 'person_registry.json'));
    const persons = new TableWriter(db, 'persons');
    const seen = new Set();
    (registry.entities || []).forEach((p, ord) => {
      const id = String(p.personId ?? p.id);
      if (seen.has(id)) return;
      seen.add(id);
      persons.add({
        person_id: id, registry_id: txt(p.id), display_name: String(p.displayName || p.name || id),
        first_year: int(p.firstYear), last_year: int(p.lastYear), provisional: bool(p.provisional),
        candidacies: int(p.candidacies), ord, meta: JSON.stringify(p),
      });
    });
    out.persons = persons.finish();

    /** @type {NameRegistry} */
    const names = readJson(at('persons', 'name_registry.json'), { names: [], attestations: [] });
    const nameString = new Map((names.names || []).map((n) => [n.id, n.string]));
    const pn = new TableWriter(db, 'person_names');
    const seenNames = new Set();
    for (const a of names.attestations || []) {
      if (a.personId === null || a.personId === undefined) continue;
      const k = `${a.nameId}\u0000${a.personId}`;
      if (seenNames.has(k)) continue;
      seenNames.add(k);
      pn.add({
        name_id: a.nameId, person_id: String(a.personId), name: txt(nameString.get(a.nameId)),
        candidacies: int(a.candidacies), first_year: int(a.firstYear), last_year: int(a.lastYear),
      });
    }
    out.person_names = pn.finish();

    const merges = new TableWriter(db, 'person_merges');
    for (const { drop, keep, confirmed, rest } of readPersonMerges(root)) {
      merges.add({ drop_id: drop, keep_id: keep, confirmed, meta: JSON.stringify(rest) });
    }
    out.person_merges = merges.finish();

    const facts = new TableWriter(db, 'person_facts');
    for (const [kind, file] of [['office', 'reference-offices.json'], ['relation', 'reference-relations.json'], ['dates', 'reference-dates.json']]) {
      /** @type {{ people?: Record<string, unknown> }} */
      const docData = readJson(at('persons', file), { people: {} });
      const people = docData.people || {};
      for (const pid of Object.keys(people).sort()) {
        const entries = Array.isArray(people[pid]) ? people[pid] : [people[pid]];
        entries.forEach((value, ord) => facts.add({ person_id: String(pid), kind, ord, value: JSON.stringify(value) }));
      }
    }
    out.person_facts = facts.finish();

    /** @type {{ entities?: RegistryParty[] }} */
    const parties = readJson(at('parties', 'party_registry.json'));
    const pw = new TableWriter(db, 'parties');
    const names2 = new TableWriter(db, 'party_names');
    (parties.entities || []).forEach((p, ord) => {
      pw.add({
        party_id: p.id, type: txt(p.type), name: txt(p.name), short_name: txt(p.shortName), founded: txt(p.founded),
        founded_precision: txt(p.foundedPrecision), dissolved: txt(p.dissolved), status: txt(p.status),
        provisional: bool(p.provisional), confidence: txt(p.confidence), ord, meta: JSON.stringify(p),
      });
      // The names that are set (the filter drops the absent name and short name).
      const list = /** @type {{ name: string, kind: string, valid_from?: string, valid_until?: string, bodies?: string[], meta?: PartyAlias }[]} */ ([
        p.name && { name: p.name, kind: 'name' },
        p.shortName && { name: p.shortName, kind: 'short' },
        ...(p.aliases || []).map((a) => (typeof a === 'string'
          ? { name: a, kind: 'alias' }
          : { name: a.string || a.name || '', kind: a.corrupted ? 'corrupted' : 'alias', valid_from: a.from, valid_until: a.until, bodies: a.bodies, meta: a })),
      ].filter((x) => x && x.name));
      list.forEach((x, i) => names2.add({
        party_id: p.id, ord: i, name: x.name, kind: x.kind, valid_from: txt(x.valid_from), valid_until: txt(x.valid_until),
        bodies: x.bodies ? JSON.stringify(x.bodies) : null, meta: x.meta ? JSON.stringify(x.meta) : null,
      }));
    });
    out.parties = pw.finish();
    out.party_names = names2.finish();

    /** @type {{ events?: LineageEvent[] }} */
    const lineage = readJson(at('parties', 'party-lineage.json'), { events: [] });
    const ev = new TableWriter(db, 'party_events');
    (lineage.events || []).forEach((e, ord) => ev.add({
      ord, party_id: String(e.party || ''), date: txt(e.date), kind: txt(e.kind),
      related: e.related || e.into || e.from ? JSON.stringify(e.related ?? e.into ?? e.from) : null, meta: JSON.stringify(e),
    }));
    out.party_events = ev.finish();
    return out;
  });
}
