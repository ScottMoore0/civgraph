/**
 * The state checks (rule R7, no implicit state machines).
 *
 * C6, the state-machine lint, on new or changed lines only (the diff since the branch left main;
 * `--all` reads every line, for the report's repository-wide count). Three shapes:
 *   (a) a variable or property named *state|status|mode|phase|stage|step|view|kind|tab that is
 *       assigned a string literal and assigned or compared with three or more distinct ones (a
 *       value only compared, such as a handler's dispatch on its view parameter, is not state), where those values are
 *       not declared: neither in a call of the typed-state helpers (defineMachine, defineToggle,
 *       defineChoice, createState, createFlag, createLatch, defineFlagFields, createHoldCount:
 *       packages/core/src/state-machine.mjs, packages/map/src/state-helpers.mjs, served as
 *       /assets/ui/state/machine.js) nor in a JSDoc string union in the same file;
 *   (b) two or more booleans that one function sets both true and false (co-changing flags),
 *       unless they are flag fields of the helpers (defineFlagFields / createFlag);
 *   (c) a module-level `let` that holds a promise and is reset to null in a .catch() (a memoised
 *       promise used as state).
 * C12, machine coverage: every state-machines module is imported by a test, and every machine it
 *     defines (defineMachine / defineToggle / defineChoice) is named in a test.
 */
import { isFunction, isString, lineOf, nameOf, walk } from './lib.mjs';

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding @typedef {import('./lib.mjs').AstNode} AstNode */

const STATE_NAME = /(state|status|mode|phase|stage|step|view|kind|tab)$/i;
export const HELPERS = new Set(['defineMachine', 'defineToggle', 'defineChoice', 'createState', 'createFlag', 'createLatch', 'defineFlagFields', 'createHoldCount']);

/**
 * The string values a file declares as states: every string inside a helper call, and every
 * quoted member of a JSDoc type union.
 * @param {AstNode | null} ast
 * @param {Array<{ value: string }>} comments
 */
function declaredValues(ast, comments) {
  /** @type {Set<string>} */
  const declared = new Set();
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && HELPERS.has(nameOf(/** @type {AstNode} */ (n.callee)) || '')) {
      for (const arg of /** @type {AstNode[]} */ (n.arguments)) {
        walk(arg, (inner) => {
          if (isString(inner)) declared.add(inner.value);
          if (inner.type === 'Property') {
            const key = /** @type {AstNode} */ (inner.key);
            if (key.type === 'Identifier') declared.add(/** @type {string} */ (key.name));
          }
        });
      }
    }
  });
  for (const c of comments) {
    for (const union of c.value.matchAll(/\{([^{}]*'[^{}]*\|[^{}]*)\}/g)) for (const q of union[1].matchAll(/'([^']*)'|"([^"]*)"/g)) declared.add(q[1] ?? q[2]);
    for (const td of c.value.matchAll(/@typedef\s+\{([^}]*)\}/g)) for (const q of td[1].matchAll(/'([^']*)'|"([^"]*)"/g)) declared.add(q[1] ?? q[2]);
  }
  return declared;
}

/**
 * The string literals an expression can evaluate to: a literal, either branch of a conditional,
 * either side of || and ?? (`params.get('mode') || 'winner'`).
 * @param {AstNode | null | undefined} node
 * @returns {string[]}
 */
function assignedStrings(node) {
  if (!node) return [];
  if (isString(node)) return [node.value];
  if (node.type === 'ConditionalExpression') return [...assignedStrings(/** @type {AstNode} */ (node.consequent)), ...assignedStrings(/** @type {AstNode} */ (node.alternate))];
  if (node.type === 'LogicalExpression' && node.operator !== '&&') return [...assignedStrings(/** @type {AstNode} */ (node.left)), ...assignedStrings(/** @type {AstNode} */ (node.right))];
  return [];
}

/**
 * The C6 candidates of one file, every line (the caller keeps those on changed lines).
 * @param {AstNode | null} ast
 * @param {Array<{ value: string, line: number }>} comments
 * @returns {Array<{ lines: number[], message: string }>}
 */
export function stateCandidates(ast, comments) {
  if (!ast) return [];
  const declared = declaredValues(ast, comments);
  /** @type {Array<{ lines: number[], message: string }>} */
  const out = [];

  // (a) string-state variables
  // A value only compared (a dispatch on a parameter) is not state; one the code also assigns is.
  /** @type {Map<string, { values: Set<string>, lines: number[], assigned: boolean }>} */
  const vars = new Map();
  const note = (/** @type {string | null} */ name, /** @type {string} */ value, /** @type {number} */ line, assigned = false) => {
    if (!name || !STATE_NAME.test(name)) return;
    if (!vars.has(name)) vars.set(name, { values: new Set(), lines: [], assigned: false });
    const v = /** @type {{ values: Set<string>, lines: number[], assigned: boolean }} */ (vars.get(name));
    v.values.add(value);
    v.lines.push(line);
    if (assigned) v.assigned = true;
  };
  walk(ast, (n) => {
    if (n.type === 'AssignmentExpression') for (const v of assignedStrings(/** @type {AstNode} */ (n.right))) note(nameOf(/** @type {AstNode} */ (n.left)), v, lineOf(n), true);
    if (n.type === 'VariableDeclarator' && /** @type {AstNode} */ (n.id).type === 'Identifier') for (const v of assignedStrings(/** @type {AstNode | null} */ (n.init))) note(nameOf(/** @type {AstNode} */ (n.id)), v, lineOf(n), true);
    if (n.type === 'BinaryExpression' && /^[!=]==?$/.test(/** @type {string} */ (n.operator))) {
      const left = /** @type {AstNode} */ (n.left);
      const right = /** @type {AstNode} */ (n.right);
      if (isString(right)) note(nameOf(left), right.value, lineOf(n));
      else if (isString(left)) note(nameOf(right), left.value, lineOf(n));
    }
    if (n.type === 'SwitchStatement') {
      const name = nameOf(/** @type {AstNode} */ (n.discriminant));
      for (const c of /** @type {AstNode[]} */ (n.cases)) if (isString(/** @type {AstNode} */ (c.test))) note(name, /** @type {string} */ (/** @type {AstNode} */ (c.test).value), lineOf(c));
    }
  });
  for (const [name, { values, lines, assigned }] of vars) {
    const undeclared = [...values].filter((v) => !declared.has(v));
    if (assigned && values.size >= 3 && undeclared.length) out.push({ lines, message: `${name} takes ${values.size} string states (${[...values].slice(0, 5).join('|')}) with no machine: a defineMachine table (or a JSDoc union for a derived kind)` });
  }

  // (b) co-changing boolean flags, per function body (nested functions are their own)
  walk(ast, (fn) => {
    if (!isFunction(fn)) return;
    /** @type {Map<string, { t: boolean, f: boolean, lines: number[] }>} */
    const flags = new Map();
    walk(/** @type {AstNode} */ (fn.body), (n, ancestors) => {
      if (ancestors.some(isFunction)) return; // a nested function is its own body
      if (n.type !== 'AssignmentExpression') return;
      const right = /** @type {AstNode} */ (n.right);
      if (right.type !== 'Literal' || typeof right.value !== 'boolean') return;
      const name = nameOf(/** @type {AstNode} */ (n.left));
      if (!name || declared.has(name)) return;
      if (!flags.has(name)) flags.set(name, { t: false, f: false, lines: [] });
      const flag = /** @type {{ t: boolean, f: boolean, lines: number[] }} */ (flags.get(name));
      if (right.value) flag.t = true; else flag.f = true;
      flag.lines.push(lineOf(n));
    });
    const both = [...flags].filter(([, f]) => f.t && f.f);
    if (both.length >= 2) out.push({ lines: both.flatMap(([, f]) => f.lines), message: `${both.length} booleans set true and false together (${both.map(([k]) => k).slice(0, 4).join(', ')}): one machine, or flags from the typed-state helper` });
  });

  // (c) a memoised promise as state
  const body = /** @type {AstNode[]} */ (ast.body || []);
  /** @type {Map<string, number>} */
  const moduleLets = new Map();
  for (const stmt of body) {
    if (stmt.type !== 'VariableDeclaration' || stmt.kind !== 'let') continue;
    for (const d of /** @type {AstNode[]} */ (stmt.declarations)) {
      const init = /** @type {AstNode | null} */ (d.init);
      if (/** @type {AstNode} */ (d.id).type === 'Identifier' && (!init || (init.type === 'Literal' && init.value === null))) moduleLets.set(/** @type {string} */ (/** @type {AstNode} */ (d.id).name), lineOf(d));
    }
  }
  if (moduleLets.size) {
    /** @type {Set<string>} */
    const promised = new Set();
    /** @type {Map<string, number>} */
    const resetInCatch = new Map();
    walk(ast, (n, ancestors) => {
      if (n.type !== 'AssignmentExpression') return;
      const name = nameOf(/** @type {AstNode} */ (n.left));
      if (!name || !moduleLets.has(name) || /** @type {AstNode} */ (n.left).type !== 'Identifier') return;
      const right = /** @type {AstNode} */ (n.right);
      if (right.type === 'CallExpression' || right.type === 'NewExpression') promised.add(name);
      if (right.type === 'Literal' && right.value === null) {
        const inCatch = ancestors.some((a) => a.type === 'CallExpression' && nameOf(/** @type {AstNode} */ (a.callee)) === 'catch');
        if (inCatch) resetInCatch.set(name, lineOf(n));
      }
    });
    for (const [name, line] of resetInCatch) {
      if (promised.has(name)) out.push({ lines: [/** @type {number} */ (moduleLets.get(name)), line], message: `${name} is a memoised promise reset in .catch() (a promise used as state): an explicit idle/loading/ready/failed machine` });
    }
  }
  return out;
}

export const C6 = {
  id: 'C6',
  rule: 'R7',
  title: 'state-machine lint (string states, co-changing flags, promise-as-state) on new or changed lines',
  diffScoped: true,
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[] }} */ (ctx.config.C6);
    const changed = ctx.changedLines;
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg)) {
      if (changed && !changed.has(file)) continue;
      const { ast, comments } = ctx.parse(file);
      for (const c of stateCandidates(ast, comments)) {
        const lines = changed ? c.lines.filter((l) => /** @type {Set<number>} */ (changed.get(file)).has(l)) : c.lines;
        if (lines.length) out.push({ file, line: Math.min(...lines), message: c.message });
      }
    }
    return out;
  },
};

export const C12 = {
  id: 'C12',
  rule: 'R7',
  title: 'every state-machines module is imported by a test, and each machine it defines is named in one',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[], tests: string[], modules: string }} */ (ctx.config.C12);
    const modulePattern = new RegExp(cfg.modules);
    const tests = ctx.select({ include: cfg.tests }).map((f) => ({ file: f, text: ctx.read(f) }));
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg).filter((f) => modulePattern.test(f))) {
      const base = file.split('/').slice(-2).join('/');
      const importers = tests.filter((t) => t.text.includes(base));
      if (!importers.length) {
        out.push({ file, line: 1, message: `no test under ${cfg.tests.join(', ')} imports ${base}: walk its machines (assertTransition on every forbidden move)` });
        continue;
      }
      walk(ctx.parse(file).ast, (n) => {
        if (n.type !== 'VariableDeclarator') return;
        const init = /** @type {AstNode | null} */ (n.init);
        if (!init || init.type !== 'CallExpression' || !['defineMachine', 'defineToggle', 'defineChoice'].includes(nameOf(/** @type {AstNode} */ (init.callee)) || '')) return;
        const name = nameOf(/** @type {AstNode} */ (n.id));
        if (name && !importers.some((t) => new RegExp(`\\b${name}\\b`).test(t.text))) out.push({ file, line: lineOf(n), message: `machine ${name} is named in no test that imports ${base}` });
      });
    }
    return out;
  },
};
