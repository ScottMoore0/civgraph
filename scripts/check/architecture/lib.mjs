/**
 * Shared machinery of check:architecture (scripts/check/architecture.mjs): the file list, cached
 * reads and parses, an AST walk, scope matching and the `arch-ok R<n>: reason` escape hatch.
 *
 * A check is a module exporting `id` ('C4'), `rule` ('R6'), `title` and `run(ctx)`, which returns
 * findings `{ file, line, message }`. The context reads files through `ctx.read`, so the unit tests
 * hand it in-memory fixtures (`sources`) instead of the repository.
 *
 * The parser is espree, ESLint's own (installed with eslint; no new dependency).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';

/**
 * @typedef {{ file: string, line: number, message: string }} Finding
 * @typedef {{ type: string, loc?: { start: { line: number, column: number }, end: { line: number, column: number } }, [key: string]: unknown }} AstNode
 * @typedef {{ value: string, line: number }} Comment
 */

const SCRIPT = /\.(m?js|cjs)$/;

/** Vendored, minified and generated files no rule reads. */
export const ALWAYS_SKIP = /(^|\/)(node_modules|dist|build|vendor|libs)\/|\.min\.(js|css)$|^src\/sql\.js-httpvfs\//;

/**
 * Whether a path is under one of the prefixes (a prefix ending in / is a folder, else one file).
 * @param {string} rel
 * @param {readonly string[]} prefixes
 */
export function under(rel, prefixes) {
  return prefixes.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
}

/**
 * @param {{ root: string, files?: string[], sources?: Record<string, string>, config?: Record<string, unknown>, changedLines?: Map<string, Set<number>> | null, [key: string]: unknown }} options
 */
export function createContext(options) {
  const { root, sources } = options;
  const files = options.files
    ?? (sources ? Object.keys(sources) : execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean));
  /** @type {Map<string, string>} */
  const text = new Map();
  /** @type {Map<string, { ast: AstNode | null, comments: Comment[] }>} */
  const parsed = new Map();
  /** @type {string[]} */
  const parseErrors = [];

  /** @param {string} rel */
  const read = (rel) => {
    if (!text.has(rel)) {
      let body = '';
      if (sources) body = sources[rel] ?? '';
      else { try { body = readFileSync(path.join(root, rel), 'utf8'); } catch { body = ''; } }
      text.set(rel, body);
    }
    return /** @type {string} */ (text.get(rel));
  };

  /** @param {string} rel */
  const parse = (rel) => {
    if (!parsed.has(rel)) {
      /** @type {AstNode | null} */
      let ast = null;
      /** @type {Comment[]} */
      let comments = [];
      const source = read(rel);
      for (const sourceType of /** @type {const} */ (['module', 'script'])) {
        try {
          const tree = espree.parse(source, { ecmaVersion: 'latest', sourceType, loc: true, comment: true, range: true });
          ast = /** @type {AstNode} */ (/** @type {unknown} */ (tree));
          const found = /** @type {Array<{ value: string, loc?: { start: { line: number } } }>} */ ((/** @type {{ comments?: unknown[] }} */ (tree)).comments || []);
          comments = found.map((c) => ({ value: c.value, line: c.loc?.start.line ?? 0 }));
          break;
        } catch { /* try the other source type */ }
      }
      if (!ast && source) parseErrors.push(rel);
      parsed.set(rel, { ast, comments });
    }
    return /** @type {{ ast: AstNode | null, comments: Comment[] }} */ (parsed.get(rel));
  };

  /**
   * The files of a check's scope: under `include`, not under `exclude`, not vendored, matching `ext`.
   * @param {{ include: readonly string[], exclude?: readonly string[], ext?: RegExp }} scope
   */
  const select = ({ include, exclude = [], ext = SCRIPT }) => files.filter((f) => ext.test(f) && under(f, include) && !under(f, exclude) && !ALWAYS_SKIP.test(f));

  return {
    root,
    files,
    config: options.config || {},
    changedLines: options.changedLines ?? null,
    options,
    read,
    lines: (/** @type {string} */ rel) => read(rel).split('\n'),
    parse,
    select,
    parseErrors,
    readFiles: () => [...text.keys()],
  };
}

/** @typedef {ReturnType<typeof createContext>} Context */

/**
 * Visit every node depth first; `fn(node, ancestors)` (nearest ancestor last).
 * @param {AstNode | null} node
 * @param {(node: AstNode, ancestors: AstNode[]) => void} fn
 * @param {AstNode[]} [ancestors]
 */
export function walk(node, fn, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, ancestors);
  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walk(child, fn, ancestors);
    } else if (value && typeof value === 'object' && typeof (/** @type {AstNode} */ (value)).type === 'string') {
      walk(/** @type {AstNode} */ (value), fn, ancestors);
    }
  }
  ancestors.pop();
}

/** @param {AstNode} node */
export const lineOf = (node) => node.loc?.start.line ?? 0;

/** @param {AstNode | null | undefined} node @returns {node is AstNode & { value: string }} */
export const isString = (node) => Boolean(node && node.type === 'Literal' && typeof node.value === 'string');

/** @param {AstNode} node */
export const isFunction = (node) => node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';

/**
 * The name a node stands for: an identifier's name, or a member expression's property name.
 * @param {AstNode | null | undefined} node
 * @returns {string | null}
 */
export function nameOf(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return /** @type {string} */ (node.name);
  if (node.type === 'MemberExpression') {
    const prop = /** @type {AstNode} */ (node.property);
    if (prop.type === 'Identifier' && !node.computed) return /** @type {string} */ (prop.name);
    if (isString(prop)) return prop.value;
  }
  return null;
}

/**
 * A code line with `//` and one-line block comments removed (for the line-regex checks).
 * @param {string} line
 */
export function codeOf(line) {
  if (/^\s*(\*|\/\/|\/\*)/.test(line)) return '';
  return line.replace(/\/\*.*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/ .*$/, '$1');
}

// ------------------------------------------------------------------ the escape hatch (R14)

const MARKER = /arch-ok\b/;
const VALID = /arch-ok R(\d{1,2}): *(\S.*?)\s*(\*\/|-->)?\s*$/;

/**
 * The `arch-ok` marker on a line, if any: `{ rule: 'R6', reason }`, or `{ malformed: true }`.
 * @param {string} line
 * @returns {{ rule: string, reason: string } | { malformed: true } | null}
 */
export function markerOn(line) {
  if (!MARKER.test(line)) return null;
  const m = line.slice(line.indexOf('arch-ok')).match(VALID);
  if (!m || m[2].replace(/\W/g, '').length < 3) return { malformed: true };
  return { rule: `R${Number(m[1])}`, reason: m[2] };
}

/**
 * The marker that excuses a finding of `rule` at `line`: on that line or the line above it.
 * @param {string[]} lines
 * @param {number} line  1-based
 * @param {string} rule
 */
export function excusedBy(lines, line, rule) {
  for (const at of [line, line - 1]) {
    if (at < 1 || at > lines.length) continue;
    const marker = markerOn(lines[at - 1]);
    if (marker && 'rule' in marker && marker.rule === rule) return { line: at, reason: marker.reason };
  }
  return null;
}

// ------------------------------------------------------------------ diff scope (C6)

/**
 * The added or changed lines per file in `git diff -U0` output.
 * @param {string} diff
 * @returns {Map<string, Set<number>>}
 */
export function parseDiff(diff) {
  /** @type {Map<string, Set<number>>} */
  const out = new Map();
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6).trim() : null;
      if (file && !out.has(file)) out.set(file, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const set = /** @type {Set<number>} */ (out.get(file));
      for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return out;
}

/**
 * The lines changed since the branch left `base` (committed, staged and unstaged), or null when
 * no base can be found (then the diff-scoped checks read every line).
 * @param {string} root
 * @param {string[]} bases  tried in order
 */
export function changedSince(root, bases) {
  for (const base of bases) {
    try {
      const mergeBase = execFileSync('git', ['merge-base', 'HEAD', base], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', mergeBase], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
      return { base, changed: parseDiff(diff) };
    } catch { /* try the next base */ }
  }
  return { base: null, changed: null };
}
