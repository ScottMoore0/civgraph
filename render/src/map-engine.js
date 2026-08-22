import { copyText } from './utils.js';

export class MapLibreShellEngine {
  constructor(controller) {
    this.controller = controller;
  }

  isLoaded(layerId) {
    return this.controller.layers.has(layerId);
  }

  async load(layer) {
    if (!this.isLoadable(layer)) return false;
    await this.controller.loadLayer(layer);
    return true;
  }

  unload(layerId) {
    this.controller.unloadLayer(layerId);
  }

  fit(layer) {
    if (this.isLoaded(layer.id)) {
      this.controller.fitToLayer(layer.id);
      return true;
    }
    if (layer.bounds) {
      this.controller.fitToBounds(layer.bounds);
      return true;
    }
    return false;
  }

  isLoadable(layer) {
    return layer?.loadable !== false && layer?.isConverted !== false;
  }

  async copyShareUrl(layer) {
    const url = new URL(location.href);
    const ids = new Set((url.searchParams.get('layers') || '').split(',').filter(Boolean));
    if (this.isLoadable(layer)) ids.add(layer.id);
    if (ids.size) url.searchParams.set('layers', [...ids].join(','));
    url.hash = `catalogue=${encodeURIComponent(layer.id)}`;
    await copyText(url.toString());
  }
}
