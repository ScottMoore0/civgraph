/**
 * The BlobStore over a folder on disk (packages/storage/src/blob.js): for tests, tools and the
 * scripts that will read R2-shaped data locally (storage slice ST-7). A key is a path under the
 * folder ('data/maps/x.json' is <dir>/data/maps/x.json); a key's content type and metadata, when
 * it has any, sit beside it under <dir>/.blob-meta/<key>.json, which listings never show.
 *
 * Node only (node:fs), so it is not part of the runtime entry (index.js).
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertBlobStore, listPage } from './blob.js';

const META = '.blob-meta';

/**
 * @param {string} key
 * @returns {string[]}
 */
function segments(key) {
  const parts = String(key).split('/');
  if (!key || parts.some((p) => p === '' || p === '.' || p === '..') || key.includes('\0') || parts[0] === META) {
    throw new TypeError(`fsBlobStore: not a usable key: ${JSON.stringify(key)}`);
  }
  return parts;
}

/**
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<string[]>}
 */
async function walk(root, rel = '') {
  /** @type {string[]} */
  const out = [];
  let entries;
  try { entries = await readdir(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const key = rel ? `${rel}/${entry.name}` : entry.name;
    if (!rel && entry.name === META) continue;
    if (entry.isDirectory()) out.push(...await walk(root, key));
    else if (entry.isFile()) out.push(key);
  }
  return out;
}

/**
 * @param {string} dir  the folder that holds the keys (created on the first put)
 * @returns {import('./blob.js').BlobStore}
 */
export function fsBlobStore(dir) {
  const root = path.resolve(dir);
  const file = (/** @type {string} */ key) => path.join(root, ...segments(key));
  const metaFile = (/** @type {string} */ key) => path.join(root, META, ...segments(key)) + '.json';
  /** @param {string} key @returns {Promise<{ contentType?: string, metadata?: Record<string, string> }>} */
  const readMeta = async (key) => {
    try { return JSON.parse(await readFile(metaFile(key), 'utf8')); } catch { return {}; }
  };
  /** @param {string} key */
  const bytes = async (key) => {
    try { return new Uint8Array(await readFile(file(key))); } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT' || /** @type {NodeJS.ErrnoException} */ (error).code === 'EISDIR') return null;
      throw error;
    }
  };
  return assertBlobStore({
    kind: 'fs',
    supports: () => true,
    async get(key) {
      const body = await bytes(key);
      if (!body) return null;
      return { body, size: body.byteLength, etag: null, contentType: (await readMeta(key)).contentType ?? null };
    },
    async text(key) {
      const body = await bytes(key);
      return body ? new TextDecoder().decode(body) : null;
    },
    async json(key) {
      const body = await bytes(key);
      return body ? JSON.parse(new TextDecoder().decode(body)) : null;
    },
    async put(key, body, { contentType, metadata } = {}) {
      const target = file(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, typeof body === 'string' ? body : new Uint8Array(body instanceof Uint8Array ? body : body.slice(0)));
      if (contentType !== undefined || metadata !== undefined) {
        const meta = metaFile(key);
        await mkdir(path.dirname(meta), { recursive: true });
        await writeFile(meta, JSON.stringify({ ...(contentType !== undefined ? { contentType } : {}), ...(metadata !== undefined ? { metadata } : {}) }));
      }
    },
    async list(options = {}) {
      const keys = await walk(root);
      const page = listPage(keys, options, (key) => ({ key, size: null, uploaded: null, etag: null, metadata: null }));
      for (const entry of page.entries) {
        const info = await stat(file(entry.key));
        entry.size = info.size;
        entry.uploaded = info.mtime.toISOString();
        entry.metadata = (await readMeta(entry.key)).metadata ?? null;
      }
      return page;
    },
  });
}
