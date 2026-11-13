#!/usr/bin/env node
/**
 * Self-host the Elections app's browser libraries (11 Nov 2026), which it loaded from
 * cdn.jsdelivr.net until then: DuckDB-WASM 1.29.0 (the pivot tables), MapLibre GL 5.24.0 and
 * PMTiles 4.5.0 (the maps), the exact versions it used, and the MapLibre and PMTiles versions
 * packages/map pins.
 *
 * Where they go, as the repository vendors third-party browser files (src/libs/: committed,
 * served unbundled, not linted):
 *
 *   src/libs/duckdb-wasm-1.29.0/duckdb-browser.mjs          the module, apache-arrow bundled in
 *                                                           (what jsDelivr's +esm build did)
 *   src/libs/duckdb-wasm-1.29.0/duckdb-browser-{eh,mvp}.worker.js
 *   src/libs/maplibre-gl-5.24.0/maplibre-gl.{js,css}        the package's dist files, unchanged
 *   src/libs/pmtiles-4.5.0/pmtiles.js                       the package's dist file, unchanged
 *   src/libs/elections-app-vendor.json                      what is where: versions, sources,
 *                                                           bytes and SHA-256 of every file
 *   src/libs/elections-app-THIRD-PARTY-NOTICES.txt          the licences
 *
 * The two DuckDB WebAssembly files (34 and 39 MiB) are over Cloudflare Pages' 25 MiB per-file
 * limit, so they are served from R2 (data/elections-app/v1/duckdb-wasm-1.29.0/, see
 * site/apps/elections/config.js) and only kept locally, gitignored, beside the module, where the
 * local servers serve them. So is the one DuckDB extension the app needs, parquet (about 2.7 MB per
 * platform), which DuckDB autoloads at run time and fetched from extensions.duckdb.org until now:
 * downloaded from there against the SHA-256 pinned in vendor-deps/duckdb-extensions.json, into
 * src/libs/duckdb-wasm-1.29.0/extensions/<engine>/<platform>/ (DuckDB's repository layout), and
 * kept with the other WebAssembly. scripts/publish/elections-app-r2-upload.mjs uploads them, with
 * the owner's approval only.
 *
 * The packages come from the npm registry through npm ci, from the lockfile committed in
 * scripts/build/elections-app/vendor-deps/, installed into tmp/elections-app-vendor/; never into
 * the repository's node_modules (the Pages build does not install them, it serves the committed
 * files).
 *
 *   node scripts/build/elections-app/vendor.mjs            install, write src/libs/, the local wasm
 *   node scripts/build/elections-app/vendor.mjs --check    the committed files match the manifest,
 *                                                          and the local wasm too when present (no network)
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlHeaders } from '../../../packages/config/src/node.mjs';
import { DUCKDB_VERSION, MAPLIBRE_VERSION, PMTILES_VERSION, R2_PREFIX, VENDOR } from '../../../site/apps/elections/config.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEPS = path.join(REPO, 'scripts/build/elections-app/vendor-deps');
const WORK = path.join(REPO, 'tmp/elections-app-vendor');
export const MANIFEST = 'src/libs/elections-app-vendor.json';
export const NOTICES = 'src/libs/elections-app-THIRD-PARTY-NOTICES.txt';

/** The served path /src/libs/x/ -> the repository folder src/libs/x/. */
const dirOf = (/** @type {string} */ served) => served.replace(/^\/+/, '').replace(/\/$/, '');

/**
 * Every vendored file: where it comes from in the installed packages and where it is served.
 * `host: 'r2'` files are too big for Pages: kept locally (gitignored), uploaded to R2.
 * @type {Array<{ pkg: string, from: string | null, to: string, host: 'pages' | 'r2', bundle?: boolean, url?: string, sha256?: string }>}
 */
export const FILES = [
  { pkg: '@duckdb/duckdb-wasm', from: 'dist/duckdb-browser.mjs', to: `${dirOf(VENDOR.duckdb)}/duckdb-browser.mjs`, host: 'pages', bundle: true },
  { pkg: '@duckdb/duckdb-wasm', from: 'dist/duckdb-browser-eh.worker.js', to: `${dirOf(VENDOR.duckdb)}/duckdb-browser-eh.worker.js`, host: 'pages' },
  { pkg: '@duckdb/duckdb-wasm', from: 'dist/duckdb-browser-mvp.worker.js', to: `${dirOf(VENDOR.duckdb)}/duckdb-browser-mvp.worker.js`, host: 'pages' },
  { pkg: '@duckdb/duckdb-wasm', from: 'dist/duckdb-eh.wasm', to: `${dirOf(VENDOR.duckdb)}/duckdb-eh.wasm`, host: 'r2' },
  { pkg: '@duckdb/duckdb-wasm', from: 'dist/duckdb-mvp.wasm', to: `${dirOf(VENDOR.duckdb)}/duckdb-mvp.wasm`, host: 'r2' },
  { pkg: 'maplibre-gl', from: 'dist/maplibre-gl.js', to: `${dirOf(VENDOR.maplibre)}/maplibre-gl.js`, host: 'pages' },
  { pkg: 'maplibre-gl', from: 'dist/maplibre-gl.css', to: `${dirOf(VENDOR.maplibre)}/maplibre-gl.css`, host: 'pages' },
  { pkg: 'pmtiles', from: 'dist/pmtiles.js', to: `${dirOf(VENDOR.pmtiles)}/pmtiles.js`, host: 'pages' },
  // DuckDB's extensions, downloaded (url) against a pinned SHA-256, in its repository layout.
  ...JSON.parse(readFileSync(path.join(REPO, 'scripts/build/elections-app/vendor-deps/duckdb-extensions.json'), 'utf8')).extensions
    .map((/** @type {any} */ e) => ({
      pkg: '@duckdb/duckdb-wasm', from: null, url: e.url, sha256: e.sha256, host: /** @type {'r2'} */ ('r2'),
      to: `${dirOf(VENDOR.duckdb)}/extensions/${new URL(e.url).pathname.replace(/^\/+/, '')}`,
    })),
];

/** The versions the app names, which the lockfile must install. */
export const PINNED = { '@duckdb/duckdb-wasm': DUCKDB_VERSION, 'maplibre-gl': MAPLIBRE_VERSION, pmtiles: PMTILES_VERSION };

/** Cloudflare Pages' per-file limit (scripts/build/site.mjs MAX_FILE_BYTES). */
export const PAGES_MAX_BYTES = 25 * 1024 * 1024;

export const sha256 = (/** @type {Buffer | string} */ b) => createHash('sha256').update(b).digest('hex');

/**
 * The R2 key of an r2-hosted vendored file: the prefix and its path under src/libs/, e.g.
 * data/elections-app/v1/duckdb-wasm-1.29.0/duckdb-eh.wasm.
 */
export const r2KeyOf = (/** @type {string} */ to) => `${R2_PREFIX}${to.replace(/^src\/libs\//, '')}`;

/** Download a pinned file; refuse it unless its SHA-256 is the pinned one. @param {string} url @param {string} want */
async function download(url, want) {
  const res = await fetch(url, { headers: crawlHeaders() });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== want) throw new Error(`${url}: SHA-256 ${sha256(buf)}, pinned ${want} (vendor-deps/duckdb-extensions.json); not used`);
  return buf;
}

const LICENCE = /^(licen[cs]e|copying|notice)(\.(txt|md))?$/i;

/** @typedef {{ packages: Record<string, { version: string, integrity?: string, license?: string }> }} Lockfile */

/** @returns {Lockfile} */
function install() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(path.join(DEPS, f), path.join(WORK, f));
  // npm ci: exactly the lockfile (versions and integrity hashes), or it fails.
  execSync('npm ci --ignore-scripts --no-audit --no-fund', { cwd: WORK, stdio: 'inherit' });
  const lock = JSON.parse(readFileSync(path.join(WORK, 'package-lock.json'), 'utf8'));
  for (const [pkg, version] of Object.entries(PINNED)) {
    const got = lock.packages[`node_modules/${pkg}`]?.version;
    if (got !== version) throw new Error(`vendor-deps lockfile installs ${pkg}@${got}, but site/apps/elections/config.js names ${version}`);
  }
  return lock;
}

/** @param {string} pkg */
const pkgDir = (pkg) => path.join(WORK, 'node_modules', ...pkg.split('/'));

/** @param {string} entry @param {string} out */
async function bundle(entry, out) {
  const esbuild = await import('esbuild');
  const r = await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', minify: true, platform: 'browser', target: ['es2020'],
    legalComments: 'eof', outfile: out, metafile: true, logLevel: 'warning', absWorkingDir: WORK,
  });
  // The packages that landed in the bundle, for the notices (filter(Boolean) drops the nulls).
  return /** @type {string[]} */ ([...new Set(Object.keys(r.metafile.inputs).map((p) => {
    const m = /node_modules[/\\](@[^/\\]+[/\\][^/\\]+|[^/\\]+)/.exec(p);
    return m ? m[1].replace(/\\/g, '/') : null;
  }).filter(Boolean))].sort());
}

/** @param {string[]} pkgs @param {Lockfile} lock */
function notices(pkgs, lock) {
  const out = [
    'Third-party notices: the browser libraries the Civgraph Elections app self-hosts (src/libs/).',
    'Generated by scripts/build/elections-app/vendor.mjs from the installed packages; do not edit.',
    '',
  ];
  for (const pkg of pkgs) {
    const man = JSON.parse(readFileSync(path.join(pkgDir(pkg), 'package.json'), 'utf8'));
    const repo = typeof man.repository === 'string' ? man.repository : man.repository?.url || '';
    out.push('='.repeat(78), `${pkg}@${lock.packages[`node_modules/${pkg}`]?.version || man.version}`, `License: ${typeof man.license === 'string' ? man.license : man.license?.type || 'UNKNOWN'}`);
    if (repo) out.push(`Repository: ${repo}`);
    const files = readdirSync(pkgDir(pkg)).filter((f) => LICENCE.test(f)).sort();
    if (!files.length) out.push('', '(The package ships no licence file; its package.json declares the licence above.)');
    for (const f of files) out.push('', readFileSync(path.join(pkgDir(pkg), f), 'utf8').replace(/\r\n/g, '\n').trim());
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

async function build() {
  const lock = install();
  const esbuildVersion = JSON.parse(readFileSync(path.join(REPO, 'node_modules/esbuild/package.json'), 'utf8')).version;
  /** @type {Set<string>} */
  const pkgs = new Set();
  const entries = [];
  for (const f of FILES) {
    const src = path.join(pkgDir(f.pkg), f.from || '.');
    const dst = path.join(REPO, f.to);
    mkdirSync(path.dirname(dst), { recursive: true });
    if (f.url) writeFileSync(dst, await download(f.url, /** @type {string} */ (f.sha256)));
    else if (f.bundle) for (const p of await bundle(src, dst)) pkgs.add(p);
    else copyFileSync(src, dst);
    // Trailing whitespace stays: these are the packages' bytes (only the bundle is ours).
    pkgs.add(f.pkg);
    const buf = readFileSync(dst);
    if (f.host === 'pages' && buf.length > PAGES_MAX_BYTES) throw new Error(`${f.to} is ${buf.length} bytes, over the Pages limit: host it on R2`);
    entries.push({
      path: f.to,
      package: `${f.pkg}@${lock.packages[`node_modules/${f.pkg}`].version}`,
      from: f.url || (f.bundle ? `${f.from} bundled with esbuild ${esbuildVersion} (format esm, minify, target es2020)` : f.from),
      host: f.host,
      ...(f.host === 'r2' ? { r2Key: r2KeyOf(f.to), contentType: 'application/wasm' } : {}),
      bytes: buf.length,
      sha256: sha256(buf),
    });
  }
  writeFileSync(path.join(REPO, NOTICES), notices([...pkgs].sort(), lock));
  const manifest = {
    schemaVersion: 1,
    generatedBy: 'node scripts/build/elections-app/vendor.mjs',
    note: 'Browser libraries the Elections app self-hosts. host "pages": committed here and deployed with the site. host "r2": over the 25 MiB Pages limit, gitignored locally and served from R2 at r2Key (data.civgraph.net).',
    lockfile: 'scripts/build/elections-app/vendor-deps/package-lock.json',
    packages: Object.fromEntries([...pkgs].sort().map((p) => [p, { version: lock.packages[`node_modules/${p}`].version, integrity: lock.packages[`node_modules/${p}`].integrity, license: lock.packages[`node_modules/${p}`].license }])),
    files: entries,
  };
  writeFileSync(path.join(REPO, MANIFEST), `${JSON.stringify(manifest, null, 1)}\n`);
  for (const e of entries) console.log(`${e.host === 'r2' ? 'r2   ' : 'pages'} ${(e.bytes / 1048576).toFixed(2).padStart(6)} MiB  ${e.path}`);
  console.log(`vendored ${entries.length} files; manifest ${MANIFEST}`);
}

/**
 * The committed (pages) files match the manifest; the local r2 files too when present.
 * @returns {{ problems: string[], missingLocal: string[] }}
 */
export function checkVendor(root = REPO) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const missingLocal = [];
  const file = path.join(root, MANIFEST);
  if (!existsSync(file)) return { problems: [`${MANIFEST} is missing: run node scripts/build/elections-app/vendor.mjs`], missingLocal };
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const f of FILES) {
    const e = manifest.files.find((/** @type {any} */ x) => x.path === f.to);
    if (!e) { problems.push(`${f.to}: not in the manifest`); continue; }
    if (e.host !== f.host) problems.push(`${f.to}: host ${e.host}, expected ${f.host}`);
    if (e.host === 'r2' && e.r2Key !== r2KeyOf(f.to)) problems.push(`${f.to}: r2Key ${e.r2Key}, expected ${r2KeyOf(f.to)}`);
    if (e.host === 'pages' && e.bytes > PAGES_MAX_BYTES) problems.push(`${f.to}: ${e.bytes} bytes is over the Pages limit`);
    const abs = path.join(root, f.to);
    if (!existsSync(abs)) {
      if (f.host === 'r2') missingLocal.push(f.to);
      else problems.push(`${f.to}: missing`);
      continue;
    }
    if (statSync(abs).size !== e.bytes || sha256(readFileSync(abs)) !== e.sha256) problems.push(`${f.to}: differs from the manifest (bytes or SHA-256)`);
  }
  for (const [pkg, version] of Object.entries(PINNED)) {
    if (manifest.packages?.[pkg]?.version !== version) problems.push(`manifest has ${pkg}@${manifest.packages?.[pkg]?.version}, config.js names ${version}`);
  }
  return { problems, missingLocal };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const { problems, missingLocal } = checkVendor();
    if (missingLocal.length) console.log(`note: not built locally (served from R2 in production): ${missingLocal.join(', ')}; run node scripts/build/elections-app/vendor.mjs to fetch them`);
    if (problems.length) {
      console.error(`FAIL: Elections app vendored libraries:\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    console.log(`PASS: Elections app vendored libraries match ${MANIFEST}`);
  } else {
    await build();
  }
}
