/**
 * The parties registry (data/registries/parties.json joined with the party files it names) is
 * valid, its abbreviations are exactly packages/core/src/party-names.mjs's, and the views read the files as
 * their current readers do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRegistry, registryErrors } from '../../registries/index.mjs';
import { seedParties } from '../../registries/seed/parties.mjs';
import {
  abbreviationIndex, entityAliasStrings, labelFoldIndex, labelInterpretationRules, partiesById, partyInfoFrom,
  partyLabelKey, retiredPartySlugs
} from '../../registries/parties.mjs';
import { isNonParty, partyInfo } from '@civgraph/core/party-names.mjs';
import { createPartyLabelInterpreter } from '../../scripts/lib/party-label-interpretations.mjs';

const registry = loadRegistry('parties');
const councils = loadRegistry('councils');
const clone = () => structuredClone(registry);

test('parties: the registry passes its schema and cross-file checks', () => {
  assert.deepEqual(registryErrors('parties', registry), []);
  assert.equal(registry.entities.entities.length, 257);
});

test('parties: data/registries/parties.json is what packages/core/src/party-names.mjs and the part list give', () => {
  const file = JSON.parse(readFileSync(new URL('../../data/registries/parties.json', import.meta.url), 'utf8'));
  assert.deepEqual(seedParties(), file);
  for (const rel of Object.values(file.parts)) assert.ok(readFileSync(new URL(`../../${rel}`, import.meta.url)), rel);
});

test('parties: the abbreviation view answers every spelling as partyInfo does', () => {
  const index = abbreviationIndex(registry);
  const probes = registry.abbreviations.flatMap((r) => [r.abbreviation, r.fullName, ...(r.spellings || [])]);
  probes.push('Independent (Alan Chambers)', 'Nationalist Party (Northern Ireland)', 'Sinn Fein Lozenge', 'Fianna  Fáil',
    'Alliance–Party', 'Nobody Party', '', 'Non-transferable');
  for (const p of probes) assert.deepEqual(partyInfoFrom(index, p), partyInfo(p), p);
  for (const label of registry.notParties) assert.ok(isNonParty(label), label);
  assert.equal(partyLabelKey('Sinn Féin Lozenge'), 'sinn fein');
});

test('parties: the label interpretation rules are the document the interpreter takes', () => {
  const rules = labelInterpretationRules(registry);
  const interpreter = createPartyLabelInterpreter(rules);
  const rule = rules.rules.find((r) => r.printed && !r.bodies && !r.region && !r.from && !r.until && !r.candidates && !r.whenParty);
  assert.equal(interpreter.read(rule.printed[0], '', { body: 'any', date: '1950-01-01' }, '', null), rule.party);
});

test('parties: the "ni" interpretation region names every pre-1973 council with results', () => {
  const ni = new Set(registry.labelInterpretations.regions.ni.bodies);
  const withResults = councils.councils.filter((c) => c.generation === 'pre-1973' && c.indexName).map((c) => c.bodySlug);
  for (const slug of withResults) assert.ok(ni.has(slug), slug);
  const councilSlugs = new Set(councils.councils.map((c) => c.bodySlug));
  const nonCouncil = [...ni].filter((b) => !councilSlugs.has(b)).sort();
  assert.deepEqual(nonCouncil, ['european-parliament', 'northern-ireland-assembly', 'northern-ireland-constitutional-convention',
    'northern-ireland-forum-for-political-dialogue', 'northern-ireland-referendum', 'parliament-of-northern-ireland', 'uup-leadership']);
});

test('parties: folds, retired slugs and entities', () => {
  const folds = labelFoldIndex(registry);
  assert.equal(folds.size, Object.values(registry.labelFolds.folds).reduce((n, f) => n + f.labels.length, 0));
  assert.equal(retiredPartySlugs(registry).get('republican-clubs'), 'workers-party');
  const uup = partiesById(registry).get('uup');
  assert.equal(uup.name, 'Ulster Unionist Party');
  assert.ok(entityAliasStrings(uup).includes('UUP'));
});

test('parties: the checks reject cross-file contradictions', () => {
  const dup = clone();
  dup.entities.entities.push({ ...dup.entities.entities[0] });
  assert.ok(registryErrors('parties', dup).some((e) => /duplicate id/.test(e)));

  const lifespan = clone();
  lifespan.lifespans.parties[0].founded = '1800-01-01';
  assert.ok(registryErrors('parties', lifespan).some((e) => /lifespans: .*founded/.test(e)));

  const both = clone();
  both.labelFolds.neverFold.push(Object.values(both.labelFolds.folds)[0].labels[0]);
  assert.ok(registryErrors('parties', both).some((e) => /both folded and neverFold/.test(e)));

  const region = clone();
  region.labelInterpretations.rules[0].region = 'mars';
  assert.ok(registryErrors('parties', region).some((e) => /unknown region mars/.test(e)));

  const abbr = clone();
  abbr.abbreviations.push({ abbreviation: 'DUP', fullName: 'Duplicate' });
  assert.ok(registryErrors('parties', abbr).some((e) => /DUP is listed twice/.test(e)));

  const shape = clone();
  shape.entities.entities[0].colour = 'red';
  assert.ok(registryErrors('parties', shape).some((e) => /colour/.test(e)));
});
