#!/usr/bin/env node
/**
 * Write sitemap.xml (a sitemap index) and the sitemaps it lists under sitemaps/.
 *
 *   sitemaps/pages.xml                  the top-level public pages
 *   sitemaps/browse-<type>[-N].xml      every Browse record, at its path-style URL
 *                                       (/browse/<type>/<slug>, served with the record's
 *                                       own title by functions/browse/<type>/)
 *   sitemaps/proni.xml                  the PRONI catalogue's top-level collections
 *
 * Record URLs are path-style because a hash route (/browse/#/persons/...) is never sent
 * to the server: a search engine sees one page for all of Browse.
 *
 * WHERE THE RECORDS COME FROM, AND WHY A MISSING SOURCE KEEPS THE OLD FILE
 *
 * The Browse indexes (data/browse/*.json and their shards) are build output that is not
 * committed: they are uploaded to R2. A local build has them; the Pages build, which runs
 * `npm run build` on a clean checkout, does not. So the record sitemaps are committed, and
 * a type whose index is absent keeps its committed file rather than being written empty:
 * a deploy can never shrink the sitemap to the top-level pages. The same holds for
 * sitemaps/proni.xml: proni-roots.json is no longer built (data phase 4; the roots come from
 * /_api/proni/node), so it is rewritten only from a Browse tree that holds one.
 *
 * Limits: a sitemap holds at most 50,000 URLs and 50 MB. Files are split at 45,000 URLs,
 * and the size is checked as each file is written.
 *
 * No <lastmod>: the indexes carry no per-record modification date, and a build date
 * would change every file on every build.
 *
 *   node scripts/build/build-sitemap.mjs           write
 *   node scripts/build/build-sitemap.mjs --check   fail if the files on disk are invalid or stale
 *   node scripts/build/build-sitemap.mjs --data-root ../boundaries-website
 *                                            read the Browse indexes from another checkout
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BROWSE_DIR, localPathForUrl } from '../../packages/loader/src/paths.mjs';
import { SITE as SITE_CONFIG } from '../../packages/config/src/node.mjs';

const SITE = SITE_CONFIG.origin;
const OUT_DIR = 'sitemaps';
const INDEX_FILE = 'sitemap.xml';
// --data-root reads the Browse indexes from another checkout (a git worktree has none).
const dataRootIndex = process.argv.indexOf('--data-root');
const DATA_ROOT = dataRootIndex >= 0 && process.argv[dataRootIndex + 1] ? process.argv[dataRootIndex + 1] : null;
const BROWSE = DATA_ROOT ? path.join(DATA_ROOT, 'data/browse') : BROWSE_DIR;
// A shard URL (/data/browse/person-shards/...) is read from the same tree as its index.
const shardPath = (url) => (DATA_ROOT ? path.join(DATA_ROOT, String(url).replace(/^\/+/, '')) : localPathForUrl(url));
const MAX_URLS = 45000;
const MAX_BYTES = 50 * 1024 * 1024;
const CHECK = process.argv.includes('--check');
const ALLOW_SHRINK = process.argv.includes('--allow-shrink');

// The public pages a reader can reach from the site's navigation. /proni is the PRONI
// search app (functions/proni.js); everything else is a static page.
export const TOP_LEVEL_PAGES = [
  '/',
  '/maps/',
  '/browse/',
  '/records/',
  '/catalogue/',
  '/apps/',
  '/apps/words/',
  '/proni',
  '/pages/about.html',
  '/pages/census-explorer.html',
  '/pages/status.html',
];

// Browse types with a path-style page, and the index each is read from. Must match
// functions/_browse-page.js BROWSE_PAGE_TYPES.
export const BROWSE_SITEMAP_TYPES = ['elections', 'maps', 'offices', 'parties', 'persons', 'register-interests', 'sources'];
const BROWSE_INDEX_FILES = {
  elections: 'elections.json',
  maps: 'maps.json',
  offices: 'offices.json',
  parties: 'parties.json',
  persons: 'persons.json',
  'register-interests': 'register-interests.json',
  sources: 'sources.json',
};

const xmlEscape = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/** The same slug rule as browse.js and build-browse-indexes.mjs. */
function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

export function urlsetXml(urls) {
  const body = urls.map((loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function sitemapIndexXml(files) {
  const body = files.map((file) => `  <sitemap><loc>${xmlEscape(`${SITE}/${file}`)}</loc></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export function browseRecordUrl(type, slug) {
  return `${SITE}/browse/${type}/${encodeURIComponent(slug)}`;
}

/** /proni/AA/3: each part of the reference is a path segment. */
export function proniRecordUrl(ref) {
  return `${SITE}/proni/${String(ref).split('/').map(encodeURIComponent).join('/')}`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** A Browse index's items, following a sharded layout as browse.js does; null if absent. */
function readBrowseItems(type) {
  const file = path.join(BROWSE, BROWSE_INDEX_FILES[type]);
  if (!existsSync(file)) return null;
  const index = readJson(file);
  if (index.indexLayout !== 'sharded') return Array.isArray(index.items) ? index.items : null;
  const items = [];
  for (const shard of index.shards || []) {
    const shardFile = shard.url ? shardPath(shard.url) : '';
    if (!shardFile || !existsSync(shardFile)) return null;   // a partial index is no index
    items.push(...(readJson(shardFile).items || []));
  }
  return items;
}

function recordSlug(item) {
  return item.slug || slugify(item.id || item.key || item.title);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The files a type is written to: browse-persons.xml, or browse-sources-1.xml, -2... */
function typeFiles(prefix, count) {
  if (count <= 1) return [`${OUT_DIR}/${prefix}.xml`];
  return Array.from({ length: count }, (_, i) => `${OUT_DIR}/${prefix}-${i + 1}.xml`);
}

function existingFiles(prefix) {
  if (!existsSync(OUT_DIR)) return [];
  const pattern = new RegExp(`^${prefix}(?:-\\d+)?\\.xml$`);
  return readdirSync(OUT_DIR).filter((name) => pattern.test(name)).map((name) => `${OUT_DIR}/${name}`);
}

/**
 * {file -> xml} for one group of URLs, or null to keep the committed files: when the
 * group's source is absent, or when it has lost more than a tenth of the committed URLs.
 * The second is a build missing an input, not a tenth of the site deleted; --allow-shrink
 * accepts a real removal.
 */
function planGroup(prefix, urls) {
  if (!urls) return null;
  const unique = [...new Set(urls)];
  const committed = existingFiles(prefix)
    .reduce((sum, file) => sum + (readFileSync(file, 'utf8').match(/<loc>/g) || []).length, 0);
  if (!ALLOW_SHRINK && committed && unique.length < committed * 0.9) {
    console.warn(`sitemap: ${prefix} would drop from ${committed} to ${unique.length} URLs; keeping the committed file (--allow-shrink to accept).`);
    return null;
  }
  const parts = chunk(unique, MAX_URLS);
  const files = typeFiles(prefix, Math.max(1, parts.length));
  return Object.fromEntries(files.map((file, i) => [file, urlsetXml(parts[i] || [])]));
}

function buildPlan() {
  const groups = [];
  groups.push({ prefix: 'pages', files: planGroup('pages', TOP_LEVEL_PAGES.map((page) => `${SITE}${page}`)) });
  for (const type of BROWSE_SITEMAP_TYPES) {
    const items = readBrowseItems(type);
    const urls = items
      ? items.map((item) => browseRecordUrl(type, recordSlug(item))).sort()
      : null;
    groups.push({ prefix: `browse-${type}`, files: planGroup(`browse-${type}`, urls) });
  }
  const roots = existsSync(path.join(BROWSE, 'proni-roots.json')) ? readJson(path.join(BROWSE, 'proni-roots.json')).roots : null;
  groups.push({
    prefix: 'proni',
    files: planGroup('proni', roots ? roots.map((root) => proniRecordUrl(root.ref)).sort() : null),
  });
  return groups;
}

function validateUrlset(file, xml) {
  const problems = [];
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) problems.push('missing XML declaration');
  if (!/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(xml)) problems.push('missing urlset namespace');
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) problems.push('no URLs');
  if (locs.length > 50000) problems.push(`${locs.length} URLs (limit 50,000)`);
  if (Buffer.byteLength(xml) > MAX_BYTES) problems.push(`${Buffer.byteLength(xml)} bytes (limit 50 MB)`);
  const bad = locs.find((loc) => !loc.startsWith(`${SITE}/`) || /[\s<>"]/.test(loc));
  if (bad) problems.push(`bad URL ${bad}`);
  return problems.map((problem) => `${file}: ${problem}`);
}

function main() {
  const groups = buildPlan();
  const listed = [];
  const problems = [];
  let written = 0;
  let kept = 0;
  let urlCount = 0;

  if (!CHECK) mkdirSync(OUT_DIR, { recursive: true });
  for (const { prefix, files } of groups) {
    if (!files) {
      // Source absent (the Pages build): keep and list what is committed.
      const existing = existingFiles(prefix);
      if (!existing.length) console.warn(`sitemap: no source for ${prefix} and no committed file; left out.`);
      for (const file of existing) {
        const xml = readFileSync(file, 'utf8');
        problems.push(...validateUrlset(file, xml));
        urlCount += (xml.match(/<loc>/g) || []).length;
        listed.push(file);
        kept += 1;
      }
      continue;
    }
    for (const [file, xml] of Object.entries(files)) {
      problems.push(...validateUrlset(file, xml));
      urlCount += (xml.match(/<loc>/g) || []).length;
      listed.push(file);
      if (CHECK) {
        if (!existsSync(file) || readFileSync(file, 'utf8') !== xml) problems.push(`${file}: stale; run node scripts/build/build-sitemap.mjs`);
      } else if (!existsSync(file) || readFileSync(file, 'utf8') !== xml) {
        writeFileSync(file, xml);
        written += 1;
      }
    }
    // A type that shrank from several files to fewer leaves no orphans behind.
    for (const file of existingFiles(prefix)) {
      if (files[file]) continue;
      if (CHECK) problems.push(`${file}: no longer produced; run node scripts/build/build-sitemap.mjs`);
      else unlinkSync(file);
    }
  }

  const indexXml = sitemapIndexXml(listed.sort());
  if (CHECK) {
    if (!existsSync(INDEX_FILE) || readFileSync(INDEX_FILE, 'utf8') !== indexXml) problems.push(`${INDEX_FILE}: stale; run node scripts/build/build-sitemap.mjs`);
  } else if (!existsSync(INDEX_FILE) || readFileSync(INDEX_FILE, 'utf8') !== indexXml) {
    writeFileSync(INDEX_FILE, indexXml);
    written += 1;
  }

  if (problems.length) {
    console.error(`FAIL: sitemap problems:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`sitemap: ${listed.length} sitemaps, ${urlCount.toLocaleString('en-GB')} URLs`
    + (CHECK ? ' (checked)' : `; ${written} file(s) written, ${kept} kept from the last build`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
