#!/usr/bin/env node
/**
 * Upload all -lod0/-lod1 FGBs that exist locally under data/maps/ to R2.
 * Idempotent: HEAD-checks each first; skips if R2 etag matches local
 * file size to avoid re-uploading on partial-completion retries.
 *
 * Usage:
 *   node scripts/upload_lod_ladders.mjs           # all under data/maps/
 *   node scripts/upload_lod_ladders.mjs <subdir>  # one subdir only
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, relative } from 'path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
config({ path: '.env.local' });

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) { console.error('Missing R2 env vars'); process.exit(1); }
const s3 = new S3Client({
    region: 'auto', endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

async function head(key) {
    try {
        const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return r.ContentLength;
    } catch { return null; }
}

async function put(key, body, ct) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }));
}

function* walk(root) {
    for (const name of readdirSync(root)) {
        const p = join(root, name);
        const s = statSync(p);
        if (s.isDirectory()) yield* walk(p);
        else if (/-lod[01]\.fgb$/.test(name)) yield p;
    }
}

const subdir = process.argv[2] ? `data/maps/${process.argv[2]}` : 'data/maps';
const files = [...walk(subdir)];
console.log(`${files.length} -lod0/-lod1 fgb candidates under ${subdir}/`);

let done = 0, skipped = 0, failed = 0;
for (const local of files) {
    const key = relative('.', local).split('\\').join('/');
    const localBytes = statSync(local).size;
    const remoteBytes = await head(key);
    if (remoteBytes === localBytes) {
        skipped++;
        continue;
    }
    try {
        const body = readFileSync(local);
        process.stdout.write(`${key} (${(body.length/1e6).toFixed(2)} MB): base...`);
        await put(key, body, 'application/octet-stream');
        process.stdout.write(' gz...');
        await put(key + '.gz', gzipSync(body, { level: 6 }), 'application/octet-stream');
        console.log(' done');
        done++;
    } catch (e) {
        console.log(' FAIL', String(e).slice(0, 80));
        failed++;
    }
}
console.log(`\nuploaded ${done}, skipped (already current) ${skipped}, failed ${failed}`);
