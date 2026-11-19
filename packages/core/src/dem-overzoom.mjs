/**
 * Over-zooming an elevation (raster-dem) tile: the square of an ancestor tile that covers a
 * descendant, resampled to a full tile with its heights intact (19 Nov 2026, stream
 * w19-dem-fallback; the map app's indexed-tiles protocol uses it for a DEM pyramid that is not
 * complete to its deepest zoom everywhere).
 *
 * A DEM tile packs each height into the 24 bits of a pixel's red, green and blue, v = R*65536 +
 * G*256 + B. Both encodings MapLibre reads are affine in v: Terrarium h = v/256 - 32768 (the one
 * Civgraph's terrain layers use), Mapbox terrain-RGB h = v/10 - 10000. So interpolating v is
 * interpolating heights, for either encoding, and rounding it back re-encodes them exactly. What
 * must never happen is the image's own stretch, which blends R, G and B separately: between 255 m
 * and 256 m of Terrarium (G 255 -> 0, R +1), a blended pixel reads as about 128 m or 384 m.
 *
 * A tile is a full tile again (MapLibre's DEM needs every tile of a source the same size: its
 * borders are backfilled from the neighbours). Sampling is bilinear, with MapLibre's own
 * convention: its terrain shader (get_elevation) puts pixel k of a DEM tile at k/size of the tile
 * and interpolates bilinearly between pixels. Sampling the ancestor the same way at the child's
 * pixels lays the child's pixels on the ancestor's bilinear surface (every 2nd pixel, one zoom
 * down, is an ancestor pixel exactly), so MapLibre draws from the child the surface it drew when it
 * fell back to the parent tile itself. Reading past the square uses the rest of the ancestor; at
 * the ancestor's own right and bottom edges it clamps (MapLibre reads the neighbour tile there),
 * which moves only the last half pixel.
 *
 * Pure: arrays in, arrays out.
 */

/**
 * The packed 24-bit value of every pixel of an RGBA image (alpha ignored).
 * @param {ArrayLike<number>} rgba  width*height*4 bytes
 * @returns {Uint32Array}
 */
export function demPackedValues(rgba) {
  const values = new Uint32Array(Math.floor(rgba.length / 4));
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    values[i] = Number(rgba[p]) * 65536 + Number(rgba[p + 1]) * 256 + Number(rgba[p + 2]);
  }
  return values;
}

/**
 * A height from a pixel, for the tests and the probe.
 * @param {number} r @param {number} g @param {number} b
 * @param {'terrarium' | 'mapbox'} encoding
 */
export function demHeight(r, g, b, encoding) {
  const v = r * 65536 + g * 256 + b;
  return encoding === 'mapbox' ? v / 10 - 10000 : v / 256 - 32768;
}

/**
 * The square (sx, sy, size, in the ancestor's pixels; overzoomSquare in tile-index.mjs) of an
 * ancestor DEM tile, resampled to a tile of outSize x outSize pixels (RGBA, opaque).
 * @param {Uint32Array} packed  the ancestor's demPackedValues, width x width
 * @param {number} width
 * @param {{ sx: number, sy: number, size: number }} square
 * @param {number} outSize
 * @returns {Uint8ClampedArray<ArrayBuffer>}
 */
export function overzoomDemPixels(packed, width, { sx, sy, size }, outSize) {
  const out = new Uint8ClampedArray(outSize * outSize * 4);
  const step = size / outSize;
  const last = width - 1;
  /** Source column (or row) of an output pixel: its two neighbours and the weight of the second. */
  const axis = (/** @type {number} */ start, /** @type {number} */ i) => {
    const at = Math.min(last, start + i * step);
    const a = Math.floor(at);
    return { a, b: Math.min(last, a + 1), t: at - a };
  };
  const cols = Array.from({ length: outSize }, (_, i) => axis(sx, i));
  for (let j = 0; j < outSize; j++) {
    const row = axis(sy, j);
    const top = row.a * width;
    const bottom = row.b * width;
    for (let i = 0; i < outSize; i++) {
      const col = /** @type {{ a: number, b: number, t: number }} */ (cols[i]);
      const upper = /** @type {number} */ (packed[top + col.a]) * (1 - col.t) + /** @type {number} */ (packed[top + col.b]) * col.t;
      const lower = /** @type {number} */ (packed[bottom + col.a]) * (1 - col.t) + /** @type {number} */ (packed[bottom + col.b]) * col.t;
      const v = Math.round(upper * (1 - row.t) + lower * row.t);
      const p = (j * outSize + i) * 4;
      out[p] = v >> 16;
      out[p + 1] = (v >> 8) & 255;
      out[p + 2] = v & 255;
      out[p + 3] = 255;
    }
  }
  return out;
}
