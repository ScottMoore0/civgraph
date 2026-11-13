self.addEventListener('message', (event) => {
  const { id, type, groups = [], options = {} } = event.data || {};
  if (type !== 'filterSeatCircleGroups') return;
  const selectedIndexes = filterSeatCircleGroups(groups, options);
  self.postMessage({ id, type: 'filterSeatCircleGroupsResult', selectedIndexes });
});

/**
 * A seat circle's group as the election overlay sends it: where it sits on screen, its box, size
 * and seats, and its index in the caller's list.
 * @typedef {{ index: number, x: number, y: number, width?: number, height?: number, pixelArea?: number, seats?: number, area?: number, synthetic?: boolean, bounds?: Bounds }} SeatCircleGroup
 */
/** @typedef {{ minX: number, maxX: number, minY: number, maxY: number }} Bounds */
/** The group with its sizes made numbers. @typedef {SeatCircleGroup & { width: number, height: number, pixelArea: number, seats: number, area: number }} ProjectedGroup */

/**
 * The groups to draw: the largest that do not overlap, synthetic ones first, at most `limit`.
 * @param {SeatCircleGroup[]} groups
 * @param {{ margin?: number, minTotalExtent?: number, limit?: number }} options
 * @returns {number[]} the chosen groups' indexes
 */
function filterSeatCircleGroups(groups, options) {
  const margin = Number(options.margin || 0);
  const minTotalExtent = Number(options.minTotalExtent || 0);
  const limit = Math.max(0, Number(options.limit || groups.length || 0));
  const projected = groups
    .filter((group) => Number.isFinite(group.x) && Number.isFinite(group.y))
    .map((group) => ({
      ...group,
      width: Math.max(0, Number(group.width || 0)),
      height: Math.max(0, Number(group.height || 0)),
      pixelArea: Math.max(0, Number(group.pixelArea || 0)),
      seats: Math.max(0, Number(group.seats || 0)),
      area: Math.max(0, Number(group.area || 0))
    }));
  if (projected.length <= 1) return projected.map((group) => group.index);

  const totalBounds = projected.reduce((/** @type {Bounds | null} */ acc, group) => mergeBounds(acc, group.bounds || {
    minX: group.x,
    maxX: group.x,
    minY: group.y,
    maxY: group.y
  }), null);
  if (!totalBounds
    || Math.abs(totalBounds.maxX - totalBounds.minX) < minTotalExtent
    || Math.abs(totalBounds.maxY - totalBounds.minY) < minTotalExtent) {
    return [];
  }

  /** @type {ProjectedGroup[]} */
  const placed = [];
  /** @type {ProjectedGroup[]} */
  const visible = [];
  for (const group of projected.sort((a, b) => {
    const syntheticDelta = Number(Boolean(b.synthetic)) - Number(Boolean(a.synthetic));
    return syntheticDelta || b.pixelArea - a.pixelArea;
  })) {
    const myHalfW = group.width / 2 + margin;
    const myHalfH = group.height / 2 + margin;
    const overlaps = placed.some((existing) => {
      const otherHalfW = existing.width / 2 + margin;
      const otherHalfH = existing.height / 2 + margin;
      return Math.abs(group.x - existing.x) < (myHalfW + otherHalfW)
        && Math.abs(group.y - existing.y) < (myHalfH + otherHalfH);
    });
    if (overlaps) continue;
    placed.push(group);
    visible.push(group);
  }

  return visible
    .sort((a, b) => {
      const syntheticDelta = Number(Boolean(b.synthetic)) - Number(Boolean(a.synthetic));
      const seatsDelta = b.seats - a.seats;
      return syntheticDelta || seatsDelta || b.area - a.area;
    })
    .slice(0, limit)
    .map((group) => group.index);
}
/** @param {Bounds | null} a @param {Bounds | null | undefined} b @returns {Bounds | null} */

function mergeBounds(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY)
  };
}
