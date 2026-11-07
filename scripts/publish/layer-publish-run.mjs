// @ts-check
/**
 * The stages of one `scripts/publish/layers.mjs` run, as an explicit machine (refactor plan
 * section 11).
 *
 * layers.mjs exists because the seven commands were typed in the wrong order (a commit between
 * the build and the switch published layers pointing at local archives Pages does not serve;
 * promote after the build undid it). The order lived only in an array; it is now a transition
 * table, so a reordered or skipped step fails before it runs, and the run has two entries:
 *
 *   pending -> built -> indexed -> manifested -> uploaded -> verified -> switched
 *           \___ --no-build ___/^                            -> aliases-repaired -> planned -> published
 *   (any stage) -> failed
 *
 * `published` is guarded: every listed layer must serve from the CDN.
 */
import { defineMachine } from './state-machine.mjs';

/**
 * @typedef {'pending' | 'built' | 'indexed' | 'manifested' | 'uploaded' | 'verified' | 'switched'
 *   | 'aliases-repaired' | 'planned' | 'published' | 'failed'} RunStage
 */

const ORDER = /** @type {const} */ (['pending', 'built', 'indexed', 'manifested', 'uploaded', 'verified', 'switched', 'aliases-repaired', 'planned', 'published']);

/** @type {Record<RunStage, RunStage[]>} */
const transitions = {
  pending: ['built', 'manifested', 'failed'],
  built: ['indexed', 'failed'],
  indexed: ['manifested', 'failed'],
  manifested: ['uploaded', 'failed'],
  uploaded: ['verified', 'failed'],
  verified: ['switched', 'failed'],
  switched: ['aliases-repaired', 'failed'],
  'aliases-repaired': ['planned', 'failed'],
  planned: ['published', 'failed'],
  published: [],
  failed: [],
};

export const layerPublishRun = defineMachine(/** @type {import('./state-machine.mjs').MachineDefinition<RunStage>} */ ({
  name: 'layers.mjs run',
  states: [...ORDER, 'failed'],
  initial: 'pending',
  transitions,
  guards: {
    'pending->built': (/** @type {{ build?: boolean }} */ ctx) => (ctx.build === false ? 'the run was started with --no-build' : null),
    'pending->manifested': (/** @type {{ build?: boolean }} */ ctx) => (ctx.build === false ? null : 'a build run builds the archives first (--no-build skips them)'),
    'planned->published': (/** @type {{ notOnCdn?: string[] }} */ ctx) => (
      ctx.notOnCdn?.length ? `still not on the CDN: ${ctx.notOnCdn.join(', ')}` : null
    ),
  },
}));

/**
 * The steps of a run: what each runs and the stage it reaches. Asserted against the machine, so a
 * list that skips or reorders a stage throws here, before any step has run.
 * @param {{ idList: string, build: boolean }} options
 * @returns {Array<{ label: string, args: string[], reaches: RunStage }>}
 */
export function layerPublishSteps({ idList, build }) {
  /** @type {Array<{ label: string, args: string[], reaches: RunStage }>} */
  const steps = [
    ...(build ? [
      { label: 'Build the tile archives', args: ['scripts/build/tiles/pmtiles.mjs', '--force', '--ids', idList], reaches: /** @type {RunStage} */ ('built') },
      { label: 'Build the feature indexes', args: ['scripts/build/tiles/feature-indexes.mjs', '--ids', idList], reaches: /** @type {RunStage} */ ('indexed') },
    ] : []),
    { label: 'Write the CDN upload manifest', args: ['scripts/publish/r2-manifest.mjs'], reaches: 'manifested' },
    { label: 'Upload to R2', args: ['scripts/publish/r2-upload-pmtiles.mjs', '--ids', idList], reaches: 'uploaded' },
    // No --apply: verify --apply imports the switch with verify's own argv, and the switch takes
    // only --ids, so it refused the run ("unrecognised flag(s): --apply") after the report was
    // written. The switch is the next step, scoped to the same ids.
    { label: 'Verify byte ranges on the CDN', args: ['scripts/publish/verify-pmtiles-cdn.mjs', '--ids', idList], reaches: 'verified' },
    { label: 'Switch the layers to their CDN URLs', args: ['scripts/publish/switch-pmtiles-to-cdn.mjs', '--ids', idList], reaches: 'switched' },
    { label: 'Repair alias layers', args: ['scripts/build/tiles/repair-alias-layers.mjs'], reaches: 'aliases-repaired' },
    { label: 'Rebuild the layer metadata', args: ['scripts/build/tiles/layer-plan.mjs'], reaches: 'planned' },
  ];
  let stage = layerPublishRun.initial;
  for (const step of steps) stage = layerPublishRun.assert(stage, step.reaches, { build });
  return steps;
}
