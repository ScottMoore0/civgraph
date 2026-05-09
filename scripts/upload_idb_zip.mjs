#!/usr/bin/env node
/** Upload IDB zip files to R2 under their canonical names. */
import { readFileSync, statSync, existsSync } from 'fs';
import { gzipSync } from 'zlib';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
config({ path: '.env.local' });

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) { console.error('Missing R2 env vars'); process.exit(1); }
const s3 = new S3Client({region:'auto', endpoint:ENDPOINT, credentials:{accessKeyId:ACCESS_KEY_ID, secretAccessKey:SECRET_ACCESS_KEY}});

// zip relative path -> R2 key (string with literal spaces; encoded by S3 client)
const ZIP_ROOT = '_tmp_idb_zip/Irish Digitised Boundaries';
const MAP = [
    // Dáil — replace existing R2 versions with updated bytes
    ['Dáil Constituencies/1974.fgb',                        'data/maps/parliamentary/1974_Dail.fgb'],
    ['Dáil Constituencies/1980.fgb',                        'data/maps/parliamentary/1980_Dail.fgb'],
    ['Dáil Constituencies/1983.fgb',                        'data/maps/parliamentary/1983_Dail.fgb'],
    ['Dáil Constituencies/Files already on the site/1995.fgb', 'data/maps/parliamentary/1995_Dail.fgb'],
    ['Dáil Constituencies/Files already on the site/1998.fgb', 'data/maps/parliamentary/1998_Dail.fgb'],
    ['Dáil Constituencies/Files already on the site/2005.fgb', 'data/maps/parliamentary/2007_Dail.fgb'],
    ['Dáil Constituencies/Files already on the site/2009.fgb', 'data/maps/parliamentary/2011_Dail.fgb'],
    ['Dáil Constituencies/Files already on the site/2013.fgb', 'data/maps/parliamentary/ROIConstituencies2013.fgb'],
    ['Dáil Constituencies/Files already on the site/2017.fgb', 'data/maps/parliamentary/ROIConstituencies2017.fgb'],
    // Local Authorities — replace existing R2 versions
    ['Local Authorities/1966.fgb',                          'data/maps/local-government/ROI_Local_Authorities_1966.fgb'],
    ['Local Authorities/1977.fgb',                          'data/maps/local-government/ROI_Local_Authorities_1977.fgb'],
    ['Local Authorities/1980.fgb',                          'data/maps/local-government/ROI_Local_Authorities_1980.fgb'],
    ['Local Authorities/1985.fgb',                          'data/maps/local-government/ROI_Local_Authorities_1985.fgb'],
    ['Local Authorities/1986.fgb',                          'data/maps/local-government/ROI_Local_Authorities_1986.fgb'],
    ['Local Authorities/1994.fgb',                          'data/maps/local-government/ROI_Local_Authorities_1994.fgb'],
    // ROI EDs — replace size-mismatched versions
    ['EDs/Wards_DEDs_Connacht_1986.fgb',                    'data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Connacht_1986.fgb'],
    ['EDs/Wards_DEDs_Leinster_1971.fgb',                    'data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Leinster_1971.fgb'],
    ['EDs/Wards_DEDs_Leinster_1977.fgb',                    'data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Leinster_1977.fgb'],
    ['EDs/Wards_DEDs_Munster_1971.fgb',                     'data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Munster_1971.fgb'],
    // ROI EDs — NEW files (not yet on R2)
    ['EDs/DEDs_Connacht_1919.fgb',                          'data/maps/electoral-divisions/DEDs_Connacht_1919.fgb'],
    ['EDs/DEDs_Ulster_1921.fgb',                            'data/maps/electoral-divisions/DEDs_Ulster_1921.fgb'],
    ['EDs/Files already on the site/Wards_DEDs_Munster_1983.fgb', 'data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Munster_1983.fgb'],
];

async function head(key) {
    try {
        const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return r.ContentLength;
    } catch { return null; }
}
async function put(key, body, ct) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }));
}

let done = 0, skipped = 0, failed = 0;
for (const [rel, key] of MAP) {
    const local = ZIP_ROOT + '/' + rel;
    if (!existsSync(local)) {
        console.log(`SKIP missing in zip: ${rel}`);
        continue;
    }
    const localBytes = statSync(local).size;
    const remoteBytes = await head(key);
    if (remoteBytes === localBytes) {
        skipped++;
        console.log(`= already current: ${key} (${(localBytes/1e6).toFixed(2)} MB)`);
        continue;
    }
    try {
        const body = readFileSync(local);
        process.stdout.write(`+ ${key} (${(body.length/1e6).toFixed(2)} MB): base...`);
        await put(key, body, 'application/octet-stream');
        process.stdout.write(' gz...');
        await put(key + '.gz', gzipSync(body, { level: 6 }), 'application/octet-stream');
        console.log(' done');
        done++;
    } catch (e) {
        console.log(' FAIL', String(e).slice(0, 100));
        failed++;
    }
}
console.log(`\nuploaded ${done}, skipped ${skipped}, failed ${failed}`);
