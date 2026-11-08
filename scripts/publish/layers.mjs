#!/usr/bin/env node
/**
 * Build, upload, verify and switch vector tile layers in one run.
 *
 * The chain was seven commands typed in order, and the order was easy to get wrong:
 * build-test-pmtiles points each rebuilt layer at its LOCAL archive until the upload and
 * switch have run, so a commit taken in between published layers pointing at files Pages
 * does not serve, and promote run after the build undid it. Running the chain as one step
 * means the metadata is never left in that in-between state.
 *
 * Uploads to R2 are publications (data.civgraph.net serves the bucket), so run this only
 * once the publication is approved. R2 credentials come from the environment
 * (.claude/publish/r2.sh layers <ids> loads them).
 *
 *   node scripts/publish/layers.mjs --ids a,b,c            build and publish
 *   node scripts/publish/layers.mjs --ids a,b,c --no-build publish archives already built
 *
 * A new layer still needs featureIndexUrl set by hand before its feature index will build,
 * and the vector-batch/promote steps (source conversion) are not part of this: promote run
 * after the tile build undoes it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RESUME_MARKER, assertRunTransition, checkRunTransition, layerPublishRun, layerPublishSteps, resumeMarker } from './layer-publish-run.mjs';

const args = process.argv.slice(2);
const idsAt = args.indexOf('--ids');
const ids = idsAt >= 0 ? String(args[idsAt + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
if (!ids.length) {
  console.error('usage: node scripts/publish/layers.mjs --ids <comma-separated layer ids> [--no-build]');
  process.exit(2);
}
const idList = ids.join(',');
const build = !args.includes('--no-build');

// The stages are a machine (layer-publish-run.mjs): a skipped or reordered step throws here.
const steps = layerPublishSteps({ idList, build });
if (existsSync(RESUME_MARKER)) {
  const prior = JSON.parse(readFileSync(RESUME_MARKER, 'utf8'));
  console.log(`Note: the last layers.mjs run (${prior.at}) stopped after "${prior.reached}" at "${prior.failedStep}" for ${prior.ids?.length ?? '?'} layer(s).`);
}
/** @type {import('./layer-publish-run.mjs').RunStage} */
let stage = layerPublishRun.initial;

for (const { label, args: stepArgs, reaches } of steps) {
  const started = Date.now();
  const result = spawnSync(process.execPath, stepArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const output = `${result.stdout || ''}${result.stderr || ''}`.split(/\r?\n/)
    .filter((line) => line.trim() && !/ExperimentalWarning|MODULE_TYPELESS|trace-warnings|eliminate this warning|Reparsing as ES module/.test(line));
  if (result.status !== 0) {
    const marker = resumeMarker({ ids, build, reached: stage, failedStep: label });
    stage = assertRunTransition(stage, 'failed');
    console.log(`FAIL ${seconds.padStart(4)}s  ${label}`);
    console.log(output.slice(-25).join('\n'));
    // The resume marker: a failure after the build leaves the layers on local tileUrls, and the
    // next run should know (state-machine catalogue PL-02).
    mkdirSync(dirname(RESUME_MARKER), { recursive: true });
    writeFileSync(RESUME_MARKER, `${JSON.stringify(marker, null, 2)}\n`);
    console.log(`\nStopped after "${marker.reached}"${marker.tileUrlsLocal ? '; the listed layers may still point at local archives' : ''}. Resume: ${marker.resume}`);
    process.exit(result.status || 1);
  }
  stage = assertRunTransition(stage, reaches, { build });
  console.log(`ok   ${seconds.padStart(4)}s  ${label}  -- ${(output.slice(-1)[0] || '').trim().slice(0, 110)}`);
}

// What the run should have left: every listed layer served from the CDN.
/** @type {import('../../packages/types/index.js').LayerEntry[] | { layers?: import('../../packages/types/index.js').LayerEntry[] }} */
const metadata = JSON.parse(readFileSync('render/metadata/maps-test.json', 'utf8'));
const layers = Array.isArray(metadata) ? metadata : (metadata.layers || []);
const local = ids.filter((id) => {
  const layer = layers.find((entry) => entry.id === id);
  return !layer || !/^https:\/\//.test(String(layer.tileUrl || ''));
});
const done = checkRunTransition(stage, 'published', { notOnCdn: local });
if (!done.ok) {
  console.log(`FAIL: ${local.length ? `still not on the CDN: ${local.join(', ')}` : done.reason}`);
  process.exit(1);
}
rmSync(RESUME_MARKER, { force: true });
console.log(`\nPUBLISHED ${ids.length} layer(s): built, uploaded, byte-range verified and switched to the CDN.`);
