#!/usr/bin/env node
/**
 * npm run build:site -- build dist/, the Cloudflare Pages output, from an explicit allow-list.
 *
 * Owner decision, 6 Nov 2026: Pages publishes only the files the site is meant to serve. Until
 * data phase 4 the repository root was the output directory and scripts/build/clean-for-pages.sh
 * deleted what should not deploy, so anything new at the root deployed by default (the
 * package files, wrangler.toml, the tooling and every Markdown note did). Now the output is
 * dist/ (wrangler.toml pages_build_output_dir), holding:
 *
 *   ROOT_FILES   the site's own top-level files
 *   SITE_DIRS    the directories of pages, assets and data the site serves, less EXCLUDE
 *   BUILD_DIRS   the gitignored output of `npm run build` (app/build/, build/)
 *
 * Which files: with git, the tracked files (what a clean checkout holds, so a local run equals
 * the Pages build) plus BUILD_DIRS; without git, every file under the allowed paths. Then:
 * files over 25 MiB are left out (Cloudflare's per-file limit, as clean-for-pages.sh did), and
 * the build FAILS above MAX_FILES (18,500; Cloudflare's hard limit is 20,000).
 *
 * Where the files live (root tidy, 8 Nov 2026): the site's own pages, assets and top-level files
 * are in site/ (site/X is served at /X), package files where packages/served.json says, and the
 * data directories (data/, render/, src/) at the repository root. ROOT_FILES, SITE_DIRS,
 * BUILD_DIRS and EXCLUDE name SERVED paths; sourceOf() gives the repository file.
 *
 * functions/ is not copied: Pages bundles it from the project root, beside dist/. _routes.json,
 * _headers and _redirects are copied, since Pages reads them from the output directory.
 *
 *   node scripts/build/site.mjs            build dist/ (prints the file count)
 *   node scripts/build/site.mjs --list     print the files it would copy, build nothing
 *   node scripts/build/site.mjs --check    count and size checks only (CI, check:pages-assets)
 *
 * Adding a page or a public data directory: add it to SITE_DIRS or ROOT_FILES here; a new
 * top-level folder is not published until it is listed. tests/unit/site-build.test.mjs holds
 * the list to what the site serves.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_DIR = 'dist';
export const MAX_FILES = Number(process.env.MAX_PAGES_FILES || 18500);
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const ROOT_FILES = [
  'index.html', '404.html', 'offline.html', 'sw.js', 'manifest.json', 'robots.txt', 'sitemap.xml',
  'llms.txt', '_headers', '_redirects', '_routes.json', 'LICENSE', 'NOTICE',
];

export const SITE_DIRS = [
  // .well-known/security.txt (RFC 9116), the one file there.
  '.well-known',
  'agent', 'app', 'apps', 'assets', 'browse', 'catalogue', 'data', 'maps', 'pages', 'pkg', 'records',
  'render', 'sitemaps', 'src', 'test2',
];

export const BUILD_DIRS = ['app/build', 'build'];

/**
 * Paths under SITE_DIRS that are not published: a trailing slash is a directory, anything else
 * one file. Carried over from clean-for-pages.sh and from the directories .cfignore listed
 * (which the Git-integrated Pages build never read: /data/elections/ was live in Nov 2026).
 */
export const EXCLUDE = [
  // Map geometry is served from R2 / data.civgraph.net; tile pyramids are local build artefacts.
  'render/tiles/', 'render/pmtiles/', 'render/source-cache/',
  // Record build output, answered from D1 by the compatibility Functions (a static copy would
  // shadow them), and the sources they are built from.
  'render/metadata/elections-test2/', 'render/metadata/elections-test2-summaries/',
  'render/metadata/election-provenance/', 'render/metadata/elections-test2.json',
  'render/metadata/elections-test2-report.json', 'data/database/election-provenance.json',
  'data/database/election-provenance-parts/',
  'data/browse/', 'data/graph/', 'data/elections/', 'data/elections-source/',
  // Map and catalogue documents answered from D1 since data phase 3.
  'data/database/maps.json', 'agent/maps-index.json', 'data/catalogue/catalogue.json',
  'data/catalogue/places.json', 'data/catalogue/people.json', 'render/metadata/maps-test.json',
  'render/metadata/maps-test-index.json', 'render/metadata/layer-details-test2/',
  'render/metadata/duplicate-feature-ids/',
  // Operational config and build-time source material.
  'data/database/r2-publication-allowlist.json', 'data/database/elections-schema.sql',
  'data/database/approved-publication-sources.json', 'data/database/approved-publication-sources-shards/',
  'data/database/medium-priority-publication-sources.json', 'data/database/ni-register-interests/',
  'data/provider-mirror-audit/', 'data/timeline-transitions/', 'data/documents/', 'data/downloads/',
  'data/books/', 'data/maps/', 'data/census/', 'data/sources/',
  // The registries (councils, parties, statuses, layer types) are build-time configuration, not
  // published (owner, refactor round 2, 7 Nov 2026).
  'data/registries/',
];
// data/census/explorer-bundle.json is the one file of data/census the Census Explorer fetches.
export const INCLUDE_ANYWAY = ['data/census/explorer-bundle.json'];

const toPosix = (p) => p.replace(/\\/g, '/');

/**
 * Package files served at another path (packages/served.json, refactor PKG-9): served path ->
 * source path. A key ending in / is a directory (a prefix); any other key is one file, matched
 * exactly (the /pkg/ allowlist). A package file wins over any file at its served path.
 */
export const SERVED_FROM = Object.fromEntries(Object.entries(
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'packages', 'served.json'), 'utf8'))).filter(([k]) => k !== '//'));

/** The served path `p` under a served.json key: the rest of a directory key, '' for a file key itself, or null. */
const underKey = (/** @type {string} */ p, /** @type {string} */ key) => {
  if (key.endsWith('/')) return p.startsWith(key) ? p.slice(key.length) : null;
  return p === key ? '' : null;
};

/** The served package modules of /pkg/ (packages/served.json): one file each, never a directory. */
export const SERVED_PKG = Object.keys(SERVED_FROM).filter((k) => k.startsWith('pkg/')).sort();

/** The folder of the site's own files: site/X is served at /X (root tidy, 8 Nov 2026). */
export const SITE_SOURCE = 'site';
/** The top-level served names that live in site/ (whatever site/ holds). */
export const SITE_ENTRIES = new Set(existsSync(path.join(REPO_ROOT, SITE_SOURCE)) ? readdirSync(path.join(REPO_ROOT, SITE_SOURCE)) : []);

/** The repository file a served (dist-relative) path is copied from. */
export function sourceOf(rel) {
  const p = toPosix(rel).replace(/^\/+/, '');
  if (!p) return SITE_SOURCE; // the served root is site/
  for (const [served, from] of Object.entries(SERVED_FROM)) {
    const rest = underKey(p, served);
    if (rest !== null) return from + rest;
    if (`${p}/` === served) return from.slice(0, -1); // the served directory itself
  }
  const top = p.split('/')[0];
  if (top && SITE_ENTRIES.has(top)) return `${SITE_SOURCE}/${p}`;
  return p;
}

/** The served path of a repository file (itself unless a package or site/ serves it elsewhere). */
export function servedOf(rel) {
  const p = toPosix(rel);
  for (const [served, from] of Object.entries(SERVED_FROM)) {
    const rest = underKey(p, from);
    if (rest !== null) return served + rest;
  }
  if (p.startsWith(`${SITE_SOURCE}/`)) return p.slice(SITE_SOURCE.length + 1);
  return p;
}

/** Whether a repository-relative path is published. */
export function isSiteFile(rel) {
  const p = toPosix(rel);
  if (INCLUDE_ANYWAY.includes(p)) return true;
  if (!p.includes('/')) return ROOT_FILES.includes(p);
  const top = p.slice(0, p.indexOf('/'));
  // /pkg/ serves exactly the allowlisted package modules, nothing else under it.
  if (top === 'pkg') return SERVED_PKG.includes(p);
  if (BUILD_DIRS.some((d) => p.startsWith(`${d}/`))) return true;
  if (!SITE_DIRS.includes(top)) return false;
  return !EXCLUDE.some((e) => (e.endsWith('/') ? p.startsWith(e) : p === e));
}

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE.includes(`${child}/`) && !INCLUDE_ANYWAY.some((f) => f.startsWith(`${child}/`))) continue;
      walk(root, child, out);
    } else if (entry.isFile()) out.push(child);
  }
}

function gitFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/** The files dist/ gets, sorted, with the oversized ones apart. */
export function siteFiles(root = REPO_ROOT) {
  let candidates = gitFiles(root);
  if (candidates) {
    for (const d of BUILD_DIRS) walk(root, sourceOf(d), candidates);
  } else {
    candidates = ROOT_FILES.map(sourceOf);
    for (const d of [...SITE_DIRS, ...BUILD_DIRS.filter((b) => !SITE_DIRS.includes(b.split('/')[0]))]) walk(root, sourceOf(d), candidates);
  }
  const files = [];
  const oversized = [];
  for (const rel of [...new Set(candidates.map(servedOf))].sort()) {
    if (!isSiteFile(rel)) continue;
    const abs = path.join(root, sourceOf(rel));
    if (!existsSync(abs)) continue;
    if (statSync(abs).size > MAX_FILE_BYTES) oversized.push(rel);
    else files.push(rel);
  }
  return { files, oversized };
}

function main() {
  const args = process.argv.slice(2);
  const { files, oversized } = siteFiles();
  if (args.includes('--list')) {
    process.stdout.write(`${files.join('\n')}\n`);
    return;
  }
  for (const rel of oversized) console.log(`left out (over 25 MiB): ${rel}`);
  const byTop = new Map();
  for (const f of files) {
    const top = f.includes('/') ? f.slice(0, f.indexOf('/')) : '(root)';
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  console.log(`Pages output (${OUT_DIR}/): ${files.length}/${MAX_FILES} files`);
  for (const [top, n] of [...byTop].sort((a, b) => b[1] - a[1])) console.log(`  ${top}: ${n}`);
  if (files.length > MAX_FILES) {
    console.error(`FAIL: ${files.length} files is over the ${MAX_FILES}-file guardrail (Cloudflare Pages fails at 20,000).`);
    process.exit(1);
  }
  if (!files.includes('index.html') || !files.includes('_routes.json')) {
    console.error('FAIL: index.html or _routes.json is missing from the output.');
    process.exit(1);
  }
  if (args.includes('--check')) return;
  const out = path.join(REPO_ROOT, OUT_DIR);
  rmSync(out, { recursive: true, force: true });
  for (const rel of files) {
    const dest = path.join(out, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, sourceOf(rel)), dest);
  }
  console.log(`Wrote ${OUT_DIR}/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
