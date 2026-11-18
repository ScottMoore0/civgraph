/**
 * The election-types registry (data/registries/election-types.json, REG-2): valid, the same voting
 * systems the election-bodies schema allows, and the words its readers showed before they read it
 * (the Elections app's systemName, Browse's Type filter).
 *
 *   node --test tests/unit/registries-election-types.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadRegistry, registryErrors } from '@civgraph/registries/index.mjs';
import { browserElectionTypes, checkElectionTypes, electionKindIds, kindContestTypes, kindOfContestType, votingSystemIds } from '@civgraph/registries/election-types.mjs';
import { electionKindLabels, votingSystemNames, votingSystemsWithTransfers } from '@civgraph/registries/browser/election-type-names.mjs';
import { systemName } from '../../site/apps/elections/lib/format.js';

const registry = loadRegistry('election-types');
const readJson = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));

test('election-types: valid', () => {
  assert.deepEqual(registryErrors('election-types', registry), []);
  const broken = structuredClone(registry);
  delete broken.votingSystems.fptp.about;
  assert.ok(registryErrors('election-types', broken).length > 0);
});

test('election-types: the voting systems are the ones an election body may name', () => {
  const schema = readJson('packages/registries/schemas/election-bodies.schema.json');
  const allowed = JSON.stringify(schema).match(/"votingSystem":\{"enum":(\[[^\]]*\])/)?.[1];
  assert.ok(allowed, 'the election-bodies schema lists its voting systems');
  assert.deepEqual([...votingSystemIds(registry)].sort(), JSON.parse(allowed).sort());
  // The lists election-data-audit.mjs held before it read the registry (12 Nov 2026).
  assert.deepEqual(votingSystemIds(registry), ['fptp', 'block-vote', 'stv-gregory', 'stv-hare', 'party-list-dhondt', 'ordinal']);
  assert.deepEqual(electionKindIds(registry), ['general', 'by-election', 'union']);
});

test('election-types: the readers show the words they showed before', () => {
  assert.deepEqual(browserElectionTypes(registry), { votingSystemNames, electionKindLabels, votingSystemsWithTransfers });
  // The systems whose count transfers votes (the swingometer's caveat, EL2 13 Nov 2026): the STV pair.
  assert.deepEqual(votingSystemsWithTransfers, ['stv-gregory', 'stv-hare']);
  const before = {
    fptp: 'first past the post', 'stv-hare': 'single transferable vote', 'stv-gregory': 'single transferable vote (Gregory method)',
    'party-list-dhondt': "party list (D'Hondt)", ordinal: 'referendum',
  };
  for (const [id, name] of Object.entries(before)) assert.equal(systemName(id), name);
  assert.equal(systemName('block-vote'), 'block-vote');
  assert.equal(systemName(''), 'unknown system');
  assert.equal(systemName(null), 'unknown system');
  assert.deepEqual({ ...electionKindLabels, referendum: 'Referendums', other: 'Other' }, { general: 'General elections', 'by-election': 'By-elections', union: 'Members at the Union', referendum: 'Referendums', other: 'Other' });
});

test('election-types: a recall petition is listed with the by-elections; a referendum under no kind', () => {
  assert.equal(kindOfContestType(registry, 'recall-petition'), 'by-election');
  assert.equal(kindOfContestType(registry, 'referendum'), null);
  assert.equal(kindOfContestType(registry, 'election'), null);
  assert.equal(kindOfContestType(registry, undefined), null);
  // The Irish members at the Union (1801): a kind of its own, never a general election.
  assert.equal(kindOfContestType(registry, 'union-roll'), 'union');
  assert.deepEqual(kindContestTypes(registry), ['recall-petition', 'union-roll']);
  const twice = structuredClone(registry);
  twice.electionKinds.general.contestTypes = ['recall-petition'];
  assert.deepEqual(checkElectionTypes(twice), ['electionKinds: recall-petition is listed under general and by-election']);
});
