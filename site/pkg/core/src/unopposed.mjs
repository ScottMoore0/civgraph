// The served page imports /pkg/core/src/unopposed.mjs, which the dist build and the dev servers answer with
// packages/core/src/unopposed.mjs (packages/served.json): this file is never served. It lets Node, the unit
// tests and tsc resolve that import to the same module. Do not edit: edit the package.
export * from '../../../../packages/core/src/unopposed.mjs';
