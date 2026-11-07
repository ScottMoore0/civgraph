// The stages of scripts/publish/layers.mjs (scripts/publish/layer-publish-run.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { layerPublishRun, layerPublishSteps } from '../../scripts/publish/layer-publish-run.mjs';

// The commands layers.mjs ran before the machine, in order: the steps must not change.
const BEFORE = (idList, build) => [
  ...(build ? [
    ['Build the tile archives', ['scripts/build/tiles/pmtiles.mjs', '--force', '--ids', idList]],
    ['Build the feature indexes', ['scripts/build/tiles/feature-indexes.mjs', '--ids', idList]],
  ] : []),
  ['Write the CDN upload manifest', ['scripts/publish/r2-manifest.mjs']],
  ['Upload to R2', ['scripts/publish/r2-upload-pmtiles.mjs', '--ids', idList]],
  ['Verify byte ranges on the CDN', ['scripts/publish/verify-pmtiles-cdn.mjs', '--ids', idList]],
  ['Switch the layers to their CDN URLs', ['scripts/publish/switch-pmtiles-to-cdn.mjs', '--ids', idList]],
  ['Repair alias layers', ['scripts/build/tiles/repair-alias-layers.mjs']],
  ['Rebuild the layer metadata', ['scripts/build/tiles/layer-plan.mjs']],
];

for (const build of [true, false]) {
  test(`the ${build ? 'build' : '--no-build'} run runs the same commands in the same order`, () => {
    const steps = layerPublishSteps({ idList: 'a-vector,b-vector', build });
    assert.deepEqual(steps.map((s) => [s.label, s.args]), BEFORE('a-vector,b-vector', build));
    assert.equal(steps.at(-1).reaches, 'planned');
  });
}

test('a run cannot skip or reorder a stage', () => {
  const forbidden = [
    ['pending', 'uploaded'], ['built', 'manifested'], ['manifested', 'verified'], ['uploaded', 'switched'],
    ['verified', 'planned'], ['switched', 'published'], ['published', 'pending'], ['failed', 'built'],
  ];
  for (const [from, to] of forbidden) assert.equal(layerPublishRun.check(from, to, { build: true }).ok, false, `${from} -> ${to}`);
});

test('the two entries: a build run must build, a --no-build run must not', () => {
  assert.equal(layerPublishRun.check('pending', 'built', { build: true }).ok, true);
  assert.equal(layerPublishRun.check('pending', 'manifested', { build: true }).ok, false);
  assert.equal(layerPublishRun.check('pending', 'manifested', { build: false }).ok, true);
  assert.equal(layerPublishRun.check('pending', 'built', { build: false }).ok, false);
});

test('any stage may fail; published needs every layer on the CDN', () => {
  for (const stage of layerPublishRun.states) {
    if (stage === 'published' || stage === 'failed') continue;
    assert.equal(layerPublishRun.check(stage, 'failed').ok, true, stage);
  }
  const notYet = layerPublishRun.check('planned', 'published', { notOnCdn: ['b-vector'] });
  assert.equal(notYet.ok, false);
  assert.match(notYet.reason, /b-vector/);
  assert.equal(layerPublishRun.check('planned', 'published', { notOnCdn: [] }).ok, true);
  assert.ok(layerPublishRun.isFinal('published') && layerPublishRun.isFinal('failed'));
});
