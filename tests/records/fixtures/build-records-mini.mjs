#!/usr/bin/env node
/**
 * Writes tests/records/fixtures/records-mini.jsonl: a small, coherent slice of a records build
 * (packages/schema/src/schema.mjs tables), so the /api/v1 contract test can run every records
 * variant without the 4 GB build (tests/functions/api-v1-contracts.test.mjs; loaded by
 * ./records-mini.mjs).
 *
 *   node tests/records/fixtures/build-records-mini.mjs [--from tmp/records/civgraph-records.sqlite]
 *
 * What it keeps: one small election (two or three contests, six or more candidacies, the fewest) with every row about it (contests,
 * candidacies, counts, animation, features, summaries, manifest entry, cards, details,
 * provenance, citations, legislation); its candidates as persons with their names, aliases,
 * facts and cards; one division with its votes, one of its voters and one voting party; every
 * party table but the cards, whose rows it keeps for the election's parties, one profiled party
 * and the first few; the first few sources, register entries, offices, maps, map cards, feature
 * groups and layers (one with a duplicates sidecar); the graph entities of two kept persons and
 * the first entity, with their statements, reverse items and browse keys; every dataset row,
 * document and catalogue/layer head part. Every JSON text longer than 8,000 characters (the graph
 * manifest, the catalogue documents in document_parts, long party details) is kept with each
 * array cut to its first three items and each object of more than 40 keys (a dictionary of
 * records) to its first five: the shapes stay, the bulk goes.
 *
 * Every value is public record data (what /_api serves). Reads the build read-only; writes only
 * the fixture file. Re-run after a schema change (the loader refuses a fixture whose columns
 * differ from schema.mjs).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { TABLES } from '../../../packages/schema/src/schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argAt = process.argv.indexOf('--from');
const FROM = path.resolve(REPO, argAt > 0 ? process.argv[argAt + 1] : 'tmp/records/civgraph-records.sqlite');
const OUT = path.join(HERE, 'records-mini.jsonl');

const db = new DatabaseSync(FROM, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params).map((r) => ({ ...r }));
const one = (sql, ...params) => all(sql, ...params)[0];
const list = (values) => [...new Set(values.filter((v) => v !== null && v !== undefined))];
const marks = (values) => values.map(() => '?').join(', ') || 'NULL';

// ------------------------------------------------------------------ choose
const election = one(`SELECT r.key FROM r_elections r
  JOIN contests c ON c.election_key = r.key
  WHERE EXISTS (SELECT 1 FROM election_summaries s WHERE s.election_key = r.key)
    AND EXISTS (SELECT 1 FROM election_details d WHERE d.election_key = r.key)
    AND EXISTS (SELECT 1 FROM provenance_shards p WHERE p.election_key = r.key)
  GROUP BY r.key HAVING COUNT(*) BETWEEN 2 AND 3
  ORDER BY (SELECT COUNT(*) FROM candidacies k WHERE k.election_key = r.key) >= 6 DESC,
           (SELECT COUNT(*) FROM candidacies k WHERE k.election_key = r.key), r.date DESC, r.key LIMIT 1`).key;
const contestFiles = list(all('SELECT source_file FROM contests WHERE election_key = ?', election).map((r) => r.source_file));
const division = one('SELECT division_id AS id FROM divisions ORDER BY shard, ord LIMIT 1');
const voter = division ? one('SELECT person_id AS id FROM division_votes WHERE division_id = ? AND person_id IN (SELECT person_id FROM vote_persons) ORDER BY ord LIMIT 1', division.id) : null;
const voteParty = division ? one('SELECT slug FROM vote_parties ORDER BY slug LIMIT 1') : null;
const personIds = list([...all('SELECT person_id FROM candidacies WHERE election_key = ?', election).map((r) => r.person_id), voter?.id]);
const personSlugs = list(all(`SELECT slug FROM person_cards WHERE id IN (${marks(personIds)})`, ...personIds).map((r) => r.slug));
const partySlugs = list([
  ...all("SELECT slug FROM party_cards WHERE profile IS NOT NULL AND slug IN ('dup', 'sinn-fein', 'fianna-fail') ORDER BY slug LIMIT 1").map((r) => r.slug),
  ...all('SELECT slug FROM party_cards ORDER BY ord LIMIT 2').map((r) => r.slug),
  voteParty?.slug,
]);
const partyIds = list([...partySlugs, ...all(`SELECT party_id FROM candidacies WHERE election_key = ?`, election).map((r) => r.party_id)]);
const sourceSlugs = all('SELECT slug FROM sources ORDER BY ord LIMIT 3').map((r) => r.slug);
const mapIds = all('SELECT map_id FROM maps ORDER BY ord, map_id LIMIT 4').map((r) => r.map_id);
const layerIds = list([
  ...all('SELECT layer_id FROM layers ORDER BY ord, layer_id LIMIT 4').map((r) => r.layer_id),
  ...all("SELECT layer_id FROM layers WHERE duplicates IS NOT NULL AND duplicates <> '' ORDER BY layer_id LIMIT 1").map((r) => r.layer_id),
]);
const graphSlugs = personSlugs.slice(0, 2);
const browseKeys = graphSlugs.flatMap((s) => [`person:${s}`, `persons:${s}`]);
const entityIds = list([
  ...all(`SELECT entity_id FROM graph_browse_keys WHERE browse_key IN (${marks(browseKeys)})`, ...browseKeys).map((r) => r.entity_id),
  one('SELECT entity_id FROM graph_entities ORDER BY shard, ord LIMIT 1')?.entity_id,
]);

// ------------------------------------------------------------------ the rows of each table
const E = [election];
const where = {
  dataset: ['1'], documents: ['1'], catalogue_parts: ['1'], layer_parts: ['1'], document_parts: ['1'],
  person_cards_facets: ['1'], sources_facets: ['1'], register_entries_facets: ['1'],
  parties: [`party_id IN (${marks(partyIds)})`, partyIds], party_names: [`party_id IN (${marks(partyIds)})`, partyIds],
  party_events: [`party_id IN (${marks(partyIds)})`, partyIds],
  party_label_map: [`party_slug IN (${marks(partyIds)}) OR ord IN (SELECT ord FROM party_label_map ORDER BY ord LIMIT 5)`, partyIds],
  party_aliases: [`slug IN (${marks(partyIds)})`, partyIds],
  legislation: [`legislation_id IN (SELECT legislation_id FROM election_legislation WHERE source_file IN (${marks(contestFiles)})) OR legislation_id IN (SELECT legislation_id FROM legislation ORDER BY ord LIMIT 2)`, contestFiles],
  r_elections: ['key = ?', E], election_aggregates: ['election_key = ?', E], contests: ['election_key = ?', E],
  candidacies: ['election_key = ?', E], r_counts: ['election_key = ?', E], contest_animation: ['election_key = ?', E],
  contest_features: ['election_key = ?', E], election_summaries: ['election_key = ?', E], election_manifest: ['key = ?', E],
  election_cards: ['election_key = ? OR key = ?', [election, election]], election_details: ['election_key = ?', E],
  contest_provenance: ['election_key = ?', E], provenance_shards: ['election_key = ?', E],
  citations: [`subject_key = ? OR subject_key IN (${marks(contestFiles)})`, [election, ...contestFiles]],
  election_legislation: [`source_file IN (${marks(contestFiles)})`, contestFiles],
  persons: [`person_id IN (${marks(personIds)})`, personIds], person_names: [`person_id IN (${marks(personIds)})`, personIds],
  person_facts: [`person_id IN (${marks(personIds)})`, personIds], person_merges: [`keep_id IN (${marks(personIds)})`, personIds],
  person_cards: [`id IN (${marks(personIds)})`, personIds], person_aliases: [`slug IN (${marks(personSlugs)})`, personSlugs],
  person_card_parties: [`slug IN (${marks(personSlugs)})`, personSlugs],
  party_cards: [`slug IN (${marks(partySlugs)})`, partySlugs],
  office_cards: ['slug IN (SELECT slug FROM office_cards ORDER BY ord LIMIT 3)'],
  sources: [`slug IN (${marks(sourceSlugs)})`, sourceSlugs], source_aliases: [`slug IN (${marks(sourceSlugs)})`, sourceSlugs],
  source_merges: ['ord IN (SELECT ord FROM source_merges ORDER BY ord LIMIT 3)'],
  register_entries: ['slug IN (SELECT slug FROM register_entries ORDER BY ord LIMIT 3)'],
  register_entries_aliases: ['slug IN (SELECT slug FROM register_entries ORDER BY ord LIMIT 3)'],
  divisions: ['division_id = ?', [division?.id]], division_votes: ['division_id = ?', [division?.id]],
  vote_persons: ['person_id = ?', [voter?.id]], vote_parties: ['slug = ?', [voteParty?.slug]],
  graph_entities: [`entity_id IN (${marks(entityIds)})`, entityIds], graph_browse_keys: [`entity_id IN (${marks(entityIds)})`, entityIds],
  graph_statements: [`subject_id IN (${marks(entityIds)})`, entityIds], graph_reverse: [`entity_id IN (${marks(entityIds)})`, entityIds],
  graph_source_statements: ['(source_id, ord) IN (SELECT source_id, ord FROM graph_source_statements ORDER BY source_id, ord LIMIT 5)'],
  maps: [`map_id IN (${marks(mapIds)})`, mapIds], map_cards: ['slug IN (SELECT slug FROM map_cards ORDER BY ord, slug LIMIT 3)'],
  feature_groups: ['ord IN (SELECT ord FROM feature_groups ORDER BY ord LIMIT 3)'],
  layers: [`layer_id IN (${marks(layerIds)})`, layerIds], layer_aliases: [`layer_id IN (${marks(layerIds)})`, layerIds],
};

/** Cut a JSON value's bulk: arrays to 3 items, objects of more than 40 keys to 5. */
function trim(value) {
  if (Array.isArray(value)) return value.slice(0, 3).map(trim);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return Object.fromEntries((entries.length > 40 ? entries.slice(0, 5) : entries).map(([k, v]) => [k, trim(v)]));
  }
  return value;
}
const BIG = 8_000;
/** A long JSON text, trimmed; anything else as it is. */
const slim = (v) => {
  if (typeof v !== 'string' || v.length <= BIG || !/^[[{]/.test(v)) return v;
  try { return JSON.stringify(trim(JSON.parse(v))); } catch { return v; }
};

const tableNames = new Set(all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));
const lines = [JSON.stringify({ fixture: 'records-mini', election, note: 'written by tests/records/fixtures/build-records-mini.mjs; public record data' })];
const counts = {};
for (const t of TABLES) {
  if (!tableNames.has(t.name)) continue;
  const cols = t.columns.map((c) => c.name);
  const [clause, params = []] = where[t.name] || [null];
  if (!clause) throw new Error(`no selection for table ${t.name}: add one to build-records-mini.mjs`);
  let rows = all(`SELECT ${cols.join(', ')} FROM ${t.name} WHERE ${clause} ORDER BY ${t.pk.join(', ')}`, ...params);
  if (t.name !== 'document_parts') rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, slim(v)])));
  if (t.name === 'document_parts') {
    // One part per document, its JSON trimmed (the handler joins parts in order).
    const byName = new Map();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) || []), r]);
    rows = [...byName.values()].map((parts) => {
      const body = parts.map((p) => p.body).join('');
      return { ...parts[0], part: 0, body: slim(body) };
    });
  }
  counts[t.name] = rows.length;
  lines.push(JSON.stringify({ table: t.name, columns: cols }));
  for (const r of rows) lines.push(JSON.stringify(cols.map((c) => r[c])));
}
writeFileSync(OUT, `${lines.join('\n')}\n`);
db.close();
console.log(`wrote ${path.relative(REPO, OUT)}: election ${election}; ${Object.values(counts).reduce((a, b) => a + b, 0)} rows`);
console.log(Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
