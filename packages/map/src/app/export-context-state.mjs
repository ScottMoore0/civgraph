/**
 * The SVG export's context outlines (the neighbouring land and the loughs, packages/map/app/map-image-export.js
 * loadContextLand and loadContextLoughs): each is fetched once a page, on the first export that
 * needs it, and kept; a failed fetch is forgotten, so the next export tries again. One run of this
 * machine per outline (state-helpers createState), moved beside the memoised promise it describes.
 *
 *   idle -> loading      the first export that needs the outline
 *   loading -> ready     fetched and decoded; kept for the page's life
 *   loading -> failed    the fetch or the decoding failed; that export reports the error
 *   failed -> loading    the next export asks again
 *
 * While loading, a second export waits for the same fetch (no move). Pure: no I/O.
 */
import { defineMachine } from '../../../core/src/state-machine.mjs';

/** @typedef {'idle' | 'loading' | 'ready' | 'failed'} ContextOutlineState */

export const CONTEXT_OUTLINE_LOAD = defineMachine({
  name: 'export context outline load',
  initial: /** @type {ContextOutlineState} */ ('idle'),
  transitions: /** @type {Record<ContextOutlineState, ContextOutlineState[]>} */ ({
    idle: ['loading'],
    loading: ['ready', 'failed'],
    ready: [],
    failed: ['loading'],
  }),
});
