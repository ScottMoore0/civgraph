/**
 * The languages registry (data/registries/languages.json, acceptance test A5): the interface
 * languages and what each needs. Pure: the views take the loaded value, so the build
 * (scripts/i18n/build-i18n.mjs) and the runtime's generated table (site/assets/i18n/languages.json)
 * are computed by the same functions, and a test can hand them a fixture registry.
 */

/** @typedef {import('../../types/index.js').LanguagesRegistry} LanguagesRegistry */
/** @typedef {LanguagesRegistry['languages'][string]} Language */

/**
 * What a built language file's `_meta` says about its language, in the order the file writes it:
 * language, bcp47, then role, standard, terminology and reviewedBy where the registry gives them.
 * @typedef {{ language: string, bcp47: string, role?: string, standard?: string, terminology?: string, reviewedBy?: string | null }} LanguageFileMeta
 */

/**
 * One language as the runtime reads it (site/assets/i18n/languages.json).
 * @typedef {{
 *   name: string,
 *   htmlLang: string | null,
 *   locale: string,
 *   dir: 'ltr' | 'rtl',
 *   translatesDates: boolean,
 *   placeNameFields: boolean
 * }} RuntimeLanguage
 */

/**
 * The language codes, in registry order (the order the language control lists them).
 * @param {LanguagesRegistry} registry
 * @returns {string[]}
 */
export function languageCodes(registry) {
  return Object.keys(registry.languages);
}

/**
 * The codes of the languages translated from the source, in registry order.
 * @param {LanguagesRegistry} registry
 * @returns {string[]}
 */
export function translatedLanguages(registry) {
  return languageCodes(registry).filter((code) => code !== registry.source);
}

/**
 * The language `code`; throws for a code the registry does not list.
 * @param {LanguagesRegistry} registry
 * @param {string} code
 * @returns {Language}
 */
export function language(registry, code) {
  const entry = registry.languages[code];
  if (!entry) throw new Error(`Unknown language ${code}; known: ${languageCodes(registry).join(', ')}`);
  return entry;
}

/** The optional fields a language file's _meta carries after language and bcp47, in order. */
const META_FIELDS = /** @type {const} */ (['role', 'standard', 'terminology', 'reviewedBy']);

/**
 * The `_meta` fields a built language file opens with (scripts/i18n/build-i18n.mjs adds its counts).
 * @param {LanguagesRegistry} registry
 * @param {string} code
 * @returns {LanguageFileMeta}
 */
export function languageFileMeta(registry, code) {
  const entry = language(registry, code);
  /** @type {LanguageFileMeta} */
  const meta = { language: entry.englishName, bcp47: entry.bcp47 };
  for (const field of META_FIELDS) {
    if (field in entry) meta[field] = /** @type {string & (string | null)} */ (entry[field]);
  }
  return meta;
}

/**
 * The runtime's table: each language's own name, the <html lang> it sets (null for the source,
 * which keeps the page's own), its Intl locale and direction; whether the runtime translates the
 * source's short-month dates (a locale other than the source's) and whether the map reads its
 * place names from the tiles.
 * @param {LanguagesRegistry} registry
 * @returns {{ source: string, languages: Record<string, RuntimeLanguage> }}
 */
export function runtimeLanguages(registry) {
  const sourceLocale = language(registry, registry.source).locale;
  return {
    source: registry.source,
    languages: Object.fromEntries(languageCodes(registry).map((code) => {
      const entry = language(registry, code);
      return [code, {
        name: entry.name,
        htmlLang: code === registry.source ? null : entry.bcp47,
        locale: entry.locale,
        dir: entry.dir,
        translatesDates: entry.locale !== sourceLocale,
        placeNameFields: Boolean(entry.placeNameFields)
      }];
    }))
  };
}

/**
 * Errors the schema cannot state: the source is a listed language, it alone has a role and it is
 * never reviewed (it is the source), and every other language names its reviewer or null.
 * @param {LanguagesRegistry} registry
 * @returns {string[]} errors
 */
export function checkLanguages(registry) {
  /** @type {string[]} */
  const errors = [];
  if (!registry.languages[registry.source]) {
    errors.push(`source ${registry.source} is not a listed language`);
    return errors;
  }
  for (const [code, entry] of Object.entries(registry.languages)) {
    const isSource = code === registry.source;
    if (isSource && !entry.role) errors.push(`${code}: the source language needs a role`);
    if (!isSource && entry.role) errors.push(`${code}: only the source language has a role`);
    if (isSource && 'reviewedBy' in entry) errors.push(`${code}: the source language is not reviewed`);
    if (!isSource && !('reviewedBy' in entry)) errors.push(`${code}: reviewedBy must be given (null while the translations are drafts)`);
  }
  return errors;
}
