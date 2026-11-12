/**
 * The page globals the map app's modules read or set, so the type check (packages/map/tsconfig.check.json)
 * knows them. Declarations only: nothing here exists at run time. A global joins this list when a
 * module that reads it joins the check.
 */
export {};

declare global {
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
