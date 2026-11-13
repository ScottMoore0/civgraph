/**
 * The map app's fixed colours, by role: the colours registry's palettes (data/registries/colours.json,
 * through its browser slice packages/registries/src/browser/colours.json). MapLibre paint properties,
 * canvas drawing, exported SVG files and colour arithmetic (contrast picks, sanitisers) need a colour
 * value, which a CSS var() is not, so these are registry data (docs/ARCHITECTURE-RULES.md R9). Party
 * colours are in the parties registry (election/palette.mjs).
 *
 * The values moved into the registry unchanged, case included (wave10-colours, 12 Nov 2026). A new map
 * colour joins the registry, not a view. Pure: no DOM; its imports are the registry slices.
 */
import colours from '../../../registries/src/browser/colours.mjs';
import partyPalettes from '../../../registries/src/browser/party-palettes.mjs';

/** Map and frontend colours, by role (the registry's `map` palette; each role's note says where it is drawn). */
export const MAP_COLOURS = Object.freeze({ ...colours.map });

/** The Wikipedia-style SVG export (map-image-export.js WIKI_STYLE and its legend): the `mapExport` palette. */
export const EXPORT_COLOURS = Object.freeze({ ...colours.mapExport });

/** The election pane's numeric scale, low to high (views/election-renderer.mjs, election/palette.mjs). */
export const NUMERIC_SCALE = Object.freeze([...colours.ramps.electionNumeric]);

/**
 * The census overlay's ramps (packages/map/src/census-overlay.mjs), by name: Matplotlib samples and the diverging
 * 'protestant-catholic' (the registry note says how they were taken).
 * @type {Record<string, string[]>}
 */
export const CENSUS_RAMPS = Object.fromEntries(Object.entries(colours.ramps.census).map(([name, ramp]) => [name, [...ramp]]));

/** What a census area with no figure is filled with: nothing, so the outline alone shows it. */
export const CENSUS_NO_DATA_FILL = colours.ramps.censusNoData;

/** Body colours of the classic catalogue's elections list (packages/map/src/ui-controller.js). */
export const BODY_COLOURS = Object.freeze({ ...colours.catalogue.bodies });

/** The catalogue's map shelves, by shelf id: the colour marks the shelf's icon and heading (packages/map/src/catalogue/icons.js). */
export const SHELF_COLOURS = Object.freeze({ ...colours.catalogue.shelves });

/** The catalogue's election shelves, by group id (packages/map/src/catalogue/view-elections.js BODY_GROUPS). */
export const ELECTION_SHELF_COLOURS = Object.freeze({ ...colours.catalogue.electionShelves });

/**
 * What the classic STV viewer scripts (site/app/election-viewer-package/js/) draw with, which they
 * cannot import: election-manager.js hands it to them as globalThis.civgraphViewerColours before it
 * loads them. The registry's `viewer` palette by role, and `parties`, the parties registry's viewer
 * table as [label, colour] rows in order (stages2.js folds each label; a later row wins).
 */
export const VIEWER_COLOURS = Object.freeze({
  ...colours.viewer,
  parties: Object.freeze(partyPalettes.viewer.map((row) => Object.freeze([...row])))
});
