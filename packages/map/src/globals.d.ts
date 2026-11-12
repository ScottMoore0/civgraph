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
}

/** The Fuse.js index the catalogue searches, as its callers use it. */
export interface FuseIndex<T> {
  search(query: string): FuseResult<T>[];
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
   * Fuse.js, when a page has loaded it as a classic script (packages/map/src/data-service.js and
   * ui-controller.js test `typeof Fuse` first; the map page does not load it today).
   */
  var Fuse: new <T>(items: T[], options: Record<string, unknown>) => FuseIndex<T>;

  interface Window {
    /** 'classic' on the archived classic page (civgraph.net/maps/classic/): packages/map/src/catalogue/flag.js. */
    CIVGRAPH_CATALOGUE?: string;
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
