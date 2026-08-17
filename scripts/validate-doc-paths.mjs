#!/usr/bin/env node
/**
 * Every repository path a document points at must exist.
 *
 * WHY
 *
 * `scripts/bundle.mjs` was cited as a real command in BOTH CLAUDE.md and
 * README.md. It has not existed since the Leaflet stack was archived; the file is
 * `archive/legacy-scripts/bundle.mjs`. In CLAUDE.md it illustrated "treat a
 * successful build as a fact" with a command that cannot run. In README.md it was
 * the documented way to build the site.
 *
 * Worse, README.md's whole structure section described a `js/` directory that was
 * renamed to `src/` in fb5d246cad. That stale section is where the belief that
 * "src/ is the dead Leaflet stack" came from -- a belief that reached
 * docs/review/TECH-DEBT-AUDIT.md item 4 and eslint.config.mjs, and cost 36,028
 * lines of live code its linting for as long as it survived.
 *
 * A pointer to a path is a checkable claim, unlike most prose. check:doc-status
 * asserts a document declares a status; this asserts a document's paths resolve.
 * Between them they cover the two ways these files rot that a machine can see.
 *
 * DELIBERATELY LIMITED. It checks paths that look like repository paths inside
 * backticks or a markdown table cell. It cannot check whether the surrounding
 * sentence is true -- "app/ is the live site" is unverifiable here, and pretending
 * otherwise would be the sort of check that passes for the wrong reason.
 */
import { readFileSync, existsSync } from 'node:fs';

const DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'AGENTS.md',
  // Added 2026-08-17: this plan cited `js/ui-controller.js` sixteen times. That
  // directory was renamed to src/ in fb5d246cad, so every "Files:" line in a
  // 1,253-line worklist pointed at nothing. See docs/review/UX-TRIAGE.md.
  'UX-REMEDIATION-PLAN.md',
];

// Directories whose contents are gitignored or generated, so a path under them
// may legitimately be absent from a clean checkout.
const TOLERATED_PREFIXES = [
  'data/maps/',        // R2, never on disk
  'data/quarantine/',  // gitignored by design
  'tmp/',
  'node_modules/',
];

/**
 * A path worth checking: starts with a known top-level entry, and is not a URL
 * or a glob. Globs are skipped rather than expanded -- `scripts/*.mjs` says
 * nothing falsifiable about any single file.
 */
const CANDIDATE = /`([a-zA-Z0-9_][a-zA-Z0-9_.\-]*\/[a-zA-Z0-9_./\-[\]]*)`/g;

const ROOTS = new Set([
  'app', 'apps', 'archive', 'assets', 'browse', 'build', 'data', 'docs',
  'functions', 'pages', 'partials', 'scripts', 'src', 'test', 'tests', 'tasks',
  'agent', 'analysis', '.github',
]);

/**
 * A document is allowed to say a path is ABSENT.
 *
 * UX-REMEDIATION-PLAN.md lists five book PDFs precisely because they are missing;
 * that is the finding. Failing it for naming them would punish the document for
 * being accurate, and would push the next author to describe the file vaguely
 * instead of naming it -- which is worse for the reader than either.
 *
 * So a path is exempt when its own line says it is not there. This is a
 * heuristic, and it is the honest kind: it can only ever cause a MISSED failure
 * (a real dead pointer on a line that happens to contain the word "missing"),
 * never a false one.
 */
const NEGATED = /\b(missing|does not exist|doesn't exist|absent|not found|404|deleted|removed|no such file)\b/i;

function lineContaining(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end);
}

const problems = [];
let checked = 0;

for (const doc of DOCS) {
  if (!existsSync(doc)) continue;
  const text = readFileSync(doc, 'utf8');
  const seen = new Set();

  for (const match of text.matchAll(CANDIDATE)) {
    const raw = match[1];
    const p = raw.replace(/\/$/, '');
    if (seen.has(p)) continue;
    seen.add(p);

    if (!ROOTS.has(p.split('/')[0])) continue;         // not a repo path
    if (/[*?]/.test(p)) continue;                       // glob, nothing to assert
    if (TOLERATED_PREFIXES.some((t) => `${p}/`.startsWith(t))) continue;
    if (NEGATED.test(lineContaining(text, match.index))) continue;

    checked += 1;
    if (!existsSync(p)) problems.push(`${doc}: \`${p}\` does not exist`);
  }
}

/**
 * The README layout table gets a STRICTER rule: every backticked path in it must
 * exist, with no allowlist of known roots.
 *
 * The general pass above only checks paths whose first segment is a recognised
 * top-level directory, so that `image/png` and `@aws-sdk/client-s3` are not
 * reported as missing files. But that allowlist also means a TYPO is silently
 * skipped: changing `browse/` to `browze/` in the table produced a clean pass,
 * because `browze` is not a known root, so the check declined to have an opinion
 * about the one line whose entire job is naming directories correctly.
 *
 * Inside the table there is nothing else a backticked slash-path could be, so the
 * allowlist is dropped and anything that does not resolve is a failure.
 */
const TABLE_HEADING = '## Project structure';
if (existsSync('README.md')) {
  const text = readFileSync('README.md', 'utf8');
  const start = text.indexOf(TABLE_HEADING);
  if (start < 0) {
    problems.push(`README.md: "${TABLE_HEADING}" section is gone — the canonical layout table lived there`);
  } else {
    const section = text.slice(start, text.indexOf('\n## ', start + 1) >>> 0 || undefined);
    for (const [, raw] of section.matchAll(/\|\s*`([^`]+)`\s*\|/g)) {
      // Test the RAW value for being a path, THEN strip the trailing slash.
      //
      // Doing it the other way round turned `app/` into `app`, which contains no
      // slash, so every directory-only row -- app/, src/, browse/, tests/ -- was
      // skipped as "not a path". The check matched 21 table cells and formed an
      // opinion about 6 of them, while reporting a clean pass. Typoing `browse/`
      // to `browze/` went undetected twice before this was noticed.
      if (!raw.includes('/')) continue;                                 // not a path
      // A leading slash means a URL, not a repository path. The section also
      // contains a "which URL comes from where" table, and `/browse/` is a route.
      if (raw.startsWith('/')) continue;
      const p = raw.replace(/\/$/, '');
      if (TOLERATED_PREFIXES.some((t) => `${p}/`.startsWith(t))) continue;
      checked += 1;
      if (!existsSync(p)) problems.push(`README.md layout table: \`${raw}\` does not exist`);
    }
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} document path(s) do not resolve:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  console.error('  A document that names a file which is not there will send the next');
  console.error('  reader somewhere that does not exist, and they will believe it.');
  console.error('  Fix the path, or delete the claim.');
  process.exit(1);
}

console.log(`PASS: ${checked} repository path(s) cited across ${DOCS.length} document(s) all resolve.`);
