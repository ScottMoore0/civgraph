#!/usr/bin/env node
/**
 * Rebuild the elections database from render/metadata/elections-test2, load it into
 * civgraph-elections, and prove the load took.
 *
 * Until this existed the reload was three commands typed from memory, and a green
 * check:elections-d1 said nothing about whether the edge cache had noticed. Now:
 *
 *   1. build tmp/elections.sqlite and tmp/elections.sql (the dump carries a dataset
 *      version: a hash of every source file)
 *   2. execute the dump against D1
 *   3. read the version back from D1 and require it to equal the local build's
 *   4. run the parity check, which compares counts and samples candidate rows
 *   5. refresh data/database/elections-schema.sql from the live schema
 *
 * The elections API keys its edge cache on that version, so step 3 passing means clean
 * URLs serve the new data within a minute, without touching CACHE_VERSION.
 *
 * R2 credentials are removed from the environment for the wrangler calls: exported, they
 * make wrangler fail D1 calls with a bare "Authentication error [code: 10000]".
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const env = { ...process.env };
for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_S3_ENDPOINT']) delete env[name];

function step(label, command, { shell = false, args = [] } = {}) {
  console.log(`\n== ${label}`);
  const result = shell
    ? spawnSync(command, { stdio: 'inherit', env, shell: true })
    : spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) {
    console.error(`FAIL: ${label} (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}

step('Build tmp/elections.sqlite and tmp/elections.sql', process.execPath, { args: ['scripts/build-elections-sqlite.mjs'] });

const localDb = new DatabaseSync('tmp/elections.sqlite', { readOnly: true });
const local = localDb.prepare(`SELECT value FROM dataset WHERE key = 'version'`).get()?.value;
localDb.close();
if (!local) {
  console.error('FAIL: the local build carries no dataset version.');
  process.exit(1);
}
console.log(`local dataset version: ${local}`);

step('Load into civgraph-elections', 'npx wrangler d1 execute civgraph-elections --remote --file=tmp/elections.sql --yes', { shell: true });

// Written to a file, not piped: piping wrangler's stdout through a shell crashes libuv on
// Windows, the same reason validate-elections-d1-parity.mjs redirects.
step(
  'Read the loaded dataset version back',
  `npx wrangler d1 execute civgraph-elections --remote --json --command "SELECT value FROM dataset WHERE key = 'version'" > tmp/elections-dataset-version.json`,
  { shell: true }
);
let remote = null;
try {
  const parsed = JSON.parse(readFileSync('tmp/elections-dataset-version.json', 'utf8'));
  remote = parsed?.[0]?.results?.[0]?.value ?? null;
} catch (error) {
  console.error(`FAIL: could not read the dataset version back from D1: ${error.message}`);
  process.exit(1);
}
if (remote !== local) {
  console.error(`FAIL: D1 carries dataset version ${remote}, the local build ${local}.`);
  process.exit(1);
}
console.log(`D1 dataset version matches: ${remote}`);

step('Parity: D1 against the metadata', process.execPath, { args: ['scripts/validate-elections-d1-parity.mjs'] });
step('Refresh the schema dump', 'npm run build:elections-schema', { shell: true });
console.log('\nPASS: elections database rebuilt, loaded, version-verified and parity-checked.');
