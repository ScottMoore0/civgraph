export class TimeSeriesController {
  constructor(metadataService, controller) {
    this.metadataService = metadataService;
    this.controller = controller;
  }

  getChains() {
    return this.metadataService.metadata?.timeSeriesChains || [];
  }

  getLayerChain(layerId) {
    return this.getChains().find((chain) => (chain.maps || chain.layers || []).some((entry) => (entry.id || entry.mapId) === layerId)) || null;
  }

  async switchLayerToDate(layerId, targetDate) {
    const chain = this.getLayerChain(layerId);
    if (!chain) return false;
    const entries = chain.maps || chain.layers || [];
    const target = entries.find((entry) => String(entry.date) === String(targetDate));
    const targetId = target?.id || target?.mapId;
    const layer = targetId ? this.metadataService.getLayer(targetId) : null;
    if (!layer) return false;
    this.controller.unloadLayer(layerId);
    await this.controller.loadLayer(layer);
    return true;
  }
}
