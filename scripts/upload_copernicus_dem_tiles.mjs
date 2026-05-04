#!/usr/bin/env node
/**
 * Upload the local Copernicus DEM 30m tile pyramid to R2.
 *
 * The catalogue references
 *   data/maps/physical/copernicus-dem-30m-ireland-tiles/{z}/{x}/{y}.webp
 * but the tiles were never pushed, so the Pages Function returns 404 and
 * the layer renders blank. Tiles are small (~9 MB total, ~540 files) so a
 * single-pass upload via the S3 endpoint is plenty fast.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, posix } from 'path';
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

const ROOT = 'data/maps/physical/copernicus-dem-30m-ireland-tiles';

const s3 = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) yield* walk(full);
        else if (entry.endsWith('.webp')) yield full;
    }
}

const PARALLEL = 8;
const queue = [];
for (const f of walk(ROOT)) queue.push(f);
console.log(`uploading ${queue.length} tiles to ${BUCKET}`);

let done = 0;
async function worker() {
    while (queue.length) {
        const local = queue.shift();
        if (!local) return;
        const key = local.replace(/\\/g, '/');
        const body = readFileSync(local);
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/webp'
        }));
        done++;
        if (done % 50 === 0 || done === queue.length + done) {
            process.stdout.write(`\r  ${done} uploaded`);
        }
    }
}
await Promise.all(Array.from({ length: PARALLEL }, () => worker()));
console.log(`\ndone — ${done} tiles uploaded`);
