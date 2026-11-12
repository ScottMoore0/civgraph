/**
 * C13: the charter's own test. docs/ARCHITECTURE-RULES.md exists with a status banner, holds
 * rules R1 to R15 in order, and each rule has a "Checked by" line naming what enforces it: an
 * npm script that exists (`check:...`, `test:...`), a check of this runner (C1...), or "review".
 * The files every session loads (CLAUDE.md, AGENTS.md) point to it.
 */

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding */

/**
 * The problems of a charter text, as [line, message] pairs.
 * @param {string} text
 * @param {{ scripts: Record<string, string>, checkIds: readonly string[], ruleCount: number }} known
 * @returns {Array<[number, string]>}
 */
export function charterProblems(text, known) {
  /** @type {Array<[number, string]>} */
  const out = [];
  const lines = text.split('\n');
  if (!lines.slice(0, 14).some((l) => /^>\s*\*\*Status:/.test(l))) out.push([1, 'no `> **Status:` banner in the first 14 lines (check:doc-status)']);
  /** @type {Array<{ n: number, line: number, body: string[] }>} */
  const rules = [];
  lines.forEach((line, i) => {
    const m = line.match(/^\*\*R(\d+)\.\s/);
    if (m) rules.push({ n: Number(m[1]), line: i + 1, body: [] });
    else if (rules.length && !/^#{1,3} /.test(line)) rules[rules.length - 1].body.push(line);
    else if (/^#{1,3} /.test(line) && rules.length) rules.push({ n: -1, line: i + 1, body: [] }); // a heading closes the rule
  });
  const real = rules.filter((r) => r.n > 0);
  const numbers = real.map((r) => r.n);
  const expected = Array.from({ length: known.ruleCount }, (_, i) => i + 1);
  if (numbers.join() !== expected.join()) out.push([1, `rules are ${numbers.map((n) => `R${n}`).join(', ') || 'missing'}; expected R1 to R${known.ruleCount} in order`]);
  for (const rule of real) {
    const checked = rule.body.find((l) => /Checked by\b/i.test(l));
    if (!checked) { out.push([rule.line, `R${rule.n} has no "Checked by" line`]); continue; }
    const names = [...checked.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const scripts = names.filter((n) => /^(check|test|lint)(:|$)/.test(n));
    const ids = [...checked.matchAll(/\bC(\d+)\b/g)].map((m) => `C${m[1]}`);
    const exists = (/** @type {string} */ s) => (s.endsWith('*') ? Object.keys(known.scripts).some((k) => k.startsWith(s.slice(0, -1))) : Boolean(known.scripts[s]));
    for (const s of scripts) if (!exists(s)) out.push([rule.line, `R${rule.n} names ${s}, which is not an npm script`]);
    for (const id of ids) if (!known.checkIds.includes(id)) out.push([rule.line, `R${rule.n} names ${id}, which check:architecture does not run`]);
    if (!scripts.length && !ids.length && !/\breview\b/i.test(checked)) out.push([rule.line, `R${rule.n}'s "Checked by" names no check and does not say review`]);
  }
  return out;
}

export const C13 = {
  id: 'C13',
  rule: 'R15',
  title: 'the charter: present, R1-R15 each with what checks it, and pointed to by CLAUDE.md and AGENTS.md',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ path: string, pointers: string[], ruleCount: number }} */ (ctx.config.C13);
    const text = ctx.read(cfg.path);
    /** @type {Finding[]} */
    const out = [];
    if (!text) return [{ file: cfg.path, line: 0, message: 'the charter is missing' }];
    const scripts = JSON.parse(ctx.read('package.json') || '{}').scripts || {};
    const checkIds = /** @type {string[]} */ (ctx.options.checkIds || []);
    for (const [line, message] of charterProblems(text, { scripts, checkIds, ruleCount: cfg.ruleCount })) out.push({ file: cfg.path, line, message });
    for (const pointer of cfg.pointers) {
      if (!ctx.read(pointer).includes(cfg.path)) out.push({ file: pointer, line: 0, message: `does not point to ${cfg.path} (the 3-line "Architecture rules" pointer)` });
    }
    return out;
  },
};
