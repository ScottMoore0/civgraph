/**
 * A checkout's own node_modules, made of links to another checkout's (rf-final, 18 Nov 2026).
 *
 * Code imports the workspace packages by their @civgraph names (packages/README.md). npm's
 * workspace links in node_modules/@civgraph point at the packages/ of the checkout that ran
 * `npm install`, so a worktree (or check:clean's export) that joined node_modules as a whole to
 * the main checkout's would run the MAIN checkout's packages, and a package that finds the
 * repository from its own location (REPO_ROOT) would read and write the main checkout.
 *
 * So a worktree gets a real node_modules folder instead: every entry of the source's node_modules
 * is a directory junction to it (a file, such as .package-lock.json, is copied), except
 * the @civgraph scope, a real folder whose entries are junctions to THIS checkout's packages/<name>.
 * Nothing is installed or downloaded. Removing it removes the links first (removeShadow), never
 * what they point at.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** The scope folder of the workspace links. */
export const SCOPE = '@civgraph';
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

/**
 * The workspace packages of a checkout: each packages/<dir> whose package.json is named
 * @civgraph/<name>.
 * @param {string} root
 * @returns {{ name: string, dir: string }[]}  name without the scope; dir absolute
 */
export function workspacePackages(root) {
  const base = path.join(root, 'packages');
  /** @type {{ name: string, dir: string }[]} */
  const out = [];
  let entries;
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(base, entry.name, 'package.json');
    if (!existsSync(manifest)) continue;
    const name = /** @type {{ name?: unknown }} */ (JSON.parse(readFileSync(manifest, 'utf8'))).name;
    if (typeof name === 'string' && name.startsWith(`${SCOPE}/`)) out.push({ name: name.slice(SCOPE.length + 1), dir: path.join(base, entry.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when `p` is a junction or symbolic link. @param {string} p */
function isLink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** Remove a link, never what it points at. @param {string} p */
function removeLink(p) {
  if (!isLink(p)) throw new Error(`${p} is not a link; refusing to remove it`);
  try { rmdirSync(p); } catch { unlinkSync(p); }
  if (existsSync(p) || isLink(p)) throw new Error(`could not remove the link ${p}`);
}

/**
 * Make `<root>/node_modules` from `source` (another checkout's node_modules), with the workspace
 * links pointing at `<root>/packages`. `<root>/node_modules` must not exist.
 * @param {string} source  absolute path of the node_modules to link to
 * @param {string} root    the checkout that gets its own node_modules
 * @returns {{ dir: string, linked: number, copied: number, packages: string[] }}
 */
export function makeShadow(source, root) {
  const dir = path.join(root, 'node_modules');
  if (existsSync(dir) || isLink(dir)) throw new Error(`${dir} already exists`);
  if (!statSync(source).isDirectory()) throw new Error(`${source} is not a folder`);
  mkdirSync(dir);
  let linked = 0;
  let copied = 0;
  for (const entry of readdirSync(source)) {
    if (entry === SCOPE) continue;
    const from = path.join(source, entry);
    if (statSync(from).isDirectory()) {
      symlinkSync(realpathSync(from), path.join(dir, entry), LINK_TYPE);
      linked += 1;
    } else {
      copyFileSync(from, path.join(dir, entry));
      copied += 1;
    }
  }
  mkdirSync(path.join(dir, SCOPE));
  const packages = workspacePackages(root);
  for (const pkg of packages) symlinkSync(pkg.dir, path.join(dir, SCOPE, pkg.name), LINK_TYPE);
  return { dir, linked, copied, packages: packages.map((p) => `${SCOPE}/${p.name}`) };
}

/**
 * How `<root>/node_modules` resolves the workspace packages:
 *   'own'      every @civgraph link points into <root>/packages (makeShadow's result, or an npm install);
 *   'joined'   node_modules is itself a link (the old worktree recipe): names run another checkout's packages;
 *   'other'    a real folder whose @civgraph links point elsewhere, or miss a package;
 *   'absent'   no node_modules.
 * @param {string} root
 * @returns {'own' | 'joined' | 'other' | 'absent'}
 */
export function packageLinkState(root) {
  const dir = path.join(root, 'node_modules');
  if (isLink(dir)) return 'joined';
  if (!existsSync(dir)) return 'absent';
  const packages = workspacePackages(root);
  for (const pkg of packages) {
    const link = path.join(dir, SCOPE, pkg.name);
    let real;
    try { real = realpathSync(link); } catch { return 'other'; }
    if (path.relative(realpathSync(pkg.dir), real) !== '') return 'other';
  }
  return 'own';
}

/**
 * Turn a joined node_modules (one link to another checkout's) into this checkout's own
 * (makeShadow over the folder it pointed at). A no-op when the links are already its own.
 * @param {string} root
 * @returns {'own' | 'converted'}
 */
export function ensureOwnPackageLinks(root) {
  const state = packageLinkState(root);
  if (state === 'own') return 'own';
  if (state !== 'joined') throw new Error(`${path.join(root, 'node_modules')} is ${state === 'absent' ? 'missing' : 'a real folder whose @civgraph links point elsewhere'}: run npm ci there, or remove it and rerun`);
  const dir = path.join(root, 'node_modules');
  const target = realpathSync(dir);
  removeLink(dir);
  makeShadow(target, root);
  return 'converted';
}

/**
 * Remove a node_modules made by makeShadow: every link in it first (never what they point at),
 * then the folder and its copied files. Refuses a folder holding anything but links and files.
 * @param {string} root
 */
export function removeShadow(root) {
  const dir = path.join(root, 'node_modules');
  if (!existsSync(dir) && !isLink(dir)) return;
  if (isLink(dir)) { removeLink(dir); return; }
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (isLink(abs)) { removeLink(abs); continue; }
    if (entry === SCOPE && lstatSync(abs).isDirectory()) {
      for (const pkg of readdirSync(abs)) removeLink(path.join(abs, pkg));
      rmdirSync(abs);
      continue;
    }
    if (lstatSync(abs).isDirectory()) throw new Error(`${abs} is a real folder, not a link: refusing to delete it`);
    unlinkSync(abs);
  }
  rmdirSync(dir);
}
