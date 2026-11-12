/**
 * The map legend: the election key, layer swatches, statistics and the approximate-stretch entries of
 * reconstructed editions (packages/map/src/renderer/approximate-segments.js). The markup is
 * legend-view.mjs's; these methods gather its parts from the app.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import layerTypes from '../../../registries/src/browser/layer-types.mjs';
import { legendBodyHtml, legendShellHtml, legendSummaryText } from './legend-view.mjs';

// Layers with no vector features to colour, so no swatch: rasters, images, terrain and point
// clouds (the layer-types registry's rasterSource and threeD types).
const NO_SWATCH_SOURCE_TYPES = new Set([...layerTypes.behaviour.rasterSource, ...layerTypes.behaviour.threeD]);
import { MAP_COLOURS } from '../colours.mjs';

/** @typedef {import('./map-app').MapApp & LegendMethods} LegendApp */
/** @typedef {import('./legend-view.mjs').CensusLegend} CensusLegend */
/** @typedef {import('./legend-view.mjs').ApproximateLegend} ApproximateLegend */

export class LegendMethods {
  /**
   * The map's legend (UX review 2026-10-30, #6). An election's colours were explained only in
   * a container inside the results pane's secondary views, so the map itself had no key: not
   * for the winner fills, not for the seat dots, and FF and SF are both greens. It now sits on
   * the map, open on a desktop and folded to a "Legend" button on a phone. Boundary maps are
   * listed by their colours when there is more than one to tell apart, or beside an election.
   * @this {LegendApp}
   */
  updateMapLegend() {
    const host = this.mapController?.map?.getContainer?.() || document.getElementById('map');
    if (!host) return;
    const elections = this.elections;
    const election = elections?.legendModel?.() || null;
    const backing = new Set(election && elections ? elections.getActiveElectionBackingLayerIds?.() || [] : []);
    // Census statistics are keyed by their classes, not listed as outlines.
    const statistics = this.getLoadedLayerIds()
      .filter((id) => this.isMapVisible(id))
      .map((id) => this.mapController?.getCensusOverlayLegend?.(id))
      .filter(/** @returns {s is CensusLegend} */ (s) => Boolean(s));
    const statisticIds = new Set(statistics.map((s) => s.id));
    const layers = this.getLoadedLayerIds()
      .filter((id) => !backing.has(id) && !statisticIds.has(id) && this.isMapVisible(id))
      .map((id) => ({ id, name: this.mapLabel(id), colour: this.layerColour(id), role: this.editionRoles?.get(id) || null }))
      .filter((layer) => layer.colour);
    const showLayers = layers.length > 1 || Boolean((election || statistics.length) && layers.length > 0);
    // Reconstructed editions draw their approximate stretches dotted (boundary audit, 7 Nov 2026); the
    // legend says so even for a single map, with the edition's own note.
    const approximate = this.getLoadedLayerIds()
      .filter((id) => this.isMapVisible(id))
      .map((id) => this.approximateSegmentsLegend(id))
      .filter(/** @returns {entry is ApproximateLegend} */ (entry) => Boolean(entry));
    let legend = document.getElementById('test2MapLegend');
    if (!election && !showLayers && !statistics.length && !approximate.length) {
      legend?.remove();
      return;
    }
    if (!legend) {
      legend = document.createElement('section');
      legend.id = 'test2MapLegend';
      legend.className = 'test2-map-legend';
      legend.setAttribute('aria-label', 'Map legend');
      // Folded on a phone, or over a short map (a laptop with the election pane up), where an
      // open key would cover much of what it explains.
      const roomy = !this.isPhoneLayout() && host.getBoundingClientRect().height >= 420;
      legend.innerHTML = legendShellHtml(roomy);
      host.appendChild(legend);
    }
    // The election map as a Wikipedia-style SVG of this view, areas in their party colours.
    const electionMapId = election && elections ? elections.getActiveElectionStyleSourceMapId?.() : null;
    /** @type {HTMLElement} */ (legend.querySelector('.test2-map-legend__body')).innerHTML = legendBodyHtml({ election, statistics, layers, showLayers, approximate, electionMapId: electionMapId || null });
    legend.querySelector('[data-map-image-export]')?.addEventListener('click', (event) => {
      const button = /** @type {HTMLElement} */ (event.currentTarget);
      this.exportMapImage(/** @type {string} */ (button.dataset.mapImageExport), 'svg', { trigger: button });
    });
    /** @type {HTMLElement} */ (legend.querySelector('.test2-map-legend__summary span')).textContent = legendSummaryText(election, statistics);
  }

  /**
   * The legend entry for a loaded map's approximate stretches, or null (packages/map/src/renderer/approximate-segments.js).
   * @this {LegendApp}
   * @param {string} mapId
   * @returns {ApproximateLegend | null}
   */
  approximateSegmentsLegend(mapId) {
    const testId = this.mapController?.mainToTest?.get(mapId) || mapId;
    const record = this.mapController?.renderer?.layers?.get(testId);
    const approx = record?.config?.approximateSegments;
    if (!record || !approx || !this.mapController?.map?.getLayer?.(`${testId}-approx`)) return null;
    const older = this.editionRoles?.get(mapId) === 'older';
    return { name: this.mapLabel(mapId), colour: older ? MAP_COLOURS.olderEdition : (record.color || MAP_COLOURS.layerLine), note: approx.note || '' };
  }

  /**
   * The outline colour a loaded layer is drawn in, or '' (rasters and point clouds have none).
   * @this {LegendApp}
   * @param {string} mapId
   * @returns {string}
   */
  layerColour(mapId) {
    const testId = this.mapController?.mainToTest?.get(mapId) || mapId;
    const record = this.mapController?.renderer?.layers?.get(testId);
    if (!record || NO_SWATCH_SOURCE_TYPES.has(record.config?.sourceType || '')) return '';
    return record.color || record.fillColor || '';
  }
}
