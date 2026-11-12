#!/usr/bin/env node
/**
 * Re-key data/elections/persons/wikidata-persons.json after person merges, from the registry's
 * `mergedFrom` lists (scripts/lib/wikidata-persons.mjs rekeyWikidataPersons): links move to the
 * kept person, resolved merge leads are dropped. Run after a merge lands (e.g. the owner-fixes
 * merges of 11 Nov 2026), then `npm run check:wikidata-persons`.
 *
 *   node scripts/ingest/persons/rekey-wikidata-persons.mjs           report what would change
 *   node scripts/ingest/persons/rekey-wikidata-persons.mjs --write   rewrite the file
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIKIDATA_PERSONS, loadWikidataPersons, rekeyWikidataPersons } from '../../lib/wikidata-persons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const registry = JSON.parse(readFileSync(path.join(ROOT, 'data', 'elections', 'persons', 'person_registry.json'), 'utf8'));
const { doc, changes } = rekeyWikidataPersons(loadWikidataPersons(), registry.entities || []);
for (const m of changes.moved) console.log(`moved ${m.qid}: ${m.from} -> ${m.to}`);
for (const d of changes.droppedLinks) console.log(`dropped ${d.qid} from ${d.from}: ${d.to} keeps ${d.kept}`);
if (changes.resolvedLeads.length) console.log(`resolved merge leads: ${changes.resolvedLeads.join(', ')}`);
if (changes.missing.length) console.log(`WARN: ids neither live nor merged (renumbered? re-run the matcher): ${changes.missing.join(', ')}`);
if (process.argv.includes('--write')) {
  doc.counts = { ...(doc.counts || {}), links: Object.keys(doc.persons).length, mergeLeads: doc.mergeLeads.length };
  writeFileSync(WIKIDATA_PERSONS, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`wrote ${path.relative(ROOT, WIKIDATA_PERSONS)}`);
} else {
  console.log('dry run; --write to apply');
}
