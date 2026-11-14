/**
 * CSV text for the app's downloads of row lists (the by-election tracker, council control):
 * RFC 4180 quoting, a header row of column names, null as an empty cell. Pure:
 * tests/unit/elections-app-bodies.test.mjs.
 */

/**
 * @param {string[]} columns
 * @param {Array<Record<string, unknown>>} rows
 */
export function toCsvText(columns, rows) {
  const cell = (/** @type {unknown} */ v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${[columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n')}\n`;
}
