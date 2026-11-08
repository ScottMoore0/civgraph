// /data/maps/[[path]]: the R2 map-data Function. A request with no path after /data/maps/ used to
// throw (context.params.path was undefined) and answer 500; it now answers 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { onRequestGet } = await import(pathToFileURL(path.resolve('functions/data/maps/[[path]].js')).href);

/** A bucket holding one JSON object. */
const bucket = {
  /** @param {string} key */
  async get(key) {
    return key === 'data/maps/physical/a b.json' ? { body: '{"ok":true}' } : null;
  },
};

/** @param {unknown} pathParam */
const context = (pathParam) => ({
  request: new Request('https://civgraph.net/data/maps/'),
  env: { MAPS_BUCKET: bucket },
  params: pathParam === undefined ? {} : { path: pathParam },
  next: () => new Response('next', { status: 299 }),
});

test('/data/maps/ with no path answers 404, not 500', async () => {
  assert.equal((await onRequestGet(context(undefined))).status, 404);
  assert.equal((await onRequestGet(context([]))).status, 404);
  assert.equal((await onRequestGet(context(''))).status, 404);
});

test('/data/maps/<key> still serves the object, percent-decoded', async () => {
  const res = await onRequestGet(context(['physical', 'a%20b.json']));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"ok":true}');
  assert.equal((await onRequestGet(context(['physical', 'missing.json']))).status, 404);
});
