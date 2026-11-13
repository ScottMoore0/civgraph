// @ts-check
/**
 * One local file to one key of the S3 blob store, the way the upload scripts send files: a file
 * of PART_SIZE bytes or fewer in one PUT; a bigger one as a multipart upload in PART_SIZE parts,
 * read one part at a time (the store aborts the upload if any part fails, and the client resends
 * a failed request up to its maxAttempts). Large single PUTs fail on some networks with TLS
 * bad_record_mac; parts of 8 MiB go through. Used by r2-upload-pmtiles and r2-upload-files.
 */
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';

/** Bytes in each part of a multipart upload; a file no bigger goes up in one PUT. */
export const PART_SIZE = 8 * 1024 * 1024;

/**
 * @param {import('../../packages/storage/src/s3.mjs').S3BlobStore} store
 * @param {string} key
 * @param {string} filePath
 * @param {number} bytes  the file's size
 * @param {{ contentType: string, contentEncoding?: string }} headers
 */
export async function putLocalFile(store, key, filePath, bytes, headers) {
  if (bytes <= PART_SIZE) {
    await store.put(key, readFileSync(filePath), headers);
    return;
  }
  const handle = await open(filePath, 'r');
  try {
    const read = async (/** @type {number} */ offset, /** @type {number} */ length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    };
    await store.putMultipart(key, { size: bytes, read }, { ...headers, partSize: PART_SIZE });
  } finally {
    await handle.close();
  }
}
