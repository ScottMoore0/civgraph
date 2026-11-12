// Never served: /assets/ui/state/machine.js is packages/core/src/state-machine.mjs itself
// (packages/served.json names that one file before the assets/ui/ folder, so the dist build, the dev
// servers and the cache-token stamps all take the core module). This re-export stays so that
// theme.js's `./machine.js` and the served-URL imports of browse/ and apps/ (through
// site/assets/ui/state/machine.js) resolve in Node, tsc and the map bundle to the same module.
// One source: edit packages/core/src/state-machine.mjs.
export * from '../../../core/src/state-machine.mjs';
