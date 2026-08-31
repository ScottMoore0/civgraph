#!/usr/bin/env node
/**
 * Set CIVGRAPH_CONTRIBUTORS safely, without pasting addresses into a chat or a commit.
 *
 * THE PROBLEM THIS SOLVES
 *
 * `wrangler pages secret put` OVERWRITES. It cannot append, and Cloudflare secrets are
 * write-only, so nothing -- not wrangler, not the API, not this script -- can read the
 * current list back. Adding one address therefore risks silently revoking everyone already
 * on it. docs/cloudflare-inventory.md records 2 contributors live, so a blind overwrite
 * would cut two people off with no error and no log.
 *
 * So the list is assembled from a LOCAL, GITIGNORED file that you own:
 *
 *     .contributors.local      one email per line, # for comments
 *
 * That keeps addresses out of the repository and out of any transcript, which is the same
 * reason wrangler.toml gives for not committing them: they are personal data.
 *
 * SAFETY
 *
 *   - refuses to run if the file is missing or empty
 *   - validates every line looks like an address, and reports the ones that do not
 *   - refuses to SHRINK the list unless --allow-removals is passed, because a shorter list
 *     is how an accidental overwrite presents
 *   - --dry-run prints exactly what would be sent and sends nothing
 *   - clears R2 and Cloudflare credentials from the child environment: exported R2 keys make
 *     wrangler fail against Pages with a bare "Authentication error [code: 10000]"
 *
 *   node scripts/set-contributors.mjs --dry-run
 *   node scripts/set-contributors.mjs
 *   node scripts/set-contributors.mjs --expect 2      # assert the previous size
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const FILE = '.contributors.local';
const SECRET = 'CIVGRAPH_CONTRIBUTORS';
const PROJECT = 'civgraph';

const DRY = process.argv.includes('--dry-run');
const ALLOW_REMOVALS = process.argv.includes('--allow-removals');
const expectIndex = process.argv.indexOf('--expect');
const expected = expectIndex >= 0 ? Number(process.argv[expectIndex + 1]) : null;

if (!existsSync(FILE)) {
  console.error(`FAIL: ${FILE} does not exist.`);
  console.error('');
  console.error('  Create it with one email address per line -- the CURRENT contributors plus');
  console.error('  any you are adding. It is gitignored, so the addresses stay on this machine.');
  console.error('');
  console.error('      # .contributors.local');
  console.error('      existing.one@example.com');
  console.error('      existing.two@example.com');
  console.error('      gmmbfs@gmail.com');
  console.error('');
  console.error('  The secret cannot be read back, so this file is the only way to add someone');
  console.error('  without revoking everyone already on the list.');
  process.exit(1);
}

const lines = readFileSync(FILE, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean);

const valid = [];
const invalid = [];
for (const line of lines) {
  // Deliberately loose: the identity provider decides what a real address is, this only
  // catches obvious paste damage such as a stray comma or a name without an @.
  if (/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(line)) valid.push(line.toLowerCase());
  else invalid.push(line);
}

if (invalid.length) {
  console.error(`FAIL: ${invalid.length} line(s) do not look like an email address:`);
  for (const line of invalid) console.error(`    ${JSON.stringify(line)}`);
  console.error('  One address per line. Do not use commas -- this script joins them.');
  process.exit(1);
}

const unique = [...new Set(valid)];
if (!unique.length) {
  console.error('FAIL: no addresses found. Refusing to write an empty list, which would close');
  console.error('  contribution to everyone (an empty allowlist means CLOSED, see _auth.js).');
  process.exit(1);
}

if (expected !== null && Number.isFinite(expected) && unique.length < expected && !ALLOW_REMOVALS) {
  console.error(`FAIL: ${unique.length} address(es) given but --expect ${expected} was asserted.`);
  console.error('  A shorter list is how an accidental overwrite presents. Pass --allow-removals');
  console.error('  if you really mean to remove someone.');
  process.exit(1);
}

const value = unique.join(',');

console.log(`${SECRET} <- ${unique.length} address(es):`);
for (const address of unique) {
  // Show enough to recognise, not enough to harvest from a screenshot or a transcript.
  const [user, domain] = address.split('@');
  const masked = `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
  console.log(`    ${masked}`);
}

if (DRY) {
  console.log('\n--dry-run: nothing sent.');
  process.exit(0);
}

// Exported R2 / Cloudflare credentials make wrangler fail against Pages with a bare
// "Authentication error [code: 10000]", which reads as an account problem rather than a
// variable collision. Same accommodation as deploy-browse-indexes-d1.mjs.
const env = { ...process.env };
for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  delete env[key];
}

const isWindows = process.platform === 'win32';
const result = spawnSync(
  isWindows ? 'npx.cmd' : 'npx',
  ['wrangler', 'pages', 'secret', 'put', SECRET, '--project-name', PROJECT],
  { input: value, encoding: 'utf8', env, shell: isWindows },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  console.error(`\nFAIL: wrangler exited ${result.status}. The secret was NOT changed.`);
  process.exit(result.status || 1);
}

console.log(`\nSet. Verify the name exists:  npx wrangler pages secret list --project-name ${PROJECT}`);
console.log('The real test is the person loading /_api/contributions/r2-index and getting JSON, not a 403.');
