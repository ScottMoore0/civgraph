// Every contest, election and person id the semantic graph has published still answers
// (data/elections/published-graph-ids.json, scripts/lib/graph-id-ledger.mjs): it is in the
// graph, or an alias:<id> key of graph_browse_keys names an entity that is; and through the
// graph API it answers with that entity. Read from the built records database; skipped when
// there is none, or when it was built without the graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { PUBLISHED_GRAPH_SQL, graphLedgerFailures, publishedGraphFromRows, readGraphLedger } from '../../scripts/lib/graph-id-ledger.mjs';
import { context, d1, installCaches } from './d1-shim.mjs';
import { resetDatasetMemo } from '../../packages/api/src/handlers/_records.js';
import * as graphApi from '../../packages/api/src/handlers/graph/index.js';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const built = existsSync(DB);

/** @returns {ReturnType<typeof publishedGraphFromRows>} */
function readPublished() {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return publishedGraphFromRows(db.prepare(PUBLISHED_GRAPH_SQL.entities).all(), db.prepare(PUBLISHED_GRAPH_SQL.aliases).all());
  } finally { db.close(); }
}

test('every published graph id still answers', { skip: !built && 'no records build' }, (t) => {
  const published = readPublished();
  if (!published.liveIds.size) { t.skip('the records build has no graph'); return; }
  const failures = graphLedgerFailures(readGraphLedger(), published);
  assert.deepEqual(failures.slice(0, 20), [], `${failures.length} published graph id(s) no longer answer`);
});

test('the graph API answers a retired id with the entity it became', { skip: !built && 'no records build' }, async (t) => {
  const published = readPublished();
  const [old, now] = [...published.aliasOf].find(([id]) => id.startsWith('cg:contest:')) || [];
  if (!old || !now) { t.skip('no retired contest id in this build'); return; }
  const env = { ELECTIONS_DB: d1(DB) };
  try {
    installCaches();
    resetDatasetMemo();
    const res = await graphApi.onRequestGet(context(`/_api/graph?entity=${encodeURIComponent(old)}`, env));
    assert.equal(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.equal(body.entityId, now);
    assert.equal(body.retiredId, old);
    assert.ok(body.summary, `${now} has a summary`);
  } finally {
    env.ELECTIONS_DB._db.close();
  }
});
