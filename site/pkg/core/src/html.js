// The served page imports /pkg/core/src/html.js, which the dist build and the dev servers answer with
// packages/core/src/html.js (packages/served.json): this file is never served. It lets Node, the unit
// tests and tsc resolve that import to the same module. Do not edit: edit the package.
export * from '../../../../packages/core/src/html.js';
