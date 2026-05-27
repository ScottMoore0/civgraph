export class UrlStateController {
  constructor(controller, metadataService) {
    this.controller = controller;
    this.metadataService = metadataService;
    this.restoring = false;
  }

  read() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return {
      layers: (params.get('layers') || '').split(',').filter(Boolean),
      z: Number(params.get('z')),
      lng: Number(params.get('lng')),
      lat: Number(params.get('lat'))
    };
  }

  async restore() {
    const state = this.read();
    this.restoring = true;
    try {
      for (const id of state.layers) {
        const layer = this.metadataService.getLayer(id);
        if (layer) await this.controller.loadLayer(layer);
      }
      if (Number.isFinite(state.lng) && Number.isFinite(state.lat) && Number.isFinite(state.z)) {
        this.controller.map.jumpTo({ center: [state.lng, state.lat], zoom: state.z });
      }
    } finally {
      this.restoring = false;
    }
  }

  write() {
    if (this.restoring || !this.controller.map) return;
    const center = this.controller.map.getCenter();
    const params = new URLSearchParams();
    const layers = [...this.controller.layers.keys()];
    if (layers.length) params.set('layers', layers.join(','));
    params.set('lng', center.lng.toFixed(5));
    params.set('lat', center.lat.toFixed(5));
    params.set('z', this.controller.map.getZoom().toFixed(3));
    history.replaceState(null, '', `${location.pathname}${location.search}#${params.toString()}`);
  }
}
