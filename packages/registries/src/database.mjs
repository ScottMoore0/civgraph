/**
 * Schemas for the source and provider files of data/database/ (REG-6): the providers the
 * catalogue credits, the external sources, the raw source documents, the reference works and the
 * approved-publication sources (an index and its shards). Each file keeps its place and content;
 * this adds what it must look like (packages/registries/schemas/database/<name>.schema.json, in the
 * subset packages/registries/src/validate.mjs checks) and the rules a schema cannot state.
 *
 *   DATABASE_FILES                   name -> { files(root), schema, check(data) }
 *   databaseFileErrors(name, root)   every error of that file (or each of its files), [] when valid
 *
 * `node packages/registries/src/check-database.mjs` checks them all (npm run check:database-schemas);
 * tests/unit/registries-database.test.mjs runs the same in test:unit.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateAgainstSchema } from './validate.mjs';

/** @typedef {import('./validate.mjs').Schema} Schema */
/** @typedef {{ [field: string]: unknown }} JsonObject */

/**
 * @typedef {object} DatabaseFile
 * @property {string} schema                       the schema, under the repository root
 * @property {(root: string) => string[]} files    the data files it describes, under the root
 * @property {(data: JsonObject, file: string, root: string) => string[]} check  rules a schema cannot state, run on a file its schema accepted
 */

/** @type {(root: string, rel: string) => unknown} */
const readJson = (root, rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

/**
 * Values that occur more than once.
 * @param {unknown[]} values
 * @returns {unknown[]}
 */
function repeated(values) {
  const seen = new Set();
  const twice = new Set();
  for (const value of values) (seen.has(value) ? twice : seen).add(value);
  return [...twice];
}

/**
 * The items of a list field, as objects.
 * @param {JsonObject} data
 * @param {string} field
 * @returns {JsonObject[]}
 */
const itemsOf = (data, field) => /** @type {JsonObject[]} */ (Array.isArray(data[field]) ? data[field] : []);

/**
 * Ids that are repeated in a list field.
 * @param {JsonObject} data
 * @param {string} field
 * @param {string} at
 */
const repeatedIds = (data, field, at) => repeated(itemsOf(data, field).map((item) => item.id)).map((id) => `${at}: id ${id} is listed twice`);

/**
 * The provider registry's own rules: unique ids, names and aliases; a parent that is a provider;
 * a jurisdiction the file declares.
 * @param {JsonObject} data
 */
export function checkProviders(data) {
  const providers = itemsOf(data, 'providers');
  const jurisdictions = /** @type {JsonObject} */ (data.jurisdictions);
  const ids = new Set(providers.map((p) => p.id));
  /** @type {string[]} */
  const errors = repeatedIds(data, 'providers', 'providers');
  const spellings = providers.flatMap((p) => [p.name, .../** @type {unknown[]} */ (p.aliases || [])]);
  for (const name of repeated(spellings)) errors.push(`providers: ${name} is a name or alias of two providers`);
  for (const p of providers) {
    if (p.parent !== undefined && !ids.has(p.parent)) errors.push(`providers: ${p.id}'s parent ${p.parent} is not a provider`);
    if (p.parent === p.id) errors.push(`providers: ${p.id} is its own parent`);
    if (!Object.hasOwn(jurisdictions, String(p.jurisdiction))) errors.push(`providers: ${p.id}'s jurisdiction ${p.jurisdiction} is not declared`);
  }
  return errors;
}

/**
 * Raw source documents: unique ids; status chips from the file's own conventions, Source only
 * among them; a mirrored record links its Internet Archive copy (raw-source-documents.mjs).
 * @param {JsonObject} data
 */
function checkRawSourceDocuments(data) {
  const chips = new Set(/** @type {unknown[]} */ ((/** @type {JsonObject} */ (data.conventions)).statusChips || []));
  /** @type {string[]} */
  const errors = repeatedIds(data, 'sources', 'raw-source-documents');
  for (const source of itemsOf(data, 'sources')) {
    const own = /** @type {unknown[]} */ (source.statusChips);
    for (const chip of own) if (!chips.has(chip)) errors.push(`raw-source-documents: ${source.id} has status chip ${chip}, not one of conventions.statusChips`);
    if (!own.includes('Source only')) errors.push(`raw-source-documents: ${source.id} needs the Source only status chip`);
    if ((/** @type {JsonObject} */ (source.iaMirror)).mirrorStatus === 'mirrored') {
      if (!(/** @type {JsonObject} */ (source.viewport)).internetArchiveUrl) errors.push(`raw-source-documents: mirrored ${source.id} has no viewport.internetArchiveUrl`);
      if (!own.includes('Mirror available')) errors.push(`raw-source-documents: mirrored ${source.id} needs the Mirror available status chip`);
    }
  }
  return errors;
}

/**
 * The approved-publication index: its shards are the ones on disk, each with the count it says.
 * @param {JsonObject} data
 * @param {string} file
 * @param {string} root
 */
function checkApprovedPublicationIndex(data, file, root) {
  const shards = itemsOf(data, 'shards');
  /** @type {string[]} */
  const errors = [];
  if (data.shardCount !== shards.length) errors.push(`${file}: shardCount ${data.shardCount} but ${shards.length} shards are listed`);
  const onDisk = readdirSync(path.join(root, APPROVED_SHARDS)).filter((f) => f.endsWith('.json')).map((f) => `${APPROVED_SHARDS}/${f}`).sort();
  const listed = shards.map((s) => String(s.url)).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(listed)) errors.push(`${file}: the shards listed are not the files in ${APPROVED_SHARDS}`);
  for (const shard of shards) {
    if (!onDisk.includes(String(shard.url))) continue;
    const items = itemsOf(/** @type {JsonObject} */ (readJson(root, String(shard.url))), 'items');
    if (items.length !== shard.count) errors.push(`${file}: ${shard.url} holds ${items.length} sources, the index says ${shard.count}`);
  }
  return errors;
}

const APPROVED_SHARDS = 'data/database/approved-publication-sources-shards';

/** @type {{ [name: string]: DatabaseFile }} */
export const DATABASE_FILES = {
  providers: {
    schema: 'packages/registries/schemas/database/providers.schema.json',
    files: () => ['data/database/providers.json'],
    check: (data) => checkProviders(data)
  },
  'external-sources': {
    schema: 'packages/registries/schemas/database/external-sources.schema.json',
    files: () => ['data/database/external-sources.json'],
    check: (data) => repeatedIds(data, 'sources', 'external-sources')
  },
  'raw-source-documents': {
    schema: 'packages/registries/schemas/database/raw-source-documents.schema.json',
    files: () => ['data/database/raw-source-documents.json'],
    check: (data) => checkRawSourceDocuments(data)
  },
  'reference-works': {
    schema: 'packages/registries/schemas/database/reference-works.schema.json',
    files: () => ['data/database/reference-works.json'],
    check: (data) => repeatedIds(data, 'sources', 'reference-works')
  },
  'approved-publication-sources': {
    schema: 'packages/registries/schemas/database/approved-publication-sources.schema.json',
    files: () => ['data/database/approved-publication-sources.json'],
    check: (data, file, root) => checkApprovedPublicationIndex(data, file, root)
  },
  'approved-publication-sources-shards': {
    schema: 'packages/registries/schemas/database/approved-publication-sources-shard.schema.json',
    files: (root) => readdirSync(path.join(root, APPROVED_SHARDS)).filter((f) => f.endsWith('.json')).sort().map((f) => `${APPROVED_SHARDS}/${f}`),
    check: (data, file) => repeatedIds(data, 'items', file)
  }
};

/**
 * Errors of a value against one file kind's schema and rules; [] when valid.
 * @param {string} name  a DATABASE_FILES key
 * @param {unknown} data
 * @param {{ root: string, file?: string }} options
 * @returns {string[]}
 */
export function databaseValueErrors(name, data, { root, file = name }) {
  const def = DATABASE_FILES[name];
  if (!def) throw new Error(`Unknown database file ${name}; known: ${Object.keys(DATABASE_FILES).join(', ')}`);
  const schema = /** @type {Schema} */ (readJson(root, def.schema));
  const errors = validateAgainstSchema(data, schema, schema, '$', { schemas: {} }).map((e) => `${file}: ${e}`);
  return errors.length ? errors : def.check(/** @type {JsonObject} */ (data), file, root);
}

/**
 * Every error of the file (or files) of a kind, read under `root`.
 * @param {string} name  a DATABASE_FILES key
 * @param {string} root
 * @returns {string[]}
 */
export function databaseFileErrors(name, root) {
  const def = DATABASE_FILES[name];
  if (!def) throw new Error(`Unknown database file ${name}; known: ${Object.keys(DATABASE_FILES).join(', ')}`);
  return def.files(root).flatMap((file) => databaseValueErrors(name, readJson(root, file), { root, file }));
}
