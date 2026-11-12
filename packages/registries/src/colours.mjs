/**
 * The colours registry (data/registries/colours.json): the fixed colours code draws with outside the
 * stylesheets, by palette (map, mapExport, ramps, catalogue, electionsApp, browse, gallery, viewer,
 * areaResults). MapLibre paint, canvas and SVG drawing, exported SVG, the inline styles classic scripts
 * write and contrast picks need a colour value, which a CSS var() is not; docs/ARCHITECTURE-RULES.md
 * R9 makes a registry palette part the only place outside the token files where one may stand.
 * Pure: the views take the loaded value, so the browser slice
 * (packages/registries/src/browser/colours.json) is computed by the same functions.
 */

/** @typedef {import('../../types/index.js').ColoursRegistry} ColoursRegistry */
/** @typedef {ColoursRegistry['palettes'][string]['colours'][string]} ColourEntry */
/** @typedef {string | string[] | Record<string, string> | Record<string, string[]>} ColourValue */

// A colour literal: hex, or an rgb()/hsl() function. A value that holds none is not colour data.
const COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?)\(\s*[\d.]/i;

/**
 * What an entry holds, as the code reads it.
 * @param {ColourEntry} entry
 * @returns {ColourValue}
 */
export function entryValue(entry) {
  if (entry.value !== undefined) return entry.value;
  if (entry.values !== undefined) return [...entry.values];
  if (entry.table !== undefined) return { ...entry.table };
  return Object.fromEntries(Object.entries(entry.ramps || {}).map(([name, ramp]) => [name, [...ramp]]));
}

/**
 * Every string an entry holds.
 * @param {ColourEntry} entry
 * @returns {string[]}
 */
function strings(entry) {
  const value = entryValue(entry);
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  return Object.values(value).flat();
}

/**
 * Errors the schema cannot state: every string an entry holds is (or holds) a colour literal.
 * @param {ColoursRegistry} registry
 * @returns {string[]}
 */
export function checkColours(registry) {
  /** @type {string[]} */
  const errors = [];
  for (const [palette, { colours }] of Object.entries(registry.palettes)) {
    for (const [role, entry] of Object.entries(colours)) {
      for (const text of strings(entry)) {
        if (!COLOUR.test(text)) errors.push(`colours: ${palette}.${role} holds ${JSON.stringify(text)}, which is not a colour`);
      }
    }
  }
  return errors;
}

/**
 * The browser's slice: palette -> role -> what the code reads (a colour, a ramp, a table or named ramps).
 * @param {ColoursRegistry} registry
 * @returns {Record<string, Record<string, ColourValue>>}
 */
export function browserColours(registry) {
  return Object.fromEntries(Object.entries(registry.palettes)
    .map(([palette, { colours }]) => [palette, Object.fromEntries(Object.entries(colours).map(([role, entry]) => [role, entryValue(entry)]))]));
}
