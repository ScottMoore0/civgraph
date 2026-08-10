#!/usr/bin/env node
/**
 * Emit THIRD-PARTY-NOTICES.txt for everything actually bundled into app/build.
 *
 * WHY
 *
 * All of the runtime dependencies are notice-retention licences -- MIT,
 * BSD-3-Clause, Apache-2.0 -- and each requires the copyright and permission
 * notice to accompany distributed copies. A minified browser bundle is a
 * distributed copy, so shipping app/build without those notices under-complies
 * with the terms the project itself depends on.
 *
 * esbuild's legalComments cannot fix this alone. It preserves comments that
 * exist in the source, and only maplibre-gl carries an inline @license; pmtiles,
 * geotiff and the turf packages ship LICENSE files with no comment for esbuild
 * to find. So the notices have to be assembled from the packages themselves.
 *
 * The bundled set is taken from esbuild's metafile rather than package.json
 * dependencies: those are not the same thing. package.json lists what may be
 * imported, the metafile records what actually landed in the output, which is
 * what is being distributed and therefore what must be attributed.
 *
 * A package that declares a licence but ships no licence text (pmtiles does
 * exactly this) is recorded with its SPDX identifier and repository, and listed
 * separately at the end so the gap is visible rather than silently dropped.
 *
 * Usage: node scripts/build-third-party-notices.mjs [--check]
 *   --check  fail if the notices file is missing or out of date (for CI)
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const METAFILE = path.join(ROOT, 'app/build/metafile.json');
const OUT = path.join(ROOT, 'app/build/THIRD-PARTY-NOTICES.txt');
const CHECK = process.argv.includes('--check');

if (!existsSync(METAFILE)) {
  console.error(`Missing ${path.relative(ROOT, METAFILE)}.`);
  console.error('Run node scripts/build-test2-app.mjs first — it writes the metafile.');
  process.exit(2);
}

const meta = JSON.parse(readFileSync(METAFILE, 'utf8'));

/** Package names present in the bundle, from the paths esbuild resolved. */
function bundledPackages() {
  const names = new Set();
  for (const p of Object.keys(meta.inputs || {})) {
    const m = /node_modules[/\\](@[^/\\]+[/\\][^/\\]+|[^/\\]+)/.exec(p);
    if (m) names.add(m[1].replace(/\\/g, '/'));
  }
  return [...names].sort();
}

const LICENCE_FILENAMES = /^(licen[cs]e|copying|notice)(\.(txt|md))?$/i;

function licenceTextFor(pkg) {
  const dir = path.join(ROOT, 'node_modules', pkg);
  if (!existsSync(dir)) return null;
  let file = null;
  try { file = readdirSync(dir).find((f) => LICENCE_FILENAMES.test(f)); } catch { return null; }
  if (!file) return null;
  try { return readFileSync(path.join(dir, file), 'utf8').trim(); } catch { return null; }
}

function manifestFor(pkg) {
  const p = path.join(ROOT, 'node_modules', pkg, 'package.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

const packages = bundledPackages();
const withText = [];
const withoutText = [];

for (const pkg of packages) {
  const man = manifestFor(pkg);
  const licence = typeof man.license === 'string' ? man.license : (man.license?.type || 'UNKNOWN');
  const repo = typeof man.repository === 'string' ? man.repository : (man.repository?.url || '');
  const text = licenceTextFor(pkg);
  (text ? withText : withoutText).push({ pkg, version: man.version || '', licence, repo, text });
}

const lines = [];
lines.push('THIRD-PARTY NOTICES');
lines.push('');
lines.push('This bundle includes third-party software. Each package below is distributed');
lines.push('under the licence shown, and the required copyright and permission notices are');
lines.push('reproduced in full. Generated from the esbuild metafile, so this lists what is');
lines.push('actually present in the bundle rather than what is merely declared as a');
lines.push('dependency.');
lines.push('');
lines.push(`Packages: ${packages.length}`);
lines.push('');
for (const e of withText) {
  lines.push('='.repeat(78));
  lines.push(`${e.pkg}${e.version ? `@${e.version}` : ''}  —  ${e.licence}`);
  if (e.repo) lines.push(e.repo.replace(/^git\+/, '').replace(/\.git$/, ''));
  lines.push('='.repeat(78));
  lines.push('');
  lines.push(e.text);
  lines.push('');
}
if (withoutText.length) {
  lines.push('='.repeat(78));
  lines.push('PACKAGES DECLARING A LICENCE BUT SHIPPING NO LICENCE TEXT');
  lines.push('='.repeat(78));
  lines.push('');
  lines.push('These declare an SPDX licence in package.json but include no licence file in');
  lines.push('the published tarball, so the full text cannot be reproduced from what is');
  lines.push('installed. The declared identifier and upstream repository are recorded so the');
  lines.push('terms remain traceable.');
  lines.push('');
  for (const e of withoutText) {
    lines.push(`  ${e.pkg}${e.version ? `@${e.version}` : ''}  —  ${e.licence}`);
    if (e.repo) lines.push(`      ${e.repo.replace(/^git\+/, '').replace(/\.git$/, '')}`);
  }
  lines.push('');
}
const content = lines.join('\n');

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== content) {
    console.error('FAIL: THIRD-PARTY-NOTICES.txt is missing or out of date.');
    console.error('  Run: node scripts/build-third-party-notices.mjs');
    process.exit(1);
  }
  console.log(`PASS: notices current for ${packages.length} bundled package(s).`);
  process.exit(0);
}

writeFileSync(OUT, content);
console.log('Third-party notices');
console.log(`  bundled packages   : ${packages.length}`);
console.log(`  with licence text  : ${withText.length}`);
console.log(`  declared only      : ${withoutText.length}`);
for (const e of withoutText) console.log(`      ${e.pkg} (${e.licence}) ships no licence file`);
console.log(`  written            : ${path.relative(ROOT, OUT).replace(/\\/g, '/')}`);
