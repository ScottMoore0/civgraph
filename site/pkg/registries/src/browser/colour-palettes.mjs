// The served page imports /pkg/registries/src/browser/colour-palettes.mjs, which the dist build and the dev servers answer with
// packages/registries/src/browser/colour-palettes.mjs (packages/served.json): this file is never served. It lets Node, the unit
// tests and tsc resolve that import to the same module. Do not edit: edit the package.
export * from '../../../../../packages/registries/src/browser/colour-palettes.mjs';
