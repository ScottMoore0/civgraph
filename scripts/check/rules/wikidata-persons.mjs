#!/usr/bin/env node
/**
 * Check data/elections/persons/wikidata-persons.json, the Wikidata crosswalk of Civgraph persons:
 * its shape (qid, confidence, name, evidence), that every person id it names (links, merge
 * leads) is a person in person_registry.json, that one Wikidata item is linked to one person
 * only, and that a link agrees with any `wikidata:` official id the registry holds.
 *
 *   node scripts/check/rules/wikidata-persons.mjs
 *
 * Fails after a merge or renumbering that drops a person id the crosswalk names: re-key the
 * link (or drop the merge lead) in the same change.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIKIDATA_PERSONS, loadWikidataPersons, validateWikidataPersons } from '../../lib/wikidata-persons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTRY = path.join(ROOT, 'data', 'elections', 'persons', 'person_registry.json');

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const personIds = new Set();
const registryQids = new Map();
for (const entity of registry.entities || []) {
  const id = String(entity.personId);
  personIds.add(id);
  const held = (entity.officialPersonIds || []).filter((o) => o.startsWith('wikidata:'));
  if (held.length === 1) registryQids.set(id, held[0].slice('wikidata:'.length));
}
const doc = loadWikidataPersons(WIKIDATA_PERSONS);
const { errors, warnings } = validateWikidataPersons(doc, { personIds, registryQids });
for (const w of warnings) console.log(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors.slice(0, 50)) console.error(`FAIL: ${e}`);
  if (errors.length > 50) console.error(`... and ${errors.length - 50} more`);
  process.exit(1);
}
const links = Object.keys(doc.persons || {}).length;
console.log(`wikidata-persons OK: ${links} links, ${(doc.mergeLeads || []).length} merge leads, ${(doc.splitFirst || []).length} records to split`);
