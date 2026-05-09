#!/usr/bin/env node
/**
 * Upload EDs_AllIreland_1971/1977/1983.fgb (and their lod0/lod1 variants
 * once present) to R2.
 */
import { readFileSync, existsSync } from 'fs';
import { gzipSync } from 'zlib';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';

config({ path: '.env.local' });

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    console.error('Missing R2 env vars'); process.exit(1);
}

const s3 = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

async function put(key, body, ct) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }));
}

const SUFFIXES = ['', '-lod0', '-lod1'];
const YEARS = [1971, 1977, 1980, 1983];

for (const year of YEARS) {
    for (const suf of SUFFIXES) {
        const local = `data/maps/electoral-divisions/EDs_AllIreland_${year}${suf}.fgb`;
        if (!existsSync(local)) {
            console.log(`SKIP missing ${local}`);
            continue;
        }
        const body = readFileSync(local);
        const key = local.replace(/\\/g, '/');
        const sizeMB = (body.length / 1e6).toFixed(2);
        process.stdout.write(`${key} (${sizeMB} MB): base...`);
        await put(key, body, 'application/octet-stream');
        process.stdout.write(' gz...');
        const gz = gzipSync(body, { level: 6 });
        await put(key + '.gz', gz, 'application/octet-stream');
        console.log(' done');
    }
}
