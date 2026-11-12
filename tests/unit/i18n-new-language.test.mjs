/**
 * Acceptance test A5, "a new language needs only translation files": the build half. A dummy
 * fourth language (tests/i18n/fixtures/new-language.json) is added to a copy of the registry and
 * the string files, as an entry and a column and nothing else, and scripts/i18n/build-i18n.mjs
 * builds it unchanged: its language file, its names file, its review list and the runtime's table
 * all appear, and English, Irish and Ulster-Scots come out byte for byte as committed. The page
 * half (it renders) is tests/i18n/new-language.spec.cjs.
 *
 *   node --test tests/unit/i18n-new-language.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { NEW_LANGUAGE, REPO_ROOT, buildNewLanguageTree } from '../i18n/new-language-fixture.mjs';

const dir = buildNewLanguageTree();
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** @type {(root: string, rel: string) => string} */
const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const readJson = (/** @type {string} */ root, /** @type {string} */ rel) => JSON.parse(read(root, rel));
const code = NEW_LANGUAGE.code;

test('A5: English, Irish and Ulster-Scots build exactly as committed when a fourth language is added', () => {
  for (const file of ['en.json', 'ga.json', 'sco.json', 'names.ga.json', 'names.sco.json']) {
    assert.equal(read(dir, `site/assets/i18n/${file}`), read(REPO_ROOT, `site/assets/i18n/${file}`), file);
  }
  for (const file of ['strings-ga.tsv', 'strings-sco.tsv']) {
    assert.equal(read(dir, `data/i18n/review/${file}`), read(REPO_ROOT, `data/i18n/review/${file}`), file);
  }
});

test('A5: the new language gets its language file, names file and review list', () => {
  const file = readJson(dir, `site/assets/i18n/${code}.json`);
  const en = readJson(REPO_ROOT, 'site/assets/i18n/en.json');
  assert.equal(file._status, 'draft');
  assert.deepEqual(Object.keys(file._meta), ['language', 'bcp47', 'standard', 'reviewedBy', 'keys', 'of', 'note']);
  assert.equal(file._meta.language, NEW_LANGUAGE.entry.englishName);
  assert.equal(file._meta.bcp47, NEW_LANGUAGE.entry.bcp47);
  assert.equal(file._meta.of, en._meta.keys);
  // Every fixture translation lands under the key its English has in en.json.
  /** @type {Record<string, string>} */
  const expected = {};
  for (const [key, english] of Object.entries(/** @type {Record<string, string>} */ (en.strings))) {
    const translation = NEW_LANGUAGE.translations[english];
    if (translation) expected[key] = translation;
  }
  assert.ok(Object.keys(expected).length >= 5, 'the fixture translates strings the files hold');
  assert.deepEqual(file.strings, expected);
  assert.equal(file._meta.keys, Object.keys(expected).length);
  assert.equal(expected['chrome.language'], 'Langue', 'a line with its own key reads its new column too');

  const names = readJson(dir, `site/assets/i18n/names.${code}.json`);
  assert.deepEqual(names.names, {});
  const review = read(dir, `data/i18n/review/strings-${code}.tsv`).split('\n');
  assert.equal(review[0], `key\tsurface\tenglish\tdraft_${code}\tstatus`);
  assert.equal(review.length, read(REPO_ROOT, 'data/i18n/review/strings-ga.tsv').split('\n').length);
  const coverage = readJson(dir, 'data/i18n/review/coverage.json');
  assert.deepEqual(Object.keys(coverage.interfaceStrings), ['total', 'ga', 'sco', code]);
  assert.equal(coverage.interfaceStrings[code], Object.keys(expected).length);
  assert.ok(read(dir, 'data/i18n/review/map-names.tsv').startsWith(`map_id\tenglish\tdraft_ga\tdraft_sco\tdraft_${code}\tstatus\tdescription\n`));
});

test('A5: the runtime table lists the new language with its locale and direction', () => {
  const table = readJson(dir, 'site/assets/i18n/languages.json');
  assert.equal(table.source, 'en');
  assert.deepEqual(Object.keys(table.languages), ['en', 'ga', 'sco', code]);
  assert.deepEqual(table.languages[code], {
    name: NEW_LANGUAGE.entry.name, htmlLang: NEW_LANGUAGE.entry.bcp47, locale: NEW_LANGUAGE.entry.locale,
    dir: 'rtl', translatesDates: true, placeNameFields: false
  });
});

test('A5: the built tree is up to date by --check, and a file without the column fails it', () => {
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/i18n/build-i18n.mjs'), '--root', dir, '--check'], { cwd: REPO_ROOT, stdio: 'pipe' });
  assert.ok(existsSync(path.join(dir, `site/assets/i18n/${code}.json`)));
  // The committed files lack the new column: against the fixture registry they fail, by header.
  const broken = buildNewLanguageTree();
  try {
    const file = path.join(broken, 'data/i18n/strings/chrome.txt');
    const original = read(REPO_ROOT, 'data/i18n/strings/chrome.txt');
    writeFileSync(file, original);
    assert.throws(
      () => execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/i18n/build-i18n.mjs'), '--root', broken, '--check'], { cwd: REPO_ROOT, stdio: 'pipe' }),
      (/** @type {{ stderr: Buffer }} */ error) => new RegExp(`chrome\\.txt:1: no column for ${code}`).test(String(error.stderr))
    );
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
});
