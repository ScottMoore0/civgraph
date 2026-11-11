/**
 * C7 (rule R8, views clean up after themselves): a listener added to a long-lived target —
 * `document`, `window`, `globalThis`, `self`, or a function parameter named root/container (a
 * router's persistent view root) — inside a function must be removable: it passes an options
 * object with `signal` (or `once: true`), an options variable named for a signal, or the same
 * file removes it (removeEventListener with the same event on the same target). A listener at
 * module top level is registered once, and is fine. This is the pattern of the Elections app's
 * swing and notional views (ELECTIONS-APP-AUDIT.md), whose input listeners pile up on the view root.
 */
import { isFunction, isString, lineOf, nameOf, walk } from './lib.mjs';

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding @typedef {import('./lib.mjs').AstNode} AstNode */

const GLOBAL_TARGETS = new Set(['document', 'window', 'globalThis', 'self']);
const ROOT_PARAM = /^(root|container)$|(Root|Container)$/;

/** @param {AstNode} node @returns {string | null} */
const sourceText = (node) => {
  if (node.type === 'Identifier') return /** @type {string} */ (node.name);
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression' && !node.computed) {
    /** @type {string | null} */
    const obj = sourceText(/** @type {AstNode} */ (node.object));
    return obj === null ? null : `${obj}.${nameOf(node)}`;
  }
  return null;
};

/**
 * The long-lived target a call adds a listener to, if any.
 * @param {AstNode} target
 * @param {AstNode[]} ancestors
 */
function longLived(target, ancestors) {
  const text = sourceText(target);
  if (!text) return null;
  const head = text.split('.')[0];
  if (GLOBAL_TARGETS.has(head)) return text;
  if (target.type === 'Identifier' && ROOT_PARAM.test(text)) {
    for (const fn of ancestors.filter(isFunction)) {
      const params = /** @type {AstNode[]} */ (fn.params);
      const names = params.flatMap((p) => {
        if (p.type === 'Identifier') return [p.name];
        if (p.type === 'AssignmentPattern') return [nameOf(/** @type {AstNode} */ (p.left))];
        if (p.type === 'ObjectPattern') return /** @type {AstNode[]} */ (p.properties).map((q) => nameOf(/** @type {AstNode} */ (q.value)));
        return [];
      });
      if (names.includes(text)) return text;
    }
  }
  return null;
}

/** @param {AstNode | undefined} options */
function removable(options) {
  if (!options) return false;
  if (options.type === 'ObjectExpression') {
    return /** @type {AstNode[]} */ (options.properties).some((p) => {
      if (p.type === 'SpreadElement') return true;
      const key = nameOf(/** @type {AstNode} */ (p.key));
      const value = /** @type {AstNode} */ (p.value);
      return key === 'signal' || (key === 'once' && value.type === 'Literal' && value.value === true);
    });
  }
  const name = sourceText(options);
  return Boolean(name && /signal|listenerOptions|lifecycle/i.test(name));
}

export const C7 = {
  id: 'C7',
  rule: 'R8',
  title: 'listeners on long-lived targets pass { signal } or are removed',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[] }} */ (ctx.config.C7);
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg)) {
      const { ast } = ctx.parse(file);
      /** @type {Set<string>} */
      const removed = new Set();
      /** @type {Array<{ target: string, type: string, line: number }>} */
      const added = [];
      walk(ast, (n, ancestors) => {
        if (n.type !== 'CallExpression') return;
        const callee = /** @type {AstNode} */ (n.callee);
        const method = nameOf(callee);
        if (callee.type !== 'MemberExpression' || (method !== 'addEventListener' && method !== 'removeEventListener')) return;
        const args = /** @type {AstNode[]} */ (n.arguments);
        const type = isString(args[0]) ? args[0].value : '*';
        const object = /** @type {AstNode} */ (callee.object);
        if (method === 'removeEventListener') {
          removed.add(`${sourceText(object)} ${type}`);
          return;
        }
        if (!ancestors.some(isFunction)) return; // module top level: registered once
        const target = longLived(object, ancestors);
        if (!target || removable(args[2])) return;
        added.push({ target, type, line: lineOf(n) });
      });
      for (const a of added) {
        if (removed.has(`${a.target} ${a.type}`)) continue;
        out.push({ file, line: a.line, message: `${a.target}.addEventListener('${a.type}') inside a function, with no { signal } and no removeEventListener: it outlives the view` });
      }
    }
    return out;
  },
};
