#!/usr/bin/env node
/**
 * Keep index.html's and sw.js's ?v= cache tokens tied to the files they version.
 *
 * WHY THIS EXISTS, FOR THE THIRD TIME
 *
 * This is the third instance of one bug in one week:
 *
 *   browse/index.html   a July token on a file rewritten three times that
 *                       afternoon. Every fix deployed and none of them ran.
 *                       Presented as "the login button does nothing".
 *   /_api/.../schema    max-age=300 served a five-minute-old schema, so the
 *                       edit form rendered a textarea where a structured
 *                       control belonged. Indistinguishable from broken code.
 *   index.html          found 2026-08-16: the token said a65f867d6fc8 while
 *                       app/build/app.bundle.js hashed to 7734fe96a8e9, and
 *                       /build/main.css was stale too. Returning visitors were
 *                       running the previous bundle AND the previous stylesheet.
 *
 * scripts/validate-browse-cache-tokens.mjs closed the first. This closes the
 * third, which the first did not cover because browse/ and the app shell are
 * built by different machinery.
 *
 * DELIBERATELY CHECK-ONLY
 *
 * The browse validator rewrites tokens, because browse/ is hand-written and has
 * no build step to own them. The app shell is the opposite: the tokens are
 * WRITTEN BY BUILD SCRIPTS --
 *
 *   /app/build/app.bundle.js   and sw.js's VERSION   scripts/build-test2-app.mjs
 *   /app/build/app.bundle.css                        scripts/build-test2-app.mjs
 *   /build/main.css                                  scripts/build-shared-shell-assets.mjs
 *
 * -- so a fixer here would be a second implementation of the same derivation,
 * and two things computing one value is how the value drifts. This reports the
 * mismatch and names the script that owns it. Fix by running the build.
 *
 * NOT EVERY TOKEN IS A PLAIN CONTENT HASH, WHICH THIS CHECK GOT WRONG FIRST TIME
 *
 * /app/build/* is sha256(file). /build/main.css is NOT: it is salted with
 * `_headers` and `sw.js`, because either can change how the stylesheet is
 * delivered without changing a byte of it. The first version of this validator
 * hashed the file directly, reported main.css as stale, and was right by
 * accident -- it was stale, but not for the reason given, and the same code
 * would have failed identically on a perfectly current token.
 *
 * So the salted derivation is IMPORTED from the build script that owns it rather
 * than reimplemented here. A check that reimplements the thing it is checking
 * can only ever verify that two copies of a mistake agree.
 *
 * Usage:  node scripts/validate-app-shell-cache-tokens.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sharedCssVersion, stripDerivedServiceWorkerVersion } from './build-shared-shell-assets.mjs';

const HTML = 'index.html';
const SW = 'sw.js';

/** Plain content hash, as build-test2-app.mjs uses for the /app/build entries. */
function contentHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
}

/** What the owning build script would write for this reference, today. */
function expectedToken(assetPath, file) {
  if (assetPath === '/build/main.css') return sharedCssVersion();
  return contentHash(file);
}

/** Which build script owns a given reference, so a failure says what to run. */
function ownerOf(assetPath) {
  if (assetPath.startsWith('/app/build/')) return 'npm run build:test2  (scripts/build-test2-app.mjs)';
  return 'npm run build  (scripts/build-shared-shell-assets.mjs)';
}

const problems = [];
let checked = 0;

if (!existsSync(HTML)) {
  console.error(`FAIL: ${HTML} not found.`);
  process.exit(1);
}

// Root-relative asset references carrying a hex token. Absolute URLs are skipped
// on purpose: data.civgraph.net tokens are catalogue data and are covered by
// `npm run verify:map-tokens`, which has to read the live object to check them.
const REFERENCE = /["'](\/[^"'?\s]+\.(?:js|css))\?v=([a-f0-9]{6,})/g;

const html = readFileSync(HTML, 'utf8');
const seen = new Set();

for (const [, assetPath, token] of html.matchAll(REFERENCE)) {
  const key = `${assetPath}?${token}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const file = assetPath.replace(/^\//, '');
  if (!existsSync(file)) {
    problems.push(`${HTML}: ${assetPath} is referenced but does not exist on disk`);
    continue;
  }
  checked += 1;
  const actual = expectedToken(assetPath, file);
  if (actual !== token) {
    problems.push(
      `${HTML}: ${assetPath}\n      token  ${token}\n      actual ${actual}\n      owned by ${ownerOf(assetPath)}`,
    );
  }
}

// The service worker's VERSION carries the JS bundle hash as a suffix, and it is
// what flushes entries already sitting in visitors' browsers. If it lags, the
// service worker keeps serving the previous shell no matter what index.html says
// -- so it is checked against the bundle, not against index.html.
if (existsSync(SW)) {
  const bundle = 'app/build/app.bundle.js';
  const match = readFileSync(SW, 'utf8').match(/const VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    problems.push(`${SW}: no VERSION constant found; the build cannot be writing one`);
  } else if (existsSync(bundle)) {
    checked += 1;
    const expected = contentHash(bundle);
    if (!match[1].endsWith(expected)) {
      problems.push(
        `${SW}: VERSION is "${match[1]}"\n      but app/build/app.bundle.js hashes to ${expected}\n      owned by ${ownerOf('/app/build/app.bundle.js')}`,
      );
    }
  }
}

// THE BUILD MUST BE A FIXED POINT.
//
// `npm run build` stamps index.html's /build/main.css token from a salt, and then
// build-test2-app.mjs rewrites sw.js's VERSION line with the freshly built bundle's
// hash. While that line was part of the salt, the stamp was always computed over the
// PREVIOUS sw.js: one build left a stale token, and only a second consecutive build
// agreed with itself. Every commit touching app/src shipped returning visitors the old
// stylesheet, and nothing said so -- the stale token above was found by accident on
// 2026-08-20 while running the gate for an unrelated change.
//
// This asserts the property that makes the build converge rather than the symptom: the
// salt must not move when only the derived VERSION line moves. It is checked by feeding
// the real sw.js through with a deliberately different version stamp, so it fails if
// anyone puts the raw file back into the salt.
if (existsSync(SW)) {
  const source = readFileSync(SW, 'utf8');
  const bumped = source.replace(
    /const VERSION = 'root-maplibre-sw-[^']*';/,
    "const VERSION = 'root-maplibre-sw-0000deadbeef';",
  );
  if (bumped === source) {
    problems.push(`${SW}: no derived VERSION line to vary; the convergence check cannot run`);
  } else {
    checked += 1;
    if (stripDerivedServiceWorkerVersion(bumped) !== stripDerivedServiceWorkerVersion(source)) {
      problems.push(
        [
          'the /build/main.css salt still depends on the derived VERSION line in sw.js.',
          '      build-test2-app.mjs rewrites that line AFTER the token is stamped, so one',
          '      `npm run build` will leave index.html one build behind, every time.'
        ].join(String.fromCharCode(10)),
      );
    }
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} stale cache token(s) in the app shell:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  console.error('  A stale token means returning visitors keep running the OLD file.');
  console.error('  Do not edit the token by hand -- it is derived. Run the build that owns it,');
  console.error('  then commit index.html / sw.js alongside the rebuilt asset.');
  process.exit(1);
}

console.log(`PASS: ${checked} app-shell cache token(s) match their files.`);
