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
import { readFileSync, existsSync } from 'node:fs';

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
//
// VERIFY WHAT WAS ACTUALLY DEPLOYED. This block used to check `persons` unconditionally,
// whatever it had just loaded -- so `deploy:browse-indexes sources` printed "== Load sources
// into D1" and then "PASS: D1 serves the persons index", a green line about an index the run
// had not touched. That is worse than no check: it reads as confirmation. Caught 2026-08-28
// while deploying the ElectionsNI attribution, when sources had in fact loaded correctly and
// the passing line was still about persons.
console.log('\n== Verify each deployed endpoint serves what its file records');

let failed = false;
for (const name of names) {
  const manifestPath = `data/browse/${name}.json`;
  if (!existsSync(manifestPath)) {
    console.error(`  ${name}: FAIL -- ${manifestPath} is missing, cannot verify.`);
    failed = true;
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expected = Number(manifest.total) || 0;
  const endpoint = `https://civgraph.net/_api/${name}?limit=1`;

  let payload;
  try {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) {
      console.error(`  ${name}: FAIL -- ${endpoint} returned ${response.status}.`);
      failed = true;
      continue;
    }
    payload = await response.json();
  } catch (error) {
    console.error(`  ${name}: FAIL -- ${endpoint} did not respond (${error.message}).`);
    failed = true;
    continue;
  }

  const served = Number(payload.total) || 0;
  const verdict = served === expected ? 'PASS' : 'FAIL';
  if (verdict === 'FAIL') failed = true;
  console.log(`  ${name.padEnd(18)} file ${String(expected).padStart(6)}   D1 ${String(served).padStart(6)}   ${verdict}`);
}

if (failed) {
  console.error('\nFAIL: at least one deployed index is not served as its file records.');
  process.exit(1);
}
console.log(`\nPASS: ${names.join(', ')} deployed -- browse index -> SQL -> D1, verified.`);
