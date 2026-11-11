// Every source under scripts/ingest/ is one plugin (refactor plan section 9): each folder has a
// plugin.mjs that loads, accounts for every file in the folder, never names a step that fetches
// from outside without flagging it, and never carries an email address.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { discoverPlugins, parityLedgerProblems, readParityLedger, unaccountedFiles } from '../../packages/intake/src/plugins.mjs';

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
    if (!statSync(path.join(root, name)).isDirectory()) continue;
    const text = readFileSync(path.join(root, name, 'plugin.mjs'), 'utf8');
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${name}: email address`);
    assert.doesNotMatch(text, /D:[\\/]+eoni|[\\/]private[\\/]|Pointer|properties\.geojson/i, `${name}: a private source`);
  }
});

test('every step that does not fetch is in the parity ledger, proved or blocked with a reason', async () => {
  const { plugins } = await discoverPlugins(REPO);
  const ledger = readParityLedger(REPO);
  assert.deepEqual(parityLedgerProblems(plugins, ledger), []);
  // The ledger's own rules.
  const demo = [{ id: 'd', steps: { a: { title: 'a', argv: ['node', 'scripts/a.mjs'] }, n: { title: 'n', argv: ['node', 'scripts/n.mjs'], network: true } } }];
  assert.deepEqual(parityLedgerProblems(demo, {}), ['d/a: no parity entry (proved or blocked)']);
  assert.deepEqual(parityLedgerProblems(demo, { 'd/a': { proved: 'a record', blocked: 'and a reason' }, 'd/x': { proved: 'somewhere' } }), ['d/a: give exactly one of proved, blocked', 'd/x: no such plugin step']);
  assert.deepEqual(parityLedgerProblems(demo, { 'd/a': { blocked: 'why' }, 'd/n': { blocked: 'no network here' } }), ['d/a: blocked needs a reason or a record', 'd/n: a network step is listed only once proved offline']);
  // No machine paths or private folders in the reasons.
  const text = readFileSync(path.join(root(), 'parity.json'), 'utf8');
  assert.doesNotMatch(text, /[A-Za-z]:[\/]|[\/]private[\/]/, 'a machine path in scripts/ingest/parity.json');
});

function root() { return path.join(REPO, 'scripts', 'ingest'); }
