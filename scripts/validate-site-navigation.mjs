#!/usr/bin/env node
/**
 * Every public page must carry the shared header, with the same core nav.
 *
 * WHY
 *
 * Measured 2026-08-17: five pages, five different nav sets.
 *
 *   /              Home Browse Apps Census About
 *   /browse/       Home Browse Apps About "Support Us"
 *   /apps/         Home Browse Apps About
 *   /pages/about   Home Browse Apps News About
 *   /render/         Home About
 *   /apps/proni-search/   a bespoke <header class="ps-header">, no shared nav
 *   /test2/        no header at all
 *
 * So "Census" was reachable only from the homepage, "Support Us" only from
 * Browse, and "News" only from About. Nothing checked it, which is how four
 * pages drifted apart. scripts/validate-test-shell-parity.mjs asserts that ONE
 * file contains the header class names; it never compares pages to each other.
 *
 * WHAT THIS ENFORCES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * The CORE set must be present and identical everywhere: it is the site's
 * skeleton and there is no argument for a page omitting it.
 *
 * Extras are REPORTED, not failed. Whether "Census", "News" and "Support Us"
 * belong in the global nav is an editorial decision about what the site
 * promotes, not something a validator should settle -- but the divergence should
 * be visible rather than discovered by a reader who cannot find a page.
 *
 * Offline: reads the committed HTML. It cannot see what the deployed page
 * renders, so it pairs with a real browser check rather than replacing one.
 */
import { readFileSync, existsSync } from 'node:fs';

const CORE = ['Home', 'Browse', 'Apps', 'About'];

const PAGES = [
  'index.html',
  'browse/index.html',
  'apps/index.html',
  'pages/about.html',
  'pages/census-explorer.html',
];

/**
 * Pages held to a different standard, each for a stated reason. An unlisted
 * exemption is an accident; a listed one is a decision someone has to delete a
 * line to reverse.
 */
const EXEMPT = new Map([
  ['render/index.html', 'staging shell, not the public site — see the README layout table'],
  ['test2/index.html', 'a compatibility redirect, not a page'],
  ['apps/proni-search/index.html', 'standalone app with its own ps-header chrome'],
  ['404.html', 'error page; kept deliberately minimal'],
]);

/**
 * Read the nav LABELS, from whichever header wrapper the page uses.
 *
 * The first version of this matched only `class="app-header__nav"` and failed
 * pages/census-explorer.html for "the shared header is missing". That page has
 * the most complete nav on the site -- Home, Browse, Apps, Census, About -- inside
 * a `<header class="site">` with a bare `<nav>`. So the check was reporting a
 * navigation failure on the basis of a class name, while the thing it exists to
 * protect (can a visitor get anywhere from here) was fine.
 *
 * Principle 1: verify the property that matters, not one adjacent to it. What
 * matters to a reader is the destinations. Markup divergence is real but is a
 * styling-consistency problem, so it is reported separately rather than dressed
 * up as a broken nav.
 */
function navLabels(html) {
  const header = html.match(/<header\b[\s\S]*?<\/header>/i);
  const scope = header ? header[0] : html;
  const nav = scope.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!nav) return null;
  return [...nav[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Does the page use the shared header markup, so it inherits shared CSS? */
function usesSharedHeader(html) {
  return /<nav[^>]*class="[^"]*app-header__nav/i.test(html);
}

const failures = [];
const extras = [];
const markupOutliers = [];
let checked = 0;

for (const page of PAGES) {
  if (!existsSync(page)) {
    failures.push(`${page}: listed as a public page but does not exist`);
    continue;
  }
  const html = readFileSync(page, 'utf8');
  const labels = navLabels(html);
  if (labels === null) {
    failures.push(`${page}: no <nav> in the header — a visitor cannot navigate away`);
    continue;
  }
  checked += 1;
  if (!usesSharedHeader(html)) markupOutliers.push(page);

  const missing = CORE.filter((c) => !labels.includes(c));
  if (missing.length) {
    failures.push(`${page}: nav is missing ${missing.join(', ')} (has: ${labels.join(', ') || 'nothing'})`);
  }
  const beyond = labels.filter((l) => !CORE.includes(l));
  if (beyond.length) extras.push(`${page}: also offers ${beyond.join(', ')}`);
}

// A validator that only ever looks at pages someone remembered to list is not
// guarding the site. Anything served and not listed is a gap in this check,
// so it is named too.
const KNOWN = new Set([...PAGES, ...EXEMPT.keys()]);
const unlisted = [];
for (const candidate of ['partials/about.html', 'partials/home.html', 'partials/books.html']) {
  if (existsSync(candidate) && !KNOWN.has(candidate)) unlisted.push(candidate);
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} navigation problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  console.error(`  Every public page needs the same core nav: ${CORE.join(', ')}.`);
  console.error('  A page that omits one makes that destination unreachable from it.');
  console.error('  If a page genuinely should differ, add it to EXEMPT with the reason.');
  process.exit(1);
}

console.log(`PASS: ${checked} public page(s) share the core nav (${CORE.join(', ')}).`);
if (extras.length) {
  console.log('  Editorial, not enforced — these pages offer extra destinations:');
  for (const e of extras) console.log(`    ${e}`);
}
if (markupOutliers.length) {
  console.log('  Navigable but NOT using the shared app-header markup, so they do');
  console.log('  not inherit its styling or behaviour:');
  for (const p of markupOutliers) console.log(`    ${p}`);
}
if (unlisted.length) {
  console.log(`  Not checked, and referenced by nothing: ${unlisted.join(', ')}`);
}
for (const [page, why] of EXEMPT) {
  if (existsSync(page)) console.log(`  exempt: ${page} — ${why}`);
}
