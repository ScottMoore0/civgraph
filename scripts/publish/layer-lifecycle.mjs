// @ts-check
/**
 * The life of a published tile layer, made explicit: built locally, uploaded to R2, verified on
 * the CDN, switched to serve from it (refactor plan section 11).
 *
 * The state used to be implicit in four files that each tool read its own way: the CDN upload
 * manifest (`exists`, `remoteVerified`), the upload report (`status`), the range report (`ok`)
 * and the layer metadata (`tilePackage.serving`). switch-pmtiles-to-cdn.mjs switched any layer
 * that had an ok range result under its id, whichever URL that result had checked; after the
 * 7 Nov manifest regeneration rewrote every key, an older ok result would have let the switch
 * point a layer at a key that was never uploaded. The switch is now a transition with a guard:
 * the range result must be for the URL the layer is about to serve, and when the archive is on
 * disk, of the same size (a rebuild that was never uploaded fails the check it once passed).
 *
 *   local ----upload----> uploaded ----verify----> verified ----switch----> serving
 *     |  \___________________________________________/^ |                    |
 *     |        (already on R2: verify only)              +----rebuild----> local
 *     +--> failed (upload or verify failed; upload or verify again)
 *
 * MVT directories have no byte-range check: an `uploaded-directory` report switches them
 * (`uploaded -> serving`, guarded to that kind).
 */
import { defineMachine } from './state-machine.mjs';

/** @typedef {'local' | 'uploaded' | 'verified' | 'serving' | 'failed'} LayerState */

/**
 * @typedef {object} SwitchContext
 * @property {'pmtiles' | 'mvt-directory'} kind
 * @property {string} [cdnUrl]     the URL the switch would serve (the manifest's)
 * @property {string} [checkedUrl] the URL the range check fetched
 * @property {number | null} [localBytes]  the local archive's size, when it is on disk
 * @property {number | null} [remoteBytes] the size the CDN reported (Content-Range total)
 * @property {string} [uploadStatus]
 */

export const layerLifecycle = defineMachine(/** @type {import('./state-machine.mjs').MachineDefinition<LayerState>} */ ({
  name: 'layer lifecycle',
  states: ['local', 'uploaded', 'verified', 'serving', 'failed'],
  initial: 'local',
  transitions: {
    local: ['uploaded', 'verified', 'failed'],
    uploaded: ['verified', 'serving', 'failed'],
    failed: ['uploaded', 'verified', 'failed'],
    verified: ['serving', 'local'],
    serving: ['verified', 'local'],
  },
  guards: {
    'verified->serving': (/** @type {SwitchContext} */ ctx) => {
      if (ctx.kind !== 'pmtiles') return `a ${ctx.kind} is switched from its upload, not a range check`;
      if (!ctx.cdnUrl) return 'no CDN URL in the upload manifest';
      if (ctx.checkedUrl !== ctx.cdnUrl) return `the range check fetched ${ctx.checkedUrl || '(no URL)'}, not ${ctx.cdnUrl}`;
      // Rebuilt and not uploaded: the check passed on the CDN's older bytes.
      if (ctx.localBytes && ctx.remoteBytes && ctx.localBytes !== ctx.remoteBytes) {
        return `the CDN holds ${ctx.remoteBytes} bytes and the local archive ${ctx.localBytes}: rebuilt and not uploaded`;
      }
      return null;
    },
    'uploaded->serving': (/** @type {SwitchContext} */ ctx) => {
      if (ctx.kind !== 'mvt-directory') return 'a PMTiles archive must pass the byte-range check before it serves';
      if (ctx.uploadStatus !== 'uploaded-directory') return `the directory upload reported ${ctx.uploadStatus || 'nothing'}`;
      return null;
    },
  },
}));

/**
 * The total size in a Content-Range header (`bytes 0-15/62661` -> 62661), else null.
 * @param {unknown} value
 */
export function contentRangeTotal(value) {
  const match = String(value || '').match(/\/(\d+)$/);
  const total = match ? Number(match[1]) : NaN;
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * @typedef {object} LayerEvidence
 * @property {{ tileUrl?: string, tilePackage?: { serving?: string } }} layer
 * @property {{ cdnUrl?: string, exists?: boolean } | undefined} [asset]
 * @property {{ ok?: boolean, status?: string } | undefined} [upload]
 * @property {{ ok?: boolean } | undefined} [range]
 */

/**
 * The state the reports put a PMTiles layer in. This run's evidence comes first (a passing
 * range check is `verified` even for a layer already serving, so a re-run restamps it, as the
 * switch always did); without any, a layer serving its manifest URL is `serving`.
 * @param {LayerEvidence} evidence
 * @returns {LayerState}
 */
export function pmtilesLayerState({ layer, asset, upload, range }) {
  if (range?.ok) return 'verified';
  if (upload?.ok && upload.status === 'uploaded') return 'uploaded';
  if ((upload && upload.ok === false) || (range && range.ok === false)) return 'failed';
  if (layer.tilePackage?.serving === 'cdn' && asset?.cdnUrl && layer.tileUrl === asset.cdnUrl) return 'serving';
  return 'local';
}

/**
 * The state the upload report puts an MVT directory in.
 * @param {{ upload?: { ok?: boolean, status?: string } }} evidence
 * @returns {LayerState}
 */
export function mvtDirectoryState({ upload }) {
  if (upload?.ok && upload.status === 'uploaded-directory') return 'uploaded';
  if (upload && upload.ok === false) return 'failed';
  return 'local';
}
