// The served page imports /pkg/ui/src/templates/components/index.js, which the dist build and the dev servers answer with
// packages/ui/src/templates/components/index.js (packages/served.json): this file is never served. It lets Node, the unit
// tests and tsc resolve that import to the same module. Do not edit: edit the package.
export * from '../../../../../../packages/ui/src/templates/components/index.js';
