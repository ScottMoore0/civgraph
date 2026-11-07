// @ts-check
/**
 * Where a layer's PMTiles archive lives on R2, for the CDN upload manifest (r2-manifest.mjs).
 *
 * THE KEY IS THE ARCHIVE'S, NOT THE LAYER ID'S. The manifest used to build every key from
 * `layer.id`. The layer-id rename (`-vector-test` -> `-vector`, scripts/maps/rename-layer-ids.mjs)
 * renamed the ids but deliberately not the R2 objects, so on 7 Nov 2026 one regeneration
 * rewrote all 934 entries to keys that do not exist on R2; switch-pmtiles-to-cdn.mjs copies
 * `cdnUrl` straight into `tileUrl`, so a switch after that would have pointed every layer at a
 * missing object. A key is now chosen in this order:
 *
 *   1. a local archive that exists: its own file name. A rebuild written under a new name
 *      (eds-ulster-1911-vector.pmtiles beside the old -vector-test one) is a new upload and
 *      gets a new key, so the CDN cannot serve the old bytes under it; a rebuild in place
 *      keeps the key it had.
 *   2. no local archive (built, uploaded, deleted locally): where the layer already points,
 *      `tilePackage.r2Key`, then a CDN URL under the manifest's base (`tilePackage.cdnUrl`,
 *      `tileUrl`).
 *   3. the key the previous manifest recorded for the layer.
 *   4. the configured local file name, else `<layer id>.pmtiles`: only a layer never uploaded
 *      reaches this, and it gets the renamed form.
 *
 * Pure: the caller says whether the archive exists and passes the prior manifest entry.
 */

/**
 * @typedef {object} PmtilesLayer
 * @property {string} id
 * @property {string} [tileUrl]
 * @property {{ localPath?: string, r2Key?: string, cdnUrl?: string }} [tilePackage]
 */

/**
 * @typedef {object} KeyContext
 * @property {boolean} exists     the configured local archive exists on disk
 * @property {string} r2Prefix    e.g. data/maps/test
 * @property {string} cdnBase     e.g. https://data.civgraph.net/data/maps/test
 * @property {{ targetKey?: string } | undefined} [prior]  the previous manifest's entry for the layer
 */

/** @typedef {'local-archive' | 'r2-key' | 'cdn-url' | 'prior-manifest' | 'configured-name' | 'layer-id'} KeySource */

const trimSlashes = (/** @type {string} */ value) => value.replace(/^\/+/, '').replace(/\/+$/, '');
const fileName = (/** @type {string} */ value) => value.split(/[\\/]/).pop() || '';
const isArchiveName = (/** @type {string} */ name) => /^[^/\\]+\.pmtiles$/i.test(name);

/** The path under `r2Prefix` for an R2 key or CDN URL that sits under the manifest's roots. */
function suffixUnder(/** @type {unknown} */ value, /** @type {string} */ root) {
  const text = String(value || '');
  const base = trimSlashes(root);
  if (!text || !base) return null;
  if (!text.startsWith(`${base}/`)) return null;
  const rest = text.slice(base.length + 1).split(/[?#]/)[0];
  return rest.endsWith('.pmtiles') ? rest : null;
}

/**
 * The archive's path under the R2 prefix (e.g. `pmtiles/generated/x-vector-test.pmtiles`) and
 * which rule chose it.
 *
 * @param {PmtilesLayer} layer
 * @param {KeyContext} ctx
 * @returns {{ suffix: string, source: KeySource }}
 */
export function pmtilesTargetSuffix(layer, ctx) {
  const configured = String(layer.tilePackage?.localPath || layer.tileUrl || '').replaceAll('\\', '/');
  const localName = /^https?:/i.test(configured) ? '' : fileName(configured);
  if (ctx.exists && isArchiveName(localName)) {
    return { suffix: `pmtiles/generated/${localName}`, source: 'local-archive' };
  }
  const fromKey = suffixUnder(trimSlashes(String(layer.tilePackage?.r2Key || '')), ctx.r2Prefix);
  if (fromKey) return { suffix: fromKey, source: 'r2-key' };
  for (const url of [layer.tilePackage?.cdnUrl, layer.tileUrl]) {
    const fromUrl = suffixUnder(url, ctx.cdnBase);
    if (fromUrl) return { suffix: fromUrl, source: 'cdn-url' };
  }
  const fromPrior = suffixUnder(ctx.prior?.targetKey, ctx.r2Prefix);
  if (fromPrior) return { suffix: fromPrior, source: 'prior-manifest' };
  if (isArchiveName(localName)) return { suffix: `pmtiles/generated/${localName}`, source: 'configured-name' };
  return { suffix: `pmtiles/generated/${layer.id}.pmtiles`, source: 'layer-id' };
}
