#!/usr/bin/env node
/**
 * Guard the duplicated election-viewer-package assets.
 *
 * There are two copies of the viewer's js/ and css/:
 *
 *   election-viewer-package/       <- original; its data/ tree is a LIVE BUILD
 *                                     INPUT (scripts/build-test2-election-manifest.mjs
 *                                     reads data/elections + elections_index.json)
 *   app/election-viewer-package/   <- the copy production actually serves
 *                                     (index.html + sw.js + _headers reference
 *                                     /app/election-viewer-package/*)
 *
 * Neither copy can simply be deleted: the root tree is required to build, and
 * the app/ tree is required to serve.
 *
 * scripts/build-test2-app.mjs copies root -> app/ on every build, so the copies
 * cannot diverge *while builds are run*. What this validator catches is the gap
 * either side of that:
 *
 *   1. Someone edits app/election-viewer-package/* directly — reasonable, since
 *      that is the copy production serves — and the next build silently reverts
 *      it. Fails here first, before the work is lost.
 *   2. Someone edits the root copy and commits without rebuilding, leaving the
 *      committed app/ copy (the served one) stale.
 *
 * MIRRORED must stay in sync with the `assets` list in
 * scripts/build-test2-app.mjs (~line 119). If you add a mirrored file there,
 * add it here.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIRRORED = [
  'css/election-viewer.css',
  'css/stages.css',
  'js/animation_preview.js',
  'js/animation_preview_manager.js',
  'js/election_viewer.js',
  'js/stages2.js'
];

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const problems = [];
let compared = 0;

for (const rel of MIRRORED) {
  const source = path.join(ROOT, 'election-viewer-package', rel);
  const served = path.join(ROOT, 'app', 'election-viewer-package', rel);

  if (!existsSync(source)) {
    problems.push(`missing source copy: election-viewer-package/${rel}`);
    continue;
  }
  if (!existsSync(served)) {
    problems.push(`missing served copy: app/election-viewer-package/${rel}`);
    continue;
  }

  const sourceHash = digest(source);
  const servedHash = digest(served);
  compared += 1;

  if (sourceHash !== servedHash) {
    problems.push(
      `DRIFT: ${rel}\n` +
      `    election-viewer-package/${rel}      ${sourceHash.slice(0, 16)}\n` +
      `    app/election-viewer-package/${rel}  ${servedHash.slice(0, 16)}\n` +
      `    (production serves the app/ copy)`
    );
  }
}

if (problems.length) {
  console.error('Election viewer package parity FAILED:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`PASS: election-viewer-package mirrored assets identical (${compared}/${MIRRORED.length} files).`);
