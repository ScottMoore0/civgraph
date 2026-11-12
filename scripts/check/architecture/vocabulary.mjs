/**
 * C4 (rule R6, data over code): no literal holds two or more values of one registry vocabulary.
 *
 * The vocabularies are read from the registries (data/registries/): party names and their
 * abbreviations, council ids, body slugs and names, body types, the states and spellings of the
 * status machines the config names (the domain ones: generic words such as held or partial are
 * left out), layer types, and the election types registry's voting systems and kinds of election
 * (REG-2); config/architecture.json adds the candidate outcomes until a registry holds them. A literal is an array of
 * strings, the key set of an object, the first column of a table (`new Map([[k, v], ...])` or an
 * array of rows), a `switch`'s case labels, or a regular expression's alternation. Two values
 * of the SAME vocabulary in one literal is a list that belongs in a registry; one value is a
 * lookup, which is fine. Precise on purpose: the broad "array of four strings" heuristic gave
 * 550 hits and was rejected (RULES-FEASIBILITY.md, C4b).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isString, lineOf, walk } from './lib.mjs';

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding @typedef {import('./lib.mjs').AstNode} AstNode */

const norm = (/** @type {unknown} */ v) => String(v).trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The vocabularies: value -> its category. Values shorter than three characters are left out.
 * @param {{ parties?: { abbreviations?: Array<unknown[] | { abbreviation?: unknown, fullName?: unknown, spellings?: unknown }> }, councils?: { councils?: Array<Record<string, unknown>>, types?: Record<string, unknown> }, statuses?: { machines?: Record<string, Record<string, unknown>> }, statusMachines?: string[], layerTypes?: { types?: Record<string, unknown> }, electionTypes?: { votingSystems?: Record<string, unknown>, electionKinds?: Record<string, unknown> }, extra?: Record<string, string[]> }} registries
 * @returns {Map<string, string>}
 */
export function buildVocabulary(registries) {
  /** @type {Map<string, string>} */
  const vocab = new Map();
  const add = (/** @type {unknown} */ value, /** @type {string} */ category) => {
    const v = norm(value);
    if (v.length >= 3 && !vocab.has(v)) vocab.set(v, category);
  };
  for (const row of registries.parties?.abbreviations || []) {
    // [abbreviation, name, ...spellings] (the browser slice) or { abbreviation, fullName, spellings } (data/registries)
    const values = Array.isArray(row) ? row : [row.abbreviation, row.fullName, ...(Array.isArray(row.spellings) ? row.spellings : [])];
    for (const v of values) if (typeof v === 'string') add(v, 'party');
  }
  for (const council of registries.councils?.councils || []) for (const key of ['id', 'bodySlug', 'name']) if (typeof council[key] === 'string') add(council[key], 'body');
  for (const type of Object.keys(registries.councils?.types || {})) add(type, 'body type');
  for (const [name, machine] of Object.entries(registries.statuses?.machines || {})) {
    if (registries.statusMachines && !registries.statusMachines.includes(name)) continue;
    for (const state of Object.keys(/** @type {Record<string, unknown>} */ (machine.transitions || {}))) add(state, 'status');
    for (const v of /** @type {unknown[]} */ (Array.isArray(machine.values) ? machine.values : [])) add(v, 'status');
    for (const [spelling, meaning] of Object.entries(/** @type {Record<string, unknown>} */ (machine.spellings || {}))) { add(spelling, 'status'); add(meaning, 'status'); }
  }
  for (const type of Object.keys(registries.layerTypes?.types || {})) add(type, 'layer type');
  for (const system of Object.keys(registries.electionTypes?.votingSystems || {})) add(system, 'voting system');
  for (const kind of Object.keys(registries.electionTypes?.electionKinds || {})) add(kind, 'election kind');
  for (const [category, values] of Object.entries(registries.extra || {})) for (const v of values) add(v, category);
  return vocab;
}

/** @param {Context} ctx */
function loadVocabulary(ctx) {
  const given = /** @type {Map<string, string> | undefined} */ (ctx.options.vocabulary);
  if (given) return given;
  const read = (/** @type {string} */ rel) => JSON.parse(readFileSync(path.join(ctx.root, rel), 'utf8'));
  const cfg = /** @type {{ extraVocabulary?: Record<string, string[]>, statusMachines?: string[] }} */ (ctx.config.C4 || {});
  return buildVocabulary({
    parties: read('data/registries/parties.json'),
    councils: read('data/registries/councils.json'),
    statuses: read('data/registries/statuses.json'),
    statusMachines: cfg.statusMachines,
    layerTypes: read('data/registries/layer-types.json'),
    electionTypes: read('data/registries/election-types.json'),
    extra: Object.fromEntries(Object.entries(cfg.extraVocabulary || {}).filter(([k]) => k !== '//')),
  });
}

/**
 * The string values a literal node holds, if it is one of the literal kinds C4 reads.
 * @param {AstNode} n
 * @returns {{ kind: string, values: string[] } | null}
 */
export function literalValues(n) {
  if (n.type === 'ArrayExpression') {
    const elements = /** @type {Array<AstNode | null>} */ (n.elements);
    const strings = elements.filter(isString).map((e) => e.value);
    if (strings.length) return { kind: 'array', values: strings };
    // A table: rows that are arrays, keyed by their first cell (new Map([[k, v], ...]), [[k, v], ...]).
    const keys = elements.map((e) => (e && e.type === 'ArrayExpression' ? /** @type {Array<AstNode | null>} */ (e.elements)[0] : null)).filter(isString).map((e) => e.value);
    if (keys.length) return { kind: 'table', values: keys };
    return null;
  }
  if (n.type === 'ObjectExpression') {
    const keys = /** @type {AstNode[]} */ (n.properties).filter((p) => p.type === 'Property' && !p.computed).map((p) => {
      const key = /** @type {AstNode} */ (p.key);
      return key.type === 'Identifier' ? /** @type {string} */ (key.name) : isString(key) ? key.value : null;
    }).filter((k) => k !== null);
    return keys.length ? { kind: 'object keys', values: /** @type {string[]} */ (keys) } : null;
  }
  if (n.type === 'Literal' && n.regex) {
    const pattern = /** @type {{ pattern: string }} */ (n.regex).pattern;
    if (!pattern.includes('|')) return null;
    return { kind: 'regex', values: pattern.replace(/\\b|[()^$?:]/g, '').split('|').map((s) => s.replace(/\\s[*+]?|\\-/g, (m) => (m === '\\-' ? '-' : ' '))) };
  }
  if (n.type === 'SwitchStatement') {
    const tests = /** @type {AstNode[]} */ (n.cases).map((c) => /** @type {AstNode | null} */ (c.test)).filter(isString).map((t) => t.value);
    return tests.length ? { kind: 'switch cases', values: tests } : null;
  }
  return null;
}

export const C4 = {
  id: 'C4',
  rule: 'R6',
  title: 'no literal holds two or more values of one registry vocabulary',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[] }} */ (ctx.config.C4);
    const vocab = loadVocabulary(ctx);
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg)) {
      walk(ctx.parse(file).ast, (n) => {
        const lit = literalValues(n);
        if (!lit) return;
        /** @type {Map<string, Set<string>>} */
        const byCategory = new Map();
        for (const v of lit.values) {
          const category = vocab.get(norm(v));
          if (!category) continue;
          if (!byCategory.has(category)) byCategory.set(category, new Set());
          /** @type {Set<string>} */ (byCategory.get(category)).add(norm(v));
        }
        for (const [category, hits] of byCategory) {
          if (hits.size >= 2) out.push({ file, line: lineOf(n), message: `${lit.kind} holds ${hits.size} ${category} values (${[...hits].slice(0, 4).join(', ')}): read them from the registry` });
        }
      });
    }
    return out;
  },
};
