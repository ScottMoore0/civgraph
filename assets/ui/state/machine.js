// The browser is served packages/ui/assets/state/machine.js at this path (packages/served.json;
// the dist build and the dev servers map /assets/ui/ to the package, so this file is never served).
// It stays so that Node and tsc resolve the served-URL imports of browse/, apps/proni-search/ and
// apps/words/ (`../assets/ui/state/machine.js`) to the same module. Do not edit: edit the package.
export * from '../../../packages/ui/assets/state/machine.js';
