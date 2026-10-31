#!/usr/bin/env node
/**
 * Upload the NI admin-areas vintage FGBs staged by scripts/ni_admin_areas_reconstruct.py
 * (plus .br / .gz variants) to R2 via the S3 endpoint. Only files named in
 * data/maps/local-government/_staged/editions.json and the 1966 LGD file + LODs
 * are sent; each goes to data/maps/local-government/<same name>. Targeted,
 * idempotent. --dry-run lists what would be sent. Run only at publish time.
 */
import { existsSync, readFileSync } from 'fs';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
const DRY = process.argv.includes('--dry-run');
const STAGED = 'data/maps/local-government/_staged';
const plan = JSON.parse(readFileSync(`${STAGED}/editions.json`, 'utf8'));
const names = [...new Set(Object.values(plan).map((row) => row.file))].sort();
names.push('LGDs_04-07-1966.fgb', 'LGDs_04-07-1966-lod0.fgb', 'LGDs_04-07-1966-lod1.fgb');
const missing = names.filter((name) => !existsSync(`${STAGED}/${name}`));
if (missing.length) {
    console.error(`Missing staged files: ${missing.join(', ')}`);
    process.exit(1);
}
if (DRY) {
    for (const name of names) console.log(`${STAGED}/${name} -> data/maps/local-government/${name} (+.br, .gz)`);
    process.exit(0);
}
process.loadEnvFile('.env.local');
const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
const { R2_S3_ENDPOINT: ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
if (!ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error('Missing R2_S3_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in .env.local');
    process.exit(1);
}
const s3 = new S3Client({
    region: 'auto', endpoint: ENDPOINT, maxAttempts: 5,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const put = (Key, Body) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType: 'application/octet-stream' }));
for (const name of names) {
    const body = readFileSync(`${STAGED}/${name}`);
    const key = `data/maps/local-government/${name}`;
    await put(key, body);
    await put(`${key}.br`, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }));
    await put(`${key}.gz`, gzipSync(body, { level: 6 }));
    console.log(`${key} (+.br, .gz) ${(body.length / 1e6).toFixed(2)} MB`);
}
console.log(`Uploaded ${names.length} files x 3 variants.`);
