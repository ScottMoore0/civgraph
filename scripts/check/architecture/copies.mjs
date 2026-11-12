/**
 * C3 (rule R2, use the package; never copy it): a function in the served or map-app code
 * (config `include`) with the name and arity of a function exported by the shared packages
 * (config `packages`: packages/core/src, packages/ui/src/templates) is taken for a copy. A copy
 * must say so, with `copy-of: <path>` in a comment on its line or the three above, and a marked
 * copy must have a parity test: a file under tests/ naming both the function and the copying file.
 * A name match is crude, which is why it is limited to the packages' exported names. A thin
 * adapter is not a copy: a function whose body is one statement that calls a binding the file
 * imports (`return String(chip(name, colour))`, the package function reached through /pkg/).
 */
import { isFunction, lineOf, walk } from './lib.mjs';

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding @typedef {import('./lib.mjs').AstNode} AstNode */

/**
 * The function a declaration defines: `{ name, arity }`, or null.
 * @param {AstNode} n
 */
function definedFunction(n) {
  if (n.type === 'FunctionDeclaration' && n.id) return { name: /** @type {string} */ (/** @type {AstNode} */ (n.id).name), arity: /** @type {unknown[]} */ (n.params).length };
  if (n.type === 'VariableDeclarator' && n.init && isFunction(/** @type {AstNode} */ (n.init)) && /** @type {AstNode} */ (n.id).type === 'Identifier') {
    return { name: /** @type {string} */ (/** @type {AstNode} */ (n.id).name), arity: /** @type {unknown[]} */ (/** @type {AstNode} */ (n.init).params).length };
  }
  return null;
}

/**
 * Whether a function is a thin adapter over an imported function: its body is one statement (or an
 * expression) that calls a binding the file imports.
 * @param {AstNode} n the declaration definedFunction() read
 * @param {Set<string>} imported
 */
function adapter(n, imported) {
  const fn = /** @type {AstNode} */ (n.type === 'FunctionDeclaration' ? n : n.init);
  const body = /** @type {AstNode} */ (fn.body);
  if (body.type === 'BlockStatement' && /** @type {AstNode[]} */ (body.body).length !== 1) return false;
  let calls = false;
  walk(body, (m) => {
    const callee = /** @type {AstNode} */ (m.callee);
    if (m.type === 'CallExpression' && callee.type === 'Identifier' && imported.has(/** @type {string} */ (callee.name))) calls = true;
  });
  return calls;
}

export const C3 = {
  id: 'C3',
  rule: 'R2',
  title: 'a copy of a package function is marked copy-of: <path> and has a parity test',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[], packages: string[], tests: string[] }} */ (ctx.config.C3);
    /** @type {Map<string, { file: string, arity: number }>} */
    const exported = new Map();
    for (const file of ctx.select({ include: cfg.packages })) {
      walk(ctx.parse(file).ast, (n) => {
        if (n.type !== 'ExportNamedDeclaration' || !n.declaration) return;
        const d = /** @type {AstNode} */ (n.declaration);
        const defs = d.type === 'VariableDeclaration' ? /** @type {AstNode[]} */ (d.declarations).map(definedFunction) : [definedFunction(d)];
        for (const def of defs) if (def && !exported.has(def.name)) exported.set(def.name, { file, arity: def.arity });
      });
    }
    const tests = ctx.select({ include: cfg.tests }).map((f) => ctx.read(f));
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg)) {
      const lines = ctx.lines(file);
      const base = file.split('/').pop() || file;
      const { ast } = ctx.parse(file);
      /** @type {Set<string>} */
      const imported = new Set();
      walk(ast, (n) => {
        if (n.type !== 'ImportDeclaration') return;
        for (const sp of /** @type {AstNode[]} */ (n.specifiers)) imported.add(/** @type {string} */ (/** @type {AstNode} */ (sp.local).name));
      });
      walk(ast, (n) => {
        const def = definedFunction(n);
        const pkg = def && exported.get(def.name);
        if (!def || !pkg || pkg.arity !== def.arity || adapter(n, imported)) return;
        const line = lineOf(n);
        const marked = lines.slice(Math.max(0, line - 4), line).some((l) => /copy-of:\s*\S/.test(l));
        if (!marked) out.push({ file, line, message: `${def.name}() looks like a copy of ${pkg.file}: import it (served pkg/ mapping or bundle), or mark it // copy-of: ${pkg.file} with a parity test` });
        else if (!tests.some((t) => t.includes(def.name) && t.includes(base))) out.push({ file, line, message: `${def.name}() is a marked copy with no parity test (a test naming ${def.name} and ${base})` });
      });
    }
    return out;
  },
};
