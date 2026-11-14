/**
 * The page globals the map app's modules read or set, so the type check (packages/map/tsconfig.check.json)
 * knows them. Declarations only: nothing here exists at run time. A global joins this list when a
 * module that reads it joins the check.
 */
export {};

/** One match of a Fuse.js search. */
export interface FuseResult<T> {
  item: T;
  score?: number;
  /** With includeMatches: where each key matched, as [start, end] pairs. */
  matches?: ReadonlyArray<{ key?: string; indices: ReadonlyArray<readonly [number, number]> }>;
}

/** The Fuse.js index the catalogue searches, as its callers use it. */
export interface FuseIndex<T> {
  search(query: string, options?: { limit?: number }): FuseResult<T>[];
}

/** A layer of the retired Leaflet map, as ui-controller.js's active-layers list reads and sets it. */
export interface LegacyLayerState {
  config?: import('./ui-controller-types.d.ts').MapRecord;
  _strokeOpacity?: number;
  _fillOpacity?: number;
  _rasterOpacity?: number;
  group?: { eachLayer(fn: (layer: { setOpacity?: (opacity: number) => void }) => void): void };
  geoJsonLayers?: Array<{ setStyle(style: Record<string, number>): void }>;
}

/** The retired Leaflet map's controller, where a page still has it. */
export interface LegacyMapController {
  map?: { invalidateSize(): void } | null;
  layerStates?: Map<string, LegacyLayerState>;
  getLayerState?(id: string): LegacyLayerState | undefined;
}

/** A Leaflet LatLngBounds, as packages/map/src/feature-loader.js reads one. */
export interface LatLngBoundsView {
  getNorth(): number;
  getSouth(): number;
  getEast(): number;
  getWest(): number;
}

declare global {
  /**
   * Leaflet, when a page has loaded it (the retired Leaflet map did): feature-loader.js's
   * getBufferedBounds, which nothing on the MapLibre map calls, makes its bounds with it.
   */
  var L: { latLngBounds(southWest: [number, number], northEast: [number, number]): LatLngBoundsView };

  /**
   * flatgeobuf, when a page has loaded it as a classic script (ui-controller.js serialises a feature with
   * it for download, and reads a map's file with it for its attribute table).
   */
  var flatgeobuf: {
    serialize(geojson: unknown): Uint8Array;
    deserialize(input: ReadableStream<Uint8Array> | Uint8Array | string | null): AsyncIterable<import('geojson').Feature>;
  };

  /**
   * Fuse.js, when a page has loaded it as a classic script (packages/map/src/data-service.js and
   * ui-controller.js test `typeof Fuse` first; the map page does not load it today).
   */
  /** A classic worker's script loader: packages/map/src/fgb-worker.js runs as one. */
  function importScripts(...urls: string[]): void;

  /** pako, which fgb-worker.js loads with importScripts to ungzip a map file. */
  var pako: { ungzip(data: Uint8Array): Uint8Array };

  var Fuse: new <T>(items: T[], options: Record<string, unknown>) => FuseIndex<T>;

  /** The retired Leaflet map's controller, read by its global name (ui-controller.js updateActiveLayers). */
  var mapController: LegacyMapController | undefined;

  interface Window {
    /**
     * The browser suite's handle on the map app (packages/map/app/app.js sets it; the timeline adds
     * its test surface and a trace of every write to the slider).
     */
    __civgraphTest2?: { timeline?: unknown; timelineWrites?: Array<{ index: number; from: string }>; flatRenders?: string[]; [key: string]: unknown };
    /** 'classic' on the archived classic page (civgraph.net/maps/classic/): packages/map/src/catalogue/flag.js. */
    CIVGRAPH_CATALOGUE?: string;
    /** The retired Leaflet map's controller, which ui-controller.js still resizes when the layout changes, if a page has it. */
    mapController?: LegacyMapController;
    /** The UI controller, for the onclick handlers of markup it writes (packages/map/src/ui-controller.js). */
    uiController?: unknown;
    /** The interface-language runtime (site/assets/i18n/i18n.js, preview only), when it has loaded. */
    civgraphI18n?: { placeNameField?: (layer: unknown) => string | null };
    /** The site-head bootstrap's language-control loader (packages/map/src/catalogue/lang-reveal.js). */
    civgraphLangReveal?: () => void;
  }
  interface Performance {
    /** Chrome's heap figures (non-standard), read by the performance dashboard (packages/map/src/app/performance.js). */
    memory?: { usedJSHeapSize?: number };
  }
  interface Navigator {
    /** Approximate device memory in GiB (Chrome; non-standard), read by the performance dashboard. */
    deviceMemory?: number;
  }
}
