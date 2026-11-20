/**
 * The editor-time mirror of check:boundaries (REFACTOR-PLAN.md section 2.2: "eslint's
 * no-restricted-imports is the editor-time hint for the same rules"). An eslint rule,
 * `civgraph/boundaries`, that flags the imports check:boundaries fails, where the import is written:
 *   - an import, re-export or literal import() whose unit may not import the target's unit;
 *   - node:* in a unit with "node": false;
 *   - an @civgraph name no export reaches;
 *   - an engine API (boundaries.json `engines.modules`) outside the units that may use one.
 *
 * It is not a copy of the rules: it reads config/boundaries.json through scripts/check/boundaries.mjs,
 * and each verdict is that module's own (edgeOf, engineOf, mayUseEngine, the two baselines). So a
 * rule changed in boundaries.json reaches the editor with no change here. eslint.config.mjs turns
 * it on for every file eslint lints; a file in no unit, or one the check leaves out (vendored,
 * minified, build output), is not looked at.
 *
 * check:boundaries stays the gate (npm run check, CI): it also reads the JSDoc type import()s the
 * engine rule covers, which this rule does not see (they are comments to the parser).
 *
 *   Its unit test (eslint-boundaries.test.mjs) holds it to check:boundaries' verdicts.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { edgeOf, engineInBaseline, engineOf, inBaseline, mayUseEngine, skipped, unitOf } from './boundaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The repository-relative path of a file eslint lints, or null when it is outside the repository.
 * @param {string} filename  absolute, as eslint gives it
 * @param {string} [root]
 * @returns {string | null}
 */
export function repoPath(filename, root = ROOT) {
  const rel = path.relative(root, filename).split(path.sep).join('/');
  return rel.startsWith('../') || path.isAbsolute(rel) ? null : rel;
}

/**
 * The messages check:boundaries would give for one import specifier of a file (none when allowed).
 * Pure apart from boundaries.json, which boundaries.mjs reads once.
 * @param {string} file  repository-relative
 * @param {string} spec
 * @returns {string[]}
 */
export function violations(file, spec) {
  /** @type {string[]} */
  const out = [];
  if (skipped(file)) return out;
  const unit = unitOf(file);
  if (unit === null) return out;
  const edge = edgeOf(file, spec);
  if (edge && !edge.ok && !inBaseline(edge)) {
    out.push(edge.to === 'unresolved'
      ? `${spec}: no export of the package reaches this name (check:boundaries)`
      : `${unit} may not import ${edge.to === null ? 'a file in no unit' : edge.to} (${edge.target}); config/boundaries.json, check:boundaries`);
  }
  const engine = engineOf(spec);
  if (engine && !mayUseEngine(unit) && !engineInBaseline(file, engine)) {
    out.push(`${engine} is an engine API: open it through packages/storage (config/boundaries.json engines, check:boundaries)`);
  }
  return out;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'The import rules between the parts of the repository (config/boundaries.json), as check:boundaries applies them' },
    schema: [],
  },
  create(context) {
    const file = repoPath(context.filename);
    if (file === null || skipped(file) || unitOf(file) === null) return {};
    /** @param {import('estree').Node | null | undefined} source */
    const check = (source) => {
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
      for (const message of violations(file, source.value)) context.report({ node: source, message });
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

/** The plugin eslint.config.mjs registers as `civgraph`. */
export const plugin = { meta: { name: 'civgraph-boundaries' }, rules: { boundaries: rule } };
