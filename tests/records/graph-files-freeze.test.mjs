// graph_files is frozen (scripts/records/graph-files-freeze.mjs): with a frozen copy, ingestGraph
// carries the table as it is, so the delta against that copy has no graph_files row even when the
// graph changed; the drift it reports names the files that changed, and the files built from them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../../scripts/records/db.mjs';
import { buildDelta } from '../../scripts/records/diff-load.mjs';
import { driftedFile, frozenSource, graphFilesRows } from '../../scripts/records/graph-files-freeze.mjs';
import { ingestGraph } from '../../scripts/records/ingest-graph.mjs';
import { REPO_ROOT } from '../../scripts/records/paths.mjs';

const TMP = path.join(REPO_ROOT, 'tmp', 'records', 'test-graph-files-freeze');

function graphTree(dir, entities) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'entity-shards'), { recursive: true });
  mkdirSync(path.join(dir, 'indexes', 'statements-by-subject-shards'), { recursive: true });
  writeFileSync(path.join(dir, 'entity-shards', 'entities-000.json'), JSON.stringify({ shard: 0, items: entities.map((id) => ({ id, label: id })) }));
  writeFileSync(path.join(dir, 'entity-shards', 'entities-001.json'), JSON.stringify({ shard: 1, items: [{ id: 'z', label: 'z' }] }));
  writeFileSync(path.join(dir, 'indexes', 'statements-by-subject-shards', 'statements-by-subject-000.json'),
    JSON.stringify({ items: Object.fromEntries(entities.map((id) => [id, [{ id: `s-${id}`, propertyId: 'p' }]])) }));
}

const rows = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  const out = db.prepare('SELECT file, part, keys, row_hash FROM graph_files ORDER BY file, part').all().map((r) => ({ ...r }));
  db.close();
  return out;
};

test('graph_files: a frozen copy is carried as it is; the delta has no graph_files row; drift is named', () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const A = path.join(TMP, 'loaded.sqlite');
  const B = path.join(TMP, 'next.sqlite');
  const C = path.join(TMP, 'fresh.sqlite');
  const treeA = path.join(TMP, 'graph-a');
  const treeB = path.join(TMP, 'graph-b');

  // What D1 holds: built from the go-live graph.
  graphTree(treeA, ['a', 'b']);
  const a = createDatabase(A);
  const builtA = ingestGraph(a, { graphDir: treeA });
  assert.equal(builtA.graphFiles.frozenFrom, null);
  a.prepare("INSERT INTO dataset (key, value) VALUES ('version', 'v1')").run();
  a.close();
  assert.equal(graphFilesRows(A), 3);
  assert.equal(frozenSource([path.join(TMP, 'missing.sqlite'), A]), A);

  // A later graph: an entity added. Carried, graph_files is A's, row for row.
  graphTree(treeB, ['a', 'b', 'c']);
  const b = createDatabase(B);
  const builtB = ingestGraph(b, { graphDir: treeB, frozenFrom: A });
  b.close();
  assert.equal(builtB.counts.graph_files, 3);
  assert.deepEqual(rows(B), rows(A));
  assert.deepEqual(builtB.graphFiles.drifted, ['entity-shards/entities-000.json', 'indexes/statements-by-subject-shards/statements-by-subject-000.json']);
  assert.equal(builtB.graphFiles.retired, 0);
  const lines = [];
  const delta = buildDelta({ toFile: B, fromFile: A, write: (s) => lines.push(s), version: 'v2', gitCommit: 't', loadedAt: 'now' });
  assert.deepEqual(delta.summary.graph_files, { deleted: 0, upserted: 0 });
  assert.ok(delta.summary.graph_entities.upserted > 0, 'the graph change itself is in the delta');

  // Without a frozen copy the table follows the graph, and the delta would carry it.
  const c = createDatabase(C);
  ingestGraph(c, { graphDir: treeB });
  c.close();
  assert.notDeepEqual(rows(C), rows(A));
  const fresh = buildDelta({ toFile: C, fromFile: A, write: () => {}, version: 'v2', gitCommit: 't', loadedAt: 'now' });
  assert.ok(fresh.summary.graph_files.upserted > 0);

  // The checks skip a drifted file and the files assembled from drifted ones.
  const drifted = new Set(builtB.graphFiles.drifted);
  assert.equal(driftedFile('entity-shards/entities-000.json', drifted), true);
  assert.equal(driftedFile('entity-shards/entities-001.json', drifted), false);
  assert.equal(driftedFile('indexes/statements-by-subject-map.json', drifted), true);
  assert.equal(driftedFile('indexes/reverse-entity-value-map.json', drifted), false);
  assert.equal(driftedFile('entity-shards/entities-000.json', new Set()), false);
  rmSync(TMP, { recursive: true, force: true });
});
