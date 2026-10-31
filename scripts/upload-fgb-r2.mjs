#!/usr/bin/env node
/**
 * Upload one or more FlatGeobuf files to R2 (boundaries-data) via the S3 endpoint, as
 * application/octet-stream, the type data.civgraph.net already serves .fgb files with.
 * Each pair is a local file and the key it replaces. Run only at publish time; --dry-run
 * lists what would be sent.
 *
 *   node scripts/upload-fgb-r2.mjs <file>=<r2/key> [<file>=<r2/key> ...] [--dry-run]
 */
import { existsSync, readFileSync, statSync } from 'fs';

const DRY = process.argv.includes('--dry-run');
const pairs = process.argv.slice(2).filter((a) => a !== '--dry-run').map((a) => {
    const i = a.indexOf('=');
    return i > 0 ? { file: a.slice(0, i), key: a.slice(i + 1).replace(/^\/+/, '') } : null;
});
if (!pairs.length || pairs.some((p) => !p || !p.key.endsWith('.fgb'))) {
    console.error('Usage: node scripts/upload-fgb-r2.mjs <file>=<r2/key.fgb> [...] [--dry-run]');
    process.exit(1);
}
const missing = pairs.filter((p) => !existsSync(p.file));
if (missing.length) {
    console.error(`Missing local files: ${missing.map((p) => p.file).join(', ')}`);
    process.exit(1);
}
if (DRY) {
    for (const p of pairs) console.log(`${p.file} (${(statSync(p.file).size / 1e6).toFixed(2)} MB) -> ${p.key}`);
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
for (const p of pairs) {
    const body = readFileSync(p.file);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: p.key, Body: body, ContentType: 'application/octet-stream' }));
    console.log(`${p.key} ${(body.length / 1e6).toFixed(2)} MB`);
}
console.log(`Uploaded ${pairs.length} file(s).`);
