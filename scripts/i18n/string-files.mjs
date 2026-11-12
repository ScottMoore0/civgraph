/**
 * Reading the interface string files (data/i18n/strings/<surface>.txt) by their header.
 *
 *   #!columns en ¦ ga ¦ sco                      the header: one language code a column
 *   # a comment
 *   Add to map ¦ Cuir leis an léarscáil ¦ Pit on the map
 *   @chrome.language Language ¦ Teanga ¦ Leid    a line with its own key
 *
 * The header names each column by its language code (data/registries/languages.json), so a column
 * is found by its language, never by its position: a new language is a new column named in the
 * header (acceptance test A5). Every row has exactly the header's columns; an empty column is a
 * missing translation. Before the header came in (12 Nov 2026) the columns were read by position
 * (English ¦ Irish ¦ Ulster-Scots).
 *
 * Pure: the caller reads the file and loads the registry, so a test can hand it any text.
 */

export const SEP = '¦';
/** The header line: `#!columns` and the codes, separated by SEP. Older readers see a comment. */
const HEADER = /^#!columns\s+(.*)$/;
/** A line that gives its own key: `@<key> <columns>`. */
const KEYED = /^@([A-Za-z0-9_.-]+)\s+(.*)$/;

/**
 * One row of a string file.
 * @typedef {object} StringRow
 * @property {string | null} key       the row's own key (`@key`), or null
 * @property {Record<string, string>} text  language code -> its column, trimmed ('' when untranslated)
 * @property {number} line             1-based
 */

/**
 * The columns a header declares, or the problem with it.
 * @param {string} spec  the text after `#!columns`
 * @param {readonly string[]} languages  the registry's language codes
 * @param {string} source  the source language's code
 * @returns {{ columns: string[], problems: string[] }}
 */
export function headerColumns(spec, languages, source) {
  const columns = spec.split(SEP).map((c) => c.trim());
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  for (const code of columns) {
    if (!code) problems.push('an empty column name');
    else if (seen.has(code)) problems.push(`column ${code} named twice`);
    else if (!languages.includes(code)) problems.push(`column ${code} is not a language in data/registries/languages.json`);
    seen.add(code);
  }
  for (const code of languages) if (!seen.has(code)) problems.push(`no column for ${code}${code === source ? ' (the source language)' : ''}`);
  return { columns, problems };
}

/**
 * The rows of a string file, read by its header.
 * @param {string} text   the file's text
 * @param {object} options
 * @param {string} options.where   the file's path, for messages
 * @param {readonly string[]} options.languages  the languages every file must have a column for
 * @param {string} options.source  the source language (a row needs its text)
 * @param {readonly string[]} [options.columns]  the columns of a file that has no header (a fixed
 *   format, such as the English ¦ Irish map-name glossary); without it the header is required
 * @returns {{ columns: string[], rows: StringRow[], problems: string[] }}
 */
export function parseStringFile(text, { where, languages, source, columns: fixed }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {StringRow[]} */
  const rows = [];
  /** @type {string[] | null} */
  let columns = fixed ? [...fixed] : null;
  let headerLine = 0;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const at = `${where}:${i + 1}`;
    const header = HEADER.exec(line);
    if (header) {
      if (headerLine) { problems.push(`${at}: a second #!columns header (the first is line ${headerLine})`); return; }
      if (rows.length) { problems.push(`${at}: the #!columns header must come before the first string`); return; }
      headerLine = i + 1;
      const declared = headerColumns(/** @type {string} */ (header[1]), languages, source);
      for (const p of declared.problems) problems.push(`${at}: ${p}`);
      columns = declared.columns;
      return;
    }
    if (!line || line.startsWith('#')) return;
    if (!columns) { problems.push(`${at}: no #!columns header before the first string (e.g. "#!columns ${languages.join(` ${SEP} `)}")`); columns = []; }
    if (!columns.length) return;
    const keyed = KEYED.exec(line);
    const body = keyed ? /** @type {string} */ (keyed[2]) : line;
    const cells = body.split(SEP).map((c) => c.trim());
    if (cells.length !== columns.length) {
      problems.push(`${at}: expected ${columns.length} columns (${columns.join(` ${SEP} `)}) separated by ${SEP}, found ${cells.length}`);
      return;
    }
    /** @type {Record<string, string>} */
    const byLanguage = {};
    columns.forEach((code, c) => { byLanguage[code] = /** @type {string} */ (cells[c]); });
    rows.push({ key: keyed ? /** @type {string} */ (keyed[1]) : null, text: byLanguage, line: i + 1 });
  });
  return { columns: columns || [], rows, problems };
}

/**
 * The text of a string file with one more language column: `code` is added to the header and
 * each row gets the cell `cell(row)` returns ('' leaves it untranslated). Comments, blank lines
 * and keys are kept as they are. For adding a language (scripts/i18n/add-language-column.mjs) and
 * for the A5 test's fixture.
 * @param {string} text  the file's text, with its #!columns header
 * @param {string} code  the new language's code
 * @param {object} options
 * @param {string} options.where   the file's path, for messages
 * @param {readonly string[]} options.languages  the languages the file has now
 * @param {string} options.source  the source language
 * @param {(row: StringRow) => string} [options.cell]  the new column's text for a row
 * @returns {string}
 */
export function withColumn(text, code, { where, languages, source, cell = () => '' }) {
  const parsed = parseStringFile(text, { where, languages, source });
  if (parsed.problems.length) throw new Error(parsed.problems.join('\n'));
  if (parsed.columns.includes(code)) throw new Error(`${where}: already has a ${code} column`);
  const rows = new Map(parsed.rows.map((row) => [row.line, row]));
  return text.replace(/\r\n/g, '\n').split('\n').map((raw, i) => {
    const row = rows.get(i + 1);
    if (row) {
      const value = cell(row).trim();
      if (value.includes(SEP)) throw new Error(`${where}:${i + 1}: a ${code} cell holds ${SEP}`);
      return `${raw.replace(/\s+$/, '')} ${SEP}${value ? ` ${value}` : ''}`;
    }
    return HEADER.test(raw.trim()) ? `${raw.replace(/\s+$/, '')} ${SEP} ${code}` : raw;
  }).join('\n');
}
