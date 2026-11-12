// The colours slice's palettes as named exports, for the served pages that import it from /pkg/
// (site/apps/elections/lib/, site/browse/browse.js): a page reaches a package module through a site/pkg/
// shim, which is `export *` and so carries no default export (tests/unit/served-pkg.test.mjs).
import colours from './colours.mjs';

/** The Elections app's colours (contrast ink, the area map's fallbacks, the transfer flow). */
export const electionsAppColours = colours.electionsApp;
/** The colour ramps (the Elections app's sequential and diverging scales among them). */
export const rampColours = colours.ramps;
/** Browse's drawn map preview. */
export const browseColours = colours.browse;
