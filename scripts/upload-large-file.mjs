import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { readFileSync, statSync, openSync, readSync, closeSync } from 'fs';

const [, , LOCAL, KEY] = process.argv;
if (!LOCAL || !KEY) { console.error('Usage: node upload-large-file.mjs <local> <key>'); process.exit(1); }
const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_S3_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
const PART_SIZE = 8 * 1024 * 1024;  // 8 MB parts to avoid SSL drops
async function withRetries(fn, attempts = 6) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); }
        catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 800 * (i+1))); }
    }
    throw lastErr;
}

const size = statSync(LOCAL).size;
console.log(`Multipart uploading ${LOCAL} (${(size/1e6).toFixed(1)} MB) → s3://${BUCKET}/${KEY}`);

const init = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: KEY, ContentType: 'application/octet-stream' }));
const uploadId = init.UploadId;
const fd = openSync(LOCAL, 'r');
const parts = [];
try {
    let partNumber = 1;
    let offset = 0;
    while (offset < size) {
        const len = Math.min(PART_SIZE, size - offset);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, offset);
        const r = await withRetries(() => s3.send(new UploadPartCommand({
            Bucket: BUCKET, Key: KEY, UploadId: uploadId,
            PartNumber: partNumber, Body: buf,
        })));
        parts.push({ ETag: r.ETag, PartNumber: partNumber });
        console.log(`  part ${partNumber}: ${(len/1e6).toFixed(1)} MB`);
        offset += len;
        partNumber++;
    }
    await s3.send(new CompleteMultipartUploadCommand({
        Bucket: BUCKET, Key: KEY, UploadId: uploadId,
        MultipartUpload: { Parts: parts },
    }));
    console.log(`Done. ${parts.length} parts uploaded.`);
} catch (e) {
    console.error('Failed:', e);
    await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: KEY, UploadId: uploadId }));
    process.exit(1);
} finally {
    closeSync(fd);
}
