/**
 * How a catalogue map says "these other layers are part of me".
 *
 * WHY THIS EXISTS
 *
 * The catalogue expressed one relation four ways: `variants`, `members`,
 * `compositeSources`, and `parentId` from the child's end. Measured 2026-08-25 across
 * 1,031 entries, the duplication was EXACT rather than approximate:
 *
 *   - 27 maps carried both `members` and `variants`, and all 27 lists were identical
 *   - the single `compositeSources` user also had `variants`, with the same two ids
 *
 * So two of the four field names added nothing. They were not harmless, though: app.js
 * expanded a composite via `variants`/`compositeSources` while maplibre-main-adapter.js
 * expanded it via `members`, so the same concept ran down two code paths with different
 * call signatures depending on which field a map happened to carry. That is what made
 * the "loads converted child layers" test unreadable in August -- eds-1926 used
 * `members`, so app.js handed the whole config to the adapter and the ADAPTER expanded
 * it, while all-ireland-townlands used `compositeSources` and app.js expanded it itself.
 *
 * `variants` is the survivor: widest use, and the richest shape -- each entry carries a
 * label and its own style, which the other two cannot express.
 *
 * `cloneOf` is deliberately NOT handled here. It is a different relation -- "this record
 * has no data of its own, use that one's" -- and folding it into part-of would make a
 * clone look like a child.
 */

/**
 * The child layer ids of a composite map, in declared order.
 *
 * Reads `variants` first, then the legacy fields. The fallbacks stay so a stale
 * catalogue, an old cached copy, or a record that predates the migration still resolves
 * rather than silently expanding to nothing -- which for a group map means a blank map
 * and no error.
 *
 * @param {object|null} mapConfig
 * @returns {string[]}
 */
export function compositeChildIds(mapConfig) {
  if (!mapConfig) return [];
  const fromVariants = (mapConfig.variants || [])
    .map((variant) => (typeof variant === 'string' ? variant : variant?.id))
    .filter(Boolean);
  if (fromVariants.length) return fromVariants;
  if (Array.isArray(mapConfig.members) && mapConfig.members.length) return mapConfig.members.filter(Boolean);
  if (Array.isArray(mapConfig.compositeSources) && mapConfig.compositeSources.length) {
    return mapConfig.compositeSources.filter(Boolean);
  }
  return [];
}

/** True when this map is assembled from child layers rather than drawing its own data. */
export function isComposite(mapConfig) {
  return compositeChildIds(mapConfig).length > 0;
}
