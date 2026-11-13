/**
 * The parties registry's noPartyLabels (data/registries/parties.json) against the three
 * NOT_A_PARTY sets they replaced (refactor survey part 7, rf9-registries, 13 Nov 2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry, registryErrors } from '../../packages/registries/src/index.mjs';
import { notAPartyLabels } from '../../packages/core/src/party-names.mjs';
import { NO_LABEL, NO_PARTY_RECORDED } from '../../packages/core/src/election-domain.mjs';

/** @param {string} rel */
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
/** @param {Set<string>} set */
const sorted = (set) => [...set].sort();

test('no-party labels: each reader gets the set it held', () => {
  // functions/_browse-page.js: a person's party list.
  assert.deepEqual(sorted(notAPartyLabels('candidacies')), sorted(new Set(['No label', 'No party recorded'])));
  assert.deepEqual(sorted(notAPartyLabels('candidacies')), sorted(new Set([NO_LABEL, NO_PARTY_RECORDED])));
  assert.ok(read('functions/_browse-page.js').includes("const NOT_A_PARTY = notAPartyLabels('candidacies');"));
  // scripts/build/graph/build-semantic-graph.mjs: summary labels and a person record's "Unknown".
  assert.deepEqual(sorted(notAPartyLabels('candidacies', 'persons')), sorted(new Set(['No party recorded', 'No label', 'Unknown'])));
  // scripts/build/words-parties.mjs: Words in parliament's labels.
  assert.deepEqual(sorted(notAPartyLabels('words')), sorted(new Set(['(none)', 'No party recorded'])));
});

test('no-party labels: the registry refuses a label listed twice or one with an abbreviation', () => {
  const registry = loadRegistry('parties');
  const twice = structuredClone(registry);
  twice.noPartyLabels.push({ ...twice.noPartyLabels[0] });
  assert.ok(registryErrors('parties', twice).some((e) => e.includes('is listed twice')));
  const abbreviated = structuredClone(registry);
  abbreviated.noPartyLabels.push({ label: 'DUP', in: ['candidacies'], meaning: 'not a no-party label' });
  assert.ok(registryErrors('parties', abbreviated).some((e) => e.includes('noPartyLabels: DUP also has an abbreviation')));
});
