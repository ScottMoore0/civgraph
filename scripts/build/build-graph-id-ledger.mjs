#!/usr/bin/env node
/**
 * Keep the ledger of published graph ids (data/elections/published-graph-ids.json,
 * scripts/lib/graph-id-ledger.mjs) up to date with a records build.
 *
 *   node scripts/build/build-graph-id-ledger.mjs           add the contest, election and person ids
 *                                                          the build publishes (write)
 *   node scripts/build/build-graph-id-ledger.mjs --check   fail if an id of the ledger no longer
 *                                                          answers (neither in the graph nor an
 *                                                          alias: key), or the build publishes ids
 *                                                          the ledger lacks
 *   ... [--db FILE]                                        another records build
 *
 * Run it after each records build (with the graph) and before the publish, then commit the
 * ledger with the rebuild. It only adds entries. The same check runs in the records check
 * (tests/records/published-graph-ids.test.mjs).
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordPaths } from '../../packages/config/src/node.mjs';
import { openSqlite } from '../../packages/storage/src/sqlite.mjs';
import { GRAPH_LEDGER_DESCRIPTION, GRAPH_LEDGER_FILE, PUBLISHED_GRAPH_SQL, graphLedgerFailures, graphLedgerText, growGraphLedger, publishedGraphFromRows, readGraphLedger } from '../lib/graph-id-ledger.mjs';

const args = process.argv.slice(2);
const option = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const CHECK = args.includes('--check');
const DB_FILE = path.resolve(option('--db') || recordPaths().RECORDS_DB);

if (!existsSync(DB_FILE)) {
  console.error(`graph-id-ledger: no records build at ${DB_FILE}`);
  process.exit(1);
}
const store = openSqlite(DB_FILE, { readOnly: true });
const published = publishedGraphFromRows(await store.all(PUBLISHED_GRAPH_SQL.entities), await store.all(PUBLISHED_GRAPH_SQL.aliases));
if (!published.liveIds.size) {
  console.error(`graph-id-ledger: the records build at ${DB_FILE} has no graph (built with --skip graph?)`);
  process.exit(1);
}
const ledger = readGraphLedger();
const grown = growGraphLedger(ledger, published.entities);

if (CHECK) {
  const failures = graphLedgerFailures(ledger, published);
  for (const line of failures.slice(0, 40)) console.error(`  ${line}`);
  if (failures.length) console.error(`graph-id-ledger: ${failures.length} published graph id(s) no longer answer`);
  if (grown.added) console.error(`graph-id-ledger: the build publishes ${grown.added} graph id(s) the ledger lacks; run node scripts/build/build-graph-id-ledger.mjs and commit the ledger`);
  if (failures.length || grown.added) process.exit(1);
  const kept = published.entities.length;
  console.log(`graph-id-ledger: OK (${(Object.values(ledger.ids).reduce((n, m) => n + Object.keys(m).length, 0)).toLocaleString('en-GB')} published ids answer: ${kept.toLocaleString('en-GB')} in the graph, ${published.aliasOf.size.toLocaleString('en-GB')} aliases)`);
} else {
  writeFileSync(GRAPH_LEDGER_FILE, graphLedgerText({ ...grown.ledger, description: GRAPH_LEDGER_DESCRIPTION }));
  console.log(`graph-id-ledger: ${grown.added} id(s) added (${path.relative(process.cwd(), GRAPH_LEDGER_FILE)})`);
}
