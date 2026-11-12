#!/usr/bin/env node
/**
 * Re-key data/elections/persons/wikidata-persons.json after person merges
 * (scripts/lib/wikidata-persons.mjs rekeyWikidataPersons). A retired id answers as the id it was
 * merged into: the registry's `mergedFrom` lists, then person_id_confirmed_merges.csv (redirect
 * rows included), person_id_merges.csv and ie-ei-crosswalk.csv. Links move to the kept person;
 * a settled merge lead becomes the kept person's link; when the kept person already holds another
 * item, it keeps its own and the other is written to wikidata-persons-removals.json under
 * `conflicts` for the owner. Nothing is dropped unlisted. Run after a merge lands, then
 * `npm run check:wikidata-persons`.
 *
 *   node scripts/ingest/persons/rekey-wikidata-persons.mjs                 report what would change
 *   node scripts/ingest/persons/rekey-wikidata-persons.mjs --write         rewrite both files
 *   node scripts/ingest/persons/rekey-wikidata-persons.mjs --restore-from <git ref> [--note TEXT] [--write]
 *        bring back the items the crosswalk at <ref> linked (or listed as leads) that today's has
 *        lost, re-keyed to today's persons (the wave-6 repair of 12 Nov 2026)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../../packages/loader/src/ingest-registries.mjs';
import {
  WIKIDATA_PERSONS, WIKIDATA_REMOVALS, addRemovals, loadRemovals, loadWikidataPersons, rekeyWikidataPersons, restoreLostLinks
} from '../../lib/wikidata-persons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PERSONS = path.join(ROOT, 'data', 'elections', 'persons');
const args = process.argv.slice(2);
const option = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const write = args.includes('--write');
const restoreFrom = option('--restore-from');
const date = new Date().toISOString().slice(0, 10);

/** @type {{ entities?: { personId: number|string, mergedFrom?: (number|string)[], officialPersonIds?: string[] }[] }} */
const registry = JSON.parse(readFileSync(path.join(PERSONS, 'person_registry.json'), 'utf8'));
const entities = registry.entities || [];
/** @type {Map<string, string>} */
const registryQids = new Map();
for (const e of entities) {
  const held = (e.officialPersonIds || []).filter((o) => o.startsWith('wikidata:'));
  if (held.length === 1) registryQids.set(String(e.personId), held[0].slice('wikidata:'.length));
}
const redirects = ['person_id_confirmed_merges.csv', 'person_id_merges.csv', 'ie-ei-crosswalk.csv']
  .map((f) => path.join(PERSONS, f)).filter((f) => existsSync(f))
  .flatMap((f) => parseCsv(readFileSync(f, 'utf8')));
const removalsDoc = loadRemovals();

const current = loadWikidataPersons();
let doc, conflicts, removals;
if (restoreFrom) {
  const rel = path.relative(ROOT, WIKIDATA_PERSONS).replaceAll('\\', '/');
  const earlier = JSON.parse(execFileSync('git', ['show', `${restoreFrom}:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }));
  const removed = new Set([...removalsDoc.conflicts, ...removalsDoc.removals].map((r) => r.qid));
  const note = option('--note') || `restored by rekey-wikidata-persons.mjs --restore-from ${restoreFrom} (${date})`;
  const out = restoreLostLinks(current, earlier, entities, { redirects, registryQids, note, date, removed });
  ({ doc, conflicts, removals } = out);
  for (const r of out.restored) console.log(`restored ${r.qid} to ${r.to} (${r.name})`);
  console.log(`${out.restored.length} links restored from ${restoreFrom}`);
} else {
  const out = rekeyWikidataPersons(current, entities, { redirects, registryQids, note: option('--note'), date });
  ({ doc } = out);
  ({ conflicts, removals } = out.changes);
  for (const m of out.changes.moved) console.log(`moved ${m.qid}: ${m.from} -> ${m.to}`);
  for (const l of out.changes.linkedFromLeads) console.log(`linked ${l.qid} to ${l.to}: merge lead "${l.verdict}" of ${l.from.join(', ')} settled by the merge`);
  if (out.changes.resolvedLeads.length) console.log(`resolved merge leads: ${out.changes.resolvedLeads.join(', ')}`);
  if (out.changes.missing.length) console.log(`WARN: ids neither live nor redirected (renumbered? re-run the matcher): ${out.changes.missing.join(', ')}`);
}
for (const c of conflicts) console.log(`CONFLICT ${c.qid} (${c.name || c.personId}): ${c.reason}`);
for (const r of removals) console.log(`REMOVED ${r.qid} (${r.name || r.personId}): ${r.reason}`);

if (write) {
  const links = Object.values(doc.persons);
  /** @type {Record<string, unknown>} */
  const counts = { ...(/** @type {Record<string, unknown>} */ (doc.counts) || {}), links: links.length, mergeLeads: doc.mergeLeads.length };
  for (const c of ['official', 'high', 'medium']) if (`confidence:${c}` in counts) counts[`confidence:${c}`] = links.filter((l) => l.confidence === c).length;
  writeFileSync(WIKIDATA_PERSONS, `${JSON.stringify({ ...doc, counts }, null, 1)}\n`);
  console.log(`wrote ${path.relative(ROOT, WIKIDATA_PERSONS)}`);
  if (conflicts.length || removals.length) {
    writeFileSync(WIKIDATA_REMOVALS, `${JSON.stringify(addRemovals(removalsDoc, conflicts, removals), null, 1)}\n`);
    console.log(`wrote ${path.relative(ROOT, WIKIDATA_REMOVALS)}: ${conflicts.length} conflicts for the owner, ${removals.length} removals`);
  }
} else {
  console.log('dry run; --write to apply');
}
