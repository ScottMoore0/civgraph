// The browser's slice of data/registries/layer-types.json (generated: node registries/browser/build.mjs).
// Readers import this module, not the JSON, so a file Node or TypeScript takes for CommonJS needs no
// import attributes; esbuild inlines the slice into the app bundle.
import layerTypes from './layer-types.json' with { type: 'json' };

export default layerTypes;
