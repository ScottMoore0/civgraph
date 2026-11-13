#!/usr/bin/env node
/**
 * List (and with --delete, remove) R2 objects under a prefix that no longer exist in the local
 * build output, e.g. graph index files a rebuild renamed. Only keys matching --match (a regular
 * expression on the key) are considered, so an unrelated object can never be swept up. The
 * listing and the deletes go through the S3 blob store (packages/storage/src/s3.mjs).
 *
 *   node scripts/publish/r2-orphans.mjs --prefix data/graph/indexes/ --match "statements-by-subject-shards/statements-by-subject-\d{3}\.json$" [--delete]
 */
import { existsSync } from 'fs';
import { openS3BlobStore } from '../../packages/storage/src/s3.mjs';
import { r2CredentialsOrExit, s3ClientOptions } from './r2-env.mjs';

const arg = (/** @type {string} */ name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const PREFIX = arg('--prefix');
const MATCH = arg('--match');
const DELETE = process.argv.includes('--delete');
if (!PREFIX || !MATCH) {
  console.error('Usage: node scripts/publish/r2-orphans.mjs --prefix <r2/prefix/> --match <regex> [--delete]');
  process.exit(1);
}
const pattern = new RegExp(MATCH);
const R2 = r2CredentialsOrExit();
const store = await openS3BlobStore({ bucket: R2.bucket, clientOptions: s3ClientOptions(R2, { maxAttempts: 5 }) });

/** @type {string[]} */
const orphans = [];
let listed = 0;
for await (const object of store.listAll({ prefix: PREFIX })) {
  listed += 1;
  // R2 keys mirror the local paths; .br/.gz variants belong to their base file.
  const base = object.key.replace(/\.(br|gz)$/, '');
  if (pattern.test(base) && !existsSync(base)) orphans.push(object.key);
}

console.log(`${listed} objects under ${PREFIX}; ${orphans.length} match and are gone locally.`);
for (const key of orphans.slice(0, 5)) console.log(`  ${key}`);
if (orphans.length > 5) console.log(`  ... and ${orphans.length - 5} more`);
if (!DELETE || !orphans.length) process.exit(0);
// Quiet DeleteObjects requests of 1,000 keys each (the store's deleteMany). A quiet request
// answers with the keys it could not delete, each with its error; every one is printed and
// counted, and any failure ends the run with exit 1.
const { errors } = await store.deleteMany(orphans);
for (const failure of errors) {
  console.error(`  FAILED ${failure.key ?? '(no key)'}: ${[failure.code, failure.message].filter(Boolean).join(' ') || 'no error given'}`);
}
if (!errors.length) {
  console.log(`Deleted ${orphans.length}.`);
} else {
  console.log(`Deleted ${orphans.length - errors.length} of ${orphans.length}; ${errors.length} failed.`);
  process.exit(1);
}
