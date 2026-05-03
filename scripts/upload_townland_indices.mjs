#!/usr/bin/env node
/**
 * Upload the rebuilt townland feature-indices (now with name column) to R2,
 * including .br and .gz variants.
 */
import { readFileSync } from 'fs';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';

config({ path: '.env.local' });

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';

if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    console.error('Missing R2 env vars in .env.local');
    process.exit(1);
}

const FILES = [
    'data/maps/townlands/ni-townlands-feature-index.json',
    'data/maps/townlands/roi-townlands-feature-index.json',
    'data/maps/townlands/all-ireland-townlands-feature-index.json',
];

const s3 = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

async function put(key, body, ct) {
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body, ContentType: ct,
    }));
}

for (const local of FILES) {
    const body = readFileSync(local);
    const key = local.replace(/\\/g, '/');
    process.stdout.write(`${key}: base...`);
    await put(key, body, 'application/json');
    process.stdout.write(' br...');
    const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
    await put(key + '.br', br, 'application/json');
    process.stdout.write(' gz...');
    const gz = gzipSync(body, { level: 6 });
    await put(key + '.gz', gz, 'application/json');
    console.log(` done (raw ${(body.length / 1e6).toFixed(2)} MB, br ${(br.length / 1e6).toFixed(2)} MB)`);
}

console.log(`\nUploaded ${FILES.length * 3} objects.`);
