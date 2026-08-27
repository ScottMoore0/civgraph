#!/usr/bin/env node
/**
 * Assert that every asset the site asks for actually exists after a build.
 *
 * WHY THIS EXISTS
 *
 * app/src/app.js loaded '/app/js/libs/flatgeobuf-geojson.min.js' before parsing
 * any FlatGeobuf layer, and sw.js precached the same path, but nothing ever put
 * a file there -- copyAnimationRuntimeAssets() had not been told to copy it.
 * Every FGB layer load failed on the live site, and it went unnoticed because a
 * stale Cloudflare cache entry answered that URL with HTTP 200 for over a week.
 *
 * A status-code probe could not see it. Only comparing what the code REQUESTS
 * against what the build PRODUCES catches this, which is what this does.
 *
 * MATCHING IS ANCHORED ON PURPOSE. While investigating the above I repeatedly
 * matched substrings and drew false conclusions: 'js/web-vitals-4.iife.js'
 * matched inside 'assets/js/web-vitals-4.iife.js' and invented a bug that did
 * not exist; 'js/stages2.js' matched inside 'data/elections-source/js/...'
 * and implied the live app depended on the legacy directory. Every pattern here
 * captures a complete quoted path and resolves it, so a reference can never be
 * confused with a different file that merely ends the same way.
 *
 * Usage:
 *   node scripts/validate-asset-references.mjs [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

// Entry points that describe what the browser will fetch.
const HTML_FILES = ['index.html', '404.html', 'browse/index.html', 'app/index.html'];
const JS_FILES = ['app/src/app.js', 'app/src/election-manager.js', 'browse/browse.js'];
// sw.js is scanned with an extra pattern the others must NOT get -- see below.
const PRECACHE_FILES = ['sw.js'];

// Each pattern captures ONE complete path in group 1.
const HTML_PATTERNS = [
  /<script[^>]+src\s*=\s*["']([^"']+)["']/gi,
  /<link[^>]+href\s*=\s*["']([^"']+)["']/gi,
  /<img[^>]+src\s*=\s*["']([^"']+)["']/gi
];
const JS_PATTERNS = [
  /loadClassicScript\(\s*["']([^"']+)["']/g,
  /new\s+Worker\(\s*["']([^"']+)["']/g
];

// Bare quoted absolute paths. Correct for a service-worker precache array,
// WRONG for general source: in app/src/app.js the string '/metadata.json' is a
// replacement fragment inside layer.tilesFallback.replace('/{z}/{x}/{y}.pbf',
// '/metadata.json') -- it is a URL suffix, never fetched on its own. Running
// this pattern over ordinary JS reported it as a missing asset. Restricted to
// files whose quoted paths really are a fetch list.
const PRECACHE_PATTERNS = [
  /["'](\/[A-Za-z0-9_\-./]+\.(?:js|mjs|css|json|wasm|woff2?|png|svg|webp))["']/g
];

const skip = (u) =>
  !u ||
  /^(https?:)?\/\//.test(u) ||   // external
  u.startsWith('data:') ||
  u.startsWith('#') ||
  u.startsWith('mailto:') ||
  u.includes('${') ||            // template literal — not statically resolvable
  u.startsWith('blob:');

/** Resolve a reference to a repo path. Site-absolute paths are rooted at ROOT. */
function resolveRef(ref, fromFile) {
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return null;
  return clean.startsWith('/')
    ? path.join(ROOT, clean)
    : path.resolve(path.dirname(path.join(ROOT, fromFile)), clean);
}

const refs = [];
function collect(file, patterns) {
  const abs = path.join(ROOT, file);
  if (!existsSync(abs)) return;
  const src = readFileSync(abs, 'utf8');
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const ref = m[1];
      if (skip(ref)) continue;
      const target = resolveRef(ref, file);
      if (target) refs.push({ from: file, ref, target });
    }
  }
}

for (const f of HTML_FILES) collect(f, HTML_PATTERNS);
for (const f of JS_FILES) collect(f, JS_PATTERNS);
for (const f of PRECACHE_FILES) collect(f, [...JS_PATTERNS, ...PRECACHE_PATTERNS]);

// Deduplicate on the resolved target plus its origin, so one missing asset
// referenced from three places is reported three times (each needs fixing).
const seen = new Set();
const missing = [];
let checked = 0;
for (const r of refs) {
  const key = `${r.from}|${r.target}`;
  if (seen.has(key)) continue;
  seen.add(key);
  checked += 1;
  let ok = false;
  try { ok = statSync(r.target).isFile(); } catch { ok = false; }
  if (!ok) missing.push(r);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ checked, missing: missing.length, missingRefs: missing }, null, 2));
} else {
  console.log('Asset reference check');
  console.log(`  references resolved : ${checked}`);
  console.log(`  missing on disk     : ${missing.length}`);
  for (const m of missing) {
    console.log(`\n  MISSING  ${m.ref}`);
    console.log(`      requested by : ${m.from}`);
    console.log(`      resolves to  : ${path.relative(ROOT, m.target).replace(/\\/g, '/')}`);
  }
  if (!missing.length) console.log('\n  PASS: every referenced asset exists.');
}

if (missing.length) {
  console.error(`\n  FAIL: ${missing.length} referenced asset(s) do not exist after build.`);
  console.error('  A reference with no file is a runtime failure that status-code checks miss,');
  console.error('  because a cached or fallback response can answer the URL with HTTP 200.');
  process.exit(1);
}
