/**
 * Registries: the lists the code branches on, kept as data with a schema, a loader and checks
 * (REFACTOR-PLAN.md section 4, REG-0 to REG-5).
 *
 *   loadRegistry(name)       the parsed registry; throws if it fails its schema or checks
 *   registryErrors(name, d)  schema and semantic errors of a registry value, [] when valid
 *   REGISTRIES               name -> { schema, schemas?, load(root), check(data) }
 *
 * | name     | data                                            | views                     |
 * |----------|-------------------------------------------------|---------------------------|
 * | councils | data/registries/councils.json                   | registries/councils.mjs   |
 * | parties  | data/registries/parties.json, joined with the   | registries/parties.mjs    |
 * |          | party files it names (they stay where they are) |                           |
 * | offices  | data/offices/offices.json + tenures/*.json      | registries/offices.mjs    |
 * | layers   | data/registries/layer-types.json                | registries/layers.mjs     |
 * | statuses | data/registries/statuses.json                   | registries/statuses.mjs,  |
 * |          |                                                 | registries/status-machines.mjs |
 *
 * Node only (reads files). The views modules are pure and take the loaded value, so a Worker or
 * the browser can use them over a generated copy. `node registries/check.mjs` validates them all.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateAgainstSchema } from './validate.mjs';
import { fileURLToPath } from 'node:url';
import { checkCouncils } from './councils.mjs';
import { assembleParties, checkParties } from './parties.mjs';
import { assembleOffices, checkOffices } from './offices.mjs';
import { checkLayerTypes } from './layers.mjs';
import { checkStatuses } from './statuses.mjs';

/** The repository root (this file is packages/registries/src/index.mjs). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** @typedef {import('../../types/index.js').CouncilsRegistry} CouncilsRegistry */
/** @typedef {import('../../types/index.js').PartiesRegistry} PartiesRegistry */
/** @typedef {import('../../types/index.js').OfficesRegistryRegistry} OfficesRegistry */
/** @typedef {import('../../types/index.js').LayerTypesRegistry} LayerTypesRegistry */
/** @typedef {import('../../types/index.js').StatusesRegistry} StatusesRegistry */
/** @typedef {import('./validate.mjs').Schema} Schema */

/**
 * Each registry's value, by name, as loadRegistry returns it.
 * @typedef {{
 *   councils: CouncilsRegistry,
 *   parties: PartiesRegistry,
 *   offices: OfficesRegistry,
 *   layers: LayerTypesRegistry,
 *   statuses: StatusesRegistry
 * }} Registries
 */
/** @typedef {keyof Registries} RegistryName */

/**
 * A registry: its schema file (and the other schema files its $refs name), how to read it under
 * a root, and the checks a schema cannot state, run on a value the schema accepts.
 * @typedef {{ schema: string, schemas?: string[], load: (root: string) => unknown, check: (data: unknown) => string[] }} RegistryDefinition
 */

/** @type {(root: string, rel: string) => unknown} */
const readJson = (root, rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

// `check` runs only on a value its schema accepted (registryErrors), so it takes the registry's type.
/** @type {{ [name in RegistryName]: RegistryDefinition }} */
export const REGISTRIES = {
  councils: {
    schema: 'packages/registries/schemas/councils.schema.json',
    load: (root) => readJson(root, 'data/registries/councils.json'),
    check: (data) => checkCouncils(/** @type {CouncilsRegistry} */ (data))
  },
  parties: {
    schema: 'packages/registries/schemas/parties.schema.json',
    load: (root) => assembleParties((rel) => readJson(root, rel), /** @type {{ [field: string]: unknown }} */ (readJson(root, 'data/registries/parties.json'))),
    check: (data) => checkParties(/** @type {PartiesRegistry} */ (data))
  },
  offices: {
    schema: 'packages/registries/schemas/offices-registry.schema.json',
    // The data's own schemas (check:facts reads the same files), by the name a $ref uses.
    schemas: ['data/schemas/offices.schema.json', 'data/schemas/tenures.schema.json', 'data/schemas/citation.schema.json'],
    load: (root) => assembleOffices(root),
    check: (data) => checkOffices(/** @type {OfficesRegistry} */ (data))
  },
  layers: {
    schema: 'packages/registries/schemas/layer-types.schema.json',
    load: (root) => readJson(root, 'data/registries/layer-types.json'),
    check: (data) => checkLayerTypes(/** @type {LayerTypesRegistry} */ (data))
  },
  statuses: {
    schema: 'packages/registries/schemas/statuses.schema.json',
    load: (root) => readJson(root, 'data/registries/statuses.json'),
    check: (data) => checkStatuses(/** @type {StatusesRegistry} */ (data))
  }
};

export const REGISTRY_NAMES = /** @type {RegistryName[]} */ (Object.keys(REGISTRIES));

/**
 * @param {string} name
 * @returns {RegistryDefinition}
 */
function definition(name) {
  const def = /** @type {{ [name: string]: RegistryDefinition | undefined }} */ (REGISTRIES)[name];
  if (!def) throw new Error(`Unknown registry ${name}; known: ${REGISTRY_NAMES.join(', ')}`);
  return def;
}

/**
 * Schema and semantic errors of `data` as registry `name`; [] when it is valid.
 * @param {string} name one of REGISTRY_NAMES
 * @param {unknown} data
 * @param {{ root?: string }} [options]
 * @returns {string[]}
 */
export function registryErrors(name, data, { root = REPO_ROOT } = {}) {
  const def = definition(name);
  const schema = /** @type {Schema} */ (readJson(root, def.schema));
  const schemas = Object.fromEntries((def.schemas || []).map((rel) => [path.basename(rel), /** @type {Schema} */ (readJson(root, rel))]));
  const errors = validateAgainstSchema(data, schema, schema, '$', { schemas });
  return errors.length ? errors : def.check(data);
}

/**
 * The registry `name`, read from `root` (the repository by default) and validated.
 * @template {string} N
 * @param {N} name one of REGISTRY_NAMES
 * @param {{ root?: string, validate?: boolean }} [options]
 * @returns {N extends RegistryName ? Registries[N] : unknown} the registry's type once it has passed its schema and checks
 */
export function loadRegistry(name, { root = REPO_ROOT, validate = true } = {}) {
  const data = definition(name).load(root);
  if (validate) {
    const errors = registryErrors(name, data, { root });
    if (errors.length) {
      throw new Error(`Registry ${name} is invalid:\n  ${errors.slice(0, 25).join('\n  ')}${errors.length > 25 ? `\n  ... ${errors.length - 25} more` : ''}`);
    }
  }
  return /** @type {N extends RegistryName ? Registries[N] : unknown} */ (data);
}
