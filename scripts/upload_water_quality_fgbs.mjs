#!/usr/bin/env node
/**
 * Upload the seven water-quality FGBs from _tmp_wq/fgb/ to R2.
 *
 * The catalogue references these but only three were uploaded previously
 * (agricultural-critical-risk-areas + the two below), so the rest 404 and
 * the user reports "None of the Water Quality and Hydrology maps outside
 * of Agricultural Critical Risk Areas and DAERA Network Contribution load".
 */
import { readFileSync, statSync } from 'fs';
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

const FILES = [
    'surface-water-bodies-status-20151.fgb',
    'wfd-river-water-bodies-2nd-cycle1.fgb',
    'wfd-river-and-lake-monitoring-sites-2nd-cycle1.fgb',
    'lake-water-bodies1.fgb',
    'northern-ireland-groundwater-bodies2.fgb',
    'groundwater-drinking-water-protected-areas-dwpas1.fgb',
    'surface-drinking-water-protected-areas1.fgb',
];

const s3 = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

async function put(key, body, ct) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }));
}

for (const fname of FILES) {
    const local = `_tmp_wq/fgb/${fname}`;
    let body;
    try { body = readFileSync(local); }
    catch (err) { console.error(`MISSING ${local}`); continue; }
    const key = `data/maps/water-quality/${fname}`;
    const sizeMB = (body.length / 1e6).toFixed(2);
    process.stdout.write(`${key} (${sizeMB} MB): base...`);
    await put(key, body, 'application/octet-stream');
    process.stdout.write(' gz...');
    const gz = gzipSync(body, { level: 6 });
    await put(key + '.gz', gz, 'application/octet-stream');
    console.log(' done');
}
