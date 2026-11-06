#!/usr/bin/env node
/**
 * Merge main into the restructure branch, the same way every time.
 *
 * main keeps committing what the restructure branch no longer tracks: the election bundles,
 * summaries and provenance shards (now built into tmp/records by npm run records:build and
 * answered from D1), the app bundle (built by npm run build), and cache-busting tokens stamped
 * into the HTML pages and sw.js from those bundles. Every merge from main therefore produces the
 * same few hundred mechanical conflicts. This resolves them by rule and stops on anything else.
 *
 *   node tools/merge-main.mjs [ref]          start `git merge --no-commit --no-ff <ref>` (default
 *                                            main), then resolve by rule
 *   node tools/merge-main.mjs --resolve      only resolve, in a merge already in progress
 *   node tools/merge-main.mjs --dry-run      say what the rules would do; change nothing
 *
 * The rules, in order:
 *   1. GENERATED. A path the branch's .gitignore ignores (git check-ignore --no-index) that the
 *      merge brought into the index -- a modify/delete conflict or a file main added -- leaves the
 *      index, and its working copy is deleted: a stale static copy would shadow the Function that
 *      answers its URL (static files win over Functions on Pages and in wrangler pages dev).
 *      Then a sweep: any file still tracked in GENERATED_TREES leaves the index the same way.
 *   2. TOKENS. A conflicted file whose every conflict hunk differs only in ?v=<hex> / sw VERSION
 *      tokens takes this branch's side; the tokens are restamped after the merge by
 *      `npm run build` (maps pages, sw.js) and `node scripts/validate-browse-cache-tokens.mjs`
 *      (browse.js and browse.css tokens).
 *   3. PACKAGE.JSON. A three-way merge per key. A value both sides changed that is a chain of
 *      `cmd && cmd` steps is merged step by step: main's additions are kept at main's position
 *      and its removals applied, this branch's additions and removals are kept. Steps listed in
 *      RECORDS_STEPS are builders that belong to the records build on this branch, and are not
 *      added back to `build` (the Pages build); they are reported for scripts/records.
 *   4. Anything else is left conflicted and listed: resolve it by hand, keeping both sides' data.
 *
 * After a clean run (exit 0) or after the hand resolutions:
 *   npm run build && node scripts/validate-browse-cache-tokens.mjs
 *   git add -A -- maps browse catalogue records sw.js index.html
 *   npm run records:build && npm run records:check
 *   git commit                      (a prose message naming what main brought in)
 *
 * Nothing is pushed. Exit 0: everything resolved; 2: hand resolutions remain; 1: an error.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Builders main runs in the Pages build that this branch runs inside records:build. */
export const RECORDS_STEPS = [
  /scripts\/build-browse-indexes\.mjs/,
  /scripts\/build-party-profiles\.mjs/,
  /scripts\/build-office-pages\.mjs/,
  /scripts\/build-sitemap\.mjs/,
  /scripts\/validate-browse-cache-tokens\.mjs/,
  /scripts\/build-site-stats\.mjs/,
  /scripts\/build-status\.mjs/,
  /scripts\/build-test2-election-summaries\.mjs/,
  /scripts\/build-test2-election-manifest\.mjs/,
  /scripts\/build-election-provenance\.mjs/,
  /scripts\/graph\/build-semantic-graph\.mjs/,
];

/** The trees the records build writes and this branch never tracks (.gitignore, stage G). */
export const GENERATED_TREES = [
  'render/metadata/elections-test2', 'render/metadata/elections-test2-summaries', 'render/metadata/election-provenance',
  'render/metadata/elections-test2.json', 'render/metadata/elections-test2-report.json',
  'data/database/election-provenance.json', 'data/database/elections-schema.sql', 'app/build',
];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const RESOLVE_ONLY = args.includes('--resolve');
const REF = args.find((a) => !a.startsWith('--')) || 'main';

function git(gitArgs, { allowFail = false, input } = {}) {
  const res = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, input });
  if (res.status !== 0 && !allowFail) throw new Error(`git ${gitArgs.join(' ')} failed: ${res.stderr || res.stdout}`);
  return res;
}

const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

/** Paths this branch's .gitignore ignores, of those given (batched through stdin). */
function ignoredOf(paths) {
  if (!paths.length) return new Set();
  const res = git(['check-ignore', '--no-index', '--stdin'], { allowFail: true, input: `${paths.join('\n')}\n` });
  return new Set(lines(res.stdout));
}

/** Conflict hunks of a file with markers: [{ ours, theirs }]. */
export function conflictHunks(text) {
  const hunks = [];
  const re = /^<<<<<<< [^\n]*\n([\s\S]*?)^(?:\|\|\|\|\|\|\| [^\n]*\n[\s\S]*?)?^=======\n([\s\S]*?)^>>>>>>> [^\n]*\n/gm;
  let m;
  while ((m = re.exec(text))) hunks.push({ ours: m[1], theirs: m[2] });
  return hunks;
}

const TOKEN = /(\?v=[0-9a-f]{6,}|root-maplibre-sw-[0-9a-f]{6,}|(?:VERSION|version)\s*=\s*'[^']*[0-9a-f]{8,}[^']*')/g;
export const onlyTokens = (hunk) => hunk.ours.replace(TOKEN, '<T>') === hunk.theirs.replace(TOKEN, '<T>');

/** Take ours in every hunk (the text between markers). */
export function takeOurs(text) {
  return text.replace(/^<<<<<<< [^\n]*\n([\s\S]*?)^(?:\|\|\|\|\|\|\| [^\n]*\n[\s\S]*?)?^=======\n[\s\S]*?^>>>>>>> [^\n]*\n/gm, '$1');
}

const isChain = (v) => typeof v === 'string' && v.includes(' && ');
const steps = (v) => v.split(' && ').map((s) => s.trim());

/**
 * Three-way merge of a `a && b && c` chain. Ours is the frame; theirs' removals are applied and
 * theirs' additions inserted after the nearest preceding step of theirs that ours also has.
 */
export function mergeChain(base, ours, theirs, { key = '', dropAdded = () => false } = {}) {
  const B = steps(base ?? '');
  const O = steps(ours);
  const Tt = steps(theirs);
  const removedByTheirs = new Set(B.filter((s) => !Tt.includes(s)));
  const result = O.filter((s) => !removedByTheirs.has(s) || !B.includes(s));
  const notes = [];
  Tt.forEach((s, i) => {
    if (B.includes(s) || result.includes(s)) return;
    if (dropAdded(key, s)) { notes.push(`${key}: main added "${s}"; not added here (records:build runs it)`); return; }
    let at = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const k = result.indexOf(Tt[j]);
      if (k >= 0) { at = k; break; }
    }
    result.splice(at + 1, 0, s);
    notes.push(`${key}: main added "${s}"`);
  });
  return { value: result.join(' && '), notes };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of two JSON values; conflicts are collected, not thrown. */
export function merge3(base, ours, theirs, at, ctx) {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    const keys = [...Object.keys(ours)];
    // theirs' new keys after their predecessor in theirs
    Object.keys(theirs).forEach((k, i, all) => {
      if (keys.includes(k) || (k in b)) return;
      let pos = -1;
      for (let j = i - 1; j >= 0; j -= 1) { pos = keys.indexOf(all[j]); if (pos >= 0) break; }
      keys.splice(pos + 1, 0, k);
    });
    for (const k of keys) {
      const v = merge3(b[k], ours[k], theirs[k], [...at, k], ctx);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (isChain(ours) && isChain(theirs)) {
    const key = at[at.length - 1];
    const dropAdded = (k, s) => k === 'build' && RECORDS_STEPS.some((re) => re.test(s));
    const { value, notes } = mergeChain(typeof base === 'string' ? base : '', ours, theirs, { key, dropAdded });
    ctx.notes.push(...notes);
    return value;
  }
  ctx.conflicts.push(`${at.join('.')}: ours ${JSON.stringify(ours)?.slice(0, 160)} / main ${JSON.stringify(theirs)?.slice(0, 160)}`);
  return ours;
}

function stageJson(stage, file) {
  const res = git(['show', `:${stage}:${file}`], { allowFail: true });
  return res.status === 0 ? JSON.parse(res.stdout) : undefined;
}

function main() {
  if (!RESOLVE_ONLY && !DRY) {
    const dirty = lines(git(['status', '--porcelain', '--untracked-files=no']).stdout);
    if (dirty.length) throw new Error(`the working tree has uncommitted tracked changes (${dirty.length}); commit them first`);
    const res = git(['merge', '--no-commit', '--no-ff', REF], { allowFail: true });
    console.log(lines(res.stdout).filter((l) => !l.startsWith('CONFLICT') && !l.startsWith('Auto-merging')).slice(-3).join('\n'));
  }
  if (!git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFail: true }).stdout.trim()) {
    console.log(DRY ? 'dry run: no merge in progress; run without --dry-run to start one' : 'no merge in progress');
    return 0;
  }

  // ---- 1. generated paths
  const unmerged = [...new Set(lines(git(['diff', '--name-only', '--diff-filter=U']).stdout))];
  const added = lines(git(['diff', '--cached', '--name-only', '--diff-filter=A', 'HEAD']).stdout);
  const ignored = ignoredOf([...new Set([...unmerged, ...added])]);
  const generated = [...ignored].sort();
  console.log(`generated (ignored on this branch): ${generated.length} path(s) leave the index`);
  if (!DRY && generated.length) {
    for (let i = 0; i < generated.length; i += 200) {
      git(['rm', '-q', '--cached', '--force', '--ignore-unmatch', '--', ...generated.slice(i, i + 200)]);
    }
    for (const p of generated) rmSync(path.join(ROOT, p), { force: true });
  }

  // ---- 1b. sweep: a generated tree must hold no tracked file after the merge, whatever route
  // brought one in (an earlier hand merge let 168 bundle, summary and provenance files through).
  const leaked = lines(git(['ls-files', '-ci', '--exclude-standard', '--', ...GENERATED_TREES]).stdout);
  if (leaked.length) {
    console.log(`sweep: ${leaked.length} tracked file(s) in the generated trees leave the index`);
    if (!DRY) {
      for (let i = 0; i < leaked.length; i += 200) git(['rm', '-q', '--cached', '--force', '--', ...leaked.slice(i, i + 200)]);
      for (const p of leaked) rmSync(path.join(ROOT, p), { force: true });
    }
  }

  // ---- 2 and 3. tokens, package.json
  const left = [];
  const remaining = lines(git(['diff', '--name-only', '--diff-filter=U']).stdout).filter((p) => !ignored.has(p));
  for (const file of remaining) {
    const abs = path.join(ROOT, file);
    if (file === 'package.json') {
      const ctx = { notes: [], conflicts: [] };
      const merged = merge3(stageJson(1, file), stageJson(2, file), stageJson(3, file), [], ctx);
      for (const n of ctx.notes) console.log(`package.json: ${n}`);
      if (ctx.conflicts.length) {
        for (const c of ctx.conflicts) console.log(`package.json CONFLICT ${c}`);
        left.push(file);
        continue;
      }
      if (!DRY) { writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`); git(['add', '--', file]); }
      console.log('package.json: merged by key');
      continue;
    }
    const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const hunks = conflictHunks(text);
    if (hunks.length && hunks.every(onlyTokens)) {
      if (!DRY) { writeFileSync(abs, takeOurs(text)); git(['add', '--', file]); }
      console.log(`${file}: tokens only (${hunks.length} hunk(s)); ours kept, restamp after the merge`);
      continue;
    }
    left.push(file);
  }

  if (left.length) {
    console.log(`\n${left.length} file(s) need a hand resolution (keep both sides' data):`);
    for (const f of left) console.log(`  ${f}`);
    return 2;
  }
  console.log('\nall conflicts resolved by rule. Next: npm run build && node scripts/validate-browse-cache-tokens.mjs, then records:build, records:check, commit.');
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`merge-main: ${error.message}`);
    process.exitCode = 1;
  }
}
