/**
 * packages/types: the generated declarations are up to date with their sources, they compile
 * (strict, noImplicitAny, skipLibCheck off), every core shape is exported, and the real data
 * the schema-generated types describe validates against those schemas.
 *
 * Covered elsewhere: the /api/v1 contracts against real answers
 * (tests/functions/api-v1-contracts.test.mjs) and the records tables against the migrations
 * (tests/records/schema.test.mjs); the types generated from them follow by regeneration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { PACKAGE_DIR, REPO_ROOT, SCHEMA_SETS, staleFiles } from '../../packages/types/src/generate.mjs';
import { REGISTRIES, REGISTRY_NAMES, loadRegistry, registryErrors } from '../../registries/index.mjs';
import { loadFactsModel, schemaErrors } from '../../scripts/lib/facts-model.mjs';

/** The names code imports most; each must be exported by packages/types/index.d.ts. */
const CORE = [
  'Election', 'Contest', 'Candidacy', 'Candidate', 'Count', 'Person', 'Party', 'Council', 'Office',
  'Institution', 'Tenure', 'MapEntry', 'LayerEntry', 'CatalogueSeries', 'CatalogueClass',
  'CatalogueCategory', 'MapCatalogue', 'ApiError', 'BrowsePage', 'RecordAnswer', 'DetailAnswer',
  'Json', 'Tables', 'TableName', 'V1Routes', 'V1Answer', 'CouncilsRegistry', 'PartiesRegistry',
  'OfficesDocument', 'TenuresDocument', 'RecordsDb', 'ApiV1',
];

test('types: the generated declarations are up to date with their sources', async () => {
  assert.deepEqual(await staleFiles(), [], 'run npm run build:types and commit packages/types/generated/');
});

test('types: the declarations compile and export every core shape', () => {
  const configFile = path.join(PACKAGE_DIR, 'tsconfig.json');
  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, PACKAGE_DIR);
  assert.equal(parsed.options.noImplicitAny, true);
  assert.equal(parsed.options.skipLibCheck, false);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program)
    .map((d) => `${d.file ? path.relative(REPO_ROOT, d.file.fileName) : ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  assert.deepEqual(diagnostics, []);
  const checker = program.getTypeChecker();
  const index = program.getSourceFile(path.join(PACKAGE_DIR, 'index.d.ts'));
  assert.ok(index);
  const moduleSymbol = checker.getSymbolAtLocation(index);
  assert.ok(moduleSymbol);
  const exported = new Set(checker.getExportsOfModule(moduleSymbol).map((s) => s.getName()));
  assert.deepEqual(CORE.filter((name) => !exported.has(name)), []);
});

test('types: every schema the types are generated from is one a check validates real data against', () => {
  const byRegistry = new Set(Object.values(REGISTRIES).flatMap((r) => [r.schema, ...(r.schemas || [])]));
  // scripts/lib/facts-model.mjs schemaErrors() validates every data/schemas file it names.
  const facts = new Set(['citation', 'offices', 'tenures', 'party-events', 'affiliations', 'non-candidate-persons', 'honours']
    .map((n) => `data/schemas/${n}.schema.json`));
  const unchecked = SCHEMA_SETS.flatMap(([dir]) => readdirSync(path.join(REPO_ROOT, dir))
    .filter((f) => f.endsWith('.schema.json')).map((f) => `${dir}/${f}`))
    .filter((rel) => !byRegistry.has(rel) && !facts.has(rel));
  assert.deepEqual(unchecked, []);
});

test('types: the real registries validate against the schemas their types come from', () => {
  for (const name of REGISTRY_NAMES) {
    assert.deepEqual(registryErrors(name, loadRegistry(name, { validate: false })), [], name);
  }
});

test('types: the real facts files validate against the schemas their types come from', async () => {
  assert.deepEqual(await schemaErrors(loadFactsModel(REPO_ROOT), REPO_ROOT), []);
});
