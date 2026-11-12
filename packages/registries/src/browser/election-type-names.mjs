// The election-types slice's words as named exports, for the served pages that import it from /pkg/
// (site/apps/elections/lib/format.js, site/browse/browse.js): a page reaches a package module through a
// site/pkg/ shim, which is `export *` and so carries no default export (tests/unit/served-pkg.test.mjs).
import electionTypes from './election-types.mjs';

/** Voting system id -> the system in words (the Elections app's systemName). @type {Readonly<Record<string, string>>} */
export const votingSystemNames = electionTypes.votingSystemNames;
/** Kind of election -> its list label (Browse's Type filter). @type {Readonly<Record<string, string>>} */
export const electionKindLabels = electionTypes.electionKindLabels;
