/**
 * The map app's source files: packages/map/app/app.js and the modules split out of it under packages/map/src/app/
 * (frontend-plan.md 5.2), and the election manager, packages/map/app/election-manager.js, with the modules
 * split out of it under packages/map/src/election/ (frontend-plan.md 5.1). Checks that assert something
 * about the app's source read all of them, so a rule holds wherever the code now lives.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MAP_APP_ENTRY = 'packages/map/app/app.js';
export const MAP_APP_MODULE_DIR = 'packages/map/src/app';
export const ELECTION_MANAGER_ENTRY = 'packages/map/app/election-manager.js';
export const ELECTION_MODULE_DIR = 'packages/map/src/election';

/**
 * The .js and .mjs files under `dir`, repository-relative with forward slashes, in name order.
 * @param {string} root
 * @param {string} dir
 */
function moduleFiles(root, dir) {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ current) => {
    const entries = readdirSync(path.join(root, current)).sort();
    for (const name of entries) {
      const rel = `${current}/${name}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (/\.m?js$/.test(name)) files.push(rel);
    }
  };
  walk(dir);
  return files;
}

/**
 * The app's markup modules that moved from packages/map/src/app/ into the map's pure drawing code,
 * packages/map/src/views/ (rf10-gallery, 13 Nov 2026), so the gallery can draw them; their old paths
 * re-export them. Still the app's source for the checks that read it.
 */
export const MAP_APP_VIEW_FILES = ['packages/map/src/views/legend-view.mjs', 'packages/map/src/views/timeline-view.mjs'];

/** Repository-relative paths, forward slashes: app.js first, then packages/map/src/app/** in name order, then MAP_APP_VIEW_FILES. */
export function mapAppSourceFiles(root = ROOT) {
  return [MAP_APP_ENTRY, ...moduleFiles(root, MAP_APP_MODULE_DIR), ...MAP_APP_VIEW_FILES];
}

/** All of the map app's source, joined by newlines. */
export function readMapAppSource(root = ROOT) {
  return mapAppSourceFiles(root).map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
}

/** election-manager.js first, then packages/map/src/election/** in name order. */
export function electionManagerSourceFiles(root = ROOT) {
  return [ELECTION_MANAGER_ENTRY, ...moduleFiles(root, ELECTION_MODULE_DIR)];
}

/** All of the election manager's source, joined by newlines (the manager first). */
export function readElectionManagerSource(root = ROOT) {
  return electionManagerSourceFiles(root).map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
}
