#!/usr/bin/env node
/**
 * Writes data/registries/parties.json: the parties registry's own file. It names the party files
 * the registry is made of (they stay where their readers find them until those readers move to
 * loadRegistry('parties'); LANDING.md lists them) and holds the one party list that was code
 * rather than data: the abbreviations of src/party-names.mjs (PARTIES, NOT_PARTIES), copied as
 * they are.
 *
 *   node registries/seed/parties.mjs           write the file
 *   node registries/seed/parties.mjs --check   exit 1 if it differs from a fresh seed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evalDeclarations, REPO_ROOT } from '../legacy-sources.mjs';

const OUT = 'data/registries/parties.json';

/** The party files, by the role each plays. */
export const PARTY_PARTS = {
  entities: 'data/elections/parties/party_registry.json',
  lifespans: 'data/elections/parties/party_lifespans.json',
  lineage: 'data/elections/parties/party-lineage.json',
  events: 'data/elections/parties/party-events.json',
  wikidata: 'data/elections/parties/party-wikidata.json',
  wikidataOverrides: 'data/elections/parties/party-wikidata-overrides.json',
  labelIds: 'data/elections-source/data/party-ids.json',
  labelFolds: 'scripts/build/browse-party-label-folds.json',
  labelInterpretations: 'data/elections/party-label-interpretations.json',
  colourReviewOverrides: 'data/elections/party-colour-review-overrides.json'
};

export function partyNamesSource(root = REPO_ROOT) {
  return evalDeclarations('src/party-names.mjs', 'const PARTIES', 'function key(', ['PARTIES', 'NOT_PARTIES'], root);
}

export function seedParties(root = REPO_ROOT) {
  const { PARTIES, NOT_PARTIES } = partyNamesSource(root);
  return {
    schemaVersion: 1,
    description: 'The parties registry: one validated view over the party files named in `parts` (loadRegistry(\'parties\') reads and joins them; registries/parties.mjs holds the views), plus the abbreviations that results tables show, with every spelling of each party found in the election data (from src/party-names.mjs). A party with no abbreviation is shown as spelled. `notParties` are labels found in the party column that are not parties. Schema: registries/schemas/parties.schema.json.',
    parts: { ...PARTY_PARTS },
    abbreviations: Array.from(PARTIES, ([abbreviation, fullName, ...spellings]) => ({
      abbreviation, fullName, ...(spellings.length ? { spellings: [...spellings] } : {})
    })),
    notParties: [...NOT_PARTIES]
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const out = `${JSON.stringify(seedParties(), null, 1)}\n`;
  const file = path.join(REPO_ROOT, OUT);
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (current !== out) { console.error(`${OUT} differs from a fresh seed`); process.exit(1); }
    console.log(`${OUT} matches a fresh seed`);
  } else {
    writeFileSync(file, out);
    console.log(`wrote ${OUT}`);
  }
}
