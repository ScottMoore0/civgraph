/**
 * The literal checks: values that belong in config, tokens or the shared formatter.
 *
 * C5 (R6, R4): no origin, research User-Agent or records-build path spelled out in site/ or
 *     scripts/ code (they come from @civgraph/config; an app's own settings from its config.js).
 *     It widens tests/unit/config-adoption.test.mjs and pipeline-config-adoption.test.mjs, which
 *     hold scripts/records, scripts/lib and six scripts/ folders, to the rest.
 * C8 (R9): no colour literal (hex, rgb(), hsl()) in a stylesheet outside the token files, or in a
 *     string in served JS outside the registry and palette modules config/architecture.json names.
 * C10 (R10): no hard-coded locale ('en-GB') and no month-name array outside the shared formatter.
 */
import { SITE } from '../../../packages/config/src/node.mjs';
import { codeOf, isString, lineOf, walk } from './lib.mjs';

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding @typedef {import('./lib.mjs').AstNode} AstNode */

// The values come from the config itself, so this file spells none of them out.
const escape = (/** @type {string} */ v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CONFIG_LITERAL = new RegExp(`${[SITE.dataOrigin, SITE.origin, `${SITE.userAgent.split(' ')[0]} (`].map(escape).join('|')}|civgraph-records\\.sqlite|tmp/records/`);

export const C5 = {
  id: 'C5',
  rule: 'R6',
  title: 'no origin, User-Agent or records path spelled out outside config',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[] }} */ (ctx.config.C5);
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg)) {
      ctx.lines(file).forEach((line, i) => {
        const m = codeOf(line).match(CONFIG_LITERAL);
        if (m) out.push({ file, line: i + 1, message: `spells out ${m[0]}: take it from @civgraph/config (or the app's config.js)` });
      });
    }
    return out;
  },
};

// ------------------------------------------------------------------ C8 colours

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const FUNC = /\b(?:rgba?|hsla?)\(\s*[\d.]/i;

/**
 * The colour literals in a stylesheet's declarations: `{ line, value }` for each.
 * @param {string} css
 */
export function cssColours(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out = [];
  for (const m of text.matchAll(/([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    const value = m[2];
    const hit = value.match(HEX) || value.match(FUNC);
    if (!hit) continue;
    const at = /** @type {number} */ (m.index) + m[0].indexOf(value) + /** @type {number} */ (hit.index);
    out.push({ line: text.slice(0, at).split('\n').length, value: hit[0] });
  }
  return out;
}

/** @param {string} s */
const isColour = (s) => /^#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})$/i.test(s.trim()) || FUNC.test(s) || /(^|[\s:(,])#[0-9a-f]{6}\b/i.test(s);

export const C8 = {
  id: 'C8',
  rule: 'R9',
  title: 'colour literals only in the token files (stylesheets) and registry or palette modules (JS)',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ css: { include: string[], exclude?: string[] }, js: { include: string[], exclude?: string[] } }} */ (ctx.config.C8);
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select({ ...cfg.css, ext: /\.css$/ })) {
      for (const { line, value } of cssColours(ctx.read(file))) out.push({ file, line, message: `colour literal ${value}: use a token from packages/ui/assets/tokens.css` });
    }
    for (const file of ctx.select(cfg.js)) {
      walk(ctx.parse(file).ast, (n) => {
        /** @type {string | null} */
        let value = null;
        if (isString(n)) value = n.value;
        else if (n.type === 'TemplateElement') value = /** @type {{ cooked: string | null }} */ (n.value).cooked;
        if (value && value.length < 400 && isColour(value)) {
          const shown = (value.match(HEX) || value.match(/\b(?:rgba?|hsla?)\([^)]*\)?/i) || [value])[0];
          out.push({ file, line: lineOf(n), message: `colour literal ${shown}: use a token (var(--...)), or the registry for data colours` });
        }
      });
    }
    return out;
  },
};

// ------------------------------------------------------------------ C10 locale

const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;
const MONTHS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);

export const C10 = {
  id: 'C10',
  rule: 'R10',
  title: 'no hard-coded locale or month-name array outside the shared formatter',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[] }} */ (ctx.config.C10);
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg)) {
      walk(ctx.parse(file).ast, (n) => {
        if (isString(n) && LOCALE.test(n.value)) out.push({ file, line: lineOf(n), message: `hard-coded locale '${n.value}': format through packages/core/src/format.js (civgraphI18n picks the language)` });
        if (n.type === 'ArrayExpression') {
          const months = /** @type {Array<AstNode | null>} */ (n.elements).filter(isString).filter((e) => MONTHS.has(e.value.toLowerCase().replace(/\.$/, '')));
          if (months.length >= 3) out.push({ file, line: lineOf(n), message: `array of ${months.length} month names: use the shared formatter's dates` });
        }
      });
    }
    return out;
  },
};
