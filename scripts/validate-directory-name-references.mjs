#!/usr/bin/env node
/**
 * Inventory every reference to the `render/`, `test2/` and `tests/` directories,
 * so renaming them is a bounded edit rather than a hunt.
 *
 * WHY THIS EXISTS BEFORE THE RENAME, NOT AFTER
 *
 * On 2026-08-11 the Leaflet archiving renamed `js/` to `src/`. `git mv` moved
 * the files; it could not move the four `../js/...` strings inside build
 * scripts, because a string is not a reference as far as git is concerned. The
 * build broke on the next commit and every Cloudflare Pages deployment failed
 * for 18 consecutive commits. Nothing noticed, because the site kept serving
 * the last good deployment and `npm run check` never runs `npm run build`.
 *
 * Renaming `render/` is the same operation on a far larger surface: 2,087
 * deployed metadata files, the shared renderer in `render/src`, and a name that
 * appears in HTML, headers, ignore files, Functions, specs and dozens of
 * scripts. Static analysis will not find those either.
 *
 * So this does not rename anything. It produces the list a rename must consult,
 * classified by how a mistake would show up:
 *
 *   RUNTIME  a browser or a Pages Function resolves this at request time. A
 *            miss is a 404 in production, and on Pages a missing asset can come
 *            back as index.html at HTTP 200, which looks healthy to any
 *            status-code check. This is the dangerous class.
 *   BUILD    a script reads or writes the path. A miss fails the build — loudly,
 *            but only if something actually runs the build.
 *   CONFIG   _headers, .cfignore, .gitignore, wrangler.toml, workflows. A miss
 *            is silent: caching, exclusion or CI simply stops applying.
 *   TEST     specs and fixtures. A miss fails the suite.
 *   DOC      prose. A miss misleads a human, nothing more.
 *
 * Run with --json for machine-readable output, or --check to fail if the count
 * has grown since the baseline — so the surface cannot quietly expand while the
 * rename is deferred.
 *
 * Usage: node scripts/validate-directory-name-references.mjs [--json] [--check] [--update-baseline]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE = 'data/database/directory-name-references-baseline.json';
const AS_JSON = process.argv.includes('--json');
const CHECK = process.argv.includes('--check');
const UPDATE = process.argv.includes('--update-baseline');

// Excluded wholesale: build output, vendored code, archived material, and the
// working directories (tasks/, tmp/, analysis/) whose JSON happens to contain
// path-like strings. An early draft included them and produced 616 "CONFIG"
// hits from two dail-candidate-match files, burying the 1 reference that
// actually matters.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'test-results', 'playwright-report', 'archive',
  '__pycache__', '.wrangler', 'tasks', 'tmp', 'analysis', 'coverage',
]);
// Data trees. A rename moves their PATHS, not their bytes, and scanning 2,000+
// metadata files for the substring "render/" is pure noise.
//
// app/ and render/src are deliberately NOT here: app/src and render/src are the
// runtime source, and they are exactly where a missed string becomes a
// production 404. An earlier draft skipped app/ and reported one runtime
// reference in the whole repository, which was obviously wrong and is why this
// list is now narrow.
const SKIP_CONTENT = new Set(['data', 'assets', 'build']);
const SKIP_SUBTREES = ['render/metadata', 'render/tiles', 'render/pmtiles', 'render/source-cache', 'app/build'];

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.yml', '.yaml', '.toml', '.sh', '.py', '.txt']);
// Extensionless config files, which an extension filter silently drops. _headers
// is the worst one to miss: it is where the immutable cache policy for
// render/metadata/maps-test-index.json lives, and a stale rule there fails without
// any error at all.
const TEXT_NAMES = new Set(['_headers', '_redirects', '_routes.json', '.cfignore', '.gitignore', '.nvmrc', '.node-version']);

/** Patterns that denote one of the three directories at a path boundary. */
const TARGETS = [
  { dir: 'render/', re: /(^|["'`(\s=,:/])test\/[A-Za-z0-9._-]/ },
  { dir: 'test2/', re: /(^|["'`(\s=,:/])test2\/[A-Za-z0-9._-]/ },
  { dir: 'tests/', re: /(^|["'`(\s=,:/])tests\/[A-Za-z0-9._-]/ },
];

function classify(file) {
  const f = file.replace(/\\/g, '/');
  if (f.startsWith('functions/')) return 'RUNTIME';
  if (TEXT_NAMES.has(f) || f === 'wrangler.toml' || f.startsWith('.github/')) return 'CONFIG';
  if (f.endsWith('.html')) return 'RUNTIME';
  if (f.startsWith('tests/')) return 'TEST';
  if (f.startsWith('scripts/')) return 'BUILD';
  if (f.startsWith('app/src/') || f.startsWith('src/') || f.startsWith('render/src/')) return 'RUNTIME';
  if (f.endsWith('.md')) return 'DOC';
  if (f.endsWith('.json')) return 'CONFIG';
  return 'BUILD';
}

function* walk(dir, depth = 0) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (depth === 0 && SKIP_CONTENT.has(entry)) continue;
      if (SKIP_SUBTREES.some((sub) => rel === sub || rel.startsWith(`${sub}/`))) continue;
      yield* walk(full, depth + 1);
    } else if (TEXT_EXT.has(path.extname(entry)) || TEXT_NAMES.has(entry)) {
      if (st.size > 2 * 1024 * 1024) continue;
      yield rel;
    }
  }
}

const findings = [];
for (const file of walk(ROOT)) {
  let text;
  try { text = readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const target of TARGETS) {
      if (!target.re.test(lines[i])) continue;
      findings.push({
        file,
        line: i + 1,
        dir: target.dir,
        kind: classify(file),
        text: lines[i].trim().slice(0, 160),
      });
    }
  }
}

const byKind = {};
const byDir = {};
const filesByKind = {};
for (const f of findings) {
  byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  byDir[f.dir] = (byDir[f.dir] || 0) + 1;
  (filesByKind[f.kind] ||= new Set()).add(f.file);
}

if (AS_JSON) {
  console.log(JSON.stringify({ total: findings.length, byKind, byDir, findings }, null, 2));
  process.exit(0);
}

console.log('Directory-name references (render/, test2/, tests/)');
console.log(`  total references : ${findings.length}`);
console.log(`  by directory     : ${Object.entries(byDir).map(([k, v]) => `${k} ${v}`).join('   ')}`);
console.log('  by risk class    :');
for (const kind of ['RUNTIME', 'CONFIG', 'BUILD', 'TEST', 'DOC']) {
  if (!byKind[kind]) continue;
  console.log(`     ${kind.padEnd(8)} ${String(byKind[kind]).padStart(4)} refs in ${filesByKind[kind].size} file(s)`);
}

console.log('\n  RUNTIME references — these 404 in production if missed:');
for (const file of [...(filesByKind.RUNTIME || [])].sort()) {
  const n = findings.filter((f) => f.file === file && f.kind === 'RUNTIME').length;
  console.log(`     ${String(n).padStart(3)}  ${file}`);
}
console.log('\n  CONFIG references — these fail SILENTLY if missed:');
for (const file of [...(filesByKind.CONFIG || [])].sort()) {
  const n = findings.filter((f) => f.file === file && f.kind === 'CONFIG').length;
  console.log(`     ${String(n).padStart(3)}  ${file}`);
}

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({
    note: 'Reference count for render/, test2/ and tests/. Ratchet for validate-directory-name-references.mjs: this may shrink as the rename progresses, and must not grow while it is deferred.',
    total: findings.length,
    byKind,
    byDir,
  }, null, 2)}\n`);
  console.log(`\nRe-pinned baseline: ${findings.length} references.`);
  process.exit(0);
}

if (CHECK) {
  if (!existsSync(BASELINE)) {
    console.error(`\nFAIL: ${BASELINE} is missing. Create it with --update-baseline.`);
    process.exit(1);
  }
  const pinned = JSON.parse(readFileSync(BASELINE, 'utf8'));
  if (findings.length > pinned.total) {
    console.error(`\nFAIL: references grew ${pinned.total} -> ${findings.length}.`);
    console.error('  The surface a rename has to cover is expanding while the rename is deferred.');
    console.error('  Either avoid the new reference, or re-pin deliberately with --update-baseline.');
    process.exit(1);
  }
  console.log(`\nPASS: ${findings.length} references (baseline ${pinned.total}; may shrink, never grow).`);
}
