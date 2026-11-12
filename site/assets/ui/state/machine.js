// The browser is served packages/core/src/state-machine.mjs at this path (packages/served.json;
// the dist build and the dev servers map it, so this file is never served). It stays so that Node and
// tsc resolve the served-URL imports of browse/, apps/proni-search/, apps/words/ and apps/elections/
// (`../assets/ui/state/machine.js`) to the same module. Do not edit: edit packages/core/src/state-machine.mjs.
export * from '../../../../packages/ui/assets/state/machine.js';
