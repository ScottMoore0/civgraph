// Every person address the site has published still answers (data/elections/persons/
// published-person-addresses.json, scripts/lib/person-address-ledger.mjs): each name key with the
// person it was published for (or the person that person was merged into), each person id with
// its page or a merge to one. Read from the built records database; skipped when there is none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { ledgerFailures, personKeepOf, publishedFromRows, readLedger } from '../../scripts/lib/person-address-ledger.mjs';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const built = existsSync(DB);

test('every published person name key and id still answers as published', { skip: !built && 'no records build' }, () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const cards = db.prepare('SELECT id, slug FROM person_cards').all();
  const aliases = db.prepare('SELECT alias, slug FROM person_aliases').all();
  db.close();
  const ledger = readLedger();
  const failures = ledgerFailures(ledger, { ...publishedFromRows(cards, aliases), keepOf: personKeepOf() });
  assert.deepEqual(failures.slice(0, 20), [], `${failures.length} published address(es) no longer answer as published`);
});
