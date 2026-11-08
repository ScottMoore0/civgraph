#!/usr/bin/env node
/**
 * Pull candidate interface strings out of the site's source, for the translation files.
 *
 * WHY
 *
 * The interface strings are written inline across ~40,000 lines of hand-written JavaScript and
 * HTML (src/ui-controller.js alone is 12,000 lines). Rewriting every call site to t('key') would
 * touch code other agents are editing on main and is the riskiest possible way to add a
 * language. Instead the runtime (assets/i18n/i18n.js) translates the rendered page: it looks each
 * piece of visible text up by its English wording, through the keys in assets/i18n/en.json. This
 * script finds the wording that can appear, so en.json can list it.
 *
 * WHAT IT READS
 *   - text between tags and the title / aria-label / placeholder / alt attributes of the static
 *     pages and the partials;
 *   - string literals and the text parts of template literals in the interface scripts.
 * It is a superset with noise (identifiers, CSS, developer messages); the filters below drop the
 * obvious noise and scripts/i18n/build-i18n.mjs keeps only strings that have a key in en.json.
 *
 * USAGE
 *   node scripts/i18n/extract-ui-strings.mjs            write tmp/i18n/ui-string-candidates.json
 *   node scripts/i18n/extract-ui-strings.mjs --missing  also list candidates en.json lacks
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { electionManagerSourceFiles, mapAppSourceFiles } from '../lib/map-app-source.mjs';

export const SURFACES = {
  chrome: ['packages/ui/src/templates/shell.js', 'site/partials/browse-shell.html', 'site/assets/site/site-chrome.js'],
  pages: ['site/index.html', 'site/pages/about.html', 'site/pages/census-explorer.html', 'site/pages/status.html', 'site/apps/index.html', 'site/maps/index.html', 'site/404.html', 'site/offline.html', 'site/assets/pages/js/06-fallback-shell.js', 'site/assets/pages/js/07-fallback-stats.js'],
  catalogue: ['src/catalogue/index.js', 'src/catalogue/view-maps.js', 'src/catalogue/view-elections.js', 'src/catalogue/view-books.js', 'src/catalogue/search.js', 'src/catalogue/menu.js', 'src/catalogue/split.js', 'src/catalogue/slider.js', 'src/catalogue/edit.js', 'src/catalogue/geocoder.js', 'src/catalogue/util.js'],
  app: [...mapAppSourceFiles(), 'packages/map/app/boot.js', ...electionManagerSourceFiles(), 'packages/map/app/maplibre-main-adapter.js', 'src/ui-controller.js', 'src/entity-detail-data.mjs', 'src/election-renderer.mjs', 'packages/core/src/election-view-model.mjs', 'src/election-trend-chart.mjs', 'src/feature-loader.js'],
  browse: ['site/browse/browse.js']
};

const WORD = /[A-Za-z]{2,}/;
const NOISE = [
  /^[a-z][a-zA-Z0-9]*$/, // camelCase identifiers, single lower-case words
  /^[a-z0-9_-]+$/, // slugs, css classes
  /^[A-Z0-9_]+$/, // CONSTANTS, field names
  /[{};=]|=>|\$\{|\bfunction\b|\breturn\b/, // code
  /^(?:https?:|\/|\.\/|#|mailto:|data:)/, // urls, paths, selectors
  /\.(?:js|mjs|css|json|html|png|svg|pbf|fgb|pmtiles|webp|jpg)\b/i,
  /^[.#[]/, // selectors
  /\b(?:px|rem|em|vh|vw|rgba?|hsla?|var)\(|^\d+(?:px|%)$/, // css values
  /^(?:true|false|null|undefined|GET|POST|utf-8)$/i,
  /^\[[A-Za-z0-9]+\]/ // [Tag] developer log prefixes
];

/**
 * @param {string} s
 */
function looksLikeUi(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 400) return false;
  if (!WORD.test(t)) return false;
  if (NOISE.some((re) => re.test(t))) return false;
  if (/^[a-z]/.test(t) && !/\s/.test(t)) return false; // one lower-case token: code, not prose
  if (/[a-z][A-Z]/.test(t) && !/\s/.test(t)) return false; // camelCase token
  if (/^[\w-]+(?:\s+[\w-]+)*$/.test(t) && /(?:^|\s)[a-z]+-[a-z]+(?:\s|$)/.test(t) && !/[A-Z]/.test(t)) return false; // class lists
  return true;
}

/**
 * @param {string} s
 */
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&middot;/g, '·').replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&rarr;/g, '→').replace(/&larr;/g, '←')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/**
 * Text between tags and the readable attributes of an HTML fragment.
 * @param {string} html
 */
export function htmlStrings(html) {
  const out = [];
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  for (const m of stripped.matchAll(/>([^<>]+)</g)) out.push(decodeEntities(m[1]));
  for (const m of stripped.matchAll(/\b(?:title|aria-label|placeholder|alt|data-tooltip)\s*=\s*"([^"]*)"/g)) out.push(decodeEntities(m[1]));
  return out;
}

/**
 * String literals and template-literal text from a script, skipping console/developer lines.
 * @param {string} src
 */
export function scriptStrings(src) {
  const out = [];
  const lines = src.split('\n').filter((line) => !/console\.(?:log|warn|error|info|debug)|throw new Error|^\s*(?:\/\/|\*|\/\*)/.test(line));
  const code = lines.join('\n');
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.){2,400})'|"((?:[^"\\\n]|\\.){2,400})"/g)) {
    const s = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ');
    if (/<[a-z][^>]*>|<\/[a-z]/i.test(s)) out.push(...htmlStrings(`>${s}<`));
    else out.push(decodeEntities(s));
  }
  for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const body = m[1];
    if (/<[a-z][^>]*>|<\/[a-z]/i.test(body)) {
      // Interpolations become a placeholder so "Show all ${n}" is collected as "Show all {n}".
      out.push(...htmlStrings(`>${body.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '{x}')}<`));
    } else {
      out.push(decodeEntities(body.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '{x}')));
    }
  }
  return out;
}

export function collect(root = process.cwd()) {
  /** @type {Map<string, { text: string, surfaces: Set<string>, files: Set<string>, count: number }>} */
  const found = new Map();
  for (const [surface, files] of Object.entries(SURFACES)) {
    for (const file of files) {
      const full = path.join(root, file);
      if (!existsSync(full)) continue;
      const text = readFileSync(full, 'utf8');
      const strings = /\.html$/.test(file) ? htmlStrings(text) : scriptStrings(text);
      for (const raw of strings) {
        const s = raw.replace(/\s+/g, ' ').trim();
        if (!looksLikeUi(s)) continue;
        const entry = found.get(s) || { text: s, surfaces: new Set(), files: new Set(), count: 0 };
        entry.surfaces.add(surface);
        entry.files.add(file);
        entry.count += 1;
        found.set(s, entry);
      }
    }
  }
  return [...found.values()].map((e) => ({ text: e.text, surfaces: [...e.surfaces], files: [...e.files], count: e.count }))
    .sort((a, b) => a.text.localeCompare(b.text));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('extract-ui-strings.mjs')) {
  const list = collect();
  mkdirSync('tmp/i18n', { recursive: true });
  writeFileSync('tmp/i18n/ui-string-candidates.json', JSON.stringify(list, null, 1));
  /** @type {Record<string, number>} */
  const bySurface = {};
  for (const e of list) for (const s of e.surfaces) bySurface[s] = (bySurface[s] || 0) + 1;
  console.log(`${list.length} candidate strings`, bySurface);
  if (process.argv.includes('--missing')) {
    const en = JSON.parse(readFileSync('site/assets/i18n/en.json', 'utf8'));
    const known = new Set(Object.values(en.strings || {}));
    // Map, series and election-body names are translated through the names overlay, not en.json.
    /** @type {import('../../packages/types/index.js').MapEntry[]} */
    const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8')).maps || [];
    /** @type {{ series: Array<{ name: string }>, electionBodies: Array<{ name: string }> }} the parts of data/catalogue/catalogue.json read here */
    const cat = JSON.parse(readFileSync('data/catalogue/catalogue.json', 'utf8'));
    const names = new Set([...maps.map((m) => m.name), ...cat.series.map((s) => s.name), ...cat.electionBodies.map((b) => b.name)]);
    const missing = list.filter((e) => !known.has(e.text) && !names.has(e.text));
    writeFileSync('tmp/i18n/ui-string-missing.json', JSON.stringify(missing, null, 1));
    console.log(`${missing.length} not in en.json (tmp/i18n/ui-string-missing.json)`);
    if (process.argv.includes('--review')) {
      const lines = [
        '# Interface strings found in the source that have no key in assets/i18n/en.json, so they show',
        '# in English in every language. Generated by node scripts/i18n/extract-ui-strings.mjs --missing',
        '# --review. A superset: it includes developer text, CSS, data values and strings that are',
        '# built from parts (matched at run time by the patterns in data/i18n/strings/patterns.txt).',
        '# Long prose paragraphs of the static pages are deliberately left in English for now.',
        '# surface<TAB>files<TAB>text',
        ...missing.map((e) => `${e.surfaces.join(',')}\t${e.files.join(',')}\t${e.text}`)
      ];
      writeFileSync('data/i18n/review/untranslated-ui.txt', `${lines.join('\n')}\n`);
      console.log('Wrote data/i18n/review/untranslated-ui.txt');
    }
  }
}
