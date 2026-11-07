#!/usr/bin/env node
/**
 * List (and with --delete, remove) R2 objects under a prefix that no longer exist in the local
 * build output, e.g. graph index files a rebuild renamed. Only keys matching --match (a regular
 * expression on the key) are considered, so an unrelated object can never be swept up.
 *
 *   node scripts/publish/r2-orphans.mjs --prefix data/graph/indexes/ --match "statements-by-subject-shards/statements-by-subject-\d{3}\.json$" [--delete]
 */
import { existsSync } from 'fs';
import { r2CredentialsOrExit, s3ClientOptions } from './r2-env.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const PREFIX = arg('--prefix');
const MATCH = arg('--match');
const DELETE = process.argv.includes('--delete');
if (!PREFIX || !MATCH) {
  console.error('Usage: node scripts/publish/r2-orphans.mjs --prefix <r2/prefix/> --match <regex> [--delete]');
  process.exit(1);
}
const pattern = new RegExp(MATCH);
const R2 = r2CredentialsOrExit();
const BUCKET = R2.bucket;
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client(s3ClientOptions(R2, { maxAttempts: 5 }));

const orphans = [];
let listed = 0;
let token;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
  for (const object of page.Contents || []) {
    listed += 1;
    // R2 keys mirror the local paths; .br/.gz variants belong to their base file.
    const base = object.Key.replace(/\.(br|gz)$/, '');
    if (pattern.test(base) && !existsSync(base)) orphans.push(object.Key);
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

console.log(`${listed} objects under ${PREFIX}; ${orphans.length} match and are gone locally.`);
for (const key of orphans.slice(0, 5)) console.log(`  ${key}`);
if (orphans.length > 5) console.log(`  ... and ${orphans.length - 5} more`);
if (!DELETE || !orphans.length) process.exit(0);
for (let i = 0; i < orphans.length; i += 1000) {
  const chunk = orphans.slice(i, i + 1000);
  await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
}
console.log(`Deleted ${orphans.length}.`);
