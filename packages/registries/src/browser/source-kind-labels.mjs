// The source-kinds slice's labels as a named export, for the served page that imports it from /pkg/
// (site/browse/browse.js): a page reaches a package module through a site/pkg/ shim, which is `export *`
// and so carries no default export (the served-pkg unit test holds this).
import sourceKinds from './source-kinds.mjs';

/** Source kind id -> what a contest's Sources panel calls it ('' shows no kind). @type {Readonly<Record<string, string>>} */
export const sourceKindLabels = sourceKinds.labels;
