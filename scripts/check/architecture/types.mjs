/**
 * C11 (rule R11, types at every boundary, tightening only): an `any` ratchet. Every explicit
 * `any` in a JSDoc type, and every @ts-ignore / @ts-nocheck, is a finding; the baseline holds
 * today's count per file, so a file's count may only fall and a new file starts at none. An
 * `any` with a reason carries `arch-ok R11: <reason>`. The check:types:* steps and their
 * allowlist tests stay the type gate; this only stops `any` creeping back.
 */

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding */

const TAG_TYPE = /@(?:type|param|returns?|typedef|property|prop|template|satisfies|this|callback)\s*\{/g;

/**
 * The 1-based lines of a source's explicit JSDoc `any`s and type-check suppressions.
 * @param {string} source
 * @returns {Array<{ line: number, what: string }>}
 */
export function anyLines(source) {
  const out = [];
  const lineAt = (/** @type {number} */ i) => source.slice(0, i).split('\n').length;
  for (const comment of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const text = comment[0];
    const base = /** @type {number} */ (comment.index);
    for (const tag of text.matchAll(TAG_TYPE)) {
      // the balanced { ... } after the tag
      let depth = 0;
      let i = /** @type {number} */ (tag.index) + tag[0].length - 1;
      const start = i;
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) break;
      }
      const type = text.slice(start, i + 1);
      for (const any of type.matchAll(/(?<![\w$.'"-])any(?![\w$'"-])/g)) out.push({ line: lineAt(base + start + /** @type {number} */ (any.index)), what: 'explicit any' });
    }
  }
  for (const s of source.matchAll(/^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@ts-(ignore|nocheck)\b/gm)) out.push({ line: lineAt(/** @type {number} */ (s.index)), what: `@ts-${s[1]}` });
  return out;
}

export const C11 = {
  id: 'C11',
  rule: 'R11',
  title: 'no new explicit any, @ts-ignore or @ts-nocheck (a per-file ratchet)',
  /** @param {Context} ctx @returns {Finding[]} */
  run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[] }} */ (ctx.config.C11);
    /** @type {Finding[]} */
    const out = [];
    for (const file of ctx.select(cfg)) {
      for (const { line, what } of anyLines(ctx.read(file))) out.push({ file, line, message: `${what}: type it (or arch-ok R11 with the reason)` });
    }
    return out;
  },
};
