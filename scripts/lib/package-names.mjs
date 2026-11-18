/**
 * Imports of the workspace packages by their @civgraph names (rf-final, 18 Nov 2026; refactor
 * item 1, packages/README.md "How code imports a package").
 *
 * A module that is not served to the browser as a file imports another package by name:
 * `import { escapeHtml } from '@civgraph/core/html.js'`, resolved by Node, tsc, esbuild and the
 * Pages Functions bundler through node_modules/@civgraph (npm's workspace links; a worktree's
 * point at its own packages/, scripts/lib/node-modules-links.mjs) and the package's `exports`.
 * A file the site serves unbundled (site/, render/, every source packages/served.json maps)
 * keeps relative imports: the browser resolves those by URL and knows no package names.
 * Imports inside one package stay relative.
 *
 *   node scripts/lib/package-names.mjs            list the relative imports that should be names
 *   node scripts/lib/package-names.mjs --write    rewrite them (the specifier only)
 *
 * tests/unit/packages.test.mjs holds both rules; check:boundaries resolves the names to files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCOPE = '@civgraph';

/**
 * @typedef {object} WorkspacePackage
 * @property {string} dir       the folder under packages/
 * @property {string} name      the full package name (scope, slash, folder)
 * @property {Array<[string, string]>} entries  its exports as (subpath key, target) pairs; for a conditions object, the types target
 */

/**
 * The workspace packages and their exports.
 * @param {string} [root]
 * @returns {Map<string, WorkspacePackage>}  by folder name
 */
export function readPackages(root = ROOT) {
  /** @type {Map<string, WorkspacePackage>} */
  const out = new Map();
  for (const entry of readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    const file = path.join(root, 'packages', entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const pkg = /** @type {{ name: string, exports?: Record<string, string | Record<string, string>> }} */ (JSON.parse(readFileSync(file, 'utf8')));
    /** @type {[string, string][]} */
    const exports = [];
    for (const [key, value] of Object.entries(pkg.exports || {})) {
      const target = typeof value === 'string' ? value : (value.types ?? value.import ?? value.default);
      if (typeof target === 'string') exports.push([key, target]);
    }
    out.set(entry.name, { dir: entry.name, name: pkg.name, entries: exports });
  }
  return out;
}

/**
 * Node's resolution of a subpath through an exports map (exact keys first, then the pattern
 * with the longest prefix before its *), as a path relative to the package folder, or null.
 * @param {[string, string][]} exports
 * @param {string} subpath  '.' or './x/y.js'
 * @returns {string | null}
 */
export function resolveExport(exports, subpath) {
  const exact = exports.find(([key]) => key === subpath);
  if (exact) return path.posix.normalize(exact[1]);
  let best = null;
  let bestLen = -1;
  for (const [key, target] of exports) {
    const star = key.indexOf('*');
    if (star < 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < key.length - 1) continue;
    if (prefix.length > bestLen) {
      bestLen = prefix.length;
      best = target.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length));
    }
  }
  return best === null ? null : path.posix.normalize(best);
}

/** @type {Map<string, WorkspacePackage> | null} */
let byName = null;

/**
 * The repository file an @civgraph name resolves to through its package's exports (as Node,
 * tsc and esbuild resolve it through the workspace links), or null when no export reaches it.
 * @param {string} spec  e.g. '@civgraph/core/html.js'
 * @returns {string | null}  repository-relative, e.g. 'packages/core/src/html.js'
 */
export function packageTarget(spec) {
  byName ??= new Map([...readPackages().values()].map((p) => [p.name, p]));
  const [scope, name, ...rest] = (spec.split(/[?#]/)[0] ?? '').split('/');
  const pkg = byName.get(`${scope}/${name}`);
  if (!pkg) return null;
  const inner = resolveExport(pkg.entries, rest.length ? `./${rest.join('/')}` : '.');
  return inner === null ? null : path.posix.join('packages', pkg.dir, inner);
}

/**
 * The name a repository file is imported by from outside its package, or null (not in a
 * package, or no export reaches it).
 * @param {string} rel  e.g. 'packages/map/src/ui-state-machines.mjs'
 * @returns {string | null}  e.g. '@civgraph/map/ui-state-machines.mjs'
 */
export function nameOfFile(rel) {
  byName ??= new Map([...readPackages().values()].map((p) => [p.name, p]));
  const hit = /^packages\/([^/]+)\/(.+)$/.exec(rel);
  if (!hit) return null;
  const pkg = [...byName.values()].find((p) => p.dir === hit[1]);
  return pkg ? nameFor(pkg, /** @type {string} */ (hit[2])) : null;
}

/**
 * The name a module inside a package is imported by, or null when its exports do not reach it.
 * An exact export (the package's own entry, such as `@civgraph/storage/node`) is preferred to
 * a pattern; whichever is chosen must resolve back to the same file. A `.js` specifier that
 * names a `.d.ts` (the types package) is matched as the declaration file.
 * @param {WorkspacePackage} pkg
 * @param {string} inner  the path inside the package folder, e.g. 'src/html.js'
 * @returns {string | null}
 */
export function nameFor(pkg, inner) {
  const wanted = [inner];
  if (inner.endsWith('.js')) wanted.push(`${inner.slice(0, -3)}.d.ts`);
  /** @type {string[]} */
  const candidates = [];
  for (const [key, target] of pkg.entries) {
    const t = path.posix.normalize(target);
    if (!key.includes('*')) {
      if (wanted.includes(t)) candidates.push(key);
      continue;
    }
    const star = target.indexOf('*');
    const tPrefix = path.posix.normalize(target.slice(0, star)).replace(/\/?$/, '/').replace(/^\.\//, '');
    const tSuffix = target.slice(star + 1);
    for (const w of wanted) {
      if (!w.startsWith(tPrefix) || !w.endsWith(tSuffix)) continue;
      const middle = w.slice(tPrefix.length, w.length - tSuffix.length);
      // A pattern target ending in .d.ts is reached by the .js spelling the importer used.
      const keyed = key.replace('*', middle);
      candidates.push(keyed);
    }
  }
  candidates.sort((a, b) => Number(a.includes('*')) - Number(b.includes('*')) || a.length - b.length);
  for (const key of candidates) {
    const back = resolveExport(pkg.entries, key);
    if (back !== null && wanted.includes(back)) return key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`;
  }
  return null;
}

/**
 * The repository paths the site serves to the browser as files: site/, render/ and every source
 * of packages/served.json. Their imports stay relative.
 * @param {string} [root]
 * @returns {(rel: string) => boolean}
 */
export function servedFiles(root = ROOT) {
  const served = /** @type {Record<string, string>} */ (JSON.parse(readFileSync(path.join(root, 'packages', 'served.json'), 'utf8')));
  const sources = Object.entries(served).filter(([key]) => key !== '//').map(([, source]) => source);
  return (rel) => rel.startsWith('site/') || rel.startsWith('render/')
    || sources.some((source) => (source.endsWith('/') ? rel.startsWith(source) : rel === source));
}

/** A static import/export ... from, a bare import '...', or an import(...) (code or JSDoc type). */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|(?:^|[\s;])import\s+)(['"])([^'"\n]+)\2/gm;

/**
 * @typedef {object} ImportSite
 * @property {string} file    repository-relative importer
 * @property {number} index   offset of the specifier's opening quote
 * @property {string} spec    the specifier as written
 * @property {string} target  repository-relative file it names
 * @property {string} pkg     the package folder the target is in
 * @property {string | null} name  the package name that reaches it, or null
 */

/**
 * The relative specifiers in one module's source that cross into another package.
 * @param {string} file    repository-relative
 * @param {string} source
 * @param {Map<string, WorkspacePackage>} packages
 * @returns {ImportSite[]}
 */
export function crossPackageImports(file, source, packages) {
  /** @type {ImportSite[]} */
  const out = [];
  const own = /^packages\/([^/]+)\//.exec(file)?.[1] ?? null;
  for (const m of source.matchAll(SPECIFIER)) {
    const spec = /** @type {string} */ (m[3]);
    if (!spec.startsWith('.') || /[?#]/.test(spec)) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const hit = /^packages\/([^/]+)\/(.+)$/.exec(target);
    if (!hit) continue;
    const dir = /** @type {string} */ (hit[1]);
    if (dir === own) continue;
    const pkg = packages.get(dir);
    if (!pkg) continue;
    out.push({ file, index: /** @type {number} */ (m.index) + m[0].length - spec.length - 2, spec, target, pkg: dir, name: nameFor(pkg, /** @type {string} */ (hit[2])) });
  }
  return out;
}

/**
 * Every tracked module (.js, .mjs, .cjs, .d.ts) outside node_modules and vendored code.
 * @param {string} [root]
 */
export function trackedModules(root = ROOT) {
  return execFileSync('git', ['ls-files', '-z', '*.js', '*.mjs', '*.cjs', '*.d.ts'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter((f) => f && !/(^|\/)(node_modules|vendor|libs)\//.test(f) && !/\.min\.js$/.test(f));
}

/**
 * The relative cross-package imports of every module that is not served: the ones a name should
 * replace (`name` set) and the ones no export reaches (`name` null).
 * @param {string} [root]
 */
export function scan(root = ROOT) {
  const packages = readPackages(root);
  const isServed = servedFiles(root);
  /** @type {ImportSite[]} */
  const sites = [];
  for (const file of trackedModules(root)) {
    if (isServed(file)) continue;
    let source;
    try { source = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    sites.push(...crossPackageImports(file, source, packages));
  }
  return sites;
}

/**
 * The served modules that import a package by name (which the browser cannot resolve).
 * @param {string} [root]
 * @returns {{ file: string, spec: string }[]}
 */
export function servedNameImports(root = ROOT) {
  const isServed = servedFiles(root);
  /** @type {{ file: string, spec: string }[]} */
  const out = [];
  for (const file of trackedModules(root)) {
    if (!isServed(file)) continue;
    let source;
    try { source = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const m of source.matchAll(SPECIFIER)) if ((m[3] ?? '').startsWith(`${SCOPE}/`)) out.push({ file, spec: /** @type {string} */ (m[3]) });
  }
  return out;
}

/**
 * Rewrite each site's specifier to its name, file by file (only the quoted specifier changes).
 * @param {ImportSite[]} sites
 * @param {string} [root]
 * @returns {number} files written
 */
export function rewrite(sites, root = ROOT) {
  /** @type {Map<string, ImportSite[]>} */
  const byFile = new Map();
  for (const site of sites) if (site.name) byFile.set(site.file, [...(byFile.get(site.file) ?? []), site]);
  for (const [file, list] of byFile) {
    const abs = path.join(root, file);
    let source = readFileSync(abs, 'utf8');
    for (const site of [...list].sort((a, b) => b.index - a.index)) {
      const quote = source[site.index];
      const before = source.slice(site.index, site.index + site.spec.length + 2);
      if (before !== `${quote}${site.spec}${quote}`) throw new Error(`${file}: the specifier at ${site.index} is not ${site.spec}`);
      source = `${source.slice(0, site.index)}${quote}${site.name}${quote}${source.slice(site.index + site.spec.length + 2)}`;
    }
    writeFileSync(abs, source);
  }
  return byFile.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sites = scan();
  const named = sites.filter((s) => s.name);
  const unreachable = sites.filter((s) => !s.name);
  for (const s of unreachable) console.log(`no export reaches ${s.target} (${s.file})`);
  if (process.argv.includes('--write')) {
    const files = rewrite(named);
    console.log(`rewrote ${named.length} specifiers in ${files} files; ${unreachable.length} left relative (no export reaches them)`);
  } else {
    console.log(`${named.length} relative cross-package imports in ${new Set(named.map((s) => s.file)).size} files should be names; ${unreachable.length} reach no export`);
  }
}
