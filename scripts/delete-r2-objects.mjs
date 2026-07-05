#!/usr/bin/env node
// Delete R2 objects by key (+ .br/.gz variants). Usage: node delete-r2-objects.mjs key1 key2 ...
import { readFileSync } from 'fs';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
try { for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); } } catch {}
const s3 = new S3Client({ region:'auto', endpoint:process.env.R2_S3_ENDPOINT,
  credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }, maxAttempts:5 });
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
for (const base of process.argv.slice(2)) for (const key of [base, base+'.br', base+'.gz']) {
  try { await s3.send(new DeleteObjectCommand({ Bucket:BUCKET, Key:key })); console.log('deleted', key); }
  catch (e) { console.log('FAIL', key, String(e.message||e)); }
}
