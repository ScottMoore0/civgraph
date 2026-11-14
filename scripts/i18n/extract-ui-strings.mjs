#!/usr/bin/env node
/**
 * Pull candidate interface strings out of the site's source, for the translation files.
 *
 * WHY
 *
 * The interface strings are written inline across ~40,000 lines of hand-written JavaScript and
 * HTML (packages/map/src/ui-controller.js alone is 12,000 lines). Rewriting every call site to t('key') would
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
  pages: ['site/index.html', 'site/pages/about.html', 'site/pages/census-explorer.html', 'site/pages/status.html', 'site/pages/api.html', 'site/apps/index.html', 'site/maps/index.html', 'site/404.html', 'site/offline.html', 'site/assets/pages/js/06-fallback-shell.js', 'site/assets/pages/js/07-fallback-stats.js'],
  catalogue: ['packages/map/src/catalogue/index.js', 'packages/map/src/catalogue/view-maps.js', 'packages/map/src/catalogue/view-elections.js', 'packages/map/src/catalogue/view-books.js', 'packages/map/src/catalogue/search.js', 'packages/map/src/catalogue/menu.js', 'packages/map/src/catalogue/split.js', 'packages/map/src/catalogue/slider.js', 'packages/map/src/catalogue/edit.js', 'packages/map/src/catalogue/geocoder.js', 'packages/map/src/catalogue/util.js'],
  app: [...mapAppSourceFiles(), 'packages/map/app/boot.js', ...electionManagerSourceFiles(), 'packages/map/app/maplibre-main-adapter.js', 'packages/map/src/ui-controller.js', 'packages/map/src/entity-detail-data.mjs', 'packages/map/src/views/election-renderer.mjs', 'packages/core/src/election-view-model.mjs', 'packages/map/src/views/election-trend-chart.mjs', 'packages/map/src/election-trend-chart.mjs', 'packages/map/src/feature-loader.js'],
  browse: ['site/browse/browse.js']
};

/**
 * Pages whose body a build script writes between two markers. The body is data (names and figures
 * of the day), so it is not read; its sentences are read from the script's templates instead, which
 * join SURFACES.pages.
 */
export const GENERATED_REGIONS = [
  { file: 'site/pages/status.html', from: '<!-- status:body -->', to: '<!-- /status:body -->', source: 'scripts/build/build-status.mjs' }
];
SURFACES.pages.push(...GENERATED_REGIONS.map((g) => g.source));

/**
 * `html` without the generated regions of `file` (GENERATED_REGIONS).
 * @param {string} file  repository-relative, forward slashes
 * @param {string} html
 * @returns {string}
 */
export function withoutGenerated(file, html) {
  let out = html;
  for (const g of GENERATED_REGIONS) {
    if (g.file !== file) continue;
    const a = out.indexOf(g.from);
    const b = out.indexOf(g.to, a + 1);
    if (a >= 0 && b > a) out = out.slice(0, a) + out.slice(b);
  }
  return out;
}

const WORD = /[A-Za-z]{2,}/;
const NOISE = [
  /^[a-z][a-zA-Z0-9]*$/, // camelCase identifiers, single lower-case words
  /^[a-z0-9_-]+$/, // slugs, css classes
  /^[A-Z0-9_]+$/, // CONSTANTS, field names
  /[{};=]|=>|\$\{|\bfunction\b|\breturn\b/, // code
  /^(?:https?:|\/|\.\/|#|mailto:|data:)/, // urls, paths, selectors
  /\.(?:js|mjs|css|json|html|png|svg|pbf|fgb|pmtiles|webp|jpg)\b/i,
  /^[.#[]/, // selectors
  /\b(?:px|rem|em|vh|vw|rgba?|hsla?|var|clamp|calc|min|max)\(|^\d+(?:px|%)$/, // css values
  /^(?:true|false|null|undefined|GET|POST|utf-8)$/i,
  /^\[[A-Za-z0-9]+\]/ // [Tag] developer log prefixes
];

/**
 * Code the string-literal scan picks up between two quotes of different literals: expressions,
 * object keys, CSS and selectors. Each is a whole class of noise, so the review list keeps only
 * text a person might read (data/i18n/review/untranslated-ui-triage.tsv sorts the rest).
 */
const CODE = [
  /\|\||&&|\?\?|\?\.|!==?|===/, // operators
  /^[).\]`+]|^\(\s*$|[([]\s*$|\?\s*$/, // a literal's neighbours: ") + (", "].join(", "limit ?"
  /^[,:]\s*[\w$.]+:\s*(?:\[|[\w$.]+\s*\|\|)?$/, // object keys: ", label:", ", classIds: ["
  /^[,:]\s*(?:''|""|[\w$.]+\s*[(?]|[\w$]+\.[\w$]+)/, // ternaries and calls: ": '', cell.rowspan ?", ", b.id ||"
  /\.(?:replace|join|split|localeCompare|filter|map|trim|slice|normalize|includes|endsWith|get|toLowerCase|toUpperCase)\(/,
  /\b(?:escapeHtml|esc|String|Number|this|sum)\s*[.(+]/,
  /^:scope\b|^\((?:max-width|min-width|prefers-[\w-]+|pointer|hover)\b/, // selectors, media queries
  /^[a-z-]+:\s*[#\d]/, // CSS declarations
  /^-?\d+(?:\.\d+)?(?:px|em|rem|%)(?:\s+-?\d+(?:\.\d+)?(?:px|em|rem|%)?)*$/, // CSS lengths, root margins
  /\bsans-serif\b|\bmonospace\b/, // font stacks
  /[\w$)]\s*[-+*/]\s*\d+\s*,?$/ // arithmetic: ", leafStart + 1,"
];
/** Literals that are protocol or key names, not text: event keys, headers, link relations. */
const CODE_WORDS = new Set(['Enter', 'Escape', 'Tab', 'Content-Type', 'use strict', 'noopener noreferrer']);
const HTML_TAGS = new Set(['a', 'button', 'input', 'select', 'label', 'thead', 'tbody', 'th', 'td', 'tr', 'li', 'ul', 'ol', 'div', 'span', 'table', 'svg', 'img', 'p', 'details', 'summary']);

/**
 * Is `t` code rather than text? (CODE, CODE_WORDS, and class lists like "btn btn--sm".)
 * @param {string} t  a candidate, whitespace already collapsed
 * @returns {boolean}
 */
export function isCode(t) {
  if (CODE_WORDS.has(t)) return true;
  // class lists: lower-case tokens, one at least with a hyphen or an underscore ("btn btn--sm")
  if (/^[a-z0-9_-]+(?:\s+[a-z0-9_-]+)+$/.test(t) && /[a-z0-9][-_]/.test(t)) return true;
  // tag selectors: every word a tag name ("a, button", "thead th[data-col]"; not "all contests")
  if (t.split(/[\s,>+~]+/).filter(Boolean).every((w) => HTML_TAGS.has(w.replace(/[[:].*$/, '')))) return true;
  return CODE.some((re) => re.test(t));
}

/**
 * Could `s` be interface text (not an identifier, a path, CSS or code)?
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeUi(s) {
  const whole = s.replace(/\s+/g, ' ').trim();
  if (whole.length < 2 || whole.length > 400) return false;
  // A template's values ({x}) are judged without them: "Show all {x} maps" is text built from
  // parts (a pattern), "{x}px" is not; a template needs a word or a phrase of its own.
  const t = whole.includes('{x}') ? whole.replace(/\{x\}/g, ' ').replace(/\s+/g, ' ').trim() : whole;
  if (t !== whole && !/[A-Za-z]{3,} [A-Za-z]{2,}|^[A-Z][a-z]{2,}/.test(t)) return false;
  if (!WORD.test(t)) return false;
  if (NOISE.some((re) => re.test(t))) return false;
  if (isCode(t)) return false;
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
  const lines = src.split('\n').filter((line) => !/console\.(?:log|warn|error|info|debug)|throw new Error|\bfail\(|^\s*(?:\/\/|\*|\/\*)/.test(line));
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
      const strings = /\.html$/.test(file) ? htmlStrings(withoutGenerated(file, text)) : scriptStrings(text);
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

/** @typedef {{ text: string, surfaces: string[], files: string[], count: number }} Candidate */

/** Where the review list and its triage live. */
export const REVIEW_FILE = 'data/i18n/review/untranslated-ui.txt';
export const TRIAGE_FILE = 'data/i18n/review/untranslated-ui-triage.tsv';

/**
 * The triage classes of data/i18n/review/untranslated-ui-triage.tsv: why a candidate the source
 * holds is not keyed. A candidate with no class is `interface`: text still to key.
 */
export const TRIAGE_CLASSES = {
  data: 'a data value: a name of a place, body, map, layer, person, publisher or licence, or search keywords (names go through the names overlay or stay as they are)',
  prose: 'a long paragraph of a static page, left in English by policy (data/i18n/README.md)',
  code: 'code, CSS, a developer or log message, or an internal state name the scan cannot tell from text',
  part: 'a piece of a sentence built in code, never shown on its own; it is keyed with its call site',
  later: 'interface text whose only source is code another change is rewriting; keyed after it lands'
};
/** The classes that are still work to do: the review list's count of them only shrinks. */
export const TODO_CLASSES = ['interface', 'later'];

/**
 * A string with every {placeholder} written {x}, as the scan writes a template's values.
 * @param {string} s
 * @returns {string}
 */
export const placeholderShape = (s) => s.replace(/\{[a-zA-Z0-9_]+\}/g, '{x}');

/**
 * The candidates with no key: not in en.json (a pattern counts by its shape) and not a name the
 * names overlay translates (map, series and election-body names).
 * @param {Candidate[]} list
 * @param {Iterable<string>} english  en.json's strings
 * @param {Set<string>} names
 * @returns {Candidate[]}
 */
export function unkeyed(list, english, names) {
  const known = new Set([...english].map(placeholderShape));
  return list.filter((e) => !known.has(e.text) && !names.has(e.text));
}

/**
 * The triage file: text -> class.
 * @param {string} text  data/i18n/review/untranslated-ui-triage.tsv
 * @returns {{ classes: Map<string, string>, problems: string[] }}
 */
export function parseTriage(text) {
  /** @type {Map<string, string>} */
  const classes = new Map();
  /** @type {string[]} */
  const problems = [];
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (!line || line.startsWith('#')) return;
    const tab = line.indexOf('\t');
    const cls = tab > 0 ? line.slice(0, tab) : '';
    const s = tab > 0 ? line.slice(tab + 1) : '';
    if (!Object.hasOwn(TRIAGE_CLASSES, cls)) problems.push(`${TRIAGE_FILE}:${i + 1}: unknown class "${cls}"`);
    else if (!s) problems.push(`${TRIAGE_FILE}:${i + 1}: no text`);
    else if (classes.has(s)) problems.push(`${TRIAGE_FILE}:${i + 1}: "${s}" is listed twice`);
    else classes.set(s, cls);
  });
  return { classes, problems };
}

/**
 * The review list's text: each unkeyed candidate with its class.
 * @param {Candidate[]} missing
 * @param {Map<string, string>} classes  from parseTriage
 * @returns {string}
 */
export function reviewText(missing, classes) {
  /** @type {Record<string, number>} */
  const counts = {};
  const rows = missing.map((e) => {
    const cls = classes.get(e.text) || 'interface';
    counts[cls] = (counts[cls] || 0) + 1;
    return `${cls}\t${e.surfaces.join(',')}\t${e.files.join(',')}\t${e.text}`;
  });
  const summary = ['interface', ...Object.keys(TRIAGE_CLASSES)].map((c) => `${c} ${counts[c] || 0}`).join(', ');
  const lines = [
    '# Interface strings found in the source that have no key in assets/i18n/en.json, so they show',
    '# in English in every language. Generated by node scripts/i18n/extract-ui-strings.mjs --missing',
    '# --review. Each line has a class: "interface" is text still to key; the other classes are set',
    `# in ${TRIAGE_FILE} (see its header).`,
    '# Templates are written with {x} for each value; one counts as keyed when en.json has a pattern',
    '# of the same shape (data/i18n/strings/patterns.txt).',
    `# Counts: ${summary}.`,
    '# class<TAB>surface<TAB>files<TAB>text',
    ...rows
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The number of lines of a review list (its text) still to do (TODO_CLASSES).
 * @param {string} text
 * @returns {number}
 */
export function todoCount(text) {
  return text.split('\n').filter((line) => line && !line.startsWith('#') && TODO_CLASSES.includes(line.split('\t')[0] || '')).length;
}

/**
 * The review list as it is now, from the source, en.json, the names and the triage under `root`.
 * @param {string} [root]
 * @returns {{ missing: Candidate[], text: string, problems: string[], classes: Map<string, string> }}
 */
export function buildReview(root = process.cwd()) {
  const read = (/** @type {string} */ rel) => readFileSync(path.join(root, rel), 'utf8');
  /** @type {{ strings?: Record<string, string> }} */
  const en = JSON.parse(read('site/assets/i18n/en.json'));
  // Map, series and election-body names are translated through the names overlay, not en.json.
  /** @type {import('../../packages/types/index.js').MapEntry[]} */
  const maps = JSON.parse(read('data/database/maps.json')).maps || [];
  /** @type {{ series: Array<{ name: string }>, electionBodies: Array<{ name: string }> }} the parts of data/catalogue/catalogue.json read here */
  const cat = JSON.parse(read('data/catalogue/catalogue.json'));
  const names = new Set([...maps.map((m) => m.name), ...cat.series.map((s) => s.name), ...cat.electionBodies.map((b) => b.name)]);
  const missing = unkeyed(collect(root), Object.values(en.strings || {}), names);
  const { classes, problems } = parseTriage(existsSync(path.join(root, TRIAGE_FILE)) ? read(TRIAGE_FILE) : '');
  return { missing, text: reviewText(missing, classes), problems, classes };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('extract-ui-strings.mjs')) {
  const list = collect();
  mkdirSync('tmp/i18n', { recursive: true });
  writeFileSync('tmp/i18n/ui-string-candidates.json', JSON.stringify(list, null, 1));
  /** @type {Record<string, number>} */
  const bySurface = {};
  for (const e of list) for (const s of e.surfaces) bySurface[s] = (bySurface[s] || 0) + 1;
  console.log(`${list.length} candidate strings`, bySurface);
  if (process.argv.includes('--missing')) {
    const { missing, text, problems } = buildReview();
    if (problems.length) {
      console.error(problems.map((p) => `FAIL: ${p}`).join('\n'));
      process.exit(1);
    }
    writeFileSync('tmp/i18n/ui-string-missing.json', JSON.stringify(missing, null, 1));
    console.log(`${missing.length} not in en.json (tmp/i18n/ui-string-missing.json); ${todoCount(text)} still to key`);
    if (process.argv.includes('--review')) {
      writeFileSync(REVIEW_FILE, text);
      console.log(`Wrote ${REVIEW_FILE}`);
    }
  }
}
