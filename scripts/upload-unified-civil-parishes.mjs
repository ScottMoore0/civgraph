#!/usr/bin/env node
/**
 * Upload the unified Civil Parishes layer, LOD ladder, chunk index, and chunks
 * to the configured R2 bucket.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';

config({ path: '.env.local' });

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';

if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.error('Missing R2 env vars');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

const ROOT = '.';
const DIR = 'data/maps/baronies-parishes';
const CHUNKS_DIR = join(DIR, 'chunks');
const BASE_NAME = 'Civil_Parishes_Ireland_v2';
const BASES = [
  `${BASE_NAME}.fgb`,
  `${BASE_NAME}.fgb.gz`,
  `${BASE_NAME}-lod0.fgb`,
  `${BASE_NAME}-lod0.fgb.gz`,
  `${BASE_NAME}-lod1.fgb`,
  `${BASE_NAME}-lod1.fgb.gz`,
  `${BASE_NAME}-lod2.fgb`,
  `${BASE_NAME}-lod2.fgb.gz`,
  'civil-parishes-by-province-chunks.json',
];

function contentType(key) {
  if (key.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function head(key) {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return result.ContentLength;
  } catch {
    return null;
  }
}

async function put(key, body) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType(key),
  }));
}

function collectFiles() {
  const files = BASES.map((name) => join(DIR, name));
  for (const name of readdirSync(CHUNKS_DIR)) {
    if (name.startsWith(`${BASE_NAME}_`) && /\.fgb(?:\.gz)?$/.test(name)) {
      files.push(join(CHUNKS_DIR, name));
    }
  }
  return files;
}

let uploaded = 0;
let skipped = 0;
let failed = 0;

const files = collectFiles();
console.log(`${files.length} civil-parishes upload candidates`);

for (const local of files) {
  const key = relative(ROOT, local).replace(/\\/g, '/');
  const localBytes = statSync(local).size;
  const remoteBytes = await head(key);
  if (remoteBytes === localBytes) {
    skipped++;
    continue;
  }

  try {
    const body = readFileSync(local);
    process.stdout.write(`${key} (${(body.length / 1e6).toFixed(2)} MB)...`);
    await put(key, body);
    uploaded++;
    console.log(' done');
  } catch (err) {
    failed++;
    console.log(` FAIL ${String(err).slice(0, 120)}`);
  }
}

console.log(`uploaded ${uploaded}, skipped ${skipped}, failed ${failed}`);
if (failed > 0) process.exit(1);
