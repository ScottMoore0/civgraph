#!/usr/bin/env node
/**
 * Upload the seven Dungannon-1949-split FGBs (plus .br / .gz variants)
 * to R2 via the S3 endpoint. Targeted, idempotent — designed to be re-run.
 */
import { readFileSync, statSync, writeFileSync } from 'fs';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: '.env.local' });

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';

if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    console.error('Missing R2_S3_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in .env.local');
    process.exit(1);
}

const FILES = [
    'data/maps/local-government/LGDs_04-07-1966.fgb',
    'data/maps/local-government/LGDs_04-07-1966-lod0.fgb',
    'data/maps/local-government/LGDs_04-07-1966-lod1.fgb',
    'data/maps/local-government/NI_Admin_Areas_1921-1936.fgb',
    'data/maps/local-government/NI_Admin_Areas_1937-1948.fgb',
    'data/maps/local-government/NI_Admin_Areas_1949-1963.fgb',
    'data/maps/local-government/NI_Admin_Areas_1964.fgb',
    'data/maps/local-government/NI_Admin_Areas_1965-1968.fgb',
    'data/maps/local-government/NI_Admin_Areas_1969.fgb',
];

const s3 = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    forcePathStyle: false,
    maxAttempts: 5,
});

async function put(key, body, ct) {
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body, ContentType: ct,
    }));
}

let uploaded = 0;
for (const local of FILES) {
    const body = readFileSync(local);
    const size = body.length;
    const key = local.replace(/\\/g, '/');
    process.stdout.write(`${key}: base...`);
    await put(key, body, 'application/octet-stream');
    process.stdout.write(' br...');
    const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
    await put(key + '.br', br, 'application/octet-stream');
    process.stdout.write(' gz...');
    const gz = gzipSync(body, { level: 6 });
    await put(key + '.gz', gz, 'application/octet-stream');
    console.log(` done (raw ${(size/1e6).toFixed(2)} MB, br ${(br.length/1e6).toFixed(2)} MB, gz ${(gz.length/1e6).toFixed(2)} MB)`);
    uploaded += 3;
}

console.log(`\nUploaded ${uploaded} objects (${FILES.length} files × 3 variants).`);
