// The served page imports /pkg/core/src/election-domain.mjs, which the dist build and the dev servers answer with
// packages/core/src/election-domain.mjs (packages/served.json): this file is never served. It lets Node, the unit
// tests and tsc resolve that import to the same module. Do not edit: edit the package.
export * from '../../../../packages/core/src/election-domain.mjs';
