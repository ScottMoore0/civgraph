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
 * Everything between the markers is replaced. Edit the source, never the page. The site
 * chrome (site:head, site:header, site:support-modal, site:footer) is rendered by
 * functions/_templates/shell.js, the same functions the server-rendered pages call, so a
 * static page and a Function page cannot differ. site:head carries the theme bootstrap and
 * the design-system stylesheets (assets/ui/tokens.css, tokens-legacy.css, base.css, then
 * assets/site/site-chrome.css); site:header starts with the skip link to <main
 * id="main-content"> (skip-link="page" when the page has its own, as the map app does).
 * The page-specific regions (site:browse-shell, PRONI Search's proni:header and proni:footer,
 * its title block and notice inside the site shell) are still files under partials/.
 *
 * --check also holds every public page to the shell: each HTML page in the repository is
 * either listed in PAGES or exempt with a reason (SHELL_EXEMPT); a shell page links no
 * stylesheet before site:head (so the tokens are first in the cascade), carries the theme
 * bootstrap once, and has the skip link's target.
 *
 * Placeholders a partial file may use:
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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { toHtmlString } from '../functions/_lib/html.js';
import { footer, head, header, supportModal } from '../functions/_templates/shell.js';

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
  ['apps/words/index.html', SITE_PAGE],
  ['pages/census-explorer.html', SITE_PAGE],
  ['pages/status.html', SITE_PAGE],
  // The 404 is served at any missing path, so it needs the real header (nav and theme toggle)
  // and the saved theme; its bespoke banner had neither and stayed light in dark mode.
  ['404.html', SITE_PAGE],
  // PRONI Search keeps its own title block and notice (proni-header, proni-footer: its look
  // follows the PRONI eCatalogue by design) inside the site shell, like every other app.
  ['apps/proni-search/index.html', [...SITE_PAGE, 'proni:header', 'proni:footer']],
]);

/** HTML files in the repository that are deliberately not shell pages, and why. Any other
 *  page must be in PAGES: a new page cannot ship without the shared header, footer and tokens. */
const SHELL_EXEMPT = new Map([
  ['maps/classic/index.html', 'written from maps/index.html by scripts/build-test2-app.mjs, shell included'],
  ['maps/test/index.html', 'written from maps/index.html by scripts/build-test2-app.mjs, shell included'],
  ['offline.html', 'served by the service worker with no network: self-contained by design, no stylesheet links'],
  ['render/index.html', 'the legacy /render/ test app, retired with step F5 (DESIGN.md 2.3)'],
  ['test2/index.html', 'a "Civgraph moved" stub for the old /test2/ address'],
  ['partials/browse-shell.html', 'a fragment stamped into the Browse pages'],
  ['partials/proni-header.html', 'a fragment stamped into PRONI Search'],
  ['partials/proni-footer.html', 'a fragment stamped into PRONI Search'],
]);
const NOT_PUBLIC = /^(archive|analysis|docs|tests|tools|scripts|data|node_modules)\//;

// The site chrome (head, header, support dialog, footer) comes from functions/_templates/shell.js,
// the one source the server-rendered pages use too (frontend-plan.md F1): a header change is one
// edit for both. The page-specific regions below are still partial files.
const SHELL_REGIONS = {
  'site:head': () => toHtmlString(head({ version: versionOf })),
  // skip-also="#id:Label" adds a second skip link (Browse: to the results; PRONI: to the search).
  'site:header': (attrs) => toHtmlString(header({
    active: attrs.active,
    layout: attrs.layout || 'page',
    skipLink: attrs['skip-link'] !== 'page',
    skipAlso: attrs['skip-also'] ? [{ href: attrs['skip-also'].split(':')[0], label: attrs['skip-also'].split(':').slice(1).join(':') }] : [],
  })),
  'site:support-modal': () => toHtmlString(supportModal()),
  'site:footer': () => toHtmlString(footer()),
};

const PARTIAL_FILES = {
  'site:browse-shell': 'partials/browse-shell.html',
  'proni:header': 'partials/proni-header.html',
  'proni:footer': 'partials/proni-footer.html',
};

const NAV_KEYS = new Set(['home', 'maps', 'browse', 'apps', 'about', 'none']);
const ALLOWED_ATTRS = { 'site:header': new Set(['active', 'layout', 'skip-link', 'skip-also']) };
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
  if (SHELL_REGIONS[name]) return SHELL_REGIONS[name](attrs).replace(/\r\n/g, '\n').trimEnd();
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

// Every public HTML page is a shell page or a named exemption.
if (CHECK) {
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.html'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { /* not a git checkout: the per-page rules below still run */ }
  for (const file of tracked) {
    if (NOT_PUBLIC.test(file) || PAGES.has(file) || SHELL_EXEMPT.has(file)) continue;
    problems.push(`${file}: an HTML page that is neither a shell page (PAGES) nor exempt (SHELL_EXEMPT)`);
  }
  for (const [page, expected] of PAGES) {
    if (!existsSync(page) || !expected.includes('site:head')) continue;
    const source = readFileSync(page, 'utf8');
    const headAt = source.indexOf('<!-- site:head');
    const firstSheet = source.search(/<link\b[^>]*\brel="stylesheet"/);
    if (firstSheet !== -1 && firstSheet < headAt) problems.push(`${page}: links a stylesheet before <!-- site:head -->, ahead of the tokens`);
    const bootstraps = source.split("localStorage.getItem('theme')").length - 1;
    if (bootstraps !== 1) problems.push(`${page}: carries the theme bootstrap ${bootstraps} times; it belongs in site:head only`);
    if (expected.includes('site:header') && !/<main\b[^>]*\bid="main-content"/.test(source)) {
      problems.push(`${page}: has no <main id="main-content">, the skip link's target`);
    }
    for (const m of source.matchAll(/<!-- site:header[^>]*\bskip-also="#([^":]+):/g)) {
      if (!source.includes(`id="${m[1]}"`)) problems.push(`${page}: skip-also points at #${m[1]}, which is not on the page`);
    }
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
  ? `PASS: ${PAGES.size} page(s) match the shell and partials/; ${SHELL_EXEMPT.size} exempt.`
  : `Site partials: ${written} page(s) updated, ${PAGES.size - written} already current.`);
