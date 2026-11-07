/**
 * Registries: the lists the code branches on, kept as data with a schema, a loader and checks
 * (REFACTOR-PLAN.md section 4, REG-0 to REG-5).
 *
 *   loadRegistry(name)       the parsed registry; throws if it fails its schema or checks
 *   registryErrors(name, d)  schema and semantic errors of a registry value, [] when valid
 *   REGISTRIES               name -> { schema, load(root), check(data) }
 *
 * | name     | data                                            | views                     |
 * |----------|-------------------------------------------------|---------------------------|
 * | councils | data/registries/councils.json                   | registries/councils.mjs   |
 *
 * Node only (reads files). The views modules are pure and take the loaded value, so a Worker or
 * the browser can use them over a generated copy. `node registries/check.mjs` validates them all.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateAgainstSchema } from './validate.mjs';
import { fileURLToPath } from 'node:url';
import { checkCouncils } from './councils.mjs';

/** The repository root (this file is registries/index.mjs). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (root, rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

export const REGISTRIES = {
  councils: {
    schema: 'registries/schemas/councils.schema.json',
    load: (root) => readJson(root, 'data/registries/councils.json'),
    check: (data) => checkCouncils(data)
  }
};

export const REGISTRY_NAMES = Object.keys(REGISTRIES);

function definition(name) {
  const def = REGISTRIES[name];
  if (!def) throw new Error(`Unknown registry ${name}; known: ${REGISTRY_NAMES.join(', ')}`);
  return def;
}

/** Schema and semantic errors of `data` as registry `name`; [] when it is valid. */
export function registryErrors(name, data, { root = REPO_ROOT } = {}) {
  const def = definition(name);
  const schema = readJson(root, def.schema);
  const errors = validateAgainstSchema(data, schema);
  return errors.length ? errors : def.check(data);
}

/**
 * The registry `name`, read from `root` (the repository by default) and validated.
 * @param {string} name one of REGISTRY_NAMES
 * @param {{ root?: string, validate?: boolean }} [options]
 */
export function loadRegistry(name, { root = REPO_ROOT, validate = true } = {}) {
  const data = definition(name).load(root);
  if (validate) {
    const errors = registryErrors(name, data, { root });
    if (errors.length) {
      throw new Error(`Registry ${name} is invalid:\n  ${errors.slice(0, 25).join('\n  ')}${errors.length > 25 ? `\n  ... ${errors.length - 25} more` : ''}`);
    }
  }
  return data;
}
