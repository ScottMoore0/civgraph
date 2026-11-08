#!/usr/bin/env node
/**
 * check:boundaries (REFACTOR-PLAN.md PKG-0): the import rules between the parts of the
 * repository, read from boundaries.json at the root. Every tracked .js/.mjs/.cjs file in a unit
 * is read; each static import, re-export and dynamic import() with a literal relative specifier
 * is resolved to a file, and the edge fails when the importing unit does not allow the unit that
 * holds the target. node:* built-ins fail in a unit with "node": false. Bare names (npm
 * packages) are not checked; a computed import() is not seen (packages/loader/src/local-api.mjs
 * starts the Functions by path, as a dev server). Known violations go in boundaries.json
 * `baseline` ("from -> to"); an entry that no longer occurs fails too, so the list only shrinks.
 *
 *   node scripts/check/boundaries.mjs           check
 *   node scripts/check/boundaries.mjs --list    print every cross-unit edge with its verdict
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(path.join(ROOT, 'boundaries.json'), 'utf8'));
const UNITS = Object.entries(config.units);
const SKIP = /(^|\/)(node_modules|dist|build|vendor)\/|\.min\.js$|^app\/build\/|^src\/sql\.js-httpvfs\//;

/** The unit that holds a repository path, or null. */
export function unitOf(rel) {
  for (const [name, unit] of UNITS) if (unit.paths.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))) return name;
  return null;
}

/** Whether unit `from` may import unit `to`. */
export function allowed(from, to) {
  if (to === null || from === to) return true;
  const allow = config.units[from].allow;
  if (allow.includes(`!${to}`)) return false;
  return allow.includes('*') || allow.includes(to);
}

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const SPEC = /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?\sfrom\s*(['"])([^'"]+)\1|(?:^|[\s;}(=])import\s*(['"])([^'"]+)\3|\bimport\(\s*(['"])([^'"]+)\5\s*\)/gm;

/** The literal import specifiers of a module's source. */
export function specifiers(source) {
  const out = [];
  for (const m of strip(source).matchAll(SPEC)) out.push(m[2] || m[4] || m[6]);
  return out;
}

export function edges() {
  const files = execFileSync('git', ['ls-files', '-z', '*.js', '*.mjs', '*.cjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter((f) => f && !SKIP.test(f));
  const out = [];
  for (const file of files) {
    const from = unitOf(file);
    if (!from) continue;
    let source;
    try { source = readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
    for (const spec of specifiers(source)) {
      if (spec.startsWith('node:')) {
        if (!config.units[from].node) out.push({ file, target: spec, from, to: 'node:*', ok: false });
        continue;
      }
      if (!spec.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.split(/[?#]/)[0]));
      const to = unitOf(target);
      out.push({ file, target, from, to, ok: allowed(from, to) });
    }
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const all = edges();
  if (process.argv.includes('--list')) {
    for (const e of all.filter((x) => x.to !== x.from && x.to !== null)) console.log(`${e.ok ? 'ok  ' : 'FAIL'} ${e.from} -> ${e.to}: ${e.file} -> ${e.target}`);
  }
  const baseline = new Set(config.baseline);
  const bad = all.filter((e) => !e.ok);
  const fresh = bad.filter((e) => !baseline.has(`${e.file} -> ${e.target}`));
  const gone = [...baseline].filter((b) => !bad.some((e) => `${e.file} -> ${e.target}` === b));
  for (const e of fresh) console.error(`FAIL: ${e.file} (${e.from}) imports ${e.target} (${e.to}), which ${e.from} may not import`);
  for (const b of gone) console.error(`FAIL: boundaries.json baseline lists ${b}, which no longer occurs: remove it`);
  if (fresh.length || gone.length) {
    console.error('\nThe rules are in boundaries.json (REFACTOR-PLAN.md section 2.2). Import through the package that owns the code,');
    console.error('or move the code to a package the importer may use; widen a rule only with a reason in its "//" note.');
    process.exit(1);
  }
  const cross = all.filter((e) => e.to !== e.from && e.to !== null).length;
  console.log(`PASS: ${all.length} imports in ${UNITS.length} units; ${cross} cross unit lines, all allowed${baseline.size ? ` (${baseline.size} in the baseline)` : ''}.`);
}
