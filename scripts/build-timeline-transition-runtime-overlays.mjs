#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, 'data', 'timeline-transitions');
const OUT_DIR = join(ROOT, 'data', 'timeline-transition-overlays');
const TRANSITIONS = [
  'wards-1972__wards-1984',
  'wards-1984__wards-1993',
  'wards-1993__wards-2012',
  'wards-2012__wards-2022-final-recommendations'
];
const VISIBLE_TYPES = new Set(['split', 'territory-split', 'transfer']);

function transitionType(feature) {
  return String(feature?.properties?.transitionType || feature?.properties?.changeType || '').trim();
}

function visibleTransitionFeature(feature) {
  return VISIBLE_TYPES.has(transitionType(feature));
}

mkdirSync(OUT_DIR, { recursive: true });
const summary = [];
for (const id of TRANSITIONS) {
  const sourcePath = join(SOURCE_DIR, `${id}.geojson`);
  const outPath = join(OUT_DIR, `${id}.geojson`);
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const sourceFeatures = Array.isArray(source.features) ? source.features : [];
  const features = sourceFeatures.filter(visibleTransitionFeature);
  const output = {
    type: 'FeatureCollection',
    name: source.name || `Territorial transition: ${id}`,
    metadata: {
      ...(source.metadata || {}),
      runtimeOverlay: true,
      sourceSidecar: `data/timeline-transitions/${basename(sourcePath)}`,
      omittedTransitionTypes: ['unchanged', 'retained'],
      sourceFeatureCount: sourceFeatures.length,
      runtimeFeatureCount: features.length,
      reason: 'Browser runtime overlay contains only visible red/purple transition parts so it stays below Cloudflare Pages per-file limits.'
    },
    features
  };
  writeFileSync(outPath, JSON.stringify(output), 'utf8');
  summary.push({
    path: outPath.replace(ROOT + '\\', '').replaceAll('\\', '/'),
    sourceFeatures: sourceFeatures.length,
    runtimeFeatures: features.length,
    bytes: Buffer.byteLength(JSON.stringify(output))
  });
}
console.log(JSON.stringify(summary, null, 2));
