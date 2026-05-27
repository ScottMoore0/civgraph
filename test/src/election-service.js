export class ElectionService {
  constructor(metadataService, conditionalStyling = null) {
    this.metadataService = metadataService;
    this.conditionalStyling = conditionalStyling;
  }

  getCatalogues() {
    return this.metadataService.metadata?.electionCatalogues || [];
  }

  getLinkedElectionLayers(layerId) {
    return this.getCatalogues().filter((catalogue) => (catalogue.layerIds || []).includes(layerId));
  }

  applyChoropleth(layerId, config) {
    if (!this.conditionalStyling || !config?.attribute) return false;
    return this.conditionalStyling.applyGradient(layerId, {
      noDataColor: '#f2f4f7',
      lowColor: '#dbeafe',
      highColor: '#1d4ed8',
      min: 0,
      max: 100,
      ...config
    });
  }
}
