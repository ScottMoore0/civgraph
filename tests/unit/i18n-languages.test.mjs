/**
 * The interface languages as data (rf9-i18n, acceptance test A5): the languages registry
 * (data/registries/languages.json) is valid and says exactly what the code it replaced said; the
 * string files are read by their #!columns header (scripts/i18n/string-files.mjs); the runtime's
 * table (site/assets/i18n/languages.json) is the registry's view; the shared formatter's source
 * locale is the registry's; and the i18n code is type-checked under strict.
 *
 *   node --test tests/unit/i18n-languages.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRegistry, registryErrors } from '../../packages/registries/src/index.mjs';
import { checkLanguages, languageCodes, languageFileMeta, runtimeLanguages, translatedLanguages } from '../../packages/registries/src/languages.mjs';
import { headerColumns, parseStringFile, withColumn } from '../../scripts/i18n/string-files.mjs';
import { siteLocale } from '../../packages/core/src/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = loadRegistry('languages');
const readJson = (/** @type {string} */ rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

test('languages: valid, and a broken registry is caught', () => {
  assert.deepEqual(registryErrors('languages', registry), []);
  const noLocale = structuredClone(registry);
  delete (/** @type {Record<string, unknown>} */ (noLocale.languages.ga)).locale;
  assert.ok(registryErrors('languages', noLocale).length > 0);
  const badSource = structuredClone(registry);
  badSource.source = 'fr';
  assert.deepEqual(checkLanguages(badSource), ['source fr is not a listed language']);
  const reviewedSource = structuredClone(registry);
  reviewedSource.languages.en.reviewedBy = 'someone';
  assert.deepEqual(checkLanguages(reviewedSource), ['en: the source language is not reviewed']);
  const noReviewer = structuredClone(registry);
  delete noReviewer.languages.sco.reviewedBy;
  assert.deepEqual(checkLanguages(noReviewer), ['sco: reviewedBy must be given (null while the translations are drafts)']);
});

test('languages: the lists the code held before (build-i18n.mjs LANGS and META, i18n.js LANGS and LABELS)', () => {
  assert.deepEqual(languageCodes(registry), ['en', 'ga', 'sco']);
  assert.deepEqual(translatedLanguages(registry), ['ga', 'sco']);
  // scripts/i18n/build-i18n.mjs META, 12 Nov 2026, in its key order.
  assert.deepEqual(languageFileMeta(registry, 'en'), { language: 'English', bcp47: 'en-GB', role: 'source and fallback for every key' });
  assert.deepEqual(Object.keys(languageFileMeta(registry, 'ga')), ['language', 'bcp47', 'standard', 'terminology', 'reviewedBy']);
  assert.deepEqual(Object.keys(languageFileMeta(registry, 'sco')), ['language', 'bcp47', 'standard', 'reviewedBy']);
  // The built files carry exactly these (the counts and note follow).
  for (const code of languageCodes(registry)) {
    const meta = readJson(`site/assets/i18n/${code}.json`)._meta;
    const own = languageFileMeta(registry, code);
    assert.deepEqual(Object.fromEntries(Object.entries(meta).slice(0, Object.keys(own).length)), own, code);
  }
  // site/assets/i18n/i18n.js LANGS and LABELS, 12 Nov 2026; the runtime set dates in Irish only
  // and read Irish place names from the tiles.
  const before = {
    en: { htmlLang: null, locale: 'en-GB', name: 'English' },
    ga: { htmlLang: 'ga', locale: 'ga-IE', name: 'Gaeilge' },
    sco: { htmlLang: 'sco-ulster', locale: 'en-GB', name: 'Ulstèr-Scotch' }
  };
  const table = runtimeLanguages(registry);
  assert.equal(table.source, 'en');
  for (const [code, old] of Object.entries(before)) {
    const now = /** @type {import('../../packages/registries/src/languages.mjs').RuntimeLanguage} */ (table.languages[code]);
    assert.deepEqual({ htmlLang: now.htmlLang, locale: now.locale, name: now.name }, old, code);
    assert.equal(now.dir, 'ltr');
    assert.equal(now.translatesDates, code === 'ga', code);
    assert.equal(now.placeNameFields, code === 'ga', code);
  }
});

test('languages: the runtime table is the registry view, and the formatter source locale is the registry one', () => {
  const file = readJson('site/assets/i18n/languages.json');
  const { source, languages } = file;
  assert.deepEqual({ source, languages }, runtimeLanguages(registry));
  const g = /** @type {{ civgraphI18n?: unknown }} */ (globalThis);
  assert.equal(g.civgraphI18n, undefined);
  assert.equal(siteLocale(), registry.languages[registry.source]?.locale);
});

test('string files: every file has a #!columns header naming every language', () => {
  const dir = path.join(ROOT, 'data/i18n/strings');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const parsed = parseStringFile(readFileSync(path.join(dir, file), 'utf8'), { where: file, languages: languageCodes(registry), source: registry.source });
    assert.deepEqual(parsed.problems, [], file);
    assert.deepEqual(parsed.columns, ['en', 'ga', 'sco'], file);
    assert.ok(parsed.rows.length > 0, file);
  }
});

test('string files: columns are read by the header, and every row must have them', () => {
  const opts = { where: 'x.txt', languages: ['en', 'ga', 'sco'], source: 'en' };
  // Any column order: the header says which is which.
  const swapped = parseStringFile('# c\n#!columns sco ¦ en ¦ ga\nHame ¦ Home ¦ Baile\n@k.x  ¦ Maps ¦ Léarscáileanna\n', opts);
  assert.deepEqual(swapped.problems, []);
  assert.deepEqual(swapped.rows, [
    { key: null, text: { sco: 'Hame', en: 'Home', ga: 'Baile' }, line: 3 },
    { key: 'k.x', text: { sco: '', en: 'Maps', ga: 'Léarscáileanna' }, line: 4 }
  ]);
  assert.deepEqual(parseStringFile('#!columns en ¦ ga ¦ sco\nHome ¦ Baile\n', opts).problems, ['x.txt:2: expected 3 columns (en ¦ ga ¦ sco) separated by ¦, found 2']);
  assert.deepEqual(parseStringFile('Home ¦ Baile ¦ Hame\n', opts).problems, ['x.txt:1: no #!columns header before the first string (e.g. "#!columns en ¦ ga ¦ sco")']);
  assert.deepEqual(parseStringFile('#!columns en ¦ ga\nHome ¦ Baile\n', opts).problems, ['x.txt:1: no column for sco']);
  assert.deepEqual(parseStringFile('#!columns en ¦ ga ¦ sco ¦ xx\n', opts).problems, ['x.txt:1: column xx is not a language in data/registries/languages.json']);
  assert.deepEqual(parseStringFile('#!columns en ¦ ga ¦ ga ¦ sco\n', opts).problems, ['x.txt:1: column ga named twice']);
  assert.deepEqual(parseStringFile('#!columns en ¦ ga ¦ sco\nA ¦ B ¦ C\n#!columns en ¦ ga ¦ sco\n', opts).problems, ['x.txt:3: a second #!columns header (the first is line 1)']);
  assert.deepEqual(headerColumns('ga ¦ sco', ['en', 'ga', 'sco'], 'en').problems, ['no column for en (the source language)']);
  // A fixed-format file (the map-name glossary) gives its columns instead of a header.
  assert.deepEqual(parseStringFile('Wards ¦ Bardaí\n', { where: 'g.txt', languages: ['en', 'ga'], source: 'en', columns: ['en', 'ga'] }).rows,
    [{ key: null, text: { en: 'Wards', ga: 'Bardaí' }, line: 1 }]);
});

test('string files: withColumn adds a language to the header and every row, and nothing else', () => {
  const opts = { where: 'x.txt', languages: ['en', 'ga', 'sco'], source: 'en' };
  const text = '#!columns en ¦ ga ¦ sco\n# a comment\n\nHome ¦ Baile ¦ Hame\n@chrome.language Language ¦ Teanga ¦ Leid\nMaps ¦ Léarscáileanna ¦\n';
  const out = withColumn(text, 'xx', { ...opts, cell: (row) => (row.text.en === 'Maps' ? 'Cartes' : '') });
  assert.equal(out, '#!columns en ¦ ga ¦ sco ¦ xx\n# a comment\n\nHome ¦ Baile ¦ Hame ¦\n@chrome.language Language ¦ Teanga ¦ Leid ¦\nMaps ¦ Léarscáileanna ¦ ¦ Cartes\n');
  const reread = parseStringFile(out, { ...opts, languages: ['en', 'ga', 'sco', 'xx'] });
  assert.deepEqual(reread.problems, []);
  assert.deepEqual(reread.rows.map((r) => r.text.xx), ['', '', 'Cartes']);
  assert.equal(reread.rows[1]?.key, 'chrome.language');
  assert.throws(() => withColumn(out, 'xx', { ...opts, languages: ['en', 'ga', 'sco', 'xx'] }), /already has a xx column/);
});

test('the i18n code is type-checked under strict', () => {
  const pipeline = readJson('config/tsconfig.pipeline.json');
  assert.ok(pipeline.include.includes('../scripts/i18n/**/*.mjs'));
  assert.ok(!(pipeline.exclude || []).some((/** @type {string} */ p) => p.includes('scripts/i18n')), 'no scripts/i18n file is excluded');
  for (const config of ['config/tsconfig.ui.json', 'config/tsconfig.ui-strict.json']) {
    assert.ok(readJson(config).include.includes('../site/assets/i18n/i18n.js'), config);
  }
});
