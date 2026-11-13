#!/usr/bin/env node
/**
 * Keep the ledger of published person addresses (data/elections/persons/published-person-addresses.json,
 * scripts/lib/person-address-ledger.mjs) up to date with a records build.
 *
 *   node scripts/build/build-person-address-ledger.mjs           add what the build publishes (write)
 *   node scripts/build/build-person-address-ledger.mjs --check   fail if a ledger key or id no longer
 *                                                                answers as published, or the build
 *                                                                publishes keys or ids the ledger lacks
 *   ... [--db FILE]                                              another records build
 *
 * Run it after each records build and before the publish, then commit the ledger with the
 * rebuild: the next build then gives every key back to its person. It only adds entries.
 * The same check runs in the records check (tests/records/published-person-addresses.test.mjs).
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordPaths } from '../../packages/config/src/node.mjs';
import { openSqlite } from '../../packages/storage/src/sqlite.mjs';
import { LEDGER_DESCRIPTION, LEDGER_FILE, growLedger, ledgerFailures, ledgerText, personKeepOf, publishedFromRows, readLedger } from '../lib/person-address-ledger.mjs';

const args = process.argv.slice(2);
const option = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const CHECK = args.includes('--check');
const DB_FILE = path.resolve(option('--db') || recordPaths().RECORDS_DB);

if (!existsSync(DB_FILE)) {
  console.error(`person-address-ledger: no records build at ${DB_FILE}`);
  process.exit(1);
}
const store = openSqlite(DB_FILE, { readOnly: true });
/** @typedef {import('../../packages/storage/src/store.js').SqlValue} SqlValue */
// each query's rows have exactly the columns it selects
const cards = /** @type {{ id: SqlValue, slug: SqlValue }[]} */ (await store.all('SELECT id, slug FROM person_cards ORDER BY id'));
const aliasRows = /** @type {{ alias: SqlValue, slug: SqlValue }[]} */ (await store.all('SELECT alias, slug FROM person_aliases ORDER BY alias'));
const published = publishedFromRows(cards, aliasRows);
const ledger = readLedger();
const grown = growLedger(ledger, published.items);

if (CHECK) {
  const failures = ledgerFailures(ledger, { ...published, keepOf: personKeepOf() });
  for (const line of failures.slice(0, 40)) console.error(`  ${line}`);
  if (failures.length) console.error(`person-address-ledger: ${failures.length} published address(es) no longer answer as published`);
  if (grown.addedAliases || grown.addedIds) console.error(`person-address-ledger: the build publishes ${grown.addedAliases} name key(s) and ${grown.addedIds} id(s) the ledger lacks; run node scripts/build/build-person-address-ledger.mjs and commit the ledger`);
  if (failures.length || grown.addedAliases || grown.addedIds) process.exit(1);
  console.log(`person-address-ledger: OK (${Object.keys(ledger.aliases).length} name keys, ${ledger.ids.length} ids answer as published)`);
} else {
  writeFileSync(LEDGER_FILE, ledgerText({ ...grown.ledger, description: LEDGER_DESCRIPTION }));
  console.log(`person-address-ledger: ${grown.addedAliases} name key(s) and ${grown.addedIds} id(s) added; ${Object.keys(grown.ledger.aliases).length} keys, ${grown.ledger.ids.length} ids (${path.relative(process.cwd(), LEDGER_FILE)})`);
}
