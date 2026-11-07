// The records API on this machine (scripts/records/local-api.mjs): the routes it answers, that
// scripts/dev/test-server.py passes it exactly those, and, with a records build, that it answers the
// party and person requests the map app makes (src/map/app/entity-bridge.js) from the build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, RECORDS_DB } from '@civgraph/loader/paths.mjs';
import { answerRecordApi, RECORD_API_ROUTES, recordApiRoute } from '@civgraph/loader/local-api.mjs';

const skip = !existsSync(RECORDS_DB) && 'no records build (npm run records:build)';

test('local-api: only the records routes, exactly', () => {
  assert.equal(recordApiRoute('/_api/parties'), 'parties');
  assert.equal(recordApiRoute('/_api/persons/'), 'persons');
  assert.equal(recordApiRoute('/_api/register-interests'), 'register-interests');
  for (const other of ['/_api/auth', '/_api/contributions', '/_api/search', '/_api/catalogue', '/_api/parties/x', '/api/parties', '/_api/partiesx']) {
    assert.equal(recordApiRoute(other), null, other);
  }
});

test('local-api: scripts/dev/test-server.py passes on the same routes', () => {
  const py = readFileSync(path.join(REPO_ROOT, 'scripts/dev/test-server.py'), 'utf8');
  const match = /_API_ROUTE = re\.compile\(r'\^\/_api\/\(([^)]+)\)/.exec(py);
  assert.ok(match, 'route pattern not found in test-server.py');
  assert.deepEqual(match[1].split('|').sort(), [...RECORD_API_ROUTES].sort());
});

test('local-api: other URLs, and a missing build, answer null', async () => {
  assert.equal(await answerRecordApi('/_api/auth'), null);
  assert.equal(await answerRecordApi('/_api/parties', { dbFile: path.join(REPO_ROOT, 'tmp/no-such-records.sqlite') }), null);
});

test('local-api: party and person requests answered from the build', { skip }, async () => {
  const list = await answerRecordApi('/_api/parties');
  assert.equal(list.status, 200);
  const { items } = await list.json();
  assert.ok(items.length > 100, 'party list');
  const one = await answerRecordApi(`/_api/parties?slug=${encodeURIComponent(items[0].slug)}`);
  assert.equal(one.status, 200);
  assert.equal((await one.json()).item.slug, items[0].slug);
  const people = await answerRecordApi('/_api/persons?q=Martin&limit=2');
  assert.equal(people.status, 200);
  const post = await answerRecordApi('/_api/parties', { method: 'POST' });
  assert.equal(post.status, 405);
});
