/**
 * Map label colour (packages/map/src/renderer/labels.js; owner, 20 Nov 2026): a layer's labels are
 * drawn in its line colour, whatever its metadata's labelStyle names, darkened only as far as the
 * halo needs, and they follow the line when its colour changes (load-order palette, a visitor's).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LABEL_MIN_CONTRAST, buildLabelColorExpression, contrastRatio, getLabelStyle, layerLineColour, legibleLabelColour, parseHexColour,
} from '@civgraph/map/renderer/labels.js';
import { LOAD_ORDER_PALETTE } from '@civgraph/map/layer-palette.mjs';
import { MAP_COLOURS } from '@civgraph/map/views/colours.mjs';

const HALO = String(MAP_COLOURS.labelHaloDefault);
/** A layer whose metadata names its own label colour, as most of maps-test.json does. */
const layer = (/** @type {string} */ line, /** @type {string} */ label) => ({ id: 'x', style: { color: line }, labelStyle: { color: label } });
const [BLUE = '', ORANGE = ''] = LOAD_ORDER_PALETTE;
const [, , , , GREEN = ''] = LOAD_ORDER_PALETTE;

test('the label takes the line colour, not the metadata label colour', () => {
  assert.equal(getLabelStyle(layer(BLUE, GREEN)).color, BLUE);
  assert.equal(getLabelStyle({ id: 'y', labelTextColor: GREEN }).color, layerLineColour({}));
});

test('the line colour drawn now (palette or visitor) wins over the metadata style colour', () => {
  assert.equal(getLabelStyle(layer(BLUE, GREEN), ORANGE).color, ORANGE);
  const expr = buildLabelColorExpression(layer(BLUE, GREEN), ORANGE);
  assert.equal(expr[expr.length - 1], ORANGE);
});

test('two layers drawn at once keep their own colours', () => {
  assert.notEqual(getLabelStyle(layer(BLUE, GREEN)).color, getLabelStyle(layer(ORANGE, GREEN)).color);
});

test('every load-order colour is legible as it is against the default halo', () => {
  for (const colour of LOAD_ORDER_PALETTE) assert.equal(legibleLabelColour(colour, HALO), colour, colour);
});

test('a pale colour is darkened just enough, keeping its hue', () => {
  const pale = '#ffd27f';
  const out = legibleLabelColour(pale, HALO);
  const rgb = /** @type {[number, number, number]} */ (parseHexColour(out));
  const halo = /** @type {[number, number, number]} */ (parseHexColour(HALO));
  assert.ok(contrastRatio(rgb, halo) >= LABEL_MIN_CONTRAST);
  // Hue held: each channel scaled by one factor, so the ratios match the original's.
  const [r, g, b] = rgb;
  assert.ok(Math.abs(g / r - 0xd2 / 0xff) < 0.03 && Math.abs(b / r - 0x7f / 0xff) < 0.03);
  // Little darkening: it lands near the threshold, not far past it.
  assert.ok(contrastRatio(rgb, halo) < LABEL_MIN_CONTRAST + 0.5);
});

test('a dark halo lightens instead; anything not hex is left alone', () => {
  const black = '#000000';
  const out = /** @type {[number, number, number]} */ (parseHexColour(legibleLabelColour('#202060', black)));
  assert.ok(contrastRatio(out, [0, 0, 0]) >= LABEL_MIN_CONTRAST);
  assert.equal(legibleLabelColour('rgba(1,2,3,0.5)', HALO), 'rgba(1,2,3,0.5)');
  assert.equal(legibleLabelColour('#123456', 'none'), '#123456');
});
