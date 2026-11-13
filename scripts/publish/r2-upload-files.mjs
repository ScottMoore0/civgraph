#!/usr/bin/env node
/**
 * Upload one or more FlatGeobuf files to R2 (boundaries-data) via the S3 endpoint, as
 * application/octet-stream, the type data.civgraph.net already serves .fgb files with.
 * Each pair is a local file and the key it replaces. Run only at publish time; --dry-run
 * lists what would be sent. The S3 calls go through the storage adapter's S3 blob store
 * (packages/storage/src/s3.mjs): a file of 8 MiB or less in one PUT, a bigger one as a multipart
 * upload in 8 MiB parts (r2-put-file.mjs).
 *
 *   node scripts/publish/r2-upload-files.mjs <file>=<r2/key> [<file>=<r2/key> ...] [--dry-run]
 */
import { existsSync, statSync } from 'fs';
import { openS3BlobStore } from '../../packages/storage/src/s3.mjs';
import { r2CredentialsOrExit, s3ClientOptions } from './r2-env.mjs';
import { putLocalFile } from './r2-put-file.mjs';

const DRY = process.argv.includes('--dry-run');
const parsed = process.argv.slice(2).filter((a) => a !== '--dry-run').map((a) => {
    const i = a.indexOf('=');
    return i > 0 ? { file: a.slice(0, i), key: a.slice(i + 1).replace(/^\/+/, '') } : null;
});
const pairs = parsed.filter((p) => p !== null);
if (!parsed.length || pairs.length !== parsed.length || pairs.some((p) => !p.key.endsWith('.fgb'))) {
    console.error('Usage: node scripts/publish/r2-upload-files.mjs <file>=<r2/key.fgb> [...] [--dry-run]');
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
const R2 = r2CredentialsOrExit();
const store = await openS3BlobStore({ bucket: R2.bucket, clientOptions: s3ClientOptions(R2, { maxAttempts: 5 }) });
for (const p of pairs) {
    const bytes = statSync(p.file).size;
    await putLocalFile(store, p.key, p.file, bytes, { contentType: 'application/octet-stream' });
    console.log(`${p.key} ${(bytes / 1e6).toFixed(2)} MB`);
}
console.log(`Uploaded ${pairs.length} file(s).`);
