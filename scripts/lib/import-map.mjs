/**
 * The import maps of the module pages: which modules a page's entry script reaches, and the map
 * that versions each of them by content hash.
 *
 * Each page loads its entry script with a ?v= token (browse-cache-tokens.mjs keeps those). The
 * modules the entry imports, statically and transitively, are imported by plain paths, which the
 * page's <script type="importmap"> maps to the same path with ?v=<first 12 hex of the file's
 * SHA-256>. So a deploy that changes a module changes its URL, and the service worker's
 * stale-while-revalidate cache never pairs a new entry script with an old module.
 *
 * Read by the ui-module-tokens unit test (which holds every page to its map) and by
 * scripts/build/stamp-import-maps.mjs (npm run build:import-maps, which writes the maps).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceOf } from '../build/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The pages that carry an import map, as served paths. */
export const IMPORT_MAP_PAGES = Object.freeze([
  'browse/index.html',
  'catalogue/index.html',
  'records/index.html',
  'apps/proni-search/index.html',
  'apps/words/index.html',
  'apps/elections/index.html',
]);

/**
 * A served file's bytes (a path a package provides is read from the package, packages/served.json).
 * @param {string} rel served path, no leading slash
 */
export const readServed = (rel) => readFileSync(path.join(ROOT, sourceOf(rel)));

/**
 * The token of a served file: the first 12 hex of its SHA-256.
 * @param {string} rel served path, no leading slash
 */
export const token = (rel) => createHash('sha256').update(readServed(rel)).digest('hex').slice(0, 12);

/**
 * Static import specifiers of a module (import ... from '...'; export ... from '...'; import '...').
 * @param {string} source
 * @returns {string[]}
 */
export function importsOf(source) {
  const out = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\s[^;'"]*?\sfrom\s+['"]([^'"]+)['"]/gm)) out.push(/** @type {string} the pattern's one group */ (match[1]));
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(/** @type {string} the pattern's one group */ (match[1]));
  return out;
}

/**
 * Every module an entry reaches by relative or root-relative static imports, as site paths.
 * @param {string} entry site path of the entry script, with its leading slash
 * @returns {Set<string>}
 */
export function moduleGraph(entry) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {string} sitePath */
  const visit = (sitePath) => {
    for (const spec of importsOf(readServed(sitePath.slice(1)).toString('utf8'))) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      const resolved = new URL(spec, `https://site.invalid${sitePath}`).pathname;
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      visit(resolved);
    }
  };
  visit(entry);
  return seen;
}

/** The import-map block of a page's HTML. */
export const IMPORT_MAP_BLOCK = /<script type="importmap">([\s\S]*?)<\/script>/;

/**
 * A page's entry script and its import map's entries (null when it has no map).
 * @param {string} html
 * @returns {{ entry: string | undefined, map: Record<string, string> | null }}
 */
export function pageParts(html) {
  const entry = html.match(/<script type="module" src="([^"?]+)(?:\?[^"]*)?"/)?.[1];
  const mapText = html.match(IMPORT_MAP_BLOCK)?.[1];
  return { entry, map: mapText ? JSON.parse(mapText).imports || {} : null };
}

/**
 * The entries an entry script's import map should hold: each module it reaches, at its token.
 * @param {string} entry
 * @returns {Record<string, string>}
 */
export function expectedImports(entry) {
  return Object.fromEntries([...moduleGraph(entry)].sort().map((p) => [p, `${p}?v=${token(p.slice(1))}`]));
}

/**
 * The import-map block a page should carry.
 * @param {string} entry
 */
export function expectedImportMap(entry) {
  return `<script type="importmap">${JSON.stringify({ imports: expectedImports(entry) })}</script>`;
}
