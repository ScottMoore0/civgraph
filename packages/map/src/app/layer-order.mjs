/**
 * Map layer draw order: parsing a layer order from a URL parameter, a saved value or an array,
 * normalising it against the layers actually loaded, the saved form, and which order to
 * restore on load.
 *
 * Moved out of packages/map/app/app.js (frontend plan section 5.2, seam A1) without changing
 * behaviour. Only the pure parts live here: Test2App keeps the localStorage reads and writes
 * (wrapped in try, since storage can throw in private browsing) and the map calls, and
 * delegates the parsing and normalising to these functions.
 *
 * Pure: no DOM, no storage, no module state.
 */

/** The localStorage key the saved layer order lives under. */
export const LAYER_ORDER_STORAGE_KEY = 'civgraph:maplibre:layer-order';

/**
 * Layer ids from an array, a JSON array string or a comma-separated string: trimmed, empty
 * ids dropped, duplicates dropped (first wins).
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseLayerOrder(value) {
  if (!value) return [];
  /** @type {unknown[]} */
  let items = [];
  if (Array.isArray(value)) {
    items = value;
  } else {
    const text = String(value).trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = [];
      }
    }
    if (!items.length) items = text.split(',');
  }
  const seen = new Set();
  const result = [];
  for (const rawId of items) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * The value to save for a layer order: a JSON array when it orders two or more layers, else
 * null (meaning: remove the saved order).
 * @param {unknown} order
 */
export function serializeSavedLayerOrder(order) {
  const ids = parseLayerOrder(order);
  return ids.length > 1 ? JSON.stringify(ids) : null;
}

/**
 * An order restricted to the loaded layers: the order's loaded ids first, in its order, then
 * every other loaded id in load order.
 * @param {unknown} order
 * @param {readonly string[]} [loadedIds]
 */
export function normalizeLoadedLayerOrder(order, loadedIds = []) {
  const loadedSet = new Set(loadedIds);
  /** @type {string[]} */
  const result = [];
  const seen = new Set();
  for (const id of parseLayerOrder(order)) {
    if (!loadedSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  for (const id of loadedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * The order to restore on load: the URL's `layerOrder`, else the saved order, normalised
 * against the loaded layers. An empty array when there is nothing to restore (no order, or
 * fewer than two loaded layers). `readSaved` and `getLoadedIds` are called only when needed.
 * @param {{ get?: (name: string) => string | null } | null | undefined} params URLSearchParams
 * @param {() => string[]} [readSaved]
 * @param {() => string[]} [getLoadedIds]
 */
export function layerOrderToRestore(params, readSaved = () => [], getLoadedIds = () => []) {
  const explicitOrder = parseLayerOrder(params?.get?.('layerOrder'));
  const savedOrder = explicitOrder.length ? explicitOrder : readSaved();
  if (!savedOrder.length) return [];
  const normalized = normalizeLoadedLayerOrder(savedOrder, getLoadedIds());
  return normalized.length < 2 ? [] : normalized;
}

/**
 * The `layerOrder` to write into an address: the draw order (top to bottom) of the layers the
 * address lists, whenever it lists two or more; else null.
 *
 * Written even when it matches the `layers` list. It used to be left out then, but that list is
 * not a draw order: a link opened elsewhere loads its layers in parallel and stacks each on top
 * as it arrives, and with no layerOrder the opening browser's own saved order was applied. So a
 * drag that happened to leave the order matching the list (in the common case, any drag of two
 * layers back the other way) was lost from the shared link, and from a reload in another browser.
 * @param {unknown} order the draw order, top to bottom
 * @param {readonly string[]} [listed] the ids the address lists
 * @returns {string | null}
 */
export function layerOrderForAddress(order, listed = []) {
  const listedSet = new Set(listed);
  const ids = parseLayerOrder(order).filter((id) => listedSet.has(id));
  return ids.length > 1 ? ids.join(',') : null;
}

/**
 * An order from the Active layers panel, in loaded layer ids. A row carries its map's catalogue
 * id (`rowIdOf`, dataService.getMapById(id).id), which is not the loaded id when a layer was
 * loaded under another id for the same map: an address naming `lgd-2012-vector` loads it under
 * that id, and its row is `lgd-2012`. Normalised against the loaded ids, that row was dropped, so a
 * visible drag was neither drawn nor saved, and the next render put the rows back. Ids that are
 * loaded, or that no loaded layer is shown as, pass through unchanged.
 * @param {unknown} order
 * @param {readonly string[]} [loadedIds]
 * @param {(id: string) => string | null | undefined} [rowIdOf]
 * @returns {string[]}
 */
export function rowOrderToLoadedIds(order, loadedIds = [], rowIdOf = (id) => id) {
  const loaded = new Set(loadedIds);
  /** @type {Map<string, string>} */
  const loadedIdOfRow = new Map();
  for (const id of loadedIds) {
    const rowId = rowIdOf(id);
    if (rowId && rowId !== id && !loaded.has(rowId) && !loadedIdOfRow.has(rowId)) loadedIdOfRow.set(rowId, id);
  }
  return parseLayerOrder(order).map((id) => (loaded.has(id) ? id : loadedIdOfRow.get(id) || id));
}
