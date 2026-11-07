/**
 * The map app's source files: app/src/app.js and the modules split out of it under src/map/app/
 * (frontend-plan.md 5.2), and the election manager, app/src/election-manager.js, with the modules
 * split out of it under src/map/election/ (frontend-plan.md 5.1). Checks that assert something
 * about the app's source read all of them, so a rule holds wherever the code now lives.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MAP_APP_ENTRY = 'app/src/app.js';
export const MAP_APP_MODULE_DIR = 'src/map/app';
export const ELECTION_MANAGER_ENTRY = 'app/src/election-manager.js';
export const ELECTION_MODULE_DIR = 'src/map/election';

/** The .js and .mjs files under `dir`, repository-relative with forward slashes, in name order. */
function moduleFiles(root, dir) {
  const files = [];
  const walk = (current) => {
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

/** Repository-relative paths, forward slashes: app.js first, then src/map/app/** in name order. */
export function mapAppSourceFiles(root = ROOT) {
  return [MAP_APP_ENTRY, ...moduleFiles(root, MAP_APP_MODULE_DIR)];
}

/** All of the map app's source, joined by newlines. */
export function readMapAppSource(root = ROOT) {
  return mapAppSourceFiles(root).map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
}

/** election-manager.js first, then src/map/election/** in name order. */
export function electionManagerSourceFiles(root = ROOT) {
  return [ELECTION_MANAGER_ENTRY, ...moduleFiles(root, ELECTION_MODULE_DIR)];
}

/** All of the election manager's source, joined by newlines (the manager first). */
export function readElectionManagerSource(root = ROOT) {
  return electionManagerSourceFiles(root).map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
}
