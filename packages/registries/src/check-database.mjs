#!/usr/bin/env node
/**
 * Checks the source and provider files of data/database/ against their schemas and rules
 * (database.mjs, REG-6). Exit 1 on any error.
 *
 *   node packages/registries/src/check-database.mjs     (npm run check:database-schemas)
 */
import { DATABASE_FILES, databaseFileErrors } from './database.mjs';
import { REPO_ROOT } from './index.mjs';

let failed = false;
for (const name of Object.keys(DATABASE_FILES)) {
  const errors = databaseFileErrors(name, REPO_ROOT);
  if (errors.length) {
    failed = true;
    console.error(`bad ${name}`);
    for (const error of errors.slice(0, 25)) console.error(`  ${error}`);
    if (errors.length > 25) console.error(`  ... ${errors.length - 25} more`);
  } else {
    console.log(`ok  ${name}`);
  }
}
if (failed) process.exit(1);
