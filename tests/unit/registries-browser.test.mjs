/**
 * The registry slices the browser code imports (registries/browser/, REG-0's browser half) are
 * what the registries give today, are imported statically (so esbuild bundles them), and are
 * never published as files of their own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry } from '../../registries/index.mjs';
import { browserSlices, sliceText, staleSlices } from '../../registries/browser/build.mjs';
import { EXCLUDE, SITE_DIRS } from '../../scripts/build/site.mjs';
import { statusKind } from '../../packages/core/src/election-domain.mjs';
import { isNonParty, partyAbbreviation, partyFullName } from '../../packages/core/src/party-names.mjs';

const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('registries/browser: every slice matches a fresh build from data/registries', () => {
  assert.deepEqual(staleSlices(), [], 'run node registries/browser/build.mjs');
  const slices = browserSlices();
  assert.deepEqual(Object.keys(slices), ['councils.json', 'council-search.json', 'parties.json', 'statuses.json', 'layer-types.json']);
  for (const [file, slice] of Object.entries(slices)) assert.equal(read(`registries/browser/${file}`), sliceText(slice), file);
});

test('registries/browser: each reader imports its slice statically, through its module', () => {
  const readers = {
    'src/ni-local-groups.mjs': '../registries/browser/councils.mjs',
    'src/catalogue/search.js': '../../registries/browser/council-search.mjs',
    'packages/core/src/party-names.mjs': '../../../registries/browser/parties.mjs',
    'packages/core/src/election-domain.mjs': '../../../registries/browser/statuses.mjs',
    'app/src/ni-local-view.js': '../../registries/browser/statuses.mjs',
    'src/map/renderer/map-controller.js': '../../../registries/browser/layer-types.mjs'
  };
  for (const [file, spec] of Object.entries(readers)) {
    assert.ok(read(file).split('\n').some((line) => /^import \w+ from '/.test(line) && line.endsWith(` from '${spec}';`)), file);
  }
  // Each module re-exports its slice: a static JSON import esbuild inlines.
  for (const file of Object.keys(browserSlices())) {
    const name = file.replace('.json', '');
    assert.match(read(`registries/browser/${name}.mjs`), new RegExp(`^import (\\w+) from '\\./${name}\\.json' with \\{ type: 'json' \\};\\n\\nexport default \\1;$`, 'm'), name);
  }
});

test('registries/browser: neither the slices nor data/registries are published as files', () => {
  assert.ok(!SITE_DIRS.includes('registries'));
  assert.ok(EXCLUDE.includes('data/registries/'));
});

test('registries/browser: the readers answer as the registries say', () => {
  const statuses = loadRegistry('statuses');
  const patterns = statuses.machines['candidate-count'].kindPatterns;
  assert.deepEqual(patterns.map((p) => p.kind), ['not-elected', 'elected', 'excluded']);
  for (const [status, kind] of [['Elected', 'elected'], ['Not Elected', 'not-elected'], ['Deemed elected', 'elected'],
    ['Excluded', 'excluded'], ['Eliminated', 'excluded'], ['Made quota', 'elected'], ['', ''], ['Withdrew', 'withdrew']]) {
    assert.equal(statusKind(status), kind, status);
  }
  const parties = loadRegistry('parties', { validate: false });
  for (const { abbreviation, fullName, spellings = [] } of parties.abbreviations) {
    for (const spelling of [fullName, ...spellings]) {
      // The first row naming a spelling wins (registries/parties.mjs abbreviationIndex).
      const owner = parties.abbreviations.find((r) => [r.abbreviation, r.fullName, ...(r.spellings || [])].includes(spelling));
      if (owner.abbreviation !== abbreviation) continue;
      assert.equal(partyAbbreviation(spelling), abbreviation, spelling);
      assert.equal(partyFullName(spelling), fullName, spelling);
    }
  }
  for (const label of parties.notParties) assert.ok(isNonParty(label), label);
});
