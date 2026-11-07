#!/usr/bin/env node
/**
 * Validate the facts model (docs/facts-model.md): offices, tenures, party events, affiliations
 * and registered non-candidate persons.
 *
 *   1. each file against its JSON schema (data/schemas/*.schema.json);
 *   2. the rules a schema cannot state (scripts/lib/facts-model.mjs checkFactsModel): unique ids,
 *      every person, party, office and contest reference resolves, dates carry the precision
 *      recorded and run forwards, registered people stay in their id block and share no
 *      official id with a candidate;
 *   3. the registry is current: every registered non-candidate is in person_registry.json
 *      (run scripts/ingest/persons/build_person_registry_v2.py --force after adding one);
 *   4. every party-internal body in the elections index is declared as one.
 *
 *   node scripts/validate-facts-model.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { checkFactsModel, loadFactsModel, schemaErrors } from './lib/facts-model.mjs';

const ROOT = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const model = loadFactsModel(ROOT);
const registry = readJson('data/elections/persons/person_registry.json');
const personIds = new Set(registry.entities.map((e) => String(e.personId)));
const candidateOfficialIds = new Map();
for (const e of registry.entities) {
  if (e.keyedBy === 'registered') continue;
  for (const o of e.officialPersonIds || []) candidateOfficialIds.set(o, String(e.personId));
}
const partyIds = new Set(readJson('data/elections/parties/party_registry.json').entities.map((e) => e.id));
const electionKeys = new Set();
const ELECTIONS = path.join(ROOT, 'data/elections-source/data/elections');
for (const body of readdirSync(ELECTIONS)) {
  const dir = path.join(ELECTIONS, body);
  if (!existsSync(dir) || body.startsWith('_')) continue;
  for (const date of readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}/.test(date)) electionKeys.add(`${body}__${date}`);
}

const errors = [
  ...(await schemaErrors(model, ROOT)),
  ...checkFactsModel(model, { personIds, candidateOfficialIds, partyIds, electionKeys }),
];

const registered = new Set(registry.entities.filter((e) => e.keyedBy === 'registered').map((e) => String(e.personId)));
for (const p of model.nonCandidates) {
  if (!registered.has(p.personId)) errors.push(`non-candidate ${p.personId} (${p.displayName}) is not in person_registry.json: run python scripts/ingest/persons/build_person_registry_v2.py --force`);
}
for (const id of registered) {
  if (!model.nonCandidates.some((p) => p.personId === id)) errors.push(`person_registry.json registers ${id}, which non-candidate-persons.json no longer lists`);
}

const index = readJson('data/elections-source/data/elections_index.json');
for (const body of index.bodies || []) {
  if (body.bodyType === 'party-internal' && !partyIds.has(body.partyId)) errors.push(`elections index: party-internal body ${body.slug} names unknown party ${body.partyId}`);
  if (/-(leadership|nomination)$/.test(body.slug || '') && body.bodyType !== 'party-internal') errors.push(`elections index: ${body.slug} looks internal but is not declared bodyType party-internal`);
}

const counts = `${model.offices.length} offices, ${model.tenures.length} tenures, ${model.events.length} party events, `
  + `${model.affiliations.length} affiliations, ${model.nonCandidates.length} registered non-candidates`;
if (errors.length) {
  console.error(`FAIL: facts model (${counts}): ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 60)) console.error(`  - ${e}`);
  if (errors.length > 60) console.error(`  ... and ${errors.length - 60} more`);
  process.exit(1);
}
console.log(`OK: facts model valid (${counts})`);
