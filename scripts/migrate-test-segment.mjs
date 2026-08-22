#!/usr/bin/env node
/**
 * Second half of the test/ -> render/ migration: the BARE PATH SEGMENT.
 *
 * The first pass rewrote the literal `test/`. It could not see paths assembled a segment
 * at a time -- `path.join(ROOT, 'test', 'metadata', 'maps-test.json')` -- because no
 * `test/` ever appears in the source. Thirteen files build paths that way, and the build
 * failed on the first of them with ENOENT on a directory that no longer exists.
 *
 * That is the failure mode worth remembering about string-level renames: they cover the
 * references you can grep for, and the ones you cannot grep for are exactly the ones
 * that fail at runtime rather than at review.
 *
 * Only a segment that is unambiguously a path argument is rewritten: a quoted 'test'
 * appearing directly inside a join()/resolve() call. A bare 'test' elsewhere -- a mode
 * name, a label, a key -- is left alone.
 *
 *   node scripts/migrate-test-segment.mjs --dry-run
 *   node scripts/migrate-test-segment.mjs --write
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
if (!WRITE && !process.argv.includes('--dry-run')) {
  console.error('Pass --dry-run or --write.');
  process.exit(2);
}

const files = execFileSync('git', ['ls-files', '*.mjs', '*.js'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split('\n').map((f) => f.trim()).filter(Boolean)
  .filter((f) => !f.startsWith('node_modules/') && !f.startsWith('tasks/'));

// join( ... 'test' ... ) / resolve( ... 'test' ... ) -- the quoted segment only.
const CALL = /\b(?:join|resolve)\(([^)]*)\)/g;
const SEGMENT = /(['"])test\1/g;

let total = 0;
const touched = [];

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (!/['"]test['"]/.test(text)) continue;
  let hits = 0;
  const next = text.replace(CALL, (match, args) => {
    if (!SEGMENT.test(args)) return match;
    SEGMENT.lastIndex = 0;
    const rewritten = args.replace(SEGMENT, (_, q) => { hits += 1; return `${q}render${q}`; });
    return match.replace(args, rewritten);
  });
  if (!hits || next === text) continue;
  total += hits;
  touched.push([file, hits]);
  if (WRITE) writeFileSync(file, next);
}

for (const [file, hits] of touched.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(hits).padStart(4)}  ${file}`);
}
console.log(`\n${WRITE ? 'Rewrote' : 'Would rewrite'} ${total} bare 'test' path segment(s) across ${touched.length} file(s).`);
