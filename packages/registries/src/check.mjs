#!/usr/bin/env node
/**
 * Validate every registry (schema and checks): node registries/check.mjs [name ...]
 * Exit 1 on the first invalid one. The unit tests (tests/unit/registries-*.test.mjs) run the
 * same checks inside npm run test:unit; this is the quick form for an editor of a registry.
 */
import { REGISTRY_NAMES, loadRegistry } from './index.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : REGISTRY_NAMES;
let failed = false;
for (const name of names) {
  try {
    loadRegistry(name);
    console.log(`ok  ${name}`);
  } catch (error) {
    failed = true;
    console.error(`bad ${/** @type {Error} */ (error).message}`);
  }
}
process.exit(failed ? 1 : 0);
