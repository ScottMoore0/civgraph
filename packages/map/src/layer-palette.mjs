/**
 * Load-order colours for boundary and point maps (Phelim Birch's notes, owner-approved 19 Nov 2026):
 * the first such map put on the map is drawn in palette[0], the next in palette[1], and so on; a
 * colour freed by a map taken off is the first one reused, so an edition swapped in by the timeline
 * takes the colour of the one it replaced. Maps whose colour means something keep their own:
 * rasters and terrain, census and other statistics, anything with a data-driven style, and the
 * categories whose colours stand for classes (geology, flood risk, water quality...). Election
 * results restyle their geography themselves (maplibre-main-adapter.js applyElectionStyle).
 *
 * The palette is registry data (data/registries/colours.json map.loadOrder; a placeholder until the
 * owner supplies Phelim's QGIS colours). Pure: no DOM, no map (tests/unit/layer-palette.test.mjs).
 */
import { MAP_COLOURS } from './colours.mjs';

/** The load-order palette, in order. @type {readonly string[]} */
export const LOAD_ORDER_PALETTE = Object.freeze([.../** @type {string[]} */ (/** @type {unknown} */ (MAP_COLOURS.loadOrder) || [])]);

/**
 * Layer categories (render/metadata layers' `category`) whose maps keep the colours they were given,
 * because a colour there stands for a class: a rock type, a flood return period, a water-quality
 * status, a referendum's side.
 */
export const OWN_COLOUR_CATEGORIES = Object.freeze(new Set([
  'Geology and Geophysics', 'geology', 'flood', 'Water Quality', 'Population data', 'Referendums', 'Polling & Voting',
]));

/** The geometries a load-order colour is for: boundaries (polygons and lines) and points. */
const DRAWN = new Set(['polygon', 'line', 'point']);

/**
 * @typedef {{
 *   sourceType?: string, geometryType?: string, category?: string,
 *   style?: { fillColorExpression?: unknown } | null,
 *   censusOverlay?: unknown, colorScale?: unknown, legend?: unknown
 * }} PaletteLayer
 */

/**
 * Whether a layer takes a load-order colour, or keeps its own.
 * @param {PaletteLayer} layer  the layer as the renderer will draw it
 * @param {{ isDataEntry?: boolean } | null | undefined} map  its catalogue map, if known
 * @param {Iterable<string>} vectorTypes  the source types drawn from vector tiles (layer-types registry)
 * @returns {boolean}
 */
export function takesLoadOrderColour(layer, map, vectorTypes) {
  if (!layer || !new Set(vectorTypes).has(String(layer.sourceType))) return false;
  if (!DRAWN.has(String(layer.geometryType))) return false;
  if (map?.isDataEntry || layer.censusOverlay) return false;
  if (layer.style?.fillColorExpression || layer.colorScale || layer.legend) return false;
  return !OWN_COLOUR_CATEGORIES.has(String(layer.category || ''));
}

/**
 * The palette slot for the next map: the lowest slot no map holds; when every slot is held, the one
 * held by fewest (the lowest of those), so colours repeat evenly rather than all landing on one.
 * @param {Iterable<number>} held  the slots the maps on the map hold
 * @param {number} size  the palette's length
 * @returns {number}
 */
export function pickSlot(held, size) {
  if (size <= 0) return -1;
  /** @type {number[]} */
  const uses = new Array(size).fill(0);
  for (const slot of held) if (slot >= 0 && slot < size) uses[slot] += 1;
  const fewest = Math.min(...uses);
  return uses.indexOf(fewest);
}

/**
 * The layer drawn in a colour: its line and, unless its fill is a colour of its own, its fill.
 * @template {{ style?: Record<string, unknown> | null }} L
 * @param {L} layer
 * @param {string} colour
 * @returns {L}
 */
export function withColour(layer, colour) {
  const style = { ...(layer.style || {}) };
  const ownFill = style.fillColor && style.fillColor !== style.color;
  style.color = colour;
  if (!ownFill) style.fillColor = colour;
  return { ...layer, style };
}

/**
 * Which palette slot each map on the map holds. The maps of one map's parts (a composite's
 * members, a group's versions) share their parent's slot through a shared key; a slot is freed
 * when its last map is taken off.
 */
export class PaletteSlots {
  /** @param {number} size  the palette's length */
  constructor(size) {
    this.size = size;
    /** @type {Map<string, { slot: number, members: Set<string> }>} key -> its slot and the maps holding it */
    this.byKey = new Map();
    /** @type {Map<string, string>} map -> the key it holds a slot under */
    this.keyOf = new Map();
  }

  /**
   * The slot for a map, taken under `key` (its own id, or its parent's): the key's slot if it has
   * one, else the next free one (pickSlot).
   * @param {string} member
   * @param {string} [key]
   * @returns {number}
   */
  take(member, key = member) {
    const held = this.keyOf.get(member);
    if (held && held !== key) this.release(member);
    let entry = this.byKey.get(key);
    if (!entry) {
      entry = { slot: pickSlot([...this.byKey.values()].map((e) => e.slot), this.size), members: new Set() };
      this.byKey.set(key, entry);
    }
    entry.members.add(member);
    this.keyOf.set(member, key);
    return entry.slot;
  }

  /** The slot a map holds, or -1. @param {string} member @returns {number} */
  slotOf(member) {
    const key = this.keyOf.get(member);
    return key ? /** @type {{ slot: number }} */ (this.byKey.get(key)).slot : -1;
  }

  /** A map taken off: its slot is freed with its key's last map. @param {string} member */
  release(member) {
    const key = this.keyOf.get(member);
    if (!key) return;
    this.keyOf.delete(member);
    const entry = this.byKey.get(key);
    entry?.members.delete(member);
    if (entry && !entry.members.size) this.byKey.delete(key);
  }
}
