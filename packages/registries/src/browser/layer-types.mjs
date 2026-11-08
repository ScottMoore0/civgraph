// The browser's slice of data/registries/layer-types.json (generated: node registries/browser/build.mjs).
// Readers import this module, not the JSON. It re-exports the generated layer-types.data.mjs (plain ES, no
// JSON import attribute, so Node, every esbuild incl. Cloudflare's wrangler 3.114, and TypeScript read it).
import layerTypes from './layer-types.data.mjs';

export default layerTypes;
