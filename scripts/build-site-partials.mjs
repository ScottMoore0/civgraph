#!/usr/bin/env node
/**
 * Fill every page's shared chrome from partials/.
 *
 * WHY
 *
 * The header and footer were copied by hand into each page, and the copies drifted: by
 * 2026-09 there were four header designs, three mobile menus and three footers across
 * seven pages, each with its own CSS. A partial is written once and stamped into every
 * page at build time, so a change to the nav is a change to one file.
 *
 * HOW
 *
 * A page marks each shared region with a pair of comments:
 *
 *   <!-- site:header active="maps" layout="app" -->
 *   ...generated from partials/site-header.html...
 *   <!-- /site:header -->
 *
 * Everything between the markers is replaced. Edit the partial, never the page. The
 * site chrome (site-head, site-header, support-modal, site-footer) is shared by the
 * public pages; PRONI Search has its own proni-header and proni-footer, because it is a
 * standalone app with its own identity rather than a section of the site.
 *
 * Placeholders a partial may use:
 *   {{active:KEY}}   ' app-header__link--active' on the page whose active="KEY"
 *   {{current:KEY}}  ' aria-current="page"' on the same link
 *   {{layout}}       the page's layout="..." ("page" unless given)
 *   {{version:PATH}} a content hash of PATH, so a changed asset gets a new URL
 *
 * Static HTML rather than a runtime include, so the chrome is in the first byte of the
 * response, works without JavaScript, and is visible to crawlers.
 *
 * USAGE
 *   node scripts/build-site-partials.mjs          rewrite pages in place
 *   node scripts/build-site-partials.mjs --check  fail if any page is out of date
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');

const SITE_PAGE = ['site:head', 'site:header', 'site:support-modal', 'site:footer'];

/** Every page that uses partials, and exactly which. A region a page must not have is as
 *  much a decision as one it must: the map app has no footer. */
// /browse/, /catalogue/ and /records/ are the same application scoped to different layers,
// so they share a body region too. Without that, splitting the section would have produced
// three copies of the shell to keep in step -- the failure this mechanism exists to prevent.
const BROWSE_PAGE = [...SITE_PAGE, 'site:browse-shell'];
const PAGES = new Map([
  ['index.html', SITE_PAGE],
  ['pages/about.html', SITE_PAGE],
  ['maps/index.html', ['site:head', 'site:header', 'site:support-modal']],
  ['browse/index.html', BROWSE_PAGE],
  ['catalogue/index.html', BROWSE_PAGE],
  ['records/index.html', BROWSE_PAGE],
  ['apps/index.html', SITE_PAGE],
  ['pages/census-explorer.html', SITE_PAGE],
  ['apps/proni-search/index.html', ['proni:header', 'proni:footer']],
]);

const PARTIAL_FILES = {
  'site:head': 'partials/site-head.html',
  'site:header': 'partials/site-header.html',
  'site:support-modal': 'partials/support-modal.html',
  'site:footer': 'partials/site-footer.html',
  'site:browse-shell': 'partials/browse-shell.html',
  'proni:header': 'partials/proni-header.html',
  'proni:footer': 'partials/proni-footer.html',
};

const NAV_KEYS = new Set(['home', 'maps', 'browse', 'apps', 'about', 'none']);
const ALLOWED_ATTRS = { 'site:header': new Set(['active', 'layout']) };
const MARKER = /<!-- ((?:site|proni):[a-z-]+)((?:\s+[a-z-]+="[^"]*")*) -->[\s\S]*?<!-- \/\1 -->/g;
const OPENING = /<!-- ((?:site|proni):[a-z-]+)(?:\s+[a-z-]+="[^"]*")* -->/g;

const hashes = new Map();
function versionOf(path) {
  if (!hashes.has(path)) {
    if (!existsSync(path)) throw new Error(`{{version:${path}}}: ${path} does not exist`);
    hashes.set(path, createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12));
  }
  return hashes.get(path);
}

function parseAttrs(text) {
  return Object.fromEntries([...text.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

function render(name, attrs, page) {
  const allowed = ALLOWED_ATTRS[name] || new Set();
  for (const key of Object.keys(attrs)) {
    if (!allowed.has(key)) throw new Error(`${page}: <!-- ${name} --> does not take ${key}="..."`);
  }
  if (name === 'site:header' && !NAV_KEYS.has(attrs.active)) {
    throw new Error(`${page}: <!-- site:header --> needs active="${[...NAV_KEYS].join('|')}"`);
  }
  let html = readFileSync(PARTIAL_FILES[name], 'utf8').replace(/\r\n/g, '\n').trimEnd();
  html = html
    .replace(/\{\{active:([a-z]+)\}\}/g, (_, key) => (key === attrs.active ? ' app-header__link--active' : ''))
    .replace(/\{\{current:([a-z]+)\}\}/g, (_, key) => (key === attrs.active ? ' aria-current="page"' : ''))
    .replace(/\{\{layout\}\}/g, attrs.layout || 'page')
    .replace(/\{\{version:([^}]+)\}\}/g, (_, path) => versionOf(path));
  const leftover = html.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`${PARTIAL_FILES[name]}: unknown placeholder ${leftover[0]}`);
  return html;
}

const problems = [];
const stale = [];
let written = 0;

for (const [page, expected] of PAGES) {
  if (!existsSync(page)) {
    problems.push(`${page}: listed in PAGES but does not exist`);
    continue;
  }
  const source = readFileSync(page, 'utf8');
  const found = [...source.matchAll(OPENING)].map((m) => m[1]);
  for (const name of expected) {
    const count = found.filter((f) => f === name).length;
    if (count !== 1) problems.push(`${page}: expected one <!-- ${name} --> region, found ${count}`);
  }
  for (const name of new Set(found)) {
    if (!expected.includes(name)) problems.push(`${page}: has a <!-- ${name} --> region it should not`);
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  let next;
  try {
    next = source.replace(MARKER, (_, name, attrText) => {
      const body = render(name, parseAttrs(attrText), page);
      return `<!-- ${name}${attrText} -->\n${body}\n<!-- /${name} -->`.replace(/\n/g, eol);
    });
  } catch (error) {
    problems.push(error.message);
    continue;
  }
  if (next === source) continue;
  if (CHECK) stale.push(page);
  else {
    writeFileSync(page, next);
    written += 1;
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} partial problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (stale.length) {
  console.error('FAIL: these pages do not match partials/ — run `node scripts/build-site-partials.mjs`:');
  for (const p of stale) console.error(`  - ${p}`);
  console.error('  Edit the partial, not the page: everything between the markers is regenerated.');
  process.exit(1);
}
console.log(CHECK
  ? `PASS: ${PAGES.size} page(s) match partials/.`
  : `Site partials: ${written} page(s) updated, ${PAGES.size - written} already current.`);
