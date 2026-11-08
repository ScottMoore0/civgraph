// Every source under scripts/ingest/ is one plugin (refactor plan section 9): each folder has a
// plugin.mjs that loads, accounts for every file in the folder, never names a step that fetches
// from outside without flagging it, and never carries an email address.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { discoverPlugins, unaccountedFiles } from '../../packages/intake/src/plugins.mjs';

const REPO = path.resolve('.');
// A script that makes network calls (the same test the catalogue used to list them).
const NETWORK = /requests\.(get|post|Session)|urlopen|urllib\.request|httpx|\bfetch\(|internetarchive|['"]curl['"]|Invoke-WebRequest|HttpClient/;

test('every scripts/ingest folder is a valid plugin that accounts for each of its files', async () => {
  const { plugins, without, errors } = await discoverPlugins(REPO);
  assert.deepEqual(errors, []);
  assert.deepEqual(without, [], 'a source folder without a plugin.mjs');
  for (const p of plugins) assert.deepEqual(unaccountedFiles(p), [], `${p.id}: files no step, helper, research or data entry names`);
});

test('a step whose script fetches from outside is flagged network', async () => {
  const { plugins } = await discoverPlugins(REPO);
  const unflagged = [];
  for (const p of plugins) {
    for (const [id, st] of Object.entries(p.steps || {})) {
      const script = path.join(REPO, st.argv[1]);
      if (!statSync(script, { throwIfNoEntry: false })?.isFile()) { unflagged.push(`${p.id}/${id}: ${st.argv[1]} does not exist`); continue; }
      if (NETWORK.test(readFileSync(script, 'utf8')) && !st.network) unflagged.push(`${p.id}/${id}`);
    }
  }
  assert.deepEqual(unflagged, []);
});

test('no plugin names an email address or a private folder', () => {
  const root = path.join(REPO, 'scripts', 'ingest');
  for (const name of readdirSync(root)) {
    const text = readFileSync(path.join(root, name, 'plugin.mjs'), 'utf8');
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${name}: email address`);
    assert.doesNotMatch(text, /D:[\\/]+eoni|[\\/]private[\\/]|Pointer|properties\.geojson/i, `${name}: a private source`);
  }
});
