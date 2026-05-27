export class ElectionService {
  constructor(metadataService) {
    this.metadataService = metadataService;
  }

  getCatalogues() {
    return this.metadataService.metadata?.electionCatalogues || [];
  }

  getLinkedElectionLayers(layerId) {
    return this.getCatalogues().filter((catalogue) => (catalogue.layerIds || []).includes(layerId));
  }
}
