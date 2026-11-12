#!/usr/bin/env node
/**
 * Check data/elections/persons/wikidata-persons.json, the Wikidata crosswalk of Civgraph persons:
 * its shape (qid, confidence, name, evidence), that every person id it names (links, merge
 * leads) is a person in person_registry.json, that one Wikidata item is linked to one person
 * only, and that a link agrees with any `wikidata:` official id the registry holds.
 *
 * It also fails when an item leaves the crosswalk unaccounted for: every item the previous
 * committed crosswalk named (as a link or a merge lead) must still be named, or be listed with
 * its reason in wikidata-persons-removals.json. "Previous" is HEAD when the working file differs
 * from it, else the version before the last commit that changed it; the crosswalk on `main` (when
 * it differs) is compared too, and WIKIDATA_PERSONS_BASE_REF names another ref. Where git cannot
 * show a previous version (a shallow clone), that comparison is skipped with a note.
 *
 *   node scripts/check/rules/wikidata-persons.mjs
 *
 * Fails after a merge or renumbering that drops a person id the crosswalk names: re-key it with
 * `node scripts/ingest/persons/rekey-wikidata-persons.mjs --write` in the same change.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WIKIDATA_PERSONS, loadRemovals, loadWikidataPersons, lostQids, validateRemovals, validateWikidataPersons
} from '../../lib/wikidata-persons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTRY = path.join(ROOT, 'data', 'elections', 'persons', 'person_registry.json');
const REL = path.relative(ROOT, WIKIDATA_PERSONS).replaceAll('\\', '/');

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const personIds = new Set();
const registryQids = new Map();
for (const entity of registry.entities || []) {
  const id = String(entity.personId);
  personIds.add(id);
  const held = (entity.officialPersonIds || []).filter((/** @type {string} */ o) => o.startsWith('wikidata:'));
  if (held.length === 1) registryQids.set(id, held[0].slice('wikidata:'.length));
}
const doc = loadWikidataPersons(WIKIDATA_PERSONS);
const { errors, warnings } = validateWikidataPersons(doc, { personIds, registryQids });

const removalsDoc = loadRemovals();
errors.push(...validateRemovals(removalsDoc).map((e) => `wikidata-persons-removals.json: ${e}`));
const accounted = [...removalsDoc.conflicts, ...removalsDoc.removals].map((r) => r.qid);

/** @param {string[]} argv @returns {string|null} */
const git = (argv) => {
  try {
    return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  } catch { return null; }
};
/** The refs whose crosswalk the working one is compared with. @returns {string[]} */
function baseRefs() {
  if (process.env.WIKIDATA_PERSONS_BASE_REF) return [process.env.WIKIDATA_PERSONS_BASE_REF];
  const refs = [];
  const dirty = git(['diff', '--quiet', 'HEAD', '--', REL]) === null;
  if (dirty) refs.push('HEAD');
  else {
    const last = git(['log', '-1', '--format=%H', '--', REL])?.trim();
    if (last) refs.push(`${last}^`);
  }
  if (git(['diff', '--quiet', 'main', '--', REL]) === null && git(['rev-parse', '--verify', '--quiet', 'main'])) refs.push('main');
  return refs;
}
let compared = 0;
for (const ref of baseRefs()) {
  const text = git(['show', `${ref}:${REL}`]);
  if (text === null) { console.log(`note: no crosswalk at ${ref} (shallow clone, or the file's first commit): not compared`); continue; }
  compared += 1;
  for (const { qid, personIds: ids } of lostQids(JSON.parse(text), doc, accounted)) {
    errors.push(`${qid} (persons ${ids.join(', ')} at ${ref}) is no longer in the crosswalk and not in wikidata-persons-removals.json: re-key it to the kept person (rekey-wikidata-persons.mjs) or list it with the reason`);
  }
}

for (const w of warnings) console.log(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors.slice(0, 50)) console.error(`FAIL: ${e}`);
  if (errors.length > 50) console.error(`... and ${errors.length - 50} more`);
  process.exit(1);
}
const links = Object.keys(doc.persons || {}).length;
console.log(`wikidata-persons OK: ${links} links, ${(doc.mergeLeads || []).length} merge leads, ${(doc.splitFirst || []).length} records to split; no item lost against ${compared} earlier version(s); ${removalsDoc.conflicts.length} conflicts and ${removalsDoc.removals.length} removals listed`);
