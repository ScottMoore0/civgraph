#!/usr/bin/env node
/**
 * Writes the /api/v1 JSON Schema files and the OpenAPI 3.1 document to packages/api/schemas/v1/
 * (built by packages/api/src/v1/schema-files.js from the route table and the contracts).
 * Nothing here is served or published: the folder is outside every served path, and
 * /api/v1/openapi.json is built at request time. Run after changing a contract or a route.
 *
 *   node scripts/build/api-v1-documents.mjs           write the files (and remove stale ones)
 *   node scripts/build/api-v1-documents.mjs --check   exit 1 when a file is missing, stale or extra
 *
 * tests/functions/api-v1-contracts.test.mjs runs the same comparison in test:unit.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACTS } from '../../packages/api/src/v1/contracts/v1.js';
import { PREFIX, ROUTES, openApi } from '../../packages/api/src/v1/v1.js';
import { fileText, schemaFiles } from '../../packages/api/src/v1/schema-files.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEMA_DIR = path.join(REPO, 'packages', 'api', 'schemas', 'v1');

/** The files as they should be: { relative path: text }. */
export function expectedFiles() {
  const docs = schemaFiles({ prefix: PREFIX, routes: ROUTES, contracts: CONTRACTS, openApi });
  return Object.fromEntries(Object.entries(docs).map(([rel, doc]) => [rel, fileText(doc)]));
}

/** Every file now under the folder, relative, with forward slashes. */
function presentFiles(dir = SCHEMA_DIR, base = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? presentFiles(path.join(dir, e.name), `${base}${e.name}/`)
    : [`${base}${e.name}`]));
}

/** Differences between the folder and what it should hold. */
export function problems() {
  const want = expectedFiles();
  const out = [];
  for (const [rel, text] of Object.entries(want)) {
    const file = path.join(SCHEMA_DIR, rel);
    if (!existsSync(file)) out.push(`missing ${rel}`);
    else if (readFileSync(file, 'utf8') !== text) out.push(`stale ${rel}`);
  }
  for (const rel of presentFiles()) if (!(rel in want)) out.push(`extra ${rel}`);
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--check')) {
    const found = problems();
    if (found.length) {
      console.error(`api v1 documents out of date (node scripts/build/api-v1-documents.mjs):\n  ${found.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`api v1 documents current (${Object.keys(expectedFiles()).length} files)`);
  } else {
    const want = expectedFiles();
    for (const rel of presentFiles()) if (!(rel in want)) rmSync(path.join(SCHEMA_DIR, rel));
    for (const [rel, text] of Object.entries(want)) {
      const file = path.join(SCHEMA_DIR, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    console.log(`wrote ${Object.keys(want).length} files to ${path.relative(REPO, SCHEMA_DIR)}`);
  }
}
