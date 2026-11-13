// The Python ingest scripts read their council lists from the councils registry
// (data/registries/councils.json, through scripts/ingest/councils_registry.py) instead of
// carrying them. What they build must be exactly the lists they carried, order included
// (frozen in tests/intake/fixtures/python-council-lists.json), so their requests and outputs are
// unchanged. The comparison scraper's list stays a literal (its variant forms and their order
// are not registry data yet); packages/registries' own test keeps checking it against the registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from './helpers.mjs';

const REPO = path.resolve('.');
const hasPython = spawnSync('python', ['--version']).status === 0;
const frozen = JSON.parse(readFileSync(path.join(REPO, 'tests/intake/fixtures/python-council-lists.json'), 'utf8'));

// Load each script as a module (not as __main__, so nothing runs) and print its lists.
const DUMP = `
import json, runpy, sys
root = sys.argv[1]
ing = root + '/scripts/ingest/'
web = runpy.run_path(ing + 'council-websites/scrape_26_councils.py', run_name='councils_check')
old = runpy.run_path(ing + 'wikipedia/scrape_old_lgov_wikipedia.py', run_name='councils_check')
mod = runpy.run_path(ing + 'wikipedia/modern_lgov_wikipedia_common.py', run_name='councils_check')
ef = runpy.run_path(ing + 'facts/ef_offices.py', run_name='councils_check')
print(json.dumps({
  'councilWebsites': [list(c) for c in web['COUNCILS']],
  'wikipedia1973': old['COUNCILS'],
  'wikipedia2014': mod['MODERN_COUNCILS'],
  'wikipedia2014Display': [list(kv) for kv in mod['COUNCIL_DISPLAY_BY_KEY'].items()],
  'officesCouncils': [[k, list(v)] for k, v in ef['COUNCILS'].items()],
  'institutions': [k for k in ef['INSTITUTIONS'] if k.startswith('council-')],
}))
`;

test('the Python council lists come from the registry and equal the lists they replaced', { skip: !hasPython && 'python is not installed' }, () => {
  // The website scraper makes its download folders on import: run in a throwaway folder.
  const r = spawnSync('python', ['-I', '-c', DUMP, REPO], { cwd: tempDir('councils-py'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const now = JSON.parse(r.stdout);
  for (const key of ['councilWebsites', 'wikipedia1973', 'wikipedia2014', 'wikipedia2014Display', 'officesCouncils']) {
    assert.deepEqual(now[key], frozen[key], key);
  }
  assert.deepEqual(now.institutions, frozen.officesCouncils.map(([stem]) => `council-${stem}`));
});

test('the scripts no longer carry the lists the registry gives', () => {
  for (const [rel, name] of [
    ['council-websites/scrape_26_councils.py', 'COUNCILS'],
    ['wikipedia/scrape_old_lgov_wikipedia.py', 'COUNCILS'],
    ['wikipedia/modern_lgov_wikipedia_common.py', 'MODERN_COUNCILS'],
    ['wikipedia/modern_lgov_wikipedia_common.py', 'COUNCIL_DISPLAY_BY_KEY'],
  ]) {
    const text = readFileSync(path.join(REPO, 'scripts/ingest', rel), 'utf8');
    assert.match(text, new RegExp(`^${name} = (_CR\\[|\\[\\{'key': c\\['key'\\])`, 'm'), `${rel} ${name}`);
  }
  const ef = readFileSync(path.join(REPO, 'scripts/ingest/facts/ef_offices.py'), 'utf8');
  assert.match(ef, /\*\*_CR\['office_councils'\]\(\)/);
  assert.doesNotMatch(ef, /'antrim': \('Antrim Borough Council'/);
});
