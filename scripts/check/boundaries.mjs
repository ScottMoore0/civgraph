#!/usr/bin/env node
/**
 * check:boundaries (REFACTOR-PLAN.md PKG-0): the import rules between the parts of the
 * repository, read from config/boundaries.json. Every tracked .js/.mjs/.cjs file in a unit
 * is read; each static import, re-export and dynamic import() with a literal relative specifier
 * is resolved to a file, and the edge fails when the importing unit does not allow the unit that
 * holds the target. node:* built-ins fail in a unit with "node": false. Bare names (npm
 * packages) are not checked; a computed import() is not seen (packages/loader/src/local-api.mjs
 * starts the Functions by path, as a dev server). Known violations go in boundaries.json
 * `baseline` ("from -> to"); an entry that no longer occurs fails too, so the list only shrinks.
 *
 * Served pages (site/) are not bundled, so a relative import of packages/ would 404 in the
 * browser: they import only site/ files. Package code reaches them through packages/served.json,
 * whose shims under site/ (site/assets/ui/, the site-served unit) re-export the package so Node and
 * tsc resolve the same module; only those shims may import the package.
 *
 * The engine rule (architecture rule R1, REFACTOR-PLAN.md ST-7): only the units boundaries.json
 * `engines.units` names may use an engine API, a module `engines.modules` lists (the SQLite
 * engine, the S3 client R2 is reached by, other database drivers), whether by an import, an
 * import() or a JSDoc type import. Everything else opens a database or a bucket through
 * packages/storage. Known uses go in `engines.baseline` ("file -> module"), which only shrinks.
 *
 * Which files belong to no unit (architecture rule R1, check C2) and which unit paths hold no
 * file (C1) are reported by scripts/check/architecture.mjs (npm run check:architecture), from
 * trackedScripts(), unownedFiles() and emptyUnitPaths() here.
 *
 *   node scripts/check/boundaries.mjs           check
 *   node scripts/check/boundaries.mjs --list    print every cross-unit edge with its verdict
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(path.join(ROOT, 'config', 'boundaries.json'), 'utf8'));
const UNITS = Object.entries(config.units);
const SKIP = /(^|\/)(node_modules|dist|build|vendor)\/|\.min\.js$|^src\/sql\.js-httpvfs\//;

/** The unit that holds a repository path, or null. @param {string} rel @returns {string | null} */
export function unitOf(rel) {
  /** @param {string} p */
  const holds = (p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p);
  for (const [name, unit] of UNITS) if (unit.paths.some(holds)) return name;
  return null;
}

/** Whether unit `from` may import unit `to`. @param {string} from @param {string | null} to */
export function allowed(from, to) {
  if (to === null || from === to) return true;
  const allow = config.units[from].allow;
  if (allow.includes(`!${to}`)) return false;
  return allow.includes('*') || allow.includes(to);
}

/** The tracked scripts the import rules read (vendored, minified and build output left out). */
export function trackedScripts() {
  return execFileSync('git', ['ls-files', '-z', '*.js', '*.mjs', '*.cjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter((f) => f && !SKIP.test(f));
}

const UNOWNED = Object.entries(config.unowned || {}).filter(([key]) => key !== '//');
const listed = (/** @type {string} */ rel, /** @type {string} */ key) => (key.endsWith('/') ? rel.startsWith(key) : rel === key);

/**
 * C2: the scripts in no unit and not in boundaries.json `unowned` (each entry with its reason),
 * and the `unowned` entries that match no script any more.
 * @param {string[]} files
 */
export function unownedFiles(files) {
  const missing = files.filter((f) => unitOf(f) === null && !UNOWNED.some(([key]) => listed(f, key)));
  const stale = UNOWNED.filter(([key]) => !files.some((f) => listed(f, key))).map(([key]) => key);
  return { missing, stale };
}

/**
 * C1: unit paths that hold no tracked file (a path left behind by a move).
 * @param {string[]} tracked  every tracked file
 */
export function emptyUnitPaths(tracked) {
  const out = [];
  for (const [name, unit] of UNITS) for (const p of unit.paths) if (!tracked.some((f) => listed(f, p))) out.push(`${name}: ${p}`);
  return out;
}

const strip = (/** @type {string} */ src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const SPEC = /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?\sfrom\s*(['"])([^'"]+)\1|(?:^|[\s;}(=])import\s*(['"])([^'"]+)\3|\bimport\(\s*(['"])([^'"]+)\5\s*\)/gm;

/** The literal import specifiers of a module's source. @param {string} source @returns {string[]} */
export function specifiers(source) {
  const out = [];
  for (const m of strip(source).matchAll(SPEC)) out.push(m[2] || m[4] || m[6]);
  return out;
}

/** @type {{ modules: string[], units: string[], baseline: string[] }} */
const ENGINES = config.engines || { modules: [], units: [], baseline: [] };

/**
 * The engine module a specifier names, or null: an entry ending in / covers every module under it,
 * any other entry itself and its subpaths.
 * @param {string} spec
 * @returns {string | null}
 */
export function engineOf(spec) {
  return ENGINES.modules.find((m) => (m.endsWith('/') ? spec.startsWith(m) : spec === m || spec.startsWith(`${m}/`))) || null;
}

/** A type import() anywhere in the source, comments included (JSDoc names types this way). */
const TYPE_IMPORT = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;

/**
 * The engine modules a module's source uses: its imports, plus the type import()s in its JSDoc.
 * @param {string} source
 * @returns {string[]}
 */
export function engineUses(source) {
  const found = new Set();
  for (const spec of [...specifiers(source), ...[...source.matchAll(TYPE_IMPORT)].map((m) => m[2] || '')]) {
    const engine = engineOf(spec);
    if (engine) found.add(engine);
  }
  return [...found].sort();
}

/** Whether a unit may use an engine API. @param {string | null} unit */
export const mayUseEngine = (unit) => unit !== null && ENGINES.units.includes(unit);

/** Every engine use in the tracked scripts, with its verdict. */
export function engineEdges() {
  const out = [];
  for (const file of trackedScripts()) {
    let source;
    try { source = readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
    const unit = unitOf(file);
    for (const engine of engineUses(source)) out.push({ file, engine, unit, ok: mayUseEngine(unit) });
  }
  return out;
}

export function edges() {
  const files = trackedScripts();
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
  const engines = engineEdges();
  const engineBaseline = new Set(ENGINES.baseline);
  const engineBad = engines.filter((e) => !e.ok);
  const engineFresh = engineBad.filter((e) => !engineBaseline.has(`${e.file} -> ${e.engine}`));
  const engineGone = [...engineBaseline].filter((b) => !engineBad.some((e) => `${e.file} -> ${e.engine}` === b));
  for (const e of engineFresh) console.error(`FAIL: ${e.file} (${e.unit ?? 'no unit'}) uses ${e.engine}, an engine API only ${ENGINES.units.join(', ')} may use: open it through packages/storage`);
  for (const b of engineGone) console.error(`FAIL: boundaries.json engines.baseline lists ${b}, which no longer occurs: remove it`);
  if (fresh.length || gone.length || engineFresh.length || engineGone.length) {
    console.error('\nThe rules are in boundaries.json (REFACTOR-PLAN.md section 2.2). Import through the package that owns the code,');
    console.error('or move the code to a package the importer may use; widen a rule only with a reason in its "//" note.');
    process.exit(1);
  }
  const cross = all.filter((e) => e.to !== e.from && e.to !== null).length;
  console.log(`PASS: ${all.length} imports in ${UNITS.length} units; ${cross} cross unit lines, all allowed${baseline.size ? ` (${baseline.size} in the baseline)` : ''}.`);
  console.log(`PASS: ${engines.length} engine API uses, all in ${ENGINES.units.join(', ')}${engineBaseline.size ? ` (${engineBaseline.size} in the baseline)` : ''}.`);
}
