/**
 * Load-order colours for boundary and point maps (packages/map/src/layer-palette.mjs; Phelim Birch's
 * notes, owner-approved 19 Nov 2026): which maps take one, which slot the next map gets, how a
 * composite's parts share their parent's, and the palette itself (data/registries/colours.json
 * map.loadOrder, a placeholder until Phelim's QGIS colours arrive).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOAD_ORDER_PALETTE, OWN_COLOUR_CATEGORIES, PaletteSlots, pickSlot, takesLoadOrderColour, withColour } from '@civgraph/map/layer-palette.mjs';
import layerTypes from '@civgraph/registries/browser/layer-types.mjs';

const VECTOR = layerTypes.behaviour.vectorTiles;

test('the palette is registry data: hex colours, at least eight, none twice', () => {
  assert.ok(LOAD_ORDER_PALETTE.length >= 8);
  for (const c of LOAD_ORDER_PALETTE) assert.match(c, /^#[0-9a-f]{6}$/i);
  assert.equal(new Set(LOAD_ORDER_PALETTE.map((c) => c.toLowerCase())).size, LOAD_ORDER_PALETTE.length);
});

/** WCAG contrast of two hex colours. @param {string} a @param {string} b */
function contrast(a, b) {
  const lum = (/** @type {string} */ h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('every palette colour stands out on the land of the three base maps (Positron, Liberty, Dark Matter)', () => {
  for (const c of LOAD_ORDER_PALETTE) {
    for (const land of ['#fafaf8', '#f8f4f0', '#d8e8c8', '#0e0e0e']) assert.ok(contrast(c, land) >= 2.7, `${c} on ${land}: ${contrast(c, land).toFixed(2)}`);
  }
});

test('boundary and point maps take a load-order colour; rasters, terrain, statistics and classed maps keep theirs', () => {
  const boundary = { sourceType: 'pmtiles', geometryType: 'polygon', category: 'Counties', style: {} };
  assert.equal(takesLoadOrderColour(boundary, null, VECTOR), true);
  assert.equal(takesLoadOrderColour({ ...boundary, geometryType: 'point' }, null, VECTOR), true);
  assert.equal(takesLoadOrderColour({ ...boundary, geometryType: 'line' }, null, VECTOR), true);
  assert.equal(takesLoadOrderColour({ ...boundary, sourceType: 'raster', geometryType: 'raster' }, null, VECTOR), false);
  assert.equal(takesLoadOrderColour({ ...boundary, sourceType: 'raster-dem', geometryType: 'raster' }, null, VECTOR), false);
  assert.equal(takesLoadOrderColour({ ...boundary, sourceType: 'point-cloud', geometryType: 'point-cloud' }, null, VECTOR), false);
  assert.equal(takesLoadOrderColour(boundary, { isDataEntry: true }, VECTOR), false);
  assert.equal(takesLoadOrderColour({ ...boundary, censusOverlay: {} }, null, VECTOR), false);
  assert.equal(takesLoadOrderColour({ ...boundary, style: { fillColorExpression: ['get', 'c'] } }, null, VECTOR), false);
  assert.equal(takesLoadOrderColour({ ...boundary, colorScale: {} }, null, VECTOR), false);
  for (const category of OWN_COLOUR_CATEGORIES) assert.equal(takesLoadOrderColour({ ...boundary, category }, null, VECTOR), false, category);
});

test('the next map takes the lowest free slot; with every slot held, the least used', () => {
  assert.equal(pickSlot([], 4), 0);
  assert.equal(pickSlot([0, 1], 4), 2);
  assert.equal(pickSlot([0, 2], 4), 1);
  assert.equal(pickSlot([0, 1, 2, 3], 4), 0);
  assert.equal(pickSlot([0, 1, 2, 3, 0], 4), 1);
  assert.equal(pickSlot([], 0), -1);
});

test('slots: first map palette[0], the next palette[1]; a freed slot is reused; parts share their parent', () => {
  const slots = new PaletteSlots(8);
  assert.equal(slots.take('counties-1922'), 0);
  assert.equal(slots.take('parishes'), 1);
  assert.equal(slots.take('baronies'), 2);
  // The timeline swaps an edition: off, then on; the new one takes the freed colour.
  slots.release('parishes');
  assert.equal(slots.take('parishes-1851'), 1);
  // A composite's members share one colour, freed with the last of them.
  assert.equal(slots.take('ni-part', 'composite'), 3);
  assert.equal(slots.take('roi-part', 'composite'), 3);
  slots.release('ni-part');
  assert.equal(slots.slotOf('roi-part'), 3);
  slots.release('roi-part');
  assert.equal(slots.slotOf('roi-part'), -1);
  assert.equal(slots.take('next'), 3);
  // Taking a map again keeps its slot.
  assert.equal(slots.take('counties-1922'), 0);
});

test('withColour sets the line, and the fill unless the fill is a colour of its own', () => {
  assert.deepEqual(withColour({ style: { color: '#111111', fillColor: '#111111', weight: 2 } }, '#0077bb').style, { color: '#0077bb', fillColor: '#0077bb', weight: 2 });
  assert.deepEqual(withColour({ style: { color: '#111111', fillColor: '#eeeeee' } }, '#0077bb').style, { color: '#0077bb', fillColor: '#eeeeee' });
  assert.deepEqual(withColour({ style: null }, '#0077bb').style, { color: '#0077bb', fillColor: '#0077bb' });
});
