#!/usr/bin/env node
/**
 * Regenerate the browse index SQL and load it into civgraph-elections, in one command.
 *
 * Same shape and the same reasoning as deploy-catalogue-d1.mjs. The lesson that script
 * records is worth repeating here rather than relearning: `check:` proving the generated
 * SQL matches the source says NOTHING about whether the database was loaded from it. A
 * green gate with a week-old database is the failure mode, and the only way to notice
 * used to be running a network check by hand. So this regenerates, loads, and verifies.
 *
 * WRANGLER AND ENVIRONMENT VARIABLES: if R2 credentials are exported (as the upload
 * scripts require), wrangler tries to use them for D1 and fails with a bare
 * "Authentication error [code: 10000]". They are cleared for this call.
 *
 *   npm run deploy:browse-indexes            # all three
 *   npm run deploy:browse-indexes sources    # one
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * `shell` is set ONLY for npx, never for node.
 *
 * process.execPath on Windows lives under a path containing a space. Spawned through a
 * shell, that space splits the command and it fails with an exit code that reads as the
 * SCRIPT failing rather than the spawn. npx does need the shell on Windows, because it
 * is a .cmd.
 */
function run(label, command, args, env, useShell = false) {
  console.log(`\n== ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    encoding: 'utf8',
    shell: useShell,
    env: env || process.env,
  });
  if (result.status !== 0) {
    console.error(`\nFAIL: ${label} exited ${result.status}.`);
    process.exit(result.status || 1);
  }
}

const ENTITIES = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const names = ENTITIES.length ? ENTITIES : ['persons', 'register-interests', 'sources'];

run('Regenerate the browse index SQL',
  process.execPath, ['scripts/build-browse-index-d1-import.mjs', ...names]);

const clean = { ...process.env };
for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
  delete clean[key];
}

for (const name of names) {
  run(`Load ${name} into D1`,
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'd1', 'execute', 'civgraph-elections', '--remote',
      `--file=data/database/${name}-d1-import.sql`, '-y'],
    clean, true);
}

// Verify rather than assume. A load that reports success and an endpoint that serves the
// old rows look identical from here.
console.log('\n== Verify the endpoint serves what the file records');
const manifest = JSON.parse(readFileSync('data/browse/persons.json', 'utf8'));
const expected = Number(manifest.total) || 0;

const endpoint = 'https://civgraph.net/_api/persons?limit=1';
const response = await fetch(endpoint, { cache: 'no-store' });
if (!response.ok) {
  console.error(`FAIL: ${endpoint} returned ${response.status}.`);
  process.exit(1);
}
const payload = await response.json();
console.log(`  endpoint : ${endpoint}`);
console.log(`  file     : ${expected} persons`);
console.log(`  D1       : ${payload.total} persons`);
if (payload.total !== expected) {
  console.error(`\nFAIL: D1 serves ${payload.total} persons; the index records ${expected}.`);
  process.exit(1);
}
console.log('\nPASS: D1 serves the persons index exactly as the file records it.');
console.log('Persons deployed: browse index -> SQL -> D1, verified.');
