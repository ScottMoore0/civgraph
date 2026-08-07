#!/usr/bin/env node
/**
 * Fail on machine-specific absolute paths in scripts/ and analysis/.
 *
 * validate-approved-publication-path.mjs has long defined LOCAL_PATH_RE to keep
 * local filesystem paths out of published source records. The same rule was
 * never applied to code, and the gap was not theoretical:
 *
 *   - build-og-preview.mjs called createRequire() with an absolute path into one
 *     developer's checkout. check:og-preview did not fail in CI, it crashed with
 *     ERR_INVALID_ARG_VALUE before running -- and being the last of 19
 *     validators, it masked the fact that the rest had begun passing.
 *   - publish-converted-vector-layers.mjs carried the same path as an .env.local
 *     fallback, publishing a username and directory layout in a public repo.
 *   - analysis/border-poll-dry-run/v9 names the local path of the Pointer
 *     address dataset, which is never-public data.
 *
 * Two distinct harms: code that cannot run anywhere but one machine, and
 * disclosure of local layout in a public repository.
 *
 * BASELINE, NOT A BLOCKER. 31 files already violate this. Failing on all of
 * them would mean either a large mechanical scrub bundled into an unrelated
 * change, or a permanently red gate that everyone learns to ignore. Instead the
 * known set is pinned and only NEW violations fail, so the count can only go
 * down. Clearing a baselined file is reported so the pin can be tightened.
 *
 * Usage:
 *   node scripts/validate-local-paths.mjs
 *   node scripts/validate-local-paths.mjs --update-baseline
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE = path.resolve(ROOT, 'data/database/local-paths-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

// Deliberately NOT the LOCAL_PATH_RE from validate-approved-publication-path.mjs.
// That rule is correct for the data records it guards, where a bare \\ means a
// UNC path. Applied to source code it is wrong in both directions:
//
//   - \\ is an escape sequence in JS and Python, so replace('\\\\','/'), \\n and
//     regex literals all match. Measured: 49 of 192 flagged files matched on
//     that alternative alone, every sampled one a false positive.
//   - [A-Za-z]:[\\/] on its own matches 'https://' via the 's:', so every URL
//     in the repo would flag.
//
// A drive letter is a single letter followed by ':' and a separator, and is not
// preceded by another letter. That distinction is what the lookbehind encodes.
// Measured precision: 94 files flagged, of which the only false positives are
// the two that legitimately contain this pattern as a regex of their own.
const LOCAL_PATH_RE = /(?<![A-Za-z])[A-Za-z]:[\\/]/;

const ROOTS = ['scripts', 'analysis'];
const EXTENSIONS = new Set(['.mjs', '.js', '.py', '.md', '.json', '.ps1', '.sh', '.yml', '.yaml']);
// Generated caches and data dumps, not authored source.
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '_geo', 'lps', '.venv']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const offenders = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(path.resolve(ROOT, root))) {
    scanned += 1;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!LOCAL_PATH_RE.test(text)) continue;
    offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
  }
}
offenders.sort();

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({
    description: 'Files under scripts/ and analysis/ known to contain machine-specific absolute paths. Only NEW entries fail validate-local-paths.mjs. This list should only ever shrink.',
    updated: new Date().toISOString().slice(0, 10),
    files: offenders
  }, null, 2)}\n`);
  console.log(`Baseline updated: ${offenders.length} file(s) pinned.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).files || [])
  : new Set();

const added = offenders.filter((f) => !baseline.has(f));
const cleared = [...baseline].filter((f) => !offenders.includes(f)).sort();

console.log('Local absolute paths in scripts/ and analysis/');
console.log(`- files scanned: ${scanned}`);
console.log(`- known offenders (baselined): ${baseline.size}`);
console.log(`- still offending: ${offenders.length}`);

if (cleared.length) {
  console.log(`\n${cleared.length} baselined file(s) are now clean. Re-pin with --update-baseline:`);
  for (const f of cleared.slice(0, 20)) console.log(`    ${f}`);
  if (cleared.length > 20) console.log(`    ... and ${cleared.length - 20} more`);
}

if (added.length) {
  console.error(`\nFAIL: ${added.length} new file(s) contain a machine-specific absolute path.`);
  for (const f of added) console.error(`    ${f}`);
  console.error('  Derive paths from import.meta.url (or __file__ in Python) rather than');
  console.error('  hardcoding a checkout location: the hardcoded form runs on exactly one');
  console.error('  machine, and in a public repo it also discloses local layout.');
  process.exit(1);
}

console.log('\nPASS: no new machine-specific absolute paths.');
