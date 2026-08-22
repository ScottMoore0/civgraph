#!/usr/bin/env node
/**
 * Regenerate the catalogue SQL and load it into D1, in one command.
 *
 * WHY THIS EXISTS
 *
 * The catalogue lives in two places: data/database/maps.json, which is authored and
 * reviewed in git, and the civgraph-catalogue D1, which is what /_api/catalogue serves.
 * `check:catalogue-sql` proves the generated SQL matches the file. NOTHING proved the
 * database had been loaded from it.
 *
 * So the gate could be green with D1 a week behind, and the only way to notice was to
 * run the network check by hand. In the week of 2026-08-22 that step was forgotten three
 * separate times -- after the 1921/1927 rename, after the 1915 rename, and after the
 * relative-URL fix -- each time leaving the live catalogue describing layers by their
 * old names while every offline check passed.
 *
 * A step that must be remembered after every catalogue edit is a step that will be
 * forgotten. This makes it one command, and verifies afterwards rather than assuming.
 *
 * WRANGLER AND ENVIRONMENT VARIABLES: if R2 credentials are exported (as the upload
 * scripts require), wrangler tries to use them for D1 and fails with a bare
 * "Authentication error [code: 10000]". They are cleared for this call.
 *
 *   npm run deploy:catalogue
 */
import { spawnSync } from 'node:child_process';

/**
 * `shell` is set ONLY for npx, never for node.
 *
 * process.execPath on Windows lives under a path containing a space. Spawned through
 * a shell, that space splits the command and it fails with an exit code that reads as
 * the SCRIPT failing -- which is how this wrapper reported "Regenerate the import SQL
 * exited 1" while the same script exited 0 when run directly. npx does need the shell
 * on Windows, because it is a .cmd.
 */
function run(label, command, args, env, useShell = false) {
  console.log(`\n== ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    encoding: 'utf8',
    shell: useShell,
    env: env || process.env
  });
  if (result.status !== 0) {
    console.error(`\nFAIL: ${label} exited ${result.status}.`);
    process.exit(result.status || 1);
  }
}

run('Regenerate the import SQL from maps.json',
  process.execPath, ['scripts/build-catalogue-d1-import.mjs']);

const clean = { ...process.env };
for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
  delete clean[key];
}

run('Load it into D1',
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['wrangler', 'd1', 'execute', 'civgraph-catalogue', '--remote',
    '--file=data/database/catalogue-d1-import.sql', '-y'],
  clean, true);

// Verify rather than assume. A load that reported success and a database that serves the
// right rows are different claims, and this project has been caught by that difference
// often enough to stop treating an exit code as evidence.
run('Verify D1 serves what the file records',
  process.execPath, ['scripts/validate-catalogue-d1-parity.mjs']);

console.log('\nCatalogue deployed: maps.json -> SQL -> D1, verified.');
