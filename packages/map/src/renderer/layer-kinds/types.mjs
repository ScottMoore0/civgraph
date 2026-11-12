/**
 * The shapes a layer renderer (packages/map/src/renderer/layer-kinds/) works with. Types only.
 *
 * @typedef {object} RenderLayer  the fields of a layer record (render/metadata/maps-test.json) a renderer reads
 * @property {string} id
 * @property {string} [sourceType]
 * @property {string} [tileUrl]
 * @property {string} [tiles]
 * @property {string} [imageUrl]
 * @property {string} [url]
 * @property {number} [tileSize]
 * @property {string} [demEncoding]
 * @property {number} [minzoom]
 * @property {number} [maxzoom]
 * @property {unknown} [bounds]
 * @property {string} [promoteId]
 *
 * @typedef {{ [field: string]: unknown }} SourceSpec  a MapLibre source, as map.addSource takes it
 *
 * @typedef {object} SourceContext  what a renderer's source needs from the controller
 * @property {(tileUrl: string) => void} openPmtilesArchive  registers a PMTiles archive with the map's pmtiles:// protocol (once per URL)
 *
 * @typedef {object} LayerIds  the ids of a layer's source and style layers (map-controller.js addLayerToMap)
 * @property {string} sourceId
 * @property {string} fillId
 * @property {string} lineId
 * @property {string} rasterId
 * @property {string} hoverId
 * @property {string} selectedFillId
 * @property {string} selectedId
 *
 * @typedef {{ layerIds: string[], sourceIds: string[] }} OverlayIds  extra style layers and sources a draw added
 *
 * @typedef {object} LayerHost  the controller methods a renderer's draw calls (map-controller.js)
 * @property {(layer: RenderLayer, ids: LayerIds) => void} addRasterLayer
 * @property {(layer: RenderLayer, ids: LayerIds) => OverlayIds} addTerrainLayer
 * @property {(layer: RenderLayer, ids: LayerIds) => void} addGeometryLayers
 * @property {(layer: RenderLayer) => OverlayIds} addInteractionOverlayLayers
 * @property {(layer: RenderLayer) => OverlayIds} addApproximateSegmentLayers
 *
 * @typedef {object} LayerRenderer  how the map app draws one layer type (a sourceType of data/registries/layer-types.json)
 * @property {string} kind  the sourceType it draws
 * @property {(layer: RenderLayer, ctx: SourceContext) => SourceSpec} [source]  the MapLibre source; absent for a renderer that draws its own WebGL (customLayer)
 * @property {(host: LayerHost, layer: RenderLayer, ids: LayerIds) => OverlayIds} [draw]  adds the style layers over the source
 * @property {boolean} [customLayer]  drawn as a MapLibre custom layer, with no source or style layers (the controller's addPointCloudLayer)
 * @property {boolean} [interactive]  has features to hover, pick and label in the DOM
 * @property {boolean} [archiveFallback]  read from a PMTiles archive the controller watches, falling back to z/x/y tiles
 */

export {};
