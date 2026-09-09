#!/usr/bin/env node
/**
 * The six headline figures on the landing page, computed once from their sources.
 *
 * WHY
 *
 * The landing page carried six hard-coded numbers. By the time anyone checked them,
 * three were wrong: "19,199 candidates" against 29,697 actual candidacy rows,
 * "3,304 election contests" against 4,706, and "40,329 catalogued sources" against
 * 40,543. The two that were right -- 795 maps and 11,960 people -- were right by
 * luck, not by construction, because nothing recomputed them when the data moved.
 *
 * A wrong number on a landing page is worse than a wrong number anywhere else. It is
 * the first claim a reader tests, and Civgraph's whole argument is that its figures
 * are traceable to a source.
 *
 * "candidates" was also the wrong WORD. The `candidates` table holds one row per
 * person per contest, so the figure is candidacies; the distinct-people figure is a
 * different table entirely. Labelling both "candidates" and "people" invited exactly
 * the question a reviewer asked twice: is one just the other counted repeatedly?
 * The label here is `candidacies` so the two cannot be read as the same quantity.
 *
 * This follows the rule already written into build-render-time-series-chains.mjs:
 * a number that appears in more than one place is computed ONCE, from the file, and
 * read by everyone else. That comment records three different answers to "how many
 * maps" produced by three different computations of it. Six more figures computed at
 * each call site would repeat that in six new ways.
 *
 * DEFINITIONS -- these are judgement calls, so they are stated rather than implied:
 *
 *   public maps        catalogue entries passing the shared public-map rule. Not
 *                      recomputed here: read from the publicMapCount already stamped
 *                      by build-render-time-series-chains.mjs, for the reason above.
 *   election contests  one constituency in one election -- a `results[]` entry. NOT
 *                      the 281 election events, which is a different (smaller) claim.
 *   candidacies        one person standing in one contest -- a `results[].candidates[]`
 *                      entry. A person who stood five times counts five times.
 *   people             distinct individuals in the persons browse index.
 *   scanned books      entries in books.json.
 *   catalogued sources entries in the sources browse index.
 *
 * Fails rather than guessing. A build that emits a plausible-looking wrong number is
 * how the current figures got onto the page in the first place, so a missing or
 * unreadable source is a hard error here, never a default or a skip.
 *
 * Usage:
 *   node scripts/build-site-stats.mjs                 # compute and write the stamp
 *   node scripts/build-site-stats.mjs --apply <html>  # stamp the numbers into a page
 *   node scripts/build-site-stats.mjs --check <html>  # fail if a page has drifted
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'data/database/site-stats.json');

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

const readJson = (rel) => {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) {
    fail(`${rel} does not exist, so its figure cannot be computed.\n`
      + '  Run `npm run build:browse` first -- the browse indexes are generated, not committed.');
  }
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (error) {
    fail(`${rel} could not be parsed: ${error?.message || error}`);
  }
};

// --- the six figures --------------------------------------------------------

// Read, not recomputed: two computations of one number is the bug this avoids.
const mapsMeta = readJson('render/metadata/maps-test.json');
const publicMaps = mapsMeta.publicMapCount;
if (!Number.isFinite(publicMaps)) {
  fail('render/metadata/maps-test.json carries no publicMapCount.\n'
    + '  Run scripts/build-render-time-series-chains.mjs first -- it stamps that figure.');
}

const ELECTION_DIR = 'render/metadata/elections-test2';
const electionDirFull = path.join(ROOT, ELECTION_DIR);
if (!existsSync(electionDirFull)) fail(`${ELECTION_DIR} does not exist, so contests and candidacies cannot be counted.`);

let contests = 0;
let candidacies = 0;
let electionFiles = 0;
for (const file of readdirSync(electionDirFull).filter((f) => f.endsWith('.json'))) {
  const election = readJson(path.join(ELECTION_DIR, file));
  electionFiles += 1;
  for (const result of election.results || []) {
    contests += 1;
    candidacies += (result.candidates || []).length;
  }
}
if (electionFiles === 0) fail(`${ELECTION_DIR} holds no election files.`);

const persons = readJson('data/browse/persons.json');
const sources = readJson('data/browse/sources.json');
const books = readJson('data/database/books.json');

const stats = {
  publicMaps,
  electionContests: contests,
  candidacies,
  people: persons.total,
  scannedBooks: (books.books || []).length,
  cataloguedSources: sources.total,
};

for (const [key, value] of Object.entries(stats)) {
  if (!Number.isFinite(value) || value <= 0) fail(`${key} came out as ${value}, which cannot be right.`);
}

// The label is part of the claim, so it lives with the number rather than in the page.
const LABELS = {
  publicMaps: 'public maps',
  electionContests: 'election contests',
  candidacies: 'candidacies',
  people: 'people',
  scannedBooks: 'scanned books',
  cataloguedSources: 'catalogued sources',
};

const PROVENANCE = {
  publicMaps: 'render/metadata/maps-test.json :: publicMapCount (stamped by build-render-time-series-chains.mjs)',
  electionContests: `${ELECTION_DIR}/*.json :: count of results[] across ${electionFiles} elections`,
  candidacies: `${ELECTION_DIR}/*.json :: total results[].candidates[] entries`,
  people: 'data/browse/persons.json :: total',
  scannedBooks: 'data/database/books.json :: books[]',
  cataloguedSources: 'data/browse/sources.json :: total',
};

const fmt = (n) => n.toLocaleString('en-GB');

// --- --apply / --check ------------------------------------------------------

/**
 * Rewrites `data-count="N">formatted<` in place, keyed by the label that follows it,
 * so a page stops carrying hand-typed numbers. Keying on the label rather than on
 * position means reordering the stats row cannot silently swap two figures.
 */
function stampInto(html) {
  const changes = [];
  for (const [key, value] of Object.entries(stats)) {
    const label = LABELS[key];
    const pattern = new RegExp(
      `(data-count=")(\\d+)(">)([\\d,]+)(</div><div class="stat__l">${label}</div>)`,
      'g',
    );
    let hits = 0;
    html = html.replace(pattern, (_m, a, oldCount, b, oldText, c) => {
      hits += 1;
      if (String(value) !== oldCount || fmt(value) !== oldText) {
        changes.push(`${label}: ${oldText} -> ${fmt(value)}`);
      }
      return `${a}${value}${b}${fmt(value)}${c}`;
    });
    if (hits === 0) changes.push(`MISSING: no "${label}" stat found in the page`);
  }
  return { html, changes };
}

const applyTarget = argVal('--apply');
const checkTarget = argVal('--check');

if (applyTarget || checkTarget) {
  const target = applyTarget || checkTarget;
  if (!existsSync(target)) fail(`${target} does not exist.`);
  const before = readFileSync(target, 'utf8');
  const { html, changes } = stampInto(before);
  const missing = changes.filter((c) => c.startsWith('MISSING:'));
  const drifted = changes.filter((c) => !c.startsWith('MISSING:'));

  console.log(`Site stats ${applyTarget ? 'apply' : 'check'}: ${target}`);
  for (const change of changes) console.log(`  - ${change}`);

  if (checkTarget) {
    if (missing.length || drifted.length) {
      fail(`${target} does not match the computed figures.\n`
        + '  Regenerate it: node scripts/build-site-stats.mjs --apply <html>');
    }
    console.log('\nPASS: the page carries the computed figures.');
    process.exit(0);
  }

  if (missing.length) fail('the page is missing stats the build computes; not written.');
  if (!drifted.length) {
    console.log('\nAlready current; nothing written.');
    process.exit(0);
  }
  writeFileSync(target, html);
  console.log(`\nWrote ${drifted.length} corrected figure(s) into ${target}.`);
  process.exit(0);
}

// --- write the stamp --------------------------------------------------------

const stamp = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  description:
    'Headline site figures, computed once from their sources so no page hard-codes them. '
    + 'See scripts/build-site-stats.mjs for what each one counts.',
  stats,
  labels: LABELS,
  provenance: PROVENANCE,
};

// Rewritten only when a figure actually moved. `generatedAt` alone changing on every
// build would leave this file permanently dirty in `git status`, which trains everyone
// to ignore it -- and this is a file whose whole job is to be noticed when it changes.
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const unchanged = previous && JSON.stringify(previous.stats) === JSON.stringify(stats);
if (!unchanged) writeFileSync(OUT, `${JSON.stringify(stamp, null, 2)}\n`);

console.log('Site stats');
for (const [key, value] of Object.entries(stats)) {
  console.log(`  ${LABELS[key].padEnd(20)} ${fmt(value).padStart(8)}   ${PROVENANCE[key]}`);
}
console.log(unchanged
  ? `\nUnchanged; ${path.relative(ROOT, OUT)} left as it is.`
  : `\nWrote ${path.relative(ROOT, OUT)}`);
