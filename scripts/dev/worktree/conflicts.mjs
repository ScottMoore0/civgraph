/**
 * Which rebase conflicts the landing queue (npm run land) may resolve by itself, and how. Pure:
 * the rules come from config/worktrees.json landing.generated and the conflicted text is passed in.
 *
 * A rule names files by glob and a way to resolve:
 *   file    any conflict: take main's whole file (it is regenerated afterwards);
 *   hunks   take main's side of each conflict, but only when every line on both sides matches
 *           the rule's `line` pattern (an import map is one line of a hand-written page);
 *   tokens  take main's side of each conflict, but only when the two sides differ in nothing but
 *           ?v= cache tokens.
 * During a rebase "ours" (the HEAD side, between <<<<<<< and =======) is main's.
 */

/** @typedef {{ name: string, files: string[], resolve: 'file' | 'hunks' | 'tokens', line?: string, regenerate: Array<{ npm: string }>, note?: string }} Rule */
/** @typedef {{ ours: string[], theirs: string[] }} Block */

/**
 * A glob as a regular expression: ** any path, * any name part, ? one character.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = /** @type {string} i is within the glob */ (glob[i]);
    if (c === '*' && glob[i + 1] === '*') {
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * The rules whose globs match a repository path (forward slashes).
 * @param {string} file
 * @param {Rule[]} rules
 */
export const rulesFor = (file, rules) => rules.filter((rule) => rule.files.some((glob) => globToRegExp(glob).test(file)));

/**
 * Split conflicted text into its pieces: plain lines and conflict blocks (a diff3 base section,
 * between ||||||| and =======, is dropped). Lines keep their line endings.
 * @param {string} text
 * @returns {Array<string | Block>}
 */
export function parseConflicts(text) {
  /** @type {Array<string | Block>} */
  const pieces = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  /** @type {Block | null} */
  let block = null;
  let side = '';
  for (const line of lines) {
    if (!block && line.startsWith('<<<<<<< ')) { block = { ours: [], theirs: [] }; side = 'ours'; continue; }
    if (block && line.startsWith('||||||| ')) { side = 'base'; continue; }
    if (block && /^=======\r?\n?$/.test(line)) { side = 'theirs'; continue; }
    if (block && line.startsWith('>>>>>>> ')) { pieces.push(block); block = null; continue; }
    if (!block) pieces.push(line);
    else if (side === 'ours') block.ours.push(line);
    else if (side === 'theirs') block.theirs.push(line);
  }
  if (block) throw new Error('an unterminated conflict block');
  return pieces;
}

const TOKEN = /\?v=[A-Za-z0-9._-]+/g;

/**
 * Whether a rule may take main's side of one conflict block.
 * @param {Rule} rule
 * @param {Block} block
 */
export function acceptsBlock(rule, block) {
  if (rule.resolve === 'file') return true;
  if (rule.resolve === 'hunks') {
    const pattern = new RegExp(String(rule.line));
    const all = [...block.ours, ...block.theirs];
    return all.length > 0 && all.every((line) => pattern.test(line));
  }
  if (rule.resolve === 'tokens') {
    const strip = (/** @type {string[]} */ side) => side.map((line) => line.replace(TOKEN, '?v='));
    return block.ours.length > 0 && JSON.stringify(strip(block.ours)) === JSON.stringify(strip(block.theirs));
  }
  return false;
}

/**
 * How a conflicted file is resolved, or why it cannot be.
 * @param {string} file repository path, forward slashes
 * @param {string | null} text the conflicted file's text (null when a side deleted it, or it is binary)
 * @param {Rule[]} rules
 * @returns {{ ok: true, whole: boolean, text?: string, rules: Rule[] } | { ok: false, reason: string }}
 */
export function resolveConflict(file, text, rules) {
  const matching = rulesFor(file, rules);
  if (!matching.length) return { ok: false, reason: 'not a generated file' };
  const whole = matching.find((rule) => rule.resolve === 'file');
  if (whole) return { ok: true, whole: true, rules: [whole] };
  if (text === null) return { ok: false, reason: 'deleted on one side, or not text' };
  let pieces;
  try { pieces = parseConflicts(text); } catch (error) { return { ok: false, reason: /** @type {Error} */ (error).message }; }
  /** @type {Set<Rule>} */
  const used = new Set();
  let out = '';
  for (const piece of pieces) {
    if (typeof piece === 'string') { out += piece; continue; }
    const rule = matching.find((r) => acceptsBlock(r, piece));
    if (!rule) return { ok: false, reason: `a conflict that is not only ${matching.map((r) => r.name).join(' or ')}` };
    used.add(rule);
    out += piece.ours.join('');
  }
  if (!used.size) return { ok: false, reason: 'no conflict markers found' };
  return { ok: true, whole: false, text: out, rules: [...used] };
}

/**
 * The regeneration steps of the rules used, each once, in the rules' order.
 * @param {Rule[]} used
 * @param {Rule[]} rules
 */
export function regenerationSteps(used, rules) {
  const seen = new Set();
  /** @type {Array<{ npm: string }>} */
  const steps = [];
  for (const rule of rules) {
    if (!used.includes(rule)) continue;
    for (const step of rule.regenerate) {
      const key = JSON.stringify(step);
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push(step);
    }
  }
  return steps;
}
