#!/usr/bin/env node
/** Upload an explicit list of files (passed as args) plus their .gz to R2. */
import { readFileSync, statSync } from 'fs';
import { gzipSync } from 'zlib';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
config({ path: '.env.local' });

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) { console.error('Missing R2 env vars'); process.exit(1); }
const s3 = new S3Client({region:'auto', endpoint:ENDPOINT, credentials:{accessKeyId:ACCESS_KEY_ID, secretAccessKey:SECRET_ACCESS_KEY}});

for (const f of process.argv.slice(2)) {
    const body = readFileSync(f);
    const key = f.replace(/\\/g, '/');
    const ct = key.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    process.stdout.write(`${key} (${(body.length/1e6).toFixed(2)} MB)... base...`);
    await s3.send(new PutObjectCommand({Bucket:BUCKET, Key:key, Body:body, ContentType:ct}));
    process.stdout.write(' gz...');
    await s3.send(new PutObjectCommand({Bucket:BUCKET, Key:key+'.gz', Body:gzipSync(body,{level:6}), ContentType:ct}));
    console.log(' done');
}
