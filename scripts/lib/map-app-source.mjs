/**
 * The map app's source files: app/src/app.js and the modules split out of it under src/map/app/
 * (frontend-plan.md 5.2). Checks that assert something about the app's source read all of them, so
 * a rule holds wherever the code now lives.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MAP_APP_ENTRY = 'app/src/app.js';
export const MAP_APP_MODULE_DIR = 'src/map/app';

/** Repository-relative paths, forward slashes: app.js first, then src/map/app/** in name order. */
export function mapAppSourceFiles(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    const entries = readdirSync(path.join(root, dir)).sort();
    for (const name of entries) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (/\.m?js$/.test(name)) files.push(rel);
    }
  };
  walk(MAP_APP_MODULE_DIR);
  return [MAP_APP_ENTRY, ...files];
}

/** All of the map app's source, joined by newlines. */
export function readMapAppSource(root = ROOT) {
  return mapAppSourceFiles(root).map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
}
