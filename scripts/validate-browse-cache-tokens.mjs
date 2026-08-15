#!/usr/bin/env node
/**
 * Keep browse/index.html's ?v= cache tokens tied to the files they version.
 *
 * WHY
 *
 * browse/index.html loads browse.js and browse.css with hand-written tokens
 * (`?v=20260708-sources-sharded`). On 2026-08-15 that token had not changed
 * since July while browse.js had been rewritten three times that afternoon, so
 * browsers kept running the cached copy. Every fix deployed correctly and none
 * of them ran. It presented as "the login button does nothing", and the tell was
 * buried in the script's own src attribute.
 *
 * A token that is only correct while somebody remembers to change it is not a
 * cache-busting mechanism, it is a trap. build-test2-app.mjs already solves this
 * properly for the metadata index by deriving the token from a content hash;
 * browse/ is hand-written rather than built, so it needs this instead.
 *
 * Usage:
 *   node scripts/validate-browse-cache-tokens.mjs           # rewrite tokens
 *   node scripts/validate-browse-cache-tokens.mjs --check    # fail if stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const HTML = 'browse/index.html';
const CHECK = process.argv.includes('--check');

if (!existsSync(HTML)) {
  console.error(`FAIL: ${HTML} not found.`);
  process.exit(1);
}

const html = readFileSync(HTML, 'utf8');

// Matches src="browse.js?v=token" and href="browse.css?v=token".
const PATTERN = /((?:src|href)=")([A-Za-z0-9._-]+\.(?:js|css))\?v=([A-Za-z0-9._-]+)(")/g;

const findings = [];
const updated = html.replace(PATTERN, (match, lead, file, token, tail) => {
  const assetPath = path.join('browse', file);
  if (!existsSync(assetPath)) {
    findings.push({ file, problem: `referenced but missing at ${assetPath}` });
    return match;
  }
  const hash = createHash('sha256').update(readFileSync(assetPath)).digest('hex').slice(0, 12);
  if (token !== hash) findings.push({ file, problem: `token is "${token}", content hash is "${hash}"`, token, hash });
  return `${lead}${file}?v=${hash}${tail}`;
});

if (!findings.length && PATTERN.test(html) === false && !html.includes('?v=')) {
  console.error('FAIL: no versioned assets found in browse/index.html. Has the markup changed?');
  process.exit(1);
}

if (CHECK) {
  if (findings.length) {
    console.error('FAIL: browse/ cache tokens are stale.');
    for (const f of findings) console.error(`  - ${f.file}: ${f.problem}`);
    console.error('');
    console.error('  A stale token means browsers keep running the OLD file. Fix with:');
    console.error('    node scripts/validate-browse-cache-tokens.mjs');
    process.exit(1);
  }
  console.log('PASS: browse/ cache tokens match their file contents.');
  process.exit(0);
}

if (updated !== html) {
  writeFileSync(HTML, updated);
  console.log(`Updated ${findings.length} cache token(s) in ${HTML}:`);
  for (const f of findings) console.log(`  ${f.file}: ${f.token} -> ${f.hash}`);
} else {
  console.log('Cache tokens already match their file contents.');
}
