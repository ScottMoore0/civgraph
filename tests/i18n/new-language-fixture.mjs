/**
 * Acceptance test A5's fixture tree: this checkout's languages registry and string files with a
 * dummy fourth language (tests/i18n/fixtures/new-language.json) added the way a translator adds
 * one, as a registry entry and a column, and nothing else. The map-name overlay is copied as it
 * is. scripts/i18n/build-i18n.mjs --root <dir> then builds the tree with no code change.
 *
 * Used by tests/unit/i18n-new-language.test.mjs (the build) and tests/i18n/new-language.spec.cjs
 * (the page).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageCodes } from '../../packages/registries/src/languages.mjs';
import { withColumn } from '../../scripts/i18n/string-files.mjs';

/** @typedef {import('../../packages/registries/src/languages.mjs').LanguagesRegistry} LanguagesRegistry */
/** @typedef {{ code: string, entry: LanguagesRegistry['languages'][string], translations: Record<string, string> }} NewLanguage */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** @type {NewLanguage} */
export const NEW_LANGUAGE = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tests/i18n/fixtures/new-language.json'), 'utf8'));

/**
 * Writes the fixture tree into a new temporary folder and builds it; returns the folder.
 * @returns {string}
 */
export function buildNewLanguageTree() {
  const dir = mkdtempSync(path.join(tmpdir(), 'civgraph-a5-'));
  /** @type {LanguagesRegistry} */
  const registry = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/registries/languages.json'), 'utf8'));
  const before = languageCodes(registry);
  registry.languages[NEW_LANGUAGE.code] = NEW_LANGUAGE.entry;
  mkdirSync(path.join(dir, 'data/registries'), { recursive: true });
  writeFileSync(path.join(dir, 'data/registries/languages.json'), `${JSON.stringify(registry, null, 1)}\n`);

  const strings = 'data/i18n/strings';
  mkdirSync(path.join(dir, strings), { recursive: true });
  for (const file of readdirSync(path.join(REPO_ROOT, strings)).filter((f) => f.endsWith('.txt'))) {
    const where = `${strings}/${file}`;
    const text = readFileSync(path.join(REPO_ROOT, where), 'utf8');
    const cell = (/** @type {import('../../scripts/i18n/string-files.mjs').StringRow} */ row) => NEW_LANGUAGE.translations[row.text[registry.source] || ''] || '';
    writeFileSync(path.join(dir, where), withColumn(text, NEW_LANGUAGE.code, { where, languages: before, source: registry.source, cell }));
  }
  copyFileSync(path.join(REPO_ROOT, 'data/i18n/map-names.overlay.json'), path.join(dir, 'data/i18n/map-names.overlay.json'));

  execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/i18n/build-i18n.mjs'), '--root', dir], { cwd: REPO_ROOT, stdio: 'pipe' });
  return dir;
}
