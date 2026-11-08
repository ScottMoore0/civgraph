/**
 * The records loader opens databases through the storage adapter (REFACTOR-PLAN.md ST-7):
 *
 * - no module under scripts/records or scripts/lib imports node:sqlite except
 *   packages/storage/src/sqlite.mjs (a JSDoc type import is not an import);
 * - openSqliteHandle() opens read-only when asked and read-write by default, as new DatabaseSync did;
 * - the local records API (packages/loader/src/local-api.mjs), now on toD1(openSqlite()), answers
 *   every records route over a fresh migrated database exactly as it did over the D1 test shim.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { openSqliteHandle } from '../../packages/storage/src/sqlite.mjs';
import { createDatabase } from '../../packages/loader/src/db.mjs';
import { answerRecordApi, RECORD_API_ROUTES } from '../../packages/loader/src/local-api.mjs';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { d1 } from '../records/d1-shim.mjs';

test('node:sqlite is imported only by the storage adapter', () => {
  const found = [];
  for (const dir of ['scripts/records', 'scripts/lib', 'packages/loader/src', 'packages/schema/src']) {
    for (const name of readdirSync(path.join(REPO_ROOT, dir))) {
      if (!name.endsWith('.mjs')) continue;
      if (/from\s+['"]node:sqlite['"]|await\s+import\(\s*['"]node:sqlite['"]/.test(readFileSync(path.join(REPO_ROOT, dir, name), 'utf8'))) found.push(`${dir}/${name}`);
    }
  }
  assert.deepEqual(found, []);
});

test('openSqliteHandle: read-only when asked, read-write by default', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'civgraph-handle-'));
  const file = path.join(dir, 'x.sqlite');
  try {
    const rw = openSqliteHandle(file);
    rw.exec('CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1);');
    rw.close();
    const ro = openSqliteHandle(file, { readOnly: true });
    assert.equal(ro.prepare('SELECT a FROM t').get().a, 1);
    assert.throws(() => ro.exec('INSERT INTO t VALUES (2)'), /readonly/i);
    ro.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function viaShim(file, url) {
  const route = new URL(url, 'http://127.0.0.1').pathname.split('/')[2];
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'functions', '_api', route, 'index.js')).href);
  const handler = mod.onRequestGet || mod.onRequest;
  return handler({
    request: new Request(new URL(url, 'http://127.0.0.1').toString(), { method: 'GET', headers: {} }),
    env: { ELECTIONS_DB: d1(file) },
    params: {},
    waitUntil: () => {},
    next: async () => new Response('not found', { status: 404 }),
  });
}

test('local-api over the adapter answers as it did over the shim (fresh database)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'civgraph-localapi-'));
  const file = path.join(dir, 'records.sqlite');
  try {
    createDatabase(file).close();
    for (const route of RECORD_API_ROUTES) {
      for (const url of [`/_api/${route}`, `/_api/${route}?slug=nobody`]) {
        const a = await answerRecordApi(url, { dbFile: file });
        const b = await viaShim(file, url);
        assert.equal(a.status, b.status, url);
        assert.equal(await a.text(), await b.text(), url);
      }
    }
  } finally {
    // local-api keeps its store open for the process, as the dev server does; Windows then
    // refuses to delete the file, which is left in the OS temp folder.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* still open */ }
  }
});
