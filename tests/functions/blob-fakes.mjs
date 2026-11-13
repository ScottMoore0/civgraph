// Stand-ins for the Cloudflare R2 and KV bindings, answering as the real ones do (sorted keys,
// delimited and paged listings) and recording every call, for the blob store's tests
// (tests/functions/blob-store.test.mjs) and the handlers' tests.
import { listPage } from '../../packages/storage/src/blob.js';

/** An R2 bucket stand-in over a Map, listing as R2 does (sorted, delimited, paged); records every call. */
export function fakeR2() {
  const map = new Map();
  const calls = [];
  const object = (key, item) => ({
    key,
    size: item.bytes.byteLength,
    etag: `e-${key.length}`,
    httpEtag: `"e-${key.length}"`,
    uploaded: new Date(Date.UTC(2026, 10, 12)),
    httpMetadata: item.httpMetadata || {},
    customMetadata: item.customMetadata || {},
  });
  return {
    calls,
    map,
    async get(key, ...rest) {
      calls.push(['get', key, ...rest]);
      const item = map.get(key);
      if (!item) return null;
      return {
        ...object(key, item),
        body: item.bytes.slice(),
        async text() { return new TextDecoder().decode(item.bytes); },
        async json() { return JSON.parse(new TextDecoder().decode(item.bytes)); },
      };
    },
    async put(key, value, options) {
      calls.push(['put', key, typeof value === 'string' ? value : '(bytes)', options]);
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value instanceof Uint8Array ? value : value.slice(0));
      map.set(key, { bytes, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
      return null;
    },
    async list(options) {
      calls.push(['list', options]);
      const page = listPage([...map.keys()], options || {}, (key) => ({ key }));
      return {
        objects: page.entries.map((e) => object(e.key, map.get(e.key))),
        delimitedPrefixes: page.prefixes,
        truncated: page.truncated,
        ...(page.truncated ? { cursor: page.cursor } : {}),
      };
    },
  };
}

/** A KV namespace stand-in over a Map, listing as KV does (sorted, paged, no delimiter); records every call. */
export function fakeKV() {
  const map = new Map();
  const calls = [];
  return {
    calls,
    map,
    async get(key, type) {
      calls.push(type === undefined ? ['get', key] : ['get', key, type]);
      if (!map.has(key)) return null;
      const { value } = map.get(key);
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value, options) {
      calls.push(['put', key, options]);
      map.set(key, { value: typeof value === 'string' ? value : new TextDecoder().decode(value), metadata: options?.metadata });
    },
    async list(options) {
      calls.push(['list', options]);
      const { prefix = '', limit = 1000, cursor } = options || {};
      const page = listPage([...map.keys()], { prefix, limit, cursor }, (key) => ({ key }));
      return {
        keys: page.entries.map((e) => ({ name: e.key, ...(map.get(e.key).metadata !== undefined ? { metadata: map.get(e.key).metadata } : {}) })),
        list_complete: !page.truncated,
        ...(page.truncated ? { cursor: page.cursor } : {}),
      };
    },
  };
}
