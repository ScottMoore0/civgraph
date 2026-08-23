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
 * NOW RUNS INSIDE `npm run build`, as of 2026-08-21. It was previously only reachable
 * as build:browse-cache, which meant the token was correct whenever somebody remembered
 * to run it and the gate caught them when they did not. Deriving a value on every build
 * is better than checking it after the fact; the --check mode stays as the backstop.
 *
 * KNOWN LIMIT: the pattern matches bare same-directory filenames only. If browse/ ever
 * grows a subdirectory of assets, references to them are silently uncovered rather than
 * reported. Worth widening before that happens, not after.
 *
 * DO NOT normalise line endings before hashing here. It is tempting -- this repository
 * stores CRLF and deploy runners check out LF -- but browse/index.html is committed and
 * served as-is rather than rebuilt on the runner, so the raw bytes are the right input.
 * Normalising produces a different hash than the committed token, which reads as a stale
 * token and invites someone to "fix" a value that was correct. That mistake was made and
 * reverted on 2026-08-21.
 *
 * Usage:
 *   node scripts/validate-browse-cache-tokens.mjs           # rewrite tokens
 *   node scripts/validate-browse-cache-tokens.mjs --check    # fail if stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Both hand-written token sites in the repo. apps/proni-search/ was added on 2026-08-23
// after its ?v=19 had to be bumped by hand when app.js changed -- exactly the condition
// this check exists to remove, sitting in a second directory nobody had pointed it at.
const HTML_FILES = ['browse/index.html', 'apps/proni-search/index.html'];
const CHECK = process.argv.includes('--check');

let totalChecked = 0;
const allFindings = [];

for (const HTML of HTML_FILES) {
  if (!existsSync(HTML)) {
    console.error(`FAIL: ${HTML} not found.`);
    process.exit(1);
  }

  const html = readFileSync(HTML, 'utf8');

  // Matches src="app.js?v=token" and href="app.css?v=token" in the same directory.
  // Paths, not just bare filenames. browse/index.html references its assets as
  // "browse.js"; apps/proni-search/index.html references them as
  // "/apps/proni-search/app.js". The original bare-filename pattern matched nothing in
  // the second file, so adding that file to the list made the check PASS VACUOUSLY --
  // reporting success over tokens it had never looked at. A check that matches nothing
  // and says PASS is worse than no check.
  const PATTERN = /((?:src|href)=")([A-Za-z0-9._\/-]+\.(?:js|css))\?v=([A-Za-z0-9._-]+)(")/g;

  const findings = [];
  const dir = path.dirname(HTML);
  const updated = html.replace(PATTERN, (match, lead, file, token, tail) => {
    // A site-root reference resolves from the repository root, not from the HTML's
    // directory.
    const assetPath = file.startsWith('/') ? file.replace(/^\/+/, '') : path.join(dir, file);
    if (!existsSync(assetPath)) {
      findings.push({ file: `${HTML}: ${file}`, problem: `referenced but missing at ${assetPath}` });
      return match;
    }
    totalChecked += 1;
    // Raw bytes, NOT newline-normalised. These files are committed and served as-is
    // rather than rebuilt on the runner, so the bytes on disk are the correct input.
    // Normalising yields a different hash, which reads as a stale token and invites
    // someone to "fix" a correct value. That mistake was made and reverted on 2026-08-21.
    const hash = createHash('sha256').update(readFileSync(assetPath)).digest('hex').slice(0, 12);
    if (token !== hash) findings.push({ file: `${HTML}: ${file}`, problem: `token is "${token}", content hash is "${hash}"` });
    return `${lead}${file}?v=${hash}${tail}`;
  });

  if (!CHECK && updated !== html) writeFileSync(HTML, updated);
  allFindings.push(...findings);
}

if (!totalChecked) {
  console.error(`FAIL: no versioned assets found in ${HTML_FILES.join(' or ')}. Has the markup changed?`);
  process.exit(1);
}

if (CHECK) {
  if (allFindings.length) {
    console.error('FAIL: cache tokens are stale.');
    for (const f of allFindings) console.error(`  - ${f.file}: ${f.problem}`);
    console.error('');
    console.error('  A stale token means browsers keep running the OLD file. Fix with:');
    console.error('    node scripts/validate-browse-cache-tokens.mjs');
    process.exit(1);
  }
  console.log(`PASS: ${totalChecked} cache token(s) across ${HTML_FILES.length} file(s) match their contents.`);
  process.exit(0);
}

console.log(allFindings.length
  ? `Updated ${allFindings.length} cache token(s).`
  : `${totalChecked} cache token(s) already current.`);
