#!/usr/bin/env node
/**
 * Add an empty column for a new interface language to every string file (acceptance test A5).
 *
 *   1. add the language to data/registries/languages.json (name, englishName, bcp47, locale, dir,
 *      reviewedBy: null);
 *   2. node scripts/i18n/add-language-column.mjs <code>     adds "¦ <code>" to each file's
 *      #!columns header and an empty cell to each row of data/i18n/strings/*.txt;
 *   3. fill the column in, then npm run i18n:build.
 *
 * The runtime, the formatter and the build need no change. The registry must already list the
 * language; the files must not have its column yet. Run where the data lander edits the files.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry } from '../../packages/registries/src/index.mjs';
import { languageCodes } from '../../packages/registries/src/languages.mjs';
import { withColumn } from './string-files.mjs';

const SRC_DIR = 'data/i18n/strings';
const code = String(process.argv[2] || '');
const registry = loadRegistry('languages');
const codes = languageCodes(registry);
if (!code || !codes.includes(code) || code === registry.source) {
  console.error(`usage: node scripts/i18n/add-language-column.mjs <code>, a language of data/registries/languages.json other than ${registry.source} (${codes.join(', ')})`);
  process.exit(1);
}
const before = codes.filter((c) => c !== code);
for (const file of readdirSync(SRC_DIR).filter((f) => f.endsWith('.txt')).sort()) {
  const where = path.posix.join(SRC_DIR, file);
  const text = readFileSync(where, 'utf8');
  writeFileSync(where, withColumn(text, code, { where, languages: before, source: registry.source }));
  console.log(`${where}: added the ${code} column`);
}
