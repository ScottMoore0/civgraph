/**
 * The A1 acceptance test's stand-in for a committed config change (tests/unit/acceptance-a1-body-type.test.mjs).
 * Preloaded with `node --import`, it makes the process read the fixture's registry files and
 * generated slices where it would read the repository's, as if the fixture had been committed to
 * data/registries/ and `node packages/registries/src/browser/build.mjs` run. No product code is
 * changed or told about it:
 *
 *   A1_FILES    JSON { "<repository file>": "<fixture file>" }: node:fs readFileSync of the first
 *               reads the second (the registries are read that way).
 *   A1_MODULES  JSON { "<repository module>": "<fixture module>" }: an import of the first loads the
 *               second (the browser slices, packages/registries/src/browser/*.data.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { register, syncBuiltinESMExports } from 'node:module';

/** @param {string} file */
const keyOf = (file) => {
  const full = path.resolve(file);
  return process.platform === 'win32' ? full.toLowerCase() : full;
};

/** @type {Record<string, string>} */
const files = Object.fromEntries(Object.entries(JSON.parse(process.env.A1_FILES || '{}')).map(([from, to]) => [keyOf(from), String(to)]));
const realReadFileSync = fs.readFileSync;
/** @type {typeof fs.readFileSync} */
const readFileSync = /** @type {typeof fs.readFileSync} */ (function readFileSyncOverlaid(file, ...rest) {
  const swapped = typeof file === 'string' ? files[keyOf(file)] : undefined;
  return realReadFileSync.call(fs, /** @type {fs.PathOrFileDescriptor} */ (swapped || file), .../** @type {[]} */ (rest));
});
fs.readFileSync = readFileSync;
syncBuiltinESMExports();

register(new URL('./overlay-hooks.mjs', import.meta.url), { data: { modules: JSON.parse(process.env.A1_MODULES || '{}') } });
