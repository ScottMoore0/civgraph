/**
 * C1 and C2 (rule R1): the import rules keep pace with moves.
 *
 * C1: config/boundaries.json covers the tree: no unit path is left holding nothing (the site move
 *     of 8258f31b6b left six such paths, and site/ in no unit), and no import breaks the rules
 *     beyond boundaries.json's own baseline (check:boundaries enforces that part already; it is
 *     repeated here so the report shows one picture).
 * C2: every tracked script belongs to a unit, or is listed in boundaries.json `unowned` with a
 *     reason; an `unowned` entry that matches nothing is stale.
 *
 * The context may carry `boundaries` (the functions of scripts/check/boundaries.mjs), so the
 * unit tests can hand in a fake; otherwise the real module is loaded.
 */

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding */

/**
 * @param {Context} ctx
 * @returns {Promise<{ edges: () => Array<{ file: string, target: string, ok: boolean, from: string, to: string | null }>, trackedScripts: () => string[], unownedFiles: (files: string[]) => { missing: string[], stale: string[] }, emptyUnitPaths: (tracked: string[]) => string[], baseline: string[] }>}
 */
async function boundaries(ctx) {
  const given = ctx.options.boundaries;
  if (given) return /** @type {Awaited<ReturnType<typeof boundaries>>} */ (given);
  const mod = await import('../boundaries.mjs');
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const config = JSON.parse(readFileSync(path.join(ctx.root, 'config', 'boundaries.json'), 'utf8'));
  return { edges: mod.edges, trackedScripts: mod.trackedScripts, unownedFiles: mod.unownedFiles, emptyUnitPaths: mod.emptyUnitPaths, baseline: config.baseline || [] };
}

export const C1 = {
  id: 'C1',
  rule: 'R1',
  title: 'boundaries.json covers the tree (no unit path left empty, no import outside the rules)',
  /** @param {Context} ctx @returns {Promise<Finding[]>} */
  async run(ctx) {
    const b = await boundaries(ctx);
    /** @type {Finding[]} */
    const out = [];
    for (const p of b.emptyUnitPaths(ctx.files)) out.push({ file: 'config/boundaries.json', line: 0, message: `unit path holds no tracked file (left behind by a move?): ${p}` });
    const baseline = new Set(b.baseline);
    for (const e of b.edges()) {
      if (!e.ok && !baseline.has(`${e.file} -> ${e.target}`)) out.push({ file: e.file, line: 0, message: `imports ${e.target} (${e.to}), which ${e.from} may not import` });
    }
    return out;
  },
};

export const C2 = {
  id: 'C2',
  rule: 'R1',
  title: 'every tracked script belongs to a unit (or is listed in boundaries.json unowned, with a reason)',
  /** @param {Context} ctx @returns {Promise<Finding[]>} */
  async run(ctx) {
    const b = await boundaries(ctx);
    const { missing, stale } = b.unownedFiles(b.trackedScripts());
    return [
      ...missing.map((file) => ({ file, line: 0, message: 'in no unit of config/boundaries.json: add its folder to a unit (or to `unowned`, with a reason)' })),
      ...stale.map((key) => ({ file: 'config/boundaries.json', line: 0, message: `unowned entry ${key} matches no tracked script: remove it` })),
    ];
  },
};
