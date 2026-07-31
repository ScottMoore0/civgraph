/**
 * Is a layer's bounding box plausible for what the layer is?
 *
 * The default envelope is an Ireland bounding box. That is the right guard for the great
 * majority of layers here -- a boundary set that claims to reach Kazakhstan has a broken
 * extent, and a broken extent makes the map jump somewhere absurd when the layer loads.
 *
 * IT LIVES IN ONE PLACE BECAUSE THREE SCRIPTS APPLY IT AND THEY MUST AGREE.
 * promote-test-converted-layers.mjs uses it to decide whether to register a layer at all,
 * validate-test-app.mjs and validate-test-tile-budgets.mjs to decide whether to fail the
 * build. They had three separate copies that had already drifted:
 *
 *   - Two rejected a degenerate box (min === max) and one did not.
 *   - Only one knew about the DoBIH hill layers.
 *   - tailte-ferry-crossing had to be exempted twice, in two files, for the same reason.
 *
 * A DEGENERATE BOX IS VALID. A layer whose features all sit at one point -- a single
 * bicycle warning sign, a national COVID figure pinned to a centroid -- has zero extent,
 * and that is its correct extent. An INVERTED box (south above north) is a real defect and
 * still fails.
 *
 * SOME SUBJECTS ARE LEGITIMATELY WIDER THAN IRELAND, and each says so by name rather than
 * by loosening the default for everything. Ferry crossings run to Britain and France; the
 * seas layer covers both islands and their approaches; the DoBIH hill database covers
 * Britain as well.
 */

const IRELAND = { south: 49, north: 57, west: -12.5, east: -4 };

// Envelopes for layers whose subject legitimately extends past Ireland. Matched on
// sourceMapId, or on id where a layer has no sourceMapId.
const WIDER = [
  {
    match: (key) => key.startsWith('dobih-v18-4'),
    test: ({ south, north, west, east }) => south >= 49 && north <= 61 && west >= -11 && east <= 2
  },
  {
    match: (key) => key === 'britain-ireland-seas',
    test: ({ south, north, west, east }) => south >= 45 && north <= 63 && west >= -18 && east <= 14
      && south < 57 && north > 49 && west < -4 && east > -12
  },
  {
    match: (key) => key === 'tailte-ferry-crossing' || key === 'tailte-ferry-crossing-vector-test',
    test: ({ south, north, west, east }) => south >= 47 && north <= 59 && west >= -13 && east <= 2
  }
];

export function isValidBounds(bounds, layer = null) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return false;
  const [pair0, pair1] = bounds;
  if (!Array.isArray(pair0) || !Array.isArray(pair1)) return false;
  const [south, west] = pair0;
  const [north, east] = pair1;
  if (![south, west, north, east].every(Number.isFinite)) return false;
  if (south > north || west > east) return false;
  // Null Island: an all-zero extent means the coordinates were never populated.
  if (Math.max(Math.abs(south), Math.abs(west), Math.abs(north), Math.abs(east)) < 1) return false;

  const box = { south, west, north, east };
  const key = String(layer?.sourceMapId || layer?.id || '');
  const wider = WIDER.find((entry) => entry.match(key));
  if (wider) return wider.test(box);

  return south >= IRELAND.south && north <= IRELAND.north
    && west >= IRELAND.west && east <= IRELAND.east;
}
